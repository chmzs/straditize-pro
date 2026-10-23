# -*- coding: utf-8 -*-
"""`project_load` 必须把工程包里的底图真正换上来（C1d）。

## 缺陷本体

`project_load` 的自包含 `.json` 分支里原本有个守卫
`and getattr(self, "image", None) is None`：**会话里已经有图时整段跳过**。
于是列 / 标定 / ROI 全换成包里的，底图还是上一张——之后所有读数都基于
错误的图像像素，而界面看起来完全正常。实测：会话 900x700 + 包 400x300，
载入后仍是 900x700。

这是"看起来正常的错位"，比会报错的缺陷更危险：用户没有任何信号。

## 那个守卫的原始意图（查证过，不是猜的）

`git log -S 'img_meta.get("base64")'` 追到 `af7ce98`，那里的注释是
`Restore embedded images (if loading from self-contained .json)` ——
说的是"没有图时才需要从包里恢复"，不是"要保护用户当前的图"。
没有任何调用点依赖那个保护。所以正确语义是：

- payload **带** base64 → 无条件替换（包里的图才是工程的一部分）；
- payload **不带** base64 → 保持当前底图（不是清空）。这条是有意行为：
  `.tar` 的 json 成员只写 `image.path`，图在 tar 的另一个成员里、
  由 tar 分支先解出来，此时无 base64 属正常。

## 顺序约束（实测，不是推断）

设图块在 rois / columns 读取**之后**。故这里只清"由像素算出"的状态，
不碰 rois / columns / x_ticks。`test_payload_rois_survive_image_replacement`
就是钉这一点——否则修一个 bug 造两个。

## 双向验收

本文件四个角度全钉：空白会话要换、已有图会话**也必须**换、
无 base64 时不许弄没、tar 与 json 两条路径结果一致。
"""
from __future__ import annotations

import hashlib
import io
import json

import numpy as np
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession

PACK_SIZE = (400, 300)
SESSION_SIZE = (900, 700)


def _png(size: tuple[int, int], color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _fingerprint(image: Image.Image) -> str:
    return hashlib.sha256(image.tobytes()).hexdigest()[:12]


def _source_session() -> StraditizeSession:
    """造一个"带底图 + ROI + 已分列"的会话，用作工程包来源。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.image_path = "upload://pack-figure.png"
    session.image = Image.open(io.BytesIO(_png(PACK_SIZE, (255, 0, 0))))
    session.image.load()
    session.width, session.height = session.image.size
    session.format = "PNG"
    session.mode = "RGB"
    session.roi_create(name="pollen", x0=10, x1=380, y0=10, y1=280)
    session.detect_columns([20, 380], [20, 280], roi_id=session.rois[0]["id"])
    return session


def _json_payload(session: StraditizeSession, tmp_path, with_image: bool) -> dict:
    """写一份 .json 工程并读回。

    `with_image=False` 用内存版 payload（`project_save(format="json")` 不带
    `output_path` 时不内嵌 base64），模拟"工程包没带图"的情形。
    """
    if with_image:
        target = tmp_path / "pack.json"
        session.project_save(output_path=str(target), format="json")
        return json.loads(target.read_text(encoding="utf-8"))
    saved = session.project_save(format="json")
    return saved["data"]


def _session_with_other_image() -> StraditizeSession:
    """模拟真实常态：用户先看了张图，再打开工程包。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.image_path = "upload://someone-elses-figure.png"
    session.image = Image.open(io.BytesIO(_png(SESSION_SIZE, (0, 0, 255))))
    session.image.load()
    session.width, session.height = session.image.size
    return session


class TestEmbeddedImageIsReplaced:
    def test_blank_session_loads_the_pack_image(self, tmp_path) -> None:
        """对照组：空白会话本来就能载入（回归保护）。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)

        session = StraditizeSession()
        session._init_cleanup()
        session.project_load(payload)

        assert session.image is not None
        assert session.image.size == PACK_SIZE
        assert _fingerprint(session.image) == _fingerprint(source.image)

    def test_session_with_existing_image_is_replaced(self, tmp_path) -> None:
        """缺陷主钉：会话已有底图时，**也必须**换成包里的图。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)
        session = _session_with_other_image()
        assert session.image.size == SESSION_SIZE, "前置：会话里应是另一张图"

        session.project_load(payload)

        assert session.image.size == PACK_SIZE, (
            f"载入工程包后底图仍是 {session.image.size}，包的图是 {PACK_SIZE} —— "
            "列/标定/ROI 来自包里、底图却是上一张，所有读数都基于错图像素（C1d）"
        )
        assert _fingerprint(session.image) == _fingerprint(source.image), (
            "底图尺寸对了但内容不是包里的图"
        )

    def test_payload_without_image_keeps_current_backdrop(self, tmp_path) -> None:
        """有意行为：payload 不带 base64 时保持当前底图，绝不弄没。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=False)
        assert not payload["image"].get("base64"), "前置：该 payload 不应内嵌图"

        session = _session_with_other_image()
        before = _fingerprint(session.image)

        session.project_load(payload)

        assert session.image is not None, (
            "不带 base64 的 payload 把底图弄没了 —— 用户会看到空白画布"
        )
        assert session.image.size == SESSION_SIZE
        assert _fingerprint(session.image) == before

    def test_decoded_size_wins_over_payload_metadata(self, tmp_path) -> None:
        """尺寸以真实解码为准：payload 里被改过的 width/height 不得生效。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)
        payload["image"]["width"] = 12345
        payload["image"]["height"] = 6789

        session = _session_with_other_image()
        session.project_load(payload)

        assert session.image.size == PACK_SIZE
        assert (session.width, session.height) == PACK_SIZE, (
            "width/height 采信了 payload 里的数字而不是真实解码结果，"
            "会让 ROI / 列坐标整体错位"
        )


