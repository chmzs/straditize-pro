/**
 * 步骤 2「数据有效区 (ROI)」的逐控件可用性排查。
 *
 * ## 只补真正的缺口（不重复 journey 已有的事实）
 *
 * `journey.spec.ts:96-128` 已经驱动过：改名（两个 ROI）、`#btn-create-roi` 新建、
 * `.btn-set-primary` 设主区、`#btn-apply-roi-next` 推进。那三步**不在此重复**。
 *
 * 排查后仍然**从没有任何用例驱动过**的三个控件：
 *
 * | 控件 | 目标后端调用 | 为什么危险 |
 * | --- | --- | --- |
 * | `.btn-delete-roi` | `roi.remove` | 删除要级联清理列/控制点**并重指派 active/primary 指针**；只断言 `rois` 变短抓不到"指针悬在已删除 id 上" |
 * | `.roi-item-card` 点击 | `roi.setActive` | 切换活动 ROI 后，面板显示的必须是**该** ROI 的属性；面板沿用上一个 ROI 的值＝在撒谎 |
 * | `#chk-roi-composition` | `roi.update{composition}` | 它是**只带一个字段的局部更新**——"未传即清空"的实现会把名字一起抹掉 |
 *
 * ## 字段名必须用线缆上的驼峰名
 *
 * `straditize.getDiagramData` 实际发 `activeRoiId` / `primaryRoiId`，而 TS 声明与
 * `RpcClient` 内部用的是下划线名，靠 `RpcClient.ts:315-316` 的垫片兜住。本文件用
 * `rpc()` 直通后端，**绕过垫片**，所以只能读驼峰名。写成下划线名不会报错，只会
 * 恒为 `undefined`——这个坑 `step-visibility.spec.ts:192` 已经踩过一次并记录在案。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, openApp, resetBaseline } from './helpers';

interface RoiRecord {
  id: string;
  name?: string;
  name_source?: string;
  composition?: boolean;
}

/** 只写本文件真正用到的线缆字段（驼峰名，见文件头说明）。 */
interface WireRoiState {
  rois: RoiRecord[];
  activeRoiId: string | null;
  primaryRoiId: string | null;
}

/** 后端权威 ROI 状态——所有断言的唯一事实源。 */
const roiState = (page: Page): Promise<WireRoiState> => diagramData<WireRoiState>(page);

/** 按 id 取后端 ROI；取不到就抛错，避免 `?.` 把断言变成永久真。 */
async function backendRoi(page: Page, id: string): Promise<RoiRecord> {
  const state = await roiState(page);
  const roi = state.rois.find((r) => r.id === id);
  if (!roi) {
    throw new Error(`后端不存在 ROI '${id}'（当前：${state.rois.map((r) => r.id).join(',') || '空'}）`);
  }
  return roi;
}

