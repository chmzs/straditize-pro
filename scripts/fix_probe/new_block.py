# ---------------------------------------------------------------------------
# 「实心层 + 夸张阴影层」双层图的分离
# ---------------------------------------------------------------------------
# 典型场景：花粉百分比图。每个属种列画两层——
#   * 实心填充 = 该层的真实百分比（唯一可作读数的层）；
#   * 浅色包络 = 图注写明 "Shadings are five-fold exaggerated" 的视效阴影。
#
# 为什么不能只用一条灰度阈值（Otsu）：两层**色相相同、只差明度**，而不同列
# 的色相又各不相同（红/蓝/黑/灰）。单一阈值只有两种结局，两种都错：
#   阈值偏高 → 浅色阴影进入读数，数值 ×5；
#   阈值偏低 → 中灰实心与浅色彩色实心被整列丢弃。
# 实测 Han et al. 2026 Fig.3：Otsu = 138，中灰列命中 1.4%。
#
# 判据只用一件可判定的事实：**像素是否与所在列的纸面同阶**。
#
#   ① 先按列求该列自己的白点（该列最多的中性亮色），不假设全图同一张白纸；
#   ② 相对纸面"只淡一档"的像素（≡ 是该列的最浅灰层）判为阴影；
#   ③ 其余像素是实心，但剔除表格线——它既不是读数也不是阴影。
#
# 为什么阈值必须**从纸面派生**而不是写死一个明度值：同一套出版风格下，淡灰
# 网线（228–232）与纸（255）的相对距离是印刷工艺常数；换一张图版后绝对值会
# 变，相对距离不变。写死绝对值会在下一张图上失效。
#
# 为什么**不用 Otsu 找谷**：Otsu 假定前景/背景大致各占一半，而阴影层在这类
# 图里占 80–95% 的非纸像素，Otsu 必然切在阴影层**内部**，把一半阴影送进读数。

#: 阴影层相对该列纸面的上界，写成归一化明度（0-1）。
#: 实测本图：纸 255、阴影 228–232 → 相对 0.894–0.910；取 0.94 使阴影必中、
#: 而最浅的彩色实心（橙，153/255 = 0.60）与灰实心（182/255 = 0.71）远低于它。
SHADOW_RELATIVE_LUM = 0.94
#: 判为「中性」允许的通道极差。超过它按彩色处理。
#: 实测本图红/蓝阴影的极差 16–24（JPEG 色偏），正常彩色实心 >= 136。
NEUTRAL_CHROMA_TOL = 32.0
#: 阴影候选的最小饱和度：真正的灰层接近 0；被 JPEG 轻微染色的淡色也算。
SHADOW_MAX_CHROMA_RATIO = 0.22
#: 表格线：细 + 长 + 中性。三者同时成立才算，缺一不可。
#:   * 细（厚度 <= 2 px）—— 实心填充成片，不会细；
#:   * 长（水平游程 >= 160 px）—— 轴框与基准线横贯整幅，语料库最长描边 114 px；
#:   * 中性（通道极差 <= 32）—— 不排除彩色线会把彩色描边当表格线删掉。
STRUCTURE_MAX_THICKNESS = 2
STRUCTURE_LINE_MIN_RUN = 160


def grey_matrix(rgb: np.ndarray) -> np.ndarray:
    """明度（0-255），**与 PIL ``Image.convert('L')`` 逐值一致**。

    必须一致：产品另有一条 Otsu 路径读的就是同一张图的 ``convert('L')``；
    两条路径对"多暗"的分歧，会让同一像素在两种模式下得到不同判定。
    """
    arr = np.asarray(rgb, dtype=float)[..., :3]
    return (arr[..., 0] * 299.0 + arr[..., 1] * 587.0 + arr[..., 2] * 114.0) / 1000.0


def _total_horizontal_run(binary: np.ndarray) -> np.ndarray:
    """Length of the contiguous horizontal run containing each pixel (0 elsewhere)."""
    binary = np.asarray(binary, dtype=bool)
    if binary.size == 0:
        return np.zeros(binary.shape, dtype=np.int32)
    forward = _run_lengths_along_rows(binary)
    backward = _run_lengths_along_rows(binary[:, ::-1])[:, ::-1]
    return np.where(binary, forward + backward - 1, 0).astype(np.int32)


def structure_line_mask(
    binary: np.ndarray,
    *,
    min_run: int = STRUCTURE_LINE_MIN_RUN,
    max_thickness: int = STRUCTURE_MAX_THICKNESS,
) -> np.ndarray:
    """Pixels of ``binary`` that are part of a long, thin, horizontal rule.

    Both bounds are required. Length alone cannot distinguish a rule from a wide
    solid fill (a 180 px column's fill is one continuous run); thickness alone
    cannot distinguish it from a 2 px pale shadow boundary. Only the pair is
    specific, and neither needs tuning per figure.
    """
    binary = np.asarray(binary, dtype=bool)
    if binary.size == 0:
        return np.zeros_like(binary)
    long_enough = _total_horizontal_run(binary) >= int(min_run)
    thin = stroke_thickness(binary, axis=0) <= int(max_thickness)
    return binary & long_enough & thin


