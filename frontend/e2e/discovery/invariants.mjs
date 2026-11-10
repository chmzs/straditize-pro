/**
 * Discovery lane —— 不变量机检。
 *
 * ## 判定原则
 *
 * 每条检查返回 `pass` / `fail` / `skip` 三态之一，**没有第四种**。
 * `skip` 必须带 `reason`，且 `skip` 绝不等于 `pass`：把"没法判定"混进"通过"，
 * 是这类门禁最容易退化成装饰的地方（`docs/testing-strategy.md` §8 的金丝雀纪律）。
 *
 * 检查对象只有两个来源：**后端权威载荷**与**真实的 DOM**。
 * 前端镜像 `getState()` 只在不变量 ⑤ 里当"第二现场"扫一遍（镜像里复活同样算违反），
 * 不用它做任何数值断言。
 *
 * ## 六条机检
 *
 * | # | 内容 | 判据来源 |
 * | --- | --- | --- |
 * | I1 | 无未捕获异常 / console.error | 页面遥测 |
 * | I2 | 前端活动 ROI == 后端 `activeRoiId` | DOM（第 2 步面板的活动卡片）+ 后端 |
 * | I3 | primary / active 指向仍存在的 ROI | 后端 |
 * | I4 | 所有列的 `roi_id` 都存在 | 后端 |
 * | I5 | 删除过的 id 不再出现在任何状态里 | 后端 + 前端镜像全文扫描 |
 * | I6 | 保存 → 重开后关键状态一致 | 保存时刻快照 vs 重开后快照 |
 *
 * ## 为什么只有这六条是机检的（其余留 TODO）
 *
 * 见文件末尾 `MANUAL_ONLY` 的逐条理由。总原则：**能机检的必须有一条可证伪的观测**；
 * 只能靠"看起来对不对"的，不塞进机检清单——它会把噪声变成红灯，最后所有人都学会忽略红灯。
 */

/** 允许出现的控制台错误：底层网络抖动（与 `fixtures.ts` 同一份白名单）。 */
const NETWORK_NOISE = [
  'net::ERR_NO_BUFFER_SPACE',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
];

const ok = (detail) => ({ status: 'pass', detail });
const bad = (detail) => ({ status: 'fail', detail });
const skip = (reason) => ({ status: 'skip', detail: reason });

/** 把 id 当**带引号的字面量**在 JSON 文本里找，避免 `roi_1` 命中 `roi_10`。 */
function mentionsId(haystackJson, id) {
  return haystackJson.includes(JSON.stringify(id));
}

/**
 * 读"界面认为的活动 ROI"。
 *
 * ## 为什么不拿 `getState().activeRoiId` 当"前端活动 ROI"
 *
 * 因为那是**循环论证**：`getState()` 暴露的 `activeRoiId` 是前端对后端字段的镜像
 * （`WebMcpBridge.ts:136` 读 `data.active_roi_id`），用它和后端比，比的是一份拷贝
 * 和它的来源，永远相等，永远绿——这也是本仓库反复记录的那类"恒真判据"。
 *
 * 真正独立的证人是 **DOM**：界面到底把哪个 ROI 画成了活动态，只能从界面本身读。
 * 所以这里读第 2 步面板：活动卡片的内联样式带 `var(--accent-blue)`，
 * 兜底再读面板上的"当前 ROI：<名字>"标签并与 ROI 名单唯一匹配。
 *
 * （初版注释曾断言镜像字段恒为 null —— 实测证伪：`observations` 里 O1 记录到
 * 镜像值 `roi_1` 与后端一致。结论不变，理由换成了上面那条更强的。）
 */