test.describe('步骤 2 数据有效区：三个从未被驱动的控件', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('删除那个同时是活动区与主区的 ROI：两个指针都必须级联重指派，不能悬在已删除的 id 上', async ({
    page,
  }) => {
    await gotoStage(page, 2);
    const panel = page.locator('.step-panel[data-step="2"]');

    // 起点：基线恰好一个 pollen ROI，同时是活动与主区。
    const before = await roiState(page);
    expect(before.rois.map((r) => r.id), '基线应只有一个 ROI').toEqual(['roi_1']);
    expect(before.activeRoiId).toBe('roi_1');
    expect(before.primaryRoiId).toBe('roi_1');

    // 造出"同时是活动与主区"的第二个 ROI —— 这是最能暴露悬挂指针的形态。
    await panel.locator('#btn-create-roi').click();
    await expect
      .poll(async () => (await roiState(page)).rois.length, {
        message: '点「新建」后后端 ROI 数应变成 2',
        timeout: 15_000,
      })
      .toBe(2);

    const created = (await roiState(page)).activeRoiId;
    expect(created, '新建后应自动选中新 ROI').toBeTruthy();
    expect(created, '新 ROI 必须是刚建的那个，而不是 baseline').not.toBe('roi_1');
    await expect(panel.locator('.roi-item-card'), '面板应真的多出一张卡').toHaveCount(2);

    await panel.locator(`.btn-set-primary[data-roi-id="${created}"]`).click();
    await expect
      .poll(async () => (await roiState(page)).primaryRoiId, {
        message: '设主后后端主区应指向新建的 ROI',
        timeout: 15_000,
      })
      .toBe(created);
    // 前提确认：此时两个指针都指向即将被删除的那个 ROI。
    const armed = await roiState(page);
    expect(armed.activeRoiId).toBe(created);
    expect(armed.primaryRoiId).toBe(created);

    // 删除它。
    await panel.locator(`.btn-delete-roi[data-roi-id="${created}"]`).click();
    await expect
      .poll(async () => (await roiState(page)).rois.map((r) => r.id), {
        message: '删除后后端应只剩 roi_1',
        timeout: 15_000,
      })
      .toEqual(['roi_1']);

    const after = await roiState(page);
    expect(
      after.primaryRoiId,
      '删掉主区后主指针必须重指派到存活 ROI，绝不能留在已删除的 id 上'
    ).toBe('roi_1');
    expect(after.activeRoiId, '活动指针同样必须落回存活 ROI').toBe('roi_1');
    await expect(panel.locator('.roi-item-card'), '面板应只剩一张卡').toHaveCount(1);
  });

  test('组分勾选写进后端、只改组分不得毁掉名字；切换活动 ROI 后复选框与名字必须跟着切', async ({
    page,
  }) => {
    await gotoStage(page, 2);
    const panel = page.locator('.step-panel[data-step="2"]');
    const compChk = panel.locator('#chk-roi-composition');
    const nameInp = panel.locator('#inp-roi-name');

    // 起点 roi_1 是成分型（载入时后端自动建的那个 pollen ROI）。
    expect((await backendRoi(page, 'roi_1')).composition, '基线 pollen ROI 的语义是成分型').toBe(true);

    // 建第二个 ROI 并给它一个**非默认名字**——名字是后面"局部更新不得毁名字"的观测点。
    await panel.locator('#btn-create-roi').click();
    await expect.poll(async () => (await roiState(page)).rois.length, { timeout: 15_000 }).toBe(2);
    const second = (await roiState(page)).activeRoiId;
    expect(second, '新建后应有一个活动 ROI').toBeTruthy();

    await nameInp.fill('湖泊B');
    await nameInp.press('Enter');
    await expect
      .poll(async () => (await backendRoi(page, second!)).name, {
        message: '改名必须真的写进后端',
        timeout: 15_000,
      })
      .toBe('湖泊B');

    // ① 取消组分勾选：只带 composition 一个字段的局部更新。
    await compChk.uncheck();
    await expect
      .poll(async () => (await backendRoi(page, second!)).composition, {
        message: '取消勾选必须真的写进后端',
        timeout: 15_000,
      })
      .toBe(false);

    const afterToggle = await backendRoi(page, second!);
    expect(
      afterToggle.name,
      '只改组分不能把名字清掉——任何"未传即清空"的局部更新实现都会在此变红'
    ).toBe('湖泊B');
    expect(afterToggle.name_source, '局部更新同样不能把名字来源降级回 default').toBe('user');

    // ② 切换活动 ROI：面板上的复选框与名字框必须是**该 ROI** 的真值。
    //    逐个来回切，断言每次都与后端一致——沿用上一个 ROI 的值就会在这里红。
    const cases = [
      { id: 'roi_1', checked: true },
      { id: second!, checked: false },
      { id: 'roi_1', checked: true },
    ];
    for (const c of cases) {
      const truth = await backendRoi(page, c.id);
      expect(truth.composition, `前提：后端 ${c.id}.composition 应为 ${c.checked}`).toBe(c.checked);
      await panel.locator(`.roi-item-card[data-roi-id="${c.id}"]`).click();
      await expect
        .poll(async () => (await roiState(page)).activeRoiId, { timeout: 15_000 })
        .toBe(c.id);
      await expect(
        compChk,
        `切到 ${c.id} 后复选框必须是该 ROI 的真值（后端 ${truth.composition}）；显示上一个 ROI 的值就是面板在撒谎`
      ).toBeChecked({ checked: c.checked });
      await expect(
        nameInp,
        `切到 ${c.id} 后名字框必须显示该 ROI 的真名`
      ).toHaveValue(truth.name!);
    }

    // ③ 刷新：面板必须还原**后端活动 ROI** 的真值，而不是渲染期的默认值。
    //    上面那个循环最后停在 roi_1，所以这里先显式把活动区切回 composition=false 的那个，
    //    冷启动才落在真正有区分度的分支上（活动区若是 roi_1，默认值恰好也是 true，
    //    "面板拿默认值冒充" 这个缺陷就伪装成通过了）。
    await panel.locator(`.roi-item-card[data-roi-id="${second}"]`).click();
    await expect.poll(async () => (await roiState(page)).activeRoiId, { timeout: 15_000 }).toBe(second);

    await page.reload();
    await openApp(page);
    await gotoStage(page, 2);

    // 刷新后的期望值一律从后端取，不写死——写死就变成"测试自说自话"。
    const activeAfterReload = (await roiState(page)).activeRoiId;
    expect(activeAfterReload, '刷新后后端活动区应仍是刷新前那个').toBe(second);
    const truthAfterReload = await backendRoi(page, activeAfterReload!);
    expect(truthAfterReload.composition, '前提：活动区的组分应为 false，才检验得出面板是否拿默认值冒充').toBe(false);
    await expect(
      compChk,
      `刷新后复选框必须等于后端活动区（${activeAfterReload}）的组分 ${truthAfterReload.composition}`
    ).toBeChecked({ checked: false });
    await expect(nameInp, '刷新后名字框应显示后端活动区的真名').toHaveValue(truthAfterReload.name!);
  });
});

