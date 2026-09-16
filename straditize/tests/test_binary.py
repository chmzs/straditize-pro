# -*- coding: utf-8 -*-
"""
Test module for the :mod:`straditize.binary` module
"""
import six
import types
import unittest
import warnings
from itertools import chain, starmap
from unittest import mock
import numpy as np
from straditize import binary
import pandas as pd
from pandas.testing import assert_frame_equal
import create_test_sample as ct
import matplotlib as mpl
from PIL import Image

mpl.use('module://psyplot_gui.backend')


class AlmostArrayEqualMixin(object):

    def assertAlmostArrayEqual(self, actual, desired, rtol=1e-07, atol=0,
                               msg=None, **kwargs):
        """Asserts that the two given arrays are almost the same

        This method uses the :func:`numpy.testing.assert_allclose` function
        to compare the two given arrays.

        Parameters
        ----------
        actual : array_like
            Array obtained.
        desired : array_like
            Array desired.
        rtol : float, optional
            Relative tolerance.
        atol : float, optional
            Absolute tolerance.
        equal_nan : bool, optional.
            If True, NaNs will compare equal.
        err_msg : str, optional
            The error message to be printed in case of failure.
        verbose : bool, optional
            If True, the conflicting values are appended to the error message.
        """
        try:
            np.testing.assert_allclose(actual, desired, rtol=rtol, atol=atol,
                                       err_msg=msg or '', **kwargs)
        except (Exception, AssertionError) as e:
            self.fail(e if six.PY3 else e.message)

    def assertFrameEqual(self, actual, desired, *args, **kwargs):
        """Assert that two data frames are equal."""
        try:
            assert_frame_equal(actual, desired, *args, **kwargs)
        except (Exception, AssertionError) as e:
            self.fail(e if six.PY3 else e.message)

    def assertArrayEquals(self, actual, desired, *args, **kwargs):
        """Assert that two arrays are equal."""
        try:
            np.testing.assert_array_equal(actual, desired, *args, **kwargs)
        except (Exception, AssertionError) as e:
            self.fail(e if six.PY3 else e.message)


