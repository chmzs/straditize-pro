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
    const api = window.__straditize;
    if (!api) return JSON.stringify({ error: 'no-handle' });
    const out = {};
    for (const step of [3, 4, 5, 6, 7]) {
      await api.gotoStage(step);
      for (let i = 0; i < 40; i++) {
        if (api.getState().stage === step) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const s = api.getState();
      out[step] = { stage: s.stage, layers: s.layers, roi: s.rois[0]?.xlim ?? null };
    }
    const backend = await api.rpc('straditize.getDiagramData');
    out._backend = {
      rois: (backend.rois || []).map((r) => r.xlim),
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
    assert "pollenCurves" not in s["layers"], f"步骤 5 出现了花粉曲线：{s['layers']}"
    assert "anchors" not in s["layers"], f"步骤 5 出现了控制锚点：{s['layers']}"
    assert "columnBoundaries" in s["layers"], f"步骤 5 应显示列边界：{s['layers']}"


def test_step7_draws_pollen_curves(e2e_server) -> None:
    """拐点与采样层位（步骤 7）必须能看到曲线与锚点——否则没法编辑。"""
    s = _snapshot(e2e_server["url"])["7"]
    assert s["stage"] == 7, f"应停在步骤 7，实际 {s['stage']}"
    assert "pollenCurves" in s["layers"], f"步骤 7 缺花粉曲线：{s['layers']}"
    assert "anchors" in s["layers"], f"步骤 7 缺控制锚点：{s['layers']}"


def test_step3_can_show_y_marks_and_step45_hide_grid(e2e_server) -> None:
    """设计稿 §1.1：标定后深度标尺即可绘制；4 清理 / 5 分列 不画网格（会抹黑图谱）。"""
    snap = _snapshot(e2e_server["url"])

    # 用户反馈：点完两点要立刻看得见 → Y 标记层从步骤 3 起必须在
    assert "yCalibMarks" in snap["3"]["layers"], f"步骤 3 缺 Y 标记层：{snap['3']['layers']}"

    # 设计稿：4/5 不画深度网格
    for step in ("4", "5"):
        assert "depthGrid" not in snap[step]["layers"], f"步骤 {step} 不该画深度网格"

    # 6/7 要画（标定列与采样层位都需要坐标系）
    for step in ("6", "7"):
        assert "depthGrid" in snap[step]["layers"], f"步骤 {step} 应画深度网格"


def test_frontend_roi_mirror_matches_backend(e2e_server) -> None:
    """前端镜像 data.rois 必须与后端权威值一致。

    「分列用的不是用户拖出来的范围」这个缺陷，正是镜像停在旧值造成的；
    这里至少钉住"加载完成后两者一致"这条底线。
    """
    snap = _snapshot(e2e_server["url"])
    fe, be = snap["5"]["roi"], snap["_backend"]["rois"][0]
    assert fe is not None, "前端 rois[0].xlim 为空"
    assert fe == be, f"前端镜像 {fe} != 后端权威 {be}"