test.describe('步骤 2 改名撞车：后端必须拒绝，且名字不得被改坏', () => {
  // 本组故意触发一次失败重命名，所以显式声明豁免（`fixtures.ts` 要求的唯一合法方式）。
  test.use({
    allowlists: {
      rpcError: [/roi\.update \[-32002\]/],
      dialog: [/重命名有效区失败/],
      consoleError: [/\[RPC failure\] 重命名有效区/],
    },
  });

  test('把 ROI 改成已存在的名字：后端拒绝、名字保持不变、用户看得见报错', async ({ page, telemetry }) => {
    await resetBaseline(page);
    await gotoStage(page, 2);
    const panel = page.locator('.step-panel[data-step="2"]');

    await panel.locator('#btn-create-roi').click();
    await expect.poll(async () => (await roiState(page)).rois.length, { timeout: 15_000 }).toBe(2);
    const second = (await roiState(page)).activeRoiId;
    expect(second).toBeTruthy();

    // 撞上基线 ROI 的名字 'pollen'。
    const nameInp = panel.locator('#inp-roi-name');
    await nameInp.fill('pollen');
    await nameInp.press('Enter');

    // 用户必须被告知（alert 是本应用唯一的用户可见报错通道）。
    await expect
      .poll(() => telemetry.dialogs.join(' || '), {
        message: '重名改名失败必须弹框告知用户，而不是静默不生效',
        timeout: 15_000,
      })
      .toContain('重命名有效区失败');

    // 后端必须原样保留旧名字——拒绝要拒绝得干净。
    const after = await backendRoi(page, second!);
    expect(after.name, '被拒绝的重命名不得改动后端名字').not.toBe('pollen');
    expect(after.name, '被拒绝的重命名应让后端名字保持原值').toBe(`roi_${2}`);
    expect((await backendRoi(page, 'roi_1')).name, '被撞名的那个 ROI 更要原封不动').toBe('pollen');
  });
});
