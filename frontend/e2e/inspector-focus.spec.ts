/**
 * 列属性面板：重渲染**不得**打断正在进行的输入（§9 步骤面板整块重挂）。
 *
 * ## 缺口本体
 *
 * `Inspector.render()` 的唯一实现是整段重写 `this.element.innerHTML`，而 `updateData()`
 * 在任何数据变化时都会被调到（`main.ts` 八处）。于是「点进属种名输入框 → focusin 触发一次
 * 数据刷新 → 输入框被销毁」：焦点掉回 `<body>`，已敲入但未提交的内容一起消失。
 * 侧栏早就踩过同一个坑并已修（`Sidebar.renderPreservingInlineEdit`，带 focusin 再入守卫），
 * 本文件把同一条判据钉到 Inspector 上。
 *
 * ## 判据必须能证明"真的重渲染了"
 *
 * 只断言"焦点还在"会假绿——如果触发动作根本没引起重渲染，输入当然还在。
 * 所以先给输入框打一个 `data-epoch` 标记，触发后再确认**标记消失**（说明 DOM 被重写），
 * 然后才断言焦点 / 值 / 光标位置。
 */

import { expect, test } from './fixtures';
import { resetBaseline } from './helpers';

interface EditState {
  activeId: string;
  value: string;
  caret: number;
  epochPresent: boolean;
}

async function readEditState(page: import('@playwright/test').Page): Promise<EditState> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const same = el && el.id ? document.getElementById(el.id) : null;
    return {
      activeId: el?.id ?? '',
      value: el?.value ?? '',
      caret: el && 'selectionStart' in el ? (el.selectionStart ?? -1) : -1,
      epochPresent: same?.getAttribute('data-epoch') === 'marker',
    };
  });
}

test.describe('Inspector 重渲染保输入', () => {
  test('属种名输入框：重渲染后焦点、值、光标都还在', async ({ page }) => {
    await resetBaseline(page);
    const colId = await page.evaluate(
      () => (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState().columns[0].id
    );
    await page.evaluate(
      (id) => (window as unknown as { __straditize: { selectColumn: (i: string) => void } }).__straditize.selectColumn(id),
      colId
    );

    const input = page.locator('#inp-col-name');
    await expect(input).toBeVisible();
    const original = await input.inputValue();

    await input.click();
    await input.press('End');
    await page.keyboard.type('Pinus', { delay: 30 });
    const typed = original + 'Pinus';

    // 打标记：重渲染后这个属性会随旧节点一起消失（这就是"真的重渲染了"的证据）。
    await page.evaluate(() => document.getElementById('inp-col-name')?.setAttribute('data-epoch', 'marker'));

    // 同一列再选中一次：走 onSelectTaxa → onDataChange → updateData → Inspector.render()
    await page.evaluate(
      (id) => (window as unknown as { __straditize: { selectColumn: (i: string) => void } }).__straditize.selectColumn(id),
      colId
    );
    await page.waitForTimeout(400);

    const state = await readEditState(page);
    expect(state.epochPresent, '触发动作没有引起重渲染——这条判据会假绿，先修触发方式').toBe(false);
    expect(state.activeId, '重渲染把焦点丢了：activeElement 不再是该输入框').toBe('inp-col-name');
    expect(state.value, '重渲染后未提交的输入被清掉了').toBe(typed);
    expect(state.caret, '光标位置没保住，继续打字会跳回开头').toBe(typed.length);
  });
});
