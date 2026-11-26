/**
 * 已知前端缺陷的**机器可跑门禁预置位**（Round 3 lane-I）。
 *
 * ## 这个文件是什么
 *
 * Round 1/2 用人工手势 + CDP 探针取证了 4 条"会毁用户工作"的前端缺陷
 * （`docs/findings/eval-2026-11-26/report-r2.md` §2.2、`lane-G-state-machine-race.md`、
 * `lane-A-load-roi-ycalib-split.md` BUG-6）。人工取证的问题不是不真，而是**不会随代码
 * 变化自动重跑**：修没修、有没有回归，只能靠人再走一遍。本文件把每条固化成
 * "一条断言、一个可判定的量"。
 *
 * ## 5 条里只有 4 条是"已知缺陷"
 *
 * #143（P0，控制点撤销只回放镜像）**已修复**，它的用例在文件末尾，**不 skip**，
 * 是常驻门禁。下面 4 条仍按环境开关控制。
 *
 * ## 为什么默认 skip，而不是直接把 CI 搞红
 *
 * 4 条都还没修。若直接当门禁，CI 从今天起恒红，"红"就不再传递信息（这正是
 * `check-e2e-skips.mjs` 反对的"待重写就遗忘"的镜像错误：待修复就常驻红）。
 * 所以用**环境开关 + 条件 skip**：
 *
 * ```bash
 * # 现状（CI 的跑法）：4 条全 skipped，不占用时间也不拦人
 * npx playwright test known-defects-r3
 *
 * # 复核缺陷是否仍在：4 条全红，失败信息指向真实缺陷
 * E2E_KNOWN_DEFECTS=1 npx playwright test known-defects-r3
 * ```
 *
 * ## 修好一条之后怎么变成门禁（一行删除，没有第二种改法）
 *
 * 1. 删掉该 `describe` 里的 `test.skip(!KNOWN, …)` 那一行；
 * 2. 同步把该文件头的 issue 从"已知缺陷"清单移到普通回归说明里；
 * 3. `check-e2e-skips.mjs` 不用改（它只拦 `skip(true)` 与无 reason 的 skip）。
 *
 * ## 为什么断言必须是"一个可判定的量"
 *
 * 每条用例只钉一个**机械可判定**的量：后端字段值、`disabled` 属性、写 RPC 计数。
 * "界面看起来对了"不是判据 —— 这 4 条缺陷的共同点恰恰是**界面与后端分叉**，
 * 只读 DOM 的断言对它们天然失明（`helpers.ts` 头注释里那条纪律）。
 *
 * 契约类型一律从 `src/types` import，不在 e2e 里另声明（`check-e2e-skips.mjs`
 * 的第二条门禁同源）。
 */
import { expect, test, type Page } from './fixtures';
import { clickCanvas, gotoStage, resetBaseline, rpc, type PageTelemetry } from './helpers';
import type { DiagramData } from '../src/types/pollen';

/** 仅当显式设置 `E2E_KNOWN_DEFECTS=1` 时才执行（此时用例应当**全红**）。 */
const KNOWN = process.env.E2E_KNOWN_DEFECTS === '1';

/** 自动存档键：与 `main.ts` 的写入端同一个常量（照抄会有漂移风险，故注明出处）。 */
const AUTOSAVE_KEY = 'straditize_autosave_draft_v2';

/** 后端权威图谱数据（唯一事实源；断言不读 DOM 的原因见文件头）。 */
const wire = (page: Page): Promise<DiagramData> => rpc<DiagramData>(page, 'straditize.getDiagramData', {});

/** 后端某一列的当前名字；列不存在返回 `undefined`（用来区分"改名失败"与"列没了"）。 */
async function backendColumnName(page: Page, colId: string): Promise<string | undefined> {
  const data = await wire(page);
  return data.columns.find((c) => c.id === colId)?.name;
}

