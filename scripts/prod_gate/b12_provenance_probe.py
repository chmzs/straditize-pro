# -*- coding: utf-8 -*-
"""B-12 + scale_provenance 探针：就绪清单的双向判据 + provenance 的动态性质。

## 为什么这两个放一个文件

Lead 给的判据方向是成对的：
  · B-12 有**反向要求**：零标定 → ready 不得为 True；全标定 → ready 必须为 True。
    只有一条绿都是错的（矫枉过正把 ready 改成永假，会误杀正常导出）。
  · provenance 有**动态要求**：五档 source 必须可区分，且**同一列改状态后 source 真的会变**。

两者都用"双向/动态"判据，不是静态读值。

## 关键设计：先验证动态性质，而不是静态读四个档位

Lead 的提醒（P4 那次教训）：
> 如果实现只是把 `resolve_column_scale` 的返回值复制出来而从不改变，
> 那四条断言可能都绿但 source 恒定。

所以本探针的主判据是 **D 系列（动态）**，静态档位覆盖只是辅助：

    D1  同一列：无标定(legacy/default) -> 树 x_ticks -> source 必须改变
    D2  同一列：改 x_ticks -> source 仍为 x_ticks，但 val0/val1 必须跟着变
        （防止"source 写了但值没接上"的假实现）
    D3  同一列：从 x_ticks 清回 legacy -> source 必须变回去
    D4  跨列：同一 session 里不同状态的列应给出不同 source（至少 2 种）

**D1 是最关键的**：它一次就能证伪"source 恒定"的假实现。

## 用法

    pixi run python scripts/prod_gate/b12_provenance_probe.py
    pixi run python scripts/prod_gate/b12_provenance_probe.py --json
"""
from __future__ import annotations

import json
import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

from straditize_core.session import StraditizeSession  # noqa: E402
from straditize_core.session_parts.xscale import resolve_column_scale  # noqa: E402

SOURCE_DOMAIN = {
    "group",      # 组 tick_layout + 列 x_values（D1 设计）
    "x_ticks",    # 显式两点刻度（当前主路径）
    "x_scales",   # session.x_scales 斜率/截距
    "legacy",     # startValue/tickValue/tickEndX 三件套
    "default",    # 什么都没有
}


# ---------------------------------------------------------------------------
# 会话构造
# ---------------------------------------------------------------------------
def sess_columns_only() -> StraditizeSession:
    """只分列，不标定任何列 —— 期望每列 source 落在 legacy/default。"""
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.extract_foreground()
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    return s


def calibrate(s, idx: int, v1: float = 40.0) -> None:
    c = s.columns[idx]
    lo = c["start"] + (c["end"] - c["start"]) * 0.2
    hi = c["start"] + (c["end"] - c["start"]) * 0.8
    s.calibrate_column_xticks(
        c["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": v1}], unit="%"
    )


def src_of(s, idx: int) -> dict:
    c = s.columns[idx]
    sc = resolve_column_scale(s, c, idx)
    return {
        "source": sc.source,
        "calibrated": sc.calibrated,
        "val0": sc.val0,
        "val1": sc.val1,
        "px0": round(sc.abs_px0, 3),
        "px1": round(sc.abs_px1, 3),
    }


