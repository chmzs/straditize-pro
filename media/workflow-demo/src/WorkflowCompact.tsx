import {AbsoluteFill, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {Backdrop, Slot} from './components/Backdrop';
import {CaptionTrack, type CaptionItem} from './components/CaptionTrack';
import {StepShotView} from './scenes/StepShotView';
import {STEPS, type StepShotSpec} from './scenario';
import {COLORS, W} from './theme';
import {EASE} from './lib/camera';

/**
 * 网页动图专用的紧凑剪辑。
 * 长片那版每个镜头都在持续运镜，转成 GIF 会到 40 MB —— 网页首屏不能这么干。
 * 这里保持同样 10 个镜头、同样真值，但每镜压到 GIF_SHOT_FRAMES，
 * 并且首尾各留一段暗场拍子，让 loop 的首尾画面能对上。
 */

export const GIF_SHOT_FRAMES = 72;
export const GIF_BEAT_FRAMES = 10;
const SHOT_COUNT = STEPS.length;

export const GIF_TOTAL_FRAMES =
  GIF_BEAT_FRAMES * 2 + GIF_SHOT_FRAMES * SHOT_COUNT;

/**
 * 紧凑版每个镜头是**定位镜头**：固定取景在证据处（1.2 倍裁切），不做连续运镜。
 * 原因是 GIF 的帧间差分（transdiff）只对静止像素有效；
 * 只要画面在缩放/平移，每帧几乎全部像素都要重编，实测 69 秒长片转出来 40 MB。
 * 所以动图里由「高亮框描边生长 + 字幕 + 计数上浮」承担动效，画面本身不推拉。
 * 长片版（Workflow8Steps）保留完整运镜。
 */
const COMPACT_ZOOM = 1.2;

/** 把长片的运镜/描边时序等比压缩到紧凑镜头的长度。 */
const compactSpec = (spec: StepShotSpec): StepShotSpec => {
  const factor = GIF_SHOT_FRAMES / spec.frames;
  const scale = (n: number) => Math.round(n * factor);
  const last = spec.camera[spec.camera.length - 1];
  return {
    ...spec,
    frames: GIF_SHOT_FRAMES,
    camera: [{at: 0, x: last.x, y: last.y, scale: COMPACT_ZOOM}],
    boxes: spec.boxes.map((b) => ({
      ...b,
      delay: scale(b.delay ?? 0),
      until: b.until === undefined ? undefined : scale(b.until),
    })),
    masks: spec.masks?.map((m) => ({...m, delay: scale(m.delay ?? 0)})),
  };
};

const COMPACT = STEPS.map(compactSpec);

const CAPTIONS: CaptionItem[] = COMPACT.map((spec, i) => ({
  from: GIF_BEAT_FRAMES + i * GIF_SHOT_FRAMES,
  frames: GIF_SHOT_FRAMES,
  accent: spec.tone === 'warm' ? COLORS.amber : COLORS.cyan,
  caption: spec.caption,
}));

/** 暗场拍子：开场淡出暗场，收尾淡入暗场，loop 首尾都落在暗场。 */
const Beat = ({dir}: {dir: 'in' | 'out'}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, GIF_BEAT_FRAMES],
    dir === 'in' ? [1, 0] : [0, 1],
    {easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return <AbsoluteFill style={{backgroundColor: COLORS.bgDeep, opacity}} />;
};

export const WorkflowCompact = () => {
  const frame = useCurrentFrame();
  const tail = Math.min(1, (GIF_TOTAL_FRAMES - 1 - frame) / 20);

  return (
    <AbsoluteFill>
      <Backdrop />
      <Sequence from={0} durationInFrames={GIF_BEAT_FRAMES}>
        <Beat dir="in" />
      </Sequence>
      {COMPACT.map((spec, i) => (
        <Sequence
          key={spec.id}
          from={GIF_BEAT_FRAMES + i * GIF_SHOT_FRAMES}
          durationInFrames={GIF_SHOT_FRAMES}
        >
          <Slot dur={GIF_SHOT_FRAMES}>
            <StepShotView spec={spec} />
          </Slot>
        </Sequence>
      ))}
      <Sequence
        from={GIF_BEAT_FRAMES + SHOT_COUNT * GIF_SHOT_FRAMES}
        durationInFrames={GIF_BEAT_FRAMES}
      >
        <Beat dir="out" />
      </Sequence>

      <CaptionTrack items={CAPTIONS} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 4,
          width: (W * frame) / (GIF_TOTAL_FRAMES - 1),
          background: `linear-gradient(90deg, ${COLORS.blue}, ${COLORS.cyan})`,
          opacity: 0.6 * tail,
        }}
      />
    </AbsoluteFill>
  );
};
