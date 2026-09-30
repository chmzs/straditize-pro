/**
 * 步骤 5（分列 / 命名）逐动作门禁。
 *
 * ## 为什么必须单独补这一份
 *
 * 在此之前，步骤 5 的 e2e 覆盖只有 `naming.spec.ts` 里的 `naming.snapLabels`
 * 对账逻辑（后端契约）与"侧栏点名会高亮对应列"。而本步**用户真正会做的动作**
 * ——在侧栏把列名改成自己的属种名——一次都没被驱动过。逐个排查后发现它坏得
 * 很彻底，两个缺陷叠在一起：
 *
 * ① **改名输入框根本打不进字。** `focusin`（Sidebar）→ `onSelectTaxa`（main.ts）
 *    → `setActiveTaxa` → `onTaxaChange` → `Sidebar.updateData` → `render()`
 *    会把整栏 `innerHTML` 重写一遍。于是用户刚点开的那个 `<input>` 当场被销毁，
 *    焦点掉回 `<body>`。实测：聚焦前后不是同一个 DOM 节点、`document.activeElement`
 *    的 tagName 变成 `BODY`、逐字符敲 9 个键后 `value` 仍是 `col01`。
 * ② **就算敲进去了，名字也到不了后端。** `onRenameTaxa`（main.ts）只改前端内存
 *    + 写 `localStorage` 自动存档，从不发 RPC。而后端 `naming.renameColumn` 才是
 *    唯一会更新 `session.taxa_names` 的通道，且每次重新分列都由 `detect_columns`
 *    从 `taxa_names` 还原列名（`session.py:901-908`）。所以重分列 / 重载 / 导出
 *    都会退回 `colNN`，后端那道 ROI 内重名校验也永远不会执行。
 *
 * ## 判据：一律读后端权威字段，不读前端镜像
 *
 * 所有断言走 `straditize.getDiagramData`（后端列对象），不读 `window.__straditize`
 * 里的前端副本——否则"前端改了、后端没改"这种缺陷在测试里恰恰是绿的。
 *
 * ## "真的持久化了吗"要靠重新分列来证伪
 *
 * 只断言"改完后后端字段变了"是不够的：前端在提交前就自己改了 `col.name`，
 * 而 `getDiagramData` 会把前端那份送回后端……不对，它不会，但为了排除"名字只是
 * 恰好留在这个对象里"的可能，T2 会**再触发一次真实分列**：`core.detectColumns`
 * 会把列名整体重建为 `taxa_names[idx]`（这正是进入步骤 5 时 UI 发的那个 RPC，
 * 见 `main.ts:721`）。名字要活过这一步，就只能是因为它真的写进了 `taxa_names`。
 * 选**下标 1** 而不是下标 0，是为了让"写进了 `taxa_names[1]`"这件事可判定。
 *
 * ## 焦点判据为什么不是"同一个节点"
 *
 * 重渲染是既有行为（画布高亮、步骤 5 对账清单都依赖它），修不掉也不该修掉。
 * 能要求的只有：焦点仍在（重建后的）输入框上、键盘输入能落进去。所以 T1 断言
 * `document.activeElement === document.querySelector(sel)`，而不是节点恒等。
 *
 * ## 步骤 5 面板的 OCR 按钮曾经是个死按钮
 *
 * `#btn-trigger-ocr` 原先自己去顶栏"碰"按钮，找的是 `#btn-open-ocr`、
 * `#topbar-btn-ocr`、`[title*="OCR"]` —— 这三个选择器在整个仓库里一个都不存在
 * （顶栏真实按钮是 `#btn-ocr-review-modal`，title 为"自动识别图谱顶部属种名并为
 * 各列匹配新列名"，不含 "OCR"），于是它永远只弹一句"请使用顶栏按钮"，从没打开过
 * OCR 复核模态。T5 钉住这个行为。
 */
import { expect, test } from './fixtures';
import { diagramData, getState, gotoStage, resetBaseline, rpc } from './helpers';
import type { Page } from '@playwright/test';

interface BackendColumn {
  id: string;
  name?: string;
  species?: string;
  roi_id?: string;
  col_index?: number;
}

/** 后端权威列清单（`straditize.getDiagramData`）。 */
async function columns(page: Page): Promise<BackendColumn[]> {
  return (await diagramData<{ columns: BackendColumn[] }>(page)).columns;
}

async function colById(page: Page, id: string): Promise<BackendColumn | undefined> {
  return (await columns(page)).find((c) => c.id === id);
}

function renameInput(page: Page, colId: string) {
  return page.locator(`input.taxa-name-inline-input[data-col-id="${colId}"]`).first();
}

/**
 * 用**真实键盘**改名：点开输入框 → 全选 → 逐字敲 → Enter 提交。
 *
 * 必须走键盘而不是 `fill()`：告警点正是"聚焦会把输入框重渲染掉"，而 `fill()`
 * 在元素被替换时可能静默写到已脱离文档的旧节点上，把这个缺陷掩盖成"值没变"。
 * Enter 会触发 `keydown` 里的 `blur()`，进而派发 `change` —— 那才是提交口。
 */
async function renameViaUI(page: Page, colId: string, text: string): Promise<void> {
  const input = renameInput(page, colId);
  await expect(input).toBeVisible();
  await input.click();
  await input.press('Control+a');
  await page.keyboard.type(text, { delay: 20 });
  await input.press('Enter');
}

