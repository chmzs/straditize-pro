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
  primaryAxis?: 'depth' | 'age';
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
    (a.primaryAxis ?? 'depth') === (b.primaryAxis ?? 'depth');

  return {
    label: `标定 ${prev.topValue}${prev.unit} → ${next.topValue}${next.unit}（Y 轴）`,
    inverse: () => apply(prev),
    forward: () => apply(next),
    verify: async () => same(await read(), prev),
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
    label: `重命名${kindLabel} ${oldName} → ${newName}`,
    inverse: () => apply(oldName),
    forward: () => apply(newName),
    verify: async () => (await read()) === oldName,
  };
}

/**
 * 删除类动作**故意不提供构造器**：
 * 删除有列的分区 / 删除列目前没有逆操作（后端无"恢复"通道），
 * 按设计它们不得入栈 —— UI 上撤销按钮应保持 disabled 并说明"该操作不可撤销"。
 * 这条注释是给未来实现者的路标：别为了"让撤销按钮亮起来"给删除编一个假逆操作。
 */
export const NON_UNDOABLE = ['roi.remove(有列)', 'column.remove'] as const;
