/**
 * 步骤 4（干扰清理）逐动作门禁。
 *
 * ## 为什么必须单独补这一份
 *
 * 本步此前在 e2e 里的覆盖是"扫描按钮能产出候选"（`workflow-panels.spec.ts`）
 * 与"画笔能落库"。但**本步的目的动作——「确认去除」——一次都没被点过**：
 * 全仓 grep `btn-toggle-geometry` / `setGeometryStatus` / `deleteLineGeometry`
 * 在任何 spec 里都是零命中。检测出候选却从不确认，等于"读到了清单，没做过决定"，
 * 而真正会改动数字化结果的恰恰是确认那一下。
 *
 * 所以这里按用户真实动作逐个补齐，并且一律断言**后端权威状态**：
 * 几何集合、`status`、`selected_ids`、`cleanup.stats` 里的像素账。
 *
 * ## 统计量选择：为什么盯 `geometry_removed_pixels` 而不是 `final_removed_pixels`
 *
 * `_rebuild_grid_line_mask()` 合成的 `final_mask` 是 **union**：
 * `candidate_line_mask(=已确认几何) | degrid_line_mask | 排除区 | 笔迹`。
 * `degrid_line_mask`（自动去线）与"我这次确认了几何"无关，恒有值，
 * 所以 `final_removed_pixels` 在**检测后就已经 > 0**，拿它做因果断言是假信号。
 * `geometry_removed_pixels` 是 `(raw_ink & geometry_mask).sum()`，而 `geometry_mask`
 * 只由 `statuses={removed}` 的几何构成 —— 检测后必为 0，确认后才起跳，
 * 正好是"这一下确认真的剔了像素"的干净证据。
 *
 * ## 中心行不动的判据必须用后端的取整口径
 *
 * `set_line_thickness` 用的是 `centre = (y0 + y1) // 2`。若测试用 `/2` 浮点比较，
 * 厚度 2 的线（y0=602,y1=603）会得到 602.5，而改完是 602 → 假失败。
 * 故 `centreOf()` 一律 `Math.floor`，与后端同口径。
 *
 * ## 为什么每次交互前都要 `settle()`
 *
 * 后端 RPC 落地与面板重绘**不是同一时刻**：`applyCleanupState` 之后 `Inspector`
 * 会把整个步骤面板重挂一遍（`bindEvents()` → `mount()`），DOM 被整体替换。
 * 若点击落在这个窗口里，事件会打在正在被替换的节点上——既不报错也不生效。
 * 实测两种表现都出现过：①「清空本步编辑」点了 30 s 后端仍是 24 条几何；
 * ② 越界厚度不标红，且把**上一次 mount 时输入框里的旧值**当成新值发了出去
 * （因为 mount 闭包捕获的是旧 `<input>` 节点）。二者都是"点了等于没点"，
 * 断言会以极难解读的方式变红。所以每个交互前先确认面板已经追上后端。
 */
import { expect, test } from './fixtures';
import { canvasBox, gotoStage, resetBaseline, rpc } from './helpers';

