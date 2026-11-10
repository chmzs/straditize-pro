/**
 * T-05：「保存项目」的产物必须能被「打开项目」打开（工程包往返）。
 *
 * ## 产品决策（已拍板，不在本文件里讨论）
 *
 * 「保存项目」= 导出**工程包**（后端 `project.save` 产出的 tar，含 `straditize.json`），
 * 而不是数据包（`export.tar`，只有 manifest / 图片 / CSV / R 脚本）。
 * 「打开项目」本来就只认工程包（`ProjectManager.ts:661-667` 明确排除 `manifest.json`），
 * 所以只要「保存项目」走错出口，用户就永远打不开自己刚保存的文件。
 *
 * ## 本文件钉住的实质
 *
 * 旧实现里「保存项目」调 `export.tar`，包里**没有** `straditize.json`，
 * 于是「打开项目」弹「未在 .tar 归档中找到项目数据 JSON 文件。」，
 * 并且**一条 `project.load` 都不发** —— 用户以为存下来了，其实什么都没存。
 *
 * 因此断言分两层，缺一不可：
 *
 * 1. **产物层**：下载回来的 tar 里必须真的有 `straditize.json`（直接编码产品决策）；
 * 2. **往返层**：把这个文件喂回「打开项目」后，ROI 名 / Y 标定端点 / 列数必须回到
 *    **保存那一刻**的后端权威值。
 *
 * 只断言「不报错」是不够的：一条 `project.load` 都没发时界面同样安静，
 * 所以这里一律 `expect.poll` 读 `straditize.getDiagramData`（后端事实源），
 * 不看前端镜像、不看 DOM 文案。
 *
 * ## 为什么要故意「弄脏」标定
 *
 * 保存后如果什么都不改，`calibration` 在打开前后必然相同 —— 那条断言恒真、
 * 零判别力。所以保存后不仅改 ROI 名，还把 Y 标定重设成另一组端点，
 * 打开后必须回到**保存时**那一组：这才证明 tar 真的携带了标定段。
 *
 * 负向对照（不含 `straditize.json` 的 tar）放在单独 describe 里，因为它是
 * **故意触发用户可见报错**的用例，必须用 `test.use({ allowlists: … })` 显式声明豁免
 * （见 `fixtures.ts` 的豁免约定），不许关掉门禁。
 */
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, resetBaseline } from './helpers';

const ROI_SAVED = '往返测试A';
const ROI_DIRTY = '往返测试B';
/** 「打开项目」在缺 JSON 时的原文（`ProjectManager.ts:710`）。 */
const MISSING_JSON_NOTICE = '未在 .tar 归档中找到项目数据 JSON 文件';

const SAVED_CALIB = { topPx: 611, topVal: 7.5, botPx: 1198, botVal: 42.5, unit: 'm' };
const DIRTY_CALIB = { topPx: 700, topVal: 0, botPx: 1100, botVal: 50, unit: 'm' };

/** 后端 `straditize.getDiagramData()` 里本文件用到的字段（驼峰名，见 step2 文件头）。 */
interface WireCalibration {
  isCalibrated: boolean;
  top_px: number | null;
  top_cm: number | null;
  bottom_px: number | null;
  bottom_cm: number | null;
  unit: string | null;
}

interface WireRoi {
  id: string;
  name: string;
}

interface WireDiagram {
  rois: WireRoi[];
  columns: unknown[];
  calibration: WireCalibration;
  primaryRoiId: string | null;
}

const wire = (page: Page): Promise<WireDiagram> => diagramData<WireDiagram>(page);
const roiNames = async (page: Page): Promise<string[]> => (await wire(page)).rois.map((r) => r.name);
const backendCal = async (page: Page): Promise<WireCalibration> => (await wire(page)).calibration;

/**
 * 极简 POSIX UStar 读取器。
 *
 * 不引第三方 tar 包（`frontend/node_modules` 里没有 tar），也不复用
 * `src/core/TarArchive.ts`（未挂到 window 上，测试拿不到）。
 * 后端用 `tarfile.open(mode="w")` 打包；`straditize.json` 是非 ASCII 内容但名字是纯
 * ASCII，图片名／CSV 名也短，所以顺序读 512 字节头即可。'x'/'g'（PAX 扩展头）
 * 分支必须跳过：中文 ROI 名会让 Python 写出 UTF-8 的 pax 头。
 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
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

/**
 * 反向打包（只给负向对照用）：把给定条目写成标准 UStar 归档。
 *
 * 负向对照要的正是「一个真的 tar、但里面没有 `straditize.json`」，
 * 所以必须能自己写归档 —— 否则退化成拿 `export.tar` 去凑，就测不到
 * 「同一个包砍掉那一个成员」这个最小差异。
 */
function tarArchive(entries: Array<[string, Buffer]>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    for (let i = 148; i < 156; i++) header[i] = 32; // 校验和按"8 个空格"计算
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0)); // 两个全零块 = 归档结束
  return Buffer.concat(blocks);
}

