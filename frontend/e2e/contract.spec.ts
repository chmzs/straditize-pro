/**
 * 前后端契约核对（真实后端）。
 *
 * ## 为什么这个文件必须存在
 *
 * 旧套件号称有一条"契约 v1.3 字段完整性机器核对"，真身是：
 *
 *     assert.ok(pollenTsContent.includes(field), `DataRoi 缺少契约字段: ${field}`);
 *
 * 把 `pollen.ts` 当纯文本做**子串搜索**——字段名写在注释里也算通过，字段清单还是
 * 硬编码的第三份契约副本。于是遗留缺陷 ①（零状态 `getDiagramData` 少返 5 个键，
 * 前端拿到 `undefined`）在全套门禁下**一直是绿的**，最后靠手工写进程内探针才发现。
 *
 * 这里换成两条硬判据：
 *
 * 1. **从 TS 接口真正解析字段**（剥掉注释、按花括号深度只取顶层字段），
 *    拿**真实运行时 payload** 去对，而不是拿另一份手抄清单去对。
 * 2. **零状态与加载态的键集必须完全一致**——这一条直接钉死遗留 ①，
 *    因为它的病根就是"两个 return 分支各写各的键"。
 *
 * 判据的边界写清楚：**TS 必填字段必须存在；可选字段（`?:`）允许缺席。**
 * 这样 `Column` 的 `x_ticks?` / `plot_type?` 这类后端本就不发的可选字段不会误报。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { diagramData, gotoStage, resetBaseline, rpc } from './helpers';

const POLLEN_TS = fileURLToPath(new URL('../src/types/pollen.ts', import.meta.url));

interface TsField {
  name: string;
  optional: boolean;
}

/**
 * 后端实际发送**驼峰名**、而 TS 声明**下划线名**的字段。
 *
 * 这是**已知债，不是设计**：四处全部由 `RpcClient` 的归一化垫片兜住
 * （`primary_roi_id`/`active_roi_id` → `RpcClient.ts:315-316`；
 *  `lineCorrections` → `RpcClient.ts:367`）。垫片能work，但**类型系统在这里
 * 提供零保护**——垫片一旦被删就会静默退化成 `rois[0]`，多 ROI 时就是错的。
 *
 * 放进这张表意味着"债务被登记在案，且不再增长"：任何**新增**的名字不一致
 * 都会让本文件失败。要删条目，先让后端改名（那是契约变更，需同步前端/测试/文档）。
 */
const KNOWN_WIRE_ALIASES: Record<string, string> = {
  primary_roi_id: 'primaryRoiId',
  active_roi_id: 'activeRoiId',
  lineCorrections: 'lineRemoval.corrections',
};

/**
 * 由前端自己填充、**不属于 `getDiagramData` 契约**的字段。
 *
 * `samples` 由采样共识提取那条 RPC 单独返回（`main.ts:1300`），
 * `RpcClient` 初始化为 `[]`。TS 把它声明在 wire 接口里是误导，但删除它属于
 * 生产类型改动，另行处理；此处先如实登记，避免它掩盖真正的缺失。
 */
const CLIENT_OWNED_FIELDS = new Set(['samples']);

/**
 * TS 声明为**必填**、而真实 payload 里**按设计就不存在**的字段。
 *
 * 每一条都必须写清"实际用的是什么形状"，否则这张表会退化成"让测试变绿的垃圾桶"。
 * 下面这条揭示的是 `DataRoi` 被**两种不同形状**共用：
 *
 *   - 单数 `data.roi` 是后端给的包围盒 `{xMin,yMin,xMax,yMax}` —— `GeologyCanvas.ts`
 *     直接读写它（539/548/592/1491 行等），**没有任何兜底**；
 *   - 复数 `data.rois[]` 是会话 ROI 记录 `{id,name,xlim,ylim,...}` ——
 *     `RoiOverlay.ts:18`、`SampleOverlay.ts:18` 写的是 `roi.xlim?.[0] ?? roi.xMin ?? 0`。
 *
 * 所以 `DiagramData.rois: DataRoi[]` 是**类型撒谎**：今天没有运行期 bug（读复数
 * 元素的地方都带 `xlim` 兜底），但类型系统挡不住将来有人写 `rois[i].xMin`。
 * 修它要动生产类型（给会话 ROI 记录一个自己的 interface），另行处理。
 */