interface Geometry {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface LineCandidate {
  id: string;
  axis: 'h' | 'v';
  status: 'candidate' | 'removed';
  width: number;
  source: string;
  roi_id: string;
  kind: string;
  geometry: Geometry;
}
interface DiagramData {
  line_candidates: LineCandidate[];
  exclusion_regions: { id: string; roi_id: string }[];
  line_strokes: unknown[];
  selected_candidate_ids: string[];
  cleanup: { stats: Record<string, number> };
}

const PANEL = '.step-panel[data-step="4"]';

const read = (page: Parameters<typeof rpc>[0]) =>
  rpc<DiagramData>(page, 'straditize.getDiagramData');

const statsOf = async (page: Parameters<typeof rpc>[0]) => (await read(page)).cleanup.stats;

const rowCount = (page: Parameters<typeof rpc>[0]) => page.locator('.cleanup-row').count();

async function roiId(page: Parameters<typeof rpc>[0]): Promise<string> {
  const d = await rpc<{ rois: { id: string }[] }>(page, 'straditize.getDiagramData');
  return d.rois[0].id;
}

/** 后端口径的中心行：`(a + b) // 2`。 */
const centreOf = (c: LineCandidate): number =>
  c.axis === 'h'
    ? Math.floor((c.geometry.y0 + c.geometry.y1) / 2)
    : Math.floor((c.geometry.x0 + c.geometry.x1) / 2);

/**
 * 等前端把后端状态画完：面板候选行数必须等于后端几何数。
 *
 * 这一条同时挡住两种竞态：进入步骤 4 时镜像还在陆续灌入（面板先空后有），
 * 以及任何写操作之后 `applyCleanupState` 触发的整体重挂。
 */
async function settle(page: Parameters<typeof rpc>[0]): Promise<void> {
  await expect
    .poll(
      async () => {
        const n = (await read(page)).line_candidates.length;
        return (await rowCount(page)) === n;
      },
      {
        message:
          '面板候选行数必须已经追上后端几何数——否则前端仍在重挂面板，此时点击会打在正在被替换的节点上（既不报错也不生效）',
        timeout: 20_000,
        intervals: [250],
      }
    )
    .toBe(true);
}

/** 进入步骤 4 并等前端把初始状态画完。 */
async function openStep4(page: Parameters<typeof rpc>[0]): Promise<void> {
  await gotoStage(page, 4);
  await expect(page.locator(PANEL)).toBeVisible();
  await settle(page);
}

/** 走面板按钮清空本步编辑（真实用户路径，且与后端串行）。 */
async function clearViaPanel(page: Parameters<typeof rpc>[0]): Promise<void> {
  await settle(page);
  await page.locator('#btn-clear-cleanup-edits').click();
  await expect
    .poll(async () => (await read(page)).line_candidates.length, {
      message: '点「清空本步全部几何/排除区/笔迹」后后端不应再有几何',
      timeout: 30_000,
    })
    .toBe(0);
  await settle(page);
}

/** 走面板按钮检测候选（真实用户路径）。 */
async function detectViaPanel(page: Parameters<typeof rpc>[0]): Promise<void> {
  await settle(page);
  await page.locator('#btn-detect-candidates').click();
  await expect
    .poll(async () => (await read(page)).line_candidates.length, {
      message: '点「重新扫描候选线」后后端应产出候选几何',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await settle(page);
}

/** 在画布上按住拖一段（相对画布尺寸的比例坐标）。 */
async function dragOnCanvas(
  page: Parameters<typeof rpc>[0],
  rx: number,
  ry: number,
  dx: number,
  dy: number
): Promise<void> {
  const b = await canvasBox(page);
  const x = b.x + b.width * rx;
  const y = b.y + b.height * ry;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3, { steps: 5 });
  await page.mouse.move(x + (dx * 2) / 3, y + (dy * 2) / 3, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

test.describe('步骤 4 干扰清理', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('「确认去除」真的剔除像素，「撤回」能完整回退（本步的目的动作）', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const before = await read(page);
    const target = before.line_candidates[0];
    // 前置：刚检出的必须全是"待确认"，且几何通道还没剔任何像素——
    // 否则"确认后起跳"可能来自上一轮残留，因果关系不成立。
    expect(
      [...new Set(before.line_candidates.map((c) => c.status))],
      '前置：刚检出的几何应全部为 candidate'
    ).toEqual(['candidate']);
    expect(before.selected_candidate_ids, '前置：未确认时不应有已选几何').toEqual([]);
    const pxBefore = before.cleanup.stats.geometry_removed_pixels;
    expect(pxBefore, '前置：未确认时几何通道剔除像素应为 0').toBe(0);

    const toggle = page.locator(`.btn-toggle-geometry[data-cand-id="${target.id}"]`);
    await expect(toggle, '候选行必须提供「确认去除」按钮').toBeVisible();
    await expect(toggle, '未确认的几何按钮语义应为 removed').toHaveAttribute(
      'data-next',
      'removed'
    );
    await toggle.click();

    await expect
      .poll(
        async () => {
          const d = await read(page);
          const c = d.line_candidates.find((x) => x.id === target.id);
          return [
            c?.status,
            d.selected_candidate_ids.includes(target.id),
            d.cleanup.stats.removed_count,
          ];
        },
        {
          message: '点「确认去除」后后端 status / selected_ids / removed_count 必须同时改变',
          timeout: 30_000,
        }
      )
      .toEqual(['removed', true, 1]);

    const afterConfirm = await read(page);
    const pxAfter = afterConfirm.cleanup.stats.geometry_removed_pixels;
    expect(
      pxAfter,
      '确认一条几何后，几何通道实际剔除的像素必须从 0 起跳（证明真的动了掩膜，而不是只翻了个状态字段）'
    ).toBeGreaterThan(pxBefore);

    // 撤回：状态回到 candidate，像素账必须完整退回 0。
    await settle(page);
    const back = page.locator(`.btn-toggle-geometry[data-cand-id="${target.id}"]`);
    await expect(back, '已确认的几何按钮语义应翻转为 candidate').toHaveAttribute(
      'data-next',
      'candidate'
    );
    await back.click();
    await expect
      .poll(
        async () => {
          const d = await read(page);
          const c = d.line_candidates.find((x) => x.id === target.id);
          return [
            c?.status,
            d.selected_candidate_ids.length,
            d.cleanup.stats.removed_count,
            d.cleanup.stats.geometry_removed_pixels,
          ];
        },
        { message: '点「撤回」后状态与像素账都要回到未确认', timeout: 30_000 }
      )
      .toEqual(['candidate', 0, 0, 0]);
  });

  test('「删除」把几何从后端彻底移除（不是只标个状态）', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const before = await read(page);
    const target = before.line_candidates[0];

    await page.locator(`.btn-delete-geometry[data-cand-id="${target.id}"]`).click();

    await expect
      .poll(
        async () => {
          const d = await read(page);
          return [d.line_candidates.length, d.line_candidates.some((c) => c.id === target.id)];
        },
        { message: '点「删除」后该几何必须从后端消失（数量-1 且 id 不再出现）', timeout: 30_000 }
      )
      .toEqual([before.line_candidates.length - 1, false]);
  });

  test('「＋横向/＋竖向」拖出来的几何真的落库，且 axis 与拖拽方向一致', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const base = await read(page);
    const roi = await roiId(page);

    // 横向：按钮只切工具模式，真正落库发生在画布松手时（这是真实主路径）。
    await page.locator('#btn-add-horizontal-geometry').click();
    await dragOnCanvas(page, 0.35, 0.4, 160, 0);
    await expect
      .poll(async () => (await read(page)).line_candidates.length, {
        message: '在图上横向拖出一段后后端应新增一条几何',
        timeout: 30_000,
      })
      .toBe(base.line_candidates.length + 1);

    const afterH = await read(page);
    const newH = afterH.line_candidates.find(
      (c) => !base.line_candidates.some((o) => o.id === c.id)
    );
    expect(newH, '必须能在后端找到新落库的横向几何').toBeTruthy();
    expect(newH!.axis, '横向拖拽落库的 axis 必须是 h').toBe('h');
    expect(newH!.source, '手动画出来的 source 必须是 manual').toBe('manual');
    expect(newH!.status, '手动几何默认应是待确认，不能自动剔除').toBe('candidate');
    expect(newH!.roi_id, '新几何必须归属当前有效区').toBe(roi);
    expect(
      newH!.geometry.x1 - newH!.geometry.x0,
      '横向几何应沿 x 方向真的展开（不是退化成一条竖线）'
    ).toBeGreaterThan(20);

    // 竖向：同一入口的另一条腿。
    await settle(page);
    await page.locator('#btn-add-vertical-geometry').click();
    await dragOnCanvas(page, 0.6, 0.25, 0, 160);
    await expect
      .poll(async () => (await read(page)).line_candidates.length, {
        message: '在图上竖向拖出一段后后端应再新增一条几何',
        timeout: 30_000,
      })
      .toBe(base.line_candidates.length + 2);

    const afterV = await read(page);
    const newV = afterV.line_candidates.find(
      (c) => !afterH.line_candidates.some((o) => o.id === c.id)
    );
    expect(newV, '必须能在后端找到新落库的竖向几何').toBeTruthy();
    expect(newV!.axis, '竖向拖拽落库的 axis 必须是 v').toBe('v');
    expect(
      newV!.geometry.y1 - newV!.geometry.y0,
      '竖向几何应沿 y 方向真的展开（不是退化成一条横线）'
    ).toBeGreaterThan(20);

    // 面板清单必须跟着后端走，而不是停在旧快照。
    await expect
      .poll(() => rowCount(page), {
        message: '面板候选行数必须与后端几何数一致',
        timeout: 15_000,
      })
      .toBe(afterV.line_candidates.length);
  });

  test('「统一厚度」改的是带宽、中心行一寸不动；应用到选中只动那一条', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const before = await read(page);
    const centresBefore = new Map(before.line_candidates.map((c) => [c.id, centreOf(c)]));
    expect(before.line_candidates.length, '前置：应有足够多的几何来验证"全部"').toBeGreaterThan(2);

    // 应用到全部
    await page.locator('#cleanup-thickness-input').fill('7');
    await page.locator('#btn-apply-thickness-all').click();
    await expect
      .poll(async () => [...new Set((await read(page)).line_candidates.map((c) => c.width))], {
        message: '点「应用到全部」后每一条几何的 width 都应变 7',
        timeout: 30_000,
      })
      .toEqual([7]);

    const afterAll = await read(page);
    for (const c of afterAll.line_candidates) {
      expect(
        centreOf(c),
        `「统一厚度」承诺中心行不动，但 ${c.id} 的中心行从 ${centresBefore.get(c.id)} 漂到了 ${centreOf(c)}`
      ).toBe(centresBefore.get(c.id));
    }

    // 应用到选中：先点一行（面板选中），再改厚度 —— 只应改那一条。
    const targetId = afterAll.line_candidates[0].id;
    await settle(page);
    await page.locator(`.btn-select-geometry[data-cand-id="${targetId}"]`).click();
    await expect(page.locator('#btn-apply-thickness-selected')).toBeEnabled();
    await page.locator('#cleanup-thickness-input').fill('13');
    await page.locator('#btn-apply-thickness-selected').click();

    await expect
      .poll(
        async () => {
          const d = await read(page);
          return [
            d.line_candidates.find((c) => c.id === targetId)?.width,
            d.line_candidates.length,
          ];
        },
        { message: '「应用到选中」应只把选中那条改成 13', timeout: 30_000 }
      )
      .toEqual([13, afterAll.line_candidates.length]);

    const afterSel = await read(page);
    const others = afterSel.line_candidates.filter((c) => c.id !== targetId);
    expect(
      [...new Set(others.map((c) => c.width))],
      '「应用到选中」不得波及别的几何（它们应仍是 7）'
    ).toEqual([7]);
    expect(
      centreOf(afterSel.line_candidates.find((c) => c.id === targetId)!),
      '「应用到选中」同样必须保持中心行不动'
    ).toBe(centresBefore.get(targetId));
  });

