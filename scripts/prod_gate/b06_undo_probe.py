# -*- coding: utf-8 -*-
"""B-06 探针：Ctrl+Z 撤不回列标定（x_ticks）。

## 这个探针是给 backend-fixer 当验收条件用的

Lead 已取证根因二：`_record_history`（project.py:33）用 `[dict(c) for c in columns]`
**浅拷贝**，而 `x_ticks` 是嵌套 `list[dict]`，快照与实时对象共享引用。

## 为什么只断言"undo 后 x_ticks 为 None"不够（E3 强度问题）

那是 **存在性判据**。浅拷贝的典型症状是：

    第一次 undo  → 看起来对（x_ticks 变成 None）
    第二次 undo  → 把第一次的值**带回来**（因为两次快照共享同一个 x_ticks list 对象）

所以本探针的核心判据是 **双重 undo**：

    P1  标定 col0 后，undo 一次 -> col0.x_ticks 必须为 None
    P2  再 undo 一次           -> col0.x_ticks 必须**仍为 None**
        （若 P2 变成非 None，即浅拷贝共享引用被证实）

并且为避免"通过也只是碰巧"，还要：

    P3  **快照独立性**：记录 undo 栈里两个快照的 x_ticks 对象 id，
        若相同 -> 共享引用（机制性判据直接失败，不必等到观测复发）
    P4  **写后读**：undo 之后修改 session.columns[0]["x_ticks"]，
        不得影响栈里剩余快照（反向共享）

P3 是**机制性判据**：它直接问"让 undo 生效的那个手段（快照在改前记录）
是否同时保证了快照独立"。Lead 的提醒正是这一点——顺序对了但拷贝仍浅，
观测可能短暂变绿然后复发。

## 两个根因必须分开测（否则分不清修好了哪个）

**根因一（顺序）**：`_record_history` 在**改动之后**调用，于是栈顶快照存的是
"标定后"的值。undo 弹掉它、回到上一层，而上一层也是带标定的状态（或列数不同）。
表现：第一次 undo 后 x_ticks 仍非 None。

**根因二（浅拷贝）**：`[dict(c) for c in columns]` 只复制了列字典的外层，
`x_ticks` 这个 `list[dict]` 仍与实时列**共享同一个对象**。表现：改了实时列，
栈内快照跟着变；或两次 undo 之间值"串味"。

两者症状有交集，所以本探针把它们拆成独立判据：

    P3  机制性判据，**只测浅拷贝**：比较栈顶快照与实时列的 x_ticks 对象 id。
        这一条与"记录顺序对不对"完全无关，修好根因一不会让它变绿。
    P1  观测判据，测根因一：标定后 undo 一次，x_ticks 应为 None。
    P2  观测判据，测"两次 undo 是否串味"：第二次 undo 后不得出现第一次的值。
    P4  写后读，测浅拷贝的另一面（**必须原地改元素**，整体替换测不出来——
        本判据第一版就是这样假通过的，见代码内注释）。
    P5  redo 往返。

一次运行就能看出：若 P3 红而 P1 绿 -> 只剩浅拷贝未修；若 P1 红 -> 顺序仍未修。

## 用法

    pixi run python scripts/prod_gate/b06_undo_probe.py
    pixi run python scripts/prod_gate/b06_undo_probe.py --json   # 机读输出
"""
from __future__ import annotations

import json
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.session import StraditizeSession  # noqa: E402


def x_ticks_of(s, idx: int = 0):
    cols = getattr(s, "columns", []) or []
    if idx >= len(cols):
        return "<no col>"
    return cols[idx].get("x_ticks")


def stack_depth(s) -> int:
    return len(getattr(s, "undo_stack", []) or [])


def stack_snapshot_x_ticks(s, depth_from_top: int = 0):
    """取 undo 栈里倒数第 N 个快照的 col0.x_ticks。"""
    st = getattr(s, "undo_stack", []) or []
    if len(st) <= depth_from_top:
        return "<no snapshot>"
    snap = st[-1 - depth_from_top]
    cols = snap.get("columns") or []
    return cols[0].get("x_ticks") if cols else "<no col>"