async function readDomActiveRoiId(page, rois) {
  return page.evaluate((roiList) => {
    const panel = document.querySelector('.step-panel[data-step="2"]');
    if (!panel) return { found: false, reason: '第 2 步面板未挂载（当前不在第 2 步）' };

    const marked = panel.querySelector('.roi-item-card[style*="accent-blue"]');
    const byStyle = marked ? marked.getAttribute('data-roi-id') : null;
    if (byStyle) return { found: true, id: byStyle, how: 'card-highlight' };

    // 兜底：面板上的"当前 ROI: 名字"标签。名字必须唯一匹配，否则不猜。
    const label = Array.from(panel.querySelectorAll('div'))
      .map((el) => (el.textContent ?? '').trim())
      .find((text) => text.includes('当前 ROI'));
    if (!label) return { found: false, reason: '面板里既没有活动卡片标记，也没有「当前 ROI」标签' };
    const name = label.split(/[:：]/).slice(1).join(':').trim();
    const hits = (roiList ?? []).filter((r) => r.name === name);
    if (hits.length !== 1) {
      return { found: false, reason: `「当前 ROI」标签名 ${JSON.stringify(name)} 无法唯一匹配 ROI（命中 ${hits.length} 个）` };
    }
    return { found: true, id: hits[0].id, how: 'current-roi-label' };
  }, rois ?? []);
}

export const INVARIANTS = [
  {
    id: 'I1',
    title: '无未捕获异常 / 无 console.error',
    async check(env) {
      const errors = (env.consoleErrors ?? []).filter(
        (e) => !NETWORK_NOISE.some((noise) => e.includes(noise))
      );
      if (errors.length === 0) return ok('页面遥测里没有未豁免的控制台错误或未捕获异常');
      return bad(
        `出现 ${errors.length} 条控制台错误/未捕获异常（前 3 条）：${JSON.stringify(errors.slice(0, 3))}`
      );
    },
  },

  {
    id: 'I2',
    title: '前端活动 ROI == 后端 active_roi_id',
    async check(env) {
      const d = env.backend;
      if (!d?.imageSrc) return skip('零状态：没有图，谈不上活动 ROI');
      const rois = d.rois ?? [];
      if (rois.length === 0) return skip('后端没有任何 ROI，无从比较');

      const dom = await readDomActiveRoiId(env.page, rois);
      if (!dom.found) return skip(`读不到界面当前活动 ROI：${dom.reason}`);

      if (dom.id === d.activeRoiId) {
        return ok(`界面（${dom.how}）与后端都是 ${dom.id}`);
      }
      return bad(
        `界面认为活动 ROI 是 ${JSON.stringify(dom.id)}（${dom.how}），后端 activeRoiId 是 ${JSON.stringify(
          d.activeRoiId
        )}`
      );
    },
  },

  {
    id: 'I3',
    title: 'primary / active 指向仍存在的 ROI',
    async check(env) {
      const d = env.backend;
      if (!d) return skip('拿不到后端载荷');
      const ids = new Set((d.rois ?? []).map((r) => r.id));
      const problems = [];
      if (d.primaryRoiId != null && !ids.has(d.primaryRoiId)) {
        problems.push(`primaryRoiId=${JSON.stringify(d.primaryRoiId)} 不在 ROI 列表 ${JSON.stringify([...ids])} 里`);
      }
      if (d.activeRoiId != null && !ids.has(d.activeRoiId)) {
        problems.push(`activeRoiId=${JSON.stringify(d.activeRoiId)} 不在 ROI 列表 ${JSON.stringify([...ids])} 里`);
      }
      // 有 ROI 却没有任何主 ROI，也是"指向悬空"的一种（导出归属会失去准星）。
      if (ids.size > 0 && d.primaryRoiId == null) {
        problems.push(`有 ${ids.size} 个 ROI 但 primaryRoiId 为 null`);
      }
      if (problems.length) return bad(problems.join('；'));
      return ok(`primary=${JSON.stringify(d.primaryRoiId)}、active=${JSON.stringify(d.activeRoiId)} 均存在`);
    },
  },

  {
    id: 'I4',
    title: '所有列的 roi_id 都存在',
    async check(env) {
      const d = env.backend;
      if (!d) return skip('拿不到后端载荷');
      const columns = d.columns ?? [];
      if (columns.length === 0) return skip('还没有列（尚未分列）');
      const ids = new Set((d.rois ?? []).map((r) => r.id));
      const orphans = columns
        .filter((c) => !c || !c.roi_id || !ids.has(c.roi_id))
        .map((c) => ({ id: c?.id, roi_id: c?.roi_id }));
      if (orphans.length) {
        return bad(
          `${orphans.length}/${columns.length} 列的 roi_id 指向不存在的 ROI（前 3 条）：${JSON.stringify(
            orphans.slice(0, 3)
          )}`
        );
      }
      return ok(`${columns.length} 列的 roi_id 全部命中现有 ROI`);
    },
  },

  {
    id: 'I5',
    title: '删除后该 ROI id 不再出现在任何状态里',
    async check(env) {
      const deleted = [...(env.deletedRoiIds ?? [])];
      if (deleted.length === 0) return skip('本轮尚未删除过任何 ROI');

      const backendJson = JSON.stringify(env.backend ?? {});
      const frontJson = JSON.stringify(env.front ?? {});
      const resurrected = [];
      for (const id of deleted) {
        const inBackend = mentionsId(backendJson, id);
        const inFront = mentionsId(frontJson, id);
        if (inBackend || inFront) {
          resurrected.push({ id, inBackend, inFront });
        }
      }
      if (resurrected.length) {
        return bad(
          `已删除的 ROI id 仍在状态里出现：${JSON.stringify(resurrected)}` +
            `（inBackend 查后端载荷全文，inFront 查前端镜像全文；两者都算复活）`
        );
      }
      return ok(`已删除的 ${deleted.length} 个 id（${JSON.stringify(deleted)}）在后端与前端镜像里都不再出现`);
    },
  },

  {
    id: 'I6',
    title: '保存 → 重开后关键状态一致（ROI 名 / 列数 / 标定端点）',
    async check(env) {
      const saved = env.savedKeyState;
      const reopened = env.reopenedKeyState;
      if (!saved) return skip('本轮没有执行过 save_project');
      if (!reopened) return skip('本轮保存过但还没有 reopen_project，无从比较');

      const diffs = [];
      if (JSON.stringify(saved.roiNames) !== JSON.stringify(reopened.roiNames)) {
        diffs.push(`ROI 名：保存时 ${JSON.stringify(saved.roiNames)}，重开后 ${JSON.stringify(reopened.roiNames)}`);
      }
      if (saved.columnCount !== reopened.columnCount) {
        diffs.push(`列数：保存时 ${saved.columnCount}，重开后 ${reopened.columnCount}`);
      }
      for (const key of ['isCalibrated', 'top_px', 'bottom_px']) {
        if (saved.calibration?.[key] !== reopened.calibration?.[key]) {
          diffs.push(
            `标定 ${key}：保存时 ${JSON.stringify(saved.calibration?.[key])}，重开后 ${JSON.stringify(
              reopened.calibration?.[key]
            )}`
          );
        }
      }
      if (diffs.length) return bad(diffs.join('；'));
      return ok(
        `ROI 名 ${JSON.stringify(saved.roiNames)}、列数 ${saved.columnCount}、标定端点 ${JSON.stringify(
          saved.calibration
        )} 三项在保存与重开后一致`
      );
    },
  },
];

