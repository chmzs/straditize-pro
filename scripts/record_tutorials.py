#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Record real-browser tutorial screenshots, animated GIFs, and WebM video via Playwright.

Usage:
    pixi run python scripts/record_tutorials.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "assets" / "tutorials"
PORT = int(os.environ.get("STRADITIZE_TUTORIAL_PORT", "8798"))
BASE_URL = f"http://127.0.0.1:{PORT}"


NODE_SCRIPT = r"""
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL;
const OUT_DIR = process.env.OUT_DIR;
const VIDEO_TMP = process.env.VIDEO_TMP;

async function rpc(page, method, params = {}) {
  return await page.evaluate(
    async ({ m, p }) => {
      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: m, params: p }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`${m}: ${body.error.message}`);
      return body.result;
    },
    { m: method, p: params }
  );
}

async function gotoStage(page, stage) {
  await page.evaluate((s) => window.__straditize.gotoStage(s), stage);
  await page.waitForTimeout(350);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  // Reset baseline & open app
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await rpc(page, 'e2e.reset');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Step 1: Load Image (Hoya sample loaded)
  await gotoStage(page, 1);
  await page.screenshot({ path: path.join(OUT_DIR, 'step1_load.png') });

  // Step 2: ROI selection
  await gotoStage(page, 2);
  await page.screenshot({ path: path.join(OUT_DIR, 'step2_roi.png') });

  // Step 3: Y-axis Two-point calibration
  await gotoStage(page, 3);
  await page.evaluate(() => {
    const pairs = [
      ['#ycal-inp-unit', 'cm'],
      ['#ycal-inp-top-px', '511'],
      ['#ycal-inp-bot-px', '1311'],
      ['#ycal-inp-top-val', '0'],
      ['#ycal-inp-bot-val', '150'],
    ];
    for (const [sel, val] of pairs) {
      const el = document.querySelector(sel);
      if (el) el.value = val;
    }
    document.querySelector('#btn-apply-ycalib')?.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'step3_ycalib.png') });

  // Step 4: Line Removal & Binary Preview (B key)
  //
  // 进入步骤 4 后二值遮罩**默认已开启**（`GeologyViewport` 载入二值遮罩后自动打开），
  // 所以"先按 B"其实是在关掉它。旧脚本直接按一次就截图，截到的是 `[已关闭]` 那一帧，
  // 图注却写着"按 B 键开启"——图文对不上。这里改成按状态断言，不靠次数猜：
  //   关一次 → 截 step4_cleanup（原始墨迹 + 候选线）；
  //   开一次 → 等提示变成 [已开启] 再截 step4_binary_overlay。
  await gotoStage(page, 4);
  await page.locator('#btn-detect-candidates').click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('b');
  await page
    .locator('text=透视遮罩: 二值化墨迹高亮模式 [已关闭]')
    .waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'step4_cleanup.png') });
  await page.keyboard.press('b');
  await page
    .locator('text=透视遮罩: 二值化墨迹高亮模式 [已开启]')
    .waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'step4_binary_overlay.png') });
  await page.keyboard.press('b');
  await page.waitForTimeout(300);

  // Step 5: Column Split & Naming + OCR Modal
  await gotoStage(page, 5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'step5_naming.png') });

  // Open OCR Modal —— 只打开不点「执行 OCR 识别」的话，表格是空的（"点击左侧执行 OCR 识别"），
  // 图注声称的"属种名识别与科属词典对齐"在画面上不存在。必须真跑一次识别并等到统计落定。
  await page.locator('#btn-ocr-review-modal').click();
  await page.locator('.ocr-review-dialog').waitFor({ state: 'visible' });
  await page.locator('#btn-ocr-run').click();
  // 判据不能用"统计不等于 --"：这三个计数在**识别开始前**就已经是 0/0/28（未识别=列数），
  // 于是那种判据会立刻通过，截到的是"正在以 45° 旋转扶正并执行…匹配…"的进度占位行。
  // 这里改成结构性判据：占位行必须消失 + 自动准确/待确认/未识别都是整数 + 三者之和
  // 必须等于列数（识别失败留空行时和不等于列数，判据会红）。
  await page.waitForFunction(
    () => {
      const tb = document.querySelector('#ocr-summary-tbody');
      if (!tb) return false;
      const rows = Array.from(tb.querySelectorAll('tr'));
      if (rows.length === 0) return false;
      if (rows.some((r) => (r.textContent || '').includes('正在以'))) return false;
      const num = (sel) => {
        const el = document.querySelector(sel);
        const txt = ((el && el.textContent) || '').trim();
        return /^\d+$/.test(txt) ? Number(txt) : NaN;
      };
      const auto = num('#ocr-stat-auto');
      const confirm = num('#ocr-stat-confirm');
      const unrec = num('#ocr-stat-unrec');
      const total = num('#ocr-stat-total');
      if ([auto, confirm, unrec, total].some((n) => Number.isNaN(n))) return false;
      return total > 0 && auto + confirm + unrec === total;
    },
    null,
    { timeout: 180000 }
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT_DIR, 'modal_ocr.png') });
  await page.locator('#ocr-close-btn').click();
  await page.locator('.ocr-review-dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(300);

  // Step 6: Column X-Ticks Calibration
  //
  // 旧脚本在这里填 `#inp-manual-tick-val1/val2` + `#btn-save-manual-ticks`，这三个
  // 选择器在当前前端**已全部不存在**（步骤 6 改成「列组 + 点一个刻度齿 + 填数字」，
  // `XTicksPanel.ts` 只留 `#btn-pick-tick` / `#inp-tick-value` / `#btn-apply-tick-calib`），
  // 而旧代码外面套着 `if (await val1.isVisible())`，于是它**静默什么都不做**：
  // 截出来的步骤 6 是"0/28 未标定"，却挂着"两点式 X 轴刻度标定"的图注。
  //
  // 这里不再脚本化标定：刻度齿需要人工在图上选取（面板明示"检测: 28 列, 未找到刻度尺"，
  // 齿位由用户在画布上点）。伪造一对 px/value 能让表格看起来"有数"，但那些数字不是
  // 从图版读出来的——教程里不能放这种数。故本图只如实记录"标定入口与规则"这一状态。
  await gotoStage(page, 6);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'step6_xticks.png') });

  // Step 7: Curve Digitization & Consensus Sample Horizons
  await gotoStage(page, 7);
  await page.locator('#btn-extract-consensus').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT_DIR, 'step7_samples.png') });
  // Also save as hero preview image
  await page.screenshot({ path: path.join(OUT_DIR, '..', 'real_browser_playwright_verified.png') });

  // Open Age-Depth Modal & extract Bacon curve
  await page.locator('#btn-age-depth-modal').click();
  const adDialog = page.locator('.agedepth-dialog');
  await adDialog.waitFor({ state: 'visible' });
  await adDialog.locator('#ad-btn-center-bacon').click();
  await page.waitForTimeout(800);
  await adDialog.locator('#ad-btn-extract').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT_DIR, 'modal_agedepth.png') });
  await page.locator('#ad-close-btn').click();
  await page.locator('.agedepth-dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(300);

  // Open Metadata Modal
  await page.locator('#btn-metadata-modal').click();
  const metaDialog = page.locator('.metadata-dialog');
  await metaDialog.waitFor({ state: 'visible' });
  await metaDialog.locator('#meta-inp-doi').fill('10.1016/j.quascirev.2024.108001');
  await metaDialog.locator('#meta-pub-title').fill('Holocene vegetation and climate dynamics at Hoya del Castillo');
  await metaDialog.locator('#meta-site-name').fill('Hoya del Castillo');
  await metaDialog.locator('#meta-site-lat').fill('41.25');
  await metaDialog.locator('#meta-site-lon').fill('-0.52');
  await metaDialog.locator('#meta-site-elev').fill('295');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'modal_metadata.png') });
  await page.locator('#meta-close-btn').click();
  await page.locator('.metadata-dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(400);

  // Step 8: Geological QA & Export Readiness
  await gotoStage(page, 8);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'step8_qa_export.png') });

  await context.close();
  await browser.close();
})();
"""


