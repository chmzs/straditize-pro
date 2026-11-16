/**
 * 步骤 6 面板的**可测版面契约**（用户反馈：「步骤 6 面板 UI 变差了」「确保交互和界面适当美观」）。
 *
 * 四条判据全部是可测量的数字/标志位——评审者看不到截图，所以「好看」必须落成几何量与集合包含：
 *
 * 1. **字号只用设计 token**：面板内全部元素的 computed font-size ⊆ {10,11,12,14,16}px
 *    （docs/UI_DESIGN_SYSTEM.md 的字体 token）。离标值（9 / 9.5 / 10.5 / 11.5 / 13）一个都不许有。
 * 2. **分组动作行不抖动**：「+ 分组 / 删除本组 / 合并同类组」恒定渲染、固定顺序；
 *    切组前后行与三个按钮的 boundingBox 必须逐像素相同（≤0.5px），不可用时靠 disabled 表达。
 * 3. **单位输入并入参数网格**：高度 == --control-h-sm(28px)，左边界与「形态 / 尺度」
 *    按钮组左边界相差 ≤1px（旧实现是 68px 裸输入框贴在标题行右侧，高 16px、不同列）。
 * 4. **主动作不压控件**：#btn-apply-xticks-next 必须挂在滚动容器 .inspector-body
 *    **之外**的 .inspector-footer，与任何**可见**控件矩形不相交（被 overflow 裁掉的内容
 *    不算——它的布局矩形会延伸到滚动区外，但既看不见也点不到），且 1366×768 与
 *    1280×720 两档下 bottom <= 视口高。
 *
 * ## 反向验证（改回去必须变红）
 *
 * - 把任一 font-size token 改回 9.5px → 判据 1 红；
 * - 把「删除本组」改回条件渲染 → 判据 2 红（按钮消失 / 行盒变化）；
 * - 把单位输入改回 width:68px + padding:1px 4px → 判据 3 红（高 16px、左边界错位）；
 * - 把主动作改回 position: sticky 留在 .inspector-body 内 → 判据 4 红。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, openApp, resetBaseline, rpc } from './helpers';

const PANEL = '.step-panel[data-step="6"]';
const ALLOWED_FONT_SIZES = new Set(['10px', '11px', '12px', '14px', '16px']);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 面板内每个元素的计算字号 → 出现次数。 */
async function fontSizes(page: Page): Promise<Array<[string, number]>> {
  return page.evaluate((sel) => {
    const panel = document.querySelector<HTMLElement>(sel);
    if (!panel) throw new Error('步骤 6 面板不存在');
    const counts = new Map<string, number>();
    panel.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const size = getComputedStyle(el).fontSize;
      counts.set(size, (counts.get(size) ?? 0) + 1);
    });
    return Array.from(counts.entries());
  }, PANEL);
}

/** 分组动作行的行盒 + 三个按钮盒（顺序固定）。 */
async function groupActionBoxes(
  page: Page
): Promise<{ row: Box; buttons: Box[]; disabled: boolean[] }> {
  const row = page.locator(PANEL + ' [data-role="group-actions"]');
  await expect(row, '分组动作行必须恒定存在').toBeVisible();
  const buttons = row.locator('button');
  await expect(buttons, '分组动作行必须恒有三个按钮').toHaveCount(3);
  const rowBox = await row.boundingBox();
  if (!rowBox) throw new Error('分组动作行缺少 boundingBox');
  const boxes: Box[] = [];
  const disabled: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const b = await buttons.nth(i).boundingBox();
    if (!b) throw new Error('第 ' + (i + 1) + ' 个分组按钮缺少 boundingBox');
    boxes.push(b);
    disabled.push(await buttons.nth(i).isDisabled());
  }
  return { row: rowBox, buttons: boxes, disabled };
}

function expectSameBox(actual: Box, expected: Box, label: string): void {
  const keys = ['x', 'y', 'width', 'height'] as const;
  for (const key of keys) {
    expect(
      Math.abs(actual[key] - expected[key]),
      label + ' 的 ' + key + ' 在切组后变了：' + actual[key] + ' vs ' + expected[key]
    ).toBeLessThanOrEqual(0.5);
  }
}

