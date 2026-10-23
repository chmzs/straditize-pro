/**
 * 三条"前端状态与后端不一致"的回归用例：B-07 / B-04 / B-05。
 *
 * ## 共同判据：只认后端权威状态
 *
 * 三条缺陷的症状都长得像"界面看起来正常"，纯 DOM 断言完全抓不到：
 *
 * | 编号 | 旧行为 | 用户实际遭遇 |
 * | --- | --- | --- |
 * | B-07 | 重置后按已不存在的 `roi_1` 重算清理掩膜 | 每次都弹 `-32001` 红框，让人以为重置失败 |
 * | B-04 | 用前端旧 ROI 镜像构造分列参数 | 后端已接受的新取数区被静默改回旧值，界面报"分列成功" |
 * | B-05 | 恢复草稿只写前端镜像，零 RPC | 界面 28 列、后端 0 列，之后所有列级操作打空 |
 *
 * 因此每条都直接读 `straditize.getDiagramData` / `roi.list` 的后端真值。
 *
 * ## 与 `fixtures.ts` 门禁的配合
 *
 * `fixtures.ts` 的 auto teardown 会把"失败的 RPC"与"用户可见通知"判红。
 * B-07 的验收**正是**"重置之后不得出现 -32001、不得弹红框"——所以这里
 * **故意不**给 `rpcError` / `notice` 加豁免：一旦旧缺陷复活，门禁自动变红。
 * 唯一必须显式放行的是重置按钮自身的 `window.confirm` 文案（它本来就是
 * 用户可见对话，属正常交互）。
 */
import { expect, test, type Page } from './fixtures';
import {
  backendRpc,
  diagramData,
  gotoStage,
  openApp,
  resetBaseline,
  rpc,
} from './helpers';

interface WireRoi {
  id: string;
  name?: string;
  xlim?: [number, number];
  ylim?: [number, number];
  columns_stale?: boolean;
}

interface WireDiagram {
  rois: WireRoi[];
  activeRoiId: string | null;
  primaryRoiId: string | null;
  columns: Array<{
    id: string;
    name?: string;
    col_index?: number;
    startX?: number;
    endX?: number;
    tickEndX?: number;
    startValue?: number;
    tickValue?: number;
    x_ticks?: Array<{ px: number; value: number }> | null;
    roi_id?: string;
  }>;
  calibration: { isCalibrated: boolean; top_px: number | null; bottom_px: number | null };
  imageSrc: string | null;
  imageWidth: number;
  imageHeight: number;
}

const wire = (page: Page): Promise<WireDiagram> => diagramData<WireDiagram>(page);

/**
 * 让 `window.confirm` 返回真，并把 `beforeunload` 守卫关掉。
 *
 * ## 为什么必须在自动化里显式做这两件事
 *
 * 1. **`confirm`**：重置按钮第一句就是 `window.confirm(...)`。`fixtures.ts` 的
 *    通知门禁把所有原生对话框统一 `dismiss()`（那是为了"捕获而不中断"），
 *    于是 `confirm` 恒返回 `false`，`onResetAll` 直接 `return` —— 用例会看到
 *    "后端仍是 28 列"，误判成产品缺陷。这里把它钉成"用户点了确定"。
 *    代价是 `telemetry.notices` 收不到这句文案，故**不要**再给它加 allowlist
 *    （那会让门禁看似覆盖实则空转）。
 * 2. **`beforeunload`**：`main.ts` 在 `history.canUndo()` 时注册了
 *    `beforeunload` 守卫（防止误关丢数据）。它弹出的确认框被同一套 `dismiss()`
 *    处理后，**导航会被取消**，表现为 `page.reload()` 卡到超时；顺带那条
 *    dialog 的 `message()` 是空串，还会污染通知门禁。
 *    产品自带 `window.__straditize_suppress_beforeunload()` 正是为这种情况准备的
 *    （`main.ts` 用它实现"确认关闭后不再拦"），这里复用它而不是绕过产品逻辑。
 */