const NOT_SENT_BY_DESIGN: Record<string, string> = {
  'DataRoi.xMin': 'rois[] 元素是会话 ROI 记录（xlim/ylim）；坐标别名只出现在单数 data.roi 上',
  'DataRoi.xMax': 'rois[] 元素是会话 ROI 记录（xlim/ylim）；坐标别名只出现在单数 data.roi 上',
  'DataRoi.yMin': 'rois[] 元素是会话 ROI 记录（xlim/ylim）；坐标别名只出现在单数 data.roi 上',
  'DataRoi.yMax': 'rois[] 元素是会话 ROI 记录（xlim/ylim）；坐标别名只出现在单数 data.roi 上',
};

/**
 * 从 `pollen.ts` 里解析出某个 interface 的**顶层**字段。
 *
 * 与旧的子串搜索相比，这里做了三件旧实现做不到的事：剥掉块注释与行注释
 * （字段名写在注释里**不算数**）、按花括号/方括号深度只取顶层
 * （`Column.scaleCalib` 里的 `originX` 不会被误当成 Column 的字段）、
 * 记录 `?:` 可选性。
 */
function interfaceFields(name: string): TsField[] {
  const src = fs.readFileSync(POLLEN_TS, 'utf8');
  const decl = new RegExp(`export interface ${name}\\s*\\{`).exec(src);
  if (!decl) throw new Error(`pollen.ts 里找不到 interface ${name}（解析器已失效）`);
  const open = src.indexOf('{', decl.index);

  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`interface ${name} 的花括号不配对`);

  // 注释用空白替换（保留换行，维持行结构），否则注释里的字段名会被误采
  const clean = src
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

  const fields: TsField[] = [];
  let d = 0;
  for (const line of clean.split('\n')) {
    const t = line.trim();
    if (d === 0) {
      const m = /^([A-Za-z_$][\w$]*)\s*(\??)\s*:/.exec(t);
      if (m) fields.push({ name: m[1], optional: m[2] === '?' });
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') d++;
      else if (ch === '}' || ch === ')' || ch === ']') d--;
    }
  }
  return fields;
}

/**
 * 断言 payload 覆盖了该 interface 的所有必填字段。
 *
 * `allowDesignGaps: false` 时连 `NOT_SENT_BY_DESIGN` 也不放过（用于单数 `data.roi`，
 * 它**必须**真的满足 `DataRoi`——否则那张豁免表就是空头支票）。
 */
function auditShape(
  payload: Record<string, unknown>,
  iface: string,
  where: string,
  opts: { allowDesignGaps?: boolean } = {}
): void {
  const allowGaps = opts.allowDesignGaps ?? true;
  const fields = interfaceFields(iface);
  expect(
    fields.length,
    `未能从 ${iface} 解析出任何字段——解析器失效，本断言会假绿`
  ).toBeGreaterThan(0);

  const missing = fields
    .filter((f) => !f.optional)
    .filter((f) => !(f.name in payload))
    .filter((f) => !(f.name in KNOWN_WIRE_ALIASES))
    .filter((f) => !CLIENT_OWNED_FIELDS.has(f.name))
    .filter((f) => !(allowGaps && `${iface}.${f.name}` in NOT_SENT_BY_DESIGN))
    .map((f) => f.name);

  expect(
    missing,
    `${where}：真实 payload 缺少 ${iface} 的必填字段 ${JSON.stringify(missing)}`
  ).toEqual([]);
}

