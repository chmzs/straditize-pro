/**
 * 步骤 → 画布可见层的端到端断言。
 *
 * ## 为什么必须在 e2e 层再测一遍
 *
 * `frontend/test-workflow-stage.mjs` 已经单元测过映射本身，但它测的是**纯函数**
 * （`visibleLayers`）；本文件测的是**接线**：`GeologyCanvas` 是否真的按那些谓词
 * 绘制、`gotoStage` 是否真的走到了对应 stage。两者都过了，才能说"用户走到这一步
 * 确实看得见/看不见"。
 *
 * 断言全部经由 `window.__straditize.getState()` 读权威状态，**不从 DOM 文本反推**
 * ——本轮曾因此在 S5/S3 之间来回误判。
 *
 * 这里读的是 `renderedLayers`（最近一帧的真实绘制调用记录）而非 `eligibleLayers`
 * （阶段能力）。两者都会返回，但只有前者能证明"真的画了"。且 `getState()` 内部
 * 会先 `canvasComponent.render()` 再取记录，所以不存在"读到上一帧"的竞态。
 *
 * 对应的真实用户反馈：
 *   - 「为什么分列就直接描列图形轮廓了？」→ 步骤 5 不得出现花粉曲线
 *   - 「应该在我点两点就即时出现，而不是点确定应用后才出现」→ 步骤 3 必须能画 Y 标记
 */
import { expect, test } from './fixtures';
import { clickCanvas, getState, gotoStage, resetBaseline, rpc, waitForDiagram } from './helpers';

interface StageState {
  stage: number;
  rois: { id: string; name: string; xlim: number[]; ylim: number[] }[];
  activeRoiId: string | null;
  yCalibMarks: { x: number; y: number }[];
  eligibleLayers: string[];
  renderedLayers: string[];
}

/**
 * 各步骤应有的**管线层**集合（实测值，基线为 hasImage + columnCount>0 + 未标定）。
 *
 * ## 为什么不是从 `visibleLayers` 推导
 *
 * `renderedLayers`（`GeologyCanvas.getLastRenderedLayers()`，写入点在
 * `GeologyCanvas.ts:2034-2124`）是两套名字的**并集**：
 *
 *   ① 管线层：`background` / `depthGrid` / `roi` / `yCalibMarks` / `lineFix` /
 *      `columnBoundaries` / `pollenCurves` / `anchors` / `ghosting` /
 *      `geometryCreatePreview` / `measureRuler`；
 *   ② 叠加层 id：`roi-indicator` / `cleanup-lines-and-exclusions` /
 *      `xticks-ruler-overlay` / `sample-horizons-overlay` —— 这些由
 *      `getAllOverlays()` 每帧**无条件**全部绘制（`GeologyCanvas.ts:2115-2124`），
 *      不编码任何阶段语义，属恒定噪音，故本表只比对 ①。
 *
 * 另外 `depthGrid` / `yCalibMarks` 只在绘制函数**返回真**时才计入
 * （`:2059`、`:2071`），即受运行态（是否已标定 / 是否已有标记）影响，
 * 而不是纯阶段函数。基线未标定，故步骤 3/6 不出现 `depthGrid`。
 *
 * 上一版从 `visibleLayers` 的谓词直接推集合，结果步骤 3 期望里多算了
 * `yCalibMarks`/`depthGrid` 两项——这正是本表改成实测值的原因。
 */
const PIPELINE_LAYERS = new Set([
  'background',
  'depthGrid',
  'roi',
  'yCalibMarks',
  'lineFix',
  'columnBoundaries',
  'pollenCurves',
  'anchors',
  'ghosting',
  'geometryCreatePreview',
  'measureRuler',
]);

/** 每帧都必然绘制的叠加层 id；任何一个缺失都说明它 draw() 抛了异常。 */
const OVERLAY_IDS = [
  'roi-indicator',
  'cleanup-lines-and-exclusions',
  'xticks-ruler-overlay',
  'sample-horizons-overlay',
];

const EXPECTED_PIPELINE: Record<number, string[]> = {
  1: ['background'],
  2: ['background', 'roi'],
  3: ['background', 'roi', 'columnBoundaries'],
  4: ['background', 'roi', 'columnBoundaries'],
  5: ['background', 'roi', 'columnBoundaries'],
  6: ['background', 'roi', 'columnBoundaries'],
  // 步骤 7 才出现花粉轮廓 + 控制锚点 + 质检比对层
  7: ['background', 'roi', 'columnBoundaries', 'pollenCurves', 'anchors', 'ghosting'],
};

/** 只保留管线层，滤掉恒定存在的叠加层噪音 */
function pipelineOf(renderedLayers: string[]): string[] {
  return renderedLayers.filter((l) => PIPELINE_LAYERS.has(l));
}