/** 步骤 2：把活动 ROI 改名，并等到后端确认（不确认就在错的状态上继续）。 */
async function renameActiveRoi(page: Page, name: string): Promise<void> {
  await gotoStage(page, 2);
  const input = page.locator('.step-panel[data-step="2"] #inp-roi-name');
  await input.fill(name);
  await input.press('Enter');
  await expect
    .poll(() => roiNames(page), {
      message: `改名必须真的写进后端：期望 ROI 名变成 [${name}]`,
      timeout: 15_000,
    })
    .toEqual([name]);
}

/**
 * 步骤 3：填两个像素行 + 两个数值 + 单位，点一次「应用」，并等到后端确认。
 *
 * 只写 `value`、不派发任何 change：面板的 5 个框都挂了 `change → commitCalibration`，
 * 逐个 fill 会连发多次只带部分新值的请求（详见 `step3-ycalib.spec.ts` 的 `commitYCalib`）。
 * 这里直接把全部 5 个值赋进去再点一次应用，结论与请求顺序无关。
 */
async function calibrateDepth(
  page: Page,
  v: { topPx: number; topVal: number; botPx: number; botVal: number; unit: string }
): Promise<void> {
  await gotoStage(page, 3);
  const fields: Array<[string, string]> = [
    ['#ycal-inp-unit', v.unit],
    ['#ycal-inp-top-px', String(v.topPx)],
    ['#ycal-inp-bot-px', String(v.botPx)],
    ['#ycal-inp-top-val', String(v.topVal)],
    ['#ycal-inp-bot-val', String(v.botVal)],
  ];
  await page.evaluate((pairs: Array<[string, string]>) => {
    for (const [sel, value] of pairs) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少控件 ${sel}`);
      el.value = value;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  }, fields);

  await expect
    .poll(async () => (await backendCal(page)).top_px, {
      message: 'Y 标定必须落进后端（top_px）',
      timeout: 15_000,
    })
    .toBe(v.topPx);
  await expect
    .poll(async () => (await backendCal(page)).bottom_cm, {
      message: 'Y 标定必须落进后端（bottom_cm）',
      timeout: 15_000,
    })
    .toBe(v.botVal);
  await expect
    .poll(async () => (await backendCal(page)).isCalibrated, {
      message: '提交后后端 isCalibrated 必须为 true',
      timeout: 15_000,
    })
    .toBe(true);
}

/** 点顶栏「保存项目」，接住下载，落到本用例的产物目录。 */
async function saveProjectTo(page: Page, targetPath: string): Promise<void> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.locator('#btn-save-project').click(),
  ]);
  await download.saveAs(targetPath);
}

/** 点顶栏「打开项目」，用真实文件选择器选中给定文件。 */
async function openProjectFile(page: Page, filePath: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.locator('#btn-open-project').click(),
  ]);
  await chooser.setFiles(filePath);
}

test.describe('T-05 保存项目 → 打开项目 往返', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('「保存项目」必须导出工程包，且「打开项目」能把 ROI 名 / Y 标定 / 列数原样还原', async ({
    page,
    telemetry,
  }) => {
    // ---- 1. 造出「与基线不同」的可还原现场：唯一 ROI 名 + 一次真实 Y 标定 ----
    await renameActiveRoi(page, ROI_SAVED);
    await calibrateDepth(page, SAVED_CALIB);
    const beforeSave = await wire(page);
    const columnsBeforeSave = beforeSave.columns.length;
    expect(columnsBeforeSave, '基线必须有属种列，否则"列数还原"这条断言是空的').toBeGreaterThan(0);

    // ---- 2. 点「保存项目」，拿真实下载产物 ----
    const savedPath = test.info().outputPath('saved-project.tar');
    await saveProjectTo(page, savedPath);

    // ---- 3. 弄脏现场：ROI 改名 + 重新标定成另一组端点 ----
    // 不弄脏的话，下面的"还原"断言在打开前后恒等，等于没有判别力。
    await renameActiveRoi(page, ROI_DIRTY);
    await calibrateDepth(page, DIRTY_CALIB);
    expect((await backendCal(page)).top_px, '弄脏后后端必须先离开保存时的值').toBe(
      DIRTY_CALIB.topPx
    );

    // ---- 4. 点「打开项目」，选第 2 步下载的那个文件 ----
    await openProjectFile(page, savedPath);

    // ---- 5. 断言：全部读后端权威状态 ----
    await expect
      .poll(() => roiNames(page), {
        message: '打开项目包后，后端 ROI 名必须恢复为保存时的名字',
        timeout: 30_000,
      })
      .toEqual([ROI_SAVED]);

    await expect
      .poll(async () => (await backendCal(page)).isCalibrated, {
        message: '打开项目包后，后端标定必须仍是已标定状态',
        timeout: 30_000,
      })
      .toBe(true);

    const restoredCal = await backendCal(page);
    expect(
      {
        top_px: restoredCal.top_px,
        top_cm: restoredCal.top_cm,
        bottom_px: restoredCal.bottom_px,
        bottom_cm: restoredCal.bottom_cm,
        unit: restoredCal.unit,
      },
      '打开项目包后，标定端点必须逐值回到保存时的值（不是弄脏后的值）'
    ).toEqual({
      top_px: SAVED_CALIB.topPx,
      top_cm: SAVED_CALIB.topVal,
      bottom_px: SAVED_CALIB.botPx,
      bottom_cm: SAVED_CALIB.botVal,
      unit: SAVED_CALIB.unit,
    });

    expect(
      (await wire(page)).columns.length,
      '打开项目包后列数必须与保存时一致（不能半载入）'
    ).toBe(columnsBeforeSave);

    // 产物层钉子：保存的必须是**工程包**，不是数据包。
    //
    // 放在往返断言**之后**是有意的：本缺陷的用户症状是"打开项目什么都恢复不回来"，
    // 让红灯停在那一句上（期望 A / 实收 B）比停在"包里缺某个成员"更贴近用户感受。
    // 这一条留作根因钉子：它把产品决策（保存＝工程包）直接写死，
    // 任何人把出口改回 export.tar，这里都会立刻指出包里到底有什么。
    const savedEntries = untarArchive(readFileSync(savedPath));
    expect(
      [...savedEntries.keys()].some((name) => name.toLowerCase().endsWith('straditize.json')),
      `「保存项目」的 tar 里必须有 straditize.json（工程包），实际成员：${[...savedEntries.keys()].join(', ')}`
    ).toBe(true);

    // 正向成功路径上不该出现"找不到项目数据 JSON"这类提示。
    expect(
      telemetry.notices.filter((text) => text.includes(MISSING_JSON_NOTICE)),
      '成功的往返里不得出现"未在 .tar 归档中找到项目数据 JSON 文件"'
    ).toEqual([]);
  });
});

test.describe('T-05 负向对照：缺 straditize.json 的 tar 必须明确报错且后端零变化', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  // 本用例**故意**触发用户可见报错，豁免写在这里可见，不靠关掉门禁。
  test.use({ allowlists: { notice: [/未在 \.tar 归档中找到项目数据 JSON 文件/] } });

  test('不含 straditize.json 的 tar：明确报错、后端状态零变化（不静默、不半载入）', async ({
    page,
    telemetry,
  }) => {
    // 先造一个可辨识的现场，并保存一份真工程包，再把它砍成"数据包"。
    await renameActiveRoi(page, ROI_SAVED);
    await calibrateDepth(page, SAVED_CALIB);
    const savedPath = test.info().outputPath('saved-project.tar');
    await saveProjectTo(page, savedPath);

    const savedEntries = untarArchive(readFileSync(savedPath));
    const stripped = [...savedEntries.entries()].filter(
      ([name]) => !name.toLowerCase().endsWith('straditize.json')
    );
    expect(
      stripped.length,
      '砍掉 straditize.json 后的归档必须还有别的成员，否则这条对照测的是空包'
    ).toBeGreaterThan(0);
    const strippedPath = test.info().outputPath('no-project-json.tar');
    writeFileSync(strippedPath, tarArchive(stripped));

    // 打开前的后端快照（负向对照的"零变化"基准）。
    const snapshotBefore = await wire(page);
    const stateOf = (s: WireDiagram) => ({
      roiNames: s.rois.map((r) => r.name),
      columns: s.columns.length,
      primaryRoiId: s.primaryRoiId,
      calibration: {
        isCalibrated: s.calibration.isCalibrated,
        top_px: s.calibration.top_px,
        top_cm: s.calibration.top_cm,
        bottom_px: s.calibration.bottom_px,
        bottom_cm: s.calibration.bottom_cm,
        unit: s.calibration.unit,
      },
    });
    const before = stateOf(snapshotBefore);

    // 弄脏一次，证明"零变化"不是因为它本来就没变。
    await renameActiveRoi(page, ROI_DIRTY);
    const dirtied = stateOf(await wire(page));
    expect(dirtied.roiNames, '弄脏必须真的改到后端').toEqual([ROI_DIRTY]);

    await openProjectFile(page, strippedPath);

    // 必须明确报错（toast 是用户可见通道，被 fixtures 采集进 notices）。
    await expect
      .poll(() => telemetry.notices.filter((text) => text.includes(MISSING_JSON_NOTICE)).length, {
        message: '缺少 straditize.json 的 tar 必须明确告诉用户，不能静默吞掉',
        timeout: 20_000,
      })
      .toBe(1);

    // 报错之后后端必须零变化：仍是弄脏后的状态，绝不能"半载入"。
    // 提示出现时 `project.load` 一定已经决定不发（`ProjectManager.ts:684-711` 是同步分支），
    // 所以此刻读到的就是终态。
    const after = stateOf(await wire(page));
    expect(after, '负向对照：后端状态必须与打开前逐字段相同（零变化）').toEqual(dirtied);
    expect(after, '负向对照：绝不能悄悄回退成保存时的状态（那等于半载入）').not.toEqual(before);

    // 并且不得有失败的 RPC 被静默吞掉——错在客户端就该由客户端明说。
    expect(telemetry.rpcErrors, '这条路径不该产生失败的后端 RPC').toEqual([]);
  });
});
