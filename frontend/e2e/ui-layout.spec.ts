/**
 * 应用外壳布局门禁（`docs/UI_DESIGN_SYSTEM.md` §8 响应式）。
 *
 * 顶栏是两行网格：第一行「项目操作 | 全局操作」，第二行整宽「工作流条」。
 * 这三件事在真实浏览器里必须同时成立，否则就是用户能看见的布局缺陷：
 *   1. 第一行两组不横向重叠（旧版单行顶栏在 1366 下会互相压盖）；
 *   2. 工作流条真的落在第二行；
 *   3. 关键出口（导出 / 设置 / 8 个步骤按钮）完整落在视口内，且不产生
 *      页面级横向滚动。
 *
 * 尺寸取设计规范的下限 1280×720、文档要求验证的 1366×768 与 1920×1080。
 * 断言只依赖几何，不依赖 grid-area 命名，重构顶栏内部类名不会误报。
 */
import { expect, test } from './fixtures';
import { openApp } from './helpers';

const SIZES = [
  { label: '1366×768', width: 1366, height: 768 },
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1280×720', width: 1280, height: 720 },
] as const;

test.describe('应用外壳布局：顶栏两行与尺寸下限', () => {
  for (const size of SIZES) {
    test(`${size.label}：顶栏两行不重叠，导出/设置/步骤按钮完整可见`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openApp(page);

      const boxes = await page.evaluate(() => {
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const steps = Array.from(document.querySelectorAll('.workflow-step-btn')).map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, right: r.right, width: r.width, text: (el.textContent ?? '').trim() };
        });
        // 第一行左侧分区里**真实控件**的最右边界。容器是网格列（天然不重叠），
        // 会溢出的是里面的内容——旧版 1366 下正是这里压到了右侧全局操作。
        const leftContent = Array.from(
          document.querySelectorAll('.toolbar-left button, .toolbar-left select')
        ).map((el) => el.getBoundingClientRect());
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollWidth: document.documentElement.scrollWidth,
          left: rect('.toolbar-left'),
          right: rect('.toolbar-right'),
          center: rect('.toolbar-center'),
          exportBtn: rect('#btn-export-csv'),
          settingsBtn: rect('#btn-settings'),
          leftContentRight: leftContent.reduce((m, r) => Math.max(m, r.right), 0),
          leftContentCount: leftContent.length,
          steps,
        };
      });
      console.log(`[ui-layout ${size.label}] ${JSON.stringify(boxes)}`);

      const { left, right, center, exportBtn, settingsBtn } = boxes;
      if (!left || !right || !center || !exportBtn || !settingsBtn) {
        throw new Error(`顶栏分区或关键出口缺失：${JSON.stringify(boxes)}`);
      }

      // 1. 不允许页面级横向滚动（顶栏溢出会把整个应用推出视口）
      expect(
        boxes.scrollWidth,
        '页面不得出现横向滚动（顶栏内容必须在给定宽度内收敛）'
      ).toBeLessThanOrEqual(boxes.viewport.width + 1);

      // 2. 第一行左侧的**控件内容**不得压到右侧全局操作组
      //    （容器是网格列、天然不重叠；会溢出的只有里面的控件）
      expect(
        boxes.leftContentCount,
        '第一行左侧应包含 打开图谱/保存项目/打开项目/示例/重置/撤销/重做 等控件'
      ).toBeGreaterThanOrEqual(6);
      expect(
        boxes.leftContentRight,
        `第一行左侧控件最右边界(${boxes.leftContentRight})不得越过全局操作组左边界(${right.x})`
      ).toBeLessThanOrEqual(right.x + 0.5);

      // 3. 工作流条位于第二行：其顶边不低于第一行的底边
      expect(
        center.y,
        `工作流条(y=${center.y})必须落在第一行(y=${left.y}, 高=${left.height})下方`
      ).toBeGreaterThanOrEqual(left.y + left.height - 1);

      // 4. 关键全局出口完整落在视口内
      for (const [name, box] of [
        ['#btn-export-csv', exportBtn],
        ['#btn-settings', settingsBtn],
      ] as const) {
        expect(box.x, `${name} 左边界越出视口`).toBeGreaterThanOrEqual(-0.5);
        expect(box.right, `${name} 右边界越出视口（${box.right} > ${boxes.viewport.width}）`)
          .toBeLessThanOrEqual(boxes.viewport.width + 0.5);
      }

      // 5. 8 个步骤按钮齐全且各自完整可见（工作流条可横向滚动，但不得被裁掉）
      expect(boxes.steps.length, '工作流步骤按钮数量').toBe(8);
      for (const step of boxes.steps) {
        expect(step.x, `步骤按钮「${step.text}」左边界越出视口`).toBeGreaterThanOrEqual(-0.5);
        expect(
          step.right,
          `步骤按钮「${step.text}」右边界越出视口（${step.right} > ${boxes.viewport.width}）；` +
            '该尺寸下工作流条不得被裁切'
        ).toBeLessThanOrEqual(boxes.viewport.width + 0.5);
      }
    });
  }
});
