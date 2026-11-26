/**
 * 撤销/重做的**动作构造器**（U2/U3 的纯逻辑部分）。
 *
 * 这里不做任何 RPC 调用：调用方把"怎么应用一组参数"注入进来（`apply`），
 * 构造器只负责产出 `UndoableOp`（label / inverse / forward / verify 的语义与顺序）。
 * 这样：
 * - 构造器可以单元测试（传假的 apply，断言调用参数与次数）；
 * - 接线（把构造器接到真实 `rpcClient` 与 UI）可以单独做、单独验证。
 *
 * 设计约束（都来自实测缺陷，见 docs/findings/undo-redesign-2026-11-11.md）：
 * 1. **逆操作必须调用"同一个动作的写通道"**，参数用改前的值 —— 旧实现的病根是
 *    撤销时发的是别的东西（撤销标定发 `roi.update`、撤销改名发 `applyLineRemoval`）。
 * 2. **verify 读后端权威状态**，不是 DOM / 不是前端镜像。
 * 3. 撤销失败或复核不通过时，栈会保留该操作（由 `UndoStack` 负责），构造器不得
 *    自己吞掉异常或伪造成功。
 */
import type { UndoableOp } from './UndoStack.ts';

/** Y 轴标定的两端（后端 `core.calibrateAxes` 的参数子集）。 */
export interface DepthCalibrationPatch {
  topPx: number;
  topValue: number;
  bottomPx: number;
  bottomValue: number;
  unit: string;
  primaryAxis?: string;
}

export interface CalibrationSnapshot extends DepthCalibrationPatch {
  isCalibrated: boolean;
}

/**
 * 把"当前标定快照"与"应用一组标定参数"合成一个可撤销动作。
 *
 * @param prev   动作**之前**的快照（撤销要回到这里）
 * @param next   动作**之后**的快照（重做要回到这里）
 * @param apply  应用一组参数（接线时注入 `rpcClient.calibrateAxes`）
 * @param read   读后端当前标定（接线时注入 `getDiagramData().calibration` 的映射）
 */
export function makeCalibrationUndo(
  prev: CalibrationSnapshot,
  next: CalibrationSnapshot,
  apply: (patch: DepthCalibrationPatch) => Promise<void>,
  read: () => Promise<CalibrationSnapshot>
): UndoableOp {
  const same = (a: CalibrationSnapshot, b: CalibrationSnapshot): boolean =>
    a.isCalibrated === b.isCalibrated &&
    a.topPx === b.topPx &&
    a.topValue === b.topValue &&
    a.bottomPx === b.bottomPx &&
    a.bottomValue === b.bottomValue &&
    a.unit === b.unit &&
    (a.primaryAxis ?? 'age') === (b.primaryAxis ?? 'age');

  return {
    label: `标定 ${prev.topValue}${prev.unit} → ${next.topValue}${next.unit}（Y 轴）`,
    inverse: () => apply(prev),
    forward: () => apply(next),
    verify: async (direction) => same(await read(), direction === 'inverse' ? prev : next),
  };
}

export type RenameKind = 'roi' | 'column';

/**
 * 改名类动作的构造器（ROI 名 / 列名）。
 *
 * @param kind    哪一类（只影响 label 与日志，不参与判定）
 * @param id      ROI id 或列 id
 * @param oldName 改前的名字
 * @param newName 改后的名字
 * @param apply   用给定名字写库（接线时注入 `roi.update{roi_id,name}` 或 `column.rename`）
 * @param read    读后端当前名字（接线时注入按 id 查 `getDiagramData()` 的映射）
 */
export function makeRenameUndo(
  kind: RenameKind,
  id: string,
  oldName: string,
  newName: string,
  apply: (name: string) => Promise<void>,
  read: () => Promise<string>
): UndoableOp {
  const kindLabel = kind === 'roi' ? '有效区' : '列';
  return {
    label: `重命名${kindLabel} ${oldName} → ${newName}（${id}）`,
    inverse: () => apply(oldName),
    forward: () => apply(newName),
    verify: async (direction) => (await read()) === (direction === 'inverse' ? oldName : newName),
  };
}