test.describe('前后端契约（真实 payload 对 TS 声明）', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('加载态：getDiagramData 覆盖 DiagramData / DepthCalibration / DataRoi / Column 的必填字段', async ({
    page,
  }) => {
    const data = await diagramData<Record<string, unknown>>(page);

    auditShape(data, 'DiagramData', 'straditize.getDiagramData 加载态');

    const calibration = data.calibration as Record<string, unknown> | null;
    expect(calibration, '基线必须有标定对象').toBeTruthy();
    auditShape(calibration!, 'DepthCalibration', 'payload.calibration');

    const rois = data.rois as Record<string, unknown>[];
    expect(rois.length, '基线必须有 ROI').toBeGreaterThan(0);
    // 复数元素是会话 ROI 记录，坐标别名不在此处（见 NOT_SENT_BY_DESIGN）
    auditShape(rois[0], 'DataRoi', 'payload.rois[0]');

    // 单数 roi 是包围盒，必须**严格**满足 DataRoi —— 这是上面那张豁免表的正向对照
    const roi = data.roi as Record<string, unknown> | null;
    expect(roi, '基线必须有主 ROI 包围盒').toBeTruthy();
    auditShape(roi!, 'DataRoi', 'payload.roi', { allowDesignGaps: false });

    const columns = data.columns as Record<string, unknown>[];
    expect(columns.length, '基线必须已分列').toBeGreaterThan(0);
    auditShape(columns[0], 'Column', 'payload.columns[0]');
  });

  test('候选几何：扫描出的 LineCandidate 覆盖其必填字段', async ({ page }) => {
    // 走真实用户路径（步骤 4 的扫描按钮），而不是直接戳后端
    await gotoStage(page, 4);
    await page.click('#btn-detect-candidates');

    await expect
      .poll(
        async () => ((await diagramData<{ line_candidates: unknown[] }>(page)).line_candidates ?? []).length,
        { message: '扫描后应产生线候选几何', timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    const data = await diagramData<{ line_candidates: Record<string, unknown>[] }>(page);
    auditShape(data.line_candidates[0], 'LineCandidate', 'payload.line_candidates[0]');
  });

  test('零状态：键集与加载态完全一致（遗留缺陷 ① 的回归钉子）', async ({ page }) => {
    const loaded = await diagramData<Record<string, unknown>>(page);
    const loadedKeys = Object.keys(loaded).sort();

    // 清空图像 → 走 get_diagram_data 的零状态分支
    await rpc(page, 'project.new', { clear_image: true });
    const zero = await diagramData<Record<string, unknown>>(page);
    const zeroKeys = Object.keys(zero).sort();

    const onlyLoaded = loadedKeys.filter((k) => !zeroKeys.includes(k));
    const onlyZero = zeroKeys.filter((k) => !loadedKeys.includes(k));
    expect(
      { onlyLoaded, onlyZero },
      '两个 return 分支的键集必须一致——各写各的键正是遗留缺陷 ① 的病根'
    ).toEqual({ onlyLoaded: [], onlyZero: [] });

    // 零状态同样要满足 TS 契约（缺陷 ① 就是零状态少返 5 个清理键）
    auditShape(zero, 'DiagramData', 'straditize.getDiagramData 零状态');
  });

  test('已知别名表不得过期：后端若已直发同名字段，必须删掉表项', async ({ page }) => {
    const data = await diagramData<Record<string, unknown>>(page);
    const stale = Object.keys(KNOWN_WIRE_ALIASES).filter((k) => k in data);
    expect(
      stale,
      `这些字段后端已经直接发送同名键，请从 KNOWN_WIRE_ALIASES 删除：${JSON.stringify(stale)}`
    ).toEqual([]);
  });

  test('设计豁免表不得过期：字段一旦真的出现，必须删掉豁免', async ({ page }) => {
    const data = await diagramData<Record<string, unknown>>(page);
    const rois = data.rois as Record<string, unknown>[];
    expect(rois.length, '基线必须有 ROI').toBeGreaterThan(0);

    // 豁免只对 rois[] 元素成立；若哪天后端给它们补了坐标别名，就该删掉豁免
    const stale = Object.entries(NOT_SENT_BY_DESIGN)
      .filter(([key]) => {
        const [iface, field] = key.split('.');
        return iface === 'DataRoi' && field in rois[0];
      })
      .map(([key]) => key);
    expect(
      stale,
      `这些字段已经在真实 payload 里出现，请从 NOT_SENT_BY_DESIGN 删除：${JSON.stringify(stale)}`
    ).toEqual([]);
  });
});