def column_white_points(
    rgb: np.ndarray,
    edges: Any,
    *,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
) -> np.ndarray:
    """Per-band white point (0-255), one value per ``edges`` interval.

    For each band the white point is the **95th percentile** of its neutral,
    bright pixels — not the maximum: a single JPEG ringing pixel at 255 must not
    define "paper" for a band whose paper is actually 247.

    ``edges`` are the band boundaries as pixel x positions. A band with no
    neutral pixels falls back to the global white point.
    """
    rgb = np.asarray(rgb, dtype=float)[..., :3]
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= neutral_chroma_tol
    bright = neutral & (lum >= 180.0)
    fallback = float(np.percentile(lum[bright], 95)) if bright.any() else 255.0

    edges = [int(e) for e in edges]
    out: list[float] = []
    for a, b in zip(edges[:-1], edges[1:]):
        band = bright[:, max(0, a):max(0, b)]
        out.append(float(np.percentile(lum[:, max(0, a):max(0, b)][band], 95))
                   if band.any() else fallback)
    return np.asarray(out, dtype=float)


def two_layer_split(
    rgb: np.ndarray,
    *,
    column_edges: Any = None,
    shadow_relative_lum: float = SHADOW_RELATIVE_LUM,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
    structure_min_run: int = STRUCTURE_LINE_MIN_RUN,
    structure_max_thickness: int = STRUCTURE_MAX_THICKNESS,
) -> dict[str, np.ndarray]:
    """Partition every pixel into ``background`` / ``shadow`` / ``solid``.

    The returned masks are mutually exclusive and cover the whole image.

    ``column_edges``
        Band boundaries (pixel x) used to estimate each column's own white
        point. Pass the column start/end list when you have it; with ``None`` the
        whole image shares one white point. This matters for two-layer figures
        printed in bands with slightly different paper tone — a single global
        white point then pushes one band's shadow across the boundary.

    ``background``
        纸面 + 表格线（细、长、中性的横线）。
    ``shadow``
        相对纸面"只淡一档"的中性层 —— 5× 夸张包络。
    ``solid``
        其余全部内容像素（彩色实心、黑线、彩色描边、中灰填充）。
    """
    rgb = np.asarray(rgb, dtype=float)[..., :3]
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= neutral_chroma_tol

    if column_edges is None:
        ref = float(np.percentile(lum[neutral & (lum >= 180.0)], 95)) \
            if (neutral & (lum >= 180.0)).any() else 255.0
    else:
        edges = [int(e) for e in column_edges]
        if len(edges) < 2:
            ref = float(np.percentile(lum[neutral & (lum >= 180.0)], 95))
        else:
            # 逐带白点 → 逐像素（向量化：把带号映射回列）。
            centres = [(a + b) // 2 for a, b in zip(edges[:-1], edges[1:])]
            white_pts = column_white_points(rgb, edges,
                                            neutral_chroma_tol=neutral_chroma_tol)
            col_of = np.searchsorted(np.asarray(centres), np.arange(rgb.shape[1]))
            col_of = np.clip(col_of, 0, len(white_pts) - 1)
            ref = white_pts[col_of][None, :]

    paper_level = ref
    near_paper = lum >= (paper_level * shadow_relative_lum)
    paper = neutral & (lum >= paper_level * 0.985)

    # 表格线：细 + 长 + 中性，三者缺一不可。
    structure = structure_line_mask(
        near_paper & neutral & (lum < 120.0),
        min_run=structure_min_run,
        max_thickness=structure_max_thickness,
    )
    structure |= structure_line_mask(
        near_paper & neutral & (lum >= 120.0),
        min_run=structure_min_run,
        max_thickness=structure_max_thickness,
    )

    shadow = near_paper & neutral & ~structure & ~paper
    background = paper | structure
    solid = ~background & ~shadow
    return {
        'background': background,
        'shadow': shadow,
        'solid': solid,
        'content_neutral': solid & neutral,
    }


def split_solid_and_shadow(
    rgb: np.ndarray,
    **kwargs: Any,
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(solid_mask, shadow_mask)``; see :func:`two_layer_split`.

    ``solid`` is what may be read. ``shadow`` is the exaggerated envelope and
    must never reach a reading.
    """
    parts = two_layer_split(rgb, **kwargs)
    return parts['solid'], parts['shadow']


def shadow_layers(rgb: np.ndarray, **kwargs: Any) -> dict[str, np.ndarray]:
    """The three exportable layers of a two-layer figure.

    * ``solid_neutral`` —— 灰阶实心（可作读数）
    * ``solid_color``   —— 彩色实心（可作读数）
    * ``shadow``        —— 夸张包络（仅供目视，永不参与读数）

    分三层导出而不是二选一：图注里"真实值层"与"夸张层"本就是两条独立声明，
    压成一个掩膜后，用户再也分不清哪个数是读出来的。
    """
    parts = two_layer_split(rgb, **kwargs)
    tol = kwargs.get('neutral_chroma_tol', NEUTRAL_CHROMA_TOL)
    rgb_arr = np.asarray(rgb, dtype=float)[..., :3]
    neutral = (rgb_arr.max(axis=-1) - rgb_arr.min(axis=-1)) <= tol
    return {
        'solid_neutral': parts['solid'] & neutral,
        'solid_color': parts['solid'] & ~neutral,
        'shadow': parts['shadow'],
    }
