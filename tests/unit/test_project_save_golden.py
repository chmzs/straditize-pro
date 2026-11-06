# -*- coding: utf-8 -*-
"""`project_save` 输出快照（重构前行为基线）。

## 为什么需要它

`project_save` 282 行：标定 → ROI → 列/控制点 → 年代-深度 → 组装 project_json →
写 .json / 打 .tar（manifest、straditize.json、两张图、data.csv、plot_strat.R、README）。
它是 `project_load` 的对偶，也是**用户交付物的唯一出口**：少一个键、少一个
tar 成员、csv 从真实导出悄悄退回占位表，界面都不会报错，用户要到打开导出包才发现。

现有测试只覆盖 xlsx / detect_columns / 载入侧，保存侧一个字段级判据都没有。

## 钉的是什么

同一个会话（由 `test_project_load_golden` 的老包载荷载入而来）跑三条保存路径：

1. `json_inline`：`format='json'` 不带路径 → 返回 `data` 字典（整份 payload 逐字段）；
2. `json_file`：带路径 → 落盘文件内容 + 返回体（内嵌 base64 换成摘要，避免库文件里塞几百 KB）；
3. `tar_members`：带路径 → tar 成员清单，逐个 {名字, 字节数, 内容摘要}；manifest.json 剔除
   时间戳后再比对（时间戳天生不稳定，留着会让基线随机变红）。

## 占位表必须显式（2026-11-06）

合成载荷的列数字化不出来，data.csv 会退化成「每格 0.00」的占位表。这种表长得跟合法数据一样，
README 里那句「unobserved = 0.0」还会替它背书。现在三处落痕：

1. manifest.json 增加 data_csv_placeholder 字段（含失败原因）；
2. tar 里紧跟一份 data.csv.PLACEHOLDER.md（人读）；
3. project_save 返回值带 data_csv_placeholder / data_csv_placeholder_reason（程序读）。

本文件同时钉**反向对照** tar_real_csv：真实取数成功时 flag 必须是 false、成员里不得出现说明文件。
只用合成载荷时，「标记住」和「没标记」两种情况永远只见到一种。

## 重新生成

    UPDATE_PROJECT_SAVE_GOLDEN=1 pixi run python -m pytest tests/unit/test_project_save_golden.py
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import tarfile
from pathlib import Path
from typing import Any

from straditize_core.session import StraditizeSession

from test_project_load_golden import _legacy_payload

GOLDEN = Path(__file__).parent / "fixtures" / "project_save_golden.json"


def _digest(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()[:12]


def _normalise(value: Any) -> Any:
    """base64 / 浮点 / 字典键序收敛成可稳定比较的形状。"""
    if isinstance(value, dict):
        return {key: _normalise(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [_normalise(item) for item in value]
    if isinstance(value, str) and len(value) > 256:
        return f"<b64:{_digest(value)}:{len(value)}>"
    if isinstance(value, float):
        return round(value, 6)
    return value


def _session() -> StraditizeSession:
    """载入老包载荷后的会话：有图、有标定、有列、有年代-深度。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.project_load(_legacy_payload())
    return session


def _strip_base64(payload: dict) -> dict:
    """去掉内嵌图，剩下的部分必须与不带路径的 payload 完全一致。"""
    clone = json.loads(json.dumps(payload))
    image = clone.get("image")
    if isinstance(image, dict):
        image.pop("base64", None)
    age_depth = clone.get("age_depth")
    if isinstance(age_depth, dict):
        age_depth.pop("image_base64", None)
    return clone


