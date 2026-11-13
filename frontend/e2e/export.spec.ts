/**
 * 顶栏导出按钮 / 导出就绪清单 / .tar 归档不变式 —— 迁移自旧 tests/e2e/test_export.py。
 *
 * 旧测试直接改 `session.rois` / `session.columns` / `session.column_points` 来摆出
 * 三个 ROI，并断言前端面板上的四个属性。其中三个属性（sheets / primary / missing）
 * 确实由后端数据推出来，值得保留；但 **`data-data-csv-equals-primary` 是前端写死的
 * 常量**（ExportReadinessPanel.ts:41 与 :56 都是字面量 `true`，连 :69 的文案
 * "DATA_CSV_EQUALS_PRIMARY=true" 也是写死的），断言它等于 true 不含任何信息。
 *
 * **2026-11-06 已修**：那个属性连同 `ExportReadinessState.dataCsvEqualsPrimary` 与
 * 文案 "DATA_CSV_EQUALS_PRIMARY=true" 一起删除了（它无法被证伪，属 §9 的「字段硬编码」），
 * 并在本文件末尾加了一条反向钉子——属性与文案都不得再出现，防止有人重新挂个假指标。
 *
 * 因此这里把"data.csv 必须等于主 ROI 的数据"这条真正的不变式下沉到 .tar 归档里去验证：
 * 解包 tar，比较 `data.csv` 与 `data/<主 ROI 名>.csv` 的字节，并**切换主 ROI 再导出一次**，
 * 证明 data.csv 跟的是 primary_roi_id 而不是 ROI 的创建顺序。
 *
 * 另外，旧测试用 `r3["name_source"] = "default"` 手工把"用户命名过的 concentration"
 * 改成默认态 —— 这是 API 造不出来的假状态。RPC 面里也没有能写 name_source 的入口
 * （roi.update 不接受该字段），所以改成创建一个**真的没传 name 的 ROI**：它天然就是
 * name_source='default'，并且照样给它分一列，这样 readiness_missing 命中它的原因
 * 唯一地是"名字还是默认名"，而不会与"没有属种列"这条规则混淆。
 */
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from './fixtures';
import {
  diagramData,
  openApp,
  resetBaseline,
  rpc,
} from './helpers';

const ROW_TOP = 100;
const ROW_BOTTOM = 475;

interface Roi {
  id: string;
  name: string;
  name_source: string;
  xlim: number[];
  ylim: number[];
}

interface Readiness {
  sheets: string[];
  primary_roi: string;
  primary_roi_id: string;
  readiness_missing: string[];
  total_rois: number;
  ready: boolean;
}