# ---------------------------------------------------------------------------
# B-12：就绪清单的双向判据
# ---------------------------------------------------------------------------
def check_b12() -> dict:
    out: dict = {"probes": {}, "details": {}}

    # ---- 正向：零标定会话，ready 不得为 True ----
    s0 = sess_columns_only()
    rd0 = s0.get_export_readiness()
    per0 = [src_of(s0, i) for i in range(len(s0.columns))]
    n_cal0 = sum(1 for p in per0 if p["calibrated"])
    sources0 = sorted({p["source"] for p in per0})
    out["details"]["零标定会话"] = {
        "列数": len(s0.columns),
        "真正 calibrated 列数": n_cal0,
        "source 分布": sources0,
        "readiness": {k: rd0.get(k) for k in
                      ("ready", "readiness_missing", "total_rois")},
    }
    out["probes"]["B12a_零标定不得ready"] = {
        "readiness_ready": rd0.get("ready"),
        "真实calibrated": f"{n_cal0}/{len(s0.columns)}",
        "pass": rd0.get("ready") is not True,
        "note": "零标定却 ready=True 即为 B-12 原缺陷",
    }

    # ---- 反向：全部列标定，ready 必须为 True（防矫枉过正） ----
    s1 = sess_columns_only()
    for i in range(len(s1.columns)):
        try:
            calibrate(s1, i, 40.0)
        except Exception:
            pass
    rd1 = s1.get_export_readiness()
    per1 = [src_of(s1, i) for i in range(len(s1.columns))]
    n_cal1 = sum(1 for p in per1 if p["calibrated"])
    out["details"]["全标定会话"] = {
        "列数": len(s1.columns),
        "真正 calibrated 列数": n_cal1,
        "source 分布": sorted({p["source"] for p in per1}),
        "readiness": {k: rd1.get(k) for k in
                      ("ready", "readiness_missing", "total_rois")},
    }
    out["probes"]["B12b_全标定必须ready"] = {
        "readiness_ready": rd1.get("ready"),
        "真实calibrated": f"{n_cal1}/{len(s1.columns)}",
        "pass": (rd1.get("ready") is True) and (n_cal1 == len(s1.columns)),
        "note": "矫枉过正（改成永假）会在这里失败",
    }

    # ---- 部分标定：ready 应为 False 或带明确 provenance（两者都可接受，但必须可判） ----
    s2 = sess_columns_only()
    calibrate(s2, 0, 40.0)
    rd2 = s2.get_export_readiness()
    n_cal2 = sum(1 for i in range(len(s2.columns)) if src_of(s2, i)["calibrated"])
    has_prov = any(
        k in rd2 for k in ("provenance", "calibrated_count", "uncalibrated_count", "columns")
    )
    out["details"]["部分标定会话"] = {
        "列数": len(s2.columns),
        "真正 calibrated 列数": n_cal2,
        "readiness": {k: rd2.get(k) for k in
                      ("ready", "readiness_missing", "total_rois")},
        "是否带 provenance 字段": has_prov,
    }
    out["probes"]["B12c_部分标定须可判"] = {
        "readiness_ready": rd2.get("ready"),
        "真实calibrated": f"{n_cal2}/{len(s2.columns)}",
        "带provenance": has_prov,
        "pass": (rd2.get("ready") is not True) or has_prov,
        "note": "部分标定：要么 ready=False，要么 ready=True 但必须给出 provenance 说清缺哪些",
    }
    return out


# ---------------------------------------------------------------------------
# provenance：动态性质（主判据）
# ---------------------------------------------------------------------------
def check_provenance_dynamic() -> dict:
    out: dict = {"probes": {}, "details": {}}

    # ---- D1：同一列，无标定 -> 标定，source 必须改变（核心判据）----
    s = sess_columns_only()
    before = src_of(s, 0)
    calibrate(s, 0, 40.0)
    after = src_of(s, 0)
    out["details"]["D1"] = {"before": before, "after": after}
    out["probes"]["D1_改状态后source必须变"] = {
        "before_source": before["source"],
        "after_source": after["source"],
        "pass": before["source"] != after["source"],
        "note": ("最关键：一次就能证伪『source 恒定』的假实现。"
                 "若实现只是复制 resolve_column_scale 的返回值而状态变了它不变，这里红。"),
    }

    # ---- D2：改 x_ticks 的值，source 保持 x_ticks 但 val1 必须跟着变 ----
    s2 = sess_columns_only()
    calibrate(s2, 0, 40.0)
    v_a = src_of(s2, 0)
    calibrate(s2, 0, 80.0)   # 同一列再标定，换成 80
    v_b = src_of(s2, 0)
    out["details"]["D2"] = {"40": v_a, "80": v_b}
    out["probes"]["D2_值必须接上"] = {
        "source_40": v_a["source"], "source_80": v_b["source"],
        "val1_40": v_a["val1"], "val1_80": v_b["val1"],
        "pass": (v_b["source"] == "x_ticks") and (v_a["val1"] != v_b["val1"]),
        "note": "防止『source 写了但值没接上』的假实现",
    }

    # ---- D3：清回 legacy，source 必须变回去 ----
    s3 = sess_columns_only()
    calibrate(s3, 0, 40.0)
    mid = src_of(s3, 0)
    # 清掉 x_ticks，退回 legacy
    if "x_ticks" in s3.columns[0]:
        s3.columns[0].pop("x_ticks", None)
    s3.columns[0]["startValue"] = 0.0
    s3.columns[0]["tickValue"] = 20.0
    back = src_of(s3, 0)
    out["details"]["D3"] = {"after_calib": mid, "after_clear": back}
    out["probes"]["D3_清回legacy须变回"] = {
        "after_calib_source": mid["source"],
        "after_clear_source": back["source"],
        "pass": mid["source"] != back["source"],
        "note": "source 必须随状态双向变化，不能单向只增",
    }

    # ---- D4：同一 session 里不同状态的列，source 至少 2 种 ----
    s4 = sess_columns_only()
    calibrate(s4, 0, 40.0)
    raw_idx = 1
    srcs = sorted({src_of(s4, 0)["source"], src_of(s4, raw_idx)["source"]})
    out["details"]["D4"] = {"col0": src_of(s4, 0), f"col{raw_idx}": src_of(s4, raw_idx)}
    out["probes"]["D4_同会话多档并存"] = {
        "sources": srcs,
        "pass": len(srcs) >= 2,
        "note": "同一会话里已标定列与未标定列必须给出不同 source",
    }

    # ---- D5（辅助）：五档取值是否都在 SOURCE_DOMAIN 内，且 x_ticks 可实际触达 ----
    s5 = sess_columns_only()
    calibrate(s5, 0, 40.0)
    observed = set()
    for i in range(min(3, len(s5.columns))):
        observed.add(src_of(s5, i)["source"])
    out["probes"]["D5_source取值域自证"] = {
        "声明域": sorted(SOURCE_DOMAIN),
        "本场景观测到": sorted(observed),
        "都在域内": observed <= SOURCE_DOMAIN,
        "pass": observed <= SOURCE_DOMAIN,
        "note": "只保证观测到的 source 都在声明域内；不要求一次跑遍五档",
    }
    return out


