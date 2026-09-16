"""Test the straditize.widgets.data module"""
import numpy as np
import pandas as pd
import warnings
from types import SimpleNamespace
from itertools import chain
from unittest import mock
from straditize import binary
import os.path as osp
from PIL import Image
import _base_testing as bt
import unittest
from matplotlib.backend_bases import MouseButton
from psyplot_gui.compat.qtcompat import QTest, Qt, QMessageBox


class RemoverTest(bt.StraditizeWidgetsTestCase):
    """A test case for testing the removing of features"""

    def test_remove_yaxes(self):
        """Test the removing of yaxes

        This method removes the vertical lines in
        ``'basic_diagram_yaxes.png'`` and compares it with
        ``'basic_diagram_yaxes_removed.png'``"""
        self.init_reader('basic_diagram_yaxes.png', xlim=np.array([9., 27.]))
        self.reader.column_starts = np.array([0, 7, 15])
        self.straditizer_widgets.refresh()
        self.digitizer.txt_line_fraction.setText('30')
        self.digitizer.cb_max_lw.setChecked(False)
        self.digitizer.sp_min_lw.setValue(1)
        QTest.mouseClick(self.digitizer.btn_remove_yaxes,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary,
            self.get_fig_path('basic_diagram_yaxes_removed.png'))

    def test_remove_yaxes_without_min_size_futurewarning(self):
        """Y-axis removal should avoid deprecated min_size API usage."""
        self.init_reader('basic_diagram_yaxes.png', xlim=np.array([9., 27.]))
        self.reader.column_starts = np.array([0, 7, 15])
        self.straditizer_widgets.refresh()
        self.digitizer.txt_line_fraction.setText('30')
        self.digitizer.cb_max_lw.setChecked(False)
        self.digitizer.sp_min_lw.setValue(1)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always', FutureWarning)
            QTest.mouseClick(self.digitizer.btn_remove_yaxes,
                             Qt.LeftButton)
        self.assertFalse(
            any('min_size' in str(w.message) for w in caught),
            msg=[str(w.message) for w in caught])

    def test_remove_vlines(self):
        """Test the removing of vertical lines

        This method removes the vertical lines in
        ``'basic_diagram_vlines.png'`` and compares it with
        ``'basic_diagram_vlines_removed.png'``"""
        self.init_reader('basic_diagram_vlines.png')
        self.digitizer.cb_max_lw.setChecked(True)
        self.digitizer.sp_max_lw.setValue(2)
        self.digitizer.sp_min_lw.setValue(2)
        self.digitizer.txt_line_fraction.setText('75')
        QTest.mouseClick(self.digitizer.btn_remove_vlines,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary,
            self.get_fig_path('basic_diagram_vlines_removed.png'))

    def test_remove_xaxes(self):
        """Test the removing of x-axes

        This method removes the horizontal lines in
        ``'basic_diagram_xaxes.png'`` and compares it with
        ``'basic_diagram_xaxes_removed.png'``"""
        self.init_reader('basic_diagram_xaxes.png', ylim=np.array([10., 33.]),
                         xlim=np.array([10., 29.]))
        self.digitizer.txt_line_fraction.setText('50')
        self.digitizer.cb_max_lw.setChecked(False)
        self.digitizer.sp_min_lw.setValue(1)
        QTest.mouseClick(self.digitizer.btn_remove_xaxes,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary,
            self.get_fig_path('basic_diagram_xaxes_removed.png'))

    def test_remove_hlines(self):
        """Test the removing of horizonal lines lines

        This method removes the horizontal lines in
        ``'basic_diagram_hlines.png'`` and compares it with
        ``'basic_diagram_hlines_removed.png'``"""
        self.init_reader('basic_diagram_hlines.png')
        self.digitizer.cb_max_lw.setChecked(True)
        self.digitizer.sp_max_lw.setValue(2)
        self.digitizer.sp_min_lw.setValue(2)
        self.digitizer.txt_line_fraction.setText('90')
        QTest.mouseClick(self.digitizer.btn_remove_hlines,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary,
            self.get_fig_path('basic_diagram_hlines_removed.png'))

    def test_remove_hlines_manually_from_endpoints(self):
        """Manual hline removal should accept endpoint input and remove data."""
        self.init_reader('basic_diagram_hlines.png')
        self.straditizer_widgets.refresh()
        text = '0, 0, 10, 0'
        with mock.patch(
                'straditize.widgets.data.QInputDialog.getMultiLineText',
                return_value=(text, True)), mock.patch.object(
                self.digitizer, '_line_to_mask_indices',
                return_value=(np.array([0]), np.array([0]))), mock.patch.object(
                self.reader, 'reset_labels') as reset_labels:
            self.digitizer.remove_hlines_manually()
        self.assertTrue(reset_labels.called)

    def test_edit_full_data_opens_editor(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)
        editor.close()

    def test_edit_full_data_click_add_and_remove_row(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        low_y = float(self.reader._full_df.index.min()) - 10.0
        add_event = SimpleNamespace(
            inaxes=self.straditizer.ax,
            ydata=low_y + min(self.straditizer.data_ylim),
            button=MouseButton.LEFT)
        self.digitizer._edit_full_data_from_click(add_event)
        self.assertIn(int(np.round(low_y)), self.reader._full_df.index)

        del_event = SimpleNamespace(
            inaxes=self.straditizer.ax,
            ydata=low_y + min(self.straditizer.data_ylim),
            button=MouseButton.RIGHT)
        self.digitizer._edit_full_data_from_click(del_event)
        self.assertNotIn(int(np.round(low_y)), self.reader._full_df.index)
        editor.close()

    def test_edit_full_data_click_add_row_uses_visual_row_center(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        target_row = int(self.reader._full_df.index[9])
        self.reader._full_df.drop(target_row, inplace=True)

        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            ydata=self.digitizer._full_data_row_y(target_row),
            button=MouseButton.LEFT)
        self.digitizer._edit_full_data_from_click(add_event)

        self.assertIn(target_row, self.reader._full_df.index)
        editor.close()

    def test_edit_full_data_click_remove_row_uses_visual_row_center(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        target_row = int(self.reader._full_df.index[9])
        del_event = SimpleNamespace(
            inaxes=self.reader.ax,
            ydata=self.digitizer._full_data_row_y(target_row),
            button=MouseButton.RIGHT)
        self.digitizer._edit_full_data_from_click(del_event)

        self.assertNotIn(target_row, self.reader._full_df.index)
        editor.close()

    def test_edit_full_data_turning_point_mark_updates_full_df(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)
        self.assertTrue(getattr(self.digitizer, '_full_data_marks', []))

        mark = self.digitizer._full_data_marks[0]
        col = mark._full_data_column
        row = mark._full_data_row
        old = float(self.reader._full_df.loc[row, col])

        self.move_mark(mark, to=(mark.x + 1.0, mark.y))

        self.assertNotEqual(float(self.reader._full_df.loc[row, col]), old)
        editor.close()

    def test_edit_full_data_shift_left_adds_manual_control_point(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        existing_rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        row = next(r for r in self.reader._full_df.index if r not in existing_rows)
        _, start_abs, _ = self.digitizer._full_data_column_abs_bounds(col)
        old = float(self.reader._full_df.loc[row, col])
        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=start_abs + old + 1.0,
            ydata=float(row) + min(self.reader.extent[2:]),
            button=MouseButton.LEFT,
            key='shift')

        self.digitizer._edit_full_data_from_click(add_event)

        rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        self.assertIn(row, rows)
        self.assertNotEqual(float(self.reader._full_df.loc[row, col]), old)
        editor.close()

    def test_edit_full_data_shift_left_adds_control_point_on_visual_row(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        existing_rows = {
            int(m._full_data_row) for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        row = next(
            int(r) for r in self.reader._full_df.index
            if r not in existing_rows and int(r) % 2 == 1)
        _, start_abs, _ = self.digitizer._full_data_column_abs_bounds(col)

        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=start_abs + float(self.reader._full_df.loc[row, col]) + 1.0,
            ydata=self.digitizer._full_data_row_y(row),
            button=MouseButton.LEFT,
            key='shift')
        self.digitizer._edit_full_data_from_click(add_event)

        rows = {
            int(m._full_data_row) for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        self.assertIn(row, rows)
        editor.close()

    def test_edit_full_data_shift_left_adds_control_point_on_main_axis(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        existing_rows = {
            int(m._full_data_row) for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        row = next(
            int(r) for r in self.reader._full_df.index
            if int(r) not in existing_rows and int(r) % 2 == 1)
        _, start_abs, _ = self.digitizer._full_data_column_abs_bounds(col)
        old = float(self.reader._full_df.loc[row, col])
        add_event = SimpleNamespace(
            inaxes=self.straditizer.ax,
            xdata=start_abs + old + 1.0,
            ydata=float(row) + 0.5 + min(self.straditizer.data_ylim),
            button=MouseButton.LEFT,
            key='shift')

        self.digitizer._edit_full_data_from_click(add_event)

        rows = {
            int(m._full_data_row) for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        self.assertIn(row, rows)
        self.assertNotEqual(float(self.reader._full_df.loc[row, col]), old)
        editor.close()

    def test_edit_full_data_shift_left_reinterpolates_column_segment(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        selected = None
        for col in self.reader._full_df.columns:
            control_rows = sorted(
                int(m._full_data_row) for m in self.digitizer._full_data_marks
                if m._full_data_column == col)
            for prev_row, next_row in zip(control_rows[:-1], control_rows[1:]):
                if next_row - prev_row >= 4:
                    row = prev_row + (next_row - prev_row) // 2
                    neighbor = row + 1 if row + 1 < next_row else row - 1
                    selected = (col, control_rows, prev_row, row, neighbor,
                                next_row)
                    break
            if selected is not None:
                break

        self.assertIsNotNone(selected)
        col, base_rows, prev_row, row, neighbor, next_row = selected
        _, start_abs, end_abs = self.digitizer._full_data_column_abs_bounds(col)
        width = float(end_abs - start_abs)
        base_series = self.reader._full_df.loc[:, col].copy()
        target_value = 0.0 if float(base_series.loc[row]) > width / 2.0 else width

        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=start_abs + target_value,
            ydata=self.digitizer._full_data_row_y(row),
            button=MouseButton.LEFT,
            key='shift')
        self.digitizer._edit_full_data_from_click(add_event)

        expected_add = np.interp(
            float(neighbor),
            np.array([prev_row, row, next_row], dtype=float),
            np.array([
                float(base_series.loc[prev_row]),
                target_value,
                float(base_series.loc[next_row])], dtype=float))
        self.assertAlmostEqual(
            float(self.reader._full_df.loc[neighbor, col]), expected_add)

        mark = next(
            m for m in self.digitizer._full_data_marks
            if m._full_data_column == col and int(m._full_data_row) == row)
        del_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=mark.x,
            ydata=mark.y,
            button=MouseButton.RIGHT,
            key='shift')
        self.digitizer._edit_full_data_from_click(del_event)

        expected_remove = np.interp(
            float(neighbor),
            np.asarray(base_rows, dtype=float),
            base_series.loc[base_rows].values.astype(float))
        self.assertAlmostEqual(
            float(self.reader._full_df.loc[neighbor, col]), expected_remove)
        editor.close()

    def test_edit_full_data_shift_right_removes_manual_control_point(self):
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        existing_rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        row = next(r for r in self.reader._full_df.index if r not in existing_rows)
        _, start_abs, _ = self.digitizer._full_data_column_abs_bounds(col)
        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=start_abs + float(self.reader._full_df.loc[row, col]) + 1.0,
            ydata=float(row) + min(self.reader.extent[2:]),
            button=MouseButton.LEFT,
            key='shift')
        self.digitizer._edit_full_data_from_click(add_event)
        mark = next(
            m for m in self.digitizer._full_data_marks
            if m._full_data_column == col and m._full_data_row == row)

        del_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=mark.x,
            ydata=mark.y,
            button=MouseButton.RIGHT,
            key='shift')
        self.digitizer._edit_full_data_from_click(del_event)

        rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        self.assertNotIn(row, rows)
        editor.close()

    def test_edit_full_data_control_points_use_distinct_colors(self):
        from matplotlib.colors import to_hex

        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        required_mark = next(
            m for m in self.digitizer._full_data_marks
            if m._full_data_required)
        auto_mark = next(
            m for m in self.digitizer._full_data_marks
            if not m._full_data_required and not getattr(
                m, '_full_data_manual', False))

        col = self.reader._full_df.columns[0]
        existing_rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        row = next(r for r in self.reader._full_df.index if r not in existing_rows)
        _, start_abs, _ = self.digitizer._full_data_column_abs_bounds(col)
        add_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=start_abs + float(self.reader._full_df.loc[row, col]) + 1.0,
            ydata=float(row) + min(self.reader.extent[2:]),
            button=MouseButton.LEFT,
            key='shift')
        self.digitizer._edit_full_data_from_click(add_event)
        manual_mark = next(
            m for m in self.digitizer._full_data_marks
            if m._full_data_column == col and m._full_data_row == row)

        required_color = to_hex(required_mark._full_data_base_color)
        auto_color = to_hex(auto_mark._full_data_base_color)
        manual_color = to_hex(manual_mark._full_data_base_color)

        self.assertNotEqual(required_color, auto_color)
        self.assertNotEqual(required_color, manual_color)
        self.assertNotEqual(auto_color, manual_color)
        editor.close()

    def test_edit_full_data_plain_left_click_updates_x_value_to_cursor(self):
        """Plain left-click inside a column should pull the curve directly to cursor X."""
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        row = int(self.reader._full_df.index[len(self.reader._full_df) // 2])
        _, start_abs, end_abs = self.digitizer._full_data_column_abs_bounds(col)
        target_val = float(end_abs - start_abs) * 0.8
        target_x = start_abs + target_val

        # Plain left click WITHOUT shift
        click_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=target_x,
            ydata=self.digitizer._full_data_row_y(row),
            button=MouseButton.LEFT,
            key=None)
        self.digitizer._edit_full_data_from_click(click_event)

        # The value at row, col must reflect the clicked X position, not old curve value!
        self.assertAlmostEqual(
            float(self.reader._full_df.loc[row, col]), target_val, delta=0.5)
        editor.close()

    def test_edit_full_data_plain_right_click_removes_control_point(self):
        """Plain right-click directly on a control mark should remove it without shift."""
        self.init_reader('basic_diagram_hlines.png')
        self.reader.digitize()
        self.straditizer_widgets.refresh()
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        col = self.reader._full_df.columns[0]
        # Pick an optional (non-required) mark
        optional_marks = [
            m for m in self.digitizer._full_data_marks
            if m._full_data_column == col and not m._full_data_required]
        self.assertTrue(len(optional_marks) > 0)
        target_mark = optional_marks[0]
        target_row = target_mark._full_data_row

        # Plain right-click on mark WITHOUT shift
        del_event = SimpleNamespace(
            inaxes=self.reader.ax,
            xdata=target_mark.x,
            ydata=target_mark.y,
            button=MouseButton.RIGHT,
            key=None)
        self.digitizer._edit_full_data_from_click(del_event)

        remaining_rows = {
            m._full_data_row for m in self.digitizer._full_data_marks
            if m._full_data_column == col}
        self.assertNotIn(target_row, remaining_rows)
        editor.close()

    def test_remove_disconnected_01_from0(self):
        """Test the removing of disconnected features

        This method removes the disconnected features in
        ``'basic_diagram_disconnected.png'`` and compares it with
        ``'basic_diagram_binary.png'``"""
        # set the distance for removing
        self.digitizer.cb_fromlast.setChecked(False)
        self.digitizer.cb_from0.setChecked(True)
        self.digitizer.txt_from0.setText('4')
        # setup the reader
        self._test_disconnected('basic_diagram_disconnected_01.png',
                                'basic_diagram_disconnected_01_ref.png')

    def test_remove_disconnected_02_from0_fromlast(self):
        """Test the removing of disconnected features

        This method removes the disconnected features in
        ``'basic_diagram_disconnected.png'`` and compares it with
        ``'basic_diagram_binary.png'``"""
        # setup the reader
        self.digitizer.cb_fromlast.setChecked(True)
        self.digitizer.cb_from0.setChecked(True)
        self.digitizer.txt_fromlast.setText('2')
        self.digitizer.txt_from0.setText('3')
        self._test_disconnected('basic_diagram_disconnected_02.png',
                                'basic_diagram_disconnected_02_ref.png')

    def test_remove_disconnected_03_fromlast(self):
        """Test the removing of disconnected features

        This method removes the disconnected features in
        ``'basic_diagram_disconnected.png'`` and compares it with
        ``'basic_diagram_binary.png'``"""
        # setup the reader
        self.digitizer.cb_fromlast.setChecked(True)
        self.digitizer.cb_from0.setChecked(False)
        self.digitizer.txt_fromlast.setText('2')
        self._test_disconnected('basic_diagram_disconnected_03.png',
                                'basic_diagram_disconnected_03_ref.png')

    def _test_disconnected(self, fname, ref):
        self.init_reader(fname)
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.assertTrue(self.digitizer.btn_show_disconnected_parts.isEnabled())
        QTest.mouseClick(self.digitizer.btn_show_disconnected_parts,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path(ref))

    def test_remove_small_parts(self):
        """Test the removement of small features

        This test methods removes two small features in
        basic_diagram_small_features.png"""
        self.init_reader('basic_diagram_small_features.png')
        self.assertTrue(self.digitizer.btn_show_small_parts.isEnabled())
        QTest.mouseClick(self.digitizer.btn_show_small_parts, Qt.LeftButton)
        # before removing, highlight the small selections
        QTest.mouseClick(self.digitizer.btn_highlight_small_selection,
                         Qt.LeftButton)
        self.assertEqual(len(self.reader._ellipses), 2,
                         msg=self.reader._ellipses)
        # check for correct centers
        centers_drawn = sorted(e.center for e in self.reader._ellipses)
        self.assertEqual(centers_drawn, [(14.0, 18.0), (21.5, 14.5)])
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        # ellipses should be removed now
        self.assertEqual(len(self.reader._ellipses), 0,
                         msg=self.reader._ellipses)
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path('basic_diagram_binary.png'))

    def test_remove_features_at_column_ends(self):
        """Test the removement of features at the end of columns

        This test methods removes two small features in
        basic_diagram_small_features.png"""
        self.init_reader('basic_diagram_features_at_col_ends.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.assertTrue(
            self.digitizer.btn_show_parts_at_column_ends.isEnabled())
        QTest.mouseClick(self.digitizer.btn_show_parts_at_column_ends,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path(
                'basic_diagram_features_at_col_ends_removed.png'))

    def test_remove_cross_column_features(self):
        """Test the removement of features at the end of columns

        This test methods removes two small features in
        basic_diagram_small_features.png"""
        self.init_reader('basic_diagram_cross_col.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.digitizer.txt_cross_column_px.setText('3')
        self.assertTrue(
            self.digitizer.btn_show_cross_column.isEnabled())
        QTest.mouseClick(self.digitizer.btn_show_cross_column,
                         Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path(
                'basic_diagram_cross_col_removed.png'))


class OccurencesTest(bt.StraditizeWidgetsTestCase):
    """A test case for handling occurences"""

    def test_01_select_occurences(self):
        """Test the selection of occurences"""
        self.init_reader('basic_diagram_occurences.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        QTest.mouseClick(self.digitizer.btn_select_occurences, Qt.LeftButton)
        labels = self.reader.labels
        self.reader.select_labels(np.array(
            [labels[5, 11], labels[13, 17]]))
        self.digitizer.cb_remove_occurences.setChecked(True)
        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        # make sure that the occurences have been removed
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path('basic_diagram_binary.png'))
        self.assertEqual(self.reader.occurences, {(10, 6), (17, 14)})

    def test_edit_occurences(self):
        self.test_01_select_occurences()
        QTest.mouseClick(self.digitizer.btn_edit_occurences, Qt.LeftButton)
        self.move_mark(self.straditizer.marks[0], by=[0, -1])
        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        self.assertEqual(
            {c: list(v) for c, v in self.reader.occurences_dict.items()},
            {1: [5], 2: [14]})

    def test_samples(self):
        """Test whether the samples are correctly highlighted"""
        self.test_01_select_occurences()
        self.reader.digitize()
        self.digitizer.set_occurences_value('')
        self.digitizer.set_occurences_value('900')
        self.digitizer.find_samples()
        df = self.reader.sample_locs
        self.assertEqual(df.iloc[1, 1], 900)
        self.assertEqual(df.iloc[2, 2], 900)


class DigitizerTest(bt.StraditizeWidgetsTestCase):
    """A TestCase for testing general features of the digitizer control"""

    def test_column_starts(self):
        """Test the recognition of column starts"""
        self.init_reader()
        self.assertTrue(self.digitizer.btn_column_starts.isEnabled())
        QTest.mouseClick(self.digitizer.btn_column_starts, Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        self.assertEqual(list(self.reader.column_starts),
                         list(self.column_starts))
        self.assertEqual(list(self.reader.column_ends),
                         list(self.column_ends))

    def test_column_ends(self):
        """Test the modification of column ends"""
        self.test_column_starts()
        self.assertTrue(self.digitizer.btn_column_ends.isEnabled())
        QTest.mouseClick(self.digitizer.btn_column_ends, Qt.LeftButton)
        self.assertTrue(bool(self.straditizer.marks),
                        msg='No crossmarks created!')
        # move the second mark by one pixel
        mark = self.straditizer.marks[1]
        mark.set_pos((mark.x + 1, mark.pos[1]))
        QTest.mouseClick(self.straditizer_widgets.apply_button,
                         Qt.LeftButton)
        ref_cols = list(self.column_ends)
        ref_cols[1] += 1
        self.assertEqual(list(self.reader.column_ends),
                         ref_cols)

    def test_digitize(self):
        """Test the digitization of the full data"""
        self.test_column_starts()
        self.assertTrue(self.digitizer.btn_digitize.isEnabled())
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        full_df = self.reader.full_df
        self.assertIsNotNone(full_df)
        # load the reference DataFrame
        ref = pd.read_csv(self.get_fig_path(osp.join('data', 'full_data.csv')),
                          index_col=0, dtype=float)
        self.assertEqual(list(map(str, full_df.columns)),
                         list(map(str, ref.columns)))
        ref.columns = full_df.columns
        self.assertFrameEqual(full_df, ref, check_index_type=False)

    def test_load_samples(self):
        """Test loading samples from a file"""
        self.test_digitize()
        fname = self.get_fig_path(osp.join('data', 'data.csv'))
        ref = pd.read_csv(fname, index_col=0, dtype=float)
        ref.index = ref.index.astype(int)
        ref.columns = ref.columns.astype(int)
        self.digitizer.load_samples(fname)
        self.assertFrameEqual(
            ref, self.reader.sample_locs,
            check_names=False, check_column_type=False)

    def test_load_samples_without_futurewarning(self):
        """Loading samples should not rely on deprecated pandas indexing."""
        self.test_digitize()
        fname = self.get_fig_path(osp.join('data', 'data.csv'))
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always', FutureWarning)
            self.digitizer.load_samples(fname)
        self.assertFalse(
            any(issubclass(w.category, FutureWarning) for w in caught),
            msg=[str(w.message) for w in caught])

    def test_find_samples_uses_reader_default_for_non_stacked_reader(self):
        self.test_digitize()
        calls = []
        samples = pd.DataFrame([[1.0, 2.0, 3.0]], index=[10],
                               columns=self.reader.columns)
        rough = pd.DataFrame(
            [[9, 11, 9, 11, 9, 11]], index=[10],
            columns=pd.MultiIndex.from_product(
                [self.reader.columns, ['vmin', 'vmax']]))

        def fake_find_samples(**kwargs):
            calls.append(kwargs)
            return samples.copy(), rough.copy()

        self.reader.find_samples = fake_find_samples

        QTest.mouseClick(self.digitizer.btn_find_samples, Qt.LeftButton)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['pixel_tol'],
                         self.digitizer.sp_pixel_tol.value())
        self.assertFrameEqual(self.reader.sample_locs, samples)

    def test_plot_results(self):
        """Plot results should overlay the digitization on the source image."""
        sw = self.straditizer_widgets
        self.assertFalse(hasattr(sw.plot_control.results_plot, 'cb_transformed'))
        self.assertFalse(sw.plot_control.results_plot.cb_final.isEnabled())
        self.test_load_samples()
        fig, ax, artists = sw.plot_control.results_plot.plot_results()
        dialog = sw.plot_control.results_plot.results_dialog
        self.assertIsNotNone(dialog)
        self.assertTrue(dialog.isVisible())
        self.assertIs(artists['image'], ax.images[0])
        self.assertGreaterEqual(len(artists['fills']), 1)
        self.assertGreaterEqual(len(artists['lines']), 1)
        QTest.mouseClick(dialog.btn_close, Qt.LeftButton)
        self.assertFalse(dialog.isVisible())

    def test_plot_results_dialog_exports_current_data(self):
        """The result-review dialog should export the data it is showing."""
        self.test_load_samples()
        results_plot = self.straditizer_widgets.plot_control.results_plot
        results_plot.cb_final.setChecked(True)

        with mock.patch.object(
                self.straditizer_widgets.menu_actions,
                '_export_df') as export_df:
            results_plot.plot_results()
            dialog = results_plot.results_dialog
            QTest.mouseClick(dialog.btn_export, Qt.LeftButton)

        self.assertTrue(export_df.called)
        exported = export_df.call_args[0][0]
        self.assertFrameEqual(
            exported, self.straditizer.final_df,
            check_index_type=False, check_dtype=False)

    def test_plot_results_dialog_uses_shared_export_dialog_pipeline(self):
        """Result-review export should go through ExportDfDialog."""
        self.test_load_samples()
        results_plot = self.straditizer_widgets.plot_control.results_plot

        with mock.patch(
                'straditize.widgets.menu_actions.ExportDfDialog.export_df'
                ) as export_df:
            results_plot.plot_results()
            dialog = results_plot.results_dialog
            QTest.mouseClick(dialog.btn_export, Qt.LeftButton)

        self.assertTrue(export_df.called)
        self.assertIs(export_df.call_args[0][0], self.straditizer_widgets)


class ChildReaderFrameworkTest(bt.StraditizeWidgetsTestCase):
    """Test the column specific reader framework"""

    def test_init_child_reader(self, init=True):
        """Test initializing a child reader"""
        if init:
            self.init_reader()
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        cols = list(self.reader.columns)

        # select a column
        self.digitizer.enable_col_selection_for_new_reader()
        ax = self.straditizer.ax
        x = self.reader.column_starts[1] + self.data_xlim[0] + 1
        y = np.mean(self.data_ylim)
        x, y = ax.transData.transform([[x, y]])[0]
        ax.figure.canvas.button_press_event(x, y, 1)

        # create the new reader
        self.digitizer.new_reader_for_selection(self.reader.__class__)
        QTest.mouseClick(self.straditizer_widgets.cancel_button, Qt.LeftButton)

        self.assertEqual(len(self.reader.children), 1)
        self.assertEqual(list(self.reader.columns), sorted(set(cols) - {1}))
        self.assertEqual(list(self.reader.children[0].columns), [1])

    def test_change_child_reader(self, init=True):
        """Test changing the reader"""
        if init:
            self.test_init_child_reader()
        current = self.reader
        new = self.reader.children[0]
        self.digitizer.cb_readers.setCurrentIndex(1)
        self.assertIs(new, self.reader)
        self.assertIs(current, self.reader.children[0])

    def test_digitize_child_reader(self):
        self.init_reader()
        self.reader.column_starts = self.column_starts
        self.reader.digitize()

        ref_df = self.reader.full_df

        # plot the full_df and save it
        self.reader.plot_full_df(c='r')  # plot the data with  red lines
        fname_ref = self.get_random_filename(suffix='.png')
        self.reader.ax.figure.savefig(fname_ref)
        for l in self.reader.lines:
            l.remove()
        self.reader.lines.clear()

        # plot the potential samples
        self.reader.plot_potential_samples(plot_kws=dict(c='r'))
        fname_meas_ref = self.get_random_filename(suffix='.png')
        self.reader.ax.figure.savefig(fname_meas_ref)
        for l in self.reader.sample_ranges:
            l.remove()
        self.reader.sample_ranges.clear()

        self.reader._full_df = None

        self.test_init_child_reader(init=False)
        self.reader.digitize()
        self.reader.plot_full_df(c='r')

        self.test_change_child_reader(init=False)
        self.reader.digitize()
        self.reader.plot_full_df(c='r')

        fname = self.get_random_filename(suffix='.png')
        self.reader.ax.figure.savefig(fname)

        self.assertFrameEqual(self.reader._full_df, ref_df)
        self.assertImageEquals(fname, fname_ref)

        for l in chain.from_iterable(
                reader.lines for reader in self.reader.iter_all_readers):
            l.remove()
        for reader in self.reader.iter_all_readers:
            reader.lines.clear()
            reader.plot_potential_samples(plot_kws=dict(c='r'))
        fname = self.get_random_filename(suffix='.png')
        self.reader.ax.figure.savefig(fname)
        self.assertImageEquals(fname, fname_meas_ref)

    def test_child_reader_samples(self):
        """Test editing samples"""
        self.init_reader()
        self.reader.column_starts = self.column_starts
        self.reader.digitize()
        ref = self.reader._get_sample_locs()
        # reset the reader
        self.digitizer.init_reader()
        self.test_init_child_reader(init=False)
        self.reader.digitize()
        self.test_change_child_reader(init=False)
        self.reader.digitize()

        # compare the samples
        QTest.mouseClick(self.digitizer.btn_find_samples, Qt.LeftButton)
        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        self.assertFrameEqual(
            self.reader._get_sample_locs(), ref)


class ExaggeratedTest(bt.StraditizeWidgetsTestCase):
    """A test case for the exaggerated reader"""

    def _create_light_overlay_exag_figure(self):
        image = np.full((20, 20, 4), 255, dtype=np.uint8)
        image[4:16, 3:7, :-1] = [180, 0, 0]
        image[4:16, 9:13, :-1] = [255, 220, 220]
        image[..., -1] = 255
        fname = self.get_random_filename(suffix='.png')
        Image.fromarray(image, mode='RGBA').save(fname)
        return fname

    def _create_same_hue_inside_main_exag_figure(self):
        image = np.full((20, 20, 4), 255, dtype=np.uint8)
        image[4:16, 3:8, :-1] = [180, 0, 0]
        image[4:16, 8:13, :-1] = [240, 200, 200]
        image[..., -1] = 255
        fname = self.get_random_filename(suffix='.png')
        Image.fromarray(image, mode='RGBA').save(fname)
        return fname

    def test_init_reader_propagates_extraction_mode(self):
        self.open_img('basic_diagram.png')
        self.set_data_lims(None, None)
        self.digitizer.cb_extraction_mode.setCurrentText(
            'Light overlay on white background')
        self.digitizer.init_reader()
        self.assertEqual(self.reader.extraction_mode, 'light-overlay-white')

    def test_init_reader_propagates_segmentation_and_target_colors(self):
        self.open_img('basic_diagram.png')
        self.set_data_lims(None, None)
        self.digitizer.cb_segmentation_mode.setCurrentText('Guided')
        self.digitizer.txt_target_colors.setText('#F0C8C8, b40000')
        with mock.patch.object(self.straditizer, 'init_reader') as init_reader, \
                mock.patch.object(self.straditizer, 'show_full_image'), \
                mock.patch.object(self.straditizer, 'draw_figure'), \
                mock.patch.object(self.straditizer_widgets, 'refresh'):
            self.digitizer.init_reader()
        self.assertEqual(init_reader.call_count, 1)
        self.assertEqual(
            init_reader.call_args[1]['segmentation_mode'], 'guided')
        self.assertEqual(
            init_reader.call_args[1]['target_colors'],
            ['#F0C8C8', '#B40000'])

    def test_init_exaggerated(self):
        self.init_reader('basic_diagram_exaggerated.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        # add the exaggeration reader
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)

    def test_init_exaggerated_reader_propagates_extraction_mode(self):
        self.init_reader('basic_diagram_exaggerated.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        self.digitizer.cb_exag_extraction_mode.setCurrentText(
            'Light overlay on white background')
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)
        self.assertEqual(
            self.reader.exaggerated_reader.extraction_mode,
            'light-overlay-white')

    def test_init_exaggerated_reader_propagates_guided_settings(self):
        self.init_reader('basic_diagram_exaggerated.png')
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        self.digitizer.cb_exag_segmentation_mode.setCurrentText('Guided')
        self.digitizer.txt_exag_target_colors.setText('#F0C8C8')
        self.digitizer.cb_exag_merge_mode.setCurrentText(
            'Threshold merge (legacy)')
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)
        self.assertEqual(
            self.reader.exaggerated_reader.segmentation_mode, 'guided')
        self.assertEqual(
            self.reader.exaggerated_reader.target_colors, ['#F0C8C8'])
        self.assertEqual(
            self.reader.exaggerated_reader.exaggeration_merge_mode,
            'threshold-legacy')

    def test_select_exaggerations(self):
        """Test selecting the exaggerations"""
        self.test_init_exaggerated()
        orig = self.reader.binary.copy()
        # select the exaggeration parts
        QTest.mouseClick(self.digitizer.btn_select_exaggerations,
                         Qt.LeftButton)
        tb = self.straditizer_widgets.selection_toolbar
        tb.set_color_wand_mode()
        tb.cb_whole_fig.setChecked(True)
        tb.wand_action.setChecked(True)
        tb.toggle_selection()
        slx, sly = tb.get_xy_slice(15, 25, 15, 25)
        tb.select_rect(slx, sly)
        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        # test the exaggerations
        exag = self.reader.exaggerated_reader.binary
        exag_sum = exag.sum()
        self.assertGreater(exag_sum, 0)
        self.assertArrayEquals(orig, self.reader.binary + exag)
        self.assertBinaryImageEquals(
            self.reader.binary, self.get_fig_path('basic_diagram_binary.png'))

    def test_select_exaggerations_prefills_light_overlay_candidates(self):
        fname = self._create_light_overlay_exag_figure()
        self.digitizer.cb_extraction_mode.setCurrentText('Standard')
        self.init_reader(fname, xlim=np.array([0., 20.]), ylim=np.array([0., 20.]))
        main_reader = self.reader
        main_reader.column_starts = np.array([0])
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        self.digitizer.cb_exag_extraction_mode.setCurrentText(
            'Light overlay on white background')
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)
        QTest.mouseClick(self.digitizer.btn_select_exaggerations, Qt.LeftButton)

        expected = np.zeros(main_reader.binary.shape, dtype=bool)
        expected[4:16, 9:13] = True

        self.assertArrayEquals(main_reader.selected_part, expected)

        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        self.assertArrayEquals(
            main_reader.exaggerated_reader.binary.astype(bool), expected)
        self.assertFalse(main_reader.binary[expected].any())

    def test_select_exaggerations_prefills_same_hue_candidates_inside_main(self):
        fname = self._create_same_hue_inside_main_exag_figure()
        self.digitizer.cb_extraction_mode.setCurrentText('Standard')
        self.init_reader(fname, xlim=np.array([0., 20.]), ylim=np.array([0., 20.]))
        main_reader = self.reader
        main_reader.column_starts = np.array([0])
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        self.digitizer.cb_exag_extraction_mode.setCurrentText(
            'Light overlay on white background')
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)
        QTest.mouseClick(self.digitizer.btn_select_exaggerations, Qt.LeftButton)

        expected = np.zeros(main_reader.binary.shape, dtype=bool)
        expected[4:16, 8:13] = True
        primary = np.zeros(main_reader.binary.shape, dtype=bool)
        primary[4:16, 3:8] = True

        self.assertArrayEquals(main_reader.selected_part, expected)

        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        self.assertArrayEquals(
            main_reader.exaggerated_reader.binary.astype(bool), expected)
        self.assertFalse(main_reader.binary[expected].any())
        self.assertTrue(main_reader.binary[primary].all())

    def test_select_exaggerations_guided_target_colors_focus_candidates(self):
        fname = self.get_random_filename(suffix='.png')
        image = np.full((20, 20, 4), 255, dtype=np.uint8)
        image[4:16, 3:8, :-1] = [180, 0, 0]
        image[4:16, 8:13, :-1] = [240, 200, 200]
        image[4:16, 13:17, :-1] = [200, 220, 255]
        image[..., -1] = 255
        Image.fromarray(image, mode='RGBA').save(fname)

        self.digitizer.cb_extraction_mode.setCurrentText('Standard')
        self.init_reader(fname, xlim=np.array([0., 20.]), ylim=np.array([0., 20.]))
        main_reader = self.reader
        main_reader.column_starts = np.array([0])
        self.straditizer_widgets.refresh()
        self.digitizer.txt_exag_factor.setText('2')
        self.digitizer.cb_exag_extraction_mode.setCurrentText(
            'Light overlay on white background')
        self.digitizer.cb_exag_segmentation_mode.setCurrentText('Guided')
        self.digitizer.txt_exag_target_colors.setText('#F0C8C8')
        QTest.mouseClick(self.digitizer.btn_new_exaggeration, Qt.LeftButton)
        QTest.mouseClick(self.digitizer.btn_select_exaggerations, Qt.LeftButton)

        expected = np.zeros(main_reader.binary.shape, dtype=bool)
        expected[4:16, 8:13] = True
        nuisance = np.zeros(main_reader.binary.shape, dtype=bool)
        nuisance[4:16, 13:17] = True

        self.assertArrayEquals(main_reader.selected_part, expected)
        self.assertFalse(main_reader.selected_part[nuisance].any())

    def test_pick_target_color_appends_hex_for_reader(self):
        fname = self._create_same_hue_inside_main_exag_figure()
        self.init_reader(fname, xlim=np.array([0., 20.]), ylim=np.array([0., 20.]))
        reader = self.reader
        self.digitizer.txt_target_colors.setText('#112233')
        QTest.mouseClick(self.digitizer.btn_pick_target_color, Qt.LeftButton)
        x, y = reader.ax.transData.transform([[5, 5]])[0]
        reader.ax.figure.canvas.button_press_event(x, y, 1)
        self.assertEqual(
            self.digitizer.txt_target_colors.text(),
            '#112233, #B40000')

    def test_target_color_text_helpers_allow_append_pop_and_clear(self):
        self.assertEqual(
            self.digitizer._append_color_text('#E5E5E5, #EBE2E3', '#992F31'),
            '#E5E5E5, #EBE2E3, #992F31')
        self.assertEqual(
            self.digitizer._pop_color_text('#E5E5E5, #EBE2E3, #992F31'),
            '#E5E5E5, #EBE2E3')
        self.digitizer.txt_target_colors.setText('#E5E5E5, #EBE2E3')
        self.digitizer.clear_target_colors(False)
        self.assertEqual(self.digitizer.txt_target_colors.text(), '')

    def test_merge_mode_switch_requires_confirmation(self):
        self.test_select_exaggerations()
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        self.digitizer.cb_exag_merge_mode.setCurrentText(
            'Selected region priority')
        with mock.patch(
                'straditize.widgets.data.QMessageBox.question',
                return_value=QMessageBox.No):
            self.digitizer.cb_exag_merge_mode.setCurrentText(
                'Threshold merge (legacy)')
        self.assertEqual(self.digitizer.cb_exag_merge_mode.currentText(),
                         'Selected region priority')

    def test_digitize_exaggerations(self):
        self.test_select_exaggerations()
        self.digitizer.cb_exag_merge_mode.setCurrentText(
            'Selected region priority')
        self.assertFalse(self.digitizer.btn_digitize_exag.isEnabled())
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        self.assertTrue(self.digitizer.btn_digitize_exag.isEnabled())
        base = self.reader.full_df.copy(True)
        df, mask = self.reader.digitize_exaggerated(
            return_mask=True, inplace=False)
        self.assertTrue(mask.values.any())
        self.assertFalse(np.array_equal(df.values, base.values))
        with mock.patch.object(
                self.digitizer, '_confirm_exaggeration_merge',
                return_value=True):
            QTest.mouseClick(self.digitizer.btn_digitize_exag, Qt.LeftButton)
        self.assertFrameEqual(self.reader.full_df, df)

    def test_digitize_exaggerations_requires_preview_confirmation(self):
        self.test_select_exaggerations()
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        before = self.reader.full_df.copy(True)
        with mock.patch.object(
                self.digitizer, '_confirm_exaggeration_merge',
                return_value=False):
            QTest.mouseClick(self.digitizer.btn_digitize_exag, Qt.LeftButton)
        self.assertFrameEqual(self.reader.full_df, before)

    def test_digitize_exaggerations_empty_selection_shows_recovery_message(self):
        self.test_init_exaggerated()
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        self.reader.exaggerated_reader.binary[:] = 0
        self.straditizer_widgets.refresh()
        self.assertTrue(self.digitizer.btn_digitize_exag.isEnabled())
        with mock.patch(
                'straditize.widgets.data.QMessageBox.information') as info:
            QTest.mouseClick(self.digitizer.btn_digitize_exag, Qt.LeftButton)
        self.assertTrue(info.called)

    def test_digitize_exaggerations_enablement_uses_base_reader(self):
        self.test_select_exaggerations()
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        exag_index = next(
            i for i in range(self.digitizer.cb_readers.count())
            if self.digitizer.cb_readers.itemText(i).startswith('exag.'))
        self.digitizer.cb_readers.setCurrentIndex(exag_index)
        self.straditizer_widgets.refresh()
        self.assertTrue(self.digitizer.btn_digitize_exag.isEnabled())


