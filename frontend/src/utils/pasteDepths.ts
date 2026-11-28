export interface PasteDepthsParseResult {
  depths: number[];
  invalidCount: number;
  duplicateCount: number;
}

const STRICT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parsePasteDepthsText(raw: string): PasteDepthsParseResult {
  const tokens = raw
    .split(/[\r\n,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const nums: number[] = [];
  let invalidCount = 0;

  for (const token of tokens) {
    if (!STRICT_NUMBER_RE.test(token)) {
      invalidCount += 1;
      continue;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      invalidCount += 1;
      continue;
    }
    nums.push(value);
  }

  const depths = Array.from(new Set(nums)).sort((a, b) => a - b);
  const duplicateCount = nums.length - depths.length;
  return { depths, invalidCount, duplicateCount };
}