# ---------------------------------------------------------------------------
# D6：provenance 是否**真的下发到前端**（走真实 RPC 载荷，而非读内部函数）
# ---------------------------------------------------------------------------
def check_provenance_over_rpc() -> dict:
    """D1–D5 读的是 resolve_column_scale（内部函数）。但用户看不到内部函数。

    必须验证 provenance 出现在前端真正消费的那份载荷里
    （`straditize.getDiagramData` 的 columns[]）。
    否则可能出现「内部算得对、前端永远拿不到」——这也是 C1e 那类
    "改对了但没接上出口"的形态。
    """
    out: dict = {"probes": {}, "details": {}}
    from straditize_core.rpc_methods.system import register

    s = sess_columns_only()
    calibrate(s, 0, 40.0)

    # 用真实 dispatcher 跑一次 getDiagramData，拿"前端会收到的"那份
    captured = {}

    class FakeDispatcher:
        def __init__(self):
            self._methods = {}

        def register_method(self, name, fn):
            self._methods[name] = fn

    d = FakeDispatcher()
    register(d, s)
    fn = d._methods.get("straditize.getDiagramData")
    if fn is None:
        out["probes"]["D6_provenance须下发"] = {
            "pass": False, "note": "未注册 straditize.getDiagramData，无法验证下发路径",
        }
        return out
    payload = fn()
    cols = (payload or {}).get("columns") or []
    captured["n_cols"] = len(cols)
    col0 = cols[0] if cols else {}
    keys = sorted(col0.keys())
    # provenance 可能叫 scale_provenance，也可能只下发 calibrated/source 两个平铺字段
    has_prov_obj = "scale_provenance" in col0
    has_flat = ("calibrated" in col0) or ("scale_source" in col0) or ("source" in col0)
    prov = col0.get("scale_provenance") if has_prov_obj else None

    out["details"]["D6"] = {
        "payload 列数": captured["n_cols"],
        "首列 keys": keys,
        "含 scale_provenance": has_prov_obj,
        "含平铺 source/calibrated": has_flat,
        "scale_provenance 内容": prov,
    }
    out["probes"]["D6_provenance须下发"] = {
        "含 scale_provenance": has_prov_obj,
        "含平铺 source/calibrated": has_flat,
        "pass": has_prov_obj or has_flat,
        "note": ("D1–D5 证明内部算得对；本项证明它**到了前端**。"
                 "两者都绿才算 provenance 真的可用。"),
    }

    # D7：下发的 provenance 必须随状态改变（不是在 payload 层写死）
    s2 = sess_columns_only()
    before_prov = None
    d2 = FakeDispatcher()
    register(d2, s2)
    p_before = d2._methods["straditize.getDiagramData"]()
    c_before = ((p_before or {}).get("columns") or [{}])[0]
    calibrate(s2, 0, 40.0)
    d3 = FakeDispatcher()
    register(d3, s2)
    p_after = d3._methods["straditize.getDiagramData"]()
    c_after = ((p_after or {}).get("columns") or [{}])[0]

    def prov_of(c):
        if "scale_provenance" in c:
            return json.dumps(c["scale_provenance"], sort_keys=True)
        return json.dumps([c.get("calibrated"), c.get("scale_source"), c.get("source")])

    out["details"]["D7"] = {"before": prov_of(c_before), "after": prov_of(c_after)}
    out["probes"]["D7_下发值须随状态变"] = {
        "before": prov_of(c_before),
        "after": prov_of(c_after),
        "pass": prov_of(c_before) != prov_of(c_after),
        "note": "在 payload 层写死 provenance 会在这里红",
    }
    return out


