# -*- coding: utf-8 -*-
"""E5: 步骤 6 自动提取是否用「编造的刻度值」写 x_ticks（InspectorBridge.ts:356-360）"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)

from straditize_core.session import StraditizeSession
s = StraditizeSession()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])

res = s.detect_xticks_rpc()
print("detect_xticks band =", res.get("band"))
pc = res.get("per_column", [])
print("per_column 条数 =", len(pc))
for item in pc[:6]:
    idx = item.get("column_index")
    ticks = item.get("ticks")
    col = s.columns[idx]
    # 复刻 InspectorBridge.ts:356-360 的取值逻辑
    val1 = 0                                    # col.x_ticks?.[0]?.value ?? 0
    val2 = (len(ticks) - 1) * 10 if len(ticks) > 2 else 20   # ?? maxPercent ?? ...
    p1 = col["start"]
    p2 = ticks[-1] if ticks else None
    print(f"  col{idx}: 检测到 {len(ticks)} 个刻度齿 -> 前端会写 value=[{val1}, {val2}] "
          f"(val2 由齿数推算 = ({len(ticks)}-1)*10 = {val2})  px=[{p1}, {p2}]")

# 真正落库
n = 0
for item in pc:
    idx = item["column_index"]; ticks = item["ticks"]; col = s.columns[idx]
    if len(ticks) >= 2:
        val1 = 0
        val2 = (len(ticks) - 1) * 10 if len(ticks) > 2 else 20
        s.calibrate_column_xticks(idx, [{"px": col["start"], "value": val1},
                                        {"px": ticks[-1], "value": val2}], col.get("unit") or "%")
        n += 1
print(f"\n自动写入了 {n} 列的 x_ticks（用户一次都没输入过读数）")

# 导出：这些编造值直接变成 CSV 里的百分比
out = s.export_data(format="csv")
print("\n导出列 =", out["columns"][:6], "...")
print("rows_count =", out["rows_count"])
print("\n前 3 行（注意值域来自 (齿数-1)*10 的编造上限）:")
for row in out["data"][:3]:
    print("  ", {k: v for k, v in list(row.items())[:5]})