  test('越界厚度被前端当场拦下：标红、不发 RPC、几何一点没变', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const before = await read(page);
    const widthsBefore = [...new Set(before.line_candidates.map((c) => c.width))];

    // 上越界：后端上限 500。
    await page.locator('#cleanup-thickness-input').fill('9999');
    await page.locator('#btn-apply-thickness-all').click();
    await expect(page.locator('#cleanup-thickness-input')).toHaveCSS(
      'border-color',
      'rgb(239, 68, 68)'
    );

    // 下越界：后端下限 1。
    await page.locator('#cleanup-thickness-input').fill('0');
    await page.locator('#btn-apply-thickness-all').click();
    await expect(page.locator('#cleanup-thickness-input')).toHaveCSS(
      'border-color',
      'rgb(239, 68, 68)'
    );

    // 关键：整个过程后端几何必须**一点没变**。
    // 若前端把 9999 发出去，后端会拒绝 → telemetry 门禁会直接判本用例失败；
    // 若后端接受了，下面的宽度比对会红。两条路都堵死。
    const after = await read(page);
    expect(
      [...new Set(after.line_candidates.map((c) => c.width))],
      '越界输入不得改动任何几何的厚度'
    ).toEqual(widthsBefore);
  });

  test('「清空本步全部几何/排除区/笔迹」后端清零，面板计数也必须跟着清零', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    // 造一笔人工修正笔迹，让"笔迹"这一项也非零。
    await page.locator('#btn-trigger-linefix').click();
    await dragOnCanvas(page, 0.4, 0.5, 48, 12);
    await expect
      .poll(async () => (await statsOf(page)).manual_erase_pixels, {
        message: '擦一笔后后端 manual_erase_pixels 应大于 0',
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // 造一个排除区。
    await settle(page);
    await page.locator('#btn-add-exclusion-rect').click();
    await expect
      .poll(async () => (await read(page)).exclusion_regions.length, {
        message: '点「划定排除区」后后端应有一个排除区',
        timeout: 30_000,
      })
      .toBe(1);

    const beforeClear = await read(page);
    expect(beforeClear.line_candidates.length, '前置：应有几何待清空').toBeGreaterThan(0);
    expect((await statsOf(page)).manual_erase_pixels, '前置：应有笔迹待清空').toBeGreaterThan(0);
    await expect(page.locator(PANEL), '前置：面板应显示 1 个排除区').toContainText(
      '排除区 (1 个)'
    );

    // 真实用户路径：点这个按钮。
    await page.locator('#btn-clear-cleanup-edits').click();

    await expect
      .poll(
        async () => {
          const d = await read(page);
          return [
            d.line_candidates.length,
            d.exclusion_regions.length,
            d.line_strokes.length,
            d.cleanup.stats.manual_erase_pixels,
          ];
        },
        {
          message: '「清空本步全部几何/排除区/笔迹」必须把三项后端状态一起清零',
          timeout: 30_000,
        }
      )
      .toEqual([0, 0, 0, 0]);

    // 这一条是本轮的回归钉子：后端已经清空，面板曾经仍然显示「排除区 (1 个)」——
    // 因为 `_recompose` 的返回体不含 `exclusion_regions`，`applyCleanupState`
    // 也就无从覆盖前端镜像。按钮骗人比按钮坏了更糟：用户会以为没清掉。
    await expect(page.locator(PANEL), '后端排除区已清零，面板不得再宣称存在排除区').toContainText(
      '排除区 (0 个)'
    );
    expect(await rowCount(page), '面板候选行也必须清空').toBe(0);
    expect(await page.locator('#cleanup-stats').innerText(), '统计行必须显示 0 条几何').toContain(
      '几何 0 条'
    );
  });
});

