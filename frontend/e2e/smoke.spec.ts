/**
 * 应用外壳与测试基线。
 *
 * 这个文件的第一职责是**证明 e2e 基础设施本身可用**：webServer 起得来、
 * msedge channel 能跑、`e2e.reset` 复位有效、RPC 直连后端拿得到权威数据。
 * 它失败时，其它 spec 的失败都不必看。
 */
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  diagramData,
  expectNoDialogs,
  getState,
  openApp,
  resetBaseline,
  watchPage,
} from './helpers';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test.describe('应用外壳与基线', () => {
  test('冷启动：8 步工作流、无第 9 步、前后端 ROI 一致、无原生对话框', async ({ page }) => {
    const telemetry = watchPage(page);
    await openApp(page);

    await expect(page.locator('.workflow-step-btn')).toHaveCount(8);
    await expect(page.locator('.workflow-step-btn[data-step="9"]')).toHaveCount(0);

    const state = await getState<{ stage: number; rois: { id: string }[] }>(page);
    expect(state.stage, '基线应停在步骤 1').toBe(1);
    expect(state.rois.length, '基线应已加载 hoya 的 ROI').toBeGreaterThan(0);

    const data = await diagramData<{ rois: { id: string }[] }>(page);
    expect(
      data.rois.map((r) => r.id),
      '前端 ROI 镜像必须与后端权威一致'
    ).toEqual(state.rois.map((r) => r.id));

    expectNoDialogs(telemetry);
  });

  test('e2e.reset 能把被污染的会话复原（测试间隔离的前提）', async ({ page }) => {
    await openApp(page);

    // 故意破坏状态：新建一个 ROI，让后端不再是基线
    const created = await page.evaluate(async () => {
      const api = (window as unknown as { __straditize?: { rpc: (m: string, p?: unknown) => Promise<unknown> } })
        .__straditize;
      if (!api) throw new Error('句柄不可用');
      return api.rpc('roi.create', { name: 'e2e_pollution_probe' });
    });
    expect(created, 'roi.create 应返回结果').toBeTruthy();

    const polluted = await diagramData<{ rois: { name?: string }[] }>(page);
    expect(
      polluted.rois.some((r) => r.name === 'e2e_pollution_probe'),
      '污染应当真的落到后端'
    ).toBe(true);

    await resetBaseline(page);

    const restored = await diagramData<{ rois: { name?: string }[] }>(page);
    expect(
      restored.rois.some((r) => r.name === 'e2e_pollution_probe'),
      'e2e.reset 后污染必须消失'
    ).toBe(false);
  });

  test('外壳事实：8 步工作流无导出步、顶栏导出在位、遗留按钮已移除', async ({ page }) => {
    await openApp(page);

    // 导出不再是工作流的一步（改为顶栏全局出口）
    await expect(page.locator('.workflow-step-btn')).toHaveCount(8);
    expect(
      await page.locator('.workflow-step-btn', { hasText: '导出' }).count(),
      '导出不得出现在工作流条里'
    ).toBe(0);
    await expect(page.locator('#btn-export-csv')).toBeVisible();

    // T11 已移除的遗留入口（属种批量导入 + ▲/▼ 交换）
    await expect(page.locator('[data-action="swap-up"]')).toHaveCount(0);
    await expect(page.locator('#btn-open-paste-taxa')).toHaveCount(0);

    // 侧栏标题是步骤 1 的权威文案
    await expect(page.locator('.sidebar-title span')).toHaveText('Taxa 属种分列清单');
  });

  test('内置样本真值：尺寸一致，且真值 sha256 与磁盘上的样本文件一致', async ({ page }) => {
    await openApp(page); // diagramData 需要 window.__straditize

    const truth = JSON.parse(
      readFileSync(join(REPO_ROOT, 'tests/data/truth/index.json'), 'utf-8')
    ) as { images: Record<string, { sha256: string; size: [number, number] }> };

    // 注意路径：真值真实结构是 truth.images.hoya，旧套件写的是 truth["hoya"]
    // （顶层）→ 永远取不到 → 那条 sha256 断言**从未执行过**。这里修正。
    const hoya = truth.images.hoya;
    expect(hoya, '真值文件必须含 images.hoya').toBeTruthy();

    // ── 尺寸：这是可比的基准 ──────────────────────────────────────────
    // 后端报告的图像尺寸必须与真值一致
    const data = await diagramData<{ imageWidth: number; imageHeight: number }>(page);
    expect([data.imageWidth, data.imageHeight], '后端图像尺寸应等于真值').toEqual(hoya.size);

    // 服务端真正吐出的 PNG 也必须是这个尺寸（自己解 IHDR，不引第三方库）
    const res = await page.request.get('/image/current');
    expect(res.ok(), '/image/current 应可访问').toBe(true);
    const buf = Buffer.from(await res.body());
    expect(buf.length, 'PNG 不应为空').toBeGreaterThan(0);
    expect(buf.readUInt32BE(0), 'PNG magic（\\x89PNG）').toBe(0x89504e47);
    expect(buf.toString('latin1', 12, 16), 'PNG 首块应为 IHDR').toBe('IHDR');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)], '渲染 PNG 的像素尺寸应等于真值').toEqual(
      hoya.size
    );

    // ── sha256：只能对**源文件**验，不能对 /image/current 验 ─────────────
    // /image/current 是后端重新编码后的 PNG（同为 2339×1654，但字节数不同），
    // 其 sha256 必然不等于源文件真值。可比的是"磁盘上那个样本文件"。
    // 路径来源：`straditize_core/session.py:139-142` 的 sample_candidates['hoya']。
    // 该文件若被替换或移动，本断言会失败——这正是它要钉住的东西。
    const samplePath = join(
      REPO_ROOT,
      'straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png'
    );
    const actualSha = createHash('sha256').update(readFileSync(samplePath)).digest('hex');
    expect(actualSha, `样本文件 ${samplePath} 的 sha256 与真值不符`).toBe(hoya.sha256);
  });
});