/**
 * 只记录、**不判定**的观测项。
 *
 * 这些是真实存在的可疑之处，但要么缺一条可证伪的判据，要么修不修是产品决策，
 * 塞进机检清单只会制造无法归因的红灯。它们的输出会原样进 `seq.json` 的
 * `observations` 字段，供人决定要不要升格成不变量。
 */
export const OBSERVATIONS = [
  {
    id: 'O1',
    title: '前端镜像 activeRoiId 是否已经跟上后端（陈旧镜像检查）',
    async observe(env) {
      const d = env.backend;
      if (!d?.imageSrc) return { status: 'skip', detail: '零状态' };
      const mirror = env.front?.activeRoiId ?? null;
      const truth = d.activeRoiId ?? null;
      if (mirror !== truth) {
        return {
          status: 'stale-mirror',
          detail:
            `后端 activeRoiId=${JSON.stringify(truth)}，前端镜像=${JSON.stringify(mirror)}：` +
            '前端镜像滞后于后端。注意这不是不变量 I2 的替代品 —— I2 拿 DOM 当独立证人，' +
            '本条只用来抓"后端已改、界面还没跟上"这一类时序缺陷。',
        };
      }
      return { status: 'ok', detail: `镜像与后端同为 ${JSON.stringify(truth)}` };
    },
  },
  {
    id: 'O2',
    title: '动作的声明的后继状态与实际落点',
    async observe(env) {
      if (!env.declaredTo || !env.postState) return { status: 'skip', detail: '无状态信息' };
      if (env.declaredTo.includes(env.postState)) return { status: 'ok', detail: '' };
      return {
        status: 'unexpected',
        detail: `动作 ${env.actionId} 声明可进入 ${JSON.stringify(env.declaredTo)}，实际落在 ${env.postState}`,
      };
    },
  },
];