/** 基线第一列（`e2e.reset` 会预跑分列，故一定存在）。 */
async function firstColumn(page: Page): Promise<{ id: string; name: string }> {
  const data = await wire(page);
  const col = data.columns[0];
  if (!col) throw new Error('基线没有任何列：e2e.reset 的 detect_columns 未生效');
  return { id: col.id, name: col.name };
}

/**
 * 通过侧栏的列名输入框改名（`Sidebar.ts` 的 `inline-rename` → `change` 事件提交）。
 *
 * 必须走界面而不是直接调 `naming.renameColumn`：这 4 条缺陷全在**前端入口**上
 * （撤销栈登记、草稿镜像、按钮动作），绕过界面等于绕过被测对象。
 */
async function renameColumnViaSidebar(page: Page, colId: string, name: string): Promise<void> {
  const input = page.locator(`input.taxa-name-inline-input[data-col-id="${colId}"]`).first();
  await input.click();
  await input.fill(name);
  await input.press('Tab'); // 失焦触发 change（侧栏唯一的提交入口）
}

/** 一个进程内的唯一列名（避开同 ROI 重名拒绝）。 */
function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now() % 100000}`;
}

/**
 * 抓 `project.load` 请求体里第 1 列的列名（"恢复草稿到底下发了哪份镜像"的唯一证据）。
 *
 * 只读请求体、不改任何状态：它的用途是**前置判定**（下发的必须是旧镜像），
 * 否则"恢复后后端没变"这句话就分不清是产品没回滚还是用例根本没触发回滚。
 */
function trackProjectLoadColumn0(page: Page): string[] {
  const names: string[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/rpc')) return;
    try {
      const body = req.postDataJSON() as {
        method?: string;
        params?: { project_data?: { columns?: Array<{ name?: string }> } };
      } | null;
      if (body?.method === 'project.load') {
        names.push(String(body?.params?.project_data?.columns?.[0]?.name ?? '?'));
      }
    } catch {
      /* 非 JSON 请求体不参与本判定 */
    }
  });
  return names;
}

/** 自动存档里第 1 列的列名（草稿是**前端镜像**，不是后端权威数据）。 */
async function draftColumnName(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    try {
      return String(JSON.parse(raw)?.data?.columns?.[0]?.name ?? '');
    } catch {
      return '';
    }
  }, AUTOSAVE_KEY);
}

/**
 * 数某一个 RPC 方法**从页面发出的请求条数**。
 *
 * `fixtures.ts` 的 `telemetry` 记的是"失败的 RPC"（`rpcErrors`），不是调用次数，
 * 而 #181 的判据是"第二次重做**仍然重发了写请求**"—— 只有计数能表达。
 * 这里挂在 `page.on('request')` 上读**请求体里的 method**：JSON-RPC 的方法名只存在
 * 于 body，读 URL 区分不出来（`/rpc` 是唯一端点）。
 */
function trackRpcCalls(page: Page, method: string): string[] {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/rpc')) return;
    try {
      const body = req.postDataJSON() as { method?: string } | null;
      if (body?.method === method) calls.push(body.method);
    } catch {
      /* 非 JSON 请求体不参与计数 */
    }
  });
  return calls;
}

/**
 * 接管一个**原生 `window.confirm`** 按钮的确认框。
 *
 * 两个必须做的动作，缺一个就测不到东西：
 *
 * 1. `removeAllListeners('dialog')`：`fixtures.ts` 的 `watchPage` 已注册了一个
 *    `dialog → dismiss()` 的监听（Playwright 默认也是 dismiss）。原生确认框只能被
 *    处置一次，"取消"会让按钮**直接 return**，于是整条用例测的是"用户点了取消"。
 * 2. 自己把文案塞回 `telemetry.notices`：摘掉 fixtures 的监听后，对话框不再进
 *    `notices`，用户通知门禁会对这条用例静默失去覆盖。手工补回来，门禁照旧生效
 *    （因此调用方必须显式 allowlist 这条文案）。
 */
function acceptNativeConfirm(page: Page, telemetry: PageTelemetry): string[] {
  const seen: string[] = [];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => {
    seen.push(dialog.message());
    telemetry.notices.push(dialog.message());
    void dialog.accept();
  });
  return seen;
}

// ---------------------------------------------------------------------------
// #182：Ctrl+Z 绕过新撤销栈，只回放前端镜像，后端不动
// ---------------------------------------------------------------------------
test.describe('已知缺陷 #182：Ctrl+Z 不回放后端', () => {
  // 已知缺陷 #182：修好后删掉下面这行 skip，本用例即变为门禁。
  test.skip(
    !KNOWN,
    '已知缺陷 #182 未修复（Ctrl+Z 走 GeologyCanvas.history 快照，后端不动）；见 docs/findings/eval-2026-11-26/lane-G-state-machine-race.md §3.3'
  );

  /**
   * 现象（一句）：改列名后按 Ctrl+Z，只有前端镜像回退，后端仍是新名；焦点在列名
   * 输入框时按 Ctrl+Z 还会把字母 `z` 塞进名字里。
   *
   * 当前应观察到：后端 `columns[i].name` 仍是**新名**（撤销从未下发写请求）。
   * 修好后应观察到：后端名字回到**原名**（且不含多出来的 `z` —— 这条等式断言同时
   * 覆盖了"插入 z"那半个症状：任何多出的字符都让名字 ≠ 原名）。
   *
   * 机制：`GeologyCanvas.ts:1162` 注册的 `ctrl+z` 直接 `this.history.undo()` 并写
   * `this.data.columns`；只有 `ToolbarBridge.ts` 的 `onUndo` 会查 `undoStack`。
   */
  test('改列名后按 Ctrl+Z，后端列名必须回到原名', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6); // 侧栏列卡片与顶栏撤销/重做按钮都在这一步可见

    const col = await firstColumn(page);
    const newName = uniqueName('K182');

    await renameColumnViaSidebar(page, col.id, newName);
    // 前置：改名必须先真的落到后端，否则"撤销后回到原名"会因为根本没改名而恒真。
    await expect
      .poll(() => backendColumnName(page, col.id), {
        message: '前置：改名必须先写进后端',
        timeout: 20_000,
      })
      .toBe(newName);

    // 焦点移出输入框：输入框内的 Ctrl+Z 会被 `onKeyDown` 的 isInput 分支拦下，
    // 测到的就不是画布快捷键这条路了。
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Control+z');
    // 撤销若真的下发写请求，落地需要时间；给足窗口再读后端。
    await page.waitForTimeout(1200);

    expect(
      await backendColumnName(page, col.id),
      'Ctrl+Z 之后后端列名必须回到原名（只回退界面镜像不算撤销）'
    ).toBe(col.name);
  });
});

// ---------------------------------------------------------------------------
// #181：重做永不出栈 —— 每点一次都重发写请求，按钮永远可用
// ---------------------------------------------------------------------------
test.describe('已知缺陷 #181：重做不出栈，重复下发写请求', () => {
  // 已知缺陷 #181：修好后删掉下面这行 skip，本用例即变为门禁。
  test.skip(
    !KNOWN,
    '已知缺陷 #181 未修复（undoActions.ts:65 的 verify 忽略 direction，redoOps 不 pop）；见 docs/findings/eval-2026-11-26/lane-G-state-machine-race.md §3.4'
  );

  /**
   * 现象（一句）：重做执行成功后仍不出栈，`#btn-redo` 永远可用，每多点一次就再发
   * 一遍写请求。
   *
   * 当前应观察到：第一次重做后按钮仍 enabled，第二次点击再发 1 条
   * `naming.renameColumn`（写 RPC 计数 = 1）。
   * 修好后应观察到：第一次重做后 `#btn-redo` 已 disabled（于是第二次点击不可能发生），
   * 写 RPC 计数 = 0 —— 这条计数就是判据本身。
   *
   * 为什么不断言 DOM 的 `disabled`：断言 `disabled` 需要"点一个禁用按钮"，而
   * Playwright 对禁用元素会等待 actionability 超时，修好之后反而红。改成数"第二次
   * 尝试造成的写请求数"，两种状态都可判定，且直接量化了缺陷造成的损害（重复写）。
   */
  test('重做一次后，第二次重做不得再发写 RPC', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);

    const col = await firstColumn(page);
    const newName = uniqueName('K181');
    const writes = trackRpcCalls(page, 'naming.renameColumn');

    await renameColumnViaSidebar(page, col.id, newName);
    await expect
      .poll(() => backendColumnName(page, col.id), {
        message: '前置：改名必须先写进后端（重做才有一条可重放的写）',
        timeout: 20_000,
      })
      .toBe(newName);

    const undoBtn = page.locator('#btn-undo');
    await expect(undoBtn, '前置：改名后撤销按钮必须可用').toBeEnabled({ timeout: 15_000 });
    await undoBtn.click();
    await expect
      .poll(() => backendColumnName(page, col.id), {
        message: '前置：撤销必须真的把后端名字退回原名',
        timeout: 25_000,
      })
      .toBe(col.name);

    const redoBtn = page.locator('#btn-redo');
    await expect(redoBtn, '前置：撤销后重做按钮必须可用').toBeEnabled({ timeout: 15_000 });
    await redoBtn.click();
    await expect
      .poll(() => backendColumnName(page, col.id), {
        message: '前置：第一次重做必须真的把后端名字改回新名',
        timeout: 25_000,
      })
      .toBe(newName);

    // 关键判据：第二次重做尝试造成的写请求数。
    const beforeSecond = writes.length;
    const stillEnabled = await redoBtn.isEnabled();
    if (stillEnabled) await redoBtn.click();
    await page.waitForTimeout(2000);

    expect(
      writes.length - beforeSecond,
      `第一次重做之后 #btn-redo 应已 disabled（实测 enabled=${stillEnabled}）；` +
        `重做未出栈时再点一次会重发 naming.renameColumn，把已经做过的编辑再写一遍`
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #180：恢复自动存档草稿把更旧的前端镜像写回后端
// ---------------------------------------------------------------------------
test.describe('已知缺陷 #180：恢复旧草稿静默回滚新改动', () => {
  // 已知缺陷 #180：修好后删掉下面这行 skip，本用例即变为门禁。
  test.skip(
    !KNOWN,
    '已知缺陷 #180 未修复（draftRecovery.ts 只判"有列 + 7 天内"，不与后端比对就整包覆盖）；见 docs/findings/eval-2026-11-26/lane-G-state-machine-race.md §6.2'
  );

  /**
   * 现象（一句）：改名后 1 秒内刷新页面（自动存档的 1000ms 防抖还没触发），点
   * 「恢复草稿」会把刷新前那次改名静默回滚 —— 旧镜像覆盖新状态，全程无提示。
   *
   * 当前应观察到：恢复后后端列名变回**旧名**。
   * 修好后应观察到：恢复后后端列名仍是**新名**（旧草稿要么被拒绝、要么先与后端比对）。
   *
   * 时序：改名 → 立刻 reload。<1s 是缺陷的触发条件（`main.ts:112` 的 1000ms 防抖），
   * 所以 reload 前必须**先断言草稿里还是旧名**：一旦某次机器太慢让防抖先跑了，
   * 草稿就变成新镜像，用例会假绿。这条前置断言把假绿变成显式失败。
   */
  test('改名后 1s 内刷新，恢复草稿不得把后端列名回滚', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);

    const col = await firstColumn(page);
    const newName = uniqueName('K180');

    // 前置：先让应用自己写出一份"旧镜像"草稿（走 webMCP 触发 scheduleAutosave，
    // 与真实自动存档一字不差；手抄字段会漏掉契约里的新键）。
    await page.evaluate(async () => {
      const w = window as unknown as {
        webMCP?: { callTool: (name: string, args?: object) => Promise<unknown> };
      };
      await w.webMCP?.callTool('straditize.getDiagramData', {});
    });
    await expect
      .poll(() => draftColumnName(page), {
        message: '前置：应用应把当前镜像写进自动存档',
        timeout: 20_000,
      })
      .toBe(col.name);

    // `main.ts` 在 `history.canUndo()` 时注册了 `beforeunload` 守卫（防误关丢数据）。
    // 它的原生确认框会被 `fixtures.ts` 的 `dialog → dismiss()` 处理掉，于是**导航被
    // 取消**（表现为 `page.reload()` 卡到超时），而那条 dialog 的文案是空串、还会污染
    // 通知门禁。产品自带 `window.__straditize_suppress_beforeunload()` 正是为"确认关闭
    // 后不再拦"准备的，复用它而不是绕过产品逻辑（同 `regressions-b04-b05-b07.spec.ts`）。
    // 必须放在**改名之前**：改名会 push 一条历史、把守卫装上；放在 reload 前一步等于
    // 在 1s 窗口里多绕一次 evaluate 往返。
    await page.evaluate(() => {
      const w = window as unknown as { __straditize_suppress_beforeunload?: () => void };
      w.__straditize_suppress_beforeunload?.();
    });

    // 改名，等后端确认写入（`naming.renameColumn` 的响应），随后立刻刷新。
    // 不 await 任何轮询：轮询要读 getDiagramData，写后首建要 8s 量级，会把 1s 窗口耗掉。
    const renameLanded = page.waitForResponse((res) => {
      if (!res.url().includes('/rpc')) return false;
      try {
        const body = res.request().postDataJSON() as { method?: string } | null;
        return body?.method === 'naming.renameColumn';
      } catch {
        return false;
      }
    });
    await renameColumnViaSidebar(page, col.id, newName);
    await renameLanded;

    // 关键前置一：刷新前草稿必须仍是旧镜像（防抖未触发）——这就是"1s 内"这个条件。
    expect(
      await draftColumnName(page),
      '前置：刷新前草稿必须还是旧镜像（否则自动存档防抖已触发，测不到回滚）'
    ).toBe(col.name);

    await page.reload();

    // 关键前置二：横幅读到的**就是**这份草稿。若上一次运行的 reload 慢到让 1000ms
    // 防抖先跑完，横幅拿到的是新镜像，恢复它当然不会回滚 —— 那样本用例会**假绿**。
    // 用这条前置把假绿变成显式失败（这是本用例唯一的时序敏感点，故明写）。
    expect(
      await draftColumnName(page),
      '前置：刷新后横幅读到的草稿必须仍是旧镜像（reload 被拖慢时防抖会先跑，本例不成立）'
    ).toBe(col.name);

    const restoreBtn = page.locator('#btn-restore-draft');
    await expect(restoreBtn, '刷新后应挂出草稿恢复横幅').toBeVisible({ timeout: 30_000 });
    const sentNames = trackProjectLoadColumn0(page);
    await restoreBtn.click();

    // 关键前置三：恢复必须真的把**旧镜像**下发下去。
    // 这条把"用例失效"与"产品缺陷"分开：若横幅拿到的是新镜像（上一个前置没拦住、
    // reload 慢到防抖先跑），恢复当然不回滚，后端保持新名 —— 那样整条用例会**假绿**。
    // 实测（缺陷复现时）：`sentNames` 一律是旧名，后端一律被回滚成旧名。
    await expect
      .poll(() => sentNames.length, { message: '前置：【恢复草稿】必须下发一次 project.load', timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(sentNames[0], '前置：下发的草稿里第 1 列必须还是旧名（否则测不到回滚）').toBe(col.name);

    await expect
      .poll(() => backendColumnName(page, col.id), {
        message: '恢复旧草稿后后端列名不得被回滚：刷新前 1s 内的改动必须留住',
        timeout: 20_000,
      })
      .toBe(newName);
  });
});

// ---------------------------------------------------------------------------
// #171：「重新切分列」只清空不重切
// ---------------------------------------------------------------------------
test.describe('已知缺陷 #171：重新切分列只清空不重建', () => {
  // 已知缺陷 #171：修好后删掉下面这行 skip，本用例即变为门禁。
  test.skip(
    !KNOWN,
    '已知缺陷 #171 未修复（NamingPanel.ts:121 优先走 onClearAllColumns，onRedetectColumns 不可达）；见 docs/findings/eval-2026-11-26/lane-A-load-roi-ycalib-split.md BUG-6'
  );

  // 该按钮的确认框是原生 `window.confirm`，文案被 acceptNativeConfirm 塞回 notices；
  // 这里显式声明"我知道它会弹"。修好后若文案改为「清空并重建」，同步放宽这个正则。
  test.use({ allowlists: { notice: [/确定清空当前所有属种列/] } });

  /**
   * 现象（一句）：点「重新切分列」只发 `column.clearAll`、从不重新检测，19 列一键
   * 清空且面板上没有重建入口。
   *
   * 当前应观察到：清空后后端 `columns.length === 0`（且 `core.detectColumns` 从未出现）。
   * 修好后应观察到：清空后自动重建，后端 `columns.length > 0`
   * （若修法改成"先弹一个说明会清空并重建的确认框"，本判据仍然成立，无需改断言）。
   *
   * 为什么断言 `> 0` 而不是 "=== 清空前的列数"：重建走的是同一条 `detectColumns`
   * 算法，理论上列数应相同，但它依赖图像内容而非本次输入，把"算法输出稳定"这种
   * 与本缺陷无关的性质也钉进门禁，会让修复因无关原因红。本缺陷的不变量只有一条：
   * **点这个按钮不能让用户落到 0 列**。
   */
  test('点「重新切分列」后后端列数必须 > 0', async ({ page, telemetry }) => {
    await resetBaseline(page);
    await gotoStage(page, 4);

    const before = (await wire(page)).columns.length;
    expect(before, '前置：基线应有已切分的列（否则"清空"无从谈起）').toBeGreaterThan(0);

    const confirms = acceptNativeConfirm(page, telemetry);
    await page.locator('#btn-reset-step4-split').click();

    await expect
      .poll(async () => (await wire(page)).columns.length, {
        message:
          '「重新切分列」之后后端必须仍有列（清空后自动重建）；0 列 = 用户的分列成果被一键摧毁' +
          `（本次确认框文案：${confirms.join(' | ') || '未弹出'}）`,
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
  });
});

/**
 * 全图控制点签名：`列id → 行号序列`。
 *
 * 用"所有列"而不是"第一列"，是因为画布上点一下未必落在第一列里；
 * 拿整图签名比较，就与"点在哪一列"无关，用例不会因布局差异假红。
 */
async function controlPointSignature(page: Page): Promise<Record<string, string>> {
  const data = await wire(page);
  const out: Record<string, string> = {};
  for (const col of data.columns) {
    const pts = (col.controlPoints ?? []) as Array<{ row?: number; y?: number }>;
    out[col.id] = pts.map((point) => String(Number(point.row ?? point.y))).join(',');
  }
  return out;
}

test.describe('#143（P0）控制点撤销必须回退后端', () => {
  // 修复已落地（fix/undo-stack），故本用例是**常驻门禁**：删掉这行以外的任何"豁免"都会让它变弱。
  test('画布加点后 Ctrl+Z，后端 controlPoints 必须回到改前', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 7);

    const before = await controlPointSignature(page);

    // 画布中央未必落在某一列内：逐个横向位置试，直到后端签名真的变了。
    let changed = false;
    for (const rx of [0.35, 0.45, 0.55, 0.5, 0.65]) {
      await clickCanvas(page, rx, 0.5);
      await page.keyboard.press('a');
      const now = await controlPointSignature(page);
      if (JSON.stringify(now) !== JSON.stringify(before)) {
        changed = true;
        break;
      }
    }
    expect(changed, '画布上加点没有落到任何列：前置不成立，先查工具模式/阶段').toBe(true);

    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => JSON.stringify(await controlPointSignature(page)), { timeout: 10000 })
      .toBe(JSON.stringify(before));
  });
});
