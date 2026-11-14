# -*- coding: utf-8 -*-
"""解说词 → 逐句 TTS → 真实时长表。

事实源只有一个：narration.json。本脚本读它，产出
  1) public/voice/<key>-<n>.mp3  逐句音频
  2) src/narration-timing.json   每句的真实时长（ffprobe 读，不估算）

画面时长与字幕窗口都由 narration-timing.json 推导，所以"画面驱动"改成"配音驱动"后
只有这一个输入。改解说词 = 改 narration.json 后重跑本脚本再重渲。

用法：
    python tools/synthesize_narration.py            # 全量重生成
    python tools/synthesize_narration.py --check    # 只校验已有文件与时长表是否一致
"""
import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NARRATION = ROOT / "narration.json"
VOICE_DIR = ROOT / "public" / "voice"
TIMING_OUT = ROOT / "src" / "narration-timing.json"

FPS = 30
# 每镜末尾留白：0.5s，落在 0.4–0.6 的区间中点
TAIL_PAD = 0.5
MIN_FRAMES = 60


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return round(float(out.stdout.strip()), 3)


def collect(narration: dict) -> list[tuple[str, list[str]]]:
    """按时间轴顺序返回 [(key, [句子…]), …]。"""
    items: list[tuple[str, list[str]]] = [("opening", narration["opening"])]
    for key, sentences in narration["shots"].items():
        items.append((key, sentences))
    if "ledger" in narration:
        items.append(("ledger", narration["ledger"]))
    items.append(("closing", narration["closing"]))
    return items


async def synth(text: str, voice: str, dest: Path) -> None:
    import edge_tts

    dest.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(dest))


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    narration = json.loads(NARRATION.read_text(encoding="utf-8"))
    voice = narration["voice"]
    items = collect(narration)

    table: dict = {
        "voice": voice,
        "fps": FPS,
        "tailPadSeconds": TAIL_PAD,
        "items": {},
    }

    problems: list[str] = []

    for key, sentences in items:
        entry = {"sentences": [], "dur": 0.0, "frames": 0}
        for index, text in enumerate(sentences):
            rel = f"voice/{key}-{index}.mp3"
            dest = ROOT / "public" / rel
            if not args.check:
                await synth(text, voice, dest)
            if not dest.exists():
                problems.append(f"缺少音频：{rel}")
                continue
            dur = probe_duration(dest)
            if dur <= 0.2:
                problems.append(f"音频过短（疑为空）：{rel} {dur}s")
            entry["sentences"].append({"text": text, "file": rel, "dur": dur})
            entry["dur"] = round(entry["dur"] + dur, 3)

        entry["frames"] = max(MIN_FRAMES, round((entry["dur"] + TAIL_PAD) * FPS))
        table["items"][key] = entry
        print(f"{key:24s} {entry['dur']:6.3f}s -> {entry['frames']:4d}f  "
              f"«{sentences[0][:18]}…»")

    if problems:
        for problem in problems:
            print("ERROR " + problem, file=sys.stderr)
        return 1

    total_frames = sum(item["frames"] for item in table["items"].values())
    table["totalFramesNoTransition"] = total_frames
    TIMING_OUT.write_text(
        json.dumps(table, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n写入 {TIMING_OUT.relative_to(ROOT)} ；逐镜头合计 {total_frames} 帧")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
