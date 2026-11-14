import {AbsoluteFill} from 'remotion';
import {COLORS, IMG} from '../theme';
import {useCamera} from '../lib/camera';
import type {StepShotSpec} from '../scenario';
import {Tone} from '../components/Backdrop';
import {Screen} from '../components/Screen';
import {Highlight} from '../components/Highlight';
import {MaskLayer} from '../components/MaskLayer';

/**
 * 通用镜头内容：一段运镜 + 若干高亮框 + 一条字幕。
 * 不写任何坐标和数字，全部从 scenario.ts 读；换演示对象不用改本文件。
 * 转场包络由 Workflow 的 Slot 统一负责，这里只管内容。
 */
export const StepShotView = ({spec}: {spec: StepShotSpec}) => {
  const cam = useCamera(spec.camera, IMG.w, IMG.h);
  const accent = spec.tone === 'warm' ? COLORS.amber : COLORS.cyan;

  return (
    <AbsoluteFill>
      <Tone tone={spec.tone} />
      <Screen src={spec.image} cam={cam}>
        {(spec.masks ?? []).map((mask, i) => (
          <MaskLayer key={`m${i}`} mask={mask} />
        ))}
        {spec.boxes.map((box) => (
          <Highlight
            key={`${box.x}-${box.y}-${box.w}`}
            x={box.x}
            y={box.y}
            w={box.w}
            h={box.h}
            delay={box.delay ?? 0}
            until={box.until}
            color={box.color ?? accent}
            label={box.label}
          />
        ))}
      </Screen>
    </AbsoluteFill>
  );
};
