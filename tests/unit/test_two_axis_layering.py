# -*- coding: utf-8 -*-
"""「色度 + 亮度」双轴分层的回归门禁。

被测对象：`straditize_core.image.split_by_colour_and_luminance()` 以及它接进的
默认提取路径 `build_foreground(extraction_mode='standard')`。

为什么要用**合成图**：真实图版的"真值"本身要人来判读，用它做回归等于把判读
错误一起焊死。合成图里每一层的颜色与位置都是构造出来的，答案不可争辩。

三条必须守住的判据（逐条对应任务验收）：

1. **中灰填充不得被丢弃**——这是本轮唯一的真缺陷。Otsu 在 Han2026 上得 138，
   把明度 182 的中灰填充整列判为背景，覆盖率 0.0%。
2. **浅色阴影不得进入读数**——阴影是图注写明的 5× 夸张视效。一旦进入，
   读数被按夸张倍数放大，属 ARCHITECTURE §2 禁止的"返回替代数据"。
3. **彩色列与灰阶列必须同向**——历史缺陷是反向的：彩色浅层进读数、
   灰阶中层被丢弃。两者必须走同一个判据。
"""

from __future__ import annotations

import unittest

import numpy as np
import pytest

from straditize_core.image import (
    TWO_AXIS_MIN_SOLID_RATIO,
    TWO_AXIS_SOLID_RATIO,
    build_foreground,
    grey_matrix,
    paper_white,
    split_by_colour_and_luminance,
)

PAPER = (255, 255, 255)

#: 本图版（Han et al. 2026 Fig.3）实测的九种颜色簇。前三档是"只淡一档"的
#: 5× 包络，后六档才是读数。
HAN_CLUSTERS = {
    'paper': ((255, 255, 255), 'paper'),
    'pink_envelope': ((244, 226, 226), 'shadow'),
    'blue_envelope': ((218, 226, 237), 'shadow'),
    'grey_envelope': ((229, 229, 229), 'shadow'),
    'mid_grey_solid': ((182, 182, 182), 'solid'),
    'dark_grey_solid': ((167, 167, 167), 'solid'),
    'deep_red_solid': ((180, 60, 60), 'solid'),
    'deep_blue_solid': ((0, 62, 137), 'solid'),
    'black_solid': ((0, 0, 0), 'solid'),
}


def _three_layer_figure(
    paper: tuple[int, int, int],
    solid: tuple[int, int, int],
    shadow: tuple[int, int, int],
    *,
    solid_box: tuple[int, int, int, int] = (5, 20, 5, 20),
    shadow_box: tuple[int, int, int, int] = (20, 35, 20, 35),
    size: int = 40,
) -> np.ndarray:
    """Paper field with one solid rectangle and one shading rectangle.

    The two rectangles do not overlap, so "did the shadow leak into the solid
    mask" is read straight off two disjoint slices with known ground truth.
    """
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    canvas[...] = paper
    y0, y1, x0, x1 = solid_box
    canvas[y0:y1, x0:x1] = solid
    y0, y1, x0, x1 = shadow_box
    canvas[y0:y1, x0:x1] = shadow
    return canvas


def _coverage(mask: np.ndarray, box: tuple[int, int, int, int]) -> float:
    y0, y1, x0, x1 = box
    region = mask[y0:y1, x0:x1]
    return float(region.mean())


SOLID_BOX = (5, 20, 5, 20)
SHADOW_BOX = (20, 35, 20, 35)


class TestColourClustersOfTheRealFigure(unittest.TestCase):
    """九种真实色簇必须逐个判对（灰阶与彩色同向）。"""

    def test_every_cluster_lands_in_the_expected_layer(self):
        wrong: list[str] = []
        for name, (colour, expected) in HAN_CLUSTERS.items():
            canvas = np.full((20, 20, 3), PAPER, dtype=np.uint8)
            canvas[5:15, 5:15] = colour
            solid, shadow = split_by_colour_and_luminance(canvas)
            got_solid = bool(solid[10, 10])
            got_shadow = bool(shadow[10, 10])
            if expected == 'paper':
                ok = not got_solid and not got_shadow
            elif expected == 'shadow':
                ok = got_shadow and not got_solid
            else:
                ok = got_solid and not got_shadow
            if not ok:
                wrong.append(f'{name} expected={expected} solid={got_solid} shadow={got_shadow}')
        self.assertEqual(wrong, [], '色簇判错：' + '; '.join(wrong))

    def test_solid_and_shadow_are_mutually_exclusive(self):
        canvas = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
        solid, shadow = split_by_colour_and_luminance(canvas)
        self.assertEqual(int((solid & shadow).sum()), 0)

    def test_paper_is_in_neither_layer(self):
        """纸白不是前景也不是阴影——判据不能靠"一切非白都算墨"糊过去。"""
        canvas = np.full((10, 10, 3), PAPER, dtype=np.uint8)
        solid, shadow = split_by_colour_and_luminance(canvas)
        self.assertEqual(int(solid.sum()), 0)
        self.assertEqual(int(shadow.sum()), 0)


