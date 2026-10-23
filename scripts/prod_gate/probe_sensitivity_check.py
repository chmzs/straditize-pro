# -*- coding: utf-8 -*-
"""probe_sensitivity_check.py —— 防止「对照组没真的改到那个变量」的工具。

## 这个脚本为什么存在

本团队（含本报告作者）在投产巡检里连续犯了**三次同一个错**：

  1. 作者：用手挖 `/Resources/XObject` 当"页内位图"的代理，
     得出"第 2/5/7/9 页全 0 张"——而真值（`page.images`）是 1/2/1/1 张。
  2. Lead：复验 C1d 时第一版把"基准"也设成"先载 A 再 load B"，
     两组都先载 A → 两组都得到 A → 无判别力，白跑一次。
  3. 作者：A2a 抓页面 `%` 文本当"列量程"；A2b 用 fetch 钩子剥字段，
     但钩子记录的是**剥离前**内容，日志 `hasTick=True` 是假象；
     A2c 钩子把响应结构改坏（`stripped=6, nCols=0`）实验条件不成立。

三次的共同结构：**探针没有证明自己真的改到了那个变量，就下了结论。**

## 本脚本检查什么（可执行，不是口号）

对每一对「对照/处理」产物，检查三件事：

  S1 **对照组真的不同吗？**
     处理组必须与对照组在"被操纵的那个变量"上确有差异。
     （A2c 若早跑这一步，`stripped=6, nCols=0` 会立刻暴露）

  S2 **两组都读到观测值了吗？**
     任一组观测值为 None/空，则这对不构成有效对照——
     差异可能来自"一边没读到"而不是"处理产生了影响"。
     （a2d 首轮 control 的 `out.val2=None` 若早被拦，就不会写出
      "与对照组一模一样"这种拿另一次运行的数字硬凑的表述）

  S3 **结论强度是否被观测到？**
     若处理组与对照组的**观测值完全相同**，那么"处理无影响"这个结论
     是**真的无影响**还是**探针根本不灵敏**（改不到渲染层）？
     脚本不替你判定哪个，但强制你把这一对标记为
     `NON_DISCRIMINATING`，并要求给出"为什么仍可信"的额外证据。

## 用法

    pixi run python scripts/prod_gate/probe_sensitivity_check.py

读取 `output/prod_gate/**` 下已登记的对（见 PAIRS），
输出每对的 S1/S2/S3 结论；退出码非 0 表示存在未被解释的不可判别对。

    pixi run python scripts/prod_gate/probe_sensitivity_check.py --list

## 设计上的取舍（诚实说明）

- 本脚本**只检查已登记的对**，不能自动发现"该有对照却没有"的探针。
  真正的通用解法是每个动态探针自报 `manipulated_variable` 与
  `expected_observable`，再由本脚本核对——见 PAIRS 里的注释。
  本轮没有改造全部 25 个探针（那会侵入取证脚本、风险大于收益），
  只覆盖了**出过事的**与**最重要的**对。
- 它不能证明结论正确，只能证明**这对观测有判别力**。
  结论是否正确仍需人来判断。
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(ROOT, "output", "prod_gate")


# ---------------------------------------------------------------------------
# 已登记的对照对
#
# 每个 pair 声明：
#   control / treated : 两个产物路径（相对 ART）
#   manipulated       : 被操纵的那个变量（人类可读）
#   probe_signal      : 从产物里取"该变量真的被改了"的证据（取不到 -> S1 FAIL）
#   observables       : 用户/研究可见的观测量（取不到 -> S2 FAIL）
#   discriminating    : 是否预期两组观测值产生差异
#   if_not_discriminating : 当两组观测值相同时，为什么结论仍可信（必填）
# ---------------------------------------------------------------------------
PAIRS: list[dict] = [
    {
        "name": "A2d 断路器：后端不发 startValue/tickValue",
        "control": "a2_fallback/a2d_control.json",
        "treated": "a2_fallback/a2d_stripped.json",
        "manipulated": "后端是否在 core.detectColumns 响应里返回 startValue/tickValue",
        "probe_signal": {
            "file": "boot", "key": "networkHasStartValue",
            "expect_control": True, "expect_treated": False,
        },
        "observables": [
            {"label": "网络层是否含 startValue", "path": ["boot", "networkHasStartValue"]},
            {"label": "getDiagramData 是否含 startValue", "path": ["gdd", "hasStartValue"]},
            {"label": "getDiagramData 首列 maxPercent", "path": ["gdd", "firstCol", "maxPercent"]},
            {"label": "用户可见 X2 (inp-manual-tick-val2)", "path": ["out", "val2"]},
            {"label": "UI 所处步骤", "path": ["out", "stage"]},
        ],
        "discriminating": False,
        "if_not_discriminating": (
            "两组 val2 都是 20，但这不是'探针不灵敏'："
            "S1 已证明网络层确实不含该字段，S3 的观测（gdd.firstCol.maxPercent=20）"
            "在两组间**取值相同但内容不同**——对照组首列同时有 startValue/tickValue，"
            "处理组只剩 maxPercent。结论（'移除字段后显示值不变，因 maxPercent 兜底'）"
            "所依赖的正是'maxPercent 在处理组仍然存在'这一事实，而它在处理组被独立观测到。"
        ),
    },
    {
        "name": "G-01a 死代码：band 夹取条件",
        "control": None,   # 该探针是"数学证明 + 端到端复核"，无对照对
        "treated": None,
        "manipulated": "ROI 底边 y_bottom 取不同值（60..2000）",
        "probe_signal": None,
        "observables": [],
        "discriminating": False,
        "if_not_discriminating": (
            "该结论不依赖对照对：它对 y_bottom 的**全部取值**都给出同一结果"
            "（skipped=60/60, tested=0），且结论是数学恒等式"
            "（top+bh ≥ y_bottom+2 > hi_search）。"
            "真正的灵敏度证据是反向对照：显式给 band=(869,875) 时同图检出 32 齿，"
            "即算法有能力、只是被夹取挡住。该反向对照已在 g01a_band_deadcode.py §4 实跑。"
        ),
    },
    {
        "name": "C1e 方案判别：载包A后载入同尺寸异图B（应失效）",
        "control": "c1e/c1e_matrix.json",
        "treated": "c1e/c1e_matrix.json",
        "manipulated": (
            "几何 scope 的形态：无 scope / 记 image_path / 记 fingerprint / "
            "记 pack_id / 被重写；观测点是载入异图后几何是否仍剔墨"
        ),
        "probe_signal": {
            "file": None, "key": None,
            "note": (
                "该对是 5 方案 × 3 场景矩阵，不是二元对照；S1 由下方 special 字段"
                "用『期望 S2 应失效而实际生效』来判定"
            ),
        },
        "observables": [],
        "discriminating": True,
        "special": "c1e_matrix",
        "expect": (
            "只有 B_图像指纹 满足 S1 生效 + S2/S3 失效；"
            "其余方案 S2 均为 eff=3 px=1214（跨图误删）"
        ),
    },
    {
        "name": "G-01b4 samples 跨页残留（修复后复验）",
        "control": None,
        "treated": None,
        "manipulated": "会话是否先在第 5 页写入 samples 再换到第 9 页",
        "probe_signal": None,
        "observables": [],
        "discriminating": False,
        "invalid_reason": (
            "当前 output/prod_gate/g01b4_A_stale.csv 与 g01b4_B_clean.csv 均为"
            "修复后重跑产物，sha1 相同（897323db…），且**修复前的那次差异产物已被覆盖**。"
            "因此现在留在磁盘上的这两个文件不构成前后对照——"
            "它们只能证明'修复后 A/B 一致'，不能证明'该探针能测出差异'。"
            "该探针的判别力证据只在主报告 §4.4 的**文字记录**里"
            "（修复前 rows 158 vs 1501、非零 482 vs 4992、深度 785 vs 502.681），"
            "而那份记录的原始产物已不可得。"
        ),
        "if_not_discriminating": (
            "结论（缺陷曾存在、现已被 backend-fixer 的 core.py 修改修复）"
            "仍可信，但依据不是当前磁盘上的这两个 csv，而是："
            "① 修复前那次运行的完整输出已逐行抄进主报告 §4.4；"
            "② Lead 用同一份 g01b4 探针在修复后独立复验得到 A/B 一致。"
            "若要恢复**可复跑的**判别力，需在 git 里回到修复前的 core.py 重跑一次，"
            "本轮未做（会与队友并发冲突）。"
        ),
    },
]


def load(rel: str | None):
    if not rel:
        return None
    p = os.path.join(ART, rel)
    if not os.path.exists(p):
        return None
    if p.endswith(".json"):
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    return p


def dig(obj, path: list[str]):
    cur = obj
    for k in path:
        if isinstance(cur, dict):
            if k not in cur:
                return "<missing>"
            cur = cur[k]
        else:
            return "<not-a-dict>"
    return cur


def csv_sha(rel: str):
    import hashlib

    p = os.path.join(ART, rel)
    if not os.path.exists(p):
        return None
    return hashlib.sha1(open(p, "rb").read()).hexdigest()


def check_c1e_matrix(pair: dict) -> dict:
    """C1e 方案矩阵：断言只有『图像指纹』方案同时满足 R1 与 R2。

    这不是二元对照，而是 5 方案 × 3 场景。判据来自实验设计本身：
      S1 必须生效（R1 不误杀）；S2/S3 必须失效（R2 不放行）。
    任何方案若 S2 仍生效 -> 跨图防御被破坏，判 FAIL。
    """
    path = os.path.join(ART, pair["control"])
    result = {"name": pair["name"], "s1": None, "s2": None, "s3": None}
    if not os.path.exists(path):
        result["invalid"] = f"缺 {pair['control']}（未跑 c1e_scheme_discriminator.py）"
        result["s1"] = {"pass": False}
        result["s2"] = {"pass": False, "missing": ["matrix 文件缺失"]}
        result["s3"] = {"n_observables": 0, "n_differing": 0, "differing": []}
        return result

    with open(path, encoding="utf-8") as fh:
        m = json.load(fh)

    def eff(variant: str, scen: str):
        for r in m["results"]:
            if r["variant"] == variant and r["scenario"].startswith(scen):
                return r["steps"][-1].get("n_effective_removed")
        return None

    variants = list(m["variants"].keys())
    rows = {}
    ok_variants, bad_variants = [], []
    # 机制性排除：仅凭行为绿不够。D（重写 scope）能过行为矩阵，是因为它把
    # 几何 scope 改写成"当前"——等于宣布任何几何都属于当前图，跨图防御失去内容。
    # 这类方案即使行为全绿也必须判不合格，否则本检查器会替它背书。
    MECHANICALLY_UNSOUND = {
        "D_重写scope": (
            "行为全绿但机制上是掩盖失配：它把几何的 scope 改写成当前图，"
            "等于声明'任何几何都属于当前图'。换一种实现（每次载图都重写）"
            "就会连 S2 一起放行。判据：让判定失去内容 != 让判定正确。"
        ),
    }
    for v in variants:
        s1, s2, s3 = eff(v, "S1"), eff(v, "S2"), eff(v, "S3")
        behavioural_ok = (s1 == 3 and s2 == 0 and s3 == 0)
        unsound = MECHANICALLY_UNSOUND.get(v)
        good = behavioural_ok and not unsound
        rows[v] = {"S1": s1, "S2": s2, "S3": s3, "ok": good,
                   "behavioural_ok": behavioural_ok,
                   "mechanically_unsound": unsound}
        (ok_variants if good else bad_variants).append(v)

    result["matrix"] = rows
    result["ok_variants"] = ok_variants
    result["bad_variants"] = bad_variants
    # S1：矩阵本身有没有判别力（各方案结果不全相同）
    distinct = {tuple(r[k] for k in ("S1", "S2", "S3")) for r in rows.values()}
    result["s1"] = {"pass": len(distinct) > 1,
                    "note": f"{len(distinct)} 种不同结果组合（>1 表示矩阵有判别力）"}
    result["s2"] = {"pass": all(r["S1"] is not None for r in rows.values()),
                    "missing": [v for v, r in rows.items() if r["S1"] is None]}
    result["s3"] = {"n_observables": len(rows),
                    "n_differing": len(bad_variants),
                    "differing": bad_variants,
                    "expected_discriminating": True,
                    "if_not": pair.get("expect")}
    return result


def check_pair(pair: dict) -> dict:
    name = pair["name"]
    ctrl = load(pair.get("control"))
    trt = load(pair.get("treated"))

    result = {"name": name, "s1": None, "s2": None, "s3": None, "notes": []}

    # ---- 矩阵型检查（special）：走专门逻辑 ----
    if pair.get("special") == "c1e_matrix":
        return check_c1e_matrix(pair)

    # ---- 硬性失效：登记时就承认这对不成立，直接判 FAIL 供人复核 ----
    if pair.get("invalid_reason"):
        result["invalid"] = pair["invalid_reason"]
        result["s1"] = {"note": "对本身无效", "pass": False}
        result["s2"] = {"missing": [], "pass": False,
                        "observed_control": {}, "observed_treated": {}}
        result["s3"] = {"n_observables": 0, "n_differing": 0, "differing": [],
                        "expected_discriminating": None,
                        "if_not": pair.get("if_not_discriminating")}
        return result

    # ---- S1：被操纵的变量真的不同吗 ----
    ps = pair.get("probe_signal")
    if ps and ps.get("key") and ctrl and trt:
        cv = dig(ctrl, [ps["file"], ps["key"]])
        tv = dig(trt, [ps["file"], ps["key"]])
        ok = (cv == ps["expect_control"]) and (tv == ps["expect_treated"])
        result["s1"] = {"control": cv, "treated": tv, "pass": ok}
    elif ps and ps.get("note"):
        result["s1"] = {"note": ps["note"], "pass": None}
    else:
        result["s1"] = {"note": "该对无内嵌信号或人工声明不适用", "pass": None}

    # ---- S2：两组都读到观测值了吗 ----
    obs_c, obs_t, missing = {}, {}, []
    for o in pair.get("observables", []):
        if "csv_sha" in o:
            # 注意：csv_sha 只描述**一个**文件。若同一 label 出现在两组，
            # 说明这对的观测量登记错了（等于没对照）。此处如实标出，不静默通过。
            sha = csv_sha(o["csv_sha"])
            obs_c[o["label"] + " (control)"] = sha
            obs_t[o["label"] + " (treated)"] = sha
            missing.append(
                f"{o['label']}: 观测量只登记了单侧文件，两组读到同一来源，"
                f"该观测对不提供判别力"
            )
            continue
        if ctrl is None or trt is None:
            continue
        cv = dig(ctrl, o["path"]) if o["path"][0] in ("boot", "gdd", "out") else "<n/a>"
        tv = dig(trt, o["path"]) if o["path"][0] in ("boot", "gdd", "out") else "<n/a>"
        obs_c[o["label"]] = cv
        obs_t[o["label"]] = tv
        for lbl, v in ((f"control.{o['label']}", cv), (f"treated.{o['label']}", tv)):
            if v in (None, "<missing>", "<not-a-dict>", "", []):
                missing.append(lbl)
    result["s2"] = {"missing": missing, "pass": len(missing) == 0,
                    "observed_control": obs_c, "observed_treated": obs_t}

    # ---- S3：观测值是否产生差异 ----
    diffs = []
    for k in obs_c:
        if obs_c[k] != obs_t.get(k):
            diffs.append(k)
    result["s3"] = {"n_observables": len(obs_c), "n_differing": len(diffs),
                    "differing": diffs,
                    "expected_discriminating": pair.get("discriminating"),
                    "if_not": pair.get("if_not_discriminating")}
    return result


def self_test() -> int:
    """金丝雀：确认本脚本真的能抓出「对照组没改到变量」。

    一个从不失败的门禁等于没有门禁。这里构造一对**故意无效**的对照
    （treated 组是 control 的完整副本，即"以为改了其实没改"，
    正是 A2b/A2c 与 Lead 首次 C1d 的失败形态），确认 S1 判定为 FAIL。
    """
    print("=" * 78)
    print("SELF-TEST：构造一个'对照组没改到变量'的假对照，确认本检查器能抓出")
    print("=" * 78)
    import copy
    import tempfile

    src = os.path.join(ART, "a2_fallback", "a2d_control.json")
    if not os.path.exists(src):
        print("  缺少 a2d_control.json，无法自测")
        return 2
    with open(src, encoding="utf-8") as fh:
        ctrl = json.load(fh)
    fake = copy.deepcopy(ctrl)  # 刻意不改任何字段

    tmpdir = tempfile.mkdtemp(prefix="probe_canary_")
    fake_rel = "a2_fallback/__canary__.json"
    with open(os.path.join(ART, fake_rel), "w", encoding="utf-8") as fh:
        json.dump(fake, fh)

    pair = {
        "name": "金丝雀（应 FAIL）",
        "control": "a2_fallback/a2d_control.json",
        "treated": fake_rel,
        "manipulated": "假装剥掉字段，其实产物与对照完全相同",
        "probe_signal": {"file": "boot", "key": "networkHasStartValue",
                         "expect_control": True, "expect_treated": False},
        "observables": [{"label": "X2", "path": ["out", "val2"]}],
        "discriminating": None,
        "if_not_discriminating": None,
    }
    r = check_pair(pair)
    os.remove(os.path.join(ART, fake_rel))

    got = r["s1"].get("pass")
    print(f"  S1 判定 = {got}  (control={r['s1'].get('control')!r} "
          f"-> treated={r['s1'].get('treated')!r})")
    if got is False:
        print("  结果：**抓到了** —— 本检查器对'假对照'具备灵敏度")
        return 0
    print("  结果：**没抓到** —— 本检查器本身失效，不可用于把关")
    return 1


def main() -> int:
    print("=" * 78)
    print("probe_sensitivity_check —— 探针灵敏度检查")
    print("=" * 78)
    print(f"产物根：{ART}")
    if not os.path.isdir(ART):
        print("  产物目录不存在（未跑过探针？）")
        return 2

    if "--list" in sys.argv:
        for p in PAIRS:
            print(f"  - {p['name']}")
        return 0

    if "--self-test" in sys.argv:
        return self_test()

    bad = 0
    for pair in PAIRS:
        r = check_pair(pair)
        print(f"\n### {r['name']}")
        if r.get("invalid"):
            print(f"  **该对照对无效，不可作为取证依据**")
            print(f"    原因：{r['invalid']}")
            if r["s3"].get("if_not"):
                print(f"    但结论仍可信的依据：{r['s3']['if_not']}")
            bad += 1
            continue
        if r.get("matrix"):
            print(f"  方案矩阵（eff：S1 应=3, S2/S3 应=0）")
            for v, row in r["matrix"].items():
                if row["ok"]:
                    mark = "✅"
                elif row.get("behavioural_ok") and row.get("mechanically_unsound"):
                    mark = "⚠️"
                else:
                    mark = "❌"
                print(f"    {mark} {v:<22} S1={row['S1']}  S2={row['S2']}  S3={row['S3']}")
                if row.get("mechanically_unsound"):
                    print(f"       行为绿但机制不成立：{row['mechanically_unsound']}")
            print(f"  合格方案: {r['ok_variants'] or '（无）'}")
            print(f"  不合格:   {r['bad_variants']}")
            if not r["ok_variants"]:
                print(f"  **没有任何方案同时满足 R1+R2 -> FAIL**")
                bad += 1
            if len(r["bad_variants"]) > 0:
                print(f"  （不合格方案中若 S2 仍生效，即跨图防御被破坏）")
            continue
        s1, s2, s3 = r["s1"], r["s2"], r["s3"]

        # S1
        if s1.get("pass") is True:
            print(f"  S1 对照组确已改变变量: PASS  "
                  f"(control={s1['control']!r} -> treated={s1['treated']!r})")
        elif s1.get("pass") is False:
            print(f"  S1 对照组确已改变变量: **FAIL**  "
                  f"(control={s1['control']!r} -> treated={s1['treated']!r})")
            print(f"     => 处理组没有真的改到变量，这对没有判别力，结论不可用它")
            bad += 1
        else:
            print(f"  S1: N/A  {s1.get('note')}")

        # S2
        if s2["missing"]:
            print(f"  S2 两组都读到观测值: **FAIL**  缺失 {s2['missing']}")
            print(f"     => 任一组没读到值时，差异可能来自'没读到'而非处理效果")
            bad += 1
        else:
            print(f"  S2 两组都读到观测值: PASS  ({len(s2['observed_control'])} 个观测量)")
            for k in s2["observed_control"]:
                print(f"       {k}: control={s2['observed_control'][k]!r}  "
                      f"treated={s2['observed_treated'][k]!r}")

        # S3
        if s3["n_differing"] > 0:
            print(f"  S3 观测有差异: PASS  ({s3['n_differing']}/{s3['n_observables']} 项不同: "
                  f"{s3['differing']})")
        else:
            exp = s3["expected_discriminating"]
            tag = "预期无差异" if exp is False else "需要解释"
            print(f"  S3 观测**无**差异（{tag}）: 必须显式论证探针灵敏度")
            if s3.get("if_not"):
                print(f"     论证：{s3['if_not']}")
            else:
                print(f"     **缺理论证 → 判定为 NON_DISCRIMINATING，不可作为结论依据**")
                bad += 1

    print("\n" + "=" * 78)
    if bad:
        print(f"结论：有 {bad} 项未通过或未解释，相关结论不得直接采用。")
        return 1
    print("结论：全部登记对通过 S1/S2/S3，或用显式论证解释了无差异。")
    print("注意：本脚本只证明'这对观测有判别力'，不证明结论正确。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
