/**
 * `algorithm.measureRuler` 的返回结构（步骤 6「参考标尺模数」）。
 *
 * 契约出处：`straditize_core/session_parts/xticks.py::measure_ruler_geometry`
 * → `straditize_core/ruler.py::detect_ruler_for_columns`。
 *
 * **本接口只产出几何，不产出读数**：一条刻线之间代表多少单位是作图书版的设定，
 * 图上没有任何信息可推（跨列外推实测误差 84%–151%，见 `ruler.py::suggest_scales`
 * 的反证表）。所以这里**故意**没有任何"建议量程"字段，唯一相关的
 * `calibration_suggestions` 恒为空数组。
 */

/** 单列刻线几何。 */
export interface RulerGeometryColumn {
  /** 后端列序号（与 `Column.col_index` 一致，是列的唯一稳定寻址）。 */
  col_index: number | null;
  name: string | null;
  /** 刻度尺所依附的横轴线所在行（像素 y）；未找到轴线为 null。 */
  axis_row: number | null;
  /**
   * 轴行**在有效区之外**时的实测行号；`null` = 窗口内确实找不到轴行。
   *
   * 语义严格区分两种情况（后端口径，`ruler.py::find_axis_row_below_roi`）：
   *   * `number` ⇒ 轴行存在，但在 ROI 下边界之下 —— 界面可以报出这个 y 并让用户
   *     把下边界下移到它以下；
   *   * `null` ⇒ **确实找不到**轴行（图本来没有刻度尺）—— 界面必须退回
   *     "未找到刻度尺"的说法，**不得**编一个 y。
   *
   * 只在 `axis_row` 为 null（有效区内没找到）时才有值；两者不会同时非空。
   */
  axis_row_outside_roi?: number | null;
  /** 刻线 x 中心，升序。空数组 = 该列没检测到刻线。 */
  ticks: number[];
  /** 画出来的刻线间隔数 = `len(ticks) - 1`；**不是**该列视觉格数。 */
  n_cells: number;
  /** 相邻刻线间距的中位数（px）；不足两条刻线时为 null。 */
  spacing_px: number | null;
  /** 所有间距是否都在中位数 ±8% 内。 */
  regular: boolean | null;
  /** 该列窗口宽度（px）。 */
  column_width: number;
  /**
   * 该列**轴线（spine）**的实测 x —— 面积/柱状图的 0 点就画在这里。
   *
   * `Column.startX` 是列切分给的边界代理，实测可偏离轴线数个像素（22 列图上见过 6px），
   * 拿它当 0 点会让整列曲线系统性偏移。标定锚点一律用它。
   * 轴线未能识别时为 null（调用方退回 `startX`）。
   */
  axis_x?: number | null;
  /** 轴线描边右缘（数据实际起点）；描边宽 1–3px，与左缘差不到半个单位。 */
  axis_x_right?: number | null;
}

/** 整个 ROI 的刻线几何结果。 */
export interface RulerGeometry {
  roi_id: string | null;
  per_column: RulerGeometryColumn[];
  /** 全 ROI 中位刻距（px）；一列都没测到时为 null。 */
  median_spacing_px: number | null;
  /** 所有已测得列都规则时为 true；一列都没测得时为 null。 */
  all_regular: boolean | null;
  /** 恒为空：后端拒绝按格数外推读数。 */
  calibration_suggestions: unknown[];
  /** 后端写明的"不产出读数"声明，面板原样展示给用户。 */
  note?: string;
}