def _build_snapshots(tmp_dir: Path) -> dict:
    out: dict[str, Any] = {}

    session = _session()
    inline = session.project_save(format="json")
    out["json_inline"] = {
        "result_keys": sorted(inline),
        "data": _normalise(inline["data"]),
    }

    session = _session()
    json_path = tmp_dir / "pack.json"
    file_result = session.project_save(output_path=str(json_path), format="json")
    written = json.loads(json_path.read_text(encoding="utf-8"))
    out["json_file"] = {
        "result_keys": sorted(file_result),
        "result_success": file_result["success"],
        "file_embeds_png": bool(written["image"].get("base64")),
        "file_embeds_age_depth_png": bool(
            (written.get("age_depth") or {}).get("image_base64")
        ),
        # 去掉内嵌图之后，落盘文件与内存 payload 必须逐字段相同
        "stripped_equals_inline_data": _normalise(_strip_base64(written))
        == out["json_inline"]["data"],
        "file": _normalise(written),
    }

    session = _session()
    tar_path = tmp_dir / "pack.tar"
    tar_result = session.project_save(output_path=str(tar_path), format="tar")
    members = []
    with tarfile.open(tar_path, "r") as archive:
        for member in archive.getmembers():
            raw = archive.extractfile(member).read()
            if member.name == "manifest.json":
                parsed = json.loads(raw)
                parsed.pop("timestamp", None)
                members.append(
                    {"name": member.name, "manifest_without_timestamp": parsed}
                )
            else:
                members.append(
                    {
                        "name": member.name,
                        "size": member.size,
                        "digest": _digest(raw),
                    }
                )
    out["tar_members"] = {
        "result_keys": sorted(tar_result),
        "result_size_matches_file": tar_result["size"] == tar_path.stat().st_size,
        "members": members,
    }

    # 对照：真实取数成功时**不得**出现占位标记，也不得出现说明文件。
    # 只用合成载荷（不能数字化）时，"标记住"和"没标记"两种情况永远只见到一种。
    real_session = StraditizeSession()
    real_session._init_cleanup()
    real_session.load_image(image_path="tests/data/figures/real_plates/fig3_raw.jpeg")
    real_session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    for column in real_session.columns:
        real_session.digitize(column["col_index"])
    real_tar = tmp_dir / "real-pack.tar"
    real_result = real_session.project_save(output_path=str(real_tar), format="tar")
    with tarfile.open(real_tar, "r") as archive:
        real_csv = archive.extractfile("data.csv").read()
        real_members = archive.getnames()
    out["tar_real_csv"] = {
        "result_keys": sorted(real_result),
        "placeholder_flag": real_result["data_csv_placeholder"],
        "placeholder_reason": real_result["data_csv_placeholder_reason"],
        "members": real_members,
        "data_csv_size": len(real_csv),
        "data_csv_head": real_csv.decode("utf-8").splitlines()[:2],
    }

    # 无路径的 tar 走 base64 返回：只钉成员清单，不钉整包摘要（含 mtime）
    session = _session()
    mem_tar = session.project_save(format="tar")
    with tarfile.open(fileobj=io.BytesIO(__import__("base64").b64decode(mem_tar["tar_base64"]))) as archive:
        out["tar_base64"] = {
            "result_keys": sorted(mem_tar),
            "member_names": [m.name for m in archive.getmembers()],
        }

    # data.csv 分支：先按真实路径数字化，再钉一次 tar 里的 CSV。
    # 本合成载荷的列无法真实数字化（digitize 抛错），故这里钉住的其实是占位表分支；
    # 真实 CSV 导出由 export 系列测试覆盖，本文件只负责"打包进 tar 的是哪一份"。
    session = _session()
    digitized = True
    try:
        for column in session.columns:
            session.digitize(column["col_index"])
    except Exception:  # noqa: BLE001 —— 数字化是否成功本身也要钉进基线
        digitized = False
    real_csv_tar = tmp_dir / "pack_realcsv.tar"
    session.project_save(output_path=str(real_csv_tar), format="tar")
    with tarfile.open(real_csv_tar, "r") as archive:
        csv_member = archive.extractfile("data.csv")
        csv_raw = csv_member.read() if csv_member is not None else b""
    out["tar_csv_branch"] = {
        "digitized": digitized,
        "data_csv": {"size": len(csv_raw), "digest": _digest(csv_raw)},
        "data_csv_head": csv_raw.decode("utf-8").splitlines()[:3],
    }

    return out


def test_project_save_output_snapshot_is_stable(tmp_path) -> None:
    snapshot = _build_snapshots(tmp_path)

    if os.environ.get("UPDATE_PROJECT_SAVE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_PROJECT_SAVE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys()
    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 输出变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:2000]}\n"
            f"expected = "
            f"{json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:2000]}"
        )