export interface ControlPointWriteback {
  row: number;
  x: number;
  manual?: boolean;
}

/**
 * 控制点整列写回类动作的构造器（#143：添加 / 拖动 / 微调 / 删除锚点）。
 *
 * 逆操作与重做均走同一 `setControlPoints` 写入口，确保后端 `column_points` 与前端镜像同步回退。
 */
export function makeControlPointsUndo<TPoint>(
  colName: string,
  prevWriteback: ControlPointWriteback[],
  nextWriteback: ControlPointWriteback[],
  prevPoints: TPoint[],
  nextPoints: TPoint[],
  apply: (writeback: ControlPointWriteback[], uiPoints: TPoint[]) => Promise<void>,
  read: () => Promise<ControlPointWriteback[]>
): UndoableOp {
  /**
   * 行号序列是这条动作的**稳定签名**：`row` 是整数行号，`x` 是浮点读数
   * （后端可能按 0.1px 归一），拿 x 做严格相等会在合法实现上假红。
   * 用「点数 + 行号序列」足以区分 #143 的病根——"后端根本没变"时签名必然相同。
   */
  const signature = (pts: readonly ControlPointWriteback[]): string =>
    `${pts.length}|${pts.map((point) => point.row).join(',')}`;
  return {
    label: `编辑控制点 ${colName}（${prevPoints.length} → ${nextPoints.length}）`,
    inverse: () => apply(prevWriteback, prevPoints),
    forward: () => apply(nextWriteback, nextPoints),
    // 复核读后端权威状态（不是前端镜像）：撤销要等于 prev、重做要等于 next。
    verify: async (direction) =>
      signature(await read()) ===
      signature(direction === 'inverse' ? prevWriteback : nextWriteback),
  };
}

/**
 * 通用值写回类动作的构造器（列边界、轴线粗、形态覆盖、X 刻度、ROI 边界等）。
 *
 * 逆操作与重做均走同一写通道，参数分别为改前值与改后值；verify 读后端权威状态比对。
 */
export function makeValueUndo<T>(
  label: string,
  prevValue: T,
  nextValue: T,
  apply: (value: T) => Promise<void>,
  read: () => Promise<T>,
  equals: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): UndoableOp {
  return {
    label,
    inverse: () => apply(prevValue),
    forward: () => apply(nextValue),
    verify: async (direction) =>
      equals(await read(), direction === 'inverse' ? prevValue : nextValue),
  };
}

/**
 * 集合新增类动作的构造器（新增列 / 新增 ROI）：
 * 撤销时调用对应的删除通道移除新建实体；重做时重新创建。
 */
export function makeCollectionAddUndo(
  label: string,
  removeAdded: () => Promise<void>,
  recreateAdded: () => Promise<void>,
  readCount: () => Promise<number>,
  expectedPrevCount: number,
  expectedNextCount: number
): UndoableOp {
  return {
    label,
    inverse: () => removeAdded(),
    forward: () => recreateAdded(),
    verify: async (direction) =>
      (await readCount()) === (direction === 'inverse' ? expectedPrevCount : expectedNextCount),
  };
}

/**
 * 不可撤销动作清单：
 * 删除有列的分区 / 删除列及整表清空/批量重算类动作没有单步逆操作通道，
 * 按设计不得入栈 —— UI 上撤销按钮不亮，也不得编造假逆操作。
 */
export const NON_UNDOABLE = [
  'roi.remove(有列)',
  'column.remove',
  'column.clearAll',
  'column.redetect',
  'xTicks.clearAll',
  'column.batchDigitize',
  'column.batchPlotType',
  'column.insertGap',
  'webmcp.sync',
] as const;