/**
 * 极简 POSIX UStar 读取器。
 *
 * 不能引第三方 tar 包：`frontend/node_modules` 里没有 tar，而唯一现成的
 * `src/core/TarArchive.ts` 没有挂到 window 上，测试拿不到。归档由 Python
 * `tarfile.open(mode="w")` 生成（PAX 格式，但短 ASCII 名/小数值不会写扩展头），
 * 所以按 512 字节块顺序读头即可；'x'/'g'（PAX 扩展头）分支仍保留，避免将来
 * ROI 名超长时整体解析错位。
 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // 两个全零块 = 归档结束
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (Number.isNaN(size)) {
      throw new Error(`tar 头解析失败：偏移 ${offset} 处 size 字段为 ${JSON.stringify(sizeText)}`);
    }
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g') {
      entries.set(name, buf.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test.describe('导出就绪清单与 .tar 归档', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  /** 造出 pollen（有列）/ charcoal（有列）/ 无名 ROI（有列但名字仍是默认名）三个 ROI。 */
  async function stageThreeRois(
    page: Page
  ): Promise<{ pollen: Roi; charcoal: Roi; unnamed: Roi }> {
    // 基线的 roi_1 是 detect_columns 的产物，先逐条删干净（roi.remove 会级联删列）。
    const { rois } = await rpc<{ rois: Roi[] }>(page, 'roi.list');
    for (const roi of rois) {
      // 该 ROI 下有列，删除会级联删列且不可撤销，后端要求显式确认（-32002 = 未确认）。
      // 这里是测试跟随新契约，不是放宽断言：级联结果仍由后续断言正面检查。
      await rpc(page, 'roi.remove', { roi_id: roi.id, confirm_drop_columns: true });
    }

    const pollen = (
      await rpc<{ roi: Roi }>(page, 'roi.create', {
        name: 'pollen',
        x0: 0,
        x1: 600,
        y0: ROW_TOP,
        y1: ROW_BOTTOM,
        composition: true,
      })
    ).roi;
    const charcoal = (
      await rpc<{ roi: Roi }>(page, 'roi.create', {
        name: 'charcoal',
        x0: 600,
        x1: 1200,
        y0: ROW_TOP,
        y1: ROW_BOTTOM,
        composition: false,
      })
    ).roi;
    // 不传 name：后端按 roi_<n> 生成默认名，name_source 必为 'default'。
    const unnamed = (
      await rpc<{ roi: Roi }>(page, 'roi.create', {
        x0: 1200,
        x1: 1800,
        y0: ROW_TOP,
        y1: ROW_BOTTOM,
        composition: false,
      })
    ).roi;

    expect(pollen.name_source, '显式命名的 ROI 必须是 user 命名').toBe('user');
    expect(charcoal.name_source).toBe('user');
    expect(unnamed.name_source, '没传 name 的 ROI 必须落到默认命名').toBe('default');

    // column.add 不接收 roi_id（就地丢弃），归属只能靠 column.update 写进去。
    const columns: [Roi, string, number, number][] = [
      [pollen, 'Pinus', 100, 200],
      [charcoal, 'MicroCharcoal', 700, 800],
      [unnamed, 'NAP', 1300, 1400],
    ];
    // 各列放置在其对应 ROI 跨度内，避免跨 ROI 边界越界校验报错。
    for (const [, name, startX, endX] of columns) {
      await rpc(page, 'column.add', { column: { name, startX, endX } });
    }
    for (let i = 0; i < columns.length; i++) {
      await rpc(page, 'column.update', {
        col_index: i,
        updates: {
          roi_id: columns[i][0].id,
          scale_type: 'linear',
          startValue: 0,
          tickValue: 100,
        },
      });
    }

    await rpc(page, 'samples.set', {
      samples: [
        { row_px: ROW_TOP, depth: 10.0, source: 'manual' },
        { row_px: ROW_BOTTOM, depth: 20.0, source: 'manual' },
      ],
    });

    // 导出前置：未完成步骤 3 的 Y 轴两点标定时，`export.tar` 会被 -32003 拒绝
    // （「导出需要深度标定」），归档根本拿不到。本用例要比对归档内部字节，必须标定。
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { px: 450, val: 0 },
        { px: 1350, val: 40 },
      ],
    });

    return { pollen, charcoal, unnamed };
  }

  async function exportTar(page: Page): Promise<Map<string, Buffer>> {
    const res = await rpc<{ tar_base64: string; size: number; success: boolean }>(
      page,
      'export.tar',
      {}
    );
    const bytes = Buffer.from(res.tar_base64, 'base64');
    expect(bytes.length, 'base64 解出的字节数必须与后端报的 size 一致').toBe(res.size);
    return untarArchive(bytes);
  }

  test('data.csv 严格跟随主 ROI（切换主 ROI 后内容随之改变），就绪清单与面板显示一致', async ({
    page,
  }) => {
    const { pollen, charcoal, unnamed } = await stageThreeRois(page);

    // 主 ROI 切换本身也要真的生效：先切到 charcoal，再切回 pollen。
    await rpc(page, 'roi.setPrimary', { roi_id: charcoal.id });
    expect(
      (await diagramData<{ primaryRoiId: string }>(page)).primaryRoiId,
      'roi.setPrimary 必须真的改主 ROI'
    ).toBe(charcoal.id);
    await rpc(page, 'roi.setPrimary', { roi_id: pollen.id });

    const expectedSheets = ['pollen', 'charcoal', unnamed.name];
    const readiness = await rpc<Readiness>(page, 'export.getReadiness', {});
    expect(readiness.sheets, '分表顺序 = ROI 创建顺序').toEqual(expectedSheets);
    expect(readiness.primary_roi, '主 ROI 名').toBe('pollen');
    expect(readiness.primary_roi_id).toBe(pollen.id);
    expect(readiness.total_rois).toBe(3);
    expect(
      readiness.readiness_missing,
      '只有名字仍是默认名的 ROI 未就绪（它是有属种列的，所以命中原因唯一）'
    ).toEqual([unnamed.name]);

    // ---- 归档不变式：data.csv 必须与主 ROI 的分表逐字节相同 ----
    // 归档里“未命名 ROI”的分表名**不是** ROI 名：后端按“未命名之间的序号”生成
    // `data_roi_<n>`（`straditize_core/session_parts/export.py:404-413`），与主 ROI 序列无关、因而可预测；
    // 而默认 ROI 名是 `roi_<counter>`（`roi_create` 的计数器），用 `unnamed.name` 拼路径会与后端分歧。
    // 序号按 `name_source !== 'user'` 的**出现顺序**推（不硬写 1）：后端增减已命名 ROI 都不会假红。
    const archiveRois = (
      await diagramData<{ rois: Array<{ name_source?: string }> }>(page)
    ).rois;
    const unnamedRois = archiveRois.filter((r) => r.name_source !== 'user');
    const unnamedPos = unnamedRois.findIndex((r) => r.name === unnamed.name) + 1;
    expect(
      unnamedPos,
      '前置：本用例的未命名 ROI 必须能在“未命名序列”里被找到（否则下面拼的名字没意义）'
    ).toBeGreaterThan(0);
    const unnamedMember = `data_roi_${unnamedPos}`;
    const pollenPrimary = await exportTar(page);
    expect([...pollenPrimary.keys()].sort()).toEqual(
      [
        'README.txt',
        'data.csv',
        'data/charcoal.csv',
        `data/${unnamedMember}.csv`,
        'data/pollen.csv',
        'image/original.png',
        'manifest.json',
        'plot_strat.R',
      ].sort()
    );
    const dataCsv = pollenPrimary.get('data.csv');
    const pollenCsv = pollenPrimary.get('data/pollen.csv');
    const charcoalCsv = pollenPrimary.get('data/charcoal.csv');
    if (!dataCsv || !pollenCsv || !charcoalCsv) {
      throw new Error('归档缺少 data.csv / data/pollen.csv / data/charcoal.csv');
    }
    expect(dataCsv.equals(pollenCsv), '主 ROI 是 pollen 时 data.csv 必须等于 data/pollen.csv').toBe(
      true
    );
    // 反向断言让上一条不至于空转：两个 ROI 的内容确实不同（列名不同），
    // 所以"data.csv 认错了主 ROI"这种情况一定会被抓到。
    expect(pollenCsv.equals(charcoalCsv), '两个 ROI 的分表内容必须可区分').toBe(false);
    expect(dataCsv.toString('utf8').split('\n')[0], 'data.csv 首列必须是 depth').toMatch(/^depth,/);

    const manifest = JSON.parse(pollenPrimary.get('manifest.json')!.toString('utf8')) as {
      primary_roi: string;
      primary_roi_id: string;
      rois: string[];
    };
    expect(manifest.primary_roi).toBe('pollen');
    expect(manifest.primary_roi_id).toBe(pollen.id);
    expect(manifest.rois, 'manifest 里的 ROI 层级必须与后端一致').toEqual(expectedSheets);

    // 换主 ROI 再导一次：data.csv 必须跟着换。这正是把前端那条写死的
    // data-data-csv-equals-primary 换成真断言的意义所在。
    await rpc(page, 'roi.setPrimary', { roi_id: charcoal.id });
    const charcoalPrimary = await exportTar(page);
    const dataCsv2 = charcoalPrimary.get('data.csv');
    const pollenCsv2 = charcoalPrimary.get('data/pollen.csv');
    const charcoalCsv2 = charcoalPrimary.get('data/charcoal.csv');
    if (!dataCsv2 || !pollenCsv2 || !charcoalCsv2) {
      throw new Error('第二次归档缺少 data.csv / data/pollen.csv / data/charcoal.csv');
    }
    expect(dataCsv2.equals(charcoalCsv2), '主 ROI 换成 charcoal 后 data.csv 必须跟着换').toBe(true);
    expect(dataCsv2.equals(pollenCsv2)).toBe(false);

    // ---- 前端面板：必须把后端就绪状态如实显示出来 ----
    // 上面为了验证 data.csv 跟随主 ROI 把主区切成了 charcoal，这里先切回 pollen，
    // 否则下面断言的就是 charcoal —— 那是测试自己造成的偏差，不是产品行为。
    await rpc(page, 'roi.setPrimary', { roi_id: pollen.id });
    await page.reload();
    await openApp(page);
    await page.locator('#btn-export-csv').click();

    await expect(page.locator('.wpd-export-dialog')).toBeVisible();
    const readinessBox = page.locator('#export-readiness-container');
    await expect(readinessBox).toBeVisible();
    await expect(readinessBox).toHaveAttribute('data-sheets', expectedSheets.join(','));
    await expect(readinessBox).toHaveAttribute('data-primary', 'pollen');
    await expect(readinessBox).toHaveAttribute('data-readiness-missing', unnamed.name);

    // §9「就绪清单字段硬编码」的回归钉子：面板**不得**再输出一个恒定真值。
    // `data-data-csv-equals-primary` 曾与 data-sheets/data-primary 并列写死成字面量
    // `"true"`，断言它等于没断言——真实不变式（data.csv 逐字节等于主 ROI 分表）
    // 已在上面的 tar 段落里验证过，这里守的是「别再挂一个假指标」。
    expect(
      await readinessBox.getAttribute('data-data-csv-equals-primary'),
      '面板不得再输出 data-data-csv-equals-primary：它是前端常量，无法被证伪'
    ).toBeNull();
    expect(
      await page.locator('#lbl-export-data-csv-primary').count(),
      '文案也不得再声称 DATA_CSV_EQUALS_PRIMARY=true'
    ).toBe(0);
  });
});
