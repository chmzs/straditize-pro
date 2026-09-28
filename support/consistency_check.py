#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""跨文件「必须一致的两端」静态核对。

## 为什么需要它

本项目已修的缺陷里，绝大多数不是"某个函数写错了"，而是**两处本该一致的东西
没有保持一致**：

    签名  ↔  调用方            （73e73b7 改了 package_lipd_archive 签名，session.py 漏改）
    类型标注  ↔  实现           （`col_index: int | str` 却直接 int()，真实列 id 直接炸）
    package-data 声明  ↔  实际文件（ocr/data 曾漏配，pip 装的包静默丢词表）
    测试声明  ↔  实际收集        （test-e2e 曾只跑 10 条里的 1 条）
    渲染守卫  ↔  设计稿编号      （8 步重构后 GeologyCanvas 仍用旧 7 步编号）
    注释  ↔  现行事实            （"S5 拐点" 在新编号里是分列）

这些都能机械核对，不该靠人读代码碰运气。本脚本只做核对、不做修改，
输出可判定的 PASS/FAIL，供 `pixi run lint` 调用。

## 检查项

    A 函数签名 ↔ 调用点（位置/关键字参数个数与名称）
    B `int | str` 类标注的实现必须真的处理 str
    C package-data 声明的 glob 必须至少命中一个真实文件
    D pytest python_files 声明覆盖不到的测试文件
    E GeologyCanvas 中残留的裸 workflowStage 数字比较
    F 注释中残留的旧 7 步编号措辞（warning，不阻断）

用法：pixi run python support/consistency_check.py [--strict]
      --strict 时把 warning 也算失败（CI 可视需要开启）
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Signature = tuple[list[str], int, list[str], bool, str]
SignatureMap = dict[str, list[Signature]]


# ---------------------------------------------------------------- A. 签名核对
def collect_signatures() -> tuple[SignatureMap, list[str]]:
    """收集后端 Python 函数签名，并返回无法解析的文件。"""
    sigs: SignatureMap = {}
    parse_errors: list[str] = []
    for p in (ROOT / "straditize_core").rglob("*.py"):
        if "__pycache__" in str(p):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            parse_errors.append(f"{p.relative_to(ROOT)}: Python 语法解析失败: {exc}")
            continue
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                a = n.args
                pos = [x.arg for x in a.posonlyargs + a.args]
                sigs.setdefault(n.name, []).append(
                    (
                        pos,
                        len(pos) - len(a.defaults),
                        [x.arg for x in a.kwonlyargs],
                        a.vararg is not None or a.kwarg is not None,
                        str(p.relative_to(ROOT)),
                    )
                )
    return sigs, parse_errors


# 这些名字太通用：既有 stdlib/第三方方法（PIL Image.load、pandas DataFrame.to_dict、
# QTimer.start），也有本项目自己的同名函数，AST 层面无法判定接收者类型。
# 硬报只会制造噪音——代价是这几类名字的签名漂移漏检，换来其余检查的可信度。
GENERIC_NAMES = {
    "load", "save", "main", "start", "stop", "close", "read", "write",
    "run", "open", "update", "get", "set", "dump", "loads", "dumps",
    "to_dict", "from_dict", "render", "init", "setup", "reset",
}


