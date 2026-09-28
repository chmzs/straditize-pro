# -*- coding: utf-8 -*-
"""步骤 → 画布可见层的端到端断言。

## 为什么必须在 e2e 层再测一遍

`frontend/test-workflow-stage.mjs` 已经单元测过映射本身，但它测的是**纯函数**；
本文件测的是**接线**：GeologyCanvas 是否真的用了那些谓词、工作流跳转是否真的
走到了对应 stage。两者都过了，才能说"用户走到这一步确实看得见/看不见"。

断言全部写成用户能复述的一句话，全部经由 window.__straditize 句柄读取权威状态
（不经 DOM 文本反推——本轮曾因此在 S5/S3 之间来回误判）。

对应的真实用户反馈：
  - 「为什么分列就直接描列图形轮廓了？」→ 步骤 5 不得出现花粉曲线
  - 「应该在我点两点就即时出现，而不是点确定应用后才出现」→ 步骤 3 必须能画 Y 标记
"""
from __future__ import annotations

import json

from tests.e2e.conftest import run_playwright_eval

# 一次加载内完成：跳步骤 → 等落定 → 读权威状态。
# run_playwright_eval 每次调用都会重开浏览器，所以必须在同一个表达式里做完。
_SNAPSHOT_JS = """
  return (async () => {
    let api;
    for (let i = 0; i < 40; i++) {
      api = window.__straditize;
      if (api) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!api) return JSON.stringify({ error: 'no-handle' });
    const out = {};
    for (const step of [3, 4, 5, 6, 7]) {
      await api.gotoStage(step);
      for (let i = 0; i < 40; i++) {
        if (api.getState().stage === step) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, 100));
      if (step === 3) {
        const canvas = document.querySelector('#geology-canvas');
        const rect = canvas?.getBoundingClientRect();
        if (!canvas || !rect) return JSON.stringify({ error: 'canvas-not-ready' });
        for (const ratio of [0.35, 0.55]) {
          const event = { bubbles: true, button: 0, clientX: rect.left + rect.width * 0.4, clientY: rect.top + rect.height * ratio };
          canvas.dispatchEvent(new MouseEvent('mousedown', event));
          canvas.dispatchEvent(new MouseEvent('mouseup', event));
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const s = api.getState();
      out[step] = {
        stage: s.stage,
        eligibleLayers: s.eligibleLayers,
        renderedLayers: s.renderedLayers,
        yCalibMarks: s.yCalibMarks,
        rois: s.rois.map((r) => ({ id: r.id, xlim: r.xlim, ylim: r.ylim })),
      };
    }
    const backend = await api.rpc('straditize.getDiagramData');
    out._backend = {
      rois: (backend.rois || []).map((r) => ({ id: r.id, xlim: r.xlim, ylim: r.ylim })),
      activeRoiId: backend.active_roi_id || backend.primary_roi_id || null,
      columns: (backend.columns || []).length,
    };
    return JSON.stringify(out);
  })();
"""


def _snapshot(url: str) -> dict:
    raw = run_playwright_eval(url, _SNAPSHOT_JS, session_name="e2e_stage_layers")
    data = json.loads(raw)
    assert "error" not in data, f"window.__straditize 句柄不可用：{data}"
    return data


def test_step5_split_does_not_draw_pollen_curves(e2e_server) -> None:
    """用户反馈：分列这一步不该已经描好花粉轮廓与锚点（拐点是步骤 7）。"""
    s = _snapshot(e2e_server["url"])["5"]
    assert s["stage"] == 5, f"应停在步骤 5，实际 {s['stage']}"
    assert "pollenCurves" not in s["renderedLayers"], f"步骤 5 出现了花粉曲线：{s['renderedLayers']}"
    assert "anchors" not in s["renderedLayers"], f"步骤 5 出现了控制锚点：{s['renderedLayers']}"
    assert "columnBoundaries" in s["renderedLayers"], f"步骤 5 应显示列边界：{s['renderedLayers']}"


def test_step7_draws_pollen_curves(e2e_server) -> None:
    """拐点与采样层位（步骤 7）必须能看到曲线与锚点——否则没法编辑。"""
    s = _snapshot(e2e_server["url"])["7"]
    assert s["stage"] == 7, f"应停在步骤 7，实际 {s['stage']}"
    assert "pollenCurves" in s["renderedLayers"], f"步骤 7 缺花粉曲线：{s['renderedLayers']}"
    assert "anchors" in s["renderedLayers"], f"步骤 7 缺控制锚点：{s['renderedLayers']}"


def test_step3_can_show_y_marks_and_step45_hide_grid(e2e_server) -> None:
    """设计稿 §1.1：标定后深度标尺即可绘制；4 清理 / 5 分列 不画网格（会抹黑图谱）。"""
    snap = _snapshot(e2e_server["url"])

    # 用户反馈：点完两点要立刻看得见 → Y 标记层从步骤 3 起必须在
    assert len(snap["3"]["yCalibMarks"]) == 2, (
        f"步骤 3 两次真实画布点击后应有两个 Y 标记：{snap['3']['yCalibMarks']}"
    )
    assert "yCalibMarks" in snap["3"]["renderedLayers"], (
        f"步骤 3 缺实际 Y 标记渲染：{snap['3']['renderedLayers']}"
    )

    # 清理 / 分列阶段必须显式禁止深度网格，避免网格干扰去线和分列。
    for step in ("4", "5"):
        assert "depthGrid" not in snap[step]["renderedLayers"], (
            f"步骤 {step} 不应绘制深度网格：{snap[step]['renderedLayers']}"
        )


def test_frontend_roi_mirror_matches_backend(e2e_server) -> None:
    """前端镜像 data.rois 必须与后端权威值一致。

    「分列用的不是用户拖出来的范围」这个缺陷，正是镜像停在旧值造成的；
    这里至少钉住"加载完成后两者一致"这条底线。
    """
    snap = _snapshot(e2e_server["url"])
    fe = snap["5"]["rois"]
    be = snap["_backend"]["rois"]
    assert fe, "前端 rois 为空"
    assert be, "后端 rois 为空"
    assert fe == be, f"前端 ROI 镜像 {fe} != 后端权威 {be}"
    if snap["_backend"]["activeRoiId"] is not None:
        assert snap["_backend"]["activeRoiId"] in {r.get("id") for r in fe}, (
            f"后端 active_roi_id 不在前端 ROI 集合中：{snap['_backend']['activeRoiId']}"
        )