class TestPayloadStateSurvivesImageReplacement:
    """换图的实现位置不能把包里读出来的状态冲掉（否则修一个 bug 造两个）。"""

    def test_payload_rois_survive_image_replacement(self, tmp_path) -> None:
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)
        expected_rois = [(r["id"], r["xlim"], r["ylim"]) for r in payload["rois"]]

        session = _session_with_other_image()
        session.project_load(payload)

        actual = [(r["id"], r["xlim"], r["ylim"]) for r in session.rois]
        assert actual == expected_rois, (
            "换底图把包里读出来的 ROI 冲掉了 —— 设图逻辑必须留在读取 rois 之后"
        )

    def test_payload_columns_and_data_bounds_survive(self, tmp_path) -> None:
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)
        expected_column_count = len(payload["columns"])
        assert expected_column_count > 0, "前置：包里应有列"

        session = _session_with_other_image()
        session.project_load(payload)

        assert len(session.columns) == expected_column_count
        assert session.data_xlim == [20.0, 380.0]
        assert session.data_ylim == [20.0, 280.0]

    def test_pixel_derived_state_is_invalidated(self, tmp_path) -> None:
        """上一张图的像素产物必须失效：尺寸不同，留着会在布尔运算里炸或被误报。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)

        session = _session_with_other_image()
        session.foreground_mask = None
        session.extract_foreground()
        assert session.foreground_mask is not None, "前置：应产出前景掩膜"
        assert session.foreground_mask.shape == (
            SESSION_SIZE[1],
            SESSION_SIZE[0],
        ), "前置：掩膜应是旧图尺寸"

        session.project_load(payload)

        assert session.foreground_mask is None, (
            "换底图后旧 foreground_mask 仍在 —— 它以旧图尺寸参与新图计算"
        )
        assert session.image_array is None, "旧 image_array 会被当成新图的像素源"
        assert session.shadow_mask is None
        assert session.solid_layers is None
        assert session.tick_band is None


class TestBothLoadPathsAgree:
    """`.tar` 与 `.json` 是同一功能的两条路径，行为必须一致。"""

    @pytest.mark.parametrize("preexisting_image", [False, True])
    def test_tar_and_json_produce_the_same_backdrop(
        self, tmp_path, preexisting_image: bool
    ) -> None:
        source = _source_session()
        tar_path = tmp_path / "pack.tar"
        source.project_save(output_path=str(tar_path), format="tar")
        json_payload = _json_payload(source, tmp_path, with_image=True)
        expected = _fingerprint(source.image)

        def load_and_fingerprint(payload_or_path) -> str:
            session = (
                _session_with_other_image()
                if preexisting_image
                else _new_blank_session()
            )
            session.project_load(payload_or_path)
            assert session.image is not None
            return _fingerprint(session.image)

        from_tar = load_and_fingerprint(str(tar_path))
        from_json = load_and_fingerprint(json_payload)

        assert from_tar == expected, "tar 路径没载入包里的图"
        assert from_json == expected, "json 路径没载入包里的图"
        assert from_tar == from_json, "同一次保存的两条载入路径结果不同"


def _new_blank_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    return session


class TestNoSilentPixelMismatch:
    """换图后 ROI / 列坐标必须落在新图范围内，不得留下"越界的合法状态"。"""

    def test_roi_bounds_fit_the_new_image(self, tmp_path) -> None:
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)

        session = _session_with_other_image()
        session.project_load(payload)

        for roi in session.rois:
            x_lo, x_hi = roi["xlim"]
            y_lo, y_hi = roi["ylim"]
            assert 0 <= x_lo <= x_hi <= session.width, (
                f"ROI {roi['id']} 的 x 范围 [{x_lo}, {x_hi}] 超出新图宽 {session.width}"
            )
            assert 0 <= y_lo <= y_hi <= session.height

    def test_numpy_foreground_extraction_works_after_replacement(
        self, tmp_path
    ) -> None:
        """反方向：换图后必须能**正常**重算前景，别把状态清成不可用。"""
        source = _source_session()
        payload = _json_payload(source, tmp_path, with_image=True)

        session = _session_with_other_image()
        session.project_load(payload)
        result = session.extract_foreground()

        assert result["shape"] == [PACK_SIZE[1], PACK_SIZE[0]], (
            "换图后重新提取前景得到的掩膜尺寸不是新图的"
        )
        assert session.foreground_mask is not None
        assert np.asarray(session.foreground_mask).shape == (
            PACK_SIZE[1],
            PACK_SIZE[0],
        )