def check_signature_calls(sigs: SignatureMap) -> list[str]:
    problems = []
    # 只扫本项目维护的代码。`straditize/` 是上游第三方 PyQt5 原版（AGENTS.md：
    # 本项目不维护、当前环境缺依赖跑不起来），`build/` 是构建产物，扫它们只会
    # 制造一堆与本项目无关的噪音。
    scan_roots = ["straditize_core", "tests", "scripts", "support"]
    files = [
        q
        for root in scan_roots
        for q in (ROOT / root).rglob("*.py")
        if "__pycache__" not in str(q)
    ]
    for p in files:
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            problems.append(f"{p.relative_to(ROOT)}: Python 语法解析失败: {exc}")
            continue
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            f = n.func
            if isinstance(f, ast.Attribute):
                name, is_method = f.attr, True
            elif isinstance(f, ast.Name):
                name, is_method = f.id, False
            else:
                continue
            if name not in sigs or name in GENERIC_NAMES:
                continue
            matched = False
            for pos, req, kwonly, has_var, where in sigs[name]:
                params = list(pos)
                # 绑定方法调用 obj.method(...) 不传 self，签名要相应折叠首参
                if is_method and params and params[0] in ("self", "cls"):
                    params = params[1:]
                    req = max(0, req - 1)
                if has_var:
                    matched = True
                    break
                if len(n.args) > len(params):
                    continue
                kwargs = {k.arg for k in n.keywords if k.arg}
                # 必需参数可以按位置给、也可以按关键字给 —— 只数位置参数会误报
                # （本项目几乎所有 RPC 入口都是全关键字调用）
                if set(params[:req]) - (set(params[: len(n.args)]) | kwargs):
                    continue
                if kwargs - set(params) - set(kwonly):
                    continue
                matched = True
                break
            if not matched:
                problems.append(
                    f"{p.relative_to(ROOT)}:{n.lineno}  调用 {name}( 实参与定义不符\n"
                    f"        {ast.unparse(n)[:110]}"
                )
    return problems


# ------------------------------------------------------- B. int | str 标注
def check_int_str_annotation() -> list[str]:
    problems = []
    for p in (ROOT / "straditize_core").rglob("*.py"):
        if "__pycache__" in str(p):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            problems.append(f"{p.relative_to(ROOT)}: Python 语法解析失败: {exc}")
            continue
        for n in ast.walk(tree):
            if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if "int | str" not in ast.unparse(n.args):
                continue
            if not _has_str_branch(n, seen={n.name}, depth=0):
                problems.append(
                    f"{p.relative_to(ROOT)}:{n.lineno}  {n.name}() 标注了 int | str，"
                    f"但实现里没有 str 分支（也没有委托给有 str 分支的函数）"
                )
    return problems


_STR_KEYS = ("isdigit", "isinstance(", "_resolve", "str(col", "str(")


def _has_str_branch(fn: ast.AST, seen: set[str], depth: int) -> bool:
    """函数体里是否有真正处理 str 的代码；纯委托则顺藤摸到被调方（最多 3 层）。

    没有这一步会误报：`point_move` 的函数体只有 `return self.point_add(...)`，
    str 分支在 point_add 里。
    """
    body = ast.unparse(fn)
    if any(k in body for k in _STR_KEYS):
        return True
    if depth >= 3:
        return False
    for call in (x for x in ast.walk(fn) if isinstance(x, ast.Call)):
        f = call.func
        callee = f.attr if isinstance(f, ast.Attribute) else (
            f.id if isinstance(f, ast.Name) else None
        )
        if not callee or callee in seen or not callee.startswith(("point_", "column_", "_")):
            continue
        seen.add(callee)
        target = _find_function(callee)
        if target is not None and _has_str_branch(target, seen, depth + 1):
            return True
    return False


_FUNC_INDEX: dict[str, ast.AST] | None = None


def _find_function(name: str) -> ast.AST | None:
    global _FUNC_INDEX
    if _FUNC_INDEX is None:
        _FUNC_INDEX = {}
        for p in (ROOT / "straditize_core").rglob("*.py"):
            if "__pycache__" in str(p):
                continue
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            for n in ast.walk(tree):
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    _FUNC_INDEX.setdefault(n.name, n)
    return _FUNC_INDEX.get(name)