test.describe('步骤 5 分列与命名', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 行内改名可用：点开后焦点与键盘输入都不被重渲染吃掉', async ({ page, telemetry }) => {
    await gotoStage(page, 5);
    const { columns: cols, activeTaxaId } = await diagramData<{
      columns: BackendColumn[];
      activeTaxaId: string;
    }>(page);
    const col = cols.find((c) => c.id === activeTaxaId) ?? cols[0];
    const sel = `input.taxa-name-inline-input[data-col-id="${col.id}"]`;

    // 聚焦本身就会触发一次整栏重渲染（见文件头），所以"还是同一个节点"必然为 false；
    // 不能退让的是：重渲染之后焦点仍然落在输入框上。改前这里是 false（焦点在 BODY）。
    const focusKept = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLInputElement | null;
      el?.focus();
      return document.activeElement === document.querySelector(s);
    }, sel);
    expect(focusKept, '点开改名输入框后焦点必须仍在输入框上，否则用户一个字也打不进去').toBe(true);

    await renameInput(page, col.id).click();
    await page.keyboard.type('ZZ', { delay: 20 });
    await expect(renameInput(page, col.id), '真实键盘输入必须能落进改名输入框').toHaveValue(/ZZ/);

    expect(telemetry.dialogs, '正常改名不该弹任何原生提示').toEqual([]);
  });

  test('T2 改名写进后端权威字段，并且经得起一次真实的重新分列', async ({ page, telemetry }) => {
    await gotoStage(page, 5);
    const cols = await columns(page);
    const col = cols[1];
    const origin = col.name;
    const NEW = 'E2E_TAXA_01';

    await renameViaUI(page, col.id, NEW);

    await expect
      .poll(async () => (await colById(page, col.id))?.name, {
        message: '改名必须落到后端列对象上（此前后端字段纹丝不动）',
        timeout: 10_000,
      })
      .toBe(NEW);
    expect((await colById(page, col.id))?.species, 'species 必须与 name 同步').toBe(NEW);

    // 再来一次真实分列：就是进入步骤 5 时 UI 发的那个 RPC
    // （main.ts:721 → RpcClient.detectColumnsInRoi → core.detectColumns）。
    // 后端会把列名整体重建为 session.taxa_names[idx]，前端内存里的改动在这一步
    // 一定会被冲掉 —— 除非名字真的写进了 taxa_names。
    const st = await getState<{
      rois: Array<{ id: string; xlim: [number, number]; ylim: [number, number] }>;
    }>(page);
    const roi = st.rois[0];
    await rpc(page, 'core.detectColumns', {
      data_xlim: roi.xlim,
      data_ylim: roi.ylim,
      roi_id: roi.id,
    });

    const after = await colById(page, col.id);
    expect(after?.name, '重新分列后名字必须还是用户改的那个（证明写进了 session.taxa_names）').toBe(NEW);
    expect(after?.name, '必须真的变过，不是碰巧等于原值').not.toBe(origin);
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test.describe('T3 同 ROI 重名', () => {
    // 前端在提交前就把重名拦下来了（并且故意不惊动后端），这里放行那条原生提示。
    test.use({ allowlists: { dialog: [/严禁重名/] } });

    test('T3 同有效区内重名：当场拦下并回滚，后端不被惊动', async ({ page, telemetry }) => {
      await gotoStage(page, 5);
      const cols = await columns(page);
      const target = cols[0];
      const other = cols[1];
      expect(target.roi_id, '前置条件：两列必须同属一个有效区，否则重名规则不适用').toBe(other.roi_id);

      const origin = target.name ?? '';
      await renameViaUI(page, target.id, other.name ?? '');

      await expect.poll(() => telemetry.dialogs.length, { timeout: 10_000 }).toBe(1);
      expect(telemetry.dialogs[0]).toContain('严禁重名');

      await expect(renameInput(page, target.id), '被拒的名字必须当场回滚到原名').toHaveValue(origin);
      expect((await colById(page, target.id))?.name, '后端不该收到这个请求').toBe(origin);
      expect(telemetry.rpcErrors, '前端拦下的重名不该发 RPC').toEqual([]);
    });
  });

  test.describe('T4 后端名字合法性防线', () => {
    // 前端没有名字语法检查，所以非法字符会真的打到后端并换来 -32602；
    // 应用必须把这条失败冒泡给用户，并把输入回滚（绝不留"界面改了、后端没改"）。
    test.use({
      allowlists: {
        dialog: [/属种改名失败/],
        consoleError: [/属种改名/],
        rpcError: [/naming\.renameColumn/],
      },
    });

    test('T4 非法字符被后端拒绝 → 输入回滚到原名 + 错误冒泡到用户', async ({ page, telemetry }) => {
      await gotoStage(page, 5);
      const col = (await columns(page))[0];
      const origin = col.name ?? '';

      await renameViaUI(page, col.id, 'bad/name');

      await expect.poll(() => telemetry.dialogs.length, { timeout: 10_000 }).toBe(1);
      expect(
        telemetry.dialogs[0],
        '后端 -32602 必须原样冒泡到用户，而不是悄悄吞掉'
      ).toContain('属种改名失败');

      await expect(renameInput(page, col.id), '被后端拒绝的名字必须回滚').toHaveValue(origin);
      expect((await colById(page, col.id))?.name, '后端权威字段必须保持原名').toBe(origin);
      expect(telemetry.rpcErrors.length, '非法名字必须真的发到了后端并被拒').toBeGreaterThan(0);
    });
  });

  test.describe('T5 面板 OCR 入口', () => {
    test('T5 面板【自动识别属种名】按钮真的会打开 OCR 复核模态', async ({ page, telemetry }) => {
      await gotoStage(page, 5);
      await expect(page.locator('[id^="ocr-"]:visible')).toHaveCount(0);

      await page.locator('.step-panel[data-step="5"] #btn-trigger-ocr').click();

      await expect(page.locator('#ocr-close-btn'), '该按钮必须打开 OCR 模态').toBeVisible();
      expect(telemetry.dialogs, '按钮不该退化成一句"请使用顶栏按钮"的提示').toEqual([]);
    });
  });
});
