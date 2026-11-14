import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {Backdrop, Slot} from './components/Backdrop';
import {CaptionTrack, type CaptionItem} from './components/CaptionTrack';
import {Opening} from './scenes/Opening';
import {StepShotView} from './scenes/StepShotView';
import {Ledger} from './scenes/Ledger';
import {Closing} from './scenes/Closing';
import {
  CLOSING_FRAMES,
  LEDGER_FRAMES,
  OPENING_FRAMES,
  OVERLAP_FRAMES,
  STEPS,
  TOTAL_FRAMES,
} from './scenario';
import {COLORS, W} from './theme';

type Item = {key: string; frames: number; kind: 'step' | 'card'; node: React.ReactNode};

/** 所有镜头按顺序排布，相邻两个重叠 OVERLAP_FRAMES 帧（后一镜压在前一镜上淡入）。 */
const ITEMS: Item[] = [
  {key: 'open', frames: OPENING_FRAMES, kind: 'card', node: <Opening />},
  ...STEPS.map((spec) => ({
    key: spec.id,
    frames: spec.frames,
    kind: 'step' as const,
    node: <StepShotView spec={spec} />,
  })),
  {key: 'ledger', frames: LEDGER_FRAMES, kind: 'card', node: <Ledger />},
  {key: 'close', frames: CLOSING_FRAMES, kind: 'card', node: <Closing dur={CLOSING_FRAMES} />},
];

const PLACED = (() => {
  let at = 0;
  return ITEMS.map((item) => {
    const placed = {...item, from: at};
    at += item.frames - OVERLAP_FRAMES;
    return placed;
  });
})();

/** 字幕轨：只取步骤镜头的字幕（开场/账本/收尾没有字幕）。
 *  每条的窗口严格截止到「下一场景开始」，所以字幕既不会断档，也不会残留在账本页上。 */
const CAPTIONS: CaptionItem[] = PLACED.flatMap((item, i) => {
  const spec = STEPS[i - 1];
  const next = PLACED[i + 1];
  if (i === 0 || !spec || !next) {
    return [];
  }
  return [
    {
      from: item.from,
      frames: next.from - item.from,
      accent: spec.tone === 'warm' ? COLORS.amber : COLORS.cyan,
      caption: spec.caption,
    },
  ];
});

/** 全片进度线：一条不间断的测量刻度，把 13 个镜头缝成一次连续的操作。 */
const ProgressLine = () => {
  const frame = useCurrentFrame();
  const p = Math.min(1, Math.max(0, frame / (TOTAL_FRAMES - 1)));
  // 收尾淡出：末帧与首帧都不见这条线，动图循环才无缝
  const tail = Math.min(1, (TOTAL_FRAMES - 1 - frame) / 36);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: W * p,
        height: 4,
        background: `linear-gradient(90deg, ${COLORS.blue}, ${COLORS.cyan})`,
        opacity: 0.6 * tail,
        boxShadow: `0 0 20px ${COLORS.cyan}`,
      }}
    />
  );
};

export const Workflow = () => (
  <AbsoluteFill>
    <Backdrop />
    {PLACED.map((item) => (
      <Sequence key={item.key} from={item.from} durationInFrames={item.frames}>
        {/* 纯排版镜头硬切：它们整屏是字，用遮罩扫进来会出现「半屏空暗场」的中间帧 */}
        <Slot dur={item.frames} fadeIn={item.kind === 'step' ? OVERLAP_FRAMES : 0}>
          {item.node}
        </Slot>
      </Sequence>
    ))}
    <CaptionTrack items={CAPTIONS} />
    <ProgressLine />
  </AbsoluteFill>
);