# ------------------------------------------------- C. package-data 声明存在
def check_package_data() -> list[str]:
    import tomllib

    problems = []
    pyproject = ROOT / "pyproject.toml"
    if not pyproject.exists():
        return problems
    data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    pkg = data.get("tool", {}).get("setuptools", {}).get("package-data", {})
    for mod, globs in pkg.items():
        base = ROOT / mod.replace(".", "/")
        for g in globs:
            if not list(base.glob(g)):
                problems.append(
                    f"pyproject.toml  package-data {mod} = {g!r} 在 {base.relative_to(ROOT)}/ 下匹配不到任何文件"
                )
    return problems


# ------------------------------------------ D. python_files 覆盖不到的测试
def check_test_discovery() -> list[str]:
    import tomllib

    problems = []
    pyproject = ROOT / "pyproject.toml"
    if not pyproject.exists():
        return problems
    ini = tomllib.loads(pyproject.read_text(encoding="utf-8")).get("tool", {}).get("pytest", {})
    patterns = ini.get("ini_options", {}).get("python_files") or ["test_*.py", "*_test.py"]
    tests_dir = ROOT / "tests"
    if not tests_dir.is_dir():
        return problems
    for p in sorted(tests_dir.rglob("*.py")):
        if p.name == "conftest.py":
            continue
        if not any(p.match(pat) or p.name == pat for pat in patterns):
            problems.append(
                f"{p.relative_to(ROOT)}  不匹配 python_files {patterns}，pytest 永远收集不到它"
            )
    return problems


# ---------------------------------- E. GeologyCanvas 残留的裸 stage 数字
def check_stage_literals() -> list[str]:
    problems = []
    p = ROOT / "frontend" / "src" / "components" / "GeologyCanvas.ts"
    if not p.exists():
        return problems
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if re.search(r"workflowStage\s*(?:[<>]=?|===|!==)\s*\d", line):
            problems.append(
                f"frontend/src/components/GeologyCanvas.ts:{i}  裸步骤数字 {line.strip()[:80]}\n"
                f"        阶段语义应收敛到 core/WorkflowStage.ts，否则 8 步编号一改就漂移"
            )
    return problems


# ------------------------------------------- F. 注释里的旧 7 步编号（warning）
OLD_STALE_RE = re.compile(
    r"(S3\s*分列|S4\s*标尺|S4\s*标尺标定|S5\s*拐点|S6\s*校验|旧\s*7\s*步)"
)


def check_stale_comments() -> list[str]:
    warnings = []
    p = ROOT / "frontend" / "src" / "components" / "GeologyCanvas.ts"
    if not p.exists():
        return warnings
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        s = line.strip()
        if not (s.startswith("//") or s.startswith("*")):
            continue  # 只看注释
        if OLD_STALE_RE.search(s):
            warnings.append(f"GeologyCanvas.ts:{i}  注释仍用旧 7 步编号：{s[:90]}")
    return warnings


def main() -> int:
    strict = "--strict" in sys.argv
    sigs, signature_parse_errors = collect_signatures()

    sections = [
        ("A. 调用点 ↔ 函数签名", check_signature_calls(sigs)),
        ("A0. 签名源文件语法", signature_parse_errors),
        ("B. int|str 标注 ↔ 实现", check_int_str_annotation()),
        ("C. package-data 声明 ↔ 真实文件", check_package_data()),
        ("D. pytest python_files 覆盖", check_test_discovery()),
        ("E. 裸步骤数字（应走 WorkflowStage）", check_stage_literals()),
    ]
    warnings = [("F. 注释残留旧 7 步编号", check_stale_comments())]

    failed = 0
    for title, problems in sections:
        if problems:
            failed += 1
            print(f"FAIL  {title}  ({len(problems)})")
            for x in problems:
                print(f"      - {x}")
        else:
            print(f"OK    {title}")

    for title, warns in warnings:
        if warns:
            print(f"WARN  {title}  ({len(warns)})")
            for x in warns:
                print(f"      - {x}")
        else:
            print(f"OK    {title}")

    print()
    if failed or (strict and any(w for _, w in warnings)):
        print(f"一致性核对未通过：{failed} 项失败")
        return 1
    print("一致性核对通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
