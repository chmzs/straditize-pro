/**
 * Discovery lane —— 动作实现。**全部走真实 UI 入口**。
 *
 * ## 一条硬规矩
 *
 * 这里**不允许**用 RPC 直接摆状态。任何"把后端改成某个形状"的调用都会让探索
 * 失去意义：那样测的是后端函数，不是"人点得动点不动"。因此本文件里出现的
 * 交互手段只有四类：
 *
 * 1. 真实 `<input type=file>` / `filechooser` 事件（上传图片、打开项目）；
 * 2. 真实按钮点击（`locator.click()`，走命中测试与可见性检查）；
 * 3. 真实键盘（`keyboard.type` / `press`，逐字符事件）；
 * 4. 真实鼠标（`mouse.down/move/up`、拖拽、右键平移、双击）。
 *
 * 允许的只有**只读** RPC，且由 `run.mjs` 的 `READ_ONLY_RPC` 白名单在运行时强制：
 * 白名单外的方法一律抛错，不给"顺手写一下"留口子。
 *
 * ## 每个动作为什么长这样（踩过的坑都写在这里）
 *
 * | 动作 | 关键约束 | 出处 |
 * | --- | --- | --- |
 * | 上传 | 屏障必须是 `rois.length > 0`，**不是** `imageWidth` | `session_parts/core.py` 先写尺寸、后建 ROI |
 * | 拖 ROI 手柄 | 先按 `F` 再按 `fitToScreen` 公式反算屏幕坐标；手柄命中半径仅 ±2px | `GeologyCanvas.ts:1588` |
 * | Y 标定 | 五框一次写全再点应用；逐框 `fill` 会因面板重挂丢值（F-3） | `docs/testing-strategy.md` §9 |
 * | 改列名 | 先 `fill('')` 并断言为空，再逐字敲；`Control+a` 会被重渲染吃掉 | `step5-naming.spec.ts` 实测 |
 *
 * ## 动作失败绝不静默
 *
 * 每个 `run()` 在"点了但什么都没发生"时**必须抛错**，由 `run.mjs` 记成
 * `ACTION_FAILED`（保留全部产物）。选择器根本不存在或不可见时，`run.mjs` 记
 * `ACTION_UNAVAILABLE`。两者都不等于通过。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 受版本控制的真实花粉图（与既有 e2e 同一张，便于与已知真值对账）。 */
export const REAL_POLLEN_IMAGE = 'straditize_core/assets/tutorials/hoya-del-castillo.png';

/** 该图的真值尺寸。 */
const TRUTH_W = 2339;
const TRUTH_H = 1654;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 动作被"没东西可点"挡住时抛这个；`run.mjs` 据此记 `ACTION_UNAVAILABLE`。 */
export class ActionUnavailable extends Error {
  constructor(message, { selector } = {}) {
    super(message);
    this.name = 'ActionUnavailable';
    this.selector = selector ?? null;
  }
}

/** 动作真的执行了但没生效；`run.mjs` 据此记 `ACTION_FAILED`。 */
export class ActionFailed extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActionFailed';
  }
}

/**
 * 等到页面侧**没有在飞的 `/rpc` 请求**，且连续两帧都是 0。
 *
 * ## 为什么必须这样等，而不是 `waitForTimeout(n)`
 *
 * 固定 sleep 是"假绿来源"：短了会把**半完成状态**读成 PASS（一次写入分两阶段落地时
 * 最典型），长了则掩盖"动作其实早就结束了"这一事实。这里的等待条件是**被观测对象
 * 本身**——页面自己发出的 RPC 是否都回来了。
 *
 * 计量点不是函数的开始/返回，而是**响应体被读完**之后：
 * `fetch()` 的 Promise 在响应头到达时就 resolve，而 `res.json()` 才真正把 body 拉完；
 * 若在响应头处就减计数，"quiet" 会早于业务代码拿到数据，仍是半完成读。所以这里用
 * `res.clone().text()` 把 body 缓冲完再减（只包 `/rpc`，体积是小的 JSON）。
 *
 * 采样由 `requestAnimationFrame` 驱动，不是定时器轮询：两帧都为 0 才算安静。
 *
 * 帧预算（默认 1800 帧 ≈ 15-30 s）是防"某个请求永不返回把整轮挂死"的兜底。
 * 预算耗尽返回 `{quiet:false}`——**调用方必须把它当失败**，不能当"差不多得了"。
 */
export async function waitForQuiet(page, { frameBudget = 1800 } = {}) {
  return page.evaluate(
    (budget) =>
      new Promise((resolve) => {
        let stable = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          const n = window.__discInflightRpc ?? 0;
          if (n === 0) stable += 1;
          else stable = 0;
          if (stable >= 2) {
            resolve({ quiet: true, frames, inflight: n });
            return;
          }
          if (frames >= budget) {
            resolve({ quiet: false, frames, inflight: n });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frameBudget
  );
}

/**
 * 等到两帧绘制落定（帧边界，不是计时器）。
 *
 * 用于**纯视口动作**：它们不发 RPC，因此 `waitForQuiet` 会立刻返回，而画布重绘
 * 确实还要一帧才落定。这一步属于启发式等待，对应的动作在动作表里标了
 * `waitMode: 'heuristic_wait'`，并写明了为什么不可条件化。
 */
export async function waitForRenderSettled(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))
  );
}

