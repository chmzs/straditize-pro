# -*- coding: utf-8 -*-
"""清理几何的"属于哪张图"必须按**内容**判定（C1e），且换图后必须失效。

## 缺陷本体

`cleanup._geometry_scope()` 原本用 `{image_path, width, height}` 当图像身份。
`image_path` 是**来源**，不是**身份**，于是两个场景都误判：

1. **工程包载入后**：`project_load` 不恢复 `image_path`（也不该恢复——包里记的
   可能是另一台机器上的路径），载入后 `image_path=None`，包里所有几何的 scope
   与当前 scope 不等 → `_geometry_in_scope()` 返回 False → 用户确认过的线去除
   **静默全部失效**。实测：源会话 1 条 removed 几何剔除 700 px，存盘再载入后
   同一条几何剔除 **0 px**，而界面上几何仍在列表里、状态仍是 removed。
2. **PDF 换页 / 旋转**：路径不变甚至退化成常量，`image_path + 尺寸` 判不出
   "同一来源但像素变了"。

## 修法：内容指纹（sha256 of RGBA pixels）

指纹正面回答 scope 真正想问的问题——"这块几何是不是画在这堆像素上"：

- 存盘带图 → 载入后像素逐字节相同 → 指纹相同 → 几何继续生效；
- 换成另一张图（哪怕**同尺寸、同文件名**）→ 指纹不同 → 几何失效；
- 旋转 → 像素全变 → 自动失效（路径方案做不到这一点）。

成本实测：hoya (2339x1654, 15.5MB) `tobytes` 15.6ms + `sha256` 37.6ms ≈ 53ms，
故按图缓存；缓存由 `StraditizeSession.image` 的 **property setter 自动作废**
（不是靠各处手写清单——手写清单已漏过 B-03 与 B-11）。

## 四组判据，缺一不可

1. **该变的变了**：换图后指纹必须变（缓存失效的反向断言）；
2. **(a) 包内几何继续生效**，且剔除像素数与存盘前**一致**；
3. **(b) 换图后包内几何必须失效**——只有 (a) 绿等于把 B-03 修回去了；
4. **旧格式工程包不被放宽**：只记 `image_path` 的几何仍按旧判据比对。
"""
from __future__ import annotations

import io
import json
import time

import numpy as np
import pytest
from PIL import Image

from straditize_core.session import StraditizeSession

WIDTH, HEIGHT = 400, 300


def _striped_figure(black_row: int) -> bytes:
    """白底 + 一条指定行的黑线（几何正好盖住它，便于数剔除像素）。"""
    canvas = np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)
    canvas[black_row : black_row + 2, 20:370] = 0
    buffer = io.BytesIO()
    Image.fromarray(canvas).save(buffer, format="PNG")
    return buffer.getvalue()