test.describe('步骤 → 画布可见层', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    await waitForDiagram(page);
  });

  test('步骤 3：两次真实画布点击立刻画出两个 Y 标记', async ({ page }) => {
    await gotoStage(page, 3);

    const before = await getState<StageState>(page);
    expect(before.yCalibMarks.length, '进入步骤 3 时还不该有 Y 标记').toBe(0);

    // 用户反馈：点完两点要**立刻**看得见，而不是点"确定应用"之后
    await clickCanvas(page, 0.4, 0.35);
    await clickCanvas(page, 0.4, 0.55);

    await expect
      .poll(async () => (await getState<StageState>(page)).yCalibMarks.length, {
        message: '两次真实点击后应有两个 Y 标记',
        timeout: 15_000,
      })
      .toBe(2);

    const state = await getState<StageState>(page);
    // 只有真的画了，这个标记才算"用户看得见"
    expect(state.renderedLayers, '步骤 3 有标记时必须真的绘制 Y 标记层').toContain('yCalibMarks');
    for (const m of state.yCalibMarks) {
      expect(typeof m.x, 'Y 标记应有真实 x 坐标').toBe('number');
      expect(typeof m.y, 'Y 标记应有真实 y 坐标').toBe('number');
    }
  });

  test('各步骤绘制层与实测表完全一致（含步骤 5 不描花粉曲线、4/5 不画网格）', async ({
    page,
  }) => {
    for (const [step, expected] of Object.entries(EXPECTED_PIPELINE)) {
      await gotoStage(page, Number(step));
      const state = await getState<StageState>(page);
      expect(state.stage, `应停在步骤 ${step}`).toBe(Number(step));

      // 用户反馈：「为什么分列就直接描列图形轮廓了？」→ 步骤 7 之前不得出现花粉曲线
      if (Number(step) < 7) {
        expect(state.renderedLayers, `步骤 ${step} 不应出现花粉曲线`).not.toContain('pollenCurves');
        expect(state.renderedLayers, `步骤 ${step} 不应出现控制锚点`).not.toContain('anchors');
        expect(state.renderedLayers, `步骤 ${step} 不应出现质检比对层`).not.toContain('ghosting');
      }
      // 清理 / 分列阶段必须显式禁止深度网格，避免网格干扰去线和分列
      if (Number(step) === 4 || Number(step) === 5) {
        expect(state.renderedLayers, `步骤 ${step} 不应绘制深度网格`).not.toContain('depthGrid');
      }

      expect(pipelineOf(state.renderedLayers), `步骤 ${step} 的实际绘制层`).toEqual(expected);

      // 叠加层每帧都应绘制成功。`:2118-2123` 里 draw() 抛异常会被 catch 并记入
      // overlayErrors，**且该 id 不会加入 renderedLayers** —— 也就是说一个静默
      // 崩溃的叠加层在画布上表现为"什么都没有"，在这里表现为"id 消失"。
      // 源码注释称之为"极难排查"，所以这里逐个钉住。
      for (const id of OVERLAY_IDS) {
        expect(state.renderedLayers, `步骤 ${step}：叠加层 ${id} 未完成绘制（可能抛了异常）`)
          .toContain(id);
      }
    }

    // 步骤 7 必须能看到曲线与锚点——否则没法编辑
    await gotoStage(page, 7);
    const final = await getState<StageState>(page);
    expect(final.renderedLayers, '步骤 7 缺花粉曲线').toContain('pollenCurves');
    expect(final.renderedLayers, '步骤 7 缺控制锚点').toContain('anchors');
  });

  test('前端 ROI 镜像与后端权威值一致，且 activeRoiId 落在该集合内', async ({ page }) => {
    for (const step of [3, 5, 7]) {
      await gotoStage(page, step);
      const fe = await getState<StageState>(page);
      const backend = await rpc<{
        rois: { id: string; xlim: number[]; ylim: number[] }[];
        activeRoiId: string | null;
      }>(page, 'straditize.getDiagramData');

      const project = (rs: { id: string; xlim: number[]; ylim: number[] }[]) =>
        rs.map((r) => ({ id: r.id, xlim: r.xlim, ylim: r.ylim }));

      expect(fe.rois, `步骤 ${step}：前端 rois 为空`).not.toHaveLength(0);
      // 「分列用的不是用户拖出来的范围」这个缺陷，正是镜像停在旧值造成的
      expect(project(fe.rois), `步骤 ${step}：前端 ROI 镜像 != 后端权威`).toEqual(
        project(backend.rois)
      );

      // 旧套件这里写的是 `backend.active_roi_id || backend.primary_roi_id`（snake_case），
      // 而 getDiagramData 实际发的是 camelCase `activeRoiId` → 两边都是 undefined
      // → 恒为 null → 下面这段守卫永远不执行（一条打不出来的断言）。
      // 这里改用真实键名；契约债见 contract.spec.ts 的 KNOWN_WIRE_ALIASES。
      expect(backend.activeRoiId, `步骤 ${step}：后端应有活动 ROI`).toBeTruthy();
      expect(
        fe.rois.map((r) => r.id),
        `步骤 ${step}：后端 activeRoiId 不在前端 ROI 集合中`
      ).toContain(backend.activeRoiId);
      expect(fe.activeRoiId, `步骤 ${step}：前端镜像的活动 ROI 应与后端一致`).toBe(
        backend.activeRoiId
      );
    }
  });
});
