import rawTiming from './narration-timing.json';

/**
 * 配音时长表（由 tools/synthesize_narration.py 用 ffprobe 量出，禁止手改）。
 * 画面时长、字幕窗口、音频起点三者都从这里取，保证「音画字幕同源」。
 */
export type Sentence = {text: string; file: string; dur: number};

export type NarrationItem = {
  sentences: Sentence[];
  /** 该镜所有句子音频总时长（秒） */
  dur: number;
  /** 镜头帧数 = round((dur + tailPad) * fps) */
  frames: number;
};

type TimingFile = {
  voice: string;
  fps: number;
  tailPadSeconds: number;
  items: Record<string, NarrationItem>;
};

export const TIMING = rawTiming as unknown as TimingFile;
export const FPS = TIMING.fps;

export const narrationOf = (id: string): NarrationItem | undefined => TIMING.items[id];

export const framesOf = (id: string): number => {
  const item = TIMING.items[id];
  if (!item) {
    throw new Error(`narration-timing.json 里没有镜头 "${id}"，先跑 tools/synthesize_narration.py`);
  }
  return item.frames;
};

export const sentencesOf = (id: string): Sentence[] => TIMING.items[id]?.sentences ?? [];

/** 每句相对镜头起点的帧偏移（累加音频时长，四舍五入到帧）。 */
export const sentenceOffsets = (id: string): number[] => {
  const sentences = sentencesOf(id);
  let acc = 0;
  return sentences.map((sentence) => {
    const offset = Math.round(acc * FPS);
    acc += sentence.dur;
    return offset;
  });
};
