/**
 * 组级手动标定在画布上的标记（0 点 + 用户点选的那条齿）。
 *
 * 只存**用户亲手点出来的一对数**：标定齿的像素与它的读数。没有任何检测结果，
 * 没标定过的组就没有标记（ARCHITECTURE §6.4；不变量：用户数据只能来自用户输入）。
 *
 * 为什么放在模块级而不是穿过 canvas：标记由步骤 6 面板在「应用」时写入，
 * 画布在渲染时读取，与 data 的刷新时机无关。
 */
export interface GroupCalibMark {
  /** 用户点选的那条齿的世界像素 x。 */
  px: number;
  /** 用户为它填的读数（如图上标签 10）。 */
  reading: number;
  /** 距本列 0 点的距离（像素）。 */
  dist?: number;
  /** 点选齿所在的列 id。 */
  col_id?: string;
}

const marks = new Map<string, GroupCalibMark>();
let requestRedraw: (() => void) | null = null;

export function setGroupCalibRedrawHook(fn: (() => void) | null): void {
  requestRedraw = fn;
}

export function setGroupCalibMark(
  groupId: string | null | undefined,
  mark: GroupCalibMark | null
): void {
  if (!groupId) return;
  const prev = marks.get(groupId);
  if (!mark) {
    if (!prev) return;
    marks.delete(groupId);
  } else {
    if (prev && prev.px === mark.px && prev.reading === mark.reading) return;
    marks.set(groupId, mark);
  }
  requestRedraw?.();
}

export function getGroupCalibMark(
  groupId: string | null | undefined,
  group?: { calib_mark?: GroupCalibMark | null } | null
): GroupCalibMark | null {
  if (!groupId) return null;
  const mark = marks.get(groupId);
  if (mark) return mark;
  if (group?.calib_mark) {
    marks.set(groupId, group.calib_mark);
    return group.calib_mark;
  }
  return null;
}

export function clearAllGroupCalibMarks(): void {
  marks.clear();
  requestRedraw?.();
}

/** 画布标签统一 3 位小数以内（0.1724137931034483 → 0.172）。 */
export function formatCalibNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toFixed(3)));
}