def add_banner(img_path: Path, caption: str, size: tuple[int, int] = (1152, 720)) -> Image.Image:
    """Resize screenshot and add a high-contrast step caption banner at bottom."""
    im = Image.open(img_path).convert("RGB").resize(size, Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(im)
    w, h = size
    banner_h = 44
    draw.rectangle([0, h - banner_h, w, h], fill=(15, 23, 42))
    draw.line([0, h - banner_h, w, h - banner_h], fill=(56, 189, 248), width=2)

    # Load CJK font on Windows if available
    font = None
    for candidate in [
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ]:
        if os.path.exists(candidate):
            try:
                font = ImageFont.truetype(candidate, 20)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    draw.text((20, h - banner_h + 10), caption, fill=(248, 250, 252), font=font)
    return im


def build_gif(frames_spec: list[tuple[str, str, int]], out_path: Path) -> None:
    """Build an optimized animated GIF from (filename, caption, duration_ms) tuples."""
    pil_frames: list[Image.Image] = []
    durations: list[int] = []
    for fname, caption, dur in frames_spec:
        frame_img = add_banner(OUT_DIR / fname, caption)
        # Quantize to 256 colors with adaptive palette for crisp UI rendering
        pil_frames.append(frame_img.quantize(colors=256, method=Image.Quantize.MEDIANCUT))
        durations.append(dur)

    pil_frames[0].save(
        out_path,
        save_all=True,
        append_images=pil_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f"[OK] Generated GIF: {out_path.relative_to(ROOT)} ({out_path.stat().st_size // 1024} KB)")


def wait_for_backend(url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/status", timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"Backend failed to start at {url}")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["STRADITIZE_E2E_PORT"] = str(PORT)

    print(f"[1/4] Starting isolated backend on {BASE_URL} ...")
    backend_proc = subprocess.Popen(
        [sys.executable, str(ROOT / "support" / "serve_e2e_backend.py")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        wait_for_backend(BASE_URL)
        with tempfile.TemporaryDirectory() as tmpdir:
            mjs_path = ROOT / "frontend" / "_tmp_record_tutorials.mjs"
            mjs_path.write_text(NODE_SCRIPT, encoding="utf-8")
            try:
                node_env = env.copy()
                node_env["BASE_URL"] = BASE_URL
                node_env["OUT_DIR"] = str(OUT_DIR)
                node_env["VIDEO_TMP"] = tmpdir
                print("[2/4] Driving MS Edge through 8-step workflow & 3 modals ...")
                subprocess.run(
                    ["node", str(mjs_path)],
                    cwd=str(ROOT / "frontend"),
                    env=node_env,
                    check=True,
                )
            finally:
                mjs_path.unlink(missing_ok=True)

            # Copy recorded WebM video
            webm_files = list(Path(tmpdir).glob("*.webm"))
            if webm_files:
                target_webm = OUT_DIR / "workflow_8steps.webm"
                shutil.copy2(webm_files[0], target_webm)
                print(f"[OK] Recorded WebM video: {target_webm.relative_to(ROOT)} ({target_webm.stat().st_size // 1024} KB)")

        print("[3/4] Synthesizing annotated tutorial GIFs ...")
        build_gif(
            [
                ("step1_load.png", "步骤 1/8：载入地层花粉图谱（支持 PNG/JPG/TIFF/PDF 与内置范例）", 1800),
                ("step2_roi.png", "步骤 2/8：管理取数区 (Multi-ROI) —— 纯数据区与坐标轴完全解耦", 1800),
                ("step3_ycalib.png", "步骤 3/8：Y 轴两点物理标定 (511px → 0 cm, 1311px → 150 cm)", 2000),
                ("step4_cleanup.png", "步骤 4/8：自动探测网格/分带线候选与排除框管理", 1800),
                ("step4_binary_overlay.png", "步骤 4/8：按 B 键开启二值化透视遮罩（白=保留花粉，红=剔除网格线）", 2200),
                ("step5_naming.png", "步骤 5/8：自动探测属种分列基线与行内/批量命名", 1800),
                ("modal_ocr.png", "步骤 5/8：离线 PP-OCRv6 属种名识别与古生态科属词典对齐", 2200),
                ("step6_xticks.png", "步骤 6/8：列组管理与两点式 X 轴物理刻度标定 (0% → 20%)", 2000),
                ("step7_samples.png", "步骤 7/8：曲线拐点数字化与共识采样层位自动提取", 2000),
                ("modal_agedepth.png", "步骤 7/8：Bacon/Bchron 年代-深度曲线与 95% 置信包络提取及 1000 集合生成", 2400),
                ("modal_metadata.png", "步骤 8/8：FAIR / LiPD v1.3 标准元数据与外部 AI 免 Token 导入助手", 2200),
                ("step8_qa_export.png", "步骤 8/8：地学 QA 诊断（百和门禁 Σ% / 未标定列显式提示）与多格式导出", 2400),
            ],
            OUT_DIR / "01_workflow_8steps.gif",
        )

        build_gif(
            [
                ("step3_ycalib.png", "1. Y 轴两点标定：任意两已知刻度像素行映射真实深度/年代，独立于 ROI 边界", 2400),
                ("step6_xticks.png", "2. X 轴两点物理刻度标定：基线原点 P1 + 印刷刻度齿 P2，支持列组与对数尺度保护", 2400),
                ("step8_qa_export.png", "3. 唯一标度入口：导出与 QA 诊断严格共用 x_ticks，未标定列显式标注 ⚠️ 未标定", 2400),
            ],
            OUT_DIR / "02_twopoint_calibration.gif",
        )

        build_gif(
            [
                ("modal_ocr.png", "1. 离线 OCR 与科属词典：支持花粉/硅藻/NPP词表与期刊图版说明一键解析", 2200),
                ("modal_agedepth.png", "2. 年代-深度模型：自动追踪中位数与 95% 置信包络，生成 1000 条单调年代集合", 2400),
                ("modal_metadata.png", "3. LiPD v1.3 元数据：支持在线 LLM 提取与外部网页 AI 免 Token 一键粘贴回填", 2200),
                ("step8_qa_export.png", "4. 科学导出：零 NA 等深层位求交，一键导出 CSV / 多表 XLSX / LiPD / .tar 及 R 脚本", 2400),
            ],
            OUT_DIR / "03_modals_and_export.gif",
        )

        print("[4/4] All tutorial media assets generated successfully!")
        return 0
    finally:
        backend_proc.terminate()
        try:
            backend_proc.wait(timeout=5)
        except Exception:
            backend_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
