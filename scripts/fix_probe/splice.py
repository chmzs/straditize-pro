# -*- coding: utf-8 -*-
"""把 scripts/fix_probe/new_block.py 嵌入 straditize_core/image.py。"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "straditize_core" / "image.py"
BLOCK = Path(__file__).with_name("new_block.py")

START = "# ---------------------------------------------------------------------------\n# 「实心层 + 夸张阴影层」"
END = "def build_foreground(arr: np.ndarray,"

text = TARGET.read_text(encoding="utf-8")
i = text.index(START)
j = text.index(END)
new = BLOCK.read_text(encoding="utf-8")
TARGET.write_text(text[:i] + new + "\n\n" + text[j:], encoding="utf-8")
print(f"replaced {j - i} chars with {len(new)} chars")