test.describe('步骤 6 面板版面契约', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await resetBaseline(page);
    await gotoStage(page, 5);
    await gotoStage(page, 6);
  });

  test('字号只用设计 token：面板内 font-size 只取 10/11/12/14/16', async ({ page }) => {
    const sizes = await fontSizes(page);
    const offenders = sizes.filter((entry) => !ALLOWED_FONT_SIZES.has(entry[0]));
    expect(
      offenders,
      '面板里出现离标字号（设计系统只允许 10/11/12/14/16）：' + JSON.stringify(offenders)
    ).toEqual([]);
  });

  test('分组动作行恒定可见，切组前后 boundingBox 不变（不抖动）', async ({ page }) => {
    // 起点：基线只有一个组，「删除本组 / 合并同类组」必须是**禁用**而不是消失。
    const oneGroup = await groupActionBoxes(page);
    expect(oneGroup.disabled, '只有一个组时：+ 分组可用，删除/合并禁用').toEqual([
      false,
      true,
      true,
    ]);

    // 造出第二个组（后端权威），再让前端重新拉数据。
    const data = await diagramData<{ rois: Array<{ id: string }> }>(page);
    const roiId = data.rois[0]?.id;
    if (!roiId) throw new Error('基线没有 ROI，无法造第二个组');
    await rpc(page, 'roi.groupCreate', { roi_id: roiId, name: '测试组B', unit: 'counts' });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 6);

    const twoGroupsDefault = await groupActionBoxes(page);
    expect(twoGroupsDefault.disabled, '两个组但当前是默认组：删除仍禁用、合并可用').toEqual([
      false,
      true,
      false,
    ]);

    // 切到第二个组：三个按钮的位置与尺寸必须一模一样。
    const tabs = page.locator(PANEL + ' .btn-switch-group-tab');
    await expect(tabs).toHaveCount(2);
    await tabs.nth(1).click();
    await expect(tabs.nth(1), '应切到第二个组').toHaveClass(/ui-btn--primary/);

    const twoGroupsOther = await groupActionBoxes(page);
    expect(twoGroupsOther.disabled, '切到非默认组后「删除本组」必须可用').toEqual([
      false,
      false,
      false,
    ]);
    expectSameBox(twoGroupsOther.row, twoGroupsDefault.row, '分组动作行');
    for (let i = 0; i < 3; i++) {
      expectSameBox(twoGroupsOther.buttons[i], twoGroupsDefault.buttons[i], '第 ' + (i + 1) + ' 个按钮');
    }
  });

  test('单位输入并入参数网格：高 28px，左边界与形态/尺度按钮组对齐', async ({ page }) => {
    const metrics = await page.evaluate((sel) => {
      const panel = document.querySelector<HTMLElement>(sel);
      if (!panel) throw new Error('步骤 6 面板不存在');
      const unit = panel.querySelector<HTMLInputElement>('#grp-unit-inp');
      const shape = panel.querySelector<HTMLElement>('.grp-plottype-btn');
      const scale = panel.querySelector<HTMLElement>('.grp-scaletype-btn');
      if (!unit || !shape || !scale) throw new Error('单位输入或形态/尺度按钮缺失');
      const u = unit.getBoundingClientRect();
      return {
        unitHeight: u.height,
        unitLeft: u.left,
        shapeLeft: shape.getBoundingClientRect().left,
        scaleLeft: scale.getBoundingClientRect().left,
        controlHSm: getComputedStyle(document.documentElement).getPropertyValue('--control-h-sm'),
      };
    }, PANEL);

    expect(metrics.unitHeight, '单位输入高度必须是 --control-h-sm').toBe(28);
    expect(metrics.controlHSm.trim(), '前提：设计 token --control-h-sm 就是 28px').toBe('28px');
    expect(
      Math.abs(metrics.unitLeft - metrics.shapeLeft),
      '单位输入左边界与形态按钮组不对齐：' + metrics.unitLeft + ' vs ' + metrics.shapeLeft
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(metrics.unitLeft - metrics.scaleLeft),
      '单位输入左边界与尺度按钮组不对齐：' + metrics.unitLeft + ' vs ' + metrics.scaleLeft
    ).toBeLessThanOrEqual(1);
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    test(
      '主动作在滚动容器之外、不与任何可见控件相交（' +
        viewport.width +
        '×' +
        viewport.height +
        '）',
      async ({ page }) => {
        await page.setViewportSize(viewport);
        await resetBaseline(page);
        await gotoStage(page, 5);
        await gotoStage(page, 6);

        const probe = await page.evaluate(() => {
          const primary = document.getElementById('btn-apply-xticks-next');
          const body = document.querySelector<HTMLElement>('.inspector-body');
          const footer = document.querySelector<HTMLElement>('.inspector-footer');
          if (!primary) throw new Error('主动作按钮 #btn-apply-xticks-next 不存在');
          if (!body) throw new Error('.inspector-body 不存在');
          const pr = primary.getBoundingClientRect();
          const br = body.getBoundingClientRect();
          const overlaps: string[] = [];
          const clippedButTouching: string[] = [];
          const selector =
            '.app-inspector input, .app-inspector select, .app-inspector button, .app-inspector textarea';
          document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
            if (el === primary) return;
            const r = el.getBoundingClientRect();
            const rawHit =
              r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top;
            if (!rawHit) return;
            // 被 .inspector-body 的 overflow 裁掉的部分既看不见也点不到：先求可见矩形，
            // 再判「可见矩形是否压到主动作」。直接用未裁剪的布局矩形会把滚动区外
            // 那些根本画不出来的输入框也算成被遮挡（实测 1280×720 的轴粗输入框）。
            const visTop = Math.max(r.top, br.top);
            const visBottom = Math.min(r.bottom, br.bottom);
            const visLeft = Math.max(r.left, br.left);
            const visRight = Math.min(r.right, br.right);
            const label = el.id || el.className || el.tagName;
            const visibleHit =
              visRight > visLeft &&
              visBottom > visTop &&
              visLeft < pr.right &&
              visRight > pr.left &&
              visTop < pr.bottom &&
              visBottom > pr.top;
            if (visibleHit) overlaps.push(label);
            else if (visBottom > visTop && visRight > visLeft) clippedButTouching.push(label);
          });
          const footerStyle = footer ? getComputedStyle(footer) : null;
          return {
            hasFooter: Boolean(footer),
            primaryParentClass: primary.parentElement?.className ?? null,
            primaryBottom: pr.bottom,
            viewportHeight: window.innerHeight,
            overlaps,
            clippedButTouching,
            footerBg: footerStyle ? footerStyle.backgroundColor : null,
            bodyBottom: br.bottom,
            footerTop: footer ? footer.getBoundingClientRect().top : null,
          };
        });

        expect(
          probe.hasFooter,
          '主动作没有被移到 .inspector-footer：留在 .inspector-body 里会压住滚动内容'
        ).toBe(true);
        expect(probe.primaryParentClass, '主动作必须挂在 .inspector-footer（滚动容器之外）').toBe(
          'inspector-footer'
        );
        expect(probe.footerTop, 'footer 必须紧贴滚动区下缘（不能在滚动区内部）').toBeGreaterThanOrEqual(
          probe.bodyBottom - 1
        );
        expect(
          probe.overlaps,
          '主动作压住了可见控件：' + JSON.stringify(probe.overlaps)
        ).toEqual([]);
        expect(
          probe.primaryBottom,
          '主动作超出视口：bottom=' +
            Math.round(probe.primaryBottom) +
            ' viewport=' +
            probe.viewportHeight
        ).toBeLessThanOrEqual(probe.viewportHeight);
        // 不透明底色：即使有内容从下方滚过，也不会"透"进按钮里。
        expect(probe.footerBg, 'footer 底色必须不透明（rgb(...)，无 alpha 通道）').toMatch(/^rgb\(/);
      }
    );
  }
});
