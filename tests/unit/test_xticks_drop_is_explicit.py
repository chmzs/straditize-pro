# -*- coding: utf-8 -*-
"""重新分列丢标定**不得静默**的回归钉子（B-02）。

## 缺陷本体

`detect_columns(preserve_state=True)` 里有个区间守卫：旧列的 `x_ticks` 两个刻度
像素必须落在新列边界 `[start-10, end+10]` 内，否则**静默丢弃**。用户标定凭空消失、
面板回到 `0/N`，没有任何提示——`detect_columns` 的返回值也没变
（仍是 `list[dict]`，被 `RpcClient.detectColumnsInRoi` 按数组消费，
所以**不能**改成 `{"columns": ..., "dropped": ...}`，那会让前端整步崩在
`Array.isArray(res)` 上）。

## 修法：把丢失记录挂在**列**上

`col["x_ticks_dropped"] = {"reason": ..., "px": (.., ..), "band": (.., ..)}`。
顶层返回形状一分不改；`straditize.getDiagramData` 逐字段白名单里加了透传，
面板才能读到。值里的 `px`/`band` 是 **tuple**：

- 撤销栈的列快照是 `[dict(c) for c in self.columns]`（浅拷贝），嵌套 list/dict
  会被快照与活动列共享引用 —— 撤销后出现"键在、内容却是后来的值"；
- tuple 序列化成 JSON 数组，前端读到的仍是 `number[]`。

## 两个分支都要钉

- `preserve_state=True`（列数不变）→ `reason="out_of_band"`；
- `preserve_state=False`（列数变了）→ 整块回填被跳过，旧标定同样静默消失，
  `reason="column_layout_changed"`。这是同一缺陷的另一半：实测 hoya 左边界右移
  120px 时 28→27 列、标定 1→0、无提示。只钉第一个分支会漏掉它。

## 三条清除时机必须都钉

不写清除就是**永久假警报**：用户重新标定完，面板还在喊"标定已清空"。
"""
from __future__ import annotations