def _session_with_confirmed_geometry(black_row: int = 100) -> StraditizeSession:
    """源会话：有 ROI + 列 + 一条**已确认(removed)**的水平几何。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.image_path = "upload://source-figure.png"
    session.image = Image.open(io.BytesIO(_striped_figure(black_row)))
    session.image.load()
    session.width, session.height = session.image.size
    session.roi_create(name="pollen", x0=10, x1=380, y0=10, y1=280)
    session.detect_columns([20, 380], [20, 280], roi_id=session.rois[0]["id"])
    session.upsert_line_geometry(
        roi_id=session.rois[0]["id"],
        axis="h",
        geometry={
            "type": "rect",
            "x0": 20,
            "y0": black_row,
            "x1": 370,
            "y1": black_row + 2,
        },
        status="removed",
    )
    return session


def _removed_pixels(session: StraditizeSession) -> int:
    if session.foreground_mask is None:
        session.extract_foreground()
    return session.apply_line_removal(roi_id=session.rois[0]["id"])["stats"][
        "geometry_removed_pixels"
    ]


class TestFingerprintFollowsTheImage:
    """第 1 组：缓存必须随图失效。这是最容易漏的一条——它是内部实现，
    界面上完全看不出来，错了只会表现为跨图防御被静默拆掉。

    失效机制是 `StraditizeSession.image` 的 **property setter**（赋值即清缓存），
    不是各调用点手工清。故这里**逐路径**钉住。其中两条是反向断言：

    - `project_new` **默认** `clear_image=False` 时指纹**不该**变（有意保留底图，
      让用户从步骤 1 重来而不是重载图）；
    - 缓存必须真的被复用，否则 `_geometry_mask` 逐几何重算 sha256。
    """

    def test_load_image_changes_the_fingerprint(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        hoya_fingerprint = session._image_fingerprint()

        session.load_image(sample_key="beginner")
        beginner_fingerprint = session._image_fingerprint()

        assert hoya_fingerprint and beginner_fingerprint
        assert hoya_fingerprint != beginner_fingerprint, (
            "换图后内容指纹没变 —— 缓存未失效，_geometry_in_scope() 会对所有几何"
            "恒返回 True，B-03 的跨图纵深防御被拆掉"
        )

    def test_project_load_changes_the_fingerprint(self, tmp_path) -> None:
        """C1e 的主场景：载入别的工程包后指纹必须变成那个包里图的指纹。"""
        pack_session = _session_with_confirmed_geometry(black_row=50)
        pack_fingerprint = pack_session._image_fingerprint()
        target = tmp_path / "pack.json"
        pack_session.project_save(output_path=str(target), format="json")
        payload = json.loads(target.read_text(encoding="utf-8"))

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        hoya_fingerprint = session._image_fingerprint()
        assert hoya_fingerprint != pack_fingerprint, "前置：两张图应不同"

        session.project_load(payload)

        assert session._image_fingerprint() == pack_fingerprint, (
            "载入工程包后指纹没变成包里那张图的 —— 缓存沿用了上一张图"
        )

    def test_project_load_tar_changes_the_fingerprint(self, tmp_path) -> None:
        """`.tar` 分支在 `project_load(parsed)` 之前就设图，是独立的赋值路径。"""
        pack_session = _session_with_confirmed_geometry(black_row=50)
        pack_fingerprint = pack_session._image_fingerprint()
        target = tmp_path / "pack.tar"
        pack_session.project_save(output_path=str(target), format="tar")

        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        assert session._image_fingerprint() != pack_fingerprint

        session.project_load(str(target))

        assert session._image_fingerprint() == pack_fingerprint, (
            "tar 路径设图后指纹没变 —— 该分支绕过了 property setter"
        )

    def test_setting_image_to_none_clears_the_cache(self) -> None:
        session = _session_with_confirmed_geometry()
        assert session._image_fingerprint() is not None
        session.image = None
        assert session._image_fingerprint_cache is None
        assert session._image_fingerprint() is None

    def test_project_new_clear_image_resets_the_fingerprint(self) -> None:
        session = _session_with_confirmed_geometry()
        assert session._image_fingerprint() is not None

        session.project_new(clear_image=True)

        assert session.image is None
        assert session._image_fingerprint_cache is None
        assert session._image_fingerprint() is None

    def test_project_new_keeps_the_fingerprint_when_image_is_kept(self) -> None:
        """反方向：默认 `clear_image=False` 有意保留底图，指纹**不该**变。"""
        session = _session_with_confirmed_geometry()
        before = session._image_fingerprint()

        session.project_new()

        assert session.image is not None, "前置：默认应保留底图"
        assert session._image_fingerprint() == before, (
            "底图被保留时指纹却变了 —— 会让保留下来的几何被误判失效"
        )

    def test_rotate_invalidates_geometry(self) -> None:
        """旋转改变每个像素：路径没变，但几何必须失效。"""
        session = _session_with_confirmed_geometry()
        before = session._image_fingerprint()
        assert all(session._geometry_in_scope(g) for g in session.line_candidates)

        session.rotate_image(2.0)

        assert session._image_fingerprint() != before
        assert not any(session._geometry_in_scope(g) for g in session.line_candidates), (
            "旋转后几何仍被判为属于当前图 —— 它的坐标是旋转前的像素坐标"
        )

    def test_cached_fingerprint_is_actually_reused(self) -> None:
        """缓存必须真的生效：`_geometry_mask` 逐几何调用 scope，不能每条都算 sha256。

        实测口径：冷调用 ~54ms（15.5MB 图），命中缓存 1000 次 ~0.2ms。
        """
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")

        cold_start = time.perf_counter()
        cold_fingerprint = session._image_fingerprint()
        cold_ms = (time.perf_counter() - cold_start) * 1000

        warm_start = time.perf_counter()
        for _ in range(200):
            assert session._image_fingerprint() == cold_fingerprint
        warm_ms = (time.perf_counter() - warm_start) * 1000

        assert warm_ms < cold_ms, (
            f"200 次热调用 {warm_ms:.1f}ms 不慢于一次冷调用 {cold_ms:.1f}ms —— "
            "缓存没生效，每个几何都在重算 sha256"
        )


class TestPackGeometrySurvivesLoad:
    """第 2 组 (a)：存盘→载入后，包内几何必须**继续生效**且剂量一致。"""

    @pytest.mark.parametrize("project_format", ["json", "tar"])
    def test_geometry_still_removes_the_same_pixels(
        self, tmp_path, project_format: str
    ) -> None:
        source = _session_with_confirmed_geometry()
        source_pixels = _removed_pixels(source)
        assert source_pixels > 0, "前置：源会话里几何应真的剔除了像素"

        target = tmp_path / f"pack.{project_format}"
        source.project_save(output_path=str(target), format=project_format)

        loaded = StraditizeSession()
        loaded._init_cleanup()
        loaded.project_load(str(target))

        assert loaded.rois, "前置：包里应有 ROI"
        assert loaded.line_candidates, "前置：包里应有几何"
        assert all(loaded._geometry_in_scope(g) for g in loaded.line_candidates), (
            "载入工程包后包内几何被判为不属于当前图 —— 用户确认过的清理"
            "静默全部失效（C1e）"
        )
        assert _removed_pixels(loaded) == source_pixels, (
            f"载入后剔除 {_removed_pixels(loaded)} px，存盘前是 {source_pixels} px —— "
            "剂量必须一致，几何要真的在三同一张图上生效"
        )

    def test_geometry_survives_even_with_unrestored_image_path(self, tmp_path) -> None:
        """核心断言：`project_load` 不恢复 image_path，几何仍须生效。

        这正是旧判据的失配点——`image_path` 载入后是 None，旧 scope 必然不等于
        记录值。指纹判据不看路径，所以这个场景自愈。
        """
        source = _session_with_confirmed_geometry()
        target = tmp_path / "pack.json"
        source.project_save(output_path=str(target), format="json")

        loaded = StraditizeSession()
        loaded._init_cleanup()
        loaded.project_load(str(target))

        assert loaded.image_path is None, (
            "前置：project_load 有意不恢复源路径（包里记的可能是别的机器）"
        )
        assert loaded.image is not None
        assert all(loaded._geometry_in_scope(g) for g in loaded.line_candidates), (
            "image_path 为 None 时几何又被判失效 —— 判定仍在依赖来源路径"
        )


class TestCrossImageDefenceStillHolds:
    """第 3 组 (b)：载入包之后换一张**不同**的图，包内几何必须失效。

    只有 (a) 绿等于把 B-03 修回去了。这条是本文件最重要的反向断言。
    """

    def test_different_image_of_same_size_invalidates_pack_geometry(
        self, tmp_path
    ) -> None:
        source = _session_with_confirmed_geometry(black_row=100)
        target = tmp_path / "pack.json"
        source.project_save(output_path=str(target), format="json")

        loaded = StraditizeSession()
        loaded._init_cleanup()
        loaded.project_load(str(target))
        assert all(loaded._geometry_in_scope(g) for g in loaded.line_candidates)

        # 同尺寸、不同内容的图 —— 尺寸判据在这里完全无效，只有指纹判得出
        loaded.image = Image.open(io.BytesIO(_striped_figure(black_row=50)))
        loaded.image.load()
        loaded.width, loaded.height = loaded.image.size
        loaded.image_path = "upload://another-figure-same-size.png"

        assert not any(loaded._geometry_in_scope(g) for g in loaded.line_candidates), (
            "换成同尺寸的另一张图后，包内几何仍被判为在范围内 —— "
            "跨图残留回归（B-03）"
        )
        assert _removed_pixels(loaded) == 0, "旧图几何在新图上仍然剔除了像素"

    def test_same_content_under_a_different_path_stays_in_scope(self) -> None:
        """反方向：同一份像素换个路径名**不该**让几何失效（这就是指纹优于路径处）。"""
        session = _session_with_confirmed_geometry()
        original_pixels = _removed_pixels(session)
        payload = session.image.tobytes()

        session.image = Image.open(io.BytesIO(payload and _striped_figure(100)))
        session.image.load()
        session.width, session.height = session.image.size
        session.image_path = "upload://renamed-but-same-pixels.png"

        assert all(session._geometry_in_scope(g) for g in session.line_candidates), (
            "同内容的图只改了路径名，几何却失效了 —— 判定仍在依赖来源而不是内容"
        )
        assert _removed_pixels(session) == original_pixels


class TestNonImageBackdropDegradesSafely:
    """当前图算不出指纹时（非 PIL 对象 / 已 close）必须**降级**，不能炸也不能放行。

    这类状态在测试里很常见（`session.image = object()` 表示"已载入图"的占位），
    在生产里也可能出现（图对象被 close）。产品 docstring 承诺了容错，这里钉住
    承诺本身，并钉住降级**不等于**拆掉防御。
    """

    def test_non_image_object_returns_no_fingerprint(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.image = object()  # 不是 PIL 图像

        assert session._image_fingerprint() is None, (
            "非图像对象应当返回 None（内容身份无法判定），而不是抛异常打断清理流程"
        )

    def test_non_image_object_does_not_make_geometry_unconditionally_in_scope(
        self,
    ) -> None:
        """降级必须退回**尺寸比对**，绝不能变成"无条件在范围内"。"""
        session = _session_with_confirmed_geometry()
        geometry = session.line_candidates[0]
        assert session._geometry_in_scope(geometry), "前置：指纹正常时应生效"

        session.image = object()

        # 尺寸仍对得上 → 退回尺寸比对后仍然生效（有意的降级，不误伤）
        assert session._geometry_in_scope(geometry), (
            "同一尺寸但算不出指纹时几何被判失效 —— 降级没生效"
        )

        # 但**换个尺寸**就必须失效：证明不是无条件放行
        session.width = session.width + 1
        assert not session._geometry_in_scope(geometry), (
            "尺寸已变仍判在范围内 —— 降级成了'无条件放行'，B-03 的纵深防御被拆掉"
        )

    def test_recorded_fingerprint_without_current_one_still_checks_size(self) -> None:
        """几何记了指纹、当前图算不出指纹时，也必须走尺寸比对而非直接放行。"""
        session = _session_with_confirmed_geometry()
        geometry = dict(session.line_candidates[0])
        geometry["image_scope"] = dict(geometry["image_scope"])
        geometry["image_scope"]["fingerprint"] = "recorded-fingerprint"

        session.image = object()
        assert session._geometry_in_scope(geometry), "尺寸一致时应降级放行"

        session.height = session.height + 1
        assert not session._geometry_in_scope(geometry), "尺寸不一致时必须失效"


class TestLegacyShapeIsNotLoosened:
    """第 4 组：只记 `image_path` 的旧几何仍按旧判据比对，不因新方案被放宽。"""

    def _legacy_geometry(self, session: StraditizeSession, path: str) -> dict:
        return {
            "id": "legacy_1",
            "axis": "h",
            "geometry": {"type": "rect", "x0": 400, "y0": 700, "x1": 1900, "y1": 702},
            "status": "removed",
            "roi_id": session.rois[0]["id"],
            "image_scope": {
                "image_path": path,
                "width": session.width,
                "height": session.height,
            },
        }

    def test_legacy_scope_matching_path_stays_in_scope(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        session.line_candidates = [
            self._legacy_geometry(session, session.image_path)
        ]
        assert all(session._geometry_in_scope(g) for g in session.line_candidates)

    def test_legacy_scope_from_another_path_stays_out(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        session.line_candidates = [
            self._legacy_geometry(session, "E:/someone-elses/hoya.png")
        ]
        assert not any(session._geometry_in_scope(g) for g in session.line_candidates), (
            "旧格式几何换了路径仍被判在范围内 —— 新判据把旧格式一起放宽了"
        )

    def test_legacy_scope_with_different_size_stays_out(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        geometry = self._legacy_geometry(session, session.image_path)
        geometry["image_scope"]["width"] = session.width + 1
        session.line_candidates = [geometry]
        assert not any(session._geometry_in_scope(g) for g in session.line_candidates)


class TestUnloadableStates:
    """边界：没有图时 scope 必须是"无身份"，而不是编造的尺寸。"""

    def test_no_image_means_no_fingerprint_and_zero_size(self) -> None:
        session = StraditizeSession()
        session._init_cleanup()
        scope = session._geometry_scope()
        assert scope == {
            "fingerprint": None,
            "width": 0,
            "height": 0,
            "image_path": None,
        }, "没有图时 scope 不应带上任何尺寸 —— 那会让几何按尺寸判定而生效"
        assert session._image_fingerprint() is None

    def test_json_payload_without_embedded_image_leaves_no_backdrop(self) -> None:
        """`.json` 不带 base64：底图留空，且尺寸归零（不伪造）。

        这是有意行为，不是缺陷：`project_save(format="json")` 的内存形态本来
        就不内嵌图（只有写盘版才内嵌）。此时没有任何像素可依，width/height
        若填成包里的数字，scope 就会按一组"并不存在的像素"的尺寸判定。
        """
        source = _session_with_confirmed_geometry()
        payload = source.project_save(format="json")["data"]
        assert not payload["image"].get("base64"), "前置：该 payload 不应内嵌图"

        loaded = StraditizeSession()
        loaded._init_cleanup()
        loaded.project_load(payload)

        assert loaded.image is None
        assert (loaded.width, loaded.height) == (0, 0)
        assert loaded._geometry_scope() == {
            "fingerprint": None,
            "width": 0,
            "height": 0,
            "image_path": None,
        }