/**
 * 等到**前端镜像连续两次采样完全相同**。
 *
 * 用于多阶段落地且没有单一判据的场景（例如打开项目：解 tar → 换图 → 建 ROI →
 * 重挂面板，每一步都可能更新镜像）。判据是"镜像稳定"，不是"过了多久"。
 */
export async function waitForStableFront(page, { samples = 2, frameBudget = 1200, pick } = {}) {
  return page.evaluate(
    ([need, budget, pickKey]) =>
      new Promise((resolve) => {
        const api = window.__straditize;
        if (!api) {
          resolve({ stable: false, reason: 'window.__straditize 不可用' });
          return;
        }
        const snapshot = () => {
          const st = api.getState();
          const columns = st.columns ?? [];
          const view = {
            stage: st.stage,
            rois: (st.rois ?? []).length,
            columns: columns.length,
            width: st.image?.width ?? 0,
            height: st.image?.height ?? 0,
            calibrated: !!st.calibration?.isCalibrated,
          };
          return pickKey ? String(view[pickKey]) : JSON.stringify(view);
        };
        let prev = null;
        let same = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          const now = snapshot();
          if (prev !== null && now === prev) same += 1;
          else same = 1;
          prev = now;
          if (same >= need) {
            resolve({ stable: true, frames, value: now });
            return;
          }
          if (frames >= budget) {
            resolve({ stable: false, frames, value: now });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [samples, frameBudget, pick ?? null]
  );
}

/**
 * `waitFor` 内部的轮询间隔。
 *
 * ⚠️ 只服务于"两次检查之间隔多久"，**不是**"等某个动作完成"。判断动作是否完成一律
 * 用 `waitForQuiet` / `waitForStableFront` / 显式状态谓词。这也是本文件里唯一允许
 * 出现 `setTimeout` 的地方。
 */
const pollInterval = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询直到 `fn()` 返回真值，超时抛 `ActionFailed`。
 *
 * 等待条件一律写成**被断言的那个量本身**，不要写它的前驱（`docs/testing-strategy.md`
 * §4.2：一次 RPC 可能分两阶段落地，等前驱会拿到半完成状态）。
 */
async function waitFor(fn, { timeout = 20_000, interval = 120, message }) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = `抛出：${err?.message ?? err}`;
    }
    await pollInterval(interval);
  }
  throw new ActionFailed(`${message}（等待 ${timeout}ms 超时，最后一次观测：${JSON.stringify(last)}）`);
}

/** 取一个"必须存在、可见、可用"的元素；否则抛 `ActionUnavailable`。 */
async function must(page, selector, { label } = {}) {
  const locator = page.locator(selector).first();
  let count = 0;
  try {
    count = await page.locator(selector).count();
  } catch (err) {
    throw new ActionUnavailable(`选择器 ${selector} 求值失败：${err?.message ?? err}`, { selector });
  }
  if (count === 0) {
    throw new ActionUnavailable(`${label ?? selector} 不存在（${selector} 命中 0 个元素）`, { selector });
  }
  if (!(await locator.isVisible().catch(() => false))) {
    throw new ActionUnavailable(`${label ?? selector} 不可见（${selector}）`, { selector });
  }
  if (!(await locator.isEnabled().catch(() => true))) {
    throw new ActionUnavailable(`${label ?? selector} 被禁用（${selector}）`, { selector });
  }
  return locator;
}

/** `waitForQuiet` 的失败即失败版本：不安静就当作动作失败，绝不继续读半完成状态。 */
async function requireQuiet(page, label) {
  const r = await waitForQuiet(page);
  if (!r.quiet) {
    throw new ActionFailed(
      `${label} 之后页面仍有 ${r.inflight} 个 /rpc 请求在飞（${r.frames} 帧内未安静）`
    );
  }
  return r;
}

/**
 * 读前端镜像状态（`window.__straditize.getState()`）。 */
export async function readFront(page) {
  return page.evaluate(() => {
    const api = window.__straditize;
    if (!api) throw new Error('window.__straditize 句柄不可用：应用未完成初始化');
    return api.getState();
  });
}

/** 把焦点从输入框挪开，否则 `F` 之类的快捷键会被当文本吞掉。 */
async function blurActive(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
}

/** 点某个 step 面板的推进按钮，并等前端工作流真的落到目标步。 */
async function advance(page, ctx, { selector, targetStage, label }) {
  const btn = await must(page, selector, { label });
  await btn.click();
  await waitFor(
    async () => (await readFront(page)).stage === targetStage,
    {
      timeout: 30_000,
      message: `${label ?? selector} 之后界面应停在步骤 ${targetStage}`,
    }
  );
}

/**
 * 计算"世界坐标 → 视口坐标"的换算，起点是 `F` 键之后的 `fitToScreen`。
 *
 * 公式来自 `GeologyCanvas.fitToScreen`：
 *   scale = min((w - 2*60)/imageW, (h - 2*60)/imageH, 1.5); pan = 居中。
 *
 * 不用"画布像素 ÷ 图尺寸"的近似：那个近似漏掉 60px 内边距与 1.5 上限，
 * 实测会让拖拽点偏出约 100px、手柄命中落空。
 */
