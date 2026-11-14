import {Sequence, useCurrentFrame} from 'remotion';
import {Caption} from './Caption';
import type {Stat} from '../scenario';

export type CaptionItem = {
  from: number;
  frames: number;
  accent: string;
  caption: {index: string; title: string; detail: string; stat?: Stat};
};

/**
 * 字幕轨：全片只有一条字幕，挂在所有镜头**之上**。
 * 之前把字幕放在每个镜头里，镜头用遮罩滑动叠在一起时，
 * 两条字幕会在左下角同一位置叠字（抽帧抽到就是一张废图）。
 * 现在按时间轴取"当前主镜头"的字幕，任一帧有且只有一条字幕、且不透明。
 */
export const CaptionTrack = ({items}: {items: CaptionItem[]}) => {
  const frame = useCurrentFrame();

  let active: CaptionItem | null = null;
  for (const item of items) {
    if (frame >= item.from && frame < item.from + item.frames) {
      active = item;
    }
  }
  if (!active) {
    return null;
  }

  return (
    <Sequence from={active.from} durationInFrames={active.frames}>
      <Caption {...active.caption} accent={active.accent} dur={active.frames} />
    </Sequence>
  );
};