async function armNativeDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.confirm = () => true;
    const w = window as unknown as { __straditize_suppress_beforeunload?: () => void };
    w.__straditize_suppress_beforeunload?.();
  });
}

/** 重新加载，且不被 `beforeunload` 守卫拦下。 */
async function reloadApp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __straditize_suppress_beforeunload?: () => void };
    w.__straditize_suppress_beforeunload?.();
  });
  await page.reload();
}

// ---------------------------------------------------------------------------
// B-07
// ---------------------------------------------------------------------------
test.describe('B-07 重置全部操作', () => {
  test('重置后不得产生任何 -32001，且后端 ROI/列真的归零', async ({ page, telemetry }) => {
    await resetBaseline(page);
    await armNativeDialogs(page);
    // 先把状态造成"非零"，否则"重置成功"无从证明。
    await rpc(page, 'column.calibrateXTicks', {
      col_index: 0,
      ticks: [
        { px: 322, value: 0 },
        { px: 402, value: 40 },
      ],
    });
    const before = await wire(page);
    expect(before.columns.length, '重置前必须有列，否则本用例不成立').toBeGreaterThan(0);

    await page.locator('#btn-reset-all').click();

    // 后端归零是**异步**的（`project.new` + 一次 `roi.update`），必须轮询到落定。
    await expect
      .poll(async () => (await wire(page)).columns.length, {
        message: '重置后后端列数必须归零',
        timeout: 15_000,
      })
      .toBe(0);

    // 关键判据一：本用例期间**不得**出现任何失败的 RPC（旧缺陷必然产生 -32001）。
    // 这里断言在用例体内而不只依赖 teardown，失败信息才能直接指向这条缺陷。
    expect(
      telemetry.rpcErrors.filter((e) => e.includes('applyLineRemoval') || e.includes('-32001')),
      '重置不得再触发 algorithm.applyLineRemoval（重置后根本没有 ROI，不该重算清理掩膜）'
    ).toEqual([]);

    // 关键判据二：不得弹后端失败详情框。
    await expect(page.locator('#rpc-error-modal')).toHaveCount(0);

    // 后端 ROI 与前端镜像都必须与后端一致：重置后应恰好一个建议 pollen ROI。
    //
    // 注意这里有**两次**后端变更（`project.new` 清空一切 → `roi.update` 建回建议框），
    // 而上面那条轮询只等到了第一步（列数归零在整个过程中都成立）。
    // 只读一次 `wire()` 会撞在两步之间，读到 `rois: []` —— 这是测试的时序问题，
    // 不是产品缺陷。所以 ROI 也必须轮询到自己稳定为止。
    await expect
      .poll(async () => (await wire(page)).rois.length, {
        message: '重置后应重建一个 pollen 建议区',
        timeout: 15_000,
      })
      .toBe(1);
    const after = await wire(page);
    expect(after.rois[0].name).toBe('pollen');

    const frontRois = await page.evaluate(() => {
      const api = (window as unknown as { __straditize?: { getState: () => Record<string, unknown> } })
        .__straditize;
      return (api?.getState()?.rois ?? []) as Array<{ id: string }>;
    });
    expect(
      frontRois.map((r) => r.id),
      '前端镜像的 ROI 列表必须与后端一致（否则画布会画出已不存在的区域）'
    ).toEqual(after.rois.map((r) => r.id));

    // 重置应回到步骤 1。
    const stage = await page.evaluate(() => {
      const api = (window as unknown as { __straditize?: { getState: () => Record<string, unknown> } })
        .__straditize;
      return api?.getState()?.stage as number;
    });
    expect(stage, '重置后应停在步骤 1').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B-04
// ---------------------------------------------------------------------------
test.describe('B-04 重分列不得回滚后端 ROI', () => {
  test('后端 ROI 被改窄后，步骤 5 重分列必须用新边界、不得写回旧值', async ({ page }) => {
    await resetBaseline(page);

    const original = (await wire(page)).rois[0];
    expect(original?.xlim, '基线 ROI 必须有 xlim').toBeTruthy();
    const [origX0, origX1] = original.xlim!;

    // 1. 直接改后端 ROI（绕过 `commitRoi`，因此**前端镜像一定滞后**
    //    —— 这正是 B-04 的触发条件：镜像与后端失同步）。
    const narrowed: [number, number] = [origX0 + 40, origX1 - 40];
    await backendRpc(page, 'roi.update', {
      roi_id: original.id,
      x0: narrowed[0],
      x1: narrowed[1],
    });

    // 确认后端真的接受了新值。
    const accepted = (await wire(page)).rois.find((r) => r.id === original.id);
    expect(accepted?.xlim, '后端应已接受改窄后的 ROI').toEqual(narrowed);

    // 2. 前端镜像仍是旧值 —— 先把这一点钉住，否则本用例可能在"镜像恰好同步"
    //    的情况下空转通过（那就证明不了 B-04 的触发条件成立）。
    const mirrored = await page.evaluate(() => {
      const api = (window as unknown as { __straditize?: { getState: () => Record<string, unknown> } })
        .__straditize;
      const rois = (api?.getState()?.rois ?? []) as Array<{ id: string; xlim?: [number, number] }>;
      return rois[0]?.xlim ?? null;
    });
    expect(mirrored, '前提：前端镜像此时仍是旧边界（否则本用例测不到 B-04）').toEqual([
      origX0,
      origX1,
    ]);

    // 3. 走真实 UI 推进到步骤 5（触发重分列）。
    await gotoStage(page, 5);

    // 4. 关键判据：后端 ROI 必须**保持**改窄后的值。
    //    旧实现会把它写回 [origX0, origX1]。
    const afterSplit = (await wire(page)).rois.find((r) => r.id === original.id);
    expect(
      afterSplit?.xlim,
      `重分列不得回滚后端 ROI：改窄后为 ${JSON.stringify(narrowed)}，重分列后应为同一值`
    ).toEqual(narrowed);

    // 5. 分列本身必须真的发生过（否则"没回滚"可能只是因为压根没跑）。
    expect((await wire(page)).columns.length, '重分列应产出列').toBeGreaterThan(0);

    // 6. 前端镜像此时也必须与后端一致（分列后的 getDiagramData 回填）。
    const mirrorAfter = await page.evaluate(() => {
      const api = (window as unknown as { __straditize?: { getState: () => Record<string, unknown> } })
        .__straditize;
      const rois = (api?.getState()?.rois ?? []) as Array<{ id: string; xlim?: [number, number] }>;
      return rois.find((r) => r.id === 'roi_1')?.xlim ?? null;
    });
    expect(mirrorAfter, '分列后前端镜像应回到后端权威值').toEqual(narrowed);
  });
});

// ---------------------------------------------------------------------------
// B-05
// ---------------------------------------------------------------------------
test.describe('B-05 草稿恢复必须落到后端', () => {
  // `webMCP.callTool` 会把草稿写进自动存档，并顺带提示"WebMCP 已执行"——
  // 那是本用例**主动**触发的正常交互，不是被测缺陷的通知。
  test.use({ allowlists: { notice: [/WebMCP 已执行/] } });

  const AUTOSAVE_KEY = 'straditize_autosave_draft_v2';

  test('点【恢复草稿】后后端列数、标定与改名必须与草稿一致', async ({ page }) => {
    await resetBaseline(page);

    // 1. 造一个"真的做过事"的后端状态：标定一列 X 刻度 + 改名。
    await rpc(page, 'column.calibrateXTicks', {
      col_index: 3,
      ticks: [
        { px: 860, value: 0 },
        { px: 940, value: 30 },
      ],
    });
    await rpc(page, 'column.update', { col_index: 5, updates: { name: 'Pinaceae' } });

    // 2. 重新加载让前端镜像吸收上面的后端改动，再让**应用自己**写一份草稿。
    //    走 `webMCP.callTool` 而不是手抄字段：它内部就是
    //    `syncWebMcpState` → `scheduleAutosave`，存下来的正是
    //    `{ timestamp, data: canvasComponent.data }` —— 与真实自动存档一字不差。
    await reloadApp(page);
    await openApp(page);
    await page.evaluate(async () => {
      const w = window as unknown as { webMCP?: { callTool: (n: string, a?: object) => Promise<unknown> } };
      await w.webMCP?.callTool('straditize.getDiagramData', {});
    });

    // 存档是 1 秒防抖。
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return 0;
            try {
              return (JSON.parse(raw)?.data?.columns ?? []).length as number;
            } catch {
              return 0;
            }
          }, AUTOSAVE_KEY),
        { message: '应用应把当前状态写入自动存档', timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), AUTOSAVE_KEY);
    const draftColumnCount = draft.data.columns.length as number;

    // 3. 清空后端的**列**，模拟"换了机器 / 服务重启"后只剩草稿的真实场景。
    //    这一步是判定的分水岭：旧实现恢复后后端**仍是 0 列**。
    //
    //    只清列、必须把 ROI 建回来：`project.new` 会连 `rois` 一起清空，而后端
    //    零 ROI 时应用自己都起不来（`openApp` → `waitForDiagram` 要求 `rois > 0`），
    //    用例会卡在 reload 上而不是测到缺陷。用草稿里的 ROI 边界重建 pollen 区，
    //    既满足"应用能启动"，又保持了"后端 0 列"这个被测前提。
    await backendRpc(page, 'project.new');
    const draftRoi = (draft.data.rois as Array<Record<string, unknown>>)?.[0];
    expect(draftRoi?.xlim, '前置：草稿里应带 ROI 边界').toBeTruthy();
    const [rx0, rx1] = draftRoi.xlim as [number, number];
    const [ry0, ry1] = draftRoi.ylim as [number, number];
    await backendRpc(page, 'roi.update', { x0: rx0, x1: rx1, y0: ry0, y1: ry1 });
    const cleared = await wire(page);
    expect(cleared.columns.length, '前置：后端此时应为 0 列').toBe(0);
    expect(cleared.rois.length, '前置：后端应有 1 个 ROI（否则应用起不来，测不到本题）').toBe(1);

    // 4. 重新加载 → bootstrap 发现草稿 → 挂出恢复横幅 → 点【恢复草稿】。
    await reloadApp(page);
    await openApp(page);
    const restoreBtn = page.locator('#btn-restore-draft');
    await expect(restoreBtn, '应挂出草稿恢复横幅').toBeVisible({ timeout: 20_000 });
    await restoreBtn.click();

    // 5. 关键判据：后端列数必须回到草稿的列数。
    await expect
      .poll(async () => (await wire(page)).columns.length, {
        message: `恢复草稿后后端必须有 ${draftColumnCount} 列（旧实现恒为 0）`,
        timeout: 30_000,
      })
      .toBe(draftColumnCount);

    // 6. 恢复出来的列必须与草稿逐列对齐（几何走样等于"假恢复"）。
    const after = await wire(page);
    const draftById = new Map<string, Record<string, unknown>>(
      (draft.data.columns as Array<Record<string, unknown>>).map((c) => [String(c.id), c])
    );
    for (const col of after.columns) {
      const want = draftById.get(col.id);
      if (!want) continue;
      expect(col.startX, `列 ${col.id} 的 startX 应与草稿一致`).toBe(want.startX);
      expect(col.endX, `列 ${col.id} 的 endX 应与草稿一致`).toBe(want.endX);
    }

    // 7. 标定过的列：x_ticks 必须回来 —— 这是"看起来恢复了、数字全错"的高发点。
    const draftCol3 = (draft.data.columns as Array<Record<string, unknown>>).find(
      (c) => c.col_index === 3
    );
    expect(draftCol3?.x_ticks, '前置：草稿里第 3 列应已标定').toBeTruthy();
    expect(
      after.columns.find((c) => c.col_index === 3)?.x_ticks,
      '第 3 列的两点式标定必须随草稿恢复到后端'
    ).toEqual(draftCol3?.x_ticks);

    // 8. 改名也要回来。
    expect(
      after.columns.find((c) => c.col_index === 5)?.name,
      '第 5 列的属种名必须随草稿恢复'
    ).toBe('Pinaceae');
  });
});

// ---------------------------------------------------------------------------
// B-05 的反向对照：草稿属于另一张图时必须拒绝
// ---------------------------------------------------------------------------
test.describe('B-05 草稿与当前底图不符时必须拒绝恢复', () => {
  // 本用例**故意**制造一次失败恢复，用户会看到错误弹窗 —— 那正是被测行为。
  test.use({ allowlists: { notice: [/草稿属于另一张图谱|恢复自动存档草稿/], rpcError: [/project\.load/], consoleError: [/恢复自动存档草稿/] } });

  const AUTOSAVE_KEY = 'straditize_autosave_draft_v2';

  test('尺寸不符的草稿：后端列状态不得被草稿污染，且用户必须收到明确拒绝', async ({ page }) => {
    await resetBaseline(page);

    // 让应用写一份真实草稿，然后把它的图像尺寸改成一个**不可能是当前图**的值。
    await page.evaluate(async () => {
      const w = window as unknown as { webMCP?: { callTool: (n: string, a?: object) => Promise<unknown> } };
      await w.webMCP?.callTool('straditize.getDiagramData', {});
    });
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return 0;
            try {
              return (JSON.parse(raw)?.data?.columns ?? []).length as number;
            } catch {
              return 0;
            }
          }, AUTOSAVE_KEY),
        { message: '前置：应用应先写出草稿', timeout: 15_000 }
      )
      .toBeGreaterThan(0);

    await page.evaluate((key) => {
      const draft = JSON.parse(localStorage.getItem(key)!);
      // 尺寸改掉 = 草稿属于另一张图。
      draft.data.imageWidth = 1111;
      draft.data.imageHeight = 999;
      localStorage.setItem(key, JSON.stringify(draft));
    }, AUTOSAVE_KEY);

    // 后端当前是基线（28 列）。若拒绝生效，这个数字必须**一点都不变**。
    await backendRpc(page, 'project.new');
    const draftRoi = await page.evaluate((key) => {
      const d = JSON.parse(localStorage.getItem(key)!);
      const r = d?.data?.rois?.[0];
      return r?.xlim && r?.ylim ? { xlim: r.xlim, ylim: r.ylim } : null;
    }, AUTOSAVE_KEY);
    expect(draftRoi, '前置：草稿应带 ROI 边界').toBeTruthy();
    await backendRpc(page, 'roi.update', {
      x0: draftRoi!.xlim[0],
      x1: draftRoi!.xlim[1],
      y0: draftRoi!.ylim[0],
      y1: draftRoi!.ylim[1],
    });

    await reloadApp(page);
    await openApp(page);
    const restoreBtn = page.locator('#btn-restore-draft');
    await expect(restoreBtn, '应挂出草稿恢复横幅').toBeVisible({ timeout: 20_000 });
    await restoreBtn.click();

    // 关键判据一：用户必须被告知拒绝（后端失败通道：可复制详情弹窗）。
    await expect(page.locator('#rpc-error-modal'), '必须弹出错误详情，不得静默失败').toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('#rpc-error-modal')).toContainText('草稿属于另一张图谱');

    // 关键判据二：后端列状态**不得**被这份草稿写入（仍是 0 列）。
    expect(
      (await wire(page)).columns.length,
      '拒绝恢复后后端不得有任何列 —— 否则上一张图的分列被写到了当前图上'
    ).toBe(0);
  });
});
