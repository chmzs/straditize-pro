import { ToolMode } from '../../types/pollen';
import { ToolStrategy } from './ToolStrategy';
import { SelectToolStrategy } from './SelectToolStrategy';
import { PanToolStrategy } from './PanToolStrategy';
import { RoiToolStrategy } from './RoiToolStrategy';
import { AddColToolStrategy } from './AddColToolStrategy';
import { AddPointToolStrategy } from './AddPointToolStrategy';
import { EraserToolStrategy } from './EraserToolStrategy';
import { YCalibToolStrategy } from './YCalibToolStrategy';
import { LineFixToolStrategy } from './LineFixToolStrategy';
import { MeasureToolStrategy } from './MeasureToolStrategy';
import { DrawLineToolStrategy } from './DrawLineToolStrategy';

export * from './ToolStrategy';
export * from './SelectToolStrategy';
export * from './PanToolStrategy';
export * from './RoiToolStrategy';
export * from './AddColToolStrategy';
export * from './AddPointToolStrategy';
export * from './EraserToolStrategy';
export * from './YCalibToolStrategy';
export * from './LineFixToolStrategy';
export * from './MeasureToolStrategy';
export * from './DrawLineToolStrategy';

/**
 * 创建全量工具策略注册表映射。
 */
export function createToolStrategies(): Map<ToolMode, ToolStrategy> {
  const map = new Map<ToolMode, ToolStrategy>();

  const strategies: ToolStrategy[] = [
    new SelectToolStrategy(),
    new PanToolStrategy(),
    new RoiToolStrategy(),
    new AddColToolStrategy(),
    new AddPointToolStrategy(),
    new EraserToolStrategy(),
    new YCalibToolStrategy(),
    new LineFixToolStrategy(),
    new MeasureToolStrategy(),
    new DrawLineToolStrategy('drawLineH'),
    new DrawLineToolStrategy('drawLineV'),
  ];

  for (const s of strategies) {
    map.set(s.mode, s);
  }

  return map;
}
