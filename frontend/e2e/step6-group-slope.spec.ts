/**
 * 步骤 6 组级点齿标定的三条硬约束（取代已删除的「单列两点标定」测试）。
 *
 * ## 为什么单独一份
 *
 * 标定模型已改为**组级斜率**（`ColumnGroup.value_per_px`，ARCHITECTURE §6.4）：
 * 用户点一个刻度齿 + 填它的数字 → `slope = 数字 / 距0点px`，组内所有列共用。
 * 写入时后端会清空各列的 `x_ticks`，所以**任何"查 col.x_ticks"的旧断言都失效**。
 *
 * 但旧测试守的三条约束仍然必须成立，本文件按新契约（`scale_provenance`）重钉：
 *
 * ① 标定必须**真发 RPC 并落后端**（不能只活在浏览器内存）；
 * ② **重载页面后标定仍在**；
 * ③ **非法斜率当场拒绝**（0 会让整列恒为 0、NaN/inf 会污染全部换算）。
 */
import { expect, test } from './fixtures';
import { backendRpc, gotoStage, openApp, readColumnScale } from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';

/** 走组斜率标定（等价于 UI 上「点一个刻度齿 + 填它的数字」）。 */
async function applyGroupSlope(
  page: import('@playwright/test').Page,
  slope: number
): Promise<void> {
  await backendRpc(page, 'roi.groupUpdate', {
    roi_id: RID,
    group_id: GID,
    updates: { value_per_px: slope },
  });
}

test.describe('步骤 6 组斜率标定（点齿模型的硬约束）', () => {
  test('① 组斜率必须真发 RPC 并落后端：source=group_slope 且 calibrated=true', async ({
    page,
    telemetry,
  }) => {
    await openApp(page);
    await gotoStage(page, 6);

    const before = await readColumnScale(page, 0);
    expect(before.calibrated, '前置：初始未标定').toBe(false);

    await applyGroupSlope(page, 0.16);
    await page.reload();
    await page.waitForFunction(
      () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
      undefined,
      { timeout: 45_000 }
    );

    const after = await readColumnScale(page, 0);
    expect(after.calibrated, '标定必须真的落到后端').toBe(true);
    expect(after.source, '标定的来源必须标明是组斜率').toBe('group_slope');
    // 0 点在轴线右缘（左缘 + 轴线粗），不是列边界；斜率恒等映射到 px1。
    expect(after.px0, '0 点必须大于列左缘（轴线有粗细）').toBeGreaterThan(0);
    expect(after.val0, '0 点对应的值必须是 0').toBe(0);
    expect(after.val1).toBeCloseTo(0.16, 6);
    expect(telemetry.rpcErrors, '标定过程不得有失败请求').toEqual([]);
  });

  test('② 重载页面后标定仍在（证伪"只活在浏览器内存里"）', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 6);
    await applyGroupSlope(page, 0.08);

    // 两次重载：第一次拉回后端状态，第二次证明它不是靠某次内存缓存撑着的。
    for (let i = 0; i < 2; i += 1) {
      await page.reload();
      await page.waitForFunction(
        () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
        undefined,
        { timeout: 45_000 }
      );
    }

    const after = await readColumnScale(page, 0);
    expect(after.calibrated, '重载两次后仍必须已标定').toBe(true);
    expect(after.source).toBe('group_slope');
    expect(after.val1).toBeCloseTo(0.08, 6);
  });

  test('③ 非法斜率必须当场拒绝，且不改变后端状态', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 6);

    // 前置：先有一个合法标定，用来验证"非法写入没有把它冲掉"。
    await applyGroupSlope(page, 0.16);
    const before = await readColumnScale(page, 0);
    expect(before.calibrated).toBe(true);

    const bad: Array<number | string> = [0, 'NaN', 'abc'];
    for (const value of bad) {
      await expect(
        backendRpc(page, 'roi.groupUpdate', {
          roi_id: RID,
          group_id: GID,
          updates: { value_per_px: value },
        }),
        `非法值 ${String(value)} 必须被后端拒绝（0 会让整列恒为 0，NaN 会污染全部换算）`
      ).rejects.toThrow();
    }

    const after = await readColumnScale(page, 0);
    expect(after.val1, '被拒绝的写入不得改动已有斜率').toBeCloseTo(before.val1, 6);
    expect(after.calibrated).toBe(true);
  });
});