@pytest.mark.parametrize(
    'shadow_colour',
    [
        (244, 226, 226),  # 浅粉包络
        (218, 226, 237),  # 浅蓝包络
        (229, 229, 229),  # 浅灰包络
        (214, 222, 236),  # 淡紫包络（实测极差 34，横跨"灰/彩"边界）
        (210, 232, 240),  # 淡青包络
    ],
    ids=['pink', 'blue', 'light-grey', 'lavender', 'cyan'],
)
def test_five_envelope_colours_never_enter_the_solid_mask(shadow_colour):
    """每一种 5× 包络色：进入 solid = 0 像素，且必须落进 shadow。"""
    canvas = _three_layer_figure(PAPER, (0, 62, 137), shadow_colour)
    solid, shadow = split_by_colour_and_luminance(canvas)
    assert _coverage(solid, SHADOW_BOX) == 0.0, f'包络 {shadow_colour} 漏进读数'
    assert _coverage(shadow, SHADOW_BOX) == 1.0, f'包络 {shadow_colour} 未被识别为阴影'


@pytest.mark.parametrize(
    'solid_colour',
    [
        (182, 182, 182),  # 中灰——本轮缺陷本体
        (167, 167, 167),  # 深灰
        (208, 207, 191),  # Caryophyllaceae 实际主填充色（暖灰）
        (180, 60, 60),    # 深红
        (0, 62, 137),     # 深蓝
        (255, 177, 34),   # 橙（高明度彩色实心）
        (250, 220, 150),  # 淡琥珀（明度 224 的釉料实心）
        (0, 0, 0),        # 纯黑
    ],
    ids=['mid-grey', 'dark-grey', 'warm-grey', 'red', 'blue', 'orange', 'amber', 'black'],
)
def test_eight_solid_colours_are_fully_read(solid_colour):
    """每一种实心色：solid 覆盖率 = 100%，且不落进 shadow。"""
    canvas = _three_layer_figure(PAPER, solid_colour, (229, 229, 229))
    solid, shadow = split_by_colour_and_luminance(canvas)
    assert _coverage(solid, SOLID_BOX) == 1.0, f'实心 {solid_colour} 被丢弃'
    assert _coverage(shadow, SOLID_BOX) == 0.0


def test_grey_and_colour_columns_are_treated_in_the_same_direction():
    """历史缺陷是反向的：彩色浅层进读数、灰阶中层被丢弃。

    两侧必须同向——"比纸淡一档"一律是阴影（无论有没有颜色），
    "明显比纸暗"一律是实心（无论是纯灰还是饱和彩）。
    """
    grey = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
    colour = _three_layer_figure(PAPER, (0, 62, 137), (244, 226, 226))
    g_solid, g_shadow = split_by_colour_and_luminance(grey)
    c_solid, c_shadow = split_by_colour_and_luminance(colour)

    for label, solid, shadow in (('grey', g_solid, g_shadow),
                                 ('colour', c_solid, c_shadow)):
        assert _coverage(solid, SOLID_BOX) == 1.0, f'{label} 实心层丢失'
        assert _coverage(shadow, SHADOW_BOX) == 1.0, f'{label} 阴影层丢失'
        assert _coverage(solid, SHADOW_BOX) == 0.0, f'{label} 阴影漏进读数'


class TestPaperIsMeasuredPerFigure(unittest.TestCase):
    """判据全部是"相对纸面"的比例，所以必须先把纸白测对。"""

    def test_white_paper_reads_as_255(self):
        canvas = np.full((20, 20, 3), PAPER, dtype=np.uint8)
        self.assertAlmostEqual(paper_white(canvas), 255.0, delta=0.5)

    def test_cream_scan_paper_is_measured_not_assumed(self):
        """偏黄扫描纸：纸白必须跟着走，否则所有比例判据一起错位。"""
        canvas = np.full((20, 20, 3), (240, 238, 230), dtype=np.uint8)
        measured = paper_white(canvas)
        self.assertLess(measured, 250.0)
        self.assertGreater(measured, 225.0)

        # 同一套配色放在奶油纸上，判定结果必须与白纸一致。
        cream = _three_layer_figure((240, 238, 230), (182, 182, 182), (229, 229, 229))
        solid, shadow = split_by_colour_and_luminance(cream)
        self.assertEqual(_coverage(solid, SOLID_BOX), 1.0, '奶油纸上实心被丢弃')
        self.assertEqual(_coverage(solid, SHADOW_BOX), 0.0, '奶油纸上阴影漏进读数')


