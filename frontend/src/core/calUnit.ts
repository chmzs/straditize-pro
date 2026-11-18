/**
 * Y 轴单位的**唯一**显示入口。
 *
 * 不变量：面向用户的单位只能来自真实输入——后端 `session.depth_unit`（由
 * `core.calibrateAxes` 的 `unit` 参数或工程包的 `depth_calibration.unit` 写入）
 * 或用户在图 3 填的值。取不到就显示"单位未定"，**绝不**显示 cm：图上可能是 ka
 * 年代轴，猜一个单位不会报错，只会把整柱样品按错的单位解释（#111）。
 *
 * 为什么收口到一个函数：同一份缺单位状态下，页脚曾打 `undefined`、属性面板曾打
 * `undefined`、画布徽标曾猜 `cm`、Y 标定面板则说"单位未定"——四种说法并存，
 * 用户无法判断哪个是真的。现在文案只来自 i18n 键 `step3.unitUnset` 一处，
 * 各处只决定排版（前缀、括号、分隔符），不决定语义。
 *
 * 注：`DepthCalibration.unit` 的类型仍是必填 `string`，但运行期可能缺席（#111 上游
 * 归一化不再补 cm）。类型与运行期这层不一致是已知的契约级问题，待单独收口；
 * 本函数按运行期真值判断，不信任类型。
 */
import type { DepthCalibration } from '../types/pollen';
import { t } from '../i18n';

/** 单位标签：有真单位就原样返回，缺就返回 i18n 的"单位未定"。 */
export function calUnitLabel(cal: Pick<DepthCalibration, 'unit'> | null | undefined): string {
  const unit = (cal?.unit ?? '').trim();
  return unit === '' ? t('step3.unitUnset') : unit;
}
