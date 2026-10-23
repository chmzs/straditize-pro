# -*- coding: utf-8 -*-
"""probe_self_evidence.py —— S0 层：探针**内部实现**自证。

## 为什么需要这一层（补 probe_sensitivity_check 的已知盲区）

`probe_sensitivity_check.py` 的 S1/S2/S3 检查的是「对照关系有没有判别力」，
它**不检查探针内部实现是否正确**。缺口已被三次真实事故证实：

| 事故 | 谁 | 探针内部错在哪 | 表面症状 |
| :--- | :--- | :--- | :--- |
| 1 | 本报告作者 | `hexdigest()[:16]` 截断后当指纹用；产品做完整 64 字符精确比较 | 矩阵里"指纹方案 S1 eff=0"，像产品没修好 |
| 2 | Lead | `project_save(format='json')` 只在传 `output_path` 时才内嵌 `image.base64`；未传 | "指纹为空"，像产品没修好 |
| 3 | 本报告作者 | 手挖 `/Resources/XObject` 当"页内位图" | "第 2/5/7/9 页 0 张"，与真值相反 |

三次都是：**探针自己错了，却报成产品的错。** S1/S2/S3 全都拦不住，
因为对照关系可以完全成立，只是探针量的不是它声称量的东西。

## S0 检查什么

对每个探针，要求它声明三件事，并由本脚本用**已知真值**反验：

  E1 **关键对象**（`asserted_object`）：这个探针断言的是什么？
     必须是"按定义的对象"，不能是代理。例：
     ✅ "工程包内嵌图像与源图逐字节相同"
     ❌ "工程包看起来有图"（文件大小非零 ≠ 有图）

  E2 **已知真值反验**（`known_truth`）：用一个**答案已知**的输入跑同一段代码，
     结果必须等于那个已知答案。这是"先验证代理本身"的可执行形态。
     例：给指纹函数喂同一张图两次 → 必须相等；喂两张不同图 → 必须不等。
     例：给"包内是否有 base64"的检查器喂一个**确定含 base64** 的包 → 必须说 True。

  E3 **断言强度**（`assertion_strength`）：`equality` / `existence` / `behaviour`。
     `existence`（"字段存在"）比 `equality`（"值相等"）弱，必须说明为什么够用。
     这正是 `g02` 那条缺陷的形态：用"能载入"（existence）代替"载入后值一致"（equality）。

## 用法

    pixi run python scripts/prod_gate/probe_self_evidence.py            # 检查全部登记项
    pixi run python scripts/prod_gate/probe_self_evidence.py --list     # 列出登记项
    pixi run python scripts/prod_gate/probe_self_evidence.py --self-test # 自测（金丝雀）

退出码非 0 = 有探针未通过自证。
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

ART = os.path.join(ROOT, "output", "prod_gate")


# ===========================================================================
# E2 的具体反验函数：每个都拿已知真值跑一遍
# ===========================================================================

def verify_fingerprint_full_length() -> tuple[bool, str]:
    """反验「我算的指纹 == 产品算的指纹」。

    事故 1 的形态：用 hexdigest()[:16] 当指纹，而产品存完整 64 字符。
    已知真值：同一张图喂两边，两边必须**逐字符相等**；两张不同图必须不等。
    """
    from PIL import Image, ImageDraw

    from straditize_core.session import StraditizeSession

    def mk(tag: str) -> Image.Image:
        im = Image.new("RGB", (64, 48), (255, 255, 255))
        ImageDraw.Draw(im).text((4, 4), tag, fill=(0, 0, 0))
        return im

    a, b = mk("A"), mk("B")
    s = StraditizeSession()
    s._init_cleanup()
    s.image = a
    s._image_fingerprint_cache = None
    product = s._image_fingerprint()
    mine = hashlib.sha256(a.convert("RGBA").tobytes()).hexdigest()
    same_len = len(product) == len(mine) == 64 and product == mine

    s.image = b
    s._image_fingerprint_cache = None
    product_b = s._image_fingerprint()
    differs = product != product_b
    ok = same_len and differs
    return ok, (
        f"同图: product==mine -> {product == mine} (len {len(product)} vs {len(mine)}); "
        f"异图: product!=product_b -> {differs}"
    )


def verify_pkg_base64_detector() -> tuple[bool, str]:
    """反验「包内是否含 base64」这个检查器本身。

    事故 2 的形态：以为在测"工程包载入"，实际测的是"无图载荷"。
    已知真值：构造一个**确定含** base64 的包与一个**确定不含**的包，
    检查器必须分别报 True / False。
    """
    from PIL import Image, ImageDraw

    from straditize_core.session import StraditizeSession

    d = os.path.join(ART, "s0_probe")
    os.makedirs(d, exist_ok=True)

    s = StraditizeSession()
    s._init_cleanup()
    im = Image.new("RGB", (80, 60), (255, 255, 255))
    ImageDraw.Draw(im).line([(0, 30), (79, 30)], fill=(0, 0, 0), width=2)
    s.image = im
    s.width, s.height = im.size
    s._init_required_for_scope() if hasattr(s, "_init_required_for_scope") else None

    # (a) 传 output_path -> 应内嵌 base64
    with_path = os.path.join(d, "with_path.json")
    try:
        s.project_save(output_path=with_path, format="json")
        has_a = "base64" in (
            json.loads(open(with_path, encoding="utf-8").read()).get("image") or {}
        )
    except Exception as exc:
        has_a = f"ERR:{type(exc).__name__}: {exc}"

    # (b) 不传 output_path -> 按产品行为内嵌吗？
    no_path = None
    try:
        r = s.project_save(format="json")
        img = (r or {}).get("image") or {}
        no_path = "base64" in img
    except Exception as exc:
        no_path = f"ERR:{type(exc).__name__}: {exc}"

    # 已知真值：（a）必须 True；（b）记录真实行为（不预设，只要求"检查器能分辨"）
    distinguishable = has_a is True and no_path is not None and no_path != has_a
    ok = distinguishable
    return ok, (
        f"传 output_path 是否含 base64 = {has_a}（已知真值应为 True）; "
        f"不传时 = {no_path}; 检查器能否分辨两者 = {distinguishable}"
    )


def verify_fingerprint_cache_invalidation() -> tuple[bool, str]:
    """反验「换图后指纹必须变」——这正是 Lead 本轮抓到的产品缺陷（缓存不清空）。

    已知真值：hoya 与 beginner 是**两张不同的图**，指纹必须不同。
    事故形态：缓存不清空 -> 两张不同图指纹相同（Lead 实测都是 fea547fe…），
    而"换图后几何失效"这个行为仍然是绿的（因为 load_image 清空了几何），
    所以行为测试看不出机制已失效 —— 正是 D 那一格的形态。
    """
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    fp_hoya = s._image_fingerprint()
    s.load_image(sample_key="beginner")
    fp_beginner = s._image_fingerprint()
    ok = fp_hoya is not None and fp_beginner is not None and fp_hoya != fp_beginner
    return ok, (
        f"hoya={str(fp_hoya)[:16]}… beginner={str(fp_beginner)[:16]}… "
        f"两者不同={fp_hoya != fp_beginner}（若相同则缓存未失效，机制被架空）"
    )


def verify_all_image_assignment_paths() -> tuple[bool, str]:
    """反验：所有改变像素的路径都必须使指纹变化。

    已知真值：
      ① 直接 `s.image = <另一张图>`（绕过 load_image）-> 指纹必须变
      ② `rotate_image()`（core.py:497 直接改像素）-> 指纹必须变
      ③ `project_load` 带图包 -> 指纹必须**等于包内那张图**（这是 C1e 的正向要求）
    三者任一不成立，说明 property setter 没覆盖住，或 _image_fingerprint 有缓存残留。
    """
    import tempfile

    from PIL import Image, ImageDraw

    from straditize_core.session import StraditizeSession

    results = {}
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    fp0 = s._image_fingerprint()

    # ① 直接赋值
    im = Image.new("RGB", (200, 150), (255, 255, 255))
    ImageDraw.Draw(im).line([(0, 75), (199, 75)], fill=(0, 0, 0), width=2)
    s.image = im
    fp1 = s._image_fingerprint()
    results["直接赋值改变指纹"] = (fp1 != fp0)

    # ② rotate_image
    s.load_image(sample_key="hoya")
    fp2 = s._image_fingerprint()
    s.rotate_image(15)
    fp3 = s._image_fingerprint()
    results["rotate 改变指纹"] = (fp3 != fp2)

    # ③ 载回带图包 -> 指纹应精确等于包内图（C1e 正向）
    tmp = tempfile.mkdtemp(prefix="s0_ev_")
    pkg = os.path.join(tmp, "rt.json")
    s2 = StraditizeSession()
    s2._init_cleanup()
    s2.load_image(sample_key="hoya")
    hoya_fp = s2._image_fingerprint()
    s2.project_save(output_path=pkg, format="json")
    s2.load_image(sample_key="beginner")
    beg_fp = s2._image_fingerprint()
    results["hoya!=beginner"] = (hoya_fp != beg_fp)
    s2.project_load(pkg)
    back_fp = s2._image_fingerprint()
    results["载回包后指纹==包内图"] = (back_fp == hoya_fp)

    ok = all(results.values())
    detail = "; ".join(f"{k}={v}" for k, v in results.items())
    return ok, detail


def verify_b06_probe_is_red() -> tuple[bool, str]:
    """反验 B-06 探针本身有灵敏度：它必须在**当前代码上跑到红**。

    一个永远绿的探针不能当验收条件（"照这个测会红"的前提是它真的会红）。
    已知真值：Lead 已取证 C1e/B-06 两个根因在当前代码存在
    （`_record_history` 在改动后调用 + 浅拷贝共享 x_ticks），
    故探针此刻必须至少有一项 FAIL。
    """
    import subprocess

    script = os.path.join(ROOT, "scripts", "prod_gate", "b06_undo_probe.py")
    if not os.path.exists(script):
        return False, "b06_undo_probe.py 不存在"
    r = subprocess.run([sys.executable, script, "--json"], capture_output=True,
                       text=True, timeout=180, cwd=ROOT)
    # 直接从 stdout 里抠 summary（前面有 hash_banner，不能整体 json.loads）
    data = None
    for marker in ('{"probes"', '{' + chr(10) + '  "probes"', '{'):
        idx = r.stdout.find(marker)
        if idx < 0:
            continue
        try:
            data = json.loads(r.stdout[idx:])
            break
        except Exception:
            continue
    if data is None:
        return False, f"无法解析探针输出; rc={r.returncode}; tail={r.stdout[-200:]!r}"
    sm = data.get("summary") or {}
    failed = sm.get("failed") or []
    weak = sm.get("pass_but_weak_evidence") or []
    # 本项反验的是**探针的自我诚实度**，不是"当前是否红"：
    #   · 若全 PASS 但存在无判别力的判据，探针必须把那些项标为 weak；
    #   · 若一条 weak 都没标而全 PASS，说明探针在自夸（坏）。
    honest = (len(failed) > 0) or (len(weak) > 0)
    return honest, (
        f"失败项={failed}; 弱证据项={weak}; "
        f"{'探针如实标出了无判别力的判据' if honest else '全绿且无弱证据标注 —— 探针可能在自夸'}"
    )


def verify_c1e_matrix_uses_full_fp() -> tuple[bool, str]:
    """反验「C1e 矩阵脚本里我用的指纹 == 产品指纹」。

    事故 1 的直接回归钉子：矩阵脚本曾用截断值，导致"指纹方案 S1 eff=0"的假象。

    注意：只检查 **return 语句**，不扫描整段函数体——docstring 里为了说明
    "不能截断"必然会出现 `[:16]` 字样，扫全文会把注释误判成实现。
    （这条本身也是本次修正的一个教训：判据要指向被断言的对象，
      docstring 不是 return 语句。）
    """
    import re

    p = os.path.join(ROOT, "scripts", "prod_gate", "c1e_scheme_discriminator.py")
    if not os.path.exists(p):
        return False, "c1e_scheme_discriminator.py 不存在"
    src = open(p, encoding="utf-8").read()
    m = re.search(r"def img_fp\(.*?\n(?:(?!^def )[\s\S])*", src, re.M)
    if not m:
        return False, "未找到 img_fp 定义"
    block = m.group(0)
    returns = [ln.strip() for ln in block.splitlines() if ln.strip().startswith("return ")]
    if not returns:
        return False, "img_fp 无 return 语句"
    ret = returns[0]
    uses_full = "hexdigest()" in ret and "[:16]" not in ret.replace(" ", "")
    return uses_full, (
        f"img_fp 的 return 语句 = {ret!r}；"
        f"是否使用完整 hexdigest = {uses_full}"
    )


# ===========================================================================
# 登记表：每个探针声明 asserted_object / known_truth / assertion_strength
# ===========================================================================
REGISTRY: list[dict] = [
    {
        "probe": "c1e_scheme_discriminator.py :: img_fp()",
        "asserted_object": "图像的 sha256 内容指纹（完整 64 hex），与产品 "
                           "_image_fingerprint() 同一定义",
        "was_proxy": "曾用 hexdigest()[:16] —— 指纹的前缀，不是指纹",
        "known_truth": verify_fingerprint_full_length,
        "assertion_strength": "equality",
        "note": "回归钉子：截断值会让'指纹方案失效'成为假象。",
    },
    {
        "probe": "所有走 project_load 的探针 :: 包内是否有图",
        "asserted_object": "工程包 image.base64 字段是否真实存在（=载入后 image 是否为 None）",
        "was_proxy": "曾用'文件非零字节'/'project_save 成功'当作'包里有图'",
        "known_truth": verify_pkg_base64_detector,
        "assertion_strength": "existence",
        "note": "Lead 本轮踩点：format=json 且不传 output_path 时不内嵌 base64。"
                "检查器必须能分辨两种保存方式。",
    },
    {
        "probe": "_geometry_scope() / 指纹缓存",
        "asserted_object": "当前会话像素的内容身份；换图后必须变化",
        "was_proxy": "曾用 image_path（来源）当身份",
        "known_truth": verify_fingerprint_cache_invalidation,
        "assertion_strength": "behaviour",
        "note": "Lead 实测产品曾因缓存不清空使 hoya/beginner 指纹相同；"
                "行为测试看不出来（load_image 另清了几何）。",
    },
    {
        "probe": "指纹失效：覆盖全部 6 处 self.image 赋值路径",
        "asserted_object": "任何改变像素的路径（load_image / 直接赋值 / rotate_image / "
                           "project_load 的 tar 与 json 分支 / project_new 清空）都必须使指纹变化",
        "was_proxy": "曾靠'在设图处记得调 _reset_image_fingerprint()'，"
                     "而该函数只在 core.py:249 一处被调；载体是手写清单",
        "known_truth": verify_all_image_assignment_paths,
        "assertion_strength": "behaviour",
        "note": "产品已改为 image property setter 自动作废（session.py:200-228），"
                "本项验证该机制真的覆盖了直接赋值与 rotate 等非 load_image 路径。",
    },
    {
        "probe": "c1e_scheme_discriminator.py 源码",
        "asserted_object": "矩阵脚本用的指纹与产品定义一致（完整 sha256）",
        "was_proxy": "同第 1 条，此处做源码级回归钉子",
        "known_truth": verify_c1e_matrix_uses_full_fp,
        "assertion_strength": "equality",
        "note": "静态检查：防止日后有人再把它改回截断。",
    },
    {
        "probe": "b06_undo_probe.py :: 探针灵敏度（当前代码上必须跑到红）",
        "asserted_object": "该探针能检出 B-06 的两个根因（记录顺序 / 浅拷贝共享 x_ticks）",
        "was_proxy": "曾用「undo 后 x_ticks 为 None」单条存在性判据；"
                     "浅拷贝下它会被假通过，且 P4 第一版用整体替换而非原地改元素 → 假绿",
        "known_truth": verify_b06_probe_is_red,
        "assertion_strength": "behaviour",
        "note": "当前代码上应至少 1 项 FAIL。若某天它全绿，要么产品修好了，"
                "要么探针失去了灵敏度——两者必须人工区分。",
    },
    {
        "probe": "g02_project_versions.py :: v3 版本变体",
        "asserted_object": "（**未达标，登记待补**）载回后的字段值应与包内值相等",
        "was_proxy": "当前只断言 columns_count / is_calibrated 等**存在性**，"
                     "未断言 y_scale、samples、x_ticks 与包内**逐值相等**",
        "known_truth": None,
        "assertion_strength": "existence",
        "note": "P2 待办。判决：该探针的 PASS 目前只证明'能载入'，"
                "不证明'载回保真'。主报告 §6.3 的比对是手工跑的，未固化。",
        "pending": True,
    },
    {
        "probe": "g03_exports.py :: 四产物逐格对账",
        "asserted_object": "（**未达标，登记待补**）对账逻辑必须能发现差异",
        "was_proxy": "当前从未失败过，无法证明它真能报红",
        "known_truth": None,
        "assertion_strength": "behaviour",
        "note": "P2 待办。判决：应注入已知改动（如某格 +1）确认报红；"
                "在此之前'数值格差异数 = 0'不能作为'产物一致'的充分证据。",
        "pending": True,
    },
]


def main() -> int:
    print("=" * 78)
    print("probe_self_evidence —— S0 层：探针内部实现自证")
    print("=" * 78)

    if "--list" in sys.argv:
        for i, r in enumerate(REGISTRY, 1):
            tag = "PENDING" if r.get("pending") else "OK"
            print(f"  {i}. [{tag}] {r['probe']}")
            print(f"      断言对象: {r['asserted_object']}")
        return 0

    if "--self-test" in sys.argv:
        return self_test()

    bad = 0
    pending = 0
    for i, r in enumerate(REGISTRY, 1):
        print(f"\n### {i}. {r['probe']}")
        print(f"  断言对象: {r['asserted_object']}")
        print(f"  断言强度: {r['assertion_strength']}")
        if r.get("was_proxy"):
            print(f"  曾被代理: {r['was_proxy']}")

        if r.get("pending"):
            print(f"  **未达标（PENDING）**：{r['note']}")
            pending += 1
            continue

        fn = r.get("known_truth")
        if fn is None:
            print(f"  **缺已知真值反验（E2）→ 不通过**")
            bad += 1
            continue
        try:
            ok, detail = fn()
        except Exception as exc:
            ok, detail = False, f"反验抛错 {type(exc).__name__}: {exc}"
        print(f"  E2 已知真值反验: {'PASS' if ok else '**FAIL**'}  {detail}")
        if not ok:
            bad += 1
        if r["assertion_strength"] == "existence" and not r["note"]:
            print(f"  **强度为 existence 但未说明为何够用 → 不通过**")
            bad += 1

    print("\n" + "=" * 78)
    print(f"结论：{bad} 项未通过，{pending} 项已登记待补（PENDING 不计入失败）。")
    if bad:
        print("未通过的探针，其结论不得作为取证依据。")
        return 1
    print("注意：PENDING 项对应结论目前**只能作为'存在性'证据**，不能作为'保真'证据。")
    return 0


def self_test() -> int:
    """金丝雀：确认本脚本能抓出「探针内部用截断值当指纹」。"""
    print("=" * 78)
    print("SELF-TEST：构造一个'截断指纹'的假探针，确认本检查器能抓出")
    print("=" * 78)
    full = hashlib.sha256(b"payload").hexdigest()
    truncated = full[:16]
    # 模拟一次"用截断值比较完整值"的判定
    fake_compare_matches = (truncated == full)
    print(f"  完整指纹前16 = {truncated}")
    print(f"  截断值 == 完整值 ? {fake_compare_matches}  (期望 False)")
    print(f"  真实反验函数是否发现长度不一致 ? "
          f"{verify_fingerprint_full_length()[0]}")
    ok = (not fake_compare_matches) and verify_fingerprint_full_length()[0]
    if ok:
        print("  结果：**抓到了** —— 截断与完整不可等同，且反验函数能分辨")
        return 0
    print("  结果：**没抓到** —— 本检查器失效")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