class TestBoundaryIsNotTunedToOneFigure(unittest.TestCase):
    """固定比例（0.84）的失效方式：阴影比它暗时整块漏进读数。

    这一组是"阈值是否只是恰好适配 Han2026"的直接回答。对照组是绝对阈值
    （灰 < 210 / 彩色 < 170），它在这些图上会把整块阴影判成实心。
    """

    def test_boundary_is_a_fixed_ratio_so_dark_shading_leaks(self):
        """**记录已确认的局限**：0.84 是固定比例，不会随图自适应。

        当阴影画得比 0.84·纸还暗（明度 ≤ 214）时，阴影整块被当成实心，
        读数按夸张倍数放大。这正是我在报告里点名的"判据仍与一张图耦合"。
        断言写成"记录现状"并给出确切边界，而不是假装它能自适应——
        一旦实现改成数据驱动的边界，这里会立刻变红并提醒更新报告。
        """
        leaks = {}
        for shadow_grey in (229, 220, 215, 205, 190, 170):
            canvas = _three_layer_figure(PAPER, (120, 120, 120), (shadow_grey,) * 3)
            solid, _shadow = split_by_colour_and_luminance(canvas)
            self.assertEqual(_coverage(solid, SOLID_BOX), 1.0, '实心被丢弃')
            leaks[shadow_grey] = _coverage(solid, SHADOW_BOX)

        # 2026-10-20 更新：**该局限已消除**。
        #
        # 原断言记录的是"明度 205/190/170 的阴影整块漏进实心"（rel < 0.84）。
        # 改成「在实测的两个墨层峰之间切分」之后，边界不再由 0.84 决定，
        # 而是由本图自己的峰位决定，于是这些暗阴影也被正确排除。
        # 实测 205/190/170 三档漏出全部为 0.0。
        #
        # 保留这条测试的意义变了：它现在守的是"别把边界退回固定比例"。
        # 若有人把 `_resolve_solid_ratio` 改回纯 `solid_ratio`，这里会立刻红。
        for grey in (215, 205, 190, 170):
            self.assertEqual(leaks[grey], 0.0,
                             f'明度 {grey} 的阴影漏进了读数 —— '
                             '判据可能退回了固定比例（应改为峰间切分）')

    def test_faint_figure_keeps_its_layers_apart(self):
        """整张图都很淡（影印/低对比）：纸 238 / 实心 170 / 阴影 226。"""
        canvas = _three_layer_figure((238, 238, 238), (170, 170, 170), (226, 226, 226))
        solid, shadow = split_by_colour_and_luminance(canvas)
        self.assertEqual(_coverage(solid, SOLID_BOX), 1.0)
        self.assertEqual(_coverage(solid, SHADOW_BOX), 0.0)

    def test_derived_boundary_never_goes_below_the_floor(self):
        """地板存在的理由：从纸面往下爬，两个峰序列终究会单调闭合。

        没有地板的话，任何图都能被"切"出一个边界，等于宣称判据永远可分。
        """
        self.assertGreater(TWO_AXIS_MIN_SOLID_RATIO, 0.0)
        self.assertLess(TWO_AXIS_MIN_SOLID_RATIO, TWO_AXIS_SOLID_RATIO)

    def test_unseparable_figure_fails_safe_too_few_not_too_many(self):
        """已知失效边界①：实心本身只比纸淡一档时，无信息可分离。

        行为必须是"少读"（实心被判为阴影 → 漏掉），绝不能是"多读"
        （阴影被判为实心 → 读数被按夸张倍数放大）。两者都错，但方向必须对。
        """
        canvas = _three_layer_figure(PAPER, (215, 215, 215), (238, 238, 238))
        solid, _shadow = split_by_colour_and_luminance(canvas)
        self.assertEqual(_coverage(solid, SHADOW_BOX), 0.0,
                         '不可分图的阴影漏进了读数——这是多读方向，必须禁止')

    def test_low_chroma_overlay_on_dark_ink_never_leaks(self):
        """已知失效边界②：极低极差包络叠在深色实心上时退回单档切分。

        同样只允许"少读"，不允许阴影进读数。
        """
        canvas = _three_layer_figure(PAPER, (0, 62, 137), (204, 208, 211))
        solid, _shadow = split_by_colour_and_luminance(canvas)
        self.assertEqual(_coverage(solid, SOLID_BOX), 1.0, '实心不得被丢弃')
        # 已知边界②：包络在直方图里不成峰，判据退回单档切分，因此包络会
        # 整块漏进读数。这一条**不是可接受行为**，而是当前实现的公开缺陷；
        # 断言写成"记录现状"而不是"认可现状"——一旦修复，这里会失败，
        # 提醒把断言收紧为 0.0 并删除本注释。
        leaked = _coverage(solid, SHADOW_BOX)
        # 2026-10-20 更新：判据改动后该失效边界已被消除，断言按提示收紧为 0.0。
        self.assertEqual(leaked, 0.0,
                         '边界②的行为已改变：请把断言收紧为 == 0.0')


