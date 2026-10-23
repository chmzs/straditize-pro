"""Lead 独立复核 F-2：切图后旧几何在新图上继续剔除墨迹（纯进程内，不依赖 bug-prober 的脚本）。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

s = StraditizeSession()
s._init_cleanup()

# ① 在 hoya 上做清理编辑
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
roi = s.rois[0]["id"]
s.detect_line_candidates(roi_id=roi)
cands = [c for c in s.line_candidates if c.get("roi_id") == roi]
if not cands:
    print("无候选，改用人工几何"); 
    s.upsert_line_geometry(roi_id=roi, axis="v", geometry={"type":"rect","x0":103,"y0":520,"x1":105,"y1":1300})
    cands = [c for c in s.line_candidates if c.get("roi_id") == roi]
target = max(cands, key=lambda c: c.get("width", 0))
s.set_line_geometry_status(candidate_id=target["id"], status="removed", roi_id=roi)
st = s.apply_line_removal(roi_id=roi)
print(f"① hoya 上确认 {target['id']}(width={target.get('width')}) 后 geometry_removed_pixels = {st['stats']['geometry_removed_pixels']}")

# ② 切图（真实用户路径：载入另一张图）
n_before = len(s.line_candidates)
s.load_image(sample_key="beginner")
new_roi = s.rois[0]["id"]
resid = [c for c in s.line_candidates if c.get("status") == "removed"]
print(f"② 切到 beginner: 尺寸={s.width}x{s.height} 新ROI id={new_roi!r}")
print(f"   残留几何={len(s.line_candidates)} 条（切图前 {n_before} 条），其中 status=removed={len(resid)} 条")
print(f"   残留 removed 条目: {[{'id':c['id'],'roi_id':c.get('roi_id')} for c in resid]}")
print(f"   ⚠️ 新 ROI id 与旧几何 roi_id 是否同名: {new_roi in {c.get('roi_id') for c in s.line_candidates}}")

# ③ 在新图上量测残留几何是否真的剔除墨迹
if resid:
    st2 = s.apply_line_removal(roi_id=new_roi)
    print(f"③ 新图上（带残留几何）: geometry_removed_pixels = {st2['stats']['geometry_removed_pixels']}")
    s.clear_cleanup_edits(roi_id=new_roi)
    st3 = s.apply_line_removal(roi_id=new_roi)
    print(f"   清空几何后            : geometry_removed_pixels = {st3['stats']['geometry_removed_pixels']}")
    print(f"   >>> 残留几何在新图上多剔除 = {st2['stats']['geometry_removed_pixels'] - st3['stats']['geometry_removed_pixels']} 像素")
else:
    print("③ 无残留 removed 几何")