import json

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _calibrated_hoya_session() -> tuple[StraditizeSession, str]:
    """hoya 会话：分列后标定第一列，返回 (session, roi_id)。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    roi_id = session.rois[0]["id"]
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=roi_id)
    first = session.columns[0]
    band_start, band_end = int(first["start"]), int(first["end"])
    session.calibrate_column_xticks(
        0,
        ticks=[
            {"px": band_start + 20, "value": 0.0},
            {"px": band_end - 20, "value": 100.0},
        ],
        unit="%",
    )
    assert session.columns[0].get("x_ticks"), "前置：第一列应已标定"
    return session, roi_id


def _flagged_columns(session: StraditizeSession) -> list[dict]:
    return [col for col in session.columns if col.get("x_ticks_dropped")]


class TestOutOfBandDropIsExplicit:
    """列数不变、刻度越界：不得静默。"""

    def test_out_of_band_drop_is_reported_on_the_column(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        old_tick_px = [tick["px"] for tick in session.columns[0]["x_ticks"]]

        # 左边界右移 60px：列数仍 28，但刻度已落在新区间外。
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)

        first = session.columns[0]
        assert first.get("x_ticks") is None, "前置：这一分支应当丢弃标定"
        dropped = first.get("x_ticks_dropped")
        assert dropped is not None, (
            "刻度越界后标定被清空却没有任何记录 —— 用户只看到面板回到 0/N（B-02）"
        )
        assert dropped["reason"] == "out_of_band"
        assert list(dropped["px"]) == old_tick_px, (
            "丢弃记录必须带上**丢了哪两个像素**，否则用户无从判断要不要重标"
        )
        band_low, band_high = dropped["band"]
        assert band_low < band_high
        assert any(not (band_low <= px <= band_high) for px in old_tick_px), (
            "band 应与越界的刻度自洽：至少一个刻度落在 band 之外"
        )

    def test_column_layout_change_drop_is_reported_too(self) -> None:
        """列数变化分支（preserve_state=False）同样不得静默。"""
        session, roi_id = _calibrated_hoya_session()
        column_count_before = len(session.columns)

        # 左边界右移 120px：实测 28→27 列，preserve_state 为 False。
        session.detect_columns([435, 1946], HOYA_Y, roi_id=roi_id)

        assert len(session.columns) != column_count_before, "前置：这一分支应改变列数"
        flagged = _flagged_columns(session)
        assert flagged, (
            "列数变化时旧标定被整块跳过、静默消失（B-02 的另一半）"
        )
        assert flagged[0]["x_ticks_dropped"]["reason"] == "column_layout_changed", (
            "两个分支的 reason 必须可区分：用户要做的动作不同"
            "（越界=同一列重标；列数变化=列本身已不同）"
        )

    def test_kept_calibration_carries_no_flag(self) -> None:
        """反方向：守卫通过时必须**没有**任何提示，别把正常回填也标成异常。"""
        session, roi_id = _calibrated_hoya_session()
        tiny_shift = [HOYA_X[0] + 4, HOYA_X[1]]
        session.detect_columns(tiny_shift, HOYA_Y, roi_id=roi_id)

        assert session.columns[0].get("x_ticks"), "前置：小幅移动不应丢标定"
        assert not _flagged_columns(session), (
            "标定被正常保留却仍带丢弃提示 —— 那是假警报"
        )


class TestDropRecordIsImmutable:
    """撤销栈浅拷贝列 dict，嵌套容器不能被共享引用。"""

    def test_drop_record_nested_values_are_tuples(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)

        dropped = session.columns[0]["x_ticks_dropped"]
        assert isinstance(dropped["px"], tuple), (
            "px 是 list 的话，撤销栈快照会与活动列共享同一个可变容器"
        )
        assert isinstance(dropped["band"], tuple)

    def test_undo_after_drop_cannot_mutate_the_live_record(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        snapshot_px = session.columns[0]["x_ticks_dropped"]["px"]

        session.history_undo()

        # 撤销把列换成了旧快照（那份有 x_ticks、没有 flag）；再重做回来，
        # 活动记录的 px 必须仍是原值，而不是被共享引用改脏。
        session.history_redo()
        live = session.columns[0].get("x_ticks_dropped")
        if live is not None:
            assert live["px"] == snapshot_px


class TestDropRecordClears:
    """三条清除时机，缺一条就是永久假警报。"""

    def test_recalibrating_clears_the_flag(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        assert _flagged_columns(session), "前置：此刻应有提示"

        band = session.columns[0]
        band_start, band_end = int(band["start"]), int(band["end"])
        session.calibrate_column_xticks(
            0,
            ticks=[
                {"px": band_start + 20, "value": 0.0},
                {"px": band_end - 20, "value": 100.0},
            ],
            unit="%",
        )

        assert not _flagged_columns(session), (
            "用户重新标定成功后提示仍挂着 —— 面板会一直喊"
            "'标定已清空'，用户以为没保存上"
        )
        assert session.columns[0]["x_ticks"]

    def test_clear_xticks_clears_the_flag(self) -> None:
        """用户主动清除标定 = 他知道现在没标定，不需要被动丢失的提示。"""
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        assert _flagged_columns(session), "前置：此刻应有提示"

        session.clear_column_xticks(0)

        assert not _flagged_columns(session), "clear_column_xticks 后提示仍在"

    def test_next_detect_columns_without_drop_clears_the_flag(self) -> None:
        """第三条：下一次分列该列**未**被丢弃时，旧提示必须消失。"""
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        assert _flagged_columns(session), "前置：此刻应有提示"

        # 再跑一次同参数分列：标定早已没了，不存在新的丢弃理由。
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)

        assert not _flagged_columns(session), (
            "重复分列后提示仍挂着 —— 那是上一轮的陈旧状态，不是本轮事实"
        )


class TestDropRecordReachesTheWire:
    """面板读的是 getDiagramData，不是 detectColumns 的返回值。"""

    def test_get_diagram_data_exposes_the_flag(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        dispatcher = create_rpc_dispatcher(session)

        response = dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "straditize.getDiagramData",
                "params": {},
            }
        )
        payload = response["result"]
        first = payload["columns"][0]

        assert first["x_ticks"] is None
        assert first.get("x_ticks_dropped") is not None, (
            "getDiagramData 没透传 x_ticks_dropped —— 前端面板永远拿不到，"
            "B-02 修了等于没修"
        )
        # 真正的线缆形态：`handle_object` 返回的是 Python 对象（tuple 还在），
        # 前端拿到的是 `handle_text` 里 `json.dumps` 之后的 JSON 数组。
        wire = json.loads(json.dumps(payload))
        assert isinstance(wire["columns"][0]["x_ticks_dropped"]["px"], list), (
            "tuple 序列化后必须是 JSON 数组，前端按 number[] 读"
        )
        # 正常列不得带噪音键值
        unflagged = [c for c in payload["columns"] if c["x_ticks_dropped"] is None]
        assert len(unflagged) == len(payload["columns"]) - 1


class TestDropRecordNotPersisted:
    """工程包列是白名单构造的——诊断信息不该被持久化。"""

    def test_project_save_does_not_persist_the_drop_record(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        assert _flagged_columns(session), "前置：此刻应有提示"

        saved = session.project_save(format="json")
        columns = saved["data"]["columns"]
        assert columns, "前置：工程包应含列"
        persisted = [c for c in columns if "x_ticks_dropped" in c]
        assert not persisted, (
            "x_ticks_dropped 进了工程包 —— 它是本次会话的诊断信息，"
            "重新载入工程后陈述的已不是当前事实"
        )
        # 但标定本身（x_ticks=None）该如实落盘
        assert columns[0]["x_ticks"] is None


class TestDetectColumnsReturnShapeUnchanged:
    """顶层返回形状是被前端按数组消费的，不能动。"""

    def test_detect_columns_still_returns_a_plain_list(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        result = session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)

        assert isinstance(result, list), (
            "detect_columns 返回值必须是 list —— RpcClient.detectColumnsInRoi "
            "用 Array.isArray(res) 判定，改成 dict 会让整步崩在 -32603"
        )
        assert result and isinstance(result[0], dict)
        assert "x_ticks_dropped" in result[0], (
            "丢弃信息也该出现在 detect_columns 的返回列里（同一份列对象）"
        )

    def test_wire_payload_is_json_serialisable(self) -> None:
        session, roi_id = _calibrated_hoya_session()
        session.detect_columns([375, 1946], HOYA_Y, roi_id=roi_id)
        dispatcher = create_rpc_dispatcher(session)
        response = dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "straditize.getDiagramData",
                "params": {},
            }
        )
        # tuple 若不慎留成 numpy 标量 / set，这里会直接抛 TypeError
        assert json.dumps(response, ensure_ascii=False)