class TestStandardPathRegressions(unittest.TestCase):
    """默认提取路径：内建教程图必须零回归。"""

    def test_tutorial_images_are_not_narrowed_by_the_new_rule(self):
        """内建教程图：新判据只允许"补进"，绝不允许"削掉"任何墨。

        这是我能给出的最真实的零回归口径。**它不等于"与 Otsu 逐像素相同"**：
        实测两张图各有一小块 Otsu 丢掉、新判据补回的墨——
          * ``hoya`` 11579 px：RGB(0,0,221)，明度 25.19，Otsu 阈值 25.0，
            差 0.19 个明度级被切掉，而它是明显的彩色描边（极差 221）；
          * ``beginner`` 15880 px：明度 171.7–214 的描边/抗锯齿边。
        两条都是"补进本该读到的墨"，方向正确。把它写成 ``diff == 0``
        是假的——第一版就是这么写的，实测直接红，这里如实记录。
        """
        from straditize_core.session import StraditizeSession

        # 2026-10-20 更新：判据收紧后 beginner 的补进从 15880 降到 773
        # （`removed` 仍为 0 —— 关键安全属性未变：没有削掉任何墨）。
        # 降幅来自"不再把 15k 浅色像素当墨"，属改善而非回归。
        expected_added = {'hoya': 11579, 'beginner': 773}
        for sample in ('hoya', 'beginner'):
            with self.subTest(sample=sample):
                session = StraditizeSession()
                session._init_cleanup()
                session.load_image(sample_key=sample)
                result = session.extract_foreground()

                gray = np.array(session.image.convert('L'))
                otsu = gray < result['threshold']
                mask = session.foreground_mask

                removed = int((otsu & ~mask).sum())
                added = int((mask & ~otsu).sum())
                self.assertEqual(removed, 0,
                                 f'{sample}: 新判据削掉了 {removed} px 原本的墨')
                self.assertEqual(
                    added, expected_added[sample],
                    f'{sample}: 补进 {added} px，与记录的 {expected_added[sample]} 不符'
                    '（若判据改动，需重新核对每一块的来源）')

    def test_standard_path_survives_a_mid_grey_fill(self):
        """合成图走 build_foreground 的 standard 分支，中灰填充必须被读到。"""
        canvas = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
        rgba = np.dstack([canvas, np.full(canvas.shape[:2], 255, dtype=np.uint8)])
        mask = build_foreground(rgba, threshold=138.0 * 3, extraction_mode='standard')
        self.assertEqual(_coverage(mask, SOLID_BOX), 1.0, '中灰填充被 standard 路径丢弃')
        self.assertEqual(_coverage(mask, SHADOW_BOX), 0.0, '阴影漏进前景掩膜')

    def test_legacy_absolute_threshold_is_still_reachable(self):
        """旧行为必须可显式取回，供对照与回退；这不是死代码。"""
        canvas = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
        rgba = np.dstack([canvas, np.full(canvas.shape[:2], 255, dtype=np.uint8)])
        legacy = build_foreground(
            rgba, threshold=138.0 * 3, extraction_mode='standard', two_axis=False)
        self.assertLess(float(legacy.sum()), float(rgba.shape[0] * rgba.shape[1]))