async function fitThenGeometry(page, worldPoints) {
  await blurActive(page);
  await page.keyboard.press('f');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  return page.evaluate((pts) => {
    const wrap = document.querySelector('.canvas-wrapper');
    if (!wrap) throw new Error('.canvas-wrapper 不存在（GeologyCanvas 的容器）');
    const api = window.__straditize;
    if (!api) throw new Error('window.__straditize 不可用');
    const st = api.getState();
    const rect = wrap.getBoundingClientRect();
    const PAD = 60;
    const availW = Math.max(10, rect.width - PAD * 2);
    const availH = Math.max(10, rect.height - PAD * 2);
    const imageW = st.image?.width || 1;
    const imageH = st.image?.height || 1;
    const scale = Math.min(availW / imageW, availH / imageH, 1.5);
    const panX = (rect.width - imageW * scale) / 2;
    const panY = (rect.height - imageH * scale) / 2;
    return pts.map(([x, y]) => ({
      x: rect.left + x * scale + panX,
      y: rect.top + y * scale + panY,
    }));
  }, worldPoints);
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

/**
 * 每个动作：`ready(ctx)` 判前端此刻是否**有东西可点**（纯观测，不产生副作用），
 * `run(ctx)` 真的做，失败就抛。
 */
export const ACTIONS = {
  // ---------------------------------------------------------------- 上传
  async upload_image(ctx) {
    const { page } = ctx;
    let how = 'filechooser';
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
      await (await must(page, '#btn-open-file', { label: '顶栏「打开文件」' })).click();
      const chooser = await chooserPromise;
      await chooser.setFiles(ctx.realImagePath);
    } catch (err) {
      if (err instanceof ActionUnavailable) throw err;
      // 无 GUI 的极端环境：退化为直接给同一个 <input type=file> 塞文件。
      // 仍然走 UI 的 change 链路，只是省掉系统对话框。
      how = `setInputFiles 兜底（filechooser 不可用：${err?.message ?? err}）`;
      const input = await must(page, '#file-input-image', { label: '图片文件输入框' });
      await input.setInputFiles(ctx.realImagePath);
    }

    const result = await waitFor(
      async () => {
        const d = await ctx.readDiagram();
        const rois = d.rois?.length ?? 0;
        return d.imageWidth === TRUTH_W && d.imageHeight === TRUTH_H && rois > 0
          ? { width: d.imageWidth, height: d.imageHeight, rois }
          : null;
      },
      {
        timeout: 90_000,
        message: '上传后后端必须同时具备真值尺寸与至少一个自动 ROI（同一次 core.loadImage 落地）',
      }
    );
    return { detail: { how, ...result } };
  },

  async ready_upload_image(ctx) {
    return !(await ctx.readDiagram()).imageSrc;
  },

  // ---------------------------------------------------------------- ROI
  async drag_roi_corner(ctx) {
    const { page, rng } = ctx;
    const d = await ctx.readDiagram();
    const roi = d.rois?.[0];
    if (!roi || !roi.xlim || !roi.ylim) throw new ActionUnavailable('后端没有可拖动的 ROI');

    // 目标点：在"图像内、且比左上角大至少 60px"的区间里随机取。
    const left = roi.xlim[0];
    const top = roi.ylim[0];
    const targetRight = Math.round(left + 60 + rng.float() * (TRUTH_W - left - 80));
    const targetBottom = Math.round(top + 60 + rng.float() * (TRUTH_H - top - 80));

    await blurActive(page);
    await page.keyboard.press('f');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

    const before = (await ctx.readDiagram()).rois[0];
    const [from, to] = await fitThenGeometry(page, [
      [before.xlim[1], before.ylim[1]],
      [targetRight, targetBottom],
    ]);
    if (!from || !to) throw new ActionFailed('无法反算 ROI 手柄的屏幕坐标');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // 多步移动：更接近真人拖拽，也更早暴露"中途被别的东西抢走"。
    await page.mouse.move(to.x, to.y, { steps: 24 });
    await page.mouse.up();

    const moved = await waitFor(
      async () => {
        const r = (await ctx.readDiagram()).rois?.[0];
        if (!r) return null;
        const changed =
          Math.abs((r.xlim?.[1] ?? 0) - before.xlim[1]) > 1 ||
          Math.abs((r.ylim?.[1] ?? 0) - before.ylim[1]) > 1;
        return changed ? { xlim: r.xlim, ylim: r.ylim } : null;
      },
      { timeout: 15_000, message: `拖动手柄后后端 ROI 边界必须变化（起点 ${JSON.stringify(before.xlim)}）` }
    );
    return { detail: { target: [targetRight, targetBottom], ...moved } };
  },

  async ready_drag_roi_corner(ctx) {
    const d = await ctx.readDiagram();
    if (!d.imageSrc) return false;
    if ((d.rois?.length ?? 0) === 0) return false;
    // 面板在才说明界面允许在第 2 步操作（手柄只在 ROI 可编辑时画）。
    return (await ctx.page.locator('.step-panel[data-step="2"]').count()) > 0;
  },

  async create_roi(ctx) {
    const before = (await ctx.readDiagram()).rois?.length ?? 0;
    await (await must(ctx.page, '#btn-create-roi', { label: '「新建 ROI」按钮' })).click();
    const after = await waitFor(
      async () => {
        const n = (await ctx.readDiagram()).rois?.length ?? 0;
        return n > before ? n : null;
      },
      { timeout: 20_000, message: `点「新建 ROI」后后端 ROI 数量必须增加（点前 ${before}）` }
    );
    return { detail: { before, after } };
  },

  async ready_create_roi(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#btn-create-roi').count()) > 0;
  },

  async select_roi(ctx) {
    const d = await ctx.readDiagram();
    const rois = d.rois ?? [];
    if (rois.length < 2) throw new ActionUnavailable('只有一个 ROI，无可切换目标');
    const activeId = d.activeRoiId;
    const target = rois.find((r) => r.id !== activeId) ?? rois[0];
    const card = ctx.page.locator(`.roi-item-card[data-roi-id="${target.id}"]`).first();
    if ((await card.count()) === 0) {
      throw new ActionUnavailable(`ROI 卡片 ${target.id} 不在 DOM 里`, {
        selector: `.roi-item-card[data-roi-id="${target.id}"]`,
      });
    }
    await card.click();
    await waitFor(
      async () => (await ctx.readDiagram()).activeRoiId === target.id,
      { timeout: 15_000, message: `点 ROI 卡片后后端 activeRoiId 应变成 ${target.id}` }
    );
    return { detail: { activeRoiId: target.id } };
  },

  async ready_select_roi(ctx) {
    const d = await ctx.readDiagram();
    if ((d.rois?.length ?? 0) < 2) return false;
    return (await ctx.page.locator('.roi-item-card').count()) > 1;
  },

  async set_primary_roi(ctx) {
    const d = await ctx.readDiagram();
    const rois = d.rois ?? [];
    const primary = d.primaryRoiId;
    const target = rois.find((r) => r.id !== primary);
    if (!target) throw new ActionUnavailable('所有 ROI 都已是主 ROI？没有可设为主 ROI 的候选');
    const btn = ctx.page.locator(`.btn-set-primary[data-roi-id="${target.id}"]`).first();
    if ((await btn.count()) === 0) {
      throw new ActionUnavailable(`主 ROI 按钮 ${target.id} 不在 DOM 里（可能已是主 ROI）`);
    }
    await btn.click();
    await waitFor(
      async () => (await ctx.readDiagram()).primaryRoiId === target.id,
      { timeout: 15_000, message: `点击后后端 primaryRoiId 应变成 ${target.id}` }
    );
    return { detail: { primaryRoiId: target.id } };
  },

  async ready_set_primary_roi(ctx) {
    const d = await ctx.readDiagram();
    if ((d.rois?.length ?? 0) < 2) return false;
    return (await ctx.page.locator('.btn-set-primary').count()) > 0;
  },

  async delete_roi(ctx) {
    const d = await ctx.readDiagram();
    const rois = d.rois ?? [];
    if (rois.length < 2) throw new ActionUnavailable('只剩一个 ROI，界面不提供删除按钮');
    const victim = rois[rois.length - 1];
    const btn = ctx.page.locator(`.btn-delete-roi[data-roi-id="${victim.id}"]`).first();
    if ((await btn.count()) === 0) {
      throw new ActionUnavailable(`删除按钮 ${victim.id} 不在 DOM 里`);
    }
    await btn.click();
    await waitFor(
      async () => {
        const now = (await ctx.readDiagram()).rois ?? [];
        return now.some((r) => r.id === victim.id) ? null : now.length;
      },
      { timeout: 20_000, message: `删除后 ROI ${victim.id} 必须从后端消失` }
    );
    ctx.noteDeletedRoiId(victim.id);
    return { detail: { deletedRoiId: victim.id } };
  },

  async ready_delete_roi(ctx) {
    const d = await ctx.readDiagram();
    if ((d.rois?.length ?? 0) < 2) return false;
    return (await ctx.page.locator('.btn-delete-roi').count()) > 0;
  },

  async rename_roi(ctx) {
    const d = await ctx.readDiagram();
    const active = (d.rois ?? []).find((r) => r.id === d.activeRoiId) ?? d.rois?.[0];
    if (!active) throw new ActionUnavailable('没有 ROI 可改名');
    const name = `Roi_${ctx.seed}_${ctx.step}`;
    const input = await must(ctx.page, '#inp-roi-name', { label: 'ROI 名输入框' });
    await input.click();
    await input.fill('');
    await input.press('Tab'); // change + blur 都会触发重命名
    await input.fill(name);
    await input.press('Tab');
    await waitFor(
      async () => {
        const now = (await ctx.readRois()).rois ?? [];
        return now.some((r) => r.name === name) ? name : null;
      },
      { timeout: 15_000, message: `改名后后端 ROI 名里必须出现 ${name}` }
    );
    return { detail: { roiId: active.id, name } };
  },

  async ready_rename_roi(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#inp-roi-name').count()) > 0;
  },

  // ---------------------------------------------------------------- 步进
  async goto_step2(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-goto-step2',
      targetStage: 2,
      label: '第 1 步「进入步骤 2」',
    });
    // 进第 2 步后 ROI 面板才挂载；等它出现再算状态，避免用半完成的面板做后续动作。
    await waitFor(
      async () => (await ctx.page.locator('.step-panel[data-step="2"]').count()) > 0,
      { timeout: 20_000, message: '进入第 2 步后必须挂载 ROI 面板' }
    );
    return { detail: { stage: 2 } };
  },

  async ready_goto_step2(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    if ((await readFront(ctx.page)).stage !== 1) return false;
    return (await ctx.page.locator('#btn-goto-step2').count()) > 0;
  },
  async apply_roi_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-roi-next',
      targetStage: 3,
      label: '第 2 步「下一步」',
    });
    return { detail: { stage: 3 } };
  },

  async ready_apply_roi_next(ctx) {
    return (await readFront(ctx.page)).stage === 2;
  },

  // ---------------------------------------------------------------- Y 标定
  async commit_ycalib(ctx) {
    const { page, rng } = ctx;
    const topPx = Math.round(rng.floatBetween(0, 200));
    const botPx = Math.round(rng.floatBetween(TRUTH_H - 400, TRUTH_H - 60));
    const unit = 'cm';

    // 一次性写全五框再点一次应用：逐框 fill 会触发 change 自动提交 + 面板重挂，
    // 后写的值落在被替换掉的旧节点上（产品缺陷 F-3）。这里不重复踩它。
    const fields = [
      ['#ycal-inp-unit', unit],
      ['#ycal-inp-top-px', String(topPx)],
      ['#ycal-inp-bot-px', String(botPx)],
      ['#ycal-inp-top-val', '0'],
      ['#ycal-inp-bot-val', '1300'],
    ];
    const applied = await page.evaluate((pairs) => {
      for (const [sel, value] of pairs) {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, missing: sel };
        el.value = value;
      }
      const btn = document.querySelector('#btn-apply-ycalib');
      if (!btn) return { ok: false, missing: '#btn-apply-ycalib' };
      btn.click();
      return { ok: true };
    }, fields);
    if (!applied.ok) {
      throw new ActionUnavailable(`Y 标定面板缺少元素 ${applied.missing}`, { selector: applied.missing });
    }

    const cal = await waitFor(
      async () => {
        const c = (await ctx.readDiagram()).calibration;
        return c?.isCalibrated ? c : null;
      },
      { timeout: 25_000, message: '点「应用标定」后后端必须进入已标定状态' }
    );
    if (Number(cal.top_px) !== topPx || Number(cal.bottom_px) !== botPx) {
      throw new ActionFailed(
        `后端标定值与用户输入不一致：期望 top=${topPx}/bottom=${botPx}，实际 ${JSON.stringify(cal)}`
      );
    }
    return { detail: { topPx, botPx, unit } };
  },

  async ready_commit_ycalib(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#ycal-inp-top-px').count()) > 0;
  },

  async apply_ycalib_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-ycalib-next',
      targetStage: 4,
      label: '第 3 步「下一步」',
    });
    return { detail: { stage: 4 } };
  },

  async ready_apply_ycalib_next(ctx) {
    return (await readFront(ctx.page)).stage === 3;
  },

  // ---------------------------------------------------------------- 清理
  async detect_candidates(ctx) {
    await (await must(ctx.page, '#btn-detect-candidates', { label: '「检测候选几何」' })).click();
    // 检测是异步的；等前端镜像稳定（candidates 数组出现）即可，条数因图而异。
    const n = await waitFor(
      async () => {
        const d = await ctx.readDiagram();
        return Array.isArray(d.line_candidates) ? d.line_candidates.length : null;
      },
      { timeout: 40_000, message: '检测后后端必须给出 line_candidates 数组（可为空）' }
    );
    return { detail: { candidates: n } };
  },

  async ready_detect_candidates(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#btn-detect-candidates').count()) > 0;
  },

  async confirm_candidate(ctx) {
    // 「确认去除」按钮由列表逐行渲染；`data-next="removed"` 表示该行当前还是待确认。
    const selector = '.btn-toggle-geometry[data-next="removed"]';
    const btn = ctx.page.locator(selector).first();
    if ((await ctx.page.locator(selector).count()) === 0) {
      throw new ActionUnavailable('没有待确认的候选几何（列表为空或全部已确认）', { selector });
    }
    const candId = await btn.getAttribute('data-cand-id');
    await btn.click();
    await waitFor(
      async () => {
        const d = await ctx.readDiagram();
        const list = d.line_candidates ?? [];
        return list.some((c) => c.id === candId && c.status === 'removed');
      },
      { timeout: 20_000, message: `点「确认去除」后后端候选 ${candId} 的 status 必须变成 removed` }
    );
    return { detail: { candId } };
  },

  async ready_confirm_candidate(ctx) {
    // 该按钮只存在于第 4 步面板的候选列表里。
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('.btn-toggle-geometry[data-next="removed"]').count()) > 0;
  },

  async apply_cleanup_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-cleanup-next',
      targetStage: 5,
      label: '第 4 步「下一步」',
    });
    // 进第 5 步会真的重跑分列，等它跑完再算状态。
    await waitFor(
      async () => (await ctx.readDiagram()).columns.length > 0,
      { timeout: 80_000, message: '进入第 5 步必须真的跑出属种列' }
    );
    return { detail: { stage: 5 } };
  },

  async ready_apply_cleanup_next(ctx) {
    return (await readFront(ctx.page)).stage === 4;
  },

  // ---------------------------------------------------------------- 列名
  async rename_column(ctx) {
    const d = await ctx.readDiagram();
    const cols = d.columns ?? [];
    if (!cols.length) throw new ActionUnavailable('还没有列可改名');
    const target = cols[Math.floor(ctx.rng.float() * cols.length)];
    const name = `Taxon_${ctx.seed}_${ctx.step}`;
    const selector = `input.taxa-name-inline-input[data-col-id="${target.id}"]`;
    const input = ctx.page.locator(selector).first();
    if ((await input.count()) === 0) throw new ActionUnavailable(`列 ${target.id} 的行内改名框不在 DOM 里`, { selector });
    if (!(await input.isVisible().catch(() => false))) {
      throw new ActionUnavailable(`列 ${target.id} 的行内改名框不可见（侧栏可能未展开该列）`, { selector });
    }

    await input.click();
    await input.fill('');
    // 前置必须为真：清空后"真的为空"才说明没被重渲染吃掉。
    if ((await input.inputValue()) !== '') {
      throw new ActionFailed(`清空后输入框仍有残留内容（${await input.inputValue()}），后续键入不可信`);
    }
    await ctx.page.keyboard.type(name, { delay: 15 });
    if ((await input.inputValue()) !== name) {
      throw new ActionFailed(`键入后输入框值不是 ${name}（实际 ${await input.inputValue()}）`);
    }
    await input.press('Enter');

    await waitFor(
      async () => {
        const now = (await ctx.readDiagram()).columns ?? [];
        return now.some((c) => c.id === target.id && c.name === name) ? name : null;
      },
      { timeout: 20_000, message: `改名后后端列 ${target.id} 的 name 必须是 ${name}` }
    );
    return { detail: { colId: target.id, name } };
  },

  async ready_rename_column(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('input.taxa-name-inline-input').count()) > 0;
  },

  async apply_naming_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-naming-next',
      targetStage: 6,
      label: '第 5 步「下一步」',
    });
    return { detail: { stage: 6 } };
  },

  async ready_apply_naming_next(ctx) {
    return (await readFront(ctx.page)).stage === 5;
  },

  // ---------------------------------------------------------------- X 刻标定
  async save_manual_ticks(ctx) {
    const { page, rng } = ctx;
    const v1 = 0;
    const v2 = Math.round(rng.floatBetween(10, 100));
    const before = JSON.stringify(
      ((await ctx.readDiagram()).columns ?? []).map((c) => [c.id, c.x_ticks ?? null])
    );

    await (await must(page, '#inp-manual-tick-val1', { label: '刻度值 1 输入框' })).fill(String(v1));
    await (await must(page, '#inp-manual-tick-val2', { label: '刻度值 2 输入框' })).fill(String(v2));
    await (await must(page, '#btn-save-manual-ticks', { label: '「保存」刻度按钮' })).click();

    const changed = await waitFor(
      async () => {
        const cols = (await ctx.readDiagram()).columns ?? [];
        const now = JSON.stringify(cols.map((c) => [c.id, c.x_ticks ?? null]));
        if (now === before) return null;
        const got = cols.filter((c) => Array.isArray(c.x_ticks) && c.x_ticks.length === 2);
        return got.length > 0 ? got.map((c) => ({ id: c.id, x_ticks: c.x_ticks })) : null;
      },
      { timeout: 25_000, message: '点「保存」后必须恰好有列获得两个 x_ticks（读数只能来自用户输入）' }
    );
    if (changed.length > 1) {
      throw new ActionFailed(`保存一次标定却改动了 ${changed.length} 列：${JSON.stringify(changed.map((c) => c.id))}`);
    }
    return { detail: { values: [v1, v2], calibrated: changed } };
  },

  async ready_save_manual_ticks(ctx) {
    const d = await ctx.readDiagram();
    if ((d.columns?.length ?? 0) === 0) return false;
    return (await ctx.page.locator('#inp-manual-tick-val1').count()) > 0;
  },

  async apply_xticks_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-xticks-next',
      targetStage: 7,
      label: '第 6 步「下一步」',
    });
    return { detail: { stage: 7 } };
  },

  async ready_apply_xticks_next(ctx) {
    return (await readFront(ctx.page)).stage === 6;
  },

  // ---------------------------------------------------------------- 层位
  async extract_consensus(ctx) {
    await (await must(ctx.page, '#btn-extract-consensus', { label: '「提取共识层位」' })).click();
    const n = await waitFor(
      async () => {
        const s = await ctx.readSamples();
        return Number(s.count ?? 0) > 0 ? Number(s.count) : null;
      },
      { timeout: 90_000, message: '点「提取共识层位」后后端必须真的产出层位' }
    );
    const samples = await ctx.readSamples();
    const depths = (samples.samples ?? []).map((s) => s.depth);
    const bad = depths.filter((d) => !Number.isFinite(d));
    if (bad.length) {
      throw new ActionFailed(`层位深度存在非有限值（${bad.length} 条），标定没有被用上`);
    }
    return { detail: { count: n, depthRange: [Math.min(...depths), Math.max(...depths)] } };
  },

  async ready_extract_consensus(ctx) {
    const d = await ctx.readDiagram();
    if ((d.columns?.length ?? 0) === 0) return false;
    return (await ctx.page.locator('#btn-extract-consensus').count()) > 0;
  },

  async clear_horizons(ctx) {
    await (await must(ctx.page, '#btn-clear-horizons', { label: '「清空」层位按钮' })).click();
    await waitFor(
      async () => Number((await ctx.readSamples()).count ?? 0) === 0,
      { timeout: 25_000, message: '点「清空」后后端层位数必须归零' }
    );
    return { detail: { count: 0 } };
  },

  async ready_clear_horizons(ctx) {
    if (Number((await ctx.readSamples()).count ?? 0) === 0) return false;
    return (await ctx.page.locator('#btn-clear-horizons').count()) > 0;
  },

  async apply_samples_next(ctx) {
    await advance(ctx.page, ctx, {
      selector: '#btn-apply-samples-next',
      targetStage: 8,
      label: '第 7 步「下一步」',
    });
    return { detail: { stage: 8 } };
  },

  async ready_apply_samples_next(ctx) {
    return (await readFront(ctx.page)).stage === 7;
  },

  // ---------------------------------------------------------------- 导出前
  async run_qa(ctx) {
    // 旧判据是"#qa-banner 存在"——但横幅在点击**之前**就已经渲染，那个条件恒真，
    // 等于没等（假绿）。改成看**内容**：先记下点击前的横幅文本，点击后要求
    // ① 页面侧在飞的 /rpc 归零；② 横幅文本非空。
    const banner = ctx.page.locator('#qa-banner');
    const before = (await banner.count()) ? (await banner.first().innerText()).trim() : '';

    await (await must(ctx.page, '#btn-run-qa', { label: '「重新执行 QA 诊断」' })).click();
    await requireQuiet(ctx.page, '跑 QA');
    await waitFor(
      async () => {
        if ((await ctx.page.locator('#qa-banner').count()) === 0) return null;
        const text = (await ctx.page.locator('#qa-banner').first().innerText()).trim();
        return text.length > 0 ? text : null;
      },
      { timeout: 60_000, message: '跑 QA 后 QA 横幅必须渲染出非空内容（#qa-banner）' }
    );
    const after = (await ctx.page.locator('#qa-banner').first().innerText()).trim();
    ctx.markQaRan();
    return { detail: { qaBanner: true, qaTextChanged: after !== before } };
  },

  async ready_run_qa(ctx) {
    return (await ctx.page.locator('#btn-run-qa').count()) > 0;
  },

  // ---------------------------------------------------------------- 撤销
  async undo(ctx) {
    const btn = await must(ctx.page, '#btn-undo', { label: '「撤销」按钮' });
    await btn.click();
    // 撤销可能发 0 个也可能发 1 个 RPC（`applyHistorySnapshot` 只在有 ROI 时 commitRoi）。
    // 判据是"页面侧在飞的 /rpc 归零"，不是等 300ms；没有 RPC 时它会两帧内返回。
    await requireQuiet(ctx.page, '撤销');
    return { detail: { clicked: true } };
  },

  async ready_undo(ctx) {
    const btn = ctx.page.locator('#btn-undo').first();
    if ((await btn.count()) === 0) return false;
    return btn.isEnabled().catch(() => false);
  },

  async redo(ctx) {
    const btn = await must(ctx.page, '#btn-redo', { label: '「重做」按钮' });
    await btn.click();
    await requireQuiet(ctx.page, '重做');
    return { detail: { clicked: true } };
  },

  async ready_redo(ctx) {
    const btn = ctx.page.locator('#btn-redo').first();
    if ((await btn.count()) === 0) return false;
    return btn.isEnabled().catch(() => false);
  },

  // ---------------------------------------------------------------- 视口
  async fit_view(ctx) {
    await blurActive(ctx.page);
    await ctx.page.keyboard.press('f');
    // heuristic_wait：`fit_view` 不发 RPC，也没有"变没变"可判——`F` 是幂等的，
    // 已经适应屏幕时再按一次，视口三元组一个字节都不动。唯一可等的信号是"重绘落定"，
    // 所以只等帧边界。见 states.mjs 里该动作的 `waitMode`。
    await waitForRenderSettled(ctx.page);
    return { detail: { key: 'f' } };
  },

  async ready_fit_view(ctx) {
    return Boolean((await ctx.readDiagram()).imageSrc);
  },

  async zoom_in(ctx) {
    await (await must(ctx.page, '#btn-zoom-in', { label: '「放大」按钮' })).click();
    // heuristic_wait：缩放会被上限钳制（已到最大倍率时 scale 不变），
    // "变了"不是恒成立的判据；等帧边界即可。见 states.mjs 的 `waitMode`。
    await waitForRenderSettled(ctx.page);
    return { detail: {} };
  },

  async ready_zoom_in(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#btn-zoom-in').count()) > 0;
  },

  async zoom_out(ctx) {
    await (await must(ctx.page, '#btn-zoom-out', { label: '「缩小」按钮' })).click();
    // heuristic_wait：同 zoom_in，下限同样会钳制。见 states.mjs 的 `waitMode`。
    await waitForRenderSettled(ctx.page);
    return { detail: {} };
  },

  async ready_zoom_out(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#btn-zoom-out').count()) > 0;
  },

  async pan_canvas(ctx) {
    const { page, rng } = ctx;
    const box = await page.locator('#geology-canvas').boundingBox();
    if (!box) throw new ActionUnavailable('画布没有布局框，无法平移');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = (rng.float() > 0.5 ? 1 : -1) * Math.round(40 + rng.float() * 60);
    const dy = (rng.float() > 0.5 ? 1 : -1) * Math.round(20 + rng.float() * 50);

    const before = await readFront(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    // heuristic_wait：平移会在图像边缘被钳制（panX/panY 可能一格都不动），
    // 所以"位移发生了变化"不能当判据；只等重绘落定，`moved` 作为观测如实上报。
    await waitForRenderSettled(ctx.page);
    const after = await readFront(page);
    return {
      detail: {
        panBefore: before.viewport,
        panAfter: after.viewport,
        moved: before.viewport.panX !== after.viewport.panX || before.viewport.panY !== after.viewport.panY,
      },
    };
  },

  async ready_pan_canvas(ctx) {
    return Boolean((await ctx.readDiagram()).imageSrc);
  },

  async double_click_canvas(ctx) {
    const box = await ctx.page.locator('#geology-canvas').boundingBox();
    if (!box) throw new ActionUnavailable('画布没有布局框，无法双击');
    await ctx.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    // heuristic_wait：双击的语义随工具模式变化（加控制点 / 放大 / 无动作），
    // 没有单一后端统计量能证明"双击已经处理完"，只能等帧边界。
    // 这也是本 lane 里最弱的一次等待，故该动作标 heuristic_wait 并在 seq.json 可见。
    await waitForRenderSettled(ctx.page);
    return { detail: {} };
  },

  async ready_double_click_canvas(ctx) {
    return Boolean((await ctx.readDiagram()).imageSrc);
  },

  // ---------------------------------------------------------------- 保存/重开
  async save_project(ctx) {
    const { page } = ctx;
    const btn = await must(page, '#btn-save-project', { label: '「保存项目」按钮' });
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await btn.click();
    const download = await downloadPromise;
    const target = join(ctx.seedDir, 'saved-project.tar');
    await download.saveAs(target);
    if (!existsSync(target)) {
      throw new ActionFailed(`保存项目的下载文件没有落盘：${target}`);
    }
    // 保存时刻的"关键状态"：ROI 名 / 列数 / 标定端点。不变量 ⑥ 拿它与重开后比。
    const snapshot = await ctx.captureKeyState();
    ctx.setSavedProject(target, snapshot);
    return { detail: { path: target, keyState: snapshot } };
  },

  async ready_save_project(ctx) {
    if (!(await ctx.readDiagram()).imageSrc) return false;
    return (await ctx.page.locator('#btn-save-project').count()) > 0;
  },

  async reopen_project(ctx) {
    const { page } = ctx;
    if (!ctx.savedProjectPath) throw new ActionUnavailable('还没有保存过项目，无文件可重开');
    const before = await ctx.captureKeyState();

    let how = 'filechooser';
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
      await (await must(page, '#btn-open-project', { label: '「打开项目」按钮' })).click();
      const chooser = await chooserPromise;
      await chooser.setFiles(ctx.savedProjectPath);
    } catch (err) {
      if (err instanceof ActionUnavailable) throw err;
      how = `setInputFiles 兜底（${err?.message ?? err}）`;
      await (await must(page, '#file-input-project', { label: '项目文件输入框' })).setInputFiles(
        ctx.savedProjectPath
      );
    }

    // 重开是多阶段落地：解 tar → 换图 → 重建 ROI → 前端整块重挂。
    // 两级条件，都不看时间：
    //   ① 后端权威侧：图回来了且 ROI 就位；
    //   ② 前端镜像侧：连续两次采样完全相同（stage/ROI 数/列数/图尺寸/标定 都不再变）。
    // 只做①会在"后端已就位、面板还在重挂"的空窗里读到半完成镜像；
    // 只做②可能在镜像从头到尾没变过的空转里提前返回。两条一起才闭合。
    await waitFor(
      async () => {
        const d = await ctx.readDiagram();
        return d.imageSrc && (d.rois?.length ?? 0) > 0;
      },
      { timeout: 120_000, message: '打开项目文件后后端必须重新具备图像与 ROI' }
    );
    // 顺序有讲究：先等在飞的请求归零，再等镜像稳定。
    // 反过来做会在"请求还没回、镜像暂时没变"的空窗里判稳定，之后面板再变一次，
    // 于是拿到的 after 仍是中间态。
    await requireQuiet(page, '打开项目');
    const settled = await waitForStableFront(page, { samples: 2 });
    if (!settled.stable) {
      throw new ActionFailed(`打开项目后前端镜像始终不稳定（${settled.frames} 帧内未收敛）`);
    }
    const after = await ctx.captureKeyState();
    return { detail: { how, before, after, mirrorStableFrames: settled.frames } };
  },

  async ready_reopen_project(ctx) {
    if (!ctx.savedProjectPath) return false;
    return (await ctx.page.locator('#btn-open-project').count()) > 0;
  },
};

/** 动作实现里以 `ready_<id>` 形式挂的可行性判定，抽出来给 `run.mjs` 用。 */
export function readyFn(id) {
  return ACTIONS[`ready_${id}`] ?? (async () => true);
}

/** 动作执行函数。 */
export function runFn(id) {
  return ACTIONS[id];
}