def build_calibrated_session() -> StraditizeSession:
    """真实会话：hoya + 分列 + 标定 col0（会产生一条 history 记录）。"""
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.extract_foreground()
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    return s


def calibrate_col0(s) -> None:
    c = s.columns[0]
    lo = c["start"] + (c["end"] - c["start"]) * 0.2
    hi = c["start"] + (c["end"] - c["start"]) * 0.8
    s.calibrate_column_xticks(
        c["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 40.0}], unit="%"
    )


# ---------------------------------------------------------------------------
# P4 + 浅拷贝对照组：这是探针的「金丝雀」，证明 P4 真能抓到共享引用
# ---------------------------------------------------------------------------
def _snapshot_pollution_case(patch_shallow: bool) -> dict:
    """构造「栈内存在非空 x_ticks 快照」+「原地改实时值」，看快照是否被污染。

    必须构造非空快照场景：否则 null == null 恒真，P4 假绿
    （这是本探针第一版的实际错误，Lead 已指出）。
    """
    import types

    s = build_calibrated_session()

    if patch_shallow:
        # 模拟旧实现（浅拷贝）：_record_history 里 `[dict(c) for c in columns]`
        def _record_history_shallow(self, action_name):
            import time as _t

            snap = {
                "action": action_name,
                "timestamp": _t.time(),
                "columns": [dict(c) for c in getattr(self, "columns", [])],
                "control_points": {
                    k: dict(v) for k, v in getattr(self, "control_points", {}).items()
                },
                "data_xlim": list(self.data_xlim) if getattr(self, "data_xlim", None) else None,
                "data_ylim": list(self.data_ylim) if getattr(self, "data_ylim", None) else None,
                "taxa_names": list(getattr(self, "taxa_names", [])),
            }
            if not hasattr(self, "undo_stack") or self.undo_stack is None:
                self.undo_stack = []
            self.undo_stack.append(snap)

        s._record_history = types.MethodType(_record_history_shallow, s)

    # 标定两次：确保栈里至少有一个**非空** x_ticks 快照
    calibrate_col0(s)
    c = s.columns[0]
    lo = c["start"] + (c["end"] - c["start"]) * 0.2
    hi = c["start"] + (c["end"] - c["start"]) * 0.8
    s.calibrate_column_xticks(
        c["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 60.0}], unit="%"
    )

    st = getattr(s, "undo_stack", []) or []
    before = [
        json.dumps(((sn.get("columns") or [{}])[0]).get("x_ticks"), sort_keys=True)
        for sn in st
    ]
    nonempty = [
        i for i, sn in enumerate(st)
        if ((sn.get("columns") or [{}])[0]).get("x_ticks")
    ]

    live = s.columns[0].get("x_ticks") if s.columns else None
    inplace_ok = False
    if isinstance(live, list) and live and isinstance(live[0], dict):
        live[0]["value"] = 999.0
        inplace_ok = True

    after = [
        json.dumps(((sn.get("columns") or [{}])[0]).get("x_ticks"), sort_keys=True)
        for sn in st
    ]
    polluted = [i for i, (b, a) in enumerate(zip(before, after)) if b != a]

    return {
        "patch_shallow": patch_shallow,
        "stack_depth": len(st),
        "nonempty_snapshots": nonempty,
        "inplace_modified": inplace_ok,
        "polluted_snapshots": polluted,
        "caught": len(polluted) > 0,
    }


def probe_p4_write_after_read() -> dict:
    """P4：写后读隔离 + **浅拷贝对照组必须红**。

    三条要求（Lead 指定）：
      ① 必须构造"栈内存在非空 x_ticks 快照"的场景（否则 null==null 恒真）
      ② 必须做原地改实时值（整体替换测不出共享引用）
      ③ 必须加浅拷贝对照组，且该组**必须被抓到**——否则本判据无判别力
    """
    real = _snapshot_pollution_case(patch_shallow=False)
    canary = _snapshot_pollution_case(patch_shallow=True)

    has_nonempty = len(real["nonempty_snapshots"]) > 0
    inplace_ok = real["inplace_modified"]
    # 真判据：当前实现不应有污染
    isolation_ok = (len(real["polluted_snapshots"]) == 0)
    # 灵敏度判据：浅拷贝对照组必须被抓到
    canary_catches = canary["caught"]
    # 但本轮实测发现：产品只用整体替换，浅拷贝对照组**也抓不到**。
    # 因此"canary 未抓到"有两种含义，必须如实区分：
    #   (a) 探针无判别力（坏）
    #   (b) 产品代码里不存在"原地改共享容器"的路径，故该场景在产品内不可构造（当前事实）
    return {
        "测法": "构造非空快照 + 原地改实时 x_ticks[0]['value']",
        "前置_存在非空快照": has_nonempty,
        "前置_成功原地改": inplace_ok,
        "真实实现_被污染快照": real["polluted_snapshots"],
        "浅拷贝对照_被污染快照": canary["polluted_snapshots"],
        "真实实现_隔离成立": isolation_ok,
        "浅拷贝对照_被抓到": canary_catches,
        # 交付判据：真实实现隔离成立，且两个前置都成立
        "pass": has_nonempty and inplace_ok and isolation_ok,
        # 判别力单列，不混入 pass —— 它衡量的是"这条判据能不能区分实现"
        "has_discriminating_power": canary_catches,
        # 证据等级：判据本身成立不等于它能区分实现。本项当前只能算"弱证据"，
        # 汇总里会单独统计，避免被当成"深拷贝已被验证有效"。
        "evidence_grade": "weak" if not canary_catches else "strong",
        "note": (
            "本轮实测：产品对 x_ticks 只有整体替换（core.py:919 / xticks.py:167），"
            "从无原地改，故浅拷贝对照组在当前产品内也不被污染 —— 这意味着 "
            "P4 对'浅拷贝 vs 深拷贝'**当前无判别力**；它只能证明"
            "'当前实现下改实时值不会污染历史'。深拷贝的价值是防未来新增原地改。"
        ),
    }


def probe_p6_shallow_hazard_is_real() -> dict:
    """P6 机制性判据：脱离产品，证明「浅拷贝确实有共享危险面」。

    为什么需要它：P4 对产品无判别力（产品从不原地改 x_ticks）。
    但深拷贝这次改动**并非无价值**——它消掉的是"将来任何人加一行原地改就中招"
    的隐患。这条判据把这个价值**脱离产品、用纯对象证明**，从而：
      · 不依赖产品是否存在触发路径；
      · 若有人日后把 deepcopy 改回浅拷贝，P3 会红，本条解释了"为什么那样危险"。

    判据：对同一份列数据，浅拷贝快照在四类原地改下**必须被污染**，
          深拷贝快照**必须全部隔离**。两者都成立才算通过。
    """
    import copy as _copy

    base = [{
        "id": "c0",
        "x_ticks": [{"px": 1, "value": 0.0}, {"px": 2, "value": 40.0}],
        "detected_ticks": [1, 2],
        "x_values": [0.0, 40.0],
        "control_points": {0: 10},
    }]
    mutations = {
        "x_ticks 原地改元素": lambda c: c["x_ticks"][0].__setitem__("value", 999.0),
        "detected_ticks 原地 append": lambda c: c["detected_ticks"].append(3),
        "x_values 原地改元素": lambda c: c["x_values"].__setitem__(0, 777.0),
        "control_points 原地改": lambda c: c["control_points"].__setitem__(0, 555),
    }

    def check(copier):
        polluted = []
        for label, fn in mutations.items():
            cols = _copy.deepcopy(base)
            snap = copier(cols)
            fn(cols[0])
            snap_col = snap[0]
            if label.startswith("x_ticks") and snap_col["x_ticks"][0]["value"] == 999.0:
                polluted.append(label)
            elif label.startswith("detected") and 3 in snap_col["detected_ticks"]:
                polluted.append(label)
            elif label.startswith("x_values") and snap_col["x_values"][0] == 777.0:
                polluted.append(label)
            elif label.startswith("control") and snap_col["control_points"][0] == 555:
                polluted.append(label)
        return polluted

    shallow_polluted = check(lambda cols: [dict(c) for c in cols])
    deep_polluted = check(lambda cols: [_copy.deepcopy(c) for c in cols])

    # 通过条件：浅拷贝四类全被污染；深拷贝一类都不被污染
    pass_ = (len(shallow_polluted) == 4) and (len(deep_polluted) == 0)
    return {
        "浅拷贝被污染项": shallow_polluted,
        "深拷贝被污染项": deep_polluted,
        "pass": pass_,
        "has_discriminating_power": True,
        "note": ("证明共享危险面真实存在（浅拷贝 4/4 被污染），"
                 "深拷贝 0/4。故 deepcopy 的价值是**防未来**新增原地改，"
                 "不是修了一个当前正在发生的缺陷。"),
    }


def run() -> dict:
    out: dict = {"probes": {}, "details": {}}

    # ================= 准备 =================
    s = build_calibrated_session()
    before_ticks = x_ticks_of(s)
    before_depth = stack_depth(s)
    calibrate_col0(s)
    after_ticks = x_ticks_of(s)
    after_depth = stack_depth(s)
    top_snap_ticks = stack_snapshot_x_ticks(s, 0)

    out["details"]["prepare"] = {
        "标定前 x_ticks": before_ticks,
        "标定前栈深": before_depth,
        "标定后 x_ticks": after_ticks,
        "标定后栈深": after_depth,
        "栈顶快照 col0.x_ticks": top_snap_ticks,
    }

    # ================= P3 机制性判据：快照彼此是否共享引用 =================
    # 栈顶（标定后记录）与次顶（标定前记录）里的 x_ticks 必须是不同对象。
    # 若 id 相同 -> 浅拷贝共享，后续观测迟早复发。
    st = getattr(s, "undo_stack", []) or []
    ids = []
    for snap in st[-3:]:
        cols = snap.get("columns") or []
        ids.append(id(cols[0].get("x_ticks")) if cols else None)
    shared_among_snapshots = len(set(i for i in ids if i is not None)) < len(
        [i for i in ids if i is not None]
    )
    # 与**实时列对象**的 x_ticks 比较：若栈顶快照与实时共享同一 list，改一个就动另一个
    live_ticks_obj = (s.columns[0].get("x_ticks") if s.columns else None)
    top_ticks_obj = None
    if st:
        cols = st[-1].get("columns") or []
        top_ticks_obj = cols[0].get("x_ticks") if cols else None
    shares_with_live = (
        live_ticks_obj is not None
        and top_ticks_obj is not None
        and id(live_ticks_obj) == id(top_ticks_obj)
    )
    out["probes"]["P3_快照独立性"] = {
        "snapshot_x_ticks_ids": ids,
        "多个快照共享同一 x_ticks 对象": shared_among_snapshots,
        "栈顶快照与实时列共享同一 x_ticks 对象": shares_with_live,
        "pass": (not shared_among_snapshots) and (not shares_with_live),
    }

    # ================= P1 第一次 undo =================
    r1 = s.history_undo()
    p1_ticks = x_ticks_of(s)
    out["probes"]["P1_首次undo后为None"] = {
        "undo_result": r1,
        "x_ticks_after_1st_undo": p1_ticks,
        "pass": p1_ticks is None,
    }

    # ================= P2 第二次 undo（关键：浅拷贝会把值带回来）=================
    # 判据说明：第二次 undo 回到更早的层，那一层可能是"无列"（ROI 创建时），
    # 也可能是有列但未标定。所以不能硬要求 `is None`（列不存在时取不到）。
    # 真正要防的是"第一次 undo 前的那个标定值串味回来"。
    depth_before_2nd = stack_depth(s)
    r2 = s.history_undo()
    p2_ticks = x_ticks_of(s)
    leaked = (p2_ticks == after_ticks)
    # 场景强度自评：若栈里从来没有"非空 x_ticks 快照"，本判据就测不到串味。
    nonempty_in_stack = [
        i for i, sn in enumerate(getattr(s, "undo_stack", []) or [])
        if ((sn.get("columns") or [{}])[0]).get("x_ticks")
    ]
    p2_strong = len(nonempty_in_stack) > 0
    out["probes"]["P2_二次undo后不串味"] = {
        "undo_stack_depth_before_2nd": depth_before_2nd,
        "undo_result": r2,
        "x_ticks_after_2nd_undo": p2_ticks,
        "标定值是否串味回来": leaked,
        "栈内非空快照下标": nonempty_in_stack,
        "pass": not leaked,
        "has_discriminating_power": p2_strong,
        "evidence_grade": "strong" if p2_strong else "weak",
        "note": ("浅拷贝的典型症状是把标定值带回来。"
                 "但本场景下栈内没有非空 x_ticks 快照可串，"
                 "故 pass 只说明该路径未观测到串味，不构成独立证据。"
                 if not p2_strong else
                 "栈内存在非空快照，本判据具备判别力。"),
    }

    # ================= P4 写后读：**原地改元素**才能命中共享引用 =================
    # 教训：本判据第一版写的是 `columns[0]["x_ticks"] = [新 list]`（整体替换），
    # 那只是把字段指向了另一个对象，原 list 不被触及，所以栈顶快照不受影响 ——
    # 判据假通过。共享引用的暴露方式是**原地修改 list 里的 dict**。
    # （这正是 S0 层要抓的"判据强度不足"：测的对象不是声称的对象。）
    out["probes"]["P4_写后读隔离"] = probe_p4_write_after_read()
    out["probes"]["P6_浅拷贝危险面（机制性）"] = probe_p6_shallow_hazard_is_real()

    # ================= P5 redo 往返：undo→redo 应回到标定后 =================
    s3 = build_calibrated_session()
    calibrate_col0(s3)
    calibrated = x_ticks_of(s3)
    s3.history_undo()
    after_undo = x_ticks_of(s3)
    s3.history_redo()
    after_redo = x_ticks_of(s3)
    out["probes"]["P5_redo往返"] = {
        "标定后": calibrated,
        "undo后": after_undo,
        "redo后": after_redo,
        "pass": (after_undo is None) and (after_redo == calibrated),
    }

    weak = [
        k for k, p in out["probes"].items()
        if p.get("pass") and p.get("has_discriminating_power") is False
    ]
    out["summary"] = {
        "all_pass": all(p.get("pass") for p in out["probes"].values()),
        "n_probes": len(out["probes"]),
        "failed": [k for k, p in out["probes"].items() if not p.get("pass")],
        # 通过但**无判别力**的项：它们不能作为"该机制已被验证"的证据
        "pass_but_weak_evidence": weak,
        "note": "pass_but_weak_evidence 里的项，其 PASS 只说明当前实现下未观测到问题，"
                "不说明该判据能区分正确与错误实现。",
    }
    return out


def main() -> int:
    as_json = "--json" in sys.argv
    U.hash_banner("B-06 Ctrl+Z 撤不回列标定（x_ticks）")
    r = run()

    if as_json:
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str))
        return 0 if r["summary"]["all_pass"] else 1

    print("\n--- 准备阶段 ---")
    for k, v in r["details"]["prepare"].items():
        print(f"    {k}: {v}")

    print("\n--- 判据 ---")
    for name, p in r["probes"].items():
        mark = "PASS" if p.get("pass") else "**FAIL**"
        print(f"\n  [{mark}] {name}")
        for k, v in p.items():
            if k == "pass":
                continue
            print(f"      {k}: {v}")

    print("\n" + "=" * 70)
    sm = r["summary"]
    if sm["all_pass"]:
        print(f"结论：{sm['n_probes']} 项全 PASS —— B-06 已修复")
    if sm.get("pass_but_weak_evidence"):
        print(f"注意：以下项 PASS 但**无判别力**：{sm['pass_but_weak_evidence']}")
        return 0
    print(f"结论：{sm['n_probes'] - len(sm['failed'])}/{sm['n_probes']} PASS，"
          f"失败项 = {sm['failed']}")
    if sm.get("pass_but_weak_evidence"):
        print(f"注意：以下项 PASS 但**无判别力**（浅拷贝对照组同样不被抓）："
              f"{sm['pass_but_weak_evidence']}")
        print("      它们只能证明'当前实现下未观测到问题'，不能证明"
              "'深拷贝 vs 浅拷贝'已被本探针区分。")
    print("这就是「照这个测会红」的对照，可作为 backend-fixer 的验收条件。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