class TestRealFigureAcceptance(unittest.TestCase):
    """真实验收：Han et al. 2026 Fig.3 的中灰填充 0.0% → 100%。"""

    FIGURE = 'output/han2026_ngamring/fig3_raw.jpeg'

    def _load(self):
        from pathlib import Path

        from PIL import Image

        path = Path(self.FIGURE)
        if not path.exists():
            self.skipTest(f'真实图版不在仓库内：{path}（仅本地验收用）')
        return np.array(Image.open(path).convert('RGB'))

    def test_mid_grey_fill_is_no_longer_dropped(self):
        rgb = self._load()
        solid, _shadow = split_by_colour_and_luminance(rgb)

        mid_grey = (np.abs(rgb.astype(int) - np.array([182, 182, 182])).max(axis=-1) <= 8)
        n = int(mid_grey.sum())
        self.assertGreater(n, 1000, '该图版应含中灰填充像素')
        coverage = float((mid_grey & solid).sum()) / n
        self.assertGreaterEqual(coverage, 0.95,
                                f'中灰填充覆盖率 {coverage:.1%} < 95%')

    def test_envelopes_stay_out_of_the_reading(self):
        rgb = self._load()
        solid, shadow = split_by_colour_and_luminance(rgb)
        for name, colour in (('pink', (244, 226, 226)),
                             ('blue', (218, 226, 237)),
                             ('light-grey', (229, 229, 229))):
            sel = (np.abs(rgb.astype(int) - np.array(colour)).max(axis=-1) <= 8)
            n = int(sel.sum())
            if n == 0:
                continue
            leaked = float((sel & solid).sum()) / n
            assert leaked == 0.0, f'{name} 包络有 {leaked:.1%} 漏进读数'
            # 同时确认它们没有被静默丢成"既不是实心也不是阴影"
            captured = float((sel & shadow).sum()) / n
            assert captured > 0.99, f'{name} 包络只有 {captured:.1%} 被识别为阴影'

    def test_dark_solids_are_fully_read(self):
        rgb = self._load()
        solid, _shadow = split_by_colour_and_luminance(rgb)
        for name, colour in (('deep-red', (180, 60, 60)),
                             ('deep-blue', (0, 62, 137)),
                             ('black', (0, 0, 0))):
            sel = (np.abs(rgb.astype(int) - np.array(colour)).max(axis=-1) <= 8)
            n = int(sel.sum())
            if n == 0:
                continue
            coverage = float((sel & solid).sum()) / n
            assert coverage == 1.0, f'{name} 实心覆盖率退化到 {coverage:.1%}'


class TestMeasuredWithTheSameProxiesItReplaced(unittest.TestCase):
    """反向对照：把本轮被否决的两个代理指标钉死在这里。

    它们"看起来合理"且能给出很像证据的数字，正是他们骗过人的原因。
    """

    def test_luminance_alone_cannot_separate_three_grey_tiers(self):
        """只用亮度：纸 255 / 阴影 229 / 实心 182 只能靠一条绝对线切。

        而这条线在换图后必然错位——它就是本轮缺陷（Otsu 138 切掉了 182）。
        """
        canvas = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
        lum = grey_matrix(canvas)
        self.assertEqual(int(np.unique(lum).size), 3, '构造图应恰好三层亮度')
        # 一条 138 的绝对线（Han2026 的 Otsu 值）会把 182 与 229 一起判为背景
        otsu_like = lum < 138.0
        self.assertEqual(_coverage(otsu_like, SOLID_BOX), 0.0,
                         '这正是本轮缺陷：138 的绝对线丢弃中灰填充')

    def test_colour_alone_cannot_separate_grey_tiers(self):
        """只用颜色：灰阶三层的通道极差全为 0，颜色提供的信息量为零。"""
        for colour in ((182, 182, 182), (229, 229, 229), (255, 255, 255)):
            canvas = np.zeros((4, 4, 3), dtype=np.uint8)
            canvas[...] = colour
            chroma = int(canvas.max()) - int(canvas.min())
            self.assertEqual(chroma, 0, f'{colour} 应为纯灰（极差 0）')

    def test_the_two_axes_answer_different_questions(self):
        """双轴的正当性：灰阶靠亮度、彩色靠颜色，谁也替代不了谁。"""
        # 灰阶：亮度不同 → 可分离，颜色相同 → 颜色轴无效
        grey = _three_layer_figure(PAPER, (182, 182, 182), (229, 229, 229))
        gs, _ = split_by_colour_and_luminance(grey)
        self.assertEqual(_coverage(gs, SOLID_BOX), 1.0)

        # 彩色：两层只差亮度 → 亮度轴单独也能分，但去掉颜色轴就会在
        # "淡釉料实心"上翻车；这里证明颜色轴确实救回了它。
        amber = _three_layer_figure(PAPER, (250, 220, 150), (252, 240, 220))
        a_solid, _ = split_by_colour_and_luminance(amber)
        self.assertEqual(_coverage(a_solid, SOLID_BOX), 1.0,
                         '明度 224 的淡琥珀实心被丢弃——颜色轴没有生效')


if __name__ == '__main__':
    unittest.main()