# ---------------------------------------------------------------------------
# D8：x_ticks_dropped 的不可变性（B-02 新机制，与 B-06 浅拷贝同类风险）
# ---------------------------------------------------------------------------
def check_dropped_immutability() -> dict:
    """B-02 修复把"丢了什么刻度"记在 `col["x_ticks_dropped"]` 上，并声称值不可变
    （px/band 用 tuple）以抵御撤销栈的浅拷贝。

    这是与 B-06 同源的隐患面，且是新机制、此前无人验证。判据：
      D8a  真能触发 x_ticks_dropped（否则后续判据测的是空）
      D8b  其内部容器必须是不可变类型（tuple），不能被就地污染
      D8c  即使外层 dict 与快照共享，原地改"看似可变"的地方也不得成功
    """
    out: dict = {"probes": {}, "details": {}}
    s = sess_columns_only()
    calibrate(s, 0, 40.0)
    rid = s.rois[0]["id"]
    # 重分列使旧刻度越界 -> 触发 dropped
    s.detect_columns([315, 1946 + 400], [511, 1311], roi_id=rid)
    d = s.columns[0].get("x_ticks_dropped")
    out["details"]["D8"] = {"x_ticks_dropped": d}
    out["probes"]["D8a_能触发dropped"] = {
        "value": d,
        "pass": isinstance(d, dict) and bool(d),
        "note": "触发不了则 D8b/D8c 测的是空气（P4 那次教训）",
    }
    if not isinstance(d, dict) or not d:
        out["probes"]["D8b_内部容器不可变"] = {"pass": False, "note": "前置未满足"}
        out["probes"]["D8c_共享也不可污染"] = {"pass": False, "note": "前置未满足"}
        return out

    px, band = d.get("px"), d.get("band")
    immut = isinstance(px, tuple) and isinstance(band, tuple)
    out["probes"]["D8b_内部容器不可变"] = {
        "px_type": type(px).__name__, "band_type": type(band).__name__,
        "pass": immut,
        "note": "注释声称用 tuple 抵御浅拷贝共享；此处验证该声称成立",
    }

    # D8c：外层 dict 与快照共享（浅拷贝的必然结果），但内部 tuple 无法就地改
    snap = [dict(c) for c in s.columns]
    shares = snap[0].get("x_ticks_dropped") is s.columns[0].get("x_ticks_dropped")
    try:
        px[0] = 999.0          # tuple 应抛 TypeError
        polluted = True
    except TypeError:
        polluted = False
    snap_val = snap[0]["x_ticks_dropped"].get("px")
    out["probes"]["D8c_共享也不可污染"] = {
        "快照与活动列共享同一 droppped dict": shares,
        "尝试就地改 px[0] 是否成功": polluted,
        "快照里的 px 值仍为": snap_val,
        "pass": (not polluted) and (snap_val == px),
        "note": "即使外层共享，内部不可变 -> 快照不会被污染。"
                "（若有人把 tuple 改回 list，本项会红）",
    }
    return out


def main() -> int:
    as_json = "--json" in sys.argv
    U.hash_banner("B-12 就绪清单双向 + provenance 动态性质")

    b12 = check_b12()
    prov = check_provenance_dynamic()
    rpc = check_provenance_over_rpc()
    drop = check_dropped_immutability()
    merged = {
        "b12": b12,
        "provenance": prov,
        "rpc": rpc,
        "dropped": drop,
        "probes": {**b12["probes"], **prov["probes"], **rpc["probes"],
                   **drop["probes"]},
        "details": {**b12["details"], **prov["details"], **rpc["details"],
                    **drop["details"]},
    }
    failed = [k for k, p in merged["probes"].items() if not p.get("pass")]
    merged["summary"] = {
        "n_probes": len(merged["probes"]),
        "failed": failed,
        "all_pass": len(failed) == 0,
    }

    if as_json:
        print(json.dumps(merged, ensure_ascii=False, indent=2, default=str))
        return 0 if merged["summary"]["all_pass"] else 1

    for grp, label in ((b12, "B-12 就绪清单（双向判据）"),
                       (prov, "scale_provenance（动态判据）"),
                       (rpc, "scale_provenance 下发（走真实 RPC 载荷）"),
                       (drop, "x_ticks_dropped 不可变性（B-02 新机制）")):
        print(f"\n{'=' * 70}\n{label}\n{'=' * 70}")
        print("* 会话状态明细：")
        for k, v in grp["details"].items():
            print(f"    {k}: {json.dumps(v, ensure_ascii=False)}")
        print("* 判据：")
        for name, p in grp["probes"].items():
            mark = "PASS" if p.get("pass") else "**FAIL**"
            print(f"\n  [{mark}] {name}")
            for k, v in p.items():
                if k == "pass":
                    continue
                print(f"      {k}: {v}")

    print("\n" + "=" * 70)
    sm = merged["summary"]
    if sm["all_pass"]:
        print(f"结论：{sm['n_probes']} 项全 PASS")
        return 0
    print(f"结论：{sm['n_probes'] - len(sm['failed'])}/{sm['n_probes']} PASS，"
          f"失败 = {sm['failed']}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
