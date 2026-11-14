import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
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
import {sentenceOffsets, sentencesOf} from './narration';
import {COLORS, W} from './theme';

type Item = {
  key: string;
  /** narration-timing.json 里的键名；同时决定音频与字幕 */
  narrationId: string;
  frames: number;
  kind: 'step' | 'card';
  node: React.ReactNode;
};

const ITEMS: Item[] = [
  {key: 'open', narrationId: 'opening', frames: OPENING_FRAMES, kind: 'card', node: <Opening />},
  ...STEPS.map((spec) => ({
    key: spec.id,
    narrationId: spec.id,
    frames: spec.frames,
    kind: 'step' as const,
    node: <StepShotView spec={spec} />,
  })),
  {key: 'ledger', narrationId: 'ledger', frames: LEDGER_FRAMES, kind: 'card', node: <Ledger />},
  {
    key: 'close',
    narrationId: 'closing',
    frames: CLOSING_FRAMES,
    kind: 'card',
    node: <Closing dur={CLOSING_FRAMES} />,
  },
];

/** 时间轴：相邻镜头重叠 OVERLAP_FRAMES 帧（后一镜压在前一镜上做遮罩滑动）。 */
const PLACED = (() => {
  let at = 0;
  return ITEMS.map((item) => {
    const placed = {...item, from: at};
    at += item.frames - OVERLAP_FRAMES;
    return placed;
  });
})();

/** 镜头内的逐句音频：起止由同一份时长表决定，与字幕窗口同源。 */
const Narration = ({id}: {id: string}) => {
  const offsets = sentenceOffsets(id);
  return (
    <>
      {sentencesOf(id).map((sentence, i) => (
        <Sequence
          key={sentence.file}
          from={offsets[i]}
          durationInFrames={Math.ceil(sentence.dur * 30) + 2}
        >
          <Audio src={staticFile(sentence.file)} />
        </Sequence>
      ))}
    </>
  );
};

/**
 * 字幕：一句一条。窗口严格取该句音频的起止（下一句开始即换行），
 * 正文直接来自 narration-timing.json —— 与 TTS 输入是同一个字符串，没有第二份。
 */
const CAPTIONS: CaptionItem[] = PLACED.flatMap((item, i) => {
  const spec = STEPS[i - 1];
  if (i === 0 || !spec) {
    return [];
  }
  const sentences = sentencesOf(spec.id);
  const offsets = sentenceOffsets(spec.id);
  const accent = spec.tone === 'warm' ? COLORS.amber : COLORS.cyan;

  return sentences.map((sentence, k) => {
    const from = item.from + offsets[k];
    const next = k + 1 < sentences.length ? item.from + offsets[k + 1] : item.from + item.frames;
    return {
      from,
      frames: Math.max(6, next - from),
      accent,
      caption: {
        index: spec.caption.index,
        title: spec.caption.title,
        detail: sentence.text,
        stat: k === 0 ? spec.caption.stat : undefined,
      },
    };
  });
});

/** 全片进度线：一条不间断的测量刻度，把镜头缝成一次连续的操作。 */
const ProgressLine = () => {
  const frame = useCurrentFrame();
  const p = Math.min(1, Math.max(0, frame / (TOTAL_FRAMES - 1)));
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
        {/* 纯排版镜头硬切：整屏是字，用遮罩扫进来会出现「半屏空暗场」的中间帧 */}
        <Slot dur={item.frames} fadeIn={item.kind === 'step' ? OVERLAP_FRAMES : 0}>
          {item.node}
        </Slot>
        <Narration id={item.narrationId} />
      </Sequence>
    ))}
    <CaptionTrack items={CAPTIONS} />
    <ProgressLine />
  </AbsoluteFill>
);
