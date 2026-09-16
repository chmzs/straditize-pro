"""Test the straditize.widgets.menu_actions module"""
import numpy as np
import pandas as pd
import os.path as osp
import _base_testing as bt
import unittest
from unittest import mock
from psyplot_gui.compat.qtcompat import QTest, Qt
from straditize.colnames import tesserocr
from straditize.widgets.menu_actions import ExportDfDialog


class MenuActionsTest(bt.StraditizeWidgetsTestCase):
    """A test case for testing the menu actions"""

    def test_empty_clipboard_is_reported_without_crashing(self):
        with mock.patch('PIL.ImageGrab.grabclipboard', return_value=None), \
                mock.patch('straditize.widgets.menu_actions.QMessageBox.warning') as warning:
            result = self.straditizer_widgets.menu_actions.from_clipboard()
        self.assertIsNone(result)
        warning.assert_called_once()

    def test_save_failure_does_not_mark_project_saved(self):
        self.open_img()
        stradi = self.straditizer
        old_attrs = stradi.attrs.copy()
        with mock.patch.object(stradi, 'to_dataset') as to_dataset:
            to_dataset.return_value.to_netcdf.side_effect = OSError('disk full')
            with self.assertRaises(OSError):
                self.straditizer_widgets.menu_actions.save_straditizer_as(
                    'failed-save.nc')
        pd.testing.assert_frame_equal(stradi.attrs, old_attrs)

    def test_open_img(self):
        self.open_img()

    def test_save_and_load_01_pickle(self):
        """Test the loading and saving of pickled projects"""
        self._test_save_and_load('.pkl')

    def test_save_and_load_02_netcdf(self):
        """Test the loading and saving of netCDF projects"""
        self._test_save_and_load('.nc')

    def test_save_and_load_03_pickle_bar(self):
        """Test the loading and saving of BarDataReader"""
        self.digitizer.cb_reader_type.setCurrentText('bars')
        old_stradi = self._test_save_and_load('.pkl', 'bar_diagram.png')
        old_reader = old_stradi.data_reader
        self.assertEqual(self.reader._all_indices, old_reader._all_indices)
        self.assertEqual(self.reader._splitted, old_reader._splitted)
        self.assertFrameEqual(self.reader._full_df_orig,
                              old_reader._full_df_orig)

    def test_save_and_load_04_netcdf_bar(self):
        """Test the loading and saving of BarDataReader"""
        self.digitizer.cb_reader_type.setCurrentText('bars')
        old_stradi = self._test_save_and_load('.nc', 'bar_diagram.png')
        old_reader = old_stradi.data_reader
        self.assertEqual(self.reader._all_indices, old_reader._all_indices)
        self.assertEqual(self.reader._splitted, old_reader._splitted)
        self.assertFrameEqual(self.reader._full_df_orig,
                              old_reader._full_df_orig)

    def test_save_and_load_edited_full_data_netcdf(self):
        """NetCDF save/load should preserve edited full-data row counts."""
        self.init_reader()
        self.reader.digitize()
        trimmed = self.reader.full_df.iloc[::3].copy()
        trimmed.index = np.arange(500, 500 + len(trimmed) * 5, 5)
        self.reader._full_df = trimmed
        self.straditizer_widgets.refresh()

        fname = self.get_random_filename(suffix='.nc')
        self.straditizer_widgets.menu_actions.save_straditizer_as(fname)
        self.straditizer_widgets.menu_actions.open_straditizer(fname)

        self.assertFrameEqual(
            self.reader._full_df, trimmed, check_dtype=False)

    def test_netcdf_encoding_skips_string_like_variables(self):
        """NetCDF compression should skip object and unicode variables."""
        self.init_reader()
        self.reader.digitize()
        self.reader._get_sample_locs()
        self.straditizer_widgets.refresh()

        ds = self.straditizer.to_dataset()
        encoding = self.straditizer_widgets.menu_actions._dataset_netcdf_encoding(
            ds)

        self.assertNotIn('reader_cls', encoding)
        self.assertNotIn('reader_mod', encoding)
        self.assertNotIn('colname', encoding)
        self.assertEqual(encoding['reader_image']['zlib'], True)
        self.assertEqual(encoding['reader_image']['complevel'], 4)
        self.assertEqual(encoding['mirror_colnames']['zlib'], True)

    def test_save_and_load_preserves_segmentation_and_exaggeration_settings(self):
        """Project serialization should keep reader segmentation settings."""
        self.init_reader('basic_diagram_exaggerated.png')
        self.reader.column_starts = np.array([0, 7, 14])
        self.reader.segmentation_mode = 'guided'
        self.reader.target_colors = ['#F0C8C8', '#B40000']
        self.reader.exaggeration_merge_mode = 'selected-priority'
        self.reader.create_exaggerations_reader(
            2, extraction_mode='light-overlay-white',
            segmentation_mode='guided', target_colors=['#F0C8C8'],
            exaggeration_merge_mode='threshold-legacy')
        self.straditizer_widgets.refresh()

        for ending in ['.pkl', '.nc']:
            fname = self.get_random_filename(suffix=ending)
            self.straditizer_widgets.menu_actions.save_straditizer_as(fname)
            self.straditizer_widgets.menu_actions.open_straditizer(fname)
            self.assertEqual(self.reader.segmentation_mode, 'guided')
            self.assertEqual(
                self.reader.target_colors, ['#F0C8C8', '#B40000'])
            self.assertEqual(
                self.reader.exaggeration_merge_mode, 'selected-priority')
            self.assertEqual(
                self.reader.exaggerated_reader.segmentation_mode, 'guided')
            self.assertEqual(
                self.reader.exaggerated_reader.target_colors, ['#F0C8C8'])
            self.assertEqual(
                self.reader.exaggerated_reader.exaggeration_merge_mode,
                'threshold-legacy')
            self.assertGreaterEqual(self.reader.reader_schema_version, 2)
            self.assertGreaterEqual(
                self.reader.exaggerated_reader.reader_schema_version, 2)

    @unittest.skipIf(tesserocr is None, "requires tesserocr")
    def test_save_and_load_05_colnames(self):
        """Test the saving and loading of column names reader"""
        from PIL import Image
        from test_colnames import ColNamesTest
        self.init_reader('colnames_diagram.png', xlim=ColNamesTest.data_xlim,
                         ylim=ColNamesTest.data_ylim)
        self.reader.column_starts = ColNamesTest.column_starts
        self.straditizer.colnames_reader.highres_image = hr_image = Image.open(
            self.get_fig_path('colnames_diagram-colnames.png'))
        sw = self.straditizer_widgets
        sw.refresh()

        if not sw.colnames_manager.is_shown:
            QTest.mouseClick(sw.colnames_manager.btn_select_names,
                             Qt.LeftButton)

        sw.colnames_manager.find_colnames(
            warn=False, full_image=True, all_cols=True)
        colnames = self.straditizer.colnames_reader.column_names
        colpics = self.straditizer.colnames_reader.colpics
        self.assertEqual(colnames[0], 'Charcoal')
        self.assertEqual(colnames[1], 'Pinus')
        self.assertIsNotNone(colpics[0])
        self.assertIsNotNone(colpics[1])

        # save the straditizer
        for ending in ['.pkl', '.nc']:
            fname = self.get_random_filename(suffix=ending)
            sw.menu_actions.save_straditizer_as(fname)

            # load the straditizer
            sw.menu_actions.open_straditizer(fname)

            self.assertEqual(self.straditizer.colnames_reader.column_names,
                             colnames, msg='Ending: ' + ending)
            self.assertArrayEquals(self.straditizer.colnames_reader.colpics[0],
                                   colpics[0], msg='Ending: ' + ending)
            self.assertArrayEquals(self.straditizer.colnames_reader.colpics[1],
                                   colpics[1], msg='Ending: ' + ending)

            self.assertArrayEquals(
                self.straditizer.colnames_reader.image,
                self.straditizer.image, msg='Ending: ' + ending)
            self.assertArrayEquals(
                self.straditizer.colnames_reader.highres_image, hr_image,
                msg='Ending: ' + ending)

    def _test_save_and_load(self, ending, fname='basic_diagram.png'):
        # create a reader with samples
        self.init_reader(fname)
        self.reader.vline_locs = np.array([10])
        self.reader.hline_locs = np.array([10])
        self.reader.digitize()
        self.reader._get_sample_locs()
        self.straditizer_widgets.refresh()
        stradi = self.straditizer
        reader = stradi.data_reader

        # save the straditizer
        fname = self.get_random_filename(suffix=ending)
        self.straditizer_widgets.menu_actions.save_straditizer_as(fname)

        # load the straditizer
        self.straditizer_widgets.menu_actions.open_straditizer(fname)

        # check the loaded straditizer
        self.assertIsNot(self.straditizer, stradi)
        self.assertIsNot(self.reader, reader)
        self.assertFrameEqual(self.reader.sample_locs,
                              reader.sample_locs)
        self.assertEqual(self.reader.column_bounds.tolist(),
                         reader.column_bounds.tolist())
        self.assertFrameEqual(self.reader.full_df,
                              reader.full_df)
        self.assertEqual(list(self.reader.vline_locs),
                         list(reader.vline_locs))
        self.assertEqual(list(self.reader.hline_locs),
                         list(reader.hline_locs))
        return stradi

    def test_save_image(self):
        """Test the saving of the image"""
        self.open_img()
        fname = self.get_random_filename(suffix='.png')
        self.straditizer_widgets.menu_actions.save_full_image(fname)
        self.assertImageEquals(fname, self.straditizer.get_attr('image_file'))

    def test_save_binary_image(self):
        """Test the saving of the binary image"""
        self.init_reader()
        fname = self.get_random_filename(suffix='.png')
        self.straditizer_widgets.menu_actions.save_data_image(fname)
        self.assertImageEquals(
            fname, self.get_fig_path('basic_diagram_binary.png'))

    def test_export_final(self):
        """Test the exporting of the final DataFrame"""
        # create a reader with samples
        self.init_reader()
        self.reader.digitize()
        self.reader._get_sample_locs()
        fname = self.get_random_filename(suffix='.csv')
        self.straditizer_widgets.menu_actions.export_final(fname)
        self.assertTrue(osp.exists(fname), msg=fname + ' is missing!')
        exported = pd.read_csv(fname, index_col=0, comment='#')
        self.assertFrameEqual(
            exported, self.straditizer.final_df, check_index_type=False)

    def test_export_full_df(self):
        """Test the exporting of the final DataFrame"""
        # create a reader with samples
        self.init_reader()
        self.reader.digitize()
        fname = self.get_random_filename(suffix='.csv')
        self.straditizer_widgets.menu_actions.export_full(fname)
        self.assertTrue(osp.exists(fname), msg=fname + ' is missing!')
        exported = pd.read_csv(fname, index_col=0, comment='#')
        self.assertFrameEqual(
            exported, self.straditizer.full_df, check_index_type=False)

    def test_export_final_excel(self):
        """Excel export should keep working with modern pandas."""
        self.init_reader()
        self.reader.digitize()
        self.reader._get_sample_locs()
        fname = self.get_random_filename(suffix='.xlsx')

        self.straditizer_widgets.menu_actions.export_final(fname)

        self.assertTrue(osp.exists(fname), msg=fname + ' is missing!')
        exported = pd.read_excel(fname, sheet_name='Data', index_col=0)
        self.assertFrameEqual(
            exported, self.straditizer.final_df, check_index_type=False,
            check_dtype=False)

    def test_export_dialog_handles_qt_resize_with_integer_sizes(self):
        """The export dialog should not pass float sizes to Qt resize."""
        self.init_reader()

        with mock.patch.object(
                ExportDfDialog, 'exec_', autospec=True) as exec_:
            dialog = ExportDfDialog.export_df(
                self.straditizer_widgets, self.straditizer.full_df,
                self.straditizer, exec_=False)

        self.assertIsInstance(dialog, ExportDfDialog)
        self.assertFalse(exec_.called)

    def test_export_dialog_custom_index_name_and_linear_interpolation(self):
        """The dialog should resample full data and rename the index column."""
        self.init_reader()
        self.reader.digitize()
        dialog = ExportDfDialog.export_df(
            self.straditizer_widgets, self.straditizer.full_df,
            self.straditizer, exec_=False)
        fname = self.get_random_filename(suffix='.csv')
        dialog.txt_fname.setText(fname)
        dialog.cb_include_meta.setChecked(False)
        dialog.cb_mode.setCurrentText('Linear interpolation')
        dialog.txt_interval.setText('5')
        dialog.txt_index_name.setText('depth')
        dialog._export()

        exported = pd.read_csv(fname, index_col=0)
        self.assertEqual(exported.index.name, 'depth')
        self.assertLessEqual(len(exported), len(self.straditizer.full_df))
        self.assertEqual(list(exported.columns),
                         list(self.straditizer.full_df.columns))

    def test_export_dialog_bin_mean_reduces_sample_rows(self):
        """Bin-mean export should aggregate the sample dataframe."""
        self.init_reader()
        self.reader.digitize()
        self.reader._get_sample_locs()
        dialog = ExportDfDialog.export_df(
            self.straditizer_widgets, self.straditizer.final_df,
            self.straditizer, exec_=False)
        fname = self.get_random_filename(suffix='.csv')
        dialog.txt_fname.setText(fname)
        dialog.cb_include_meta.setChecked(False)
        dialog.cb_mode.setCurrentText('Bin mean')
        dialog.txt_interval.setText('10')
        dialog._export()

        exported = pd.read_csv(fname, index_col=0)
        self.assertLessEqual(len(exported), len(self.straditizer.final_df))
        self.assertEqual(list(exported.columns),
                         list(self.straditizer.final_df.columns))

    def test_export_dialog_sliding_bin_mean_uses_centered_windows(self):
        """Sliding-bin export should produce centered aggregated rows."""
        values = np.arange(600, dtype=float)
        df = pd.DataFrame(
            {0: values,
             1: values * 2.0},
            index=pd.Index(values, name='depth'))

        exported = ExportDfDialog.resample_dataframe(
            df, mode='Sliding bin mean', interval=3.0, index_name='depth')

        self.assertEqual(exported.index.name, 'depth')
        self.assertLessEqual(len(exported), len(df))
        self.assertTrue(np.all(np.diff(exported.index.values) >= 0))
        self.assertGreater(exported.iloc[0, 0], df.iloc[0, 0])

    def test_export_dialog_original_mode_preserves_small_dataframe(self):
        """Original mode should leave the dataframe unchanged."""
        df = pd.DataFrame(
            {0: [1.0, 2.0], 1: [3.0, 4.0]},
            index=pd.Index([0.0, 1.0], name='depth'))

        exported = ExportDfDialog.resample_dataframe(
            df, mode='Original', interval=1.0,
            index_name='depth')

        self.assertFrameEqual(exported, df)

    def test_export_dialog_supports_translated_numeric_index(self):
        """Resampling should keep working when the y-index is translated."""
        df = pd.DataFrame(
            {0: [0.0, 10.0, 20.0, 30.0]},
            index=pd.Index([100.0, 110.0, 120.0, 130.0], name='age'))

        exported = ExportDfDialog.resample_dataframe(
            df, mode='Bin mean', interval=15.0, index_name='age')

        self.assertEqual(exported.index.name, 'age')
        self.assertTrue(np.all(np.diff(exported.index.values) >= 0))

    def test_export_dialog_defaults_index_name_to_age(self):
        """Export defaults to age when the source index name is missing."""
        self.init_reader()
        self.reader.digitize()
        dialog = ExportDfDialog.export_df(
            self.straditizer_widgets, self.straditizer.full_df.rename_axis(None),
            self.straditizer, exec_=False)
        fname = self.get_random_filename(suffix='.csv')
        dialog.txt_fname.setText(fname)
        dialog.cb_include_meta.setChecked(False)
        dialog.cb_mode.setCurrentText('Linear interpolation')
        dialog.txt_interval.setText('8')
        dialog._export()

        exported = pd.read_csv(fname, index_col=0)
        self.assertEqual(exported.index.name, 'age')


if __name__ == '__main__':
    unittest.main()
