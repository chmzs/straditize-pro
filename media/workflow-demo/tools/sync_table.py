# -*- coding: utf-8 -*-
"""打印「音画字幕同步表」：每句音频的绝对起止 ↔ 字幕窗口 ↔ 字幕正文。

数据全部来自 narration-timing.json（脚本生成，不手改）；时间轴按与
src/Workflow.tsx 相同的规则重算（开场 → 各镜 → 账本 → 收尾，相邻重叠 OVERLAP 帧）。
用来核对：字幕窗口是否正好等于该句音频的起止、字幕正文是否就是 TTS 的输入。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMING = json.loads((ROOT / "src" / "narration-timing.json").read_text(encoding="utf-8"))
NARRATION = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))

FPS = TIMING["fps"]
OVERLAP = 5

ORDER = ["opening"] + list(NARRATION["shots"].keys()) + ["ledger", "closing"]


def main() -> None:
    at = 0
    placed = {}
    for key in ORDER:
        placed[key] = at
        at += TIMING["items"][key]["frames"] - OVERLAP
    total = at + OVERLAP

    print(f"voice={TIMING['voice']}  fps={FPS}  total={total}f = {total / FPS:.3f}s\n")
    print(f"{'镜头':22s} {'镜头帧':>7s} {'句':>2s} {'音频起点':>9s} {'音频止点':>9s} "
          f"{'字幕起点':>9s} {'字幕止点':>9s}  正文")
    mismatches = 0
    for key in ORDER:
        item = TIMING["items"][key]
        base = placed[key]
        acc = 0.0
        for i, sentence in enumerate(item["sentences"]):
            a0 = base + round(acc * FPS)
            a1 = a0 + round(sentence["dur"] * FPS)
            acc += sentence["dur"]
            nxt = (base + round(acc * FPS)) if i + 1 < len(item["sentences"]) else base + item["frames"]
            c0, c1 = a0, max(6, nxt - a0)
            flag = "" if c0 == a0 else "  <<MISMATCH"
            if flag:
                mismatches += 1
            print(f"{key:22s} {item['frames']:7d} {i:2d} {a0 / FPS:9.3f} {a1 / FPS:9.3f} "
                  f"{c0 / FPS:9.3f} {(c0 + c1) / FPS:9.3f}  {sentence['text']}{flag}")
    print(f"\n字幕窗口与音频起点不一致的句子数：{mismatches}")
    print(f"视频总长 {total / FPS:.3f}s")


if __name__ == "__main__":
    main()