class DataReaderTest(unittest.TestCase, AlmostArrayEqualMixin):

    def setUp(self, seed=1234, plot=True):
        if seed is not None:
            np.random.seed(seed)
        self.sample = ct.TestSample.from_random(400, 400, 10, 20)
        self.reader = binary.DataReader(self.sample.get_binary(), plot=plot)

    def tearDown(self):
        import matplotlib.pyplot as plt
        plt.close('all')
        del self.sample, self.reader

    nsamples = 2

    def test_column_bounds(self):
        """Test whether the column bounds are identified correctly
        """
        reader = self.reader
        reader._get_column_starts()
        col_starts = self.sample.col_starts
        self.assertEqual(len(reader.column_bounds[:, 0]), len(col_starts),
                         msg='bounds: %s\nref: %s' % (reader.column_starts,
                                                      col_starts))
        self.assertTrue(
            np.all(reader.column_starts <= col_starts),
            msg=("Reader:  %s\n"
                 "Data:    %s\n"
                 "Smaller: %s\n") % (
                    reader.column_starts, col_starts,
                    reader.column_starts <= col_starts))

    def test_find_potential_samples(self):
        """Test whether the extrema are found correctly"""
        reader = self.reader
        df = self.sample.df
        col = df[1]
        minima_mask = np.r_[[False], (col.values[1:-1] < col.values[2:]) & (
            col.values[1:-1] < col.values[:-2]), [False]]
        maxima_mask = np.r_[[False], (col.values[1:-1] > col.values[2:]) & (
            col.values[1:-1] > col.values[:-2]), [False]]
        extrema = sorted(col.index.values[minima_mask | maxima_mask])
        reader.digitize()
        reader_extrema = list(starmap(
            np.arange, reader.find_potential_samples(1)[0]))
        flattened = sorted(chain.from_iterable(reader_extrema))
        self.assertEqual(len(reader_extrema), len(extrema),
                         msg='\nEstimated: %s\nReference: %s' % (
                            reader_extrema, extrema))
        for i, (ext, possibilities) in enumerate(zip(extrema, reader_extrema)):
            self.assertIn(ext, possibilities)
        self.assertLessEqual(
            set(extrema), set(flattened),
            msg=('\nReader:  %s\n'
                 'Data:    %s\n'
                 'missing: %s') % (
                    reader_extrema, extrema,
                    sorted(set(extrema) - set(flattened))))

    def test_standard_extraction_mode_still_drops_light_overlay_pixels(self):
        """The default extraction mode should keep the historic thresholding."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [255, 220, 220, 255],
            [180, 0, 0, 255],
        ]], dtype=np.uint8), mode='RGBA')

        mask = binary.DataReader.to_binary_pil(image)

        self.assertEqual(mask.tolist(), [[0, 0, 1]])

    def test_light_overlay_white_mode_preserves_pale_colored_pixels(self):
        """Light-overlay mode should keep pale colored pixels on white."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [255, 220, 220, 255],
            [180, 0, 0, 255],
        ]], dtype=np.uint8), mode='RGBA')

        mask = binary.DataReader.to_binary_pil(
            image, extraction_mode='light-overlay-white')

        self.assertEqual(mask.tolist(), [[0, 1, 1]])

    def test_reader_accepts_explicit_extraction_mode(self):
        """Readers should store the requested extraction mode."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [255, 220, 220, 255],
        ]], dtype=np.uint8), mode='RGBA')

        reader = binary.DataReader(image, plot=False,
                                   extraction_mode='light-overlay-white')

        self.assertEqual(reader.extraction_mode, 'light-overlay-white')

    def test_reader_accepts_guided_segmentation_and_target_colors(self):
        """Readers should normalize guided segmentation configuration."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [240, 200, 200, 255],
        ]], dtype=np.uint8), mode='RGBA')

        reader = binary.DataReader(
            image, plot=False, segmentation_mode='guided',
            target_colors=['f0c8c8', '#B40000'],
            exaggeration_merge_mode='threshold-legacy')

        self.assertEqual(reader.segmentation_mode, 'guided')
        self.assertEqual(reader.target_colors, ['#F0C8C8', '#B40000'])
        self.assertEqual(reader.exaggeration_merge_mode, 'threshold-legacy')

    def test_guided_segmentation_preserves_requested_target_color_family(self):
        """Guided segmentation should retain requested pale target colors."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [240, 200, 200, 255],
            [200, 220, 255, 255],
        ]], dtype=np.uint8), mode='RGBA')

        mask = binary.DataReader.to_binary_pil(
            image, extraction_mode='standard', segmentation_mode='guided',
            target_colors=['#F0C8C8'])

        self.assertEqual(mask.tolist(), [[0, 1, 0]])

    def test_light_overlay_mode_suggests_and_adds_exaggeration_pixels(self):
        """Light-overlay mode should seed exagg pixels missing from standard."""
        image = np.full((12, 14, 4), 255, dtype=np.uint8)
        image[2:10, 2:5, :-1] = [180, 0, 0]
        image[2:10, 6:10, :-1] = [255, 220, 220]
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        exag = reader.create_exaggerations_reader(
            2, extraction_mode='light-overlay-white')

        expected = np.zeros(reader.binary.shape, dtype=bool)
        expected[2:10, 6:10] = True

        np.testing.assert_equal(reader.suggest_exaggeration_mask(), expected)

        reader.mark_as_exaggerations(expected)

        np.testing.assert_equal(exag.binary.astype(bool), expected)
        self.assertTrue(reader.binary[2:10, 2:5].all())
        self.assertFalse(reader.binary[expected].any())

    def test_light_overlay_mode_suggests_same_hue_pixels_inside_main_binary(self):
        """Light-overlay mode should split pale same-hue foreground in-place."""
        image = np.full((12, 14, 4), 255, dtype=np.uint8)
        image[2:10, 2:6, :-1] = [180, 0, 0]
        image[2:10, 6:10, :-1] = [240, 200, 200]
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        exag = reader.create_exaggerations_reader(
            2, extraction_mode='light-overlay-white')

        expected = np.zeros(reader.binary.shape, dtype=bool)
        expected[2:10, 6:10] = True
        primary = np.zeros(reader.binary.shape, dtype=bool)
        primary[2:10, 2:6] = True

        np.testing.assert_equal(reader.binary[expected], 1)
        np.testing.assert_equal(reader.suggest_exaggeration_mask(), expected)

        reader.mark_as_exaggerations(expected)

        np.testing.assert_equal(exag.binary.astype(bool), expected)
        self.assertTrue(reader.binary[primary].all())
        self.assertFalse(reader.binary[expected].any())

    def test_light_overlay_mode_keeps_uniform_dark_foreground_unselected(self):
        """Uniform dark foreground should not produce false exagg candidates."""
        image = np.full((12, 14, 4), 255, dtype=np.uint8)
        image[2:10, 2:10, :-1] = [180, 0, 0]
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        reader.create_exaggerations_reader(2, extraction_mode='light-overlay-white')

        self.assertFalse(reader.suggest_exaggeration_mask().any())

    def test_guided_target_colors_focus_same_hue_exaggeration_candidates(self):
        """Guided target colors should focus same-hue exaggeration candidates."""
        image = np.full((12, 14, 4), 255, dtype=np.uint8)
        image[2:10, 1:5, :-1] = [180, 0, 0]
        image[2:10, 5:9, :-1] = [240, 200, 200]
        image[2:10, 9:12, :-1] = [200, 220, 255]
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        exag = reader.create_exaggerations_reader(
            2, extraction_mode='light-overlay-white',
            segmentation_mode='guided', target_colors=['#F0C8C8'])

        expected = np.zeros(reader.binary.shape, dtype=bool)
        expected[2:10, 5:9] = True
        nuisance = np.zeros(reader.binary.shape, dtype=bool)
        nuisance[2:10, 9:12] = True

        self.assertEqual(exag.segmentation_mode, 'guided')
        np.testing.assert_equal(reader.suggest_exaggeration_mask(), expected)
        self.assertFalse(reader.suggest_exaggeration_mask()[nuisance].any())

    def test_digitize_exaggerated_selected_priority_overrides_selected_rows(self):
        """Selected-priority merge should overwrite rows selected as exagg."""
        image = np.full((3, 12, 4), 255, dtype=np.uint8)
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        reader.columns = [0]
        reader._column_starts = np.array([0])
        reader._column_ends = np.array([12])
        reader.full_df = pd.DataFrame({0: [10., 5., 1.]})
        exag = reader.create_exaggerations_reader(
            2, exaggeration_merge_mode='selected-priority')
        exag.binary = np.zeros_like(reader.binary)
        exag.binary[0:2, :6] = 1

        values = pd.DataFrame({0: [4., 8., 0.]})
        exag.digitize = types.MethodType(
            lambda self, inplace=False: values.copy(True), exag)

        merged, mask = reader.digitize_exaggerated(
            inplace=False, return_mask=True)

        self.assertFrameEqual(
            merged, pd.DataFrame({0: [2., 4., 1.]}),
            check_dtype=False)
        self.assertArrayEquals(
            mask.values, np.array([[True], [True], [False]]))

    def test_digitize_exaggerated_threshold_legacy_still_uses_thresholds(self):
        """Legacy exaggeration merge should still honor low-value thresholds."""
        image = np.full((3, 12, 4), 255, dtype=np.uint8)
        image[..., -1] = 255
        image = Image.fromarray(image, mode='RGBA')

        reader = binary.DataReader(image, plot=False)
        reader.columns = [0]
        reader._column_starts = np.array([0])
        reader._column_ends = np.array([12])
        reader.full_df = pd.DataFrame({0: [10., 2., 1.]})
        exag = reader.create_exaggerations_reader(
            2, exaggeration_merge_mode='threshold-legacy')
        exag.binary = np.zeros_like(reader.binary)
        exag.binary[:, :6] = 1

        values = pd.DataFrame({0: [4., 8., 2.]})
        exag.digitize = types.MethodType(
            lambda self, inplace=False: values.copy(True), exag)

        merged, mask = reader.digitize_exaggerated(
            absolute=3, inplace=False, return_mask=True)

        self.assertFrameEqual(
            merged, pd.DataFrame({0: [10., 4., 1.]}),
            check_dtype=False)
        self.assertArrayEquals(
            mask.values, np.array([[False], [True], [True]]))

    def test_line_reader_digitize_uses_centerline_trace(self):
        """Line reader should trace centerline, not rightmost area boundary."""
        binary_image = np.zeros((10, 12), dtype=np.int8)
        binary_image[:, 2:7] = 1

        area = binary.DataReader(binary_image, plot=False)
        area.columns = [0]
        area._column_starts = np.array([0])
        area._column_ends = np.array([12])
        area.digitize()

        line = binary.LineDataReader(binary_image, plot=False)
        line.columns = [0]
        line._column_starts = np.array([0])
        line._column_ends = np.array([12])
        line.digitize()

        self.assertTrue(np.all(line.full_df.values < area.full_df.values))
        self.assertAlmostArrayEqual(
            line.full_df.values.flatten(),
            np.full(10, 5.0), atol=0.5)

    def test_reader_schema_version_roundtrip(self):
        """Reader schema version should be serialized and restored."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [180, 0, 0, 255],
        ]], dtype=np.uint8), mode='RGBA')
        reader = binary.DataReader(image, plot=False)
        ds = reader.to_dataset()
        self.assertIn('reader_schema_version', ds)
        loaded = binary.DataReader.from_dataset(ds)
        self.assertEqual(
            loaded.reader_schema_version, reader.reader_schema_version)

    def test_reader_schema_version_defaults_to_legacy_without_field(self):
        """Older saved datasets without schema version default to 1."""
        image = Image.fromarray(np.array([[
            [255, 255, 255, 255],
            [180, 0, 0, 255],
        ]], dtype=np.uint8), mode='RGBA')
        reader = binary.DataReader(image, plot=False)
        ds = reader.to_dataset()
        ds = ds.drop_vars('reader_schema_version')
        loaded = binary.DataReader.from_dataset(ds)
        self.assertEqual(loaded.reader_schema_version, 1)

    def test_full_data_roundtrip_with_custom_length_and_index(self):
        """Serialized full data should not share the reader-image y-dim."""
        self.reader._get_column_starts()
        self.reader.digitize()

        trimmed = self.reader.full_df.iloc[::3].copy()
        trimmed.index = np.arange(1000, 1000 + len(trimmed) * 2, 2)
        self.reader._full_df = trimmed

        ds = self.reader.to_dataset()

        self.assertEqual(
            ds['full_data'].dims,
            ('full_data_y', 'column'))
        self.assertEqual(
            ds['full_data_y'].dims,
            ('full_data_y',))
        self.assertArrayEquals(
            ds['full_data_y'].values,
            trimmed.index.values)

        loaded = binary.DataReader.from_dataset(ds)
        self.assertFrameEqual(
            loaded._full_df, trimmed, check_dtype=False)

    def test_obstacle_01_alternation_min(self):
        """Test whether the alternation is identified correctly in a minimum"""
        # a looks like
        #     /            _   /
        #    / \         _/ \ /
        #   /  \  _ _   /   \/
        # _/   \__ _ __/
        #
        a = np.array([
            1, 1, 2, 3, 4, 5,     # 0-6: increase
            3, 2,                 # 6-8: decrease
            1, 1, 2, 1, 2, 1, 1,  # 8-15: alternation
            2, 3, 3, 4, 4,        # 15-20: increase
            3, 2,                 # 20-22: decrease
            3, 4, 5               # 22-25: increase
            ])
        self.reader.columns = [0]
        self.reader._full_df = pd.DataFrame(a[:, np.newaxis])
        extrema, excluded = self.reader.find_potential_samples(0)
        # this should now give the following extrema
        reference = [
            [5, 6],       # maximum at 5
            [8, 15],      # minimum at 1
            [18, 20],     # maximum at 4
            [21, 22]      # minimum at 2
            ]
        self.assertEqual(extrema, reference)
        # excluded should be between the obstacles
        # the middle will be included because of a slope change
        ref_excluded = [[8, 10], [13, 15]]
        self.assertEqual(excluded, ref_excluded)

    def test_obstacle_02_alternation_max(self):
        """Test whether the alternation is identified correctly in a maximum"""
        # a looks like
        #         _  __
        # \      _ __  __
        #  \    /        \
        #   \  /          \   /\
        #    \/            \_/  \
        #
        a = np.array([
            5, 4, 3, 2, 1,           # 0-5: decrease
            2, 3, 4,                 # 5-8: increase
            4, 5, 4, 4, 5, 5, 4, 4,  # 8-16: alternation
            3, 2, 1, 1,              # 16-20: decrease
            2, 3,                    # 20-22: increase
            2, 1                     # 22-24: decrease
            ])
        self.reader.columns = [0]
        self.reader._full_df = pd.DataFrame(a[:, np.newaxis])
        extrema, excluded = self.reader.find_potential_samples(0)
        reference = [
            [4, 5],      # minimum at 1
            [7, 16],     # maximum at 4
            [18, 20],    # minimum at
            [21, 22]     # maximum at 3
            ]
        self.assertEqual(extrema, reference)
        # excluded should be the maxima of the obstacles
        # the middle will be included because of a slope change
        ref_excluded = [[9, 10], [12, 14]]
        self.assertEqual(excluded, ref_excluded)

    def test_obstacle_03_wrong_slope_up(self):
        """Test whether obstacles in an upward slope can be identified"""
        # a looks like
        #         /\
        #        /  \    /
        #       /|   \  /
        #      /      \/
        #     /|_
        # \__/
        a = np.array([
            2, 1, 1,     # 0-3: decrease
            1, 2, 3,     # 3-6: increase
            2, 2,        # 6-8: obstacle
            3, 4, 5,     # 8-11: increase
            4,           # 11-12: obstacle
            6, 7,        # 12-14: maximum
            6, 5, 4, 3,  # 14-18: decrease
            4, 5, 6      # 18-21: increase
            ])
        self.reader.columns = [0]
        self.reader._full_df = pd.DataFrame(a[:, np.newaxis])
        extrema, excluded = self.reader.find_potential_samples(0)
        reference = [
            [1, 4],
            [13, 14],   # maximum at 7
            [17, 18],   # minimum at 3
            ]
        self.assertEqual(extrema, reference)
        # excluded should be the top of the obstacles and their surroundings
        # the middle will be included because of a slope change
        ref_excluded = [[5, 6], [6, 8], [10, 11], [11, 12]]
        self.assertEqual(excluded, ref_excluded)

    def test_obstacle_04_wrong_slope_down(self):
        """Test whether obstacles in an downward slope can be identified"""
        # a looks like
        #   _
        #  / \
        # /   \
        #      |
        #      |_\     /\
        #         \   /  \
        #          \_/
        a = np.array([
            5, 6, 7, 7,     # 0-4: increase
            6, 5,           # 4-6: decrease
            3,              # 6-7: obstacle
            4, 3, 2, 1, 1,  # 7-12: decrease
            2, 3, 4,        # 12-15: increase
            3, 2            # 15-17: decrease
            ])
        self.reader.columns = [0]
        self.reader._full_df = pd.DataFrame(a[:, np.newaxis])
        extrema, excluded = self.reader.find_potential_samples(0)
        reference = [
            [2, 4],    # maximum at 7
            [10, 12],  # minimum at 1
            [14, 15]   # maximum at 4
            ]
        self.assertEqual(extrema, reference)
        # excluded should be the bottom of the obstacles and their surrounding
        # the middle will be included because of a slope change
        ref_excluded = [[6, 7], [7, 8]]
        self.assertEqual(excluded, ref_excluded)

    def test_find_samples(self, fail_fast=False):
        """Test the finding and alignment of samples

        This computationally rather intense test method tests, whether we are
        able to find samples. We do not expect our software to exactly
        reproduce the samples because there are several challenges to it:

        1. potential samples (i.e. extrema) might be spread out over quite
           a long distance
        2. the exact location of the sample might vary by some pixels
        3. when encountering a 0, it is sometimes difficult to merge it exactly
           with the other columns.

        Parameters
        ----------
        fail_fast: bool
            If True, fail immediately after the first, otherwise fail after
            more than two wrong sample reconstructions
        """
        def test():
            self.reader.digitize()
            ref = self.sample.df.index
            samples = self.reader.find_samples(max_len=6, pixel_tol=2)[0].index
            self.assertAlmostArrayEqual(
                ref.shape, samples.shape, atol=2,
                msg='Failed at iteration %i' % i)
            missing = []
            for m in ref:
                if np.abs(samples-m).min() > 4:
                    missing.append(m)
            if len(missing) > 1:
                msg = 'Failed at iteration %i. %s not found in %s' % (
                    i, missing, samples)
                if fail_fast:
                    self.fail(msg)
                else:
                    failed.append(msg)
                if len(failed) > 2:
                    self.fail('Failed in too many iterations!\n' +
                              '\n'.join(failed))
        i = 0
        test()
        failed = []
        for i in range(1, self.nsamples):
            self.tearDown()
            self.setUp(seed=None, plot=False)
            test()

    def test_close_is_idempotent(self):
        reader = binary.DataReader(np.ones((4, 4), dtype=bool), plot=False)
        reader.close()
        reader.close()

    def test_recognize_xaxes_ignores_zero_row_ratio(self):
        reader = binary.DataReader(np.zeros((8, 8), dtype=bool), plot=False)
        with mock.patch.object(reader, '_show_parts2remove'):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                reader.recognize_xaxes(fraction=-1)
        runtime_warnings = [
            warning for warning in caught
            if warning.category is RuntimeWarning
        ]
        self.assertFalse(runtime_warnings)

    def test_set_hline_locs_from_selection_without_runtimewarning(self):
        """Zero-valued rows should not trigger divide warnings."""
        image = np.array([[0, 0, 0],
                          [1, 1, 0],
                          [0, 0, 0]], dtype=np.int8)
        reader = binary.DataReader(image, plot=False)
        selection = image.astype(bool)

        with warnings.catch_warnings():
            warnings.simplefilter('error', RuntimeWarning)
            reader.set_hline_locs_from_selection(selection)

        self.assertEqual(reader.hline_locs.tolist(), [1])

    def test_set_vline_locs_from_selection_without_runtimewarning(self):
        """Zero-valued columns should not trigger divide warnings."""
        image = np.array([[0, 1, 0],
                          [0, 1, 0],
                          [0, 0, 0]], dtype=np.int8)
        reader = binary.DataReader(image, plot=False)
        selection = image.astype(bool)

        with warnings.catch_warnings():
            warnings.simplefilter('error', RuntimeWarning)
            reader.set_vline_locs_from_selection(selection)

        self.assertEqual(reader.vline_locs.tolist(), [1])

    def test_init_2d_int8_image_without_overflow(self):
        """2D int8 masks should still become an RGBA preview image."""
        image = np.ones((3, 3), dtype=np.int8)

        reader = binary.DataReader(image, plot=False)

        rgba = np.asarray(reader.image)
        self.assertEqual(rgba.dtype, np.uint8)
        self.assertEqual(rgba.shape, (3, 3, 4))
        self.assertTrue(np.all(rgba[..., :-1] == 255))
        self.assertTrue(np.all(rgba[..., -1] == 255))
        self.assertTrue(np.array_equal(reader.binary, image))

    def test_plot_results_uses_headless_figure_helper(self):
        """Headless plot rendering should avoid pyplot figure managers."""
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        class _BlockSignals(object):
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class _FakeProject(object):
            def __init__(self, axis):
                self._array = types.SimpleNamespace(
                    psy=types.SimpleNamespace(update=mock.Mock()))
                self.axes = {
                    axis: types.SimpleNamespace(update=mock.Mock())}
                self.main = object()

            def __getitem__(self, key):
                return self._array

        reader = binary.DataReader(np.array([[1, 0], [0, 1]], dtype=np.int8),
                                   plot=False)
        reader.all_column_starts = np.array([0])
        reader.all_column_ends = np.array([2])
        reader.columns = [0]
        df = pd.DataFrame({0: [0.25, 0.75]}, index=[0, 1])

        fig = Figure()
        FigureCanvasAgg(fig)
        axis = fig.subplots()
        grouper = types.SimpleNamespace(
            axes=[axis],
            plotter_arrays=[types.SimpleNamespace(
                psy=types.SimpleNamespace(arr_name='0'))])
        reader.create_grouper = mock.Mock(return_value=grouper)

        import psyplot.project as psy

        with mock.patch(
                'straditize.straditizer.should_use_headless_figure',
                return_value=True), \
                mock.patch(
                    'straditize.straditizer.create_matplotlib_figure',
                    return_value=fig) as create_fig, \
                mock.patch(
                    'matplotlib.pyplot.figure',
                    side_effect=AssertionError(
                        'pyplot.figure should not be used')), \
                mock.patch.object(
                    psy.Project, 'block_signals', _BlockSignals()), \
                mock.patch.object(
                    psy, 'gcp',
                    return_value=lambda **kwargs: _FakeProject(axis)), \
                mock.patch.object(psy, 'scp') as scp:
            sp, groupers = reader.plot_results(df)

        create_fig.assert_called_once_with(headless=True)
        scp.assert_not_called()
        self.assertIs(groupers[0], grouper)
        self.assertIsNotNone(sp)

    def test_plot_results_overlay_area_uses_background_fill_and_line(self):
        """Area overlays should draw the image, fill, and boundary line."""
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        reader = binary.DataReader(np.ones((6, 8), dtype=np.int8), plot=False,
                                   extent=[2, 10, 6, 0])
        reader.columns = [0]
        reader.all_column_starts = np.array([0])
        reader._full_df = pd.DataFrame({0: [1.0, 2.0, 3.0]}, index=[0, 1, 2])

        fig = Figure()
        FigureCanvasAgg(fig)
        ax = fig.subplots()
        image = np.zeros((8, 12, 4), dtype=np.uint8)

        fig, ax, artists = reader.plot_results_overlay(
            reader._full_df, ax=ax, samples=False, image=image,
            image_extent=[0, 12, 8, 0])

        self.assertIs(artists['image'], ax.images[0])
        self.assertEqual(len(artists['fills']), 1)
        self.assertEqual(len(artists['lines']), 1)

    def test_plot_results_overlay_line_draws_lines_without_fill(self):
        """Line overlays should not add area fills."""
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        reader = binary.LineDataReader(
            np.ones((6, 8), dtype=np.int8), plot=False, extent=[0, 8, 6, 0])
        reader.columns = [0]
        reader.all_column_starts = np.array([0])
        reader._full_df = pd.DataFrame({0: [2.0, 3.0, 1.0]}, index=[0, 1, 2])

        fig = Figure()
        FigureCanvasAgg(fig)
        ax = fig.subplots()

        _, _, artists = reader.plot_results_overlay(
            reader._full_df, ax=ax, samples=False)

        self.assertEqual(len(artists['fills']), 0)
        self.assertEqual(len(artists['lines']), 1)

    def test_plot_results_overlay_bar_samples_use_rough_locations(self):
        """Bar sample overlays should use the rough sample spans."""
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        reader = binary.BarDataReader(
            np.ones((12, 8), dtype=np.int8), plot=False, extent=[1, 9, 12, 0])
        reader.columns = [0]
        reader.all_column_starts = np.array([0])
        reader._sample_locs = pd.DataFrame({0: [2.0, 4.0]}, index=[5.0, 9.0])
        reader._rough_locs = pd.DataFrame(
            [[4.0, 7.0], [8.0, 11.0]], index=reader._sample_locs.index,
            columns=pd.MultiIndex.from_product([[0], ['vmin', 'vmax']]))

        fig = Figure()
        FigureCanvasAgg(fig)
        ax = fig.subplots()

        _, _, artists = reader.plot_results_overlay(
            reader.sample_locs, ax=ax, samples=True)

        self.assertEqual(len(artists['fills']), 2)
        self.assertEqual(len(artists['lines']), 2)

    def test_bar_reader_keeps_tapered_endcaps_in_single_bar(self):
        """Bar endpoint ramps should stay attached to one detected bar."""
        reader = binary.BarDataReader(
            np.ones((12, 2), dtype=np.int8), plot=False, extent=[0, 2, 12, 0])
        reader.tolerance = 1

        arr = np.array([0, 0, 1, 2, 4, 4, 4, 4, 2, 1, 0, 0], dtype=float)

        indices, heights, splitted = reader.get_bars(arr)

        self.assertEqual(indices, [[2, 10]])
        self.assertEqual(heights, [4.0])
        self.assertEqual(splitted, [])


if __name__ == '__main__':
    unittest.main()