/**
 * 已知只能人工看、因此**不**进机检的检查项。每条都写清"为什么难机检"。
 *
 * TODO(manual) 三种平移手势等价（右键拖拽 / 中键拖拽 / 空格+左键）
 *   要机检必须证明"三种手势产生的视口变换逐位相同"。现实里三次拖拽的鼠标位移
 *   不可能逐像素相同，判据只能退化成"都变了"——那是存在性断言，红不了。可行的
 *   做法是构造完全相同的 pointer 序列并断言 `viewport` 三元组相等，但右键拖拽路径
 *   与空格+左键路径走的代码分支不同，浮点累加顺序也不同，需要先定义容差；
 *   容差一开就不再是"等价"。留人工 + 视口快照图。
 *
 * TODO(manual) 画布像素层面"这一层真的画了"
 *   `docs/testing-strategy.md` §8 已有 `canvasInk` / `canvasColorPixels` 两个探针，
 *   但随机探索里状态千变万化，"某层应该出现"的期望值本身是随机的；要判就得为每个
 *   状态写一张基线图，那是 golden 测试（§8.5 的三条硬约定），不属于本 lane。
 *
 * TODO(manual) 列内曲线数值的正确性（读数与形态是否对得上原图）
 *   需要人工判读或与真值表对账；随机动作序列不产生可比对的真值。
 *
 * TODO(manual) 撤销栈"深到第 N 层"仍然正确
 *   撤销栈的深度语义是前端私有实现（`History` 类没挂到 window），外部只能看到
 *   `#btn-undo` 的 disabled 状态。要机检必须先把栈暴露成可读接口——那是给产品
 *   加测试专用 API，本 lane 明确不做。
 *
 * TODO(manual) 并发/时序类缺陷（连击导致的双重提交）
 *   本 lane 的"连击"动作只做了一次双击；真正的连击 bug 需要在同一帧内注入两次
 *   click，Playwright 的 `dblclick` 已保证 500ms 内的两次点击，但仍然不能覆盖
 *   "用户快速点两次不同按钮"这种跨控件竞态。要覆盖它得注入自定义事件序列，
 *   观测面（后端计数）又常常被幂等逻辑掩盖，判据不可证伪。
 *
 * TODO(manual) 导出归档内容的正确性
 *   已有 `export.spec.ts` 与 `from-zero-journey.spec.ts` 逐字节对账（data.csv 等于
 *   主 ROI 分表、含非零读数）。本 lane 只到 `run_qa` 为止，不重复造那份判据。
 */
export const MANUAL_ONLY = Object.freeze([
  '三种平移手势等价',
  '画布像素层面"该层真的画了"',
  '列内曲线数值正确性',
  '撤销栈深层一致性',
  '并发/时序类缺陷（连击）',
  '导出归档内容正确性',
]);

/** 跑一遍全部机检 + 观测项。 */
export async function runChecks(env) {
  const results = [];
  for (const inv of INVARIANTS) {
    let result;
    try {
      result = await inv.check(env);
    } catch (err) {
      // 检查自己抛错 = 检查不可信，必须显式失败而不是静默通过。
      result = bad(`检查自身抛出异常：${err?.message ?? err}`);
    }
    results.push({ id: inv.id, title: inv.title, ...result });
  }
  const observations = [];
  for (const obs of OBSERVATIONS) {
    let result;
    try {
      result = await obs.observe(env);
    } catch (err) {
      result = { status: 'error', detail: String(err?.message ?? err) };
    }
    observations.push({ id: obs.id, title: obs.title, ...result });
  }
  return { results, observations };
}
