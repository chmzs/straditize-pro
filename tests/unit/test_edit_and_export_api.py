# -*- coding: utf-8 -*-
"""编辑类与导出类公开 API 的契约测试。

这批方法此前零覆盖（全库 111 个公开 API 无测试），其中 `column_remove` /
`column_update` / `point_*` 的类型标注写着 `col_index: int | str`，
但实现直接 `int(col_index)` —— 真实列 id 形如 ``roi_1_col01``，`int()` 会抛
ValueError，被 dispatcher 兜成 -32603 内部错误而不是干净的 -32602 参数错误。

本文件按「标注即契约」断言：传 int 要能用，传列 id 也要能用。
"""
from __future__ import annotations

import unittest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession


def _make_session() -> StraditizeSession:
    s = StraditizeSession()
    s.load_image(sample_key="hoya")
    # load_image 会自动建一个建议取数区；这里清掉并按 Hoya 实测边界重建
    s._init_rois()
    s.roi_create(name="pollen", x0=315, x1=1946, y0=511, y1=1311, composition=True)
    s.detect_columns([315, 1946], [511, 1311])
    return s


class TestColumnEditAcceptsIndexOrId(unittest.TestCase):
    """`int | str` 是写在签名上的承诺，int 与列 id 都必须可用。"""

    def setUp(self) -> None:
        self.session = _make_session()
        assert self.session.columns, "detect_columns 应产出列"
        self.col = self.session.columns[0]
        self.idx = int(self.col["col_index"])
        self.col_id = self.col["id"]

    def test_column_update_by_index_renames(self) -> None:
        res = self.session.column_update(self.idx, {"name": "RenamedByIndex"})
        self.assertTrue(res["success"])
        self.assertEqual(self.session.columns[self.idx]["name"], "RenamedByIndex")

    def test_column_update_by_id_renames(self) -> None:
        """传列 id 也必须成功——签名声明 `int | str`。"""
        self.assertNotEqual(self.col_id, str(self.idx), "前提：列 id 不是纯数字")
        res = self.session.column_update(self.col_id, {"name": "RenamedById"})
        self.assertTrue(res["success"])
        self.assertEqual(self.session.columns[self.idx]["name"], "RenamedById")

    def test_column_update_unknown_id_is_clean_rpc_error(self) -> None:
        """未知列要抛 JsonRpcError(-32602)，不能漏成 ValueError/-32603。"""
        with self.assertRaises(JsonRpcError) as ctx:
            self.session.column_update("no_such_column", {"name": "x"})
        self.assertEqual(ctx.exception.code, -32602)

    def test_column_remove_by_index(self) -> None:
        n = len(self.session.columns)
        self.session.column_remove(self.idx)
        self.assertEqual(len(self.session.columns), n - 1)

    def test_column_remove_by_id(self) -> None:
        n = len(self.session.columns)
        self.session.column_remove(self.col_id)
        self.assertEqual(len(self.session.columns), n - 1)

    def test_point_add_move_remove_roundtrip_by_id(self) -> None:
        """控制点三件套按列 id 走一遍完整往返。

        控制点结构是 ``{y: x}``——y 是行（深度）固定，x 是该行的取值；
        因此 ``point_move(col, y, new_x)`` 改的是 x，键保持不变。
        """
        s = self.session
        add = s.point_add(self.col_id, 700.0, 420.0, "peak")
        self.assertTrue(add["success"])
        self.assertEqual(s.control_points[self.idx][700], 420.0)

        s.point_move(self.col_id, 700.0, 999.0)
        self.assertEqual(s.control_points[self.idx][700], 999.0, "point_move 应改 x")
        self.assertIn(700, s.control_points[self.idx], "y 键必须保持不变")

        s.point_remove(self.col_id, 700.0)
        self.assertNotIn(700, s.control_points[self.idx], "point_remove 应删掉控制点")
        self.assertEqual(s.control_points[self.idx], {})

    def test_point_move_unknown_column_is_clean_rpc_error(self) -> None:
        with self.assertRaises(JsonRpcError) as ctx:
            self.session.point_add("no_such_column", 700.0, 420.0)
        self.assertEqual(ctx.exception.code, -32602)


class TestExportReadinessAndOutputs(unittest.TestCase):
    """导出三件套零覆盖补齐：就绪清单、CSV、TAR。"""

    def setUp(self) -> None:
        self.session = _make_session()

    def test_get_export_readiness_ready_when_named_and_has_columns(self) -> None:
        """规则一（见 get_export_readiness docstring）：用户命名 + 有列 -> 就绪。"""
        r = self.session.get_export_readiness()
        self.assertIn("sheets", r)
        self.assertIn("readiness_missing", r)
        self.assertEqual(r["primary_roi"], "pollen")
        self.assertEqual(r["readiness_missing"], [])
        self.assertTrue(r["ready"])

    def test_get_export_readiness_flags_default_named_roi(self) -> None:
        """规则二：name_source 仍是 default 的 ROI 必须被拦在就绪清单外。"""
        s = StraditizeSession()
        s.load_image(sample_key="hoya")
        s._init_rois()
        # 不传 name -> 由 roi_create 自动生成 roi_1，name_source 应为 default
        created = s.roi_create(x0=315, x1=1946, y0=511, y1=1311)["roi"]
        self.assertEqual(created["name_source"], "default")

        r = s.get_export_readiness()
        self.assertIn(created["name"], r["readiness_missing"],
                      "默认命名的 ROI 必须出现在 readiness_missing")
        self.assertFalse(r["ready"])

    def test_export_csv_header_matches_columns(self) -> None:
        csv_text = self.session.export_csv()
        header = csv_text.splitlines()[0].split(",")
        self.assertEqual(header[0], "depth", "CSV 首列必须是深度")
        self.assertEqual(len(header), len(self.session.columns) + 1,
                         "表头列数 = 深度 + 分列数")

    def test_export_tar_roundtrips_through_base64(self) -> None:
        """export.tar 走 base64；解码后必须是可解析的 UStar 包。"""
        import base64
        import io
        import tarfile

        res = self.session.export_tar()
        self.assertTrue(res["success"])
        raw = base64.b64decode(res["tar_base64"])
        with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
            names = tf.getnames()
        self.assertIn("manifest.json", names)
        self.assertIn("data.csv", names)


class TestRoiListShape(unittest.TestCase):
    def test_roi_list_returns_records_with_id_and_bounds(self) -> None:
        res = _make_session().roi_list()
        self.assertEqual(len(res["rois"]), 1)
        roi = res["rois"][0]
        for key in ("id", "name", "xlim", "ylim"):
            self.assertIn(key, roi, f"roi 记录缺字段 {key}")
        self.assertEqual(roi["xlim"], [315.0, 1946.0])
        self.assertEqual(roi["ylim"], [511.0, 1311.0])


if __name__ == "__main__":
    unittest.main()
