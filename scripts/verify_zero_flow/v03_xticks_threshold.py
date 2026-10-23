# -*- coding: utf-8 -*-
"""独立复核 C：journey F-4 / probes F-3 / static F-07 ——「重分列抹掉 x_ticks」三份报告
描述的是同一个缺陷，但判据描述互相矛盾。我用一个二维扫描把判据钉死。

三方说法：
- journey F-4：判据是**列数变化**（"20px 阈值是表象"）
- probes F-3：判据是**区间守卫越界 ≈ 列边界外 10px**（"阈值落在 (15,20)"），
  并称"列数一变（28→27）就整体丢弃"是另一档
- static F-07：判据是列数变化；并称"列数相同时守卫有效"

我的做法：不改几何、只沿左边界做**单维平移**，记录
(shift, 列数, col0.start, 守卫区间, x_ticks 存亡)，看哪一列信号先翻转。

运行：
    pixi run python scripts/verify_zero_flow/v03_xticks_threshold.py
"""
from __future__ import annotations

from vcommon import banner, hoya, isolate_config, new_session  # noqa: E402

CFG = isolate_config()
BASE_XLIM = (315, 1946)
BASE_YLIM = (511, 1311)


def calibrate_col0(s) -> dict:
    """用列自身的几何标定 col0（tickEndX 作为右端点），返回写入的 x_ticks。"""
    c = s.columns[0]
    ticks = [
        {"px": float(c["start"]), "value": 0.0},
        {"px": float(c["tickEndX"]), "value": 40.0},
    ]
    s.calibrate_column_xticks(0, ticks, "%")
    return s.columns[0]["x_ticks"]


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("C0. 基准（未移动）")
    s = hoya(new_session())
    n0 = len(s.columns)
    t0 = calibrate_col0(s)
    c0 = s.columns[0]
    print(f"  列数={n0}  col0.start={c0['start']}  col0.end={c0['end']}")
    print(f"  写入的 x_ticks = {t0}")

    banner("C1. 单维扫描：左边界右移 shift px，逐步回读")
    print(
        f"{'shift':>5} | {'列数':>6} | {'col0.start':>10} | {'col0.end':>9} | "
        f"{'守卫lo':>7} | {'守卫hi':>7} | {'px0入界':>7} | x_ticks"
    )
    print("-" * 96)

    rows = []
    for shift in (0, 4, 6, 8, 10, 12, 15, 18, 20, 22, 25, 30, 40):
        s = hoya(new_session(), (BASE_XLIM[0] + shift, BASE_XLIM[1]), BASE_YLIM)
        before_cols = s.columns
        n_before = n0
        # 先在 **基准几何** 上标定？不行——几何已变。所以每轮都先按当前几何标定，
        # 再对同一几何重分列一次，看的是"同一几何下的保全"。这与"标定后改 ROI 再分列"
        # 不同，故另起 C2 做真正的跨几何对照。
        calibrate_col0(s)
        n1 = len(s.columns)
        # 用同一 bounds 再分列一次（几何完全不变）
        s.detect_columns([BASE_XLIM[0] + shift, BASE_XLIM[1]], list(BASE_YLIM))
        col = s.columns[0]
        lo = min(col["start"], col["end"]) - 10
        hi = max(col["start"], col["end"]) + 10
        px0 = s.columns[0].get("x_ticks")
        # 标定前的 px0 是 shift 轮的 start
        px0_val = before_cols[0]["start"]
        in_guard = lo <= px0_val <= hi
        after = s.columns[0].get("x_ticks")
        rows.append((shift, n_before, n1, col["start"], col["end"], in_guard, after))
        print(
            f"{shift:>5} | {n_before:>3}->{n1:<2} | {col['start']:>10.1f} | "
            f"{col['end']:>9.1f} | {lo:>7.1f} | {hi:>7.1f} | {str(in_guard):>7} | "
            f"{'保留' if after else 'None'}"
        )

    banner("C2. 真正的跨几何对照：先在基准几何标定，再换几何重分列")
    print(
        f"{'shift':>5} | {'列数':>8} | {'col0.start':>10} | {'守卫lo':>7} | "
        f"{'刻度px0':>8} | {'入界':>5} | x_ticks"
    )
    print("-" * 90)
    for shift in (0, 6, 10, 15, 18, 20, 25, 30, 40, 85):
        s = hoya(new_session(), BASE_XLIM, BASE_YLIM)
        t = calibrate_col0(s)
        px0 = t[0]["px"]
        px1 = t[1]["px"]
        s.detect_columns([BASE_XLIM[0] + shift, BASE_XLIM[1]], list(BASE_YLIM))
        col = s.columns[0]
        n_after = len(s.columns)
        lo = min(col["start"], col["end"]) - 10
        hi = max(col["start"], col["end"]) + 10
        in_guard = lo <= px0 <= hi and lo <= px1 <= hi
        after = col.get("x_ticks")
        print(
            f"{shift:>5} | {n0:>3}->{n_after:<3} | {col['start']:>10.1f} | {lo:>7.1f} | "
            f"{px0:>8.1f} | {str(in_guard):>5} | "
            f"{'保留' if after else 'None'}"
        )

    banner("C3. 判定")
    print("  看 C2 的列数列与 x_ticks 列：若「第一次被抹」的那一行列数已经变了，")
    print("  则列数变化是**充分条件**；若存在「列数已变但仍保留」或「列数未变却被抹」，")
    print("  则列的判据不是列数，而是守卫。")
    # 程序化判定
    s = hoya(new_session(), BASE_XLIM, BASE_YLIM)
    calibrate_col0(s)
    found = []
    for shift in range(0, 90):
        s2 = hoya(new_session(), BASE_XLIM, BASE_YLIM)
        t = calibrate_col0(s2)
        px0, px1 = t[0]["px"], t[1]["px"]
        s2.detect_columns([BASE_XLIM[0] + shift, BASE_XLIM[1]], list(BASE_YLIM))
        col = s2.columns[0]
        lo = min(col["start"], col["end"]) - 10
        hi = max(col["start"], col["end"]) + 10
        after = col.get("x_ticks") is not None
        n_after = len(s2.columns)
        found.append((shift, n_after, lo, hi, px0, after, lo <= px0 <= hi and lo <= px1 <= hi))
    first_wipe = next((r for r in found if not r[5]), None)
    first_nchange = next((r for r in found if r[1] != n0), None)
    first_outguard = next((r for r in found if not r[6]), None)
    print(f"  首次 x_ticks 被抹: shift={first_wipe[0] if first_wipe else 'never'}"
          f"  (该行 列数={first_wipe[1]}, 守卫=[{first_wipe[2]:.0f},{first_wipe[3]:.0f}], px0={first_wipe[4]:.0f})"
          if first_wipe else "  首次 x_ticks 被抹: never")
    print(f"  首次列数变化     : shift={first_nchange[0] if first_nchange else 'never'}"
          f"  (列数={first_nchange[1]})" if first_nchange else "  首次列数变化: never")
    print(f"  首次越出守卫     : shift={first_outguard[0] if first_outguard else 'never'}"
          if first_outguard else "  首次越出守卫: never")
    # 反向检查：是否存在"列数变了但保留"
    bad = [r for r in found if r[1] != n0 and r[5]]
    print(f"  「列数已变但仍保留」的 shift 数 = {len(bad)}  {[r[0] for r in bad][:12]}")
    # 检查 27 列那一段到底是不是按 k 索引错配
    print("\n  补充：列数变 27 时，新 col0 的几何（是否整段错位）")
    s3 = hoya(new_session(), (355, 1946), BASE_YLIM)
    print(f"    28->{len(s3.columns)} 时 col0.start={s3.columns[0]['start']} "
          f"col0.end={s3.columns[0]['end']}（基准 col0 是 322..497）")


if __name__ == "__main__":
    main()