/**
 * 后端的第二道防线：绕过前端直调也必须被拒。
 *
 * 单独成一个**顶层** describe，是为了把 `rpcError` 豁免只开给这一条用例——
 * 豁免范围必须贴着"这里故意触发失败"的意图，否则会把别处的真实静默吞错一起放行。
 * 注意它是顶层的：不继承上面那个 describe 的 `beforeEach`，必须自己复位。
 */
test.describe('步骤 4 后端防线：越界厚度直调被拒', () => {
  test.use({ allowlists: { rpcError: [/algorithm\.setLineThickness/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('绕过面板直调越界厚度，后端必须拒绝且几何不变', async ({ page }) => {
    await openStep4(page);
    await clearViaPanel(page);
    await detectViaPanel(page);

    const roi = await roiId(page);
    const before = await read(page);
    const widthsBefore = [...new Set(before.line_candidates.map((c) => c.width))];

    for (const bad of [0, 501]) {
      const err = await rpc(page, 'algorithm.setLineThickness', {
        thickness: bad,
        roi_id: roi,
      }).then(
        () => null,
        (e: Error) => e.message
      );
      expect(err, `后端必须拒绝 thickness=${bad}`).toBeTruthy();
    }

    const after = await read(page);
    expect(
      [...new Set(after.line_candidates.map((c) => c.width))],
      '被拒的调用不得改动任何几何'
    ).toEqual(widthsBefore);
    expect(after.line_candidates.length, '被拒的调用不得增删几何').toBe(
      before.line_candidates.length
    );
  });
});