class BarReaderTest(bt.StraditizeWidgetsTestCase):
    """A test case for the BarReader"""

    def init_reader(self, fname='bar_diagram.png', *args, **kwargs):
        """Reimplemented to make sure, we intiailize a bar diagram"""
        self.digitizer.cb_reader_type.setCurrentText('bars')
        super(BarReaderTest, self).init_reader(fname, *args, **kwargs)
        self.assertIsInstance(self.reader, binary.BarDataReader)

    @property
    def ref_bars(self):
        """A 2D array, where each row represents the location of one bar"""
        return np.loadtxt(
            self.get_fig_path(osp.join('data', 'bar_locations.dat')),
            dtype=int)

    def test_init_reader(self):
        self.init_reader()

    def test_digitize(self):
        self.init_reader()
        self.reader.column_starts = self.column_starts
        self.straditizer_widgets.refresh()
        self.digitizer.txt_tolerance.setText('1')
        QTest.mouseClick(self.digitizer.btn_digitize, Qt.LeftButton)
        # check that the bars are read correctly
        for col in range(len(self.column_starts)):
            self.assertLessEqual(
                set(chain.from_iterable(self.reader._all_indices[col])),
                set(np.unique(self.ref_bars)))

    def test_split_bars(self):
        """Test the splitting of too long bars"""
        def split(child):
            indices = list(map(int, child.text(0).split(', ')))
            self.assertEqual(len(indices), np.diff(ref_bars[0]) * 2)
            last = next(i for i in indices if (ref_bars[:, -1] == i).any())
            y = self.data_ylim[0] + last
            start = reader.all_column_starts[tree._col]
            x = start + self.data_xlim[0] + reader.full_df.loc[last, tree._col]
            x, y = reader.ax.transData.transform([[x, y]])[0]
            reader.ax.figure.canvas.button_press_event(x, y, 1)
            return x, y

        def revert_split(child):
            indices = list(map(int, child.text(0).split(',')))
            last = indices[-1]
            y= self.data_ylim[0] + last + 1
            start = reader.all_column_starts[tree._col]
            x = start + self.data_xlim[0] + reader.full_df.loc[last, tree._col]
            x, y = reader.ax.transData.transform([[x, y]])[0]
            reader.ax.figure.canvas.button_press_event(x, y, 3)
            return x, y
        self.assertTrue(self.digitizer.bar_split_child.isHidden())
        self.test_digitize()
        # make sure that there is something to split
        self.assertTrue(any(self.reader._splitted.values()))
        self.assertFalse(self.digitizer.bar_split_child.isHidden())

        ref_bars = self.ref_bars
        reader = self.reader
        tree = self.digitizer.tree_bar_split
        used_cols = set()

        # split the first item bars
        item = tree.topLevelItem(0).child(0)
        self.assertIsNotNone(item)
        tree.start_splitting(item)
        used_cols.add(tree._col)
        self.assertEqual(item.childCount(), 2)  # 2 suggestions
        revert_split(item.child(0))
        self.assertEqual(item.childCount(), 0)
        x, y = split(item)
        self.assertEqual(item.childCount(), 2)

        # now revert the split
        reader.ax.figure.canvas.button_press_event(x, y, 3)
        self.assertEqual(item.childCount(), 0)

        # split again
        split(item)
        x, y = split(item)
        self.assertEqual(item.childCount(), 2)

        # go to the next bar
        tree.go_to_next_bar()
        used_cols.add(tree._col)
        item = tree.topLevelItem(1).child(0)
        revert_split(item.child(0))
        self.assertEqual(item.childCount(), 0)
        split(item)
        self.assertEqual(item.childCount(), 2)

        # perform the split
        ref_bars = set(map(tuple, ref_bars))
        orig_lens = list(map(len, reader._all_indices))
        QTest.mouseClick(self.straditizer_widgets.apply_button, Qt.LeftButton)
        # test whether we splitted all
        self.assertFalse(any(reader._splitted.values()))
        for col, indices in enumerate(reader._all_indices):
            indices = list(map(tuple, indices))
            # check that the length increased
            if col in used_cols:
                self.assertGreater(len(indices), orig_lens[col])
            else:
                self.assertEqual(len(indices), orig_lens[col])
            # check for uniqueness of bars
            self.assertEqual(len(set(indices)), len(indices))
            # check that the bars are valid
            self.assertLessEqual(set(indices), ref_bars)

    def test_split_bars_uses_headless_figure_helper(self):
        """Bar split suggestions should avoid GUI pyplot figures."""
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        self.test_digitize()
        self.assertTrue(any(self.reader._splitted.values()))

        tree = self.digitizer.tree_bar_split
        item = tree.topLevelItem(0).child(0)
        fig = Figure()
        FigureCanvasAgg(fig)

        with mock.patch(
                'straditize.widgets.data.should_use_headless_figure',
                return_value=True), \
                mock.patch(
                    'straditize.widgets.data.create_matplotlib_figure',
                    return_value=fig) as create_fig, \
                mock.patch(
                    'matplotlib.pyplot.figure',
                    side_effect=AssertionError(
                        'pyplot.figure should not be used')):
            tree.start_splitting(item)

        create_fig.assert_called_once_with(headless=True)
        self.assertIs(tree.suggestions_fig, fig)


if __name__ == '__main__':
    unittest.main()
