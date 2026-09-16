# -*- coding: utf-8 -*-
"""The main control widget for handling the data

**Disclaimer**

Copyright (C) 2018-2019  Philipp S. Sommer

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
"""
from __future__ import division
import warnings
import weakref
import os.path as osp
import six
from functools import partial
import re
import numpy as np
import pickle
import pandas as pd
import xarray as xr
from straditize import binary
from straditize.widgets import StraditizerControlBase, get_icon
from straditize.straditizer import (
    create_matplotlib_figure, get_toolbar_mode, should_use_headless_figure)
from psyplot_gui.compat.qtcompat import (
    QPushButton, QLineEdit, QComboBox, QLabel, QDoubleValidator,
    Qt, QHBoxLayout, QVBoxLayout, QWidget, QTreeWidgetItem,
    with_qt5, QIcon, QIntValidator, QTreeWidget, QToolBar, QGridLayout,
    QCheckBox, QInputDialog, QFileDialog, QMessageBox)
from straditize.common import docstrings, nearest_index_position
from psyplot.utils import unique_everseen
from itertools import chain

if with_qt5:
    from PyQt5.QtWidgets import QGroupBox, QSpinBox
else:
    from PyQt4.QtGui import QGroupBox, QSpinBox

if six.PY2:
    from itertools import (
        izip_longest as zip_longest, ifilterfalse as filterfalse)
else:
    from itertools import zip_longest, filterfalse


reader_types = ['area', 'bars', 'rounded bars', 'stacked area',
                'line']

full_data_mark_palette = {
    'required': '#ff9f1c',
    'auto': '#00bcd4',
    'manual': '#d81b60',
    'selected': '#e53935',
}

extraction_mode_items = [
    ('Standard', 'standard'),
    ('Light overlay on white background', 'light-overlay-white'),
    ('Dark ink on light background', 'dark-ink-light'),
    ('Light ink on dark background', 'light-ink-dark'),
]
extraction_mode_labels = dict(extraction_mode_items)

segmentation_mode_items = [
    ('Auto', 'auto'),
    ('Guided', 'guided'),
]
segmentation_mode_labels = dict(segmentation_mode_items)

merge_mode_items = [
    ('Selected region priority', 'selected-priority'),
    ('Threshold merge (legacy)', 'threshold-legacy'),
]
merge_mode_labels = dict(merge_mode_items)


def get_extraction_mode_label(mode):
    """Return the user-facing label for an extraction mode identifier."""
    mode = binary.DataReader.normalize_extraction_mode(mode)
    for label, value in extraction_mode_items:
        if value == mode:
            return label
    return 'Standard'


def get_segmentation_mode_label(mode):
    """Return the user-facing label for a segmentation mode identifier."""
    mode = binary.DataReader.normalize_segmentation_mode(mode)
    for label, value in segmentation_mode_items:
        if value == mode:
            return label
    return 'Auto'


def get_merge_mode_label(mode):
    """Return the user-facing label for an exaggeration merge mode."""
    mode = binary.DataReader.normalize_exaggeration_merge_mode(mode)
    for label, value in merge_mode_items:
        if value == mode:
            return label
    return 'Selected region priority'


def int_list2str(numbers):
    """Create a short string representation of an integer list

    Parameters
    ----------
    numbers: list of ints
        Integer list

    Returns
    -------
    str
        The string representation

    Examples
    --------
    ``[1, 2, 3]`` becomes ``'1-3'``,
    ``[1, 2, 3, 5, 7, 8, 9]`` becomes ``'1-3, 5, 7-9'``"""
    numbers = sorted(map(int, numbers))
    s = str(numbers[0])
    for last, curr, nex in zip_longest(numbers[:-1], numbers[1:], numbers[2:]):
        if curr - last <= 1 and nex and nex - curr <= 1:
            continue
        elif curr - last <= 1:
            s += '-%s' % curr
        else:
            s += ', %s' % curr
    return s


def get_reader_name(reader):
    """Get the reader key in the :attr:`straditize.binary.readers` dictionary

    Parameters
    ----------
    reader: straditize.binary.DataReader
        The reader for which to get the key in the
        :attr:`straditize.binary.readers` dictionary

    Returns
    -------
    str
        The key in the :attr:`straditize.binary.readers` dictionary whose value
        corresponds to the class of the given `reader`"""
    from straditize.binary import readers
    # import stacked_area_reader to make sure StackedReader is registered
    import straditize.widgets.stacked_area_reader
    for key, cls in readers.items():
        if reader.__class__ is cls:
            return key


class DigitizingControl(StraditizerControlBase):
    """An interface to :attr:`straditize.straditizer.Straditizer.data_reader`

    This widgets contains the functionalities to interface with the data
    readers for the stratigraphic diagram"""

    @property
    def reader(self):
        """The :attr:`straditize.straditizer.Straditizer.data_reader`"""
        return self.straditizer.data_reader

    @property
    def tree(self):
        """The :attr:`straditize.widgets.StraditizerWidgets.tree`"""
        return self.straditizer_widgets.tree

    # --- Reader intialization ------------------------------------------------

    #: Button for selecting the data box, see the
    #: :meth:`straditize.straditizer.Straditizer.marks_for_data_selection`
    #: method.
    btn_select_data = None

    #: Combobox for selecting the reader type
    cb_reader_type = None

    #: Combobox for selecting the extraction mode of the main reader
    cb_extraction_mode = None

    #: Combobox for selecting the segmentation mode of the main reader
    cb_segmentation_mode = None

    #: Line edit for target colors of the main reader
    txt_target_colors = None

    #: Button to pick target colors from the current image
    btn_pick_target_color = None

    #: Button to remove the last target color entry
    btn_pop_target_color = None

    #: Button to clear all target colors
    btn_clear_target_colors = None

    #: Button for initializing the reader
    btn_init_reader = None

    # --- Columns -------------------------------------------------------------

    #: A QLineEdit to set the threshold for the column starts detection
    txt_column_thresh = None

    #: Button for selecting and modifying column starts, see the
    #: :meth:`straditize.straditizer.Straditizer.marks_for_column_starts`
    #: method.
    btn_column_starts = None

    #: Button for selecting and modifying column ends
    btn_column_ends = None

    #: Button to reset the column starts and ends
    btn_reset_columns = None

    # --- Child readers -------------------------------------------------------

    #: Button to add a new column-specific child reader
    btn_new_child_reader = None

    # --- Exaggerations -------------------------------------------------------

    #: A QLineEdit for the exageration factor
    txt_exag_factor = None

    #: A QComboBox to select the reader type for exaggerations
    cb_exag_reader_type = None

    #: A QComboBox to select the extraction mode for exaggerations
    cb_exag_extraction_mode = None

    #: A QComboBox to select the segmentation mode for exaggerations
    cb_exag_segmentation_mode = None

    #: Line edit for exaggeration target colors
    txt_exag_target_colors = None

    #: Button to pick exaggeration target colors from the current image
    btn_pick_exag_target_color = None

    #: Button to remove the last exaggeration target color entry
    btn_pop_exag_target_color = None

    #: Button to clear all exaggeration target colors
    btn_clear_exag_target_colors = None

    #: A QComboBox to select the exaggeration merge mode
    cb_exag_merge_mode = None

    #: Button to add an exaggerations reader
    btn_new_exaggeration = None

    #: Button to select the exaggerations
    btn_select_exaggerations = None

    #: Button to digitize the exaggerations
    btn_digitize_exag = None

    # --- Feature removement --------------------------------------------------

    # ---- Disconnected parts -------------------------------------------------

    #: Button for removing disconnected parts in the plot. See the
    #: :meth:`straditize.binary.DataReader.show_disconnected_parts` method
    btn_show_disconnected_parts = None

    #: A QLineEdit to set the `fromlast` keyword for the
    #: :meth:`straditize.binary.DataReader.show_disconnected_parts` method
    txt_fromlast = None

    #: A QCheckBox to enable and disable the `fromlast` keyword in the
    #: :meth:`straditize.binary.DataReader.show_disconnected_parts` method
    cb_fromlast = None

    #: A QLineEdit to set the `from0` keyword for the
    #: :meth:`straditize.binary.DataReader.show_disconnected_parts` method
    txt_from0 = None

    #: A QCheckBox to enable and disable the `from0` keyword in the
    #: :meth:`straditize.binary.DataReader.show_disconnected_parts` method
    cb_from0 = None

    # ---- Cross column features ----------------------------------------------

    #: A button to
    #: :meth:`~straditize.binary.DataReader.show_cross_column_features`
    btn_show_cross_column = None

    #: A QLineEdit to select the minimum pixels (`min_px`) for a cross column
    #: feature
    txt_cross_column_px = None

    # ---- Small features -----------------------------------------------------

    #: A button to :meth:`~straditize.binary.DataReader.show_small_parts`
    btn_show_small_parts = None

    #: A QLineEdit to set the size for small parts
    txt_max_small_size = None

    #: A button to highlight small selections using the
    #: :meth:`straditize.label_selection.LabelSelection.highlight_small_selections`
    #: method
    btn_highlight_small_selection = None

    #: A QLineEdit to set the maximal size for
    #: :attr:`highlighting small features <btn_highlight_small_selection>`
    txt_min_highlight = None

    # ---- Parts at column ends -----------------------------------------------

    #: A button to show the parts that touch the column end
    btn_show_parts_at_column_ends = None

    # ---- Line detection -----------------------------------------------------

    #: LineEditor for specifying the fraction of vertical and horizontal lines
    txt_line_fraction = None

    #: A QSpinBox to select the minimum linewidth
    sp_min_lw = None

    #: A QSpinBox to select the maximum linewidth
    sp_max_lw = None

    #: QCheckBox to enable and disable the maximum linewidth as a criterion
    cb_max_lw = None

    #: Button for removing vertical lines
    btn_remove_vlines = None

    #: Button for manually removing vertical features
    btn_remove_vlines_manual = None

    #: button for removing horizontal lines
    btn_remove_hlines = None

    #: Button for manually removing horizontal features
    btn_remove_hlines_manual = None

    #: Button for removing y-axes
    btn_remove_yaxes = None

    #: button for removing x-axes
    btn_remove_xaxes = None

    # --- Digitizing ----------------------------------------------------------

    #: Button for digitizing the diagram
    btn_digitize = None

    #: Line edit for setting the tolerance for bars
    txt_tolerance = None

    # --- Samples -------------------------------------------------------------

    #: A button to find the samples with the
    #: :meth:`straditize.binary.DataReader.find_samples` method
    btn_find_samples = None

    #: A QLinEdit to specify the minimum length of a potential sample to be
    #: included in the sample finding algorithm (see :attr:`btn_find_samples`)
    txt_min_len = None

    #: A QLinEdit to specify the maximum length of a potential sample to be
    #: included in the sample finding algorithm (see :attr:`btn_find_samples`)
    txt_max_len = None

    #: A QSpinBox to set the minimum distance between to samples in the
    #: sample finding algorithm
    sp_pixel_tol = None

    #: A button to load samples from a file
    btn_load_samples = None

    #: A button to edit the samples (see the
    #: :meth:`straditize.straditizer.Straditizer.marks_for_samples` and
    #: :meth:`straditize.straditizer.Straditizer.marks_for_samples_sep`)
    btn_edit_samples = None

    #: A button to edit the full digitized data
    btn_edit_full_data = None

    #: A button to reset the samples
    btn_reset_samples = None

    #: A QCheckBox to edit the samples in a separate figure and not inside the
    #: original diagram
    cb_edit_separate = None

    #: A QLineEdit to specify the number or rows in a plot for editing the
    #: samples in a separate figure (see :attr:`btn_edit_samples` and
    #: :attr:`cb_edit_separate`)
    txt_edit_rows = None

    # --- Occurences ----------------------------------------------------------

    #: A button to select occurences in the data part (see the
    #: :meth:`enable_occurences_selection` method)
    btn_select_occurences = None

    #: A button to edit the occurences with the
    #: :meth:`straditize.straditizer.Straditizer.marks_for_occurences` method
    btn_edit_occurences = None

    #: A QLineEdit to set the value for occurences in the final data
    txt_occurences_value = None

    #: A QCheckBox to remove the occurences in the plot after selection
    cb_remove_occurences = None

    #: A :class:`BarSplitter` to split too long bars
    tree_bar_split = None

    #: A QComboBox to select whether to fill the :attr:`tree_bar_split` with
    #: too long, overlapping, or all bars
    cb_split_source = None

    _change_reader = True

    digitize_item = None

    @property
    def selection_toolbar(self):
        return self.straditizer_widgets.selection_toolbar

    @docstrings.dedent
    def __init__(self, straditizer_widgets, item):
        """
        Parameters
        ----------
        %(StraditizerControlBase.init_straditizercontrol.parameters)s
        """

        # ---------------------------------------------------------------------
        # --------------------------- Buttons ---------------------------------
        # ---------------------------------------------------------------------

        self.btn_select_data = QPushButton('Select data part')
        self.btn_select_data.setToolTip(
            'Create marks for selecting the data in the image')

        self.cb_reader_type = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems(reader_types)
        cb.setCurrentIndex(0)
        self.cb_extraction_mode = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems([label for label, _ in extraction_mode_items])
        cb.setCurrentText('Standard')
        self.cb_segmentation_mode = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems([label for label, _ in segmentation_mode_items])
        cb.setCurrentText('Auto')
        self.txt_target_colors = QLineEdit()
        self.txt_target_colors.setPlaceholderText('#RRGGBB, #RRGGBB')
        self.txt_target_colors.setToolTip(
            'Optional target colors for guided segmentation.')
        self.btn_pick_target_color = QPushButton('Pick color')
        self.btn_pick_target_color.setToolTip(
            'Pick a target color from the current reader image.')
        self.btn_pop_target_color = QPushButton('Remove last')
        self.btn_pop_target_color.setToolTip(
            'Remove the last target color entry.')
        self.btn_clear_target_colors = QPushButton('Clear')
        self.btn_clear_target_colors.setToolTip(
            'Clear all target colors for the main reader.')

        self.btn_init_reader = QPushButton('Convert image')
        self.btn_init_reader.setToolTip(
            'Convert the image to a binary image that can be read')

        self.txt_column_thresh = QLineEdit()
        self.txt_column_thresh.setValidator(QDoubleValidator(0, 100, 10))
        self.txt_column_thresh.setToolTip(
            'The fraction between 0 and 100 that has to be covered for a '
            'valid column start. Set this to a low value, e.g. 1, if you have '
            'columns with only a little bit of data.')
        self.txt_column_thresh.setText('10')

        self.btn_column_starts = QPushButton('Column starts')
        self.btn_column_starts.setToolTip(
            'Modify the column starts in the diagram')

        self.btn_column_ends = QPushButton('ends')
        self.btn_column_ends.setToolTip(
            'Modify the column ends in the diagram')

        self.btn_reset_columns = QPushButton('Reset')
        self.btn_reset_columns.setToolTip(
            'Reset the column starts')

        self.btn_align_vertical = QPushButton('Align columns')
        self.btn_align_vertical.setToolTip('Align the columns vertically')

        # column specific readers
        self.cb_readers = QComboBox()
        self.cb_readers.setEditable(False)

        self.btn_new_child_reader = QPushButton('+')

        self.txt_exag_factor = QLineEdit()
        self.txt_exag_factor.setValidator(QDoubleValidator(1, 100, 4))
        self.txt_exag_factor.setText('10')
        self.txt_exag_factor.setPlaceholderText('1-100')
        self.txt_exag_factor.setToolTip(
            'The factor that the data is exaggerated.')

        self.cb_exag_reader_type = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems(reader_types)
        cb.setCurrentIndex(0)
        self.cb_exag_extraction_mode = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems([label for label, _ in extraction_mode_items])
        cb.setCurrentText('Standard')
        self.cb_exag_segmentation_mode = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems([label for label, _ in segmentation_mode_items])
        cb.setCurrentText('Auto')
        self.txt_exag_target_colors = QLineEdit()
        self.txt_exag_target_colors.setPlaceholderText('#RRGGBB, #RRGGBB')
        self.txt_exag_target_colors.setToolTip(
            'Optional target colors for guided exaggeration selection.')
        self.btn_pick_exag_target_color = QPushButton('Pick color')
        self.btn_pick_exag_target_color.setToolTip(
            'Pick exaggeration target colors from the main reader image.')
        self.btn_pop_exag_target_color = QPushButton('Remove last')
        self.btn_pop_exag_target_color.setToolTip(
            'Remove the last exaggeration target color entry.')
        self.btn_clear_exag_target_colors = QPushButton('Clear')
        self.btn_clear_exag_target_colors.setToolTip(
            'Clear all target colors for exaggerations.')
        self.cb_exag_merge_mode = cb = QComboBox()
        cb.setEditable(False)
        cb.addItems([label for label, _ in merge_mode_items])
        cb.setCurrentText('Selected region priority')

        self.btn_new_exaggeration = QPushButton('+')
        self.btn_select_exaggerations = QPushButton('Select exaggerations')
        self.btn_select_exaggerations.setToolTip(
            'Select the features that represent the exaggerations')

        self.txt_exag_percentage = QLineEdit()
        self.txt_exag_percentage.setText('5')
        self.txt_exag_percentage.setValidator(QDoubleValidator(0, 100, 4))
        self.txt_exag_percentage.setPlaceholderText('0-100%')
        self.txt_exag_percentage.setToolTip(
            'The percentage of the column width under which the exaggerated '
            'digitized result shall be used.')
        self.txt_exag_absolute = QLineEdit()
        self.txt_exag_absolute.setText('8')
        self.txt_exag_absolute.setValidator(QIntValidator(0, 100000))
        self.txt_exag_absolute.setPlaceholderText('1,2,3,... px')
        self.txt_exag_absolute.setToolTip(
            'The absolute pixel value under which the exaggerated '
            'digitized result shall be used.')

        self.btn_digitize_exag = QPushButton('Digitize exaggerations')
        self.btn_digitize_exag.setToolTip('Digitize the exaggerations')

        self.btn_show_disconnected_parts = QPushButton('Disconnected features')
        self.btn_show_disconnected_parts.setToolTip(
            'Highlight the disconnected features in the binary image, i.e. '
            'features that are not associated with the data and might be '
            'picture artifacts')

        self.txt_fromlast = QLineEdit()
        self.txt_fromlast.setValidator(QIntValidator())
        self.txt_fromlast.setText('5')
        self.txt_fromlast.setToolTip(
            'Number of pixels after which a feature is regarded as '
            'disconnected from the previous feature.')
        self.cb_fromlast = QCheckBox('from previous feature by')
        self.cb_fromlast.setChecked(True)

        self.txt_from0 = QLineEdit()
        self.txt_from0.setValidator(QIntValidator(0, 100000))
        self.txt_from0.setText('10')
        self.txt_from0.setToolTip(
            'Number of pixels after which a feature is regarded as '
            'disconnected from the column start.')
        self.cb_from0 = QCheckBox('from column start by')
        self.cb_from0.setChecked(True)

        self.btn_show_cross_column = QPushButton('Cross column features')
        self.btn_show_cross_column.setToolTip(
            'Highlight features that cross multiple columns.')

        self.txt_cross_column_px = QLineEdit()
        self.txt_cross_column_px.setValidator(QIntValidator(0, 100000))
        self.txt_cross_column_px.setText('50')
        self.txt_cross_column_px.setToolTip(
            'The number of pixels that must be in any of the columns')

        self.btn_show_small_parts = QPushButton(
            'Small features')
        self.btn_show_small_parts.setToolTip(
            'Remove features smaller than 6 pixels')
        self.txt_max_small_size = QLineEdit()
        self.txt_max_small_size.setValidator(QIntValidator())
        self.txt_max_small_size.setText('6')

        self.btn_highlight_small_selection = QPushButton(
            'Highlight selection smaller than')
        self.btn_highlight_small_selection.setCheckable(True)
        self.txt_min_highlight = QLineEdit()
        self.txt_min_highlight.setValidator(QIntValidator())
        self.txt_min_highlight.setText('20')

        self.btn_show_parts_at_column_ends = QPushButton(
            'Features at column ends')
        self.btn_show_parts_at_column_ends.setToolTip(
            'Highlight the features in the binary image, that touch the end '
            'of the corresponding column')

        self.txt_line_fraction = QLineEdit()
        self.txt_line_fraction.setValidator(QDoubleValidator(0.0, 100.0, 5))
        self.txt_line_fraction.setText('30.0')
        self.txt_line_fraction.setToolTip(
            'The percentage that shall be used to identify a straight line')

        self.sp_min_lw = QSpinBox()
        self.sp_min_lw.setValue(1)
        self.sp_min_lw.setMaximum(10000)
        self.sp_min_lw.setToolTip(
            'Set the minimal width for selected vertical or horizontal lines')

        self.cb_max_lw = QCheckBox('Maximum line width')
        self.sp_max_lw = QSpinBox()
        self.sp_max_lw.setMaximum(10000)
        self.sp_max_lw.setValue(20)
        self.sp_max_lw.setToolTip(
            'Set the maximal width for selected vertical or horizontal lines')
        self.sp_max_lw.setEnabled(False)

        self.btn_remove_vlines = QPushButton('vertical lines')
        self.btn_remove_vlines.setToolTip(
            'Remove vertical lines, i.e. y-axes')
        self.btn_remove_vlines_manual = QPushButton('manual vertical')
        self.btn_remove_vlines_manual.setToolTip(
            'Remove multiple vertical lines by entering their endpoints')

        self.btn_remove_yaxes = QPushButton('y-axes')
        self.btn_remove_yaxes.setToolTip(
            'Recognize and remove vertical axes in each of the plots')

        self.btn_remove_hlines = QPushButton('horizontal lines')
        self.btn_remove_hlines.setToolTip(
            'Remove horizonal lines, i.e. lines parallel to the x-axis')
        self.btn_remove_hlines_manual = QPushButton('manual horizontal')
        self.btn_remove_hlines_manual.setToolTip(
            'Remove multiple horizontal lines by entering their endpoints')

        self.btn_remove_xaxes = QPushButton('x-axes')
        self.btn_remove_xaxes.setToolTip(
            'Recognize and remove x-axes at bottom and top of the data image')

        self.btn_digitize = QPushButton('Digitize')
        self.btn_digitize.setToolTip('Digitize the binary file')

        self.btn_find_samples = QPushButton('Find samples')
        self.btn_find_samples.setToolTip(
            'Estimate positions of the samples in the diagram')

        self.btn_load_samples = QPushButton('Load samples')
        self.btn_load_samples.setToolTip(
            'Load the sample locations from a CSV file')

        self.btn_edit_samples = QPushButton('Edit samples')
        self.btn_edit_samples.setToolTip(
            'Modify and edit the samples')
        self.btn_edit_full_data = QPushButton('Edit full data')
        self.btn_edit_full_data.setToolTip(
            'Edit the full digitized data table and drag turning points')
        self.btn_reset_samples = QPushButton('Reset')
        self.btn_reset_samples.setToolTip('Reset the samples')

        self.cb_edit_separate = QCheckBox('In separate figure')
        self.cb_edit_separate.setToolTip(
            'Edit the samples in a separate figure where you have one '
            'plot for each column')
        self.txt_edit_rows = QLineEdit()
        self.txt_edit_rows.setValidator(QIntValidator(1, 1000))
        self.txt_edit_rows.setToolTip(
            'The number of plot rows in the editing figure?')
        self.txt_edit_rows.setText('3')
        self.txt_edit_rows.setEnabled(False)

        self.txt_min_len = QLineEdit()
        self.txt_min_len.setToolTip(
            'Minimum length of a potential sample to be included')
        self.txt_max_len = QLineEdit()
        self.txt_max_len.setText('8')
        self.txt_max_len.setToolTip(
            'Maximum length of a potential sample to be included')
        self.sp_pixel_tol = QSpinBox()
        self.sp_pixel_tol.setMaximum(10000)
        self.sp_pixel_tol.setValue(5)
        self.sp_pixel_tol.setToolTip(
            'Minimum distance between two samples in pixels')
        self.btn_select_occurences = QPushButton('Select occurences')
        self.btn_select_occurences.setToolTip(
            'Select where a measurement was reported but without an '
            'associated value')
        self.btn_edit_occurences = QPushButton('Edit occurences')
        self.btn_select_occurences.setToolTip(
            'Edit the locations of occurences')
        self.txt_occurences_value = QLineEdit()
        self.txt_occurences_value.setText('-9999')
        self.txt_occurences_value.setToolTip(
            'Enter the value that shall be used for an occurence in the '
            'final output data')
        self.txt_occurences_value.setValidator(QDoubleValidator())
        self.cb_remove_occurences = QCheckBox('Remove on apply')
        self.cb_remove_occurences.setChecked(False)
        self.cb_remove_occurences.setToolTip(
            'Remove the selected features in the plot when clicking the '
            '<i>apply</i> button.')
        self.cb_remove_occurences.setVisible(False)

        self.tree_bar_split = BarSplitter(straditizer_widgets)
        self.cb_split_source = QComboBox()
        self.cb_split_source.addItems(
            ['too long bars', 'overlapping bars', 'all bars'])

        self.widgets2disable = [
            self.btn_column_starts, self.btn_column_ends,
            self.cb_readers, self.btn_new_child_reader,
            self.cb_segmentation_mode, self.txt_target_colors,
            self.btn_pick_target_color, self.btn_pop_target_color,
            self.btn_clear_target_colors,
            self.txt_exag_factor, self.cb_exag_reader_type,
            self.cb_exag_extraction_mode, self.cb_exag_segmentation_mode,
            self.txt_exag_target_colors, self.btn_pick_exag_target_color,
            self.btn_pop_exag_target_color, self.btn_clear_exag_target_colors,
            self.cb_exag_merge_mode,
            self.txt_exag_percentage, self.txt_exag_absolute,
            self.btn_digitize_exag,
            self.btn_new_exaggeration, self.btn_select_exaggerations,
            self.btn_select_data, self.btn_remove_hlines,
            self.btn_reset_columns, self.btn_reset_samples,
            self.btn_remove_xaxes, self.btn_remove_yaxes,
            self.btn_remove_vlines, self.txt_line_fraction,
            self.sp_max_lw, self.sp_min_lw,
            self.btn_show_disconnected_parts, self.txt_fromlast,
            self.btn_show_cross_column, self.txt_cross_column_px,
            self.btn_show_parts_at_column_ends,
            self.btn_show_small_parts, self.txt_max_small_size,
            self.btn_align_vertical,
            self.btn_edit_samples, self.btn_edit_full_data,
            self.btn_find_samples,
            self.btn_load_samples,
            self.btn_remove_hlines_manual, self.btn_remove_vlines_manual,
            self.btn_select_occurences, self.btn_edit_occurences,
            self.txt_occurences_value, self.cb_split_source
            ]

        self.init_reader_kws = {}

        self.init_straditizercontrol(straditizer_widgets, item)

        # ---------------------------------------------------------------------
        # --------------------------- Connections -----------------------------
        # ---------------------------------------------------------------------

        self.btn_select_data.clicked.connect(lambda: self.select_data_part())
        self.btn_column_starts.clicked.connect(self.select_column_starts)
        self.btn_column_ends.clicked.connect(self.modify_column_ends)
        self.btn_reset_columns.clicked.connect(self.reset_column_starts)
        self.cb_reader_type.currentTextChanged.connect(
            self.toggle_txt_tolerance)
        self.btn_init_reader.clicked.connect(self.init_reader)
        self.btn_digitize.clicked.connect(self.digitize)
        self.btn_digitize_exag.clicked.connect(self.digitize_exaggerations)
        self.cb_segmentation_mode.currentTextChanged.connect(
            self.update_reader_segmentation_settings)
        self.txt_target_colors.editingFinished.connect(
            self.update_reader_segmentation_settings)
        self.btn_pick_target_color.clicked.connect(
            lambda: self.start_pick_target_color(False))
        self.btn_pop_target_color.clicked.connect(
            lambda: self.remove_last_target_color(False))
        self.btn_clear_target_colors.clicked.connect(
            lambda: self.clear_target_colors(False))
        self.cb_exag_segmentation_mode.currentTextChanged.connect(
            self.update_exaggeration_settings)
        self.txt_exag_target_colors.editingFinished.connect(
            self.update_exaggeration_settings)
        self.cb_exag_merge_mode.currentTextChanged.connect(
            self.on_exag_merge_mode_changed)
        self.btn_pick_exag_target_color.clicked.connect(
            lambda: self.start_pick_target_color(True))
        self.btn_pop_exag_target_color.clicked.connect(
            lambda: self.remove_last_target_color(True))
        self.btn_clear_exag_target_colors.clicked.connect(
            lambda: self.clear_target_colors(True))
        self.btn_digitize.clicked.connect(self.straditizer_widgets.refresh)
        self.btn_remove_yaxes.clicked.connect(self.remove_yaxes)
        self.btn_remove_xaxes.clicked.connect(self.remove_xaxes)
        self.btn_remove_hlines.clicked.connect(self.remove_hlines)
        self.btn_remove_hlines_manual.clicked.connect(
            self.remove_hlines_manually)
        self.btn_remove_vlines.clicked.connect(self.remove_vlines)
        self.btn_remove_vlines_manual.clicked.connect(
            self.remove_vlines_manually)
        self.btn_show_disconnected_parts.clicked.connect(
            self.show_disconnected_parts)
        self.btn_show_parts_at_column_ends.clicked.connect(
            self.show_parts_at_column_ends)
        self.btn_align_vertical.clicked.connect(self.align_vertical)
        self.btn_find_samples.clicked.connect(self.find_samples)
        self.btn_load_samples.clicked.connect(self.load_samples)
        self.btn_edit_samples.clicked.connect(self.edit_samples)
        self.btn_edit_full_data.clicked.connect(self.edit_full_data)
        self.btn_reset_samples.clicked.connect(self.reset_samples)
        self.btn_show_small_parts.clicked.connect(self.show_small_parts)
        self.txt_max_small_size.textChanged.connect(
            self._update_btn_show_small_parts)
        self.txt_min_highlight.textChanged.connect(
            self._update_btn_highlight_small_selection)
        self.btn_highlight_small_selection.toggled.connect(
            self.toggle_btn_highlight_small_selection)
        self.cb_from0.stateChanged.connect(self.toggle_txt_from0)
        self.cb_fromlast.stateChanged.connect(self.toggle_txt_fromlast)
        self.btn_show_cross_column.clicked.connect(
            self.show_cross_column_features)
        self.btn_new_child_reader.clicked.connect(
            self.enable_col_selection_for_new_reader)
        self.cb_readers.currentTextChanged.connect(self.change_reader)
        self.btn_new_exaggeration.clicked.connect(self.init_exaggerated_reader)
        self.btn_select_exaggerations.clicked.connect(
            self.select_exaggerated_features)
        self.cb_edit_separate.stateChanged.connect(self.toggle_txt_edit_rows)
        self.cb_max_lw.stateChanged.connect(self.toggle_sp_max_lw)
        self.btn_select_occurences.clicked.connect(
            self.enable_occurences_selection)
        self.btn_edit_occurences.clicked.connect(self.edit_occurences)
        self.txt_occurences_value.textChanged.connect(
            self.set_occurences_value)
        self.cb_split_source.currentIndexChanged.connect(
            self.toggle_bar_split_source)

        # disable warning if bars cannot be separated
        warnings.filterwarnings('ignore', 'Could not separate bars',
                                UserWarning)

    def refresh(self):
        super(DigitizingControl, self).refresh()
        self.tree_bar_split.refresh()
        self.bar_split_child.setHidden(not self.tree_bar_split.filled)
        if self.tree_bar_split.filled:
            nsplit = sum(map(len,
                             self.straditizer.data_reader._splitted.values()))
            self.cb_split_source.setItemText(0, '%i too long bar%s' % (
                nsplit, 's' if nsplit > 1 else '')
                )
            noverlap = sum(map(len,
                               self.tree_bar_split.get_overlapping_bars()))
            self.cb_split_source.setItemText(1, '%i overlapping bar%s' % (
                noverlap, 's' if noverlap > 1 else ''))
        else:
            self.cb_split_source.setItemText(0, 'too long bars')
            self.cb_split_source.setItemText(1, 'overlapping bars')
        self.maybe_show_btn_reset_columns()
        self.maybe_show_btn_reset_samples()
        for w in [self.btn_init_reader, self.btn_digitize]:
            w.setEnabled(self.should_be_enabled(w))
        self.enable_or_disable_btn_highlight_small_selection()
        synced_widgets = [
            self.cb_segmentation_mode, self.txt_target_colors,
            self.cb_exag_segmentation_mode, self.txt_exag_target_colors,
            self.cb_exag_merge_mode,
        ]
        old_blocks = [w.blockSignals(True) for w in synced_widgets]
        try:
            if (self.straditizer is not None and
                    self.straditizer.data_reader is not None):
                base_reader = self.straditizer.data_reader
                if base_reader.is_exaggerated:
                    base_reader = base_reader.non_exaggerated_reader
                self.cb_reader_type.setCurrentText(get_reader_name(base_reader))
                self.cb_extraction_mode.setCurrentText(
                    get_extraction_mode_label(base_reader.extraction_mode))
                self.cb_segmentation_mode.setCurrentText(
                    get_segmentation_mode_label(base_reader.segmentation_mode))
                self.txt_target_colors.setText(
                    ', '.join(base_reader.target_colors))
                reader = base_reader.exaggerated_reader
                self.cb_exag_reader_type.setCurrentText(get_reader_name(
                    reader or base_reader))
                self.cb_exag_extraction_mode.setCurrentText(
                    get_extraction_mode_label(
                        getattr(reader or base_reader,
                                'extraction_mode', 'standard')))
                self.cb_exag_segmentation_mode.setCurrentText(
                    get_segmentation_mode_label(
                        getattr(reader or base_reader,
                                'segmentation_mode', 'auto')))
                self.txt_exag_target_colors.setText(', '.join(
                    getattr(reader or base_reader, 'target_colors', [])))
                self.cb_exag_merge_mode.setCurrentText(
                    get_merge_mode_label(
                        getattr(reader or base_reader,
                                'exaggeration_merge_mode',
                                'selected-priority')))
                if reader is not None:
                    self.txt_exag_factor.setText(str(reader.is_exaggerated))
                self.txt_occurences_value.setText(
                    str(base_reader.occurences_value))
                legacy = (getattr(reader or base_reader,
                                  'exaggeration_merge_mode',
                                  'selected-priority') == 'threshold-legacy')
                self.txt_exag_percentage.setEnabled(legacy)
                self.txt_exag_absolute.setEnabled(legacy)
            else:
                self.cb_extraction_mode.setCurrentText(
                    get_extraction_mode_label('standard'))
                self.cb_segmentation_mode.setCurrentText(
                    get_segmentation_mode_label('auto'))
                self.txt_target_colors.setText('')
                self.cb_exag_extraction_mode.setCurrentText(
                    get_extraction_mode_label('standard'))
                self.cb_exag_segmentation_mode.setCurrentText(
                    get_segmentation_mode_label('auto'))
                self.txt_exag_target_colors.setText('')
                self.cb_exag_merge_mode.setCurrentText(
                    get_merge_mode_label('selected-priority'))
                self.txt_exag_percentage.setEnabled(False)
                self.txt_exag_absolute.setEnabled(False)
        finally:
            for widget, old in zip(synced_widgets, old_blocks):
                widget.blockSignals(old)
        self.fill_cb_readers()

    def _base_reader(self):
        """Return the non-exaggerated reader currently controlled by the UI."""
        if self.straditizer is None:
            return None
        reader = self.straditizer.data_reader
        if reader is not None and reader.is_exaggerated:
            reader = reader.non_exaggerated_reader
        return reader

    @staticmethod
    def _append_color_text(existing, color):
        existing_colors = binary.DataReader.normalize_target_colors(existing)
        colors = binary.DataReader.normalize_target_colors(
            list(existing_colors) + [color])
        return ', '.join(colors)

    @staticmethod
    def _pop_color_text(existing):
        colors = binary.DataReader.normalize_target_colors(existing)
        if colors:
            colors = colors[:-1]
        return ', '.join(colors)

    def _show_invalid_color_message(self, exc):
        QMessageBox.warning(
            self.straditizer_widgets, 'Invalid color list',
            six.text_type(exc))

    def remove_last_target_color(self, exaggeration=False):
        if exaggeration:
            widget = self.txt_exag_target_colors
        else:
            widget = self.txt_target_colors
        try:
            widget.setText(self._pop_color_text(widget.text()))
        except ValueError as exc:
            self._show_invalid_color_message(exc)
            return
        if exaggeration:
            self.update_exaggeration_settings()
        else:
            self.update_reader_segmentation_settings()

    def clear_target_colors(self, exaggeration=False):
        if exaggeration:
            self.txt_exag_target_colors.setText('')
            self.update_exaggeration_settings()
        else:
            self.txt_target_colors.setText('')
            self.update_reader_segmentation_settings()

    def update_reader_segmentation_settings(self, *args):
        """Synchronize main reader segmentation settings from the GUI."""
        reader = self._base_reader()
        if reader is None:
            return
        reader.segmentation_mode = segmentation_mode_labels[
            self.cb_segmentation_mode.currentText()]
        try:
            reader.target_colors = binary.DataReader.normalize_target_colors(
                self.txt_target_colors.text())
        except ValueError as exc:
            self._show_invalid_color_message(exc)
            return

    def update_exaggeration_settings(self, *args):
        """Synchronize exaggeration segmentation and merge settings."""
        reader = self._base_reader()
        if reader is None:
            return
        exag = reader.exaggerated_reader
        merge_mode = merge_mode_labels[self.cb_exag_merge_mode.currentText()]
        legacy = merge_mode == 'threshold-legacy'
        self.txt_exag_percentage.setEnabled(legacy)
        self.txt_exag_absolute.setEnabled(legacy)
        if exag is None:
            return
        exag.segmentation_mode = segmentation_mode_labels[
            self.cb_exag_segmentation_mode.currentText()]
        try:
            exag.target_colors = binary.DataReader.normalize_target_colors(
                self.txt_exag_target_colors.text())
        except ValueError as exc:
            self._show_invalid_color_message(exc)
            return
        exag.exaggeration_merge_mode = merge_mode

    def on_exag_merge_mode_changed(self, *args):
        """Prompt before switching merge mode when results already exist."""
        reader = self._base_reader()
        if reader is None or reader.exaggerated_reader is None:
            self.update_exaggeration_settings()
            return
        exag = reader.exaggerated_reader
        new_mode = merge_mode_labels[self.cb_exag_merge_mode.currentText()]
        old_mode = getattr(exag, 'exaggeration_merge_mode', 'selected-priority')
        if new_mode != old_mode and reader.full_df is not None:
            ret = QMessageBox.question(
                self.straditizer_widgets, 'Switch merge mode',
                'Switching merge mode can change the digitized result. '
                'Apply the new mode?',
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if ret != QMessageBox.Yes:
                self.cb_exag_merge_mode.blockSignals(True)
                self.cb_exag_merge_mode.setCurrentText(
                    get_merge_mode_label(old_mode))
                self.cb_exag_merge_mode.blockSignals(False)
                self.update_exaggeration_settings()
                return
        self.update_exaggeration_settings()

    def start_pick_target_color(self, exaggeration=False):
        """Activate one-shot target color picking on the current figure."""
        reader = self._base_reader()
        if reader is None or reader.ax is None:
            return
        try:
            reader.ax.figure.canvas.mpl_disconnect(self._target_color_pick_cid)
        except AttributeError:
            pass
        self._target_color_pick_exaggeration = exaggeration
        self._target_color_pick_cid = reader.ax.figure.canvas.mpl_connect(
            'button_press_event', self._pick_target_color_from_event)

    def _pick_target_color_from_event(self, event):
        """Append the clicked pixel color to the appropriate target list."""
        reader = self._base_reader()
        if reader is None or event.inaxes is not reader.ax:
            return
        arr = np.asarray(reader.image)
        height, width = arr.shape[:2]
        if reader.extent is None:
            xmin, xmax = 0, width
            ymin, ymax = 0, height
        else:
            xmin, xmax, ymin, ymax = reader.extent
        xspan = xmax - xmin or 1
        yspan = ymax - ymin or 1
        col = int(np.clip((event.xdata - xmin) / float(xspan) * width,
                          0, width - 1))
        row = int(np.clip((event.ydata - ymin) / float(yspan) * height,
                          0, height - 1))
        rgb = arr[row, col, :3]
        color = '#%02X%02X%02X' % tuple(map(int, rgb))
        try:
            reader.ax.figure.canvas.mpl_disconnect(self._target_color_pick_cid)
            del self._target_color_pick_cid
        except AttributeError:
            pass
        if getattr(self, '_target_color_pick_exaggeration', False):
            try:
                self.txt_exag_target_colors.setText(
                    self._append_color_text(
                        self.txt_exag_target_colors.text(), color))
            except ValueError as exc:
                self._show_invalid_color_message(exc)
                return
            self.update_exaggeration_settings()
        else:
            try:
                self.txt_target_colors.setText(
                    self._append_color_text(self.txt_target_colors.text(),
                                            color))
            except ValueError as exc:
                self._show_invalid_color_message(exc)
                return
            self.update_reader_segmentation_settings()

    def toggle_sp_max_lw(self, state):
        """Toggle :attr:`sp_max_lw` based on :attr:`cb_max_lw`
        """
        self.sp_max_lw.setEnabled(state == Qt.Checked)

    def toggle_txt_fromlast(self, state):
        """Toggle :attr:`txt_fromlast` based on :attr:`cb_fromlast`
        """
        self.txt_fromlast.setEnabled(state == Qt.Checked)

    def toggle_txt_edit_rows(self, state):
        """Toggle :attr:`txt_edit_rows` based on :attr:`cb_edit_separate`"""
        self.txt_edit_rows.setEnabled(state == Qt.Checked)

    def toggle_txt_from0(self, state):
        """Toggle :attr:`txt_from0` based on :attr:`cb_from0`"""
        self.txt_from0.setEnabled(state == Qt.Checked)

    def enable_or_disable_widgets(self, *args, **kwargs):
        super(DigitizingControl, self).enable_or_disable_widgets(*args,
                                                                 **kwargs)
        if not self.tree_bar_split.isHidden():
            self.tree_bar_split.enable_or_disable_widgets(*args, **kwargs)
        self.maybe_show_btn_reset_columns()
        self.maybe_show_btn_reset_samples()
        self.toggle_txt_tolerance(self.cb_reader_type.currentText())
        self.enable_or_disable_btn_highlight_small_selection()

    def enable_or_disable_btn_highlight_small_selection(self):
        """Enable the :attr:`btn_highlight_small_selection` during a selection
        """
        enable = self.should_be_enabled(self.btn_highlight_small_selection)
        self.btn_highlight_small_selection.setEnabled(enable)
        self.btn_highlight_small_selection.setChecked(
            enable and bool(self.selection_toolbar.data_obj._ellipses))

    def maybe_show_btn_reset_columns(self):
        """Show the :attr:`btn_reset_columns` if the column starts are set"""
        show = self.should_be_enabled(self.btn_reset_columns)
        self.btn_reset_columns.setVisible(show)
        self.btn_column_ends.setVisible(show)

    def maybe_show_btn_reset_samples(self):
        """Show the :attr:`btn_reset_samples` if the samples are set"""
        self.btn_reset_samples.setVisible(
            self.should_be_enabled(self.btn_reset_samples))

    def update_tolerance(self, s):
        """Set the readers :attr:`~straditizer.binary.BarDataReader.tolerance`

        Parameters
        ----------
        s: str or int
            The tolerance for the
            :attr:`straditizer.binary.BarDataReader.tolerance` attribute
        """
        if (self.straditizer is not None and
                self.straditizer.data_reader is not None and
                hasattr(self.straditizer.data_reader, 'tolerance')):
            self.straditizer.data_reader.tolerance = int(s or 0)

    def toggle_txt_tolerance(self, s):
        """Set the visibility of the :attr:`txt_tolerance` based on the reader

        Parameters
        ----------
        s: str
            The reader name. If there is *bars* in `s`, then the
            :attr:`txt_tolerance` is displayed"""
        enable = 'bars' in s
        try:
            self.txt_tolerance
        except RuntimeError:
            self.txt_tolerance = None
        if enable:
            if self.txt_tolerance is None:
                self.tolerance_child = QTreeWidgetItem(0)
                self.lbl_tolerance = QLabel('Tolerance:')
                self.txt_tolerance = QLineEdit()
                validator = QIntValidator()
                validator.setBottom(0)
                self.txt_tolerance.setValidator(validator)
                self.txt_tolerance.setEnabled(False)
                self.txt_tolerance.textChanged.connect(self.update_tolerance)

                hbox = QHBoxLayout()
                hbox.addWidget(self.lbl_tolerance)
                hbox.addWidget(self.txt_tolerance)
                self.digitize_item.addChild(self.tolerance_child)
                w = QWidget()
                w.setLayout(hbox)
                self.tree.setItemWidget(self.tolerance_child, 0, w)

            if self.txt_tolerance is not None:
                self.txt_tolerance.setEnabled(enable)
                self._set_txt_tolerance_tooltip()
                # use the value of the reader by default
                if (self.straditizer is not None and
                        self.straditizer.data_reader is not None):
                    self.txt_tolerance.setText(str(getattr(
                        self.straditizer.data_reader, 'tolerance', '')))
                # otherwise use a default value of 10 for roundedtt bars
                elif enable and int(self.txt_tolerance.text() or 2) == 2:
                    self.txt_tolerance.setText('10')
                # and 2 for rectangular bars
                elif (enable and s == 'bars' and
                      int(self.txt_tolerance.text() or 10) == 10):
                    self.txt_tolerance.setText('2')
        # and nothing else
        elif self.txt_tolerance is not None:
            self.digitize_item.takeChild(self.digitize_item.indexOfChild(
                self.tolerance_child))
            del self.tolerance_child, self.txt_tolerance

    def _set_txt_tolerance_tooltip(self):
        enable = self.txt_tolerance and self.txt_tolerance.isEnabled()
        if enable:
            self.txt_tolerance.setToolTip(
                'Enter the difference in height to distinguish to adjacent '
                'bars')
        else:
            self.txt_tolerance.setToolTip('Not implemented.')

    def should_be_enabled(self, w):
        if self.straditizer is None:
            return False
        elif w in [self.btn_select_data]:
            return True
        elif w in [self.cb_segmentation_mode, self.txt_target_colors,
                   self.btn_pop_target_color, self.btn_clear_target_colors]:
            return not (self.straditizer.data_xlim is None or
                        self.straditizer.data_ylim is None)
        elif w is self.btn_init_reader:
            if (self.straditizer.data_xlim is None or
                    self.straditizer.data_ylim is None):
                return False
            return True
        elif (self.straditizer.data_xlim is None or
              self.straditizer.data_ylim is None):
            return False
        base_reader = self._base_reader()
        if base_reader is None:
            return False
        elif (w is self.btn_highlight_small_selection and
              not self.selection_toolbar._selecting):
            return False
        elif (w is self.btn_pick_target_color and
              (base_reader.ax is None or base_reader.image is None)):
            return False
        # widgets depending on that the columns have been set already
        elif (base_reader._column_starts is None and
              w in [self.btn_reset_columns, self.btn_align_vertical,
                    self.btn_column_ends,
                    self.cb_readers, self.btn_new_child_reader,
                    self.cb_exag_reader_type, self.btn_new_exaggeration,
                    self.cb_exag_extraction_mode,
                    self.cb_exag_segmentation_mode,
                    self.txt_exag_target_colors, self.btn_pick_exag_target_color,
                    self.btn_pop_exag_target_color,
                    self.btn_clear_exag_target_colors,
                    self.txt_exag_factor,
                    self.txt_exag_absolute,
                    self.txt_exag_percentage, self.btn_digitize_exag,
                    self.btn_show_disconnected_parts, self.txt_fromlast,
                    self.cb_fromlast, self.txt_from0, self.cb_from0,
                    self.btn_show_cross_column, self.txt_cross_column_px,
                    self.btn_remove_yaxes, self.btn_select_occurences,
                    self.btn_edit_occurences,
                    self.btn_show_parts_at_column_ends, self.btn_digitize]):
            return False
        elif (base_reader.exaggerated_reader is None and
              w in [self.txt_exag_percentage, self.txt_exag_absolute,
                    self.btn_digitize_exag, self.btn_select_exaggerations,
                    self.btn_pop_exag_target_color,
                    self.btn_clear_exag_target_colors,
                    self.btn_pick_exag_target_color]):
            return False
        elif (w in [self.txt_exag_percentage, self.txt_exag_absolute] and
              base_reader.exaggerated_reader is not None and
              base_reader.exaggerated_reader
              .exaggeration_merge_mode != 'threshold-legacy'):
            return False
        elif (w in [self.txt_exag_percentage, self.txt_exag_absolute] and
              not base_reader.exaggerated_reader.binary.any()
              ):
            return False
        elif (base_reader.exaggerated_reader is not None and
              w in [self.cb_exag_reader_type, self.cb_exag_extraction_mode,
                    self.btn_new_exaggeration,
                    self.txt_exag_factor]):
            return False
        elif (w is self.btn_reset_samples and
              base_reader._sample_locs is None):
            return False
        elif (w in [self.btn_find_samples, self.btn_edit_samples,
                    self.btn_edit_full_data, self.btn_load_samples,
                    self.btn_digitize_exag] and
              base_reader.full_df is None):
            return False
        elif (w is self.btn_show_small_parts and
              not self.txt_max_small_size.text()):
            return False
        elif w is self.sp_max_lw and not self.cb_max_lw.isChecked():
            return False
        return True

    def reset_column_starts(self):
        """Reset the column starts

        Reset the column starts by calling the
        :meth:`straditize.binary.DataReader.reset_column_starts` method"""
        if self._ask_for_column_modification():
            self.straditizer.data_reader.reset_column_starts()
            self.maybe_show_btn_reset_columns()
            self.refresh()

    def reset_samples(self):
        """Reset the samples

        Reset the samples by calling the
        :meth:`straditize.binary.DataReader.reset_samples` method"""
        self.straditizer.data_reader.reset_samples()
        self.maybe_show_btn_reset_samples()
        self.refresh()

    def set_occurences_value(self, value):
        """Set the :attr:`~straditize.binary.DataReader.occurences_value`

        Set the :attr:`straditize.binary.DataReader.occurence_value` of the
        data_reader with the given value

        Parameters
        ----------
        value: float
            The value to use for occurences"""
        try:
            value = float(value)
        except (ValueError, TypeError):
            return
        self.straditizer.data_reader.occurences_value = value

    def setup_children(self, item):
        """Set up the child items for a topLevelItem in the control tree"""
        self.add_info_button(item, 'straditize_steps.rst')

        # 0: start parts before creating the reader
        vbox_start = QVBoxLayout()
        hbox_start = QHBoxLayout()
        hbox_start.addWidget(self.btn_select_data)
        hbox_start.addWidget(self.cb_reader_type)
        vbox_start.addLayout(hbox_start)
        hbox_start = QHBoxLayout()
        hbox_start.addWidget(QLabel('Extraction mode:'))
        hbox_start.addWidget(self.cb_extraction_mode)
        vbox_start.addLayout(hbox_start)
        hbox_start = QHBoxLayout()
        hbox_start.addWidget(QLabel('Segmentation mode:'))
        hbox_start.addWidget(self.cb_segmentation_mode)
        vbox_start.addLayout(hbox_start)
        hbox_start = QHBoxLayout()
        hbox_start.addWidget(QLabel('Target colors:'))
        hbox_start.addWidget(self.txt_target_colors)
        hbox_start.addWidget(self.btn_pick_target_color)
        hbox_start.addWidget(self.btn_pop_target_color)
        hbox_start.addWidget(self.btn_clear_target_colors)
        vbox_start.addLayout(hbox_start)

        w = QWidget()
        w.setLayout(vbox_start)

        child = QTreeWidgetItem(0)
        child.setText(0, 'Reader initialization')
        item.addChild(child)
        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        self.tree.setItemWidget(child2, 0, w)
        self.tree.expandItem(child)
        self.add_info_button(child2, 'select_data_part.rst',
                             connections=[self.btn_select_data])

        # init reader
        child4 = QTreeWidgetItem(0)
        child.addChild(child4)
        self.tree.setItemWidget(child4, 0, self.btn_init_reader)
        self.add_info_button(child4, 'select_reader.rst',
                             connections=[self.btn_init_reader])

        child = QTreeWidgetItem(0)
        item.addChild(child)
        w = QGroupBox('Column separations')
        vbox_cols = QVBoxLayout()
        hbox_thresh = QHBoxLayout()
        hbox_thresh.addWidget(QLabel('Threshold:'))
        hbox_thresh.addWidget(self.txt_column_thresh)
        hbox_thresh.addWidget(QLabel('%'))
        vbox_cols.addLayout(hbox_thresh)
        hbox_cols = QHBoxLayout()
        hbox_cols.addWidget(self.btn_column_starts)
        hbox_cols.addWidget(self.btn_column_ends)
        hbox_cols.addWidget(self.btn_reset_columns)
        vbox_cols.addLayout(hbox_cols)
        vbox_cols.addWidget(self.btn_align_vertical)
        w.setLayout(vbox_cols)
        self.tree.setItemWidget(child, 0, w)
        self.button = self.straditizer_widgets.add_info_button(
            child, 'select_column_starts.rst',
            connections=[self.btn_column_starts])

        # 1: column specific readers
        self.current_reader_item = child = QTreeWidgetItem(0)
        child.setText(0, 'Current reader')
        item.addChild(child)
        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        self.add_info_button(child, 'child_readers.rst',
                             connections=[self.btn_new_child_reader])

        w = QWidget()
        hbox = QHBoxLayout()
        self.cb_readers.setSizeAdjustPolicy(QComboBox.AdjustToContents)
        hbox.addWidget(self.cb_readers)
        hbox.addStretch(0)
        hbox.addWidget(self.btn_new_child_reader)
        w.setLayout(hbox)
        self.tree.setItemWidget(child2, 0, w)

        # 2: Exaggerations readers
        child = QTreeWidgetItem(0)
        child.setText(0, 'Exaggerations')
        item.addChild(child)
        self.add_info_button(child, 'exaggerations.rst',
                             connections=[self.btn_new_exaggeration])

        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        w = QWidget()
        vbox = QVBoxLayout()
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Exaggeration factor:'))
        hbox.addWidget(self.txt_exag_factor)
        vbox.addLayout(hbox)
        hbox = QHBoxLayout()
        hbox.addWidget(self.cb_exag_reader_type)
        hbox.addStretch(0)
        hbox.addWidget(self.btn_new_exaggeration)
        vbox.addLayout(hbox)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Extraction mode:'))
        hbox.addWidget(self.cb_exag_extraction_mode)
        vbox.addLayout(hbox)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Segmentation mode:'))
        hbox.addWidget(self.cb_exag_segmentation_mode)
        vbox.addLayout(hbox)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Target colors:'))
        hbox.addWidget(self.txt_exag_target_colors)
        hbox.addWidget(self.btn_pick_exag_target_color)
        hbox.addWidget(self.btn_pop_exag_target_color)
        hbox.addWidget(self.btn_clear_exag_target_colors)
        vbox.addLayout(hbox)
        vbox.addWidget(self.btn_select_exaggerations)
        digitizer_layout = QGridLayout()
        digitizer_layout.addWidget(QLabel('Merge mode:'), 0, 0)
        digitizer_layout.addWidget(self.cb_exag_merge_mode, 0, 1, 1, 2)
        digitizer_layout.addWidget(QLabel('Percentage:'), 1, 0)
        digitizer_layout.addWidget(self.txt_exag_percentage, 1, 1)
        digitizer_layout.addWidget(QLabel('%'), 1, 2)
        digitizer_layout.addWidget(QLabel('Absolute:'), 2, 0)
        digitizer_layout.addWidget(self.txt_exag_absolute, 2, 1)
        digitizer_layout.addWidget(QLabel('px'), 2, 2)
        digitizer_layout.addWidget(self.btn_digitize_exag, 3, 0, 1, 3)
        vbox.addLayout(digitizer_layout)
        w.setLayout(vbox)
        self.tree.setItemWidget(child2, 0, w)

        # 3: occurences
        self.occurences_child = child = QTreeWidgetItem(0)
        child.setText(0, 'Occurences')
        item.addChild(child)
        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        w = QWidget()
        hbox = QHBoxLayout()
        hbox.addWidget(self.btn_select_occurences)
        hbox.addWidget(self.cb_remove_occurences)
        w.setLayout(hbox)
        self.tree.setItemWidget(child2, 0, w)

        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        w = QWidget()
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Occurence value:'))
        hbox.addWidget(self.txt_occurences_value)
        w.setLayout(hbox)
        self.tree.setItemWidget(child2, 0, w)

        child2 = QTreeWidgetItem(0)
        child.addChild(child2)
        self.tree.setItemWidget(child2, 0, self.btn_edit_occurences)
        self.add_info_button(child, 'occurences.rst',
                             connections=[self.btn_select_occurences,
                                          self.btn_edit_occurences])

        # 4: parts to remove features from the binary image
        self.remove_child = child = QTreeWidgetItem(0)
        child.setText(0, 'Remove features')
        item.addChild(child)
        self.add_info_button(child, 'removing_features.rst')

        # disconnected parts
        dc_child = QTreeWidgetItem(0)
        child.addChild(dc_child)
        self.tree.setItemWidget(dc_child, 0, self.btn_show_disconnected_parts)
        self.add_info_button(dc_child, 'remove_disconnected_parts.rst',
                             connections=[self.btn_show_disconnected_parts])

        dc_child2 = QTreeWidgetItem(0)
        grid = QGridLayout()
        grid.addWidget(self.cb_fromlast, 0, 0)
        grid.addWidget(self.txt_fromlast, 0, 1)
        grid.addWidget(QLabel('px'), 0, 2)
        grid.addWidget(self.cb_from0, 1, 0)
        grid.addWidget(self.txt_from0, 1, 1)
        grid.addWidget(QLabel('px'), 1, 2)
        w = QWidget()
        w.setLayout(grid)
        dc_child.addChild(dc_child2)
        self.tree.setItemWidget(dc_child2, 0, w)

        # parts at column ends
        end_child = QTreeWidgetItem(0)
        child.addChild(end_child)
        self.tree.setItemWidget(end_child, 0,
                                self.btn_show_parts_at_column_ends)
        self.add_info_button(end_child, 'remove_col_ends.rst',
                             connections=[self.btn_show_parts_at_column_ends])

        # cross column features
        cross_child = QTreeWidgetItem(0)
        child.addChild(cross_child)
        self.tree.setItemWidget(cross_child, 0, self.btn_show_cross_column)
        self.add_info_button(cross_child, 'remove_cross_column.rst',
                             connections=[self.btn_show_cross_column])

        cross_child2 = QTreeWidgetItem(0)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Number of pixels:'))
        hbox.addWidget(self.txt_cross_column_px)
        hbox.addWidget(QLabel('px'))
        w = QWidget()
        w.setLayout(hbox)
        cross_child.addChild(cross_child2)
        self.tree.setItemWidget(cross_child2, 0, w)

        # small parts
        small_child = QTreeWidgetItem(0)
        child.addChild(small_child)
        self.tree.setItemWidget(small_child, 0, self.btn_show_small_parts)
        self.add_info_button(small_child, 'remove_small_parts.rst',
                             connections=[self.btn_show_small_parts])

        small_child2 = QTreeWidgetItem(0)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Smaller than'))
        hbox.addWidget(self.txt_max_small_size)
        hbox.addWidget(QLabel('px'))
        w = QWidget()
        w.setLayout(hbox)
        small_child.addChild(small_child2)
        self.tree.setItemWidget(small_child2, 0, w)

        # lines
        self.remove_line_child = line_child = QTreeWidgetItem(0)
        grid = QGridLayout()
        grid.addWidget(self.btn_remove_xaxes, 0, 0)
        grid.addWidget(self.btn_remove_yaxes, 0, 1)
        grid.addWidget(self.btn_remove_hlines, 1, 0)
        grid.addWidget(self.btn_remove_vlines, 1, 1)
        grid.addWidget(self.btn_remove_hlines_manual, 2, 0)
        grid.addWidget(self.btn_remove_vlines_manual, 2, 1)
        w = QWidget()
        w.setLayout(grid)
        child.addChild(line_child)
        self.tree.setItemWidget(line_child, 0, w)
        self.add_info_button(line_child, 'remove_lines.rst',
                             connections=[self.btn_remove_vlines,
                                          self.btn_remove_vlines_manual,
                                          self.btn_remove_hlines,
                                          self.btn_remove_hlines_manual,
                                          self.btn_remove_yaxes,
                                          self.btn_remove_xaxes])

        w = QWidget()
        line_child2 = QTreeWidgetItem(0)
        layout = QGridLayout()
        layout.addWidget(QLabel('Minimum fraction:'), 0, 0)
        layout.addWidget(self.txt_line_fraction, 0, 1)
        layout.addWidget(QLabel('%'), 0, 2)
        layout.addWidget(QLabel('Minimum line width'), 1, 0)
        layout.addWidget(self.sp_min_lw, 1, 1)
        layout.addWidget(QLabel('px'), 1, 2)
        layout.addWidget(self.cb_max_lw, 2, 0)
        layout.addWidget(self.sp_max_lw, 2, 1)
        layout.addWidget(QLabel('px'), 2, 2)
        w.setLayout(layout)
        line_child.addChild(line_child2)
        self.tree.setItemWidget(line_child2, 0, w)

        # highlight selection
        highlight_child = QTreeWidgetItem(0)
        child.addChild(highlight_child)
        self.tree.setItemWidget(highlight_child, 0,
                                self.btn_highlight_small_selection)

        highlight_child2 = QTreeWidgetItem(0)
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel('Smaller than'))
        hbox.addWidget(self.txt_min_highlight)
        hbox.addWidget(QLabel('px'))
        w = QWidget()
        w.setLayout(hbox)
        highlight_child.addChild(highlight_child2)
        self.tree.setItemWidget(highlight_child2, 0, w)

        # 5: digitize button
        self.digitize_item = child = QTreeWidgetItem(0)
        item.addChild(child)
        self.tree.setItemWidget(child, 0, self.btn_digitize)
        self.add_info_button(child, 'digitize.rst',
                             connections=[self.btn_digitize])

        # 6: bar splitter
        self.bar_split_child = QTreeWidgetItem(0)
        self.bar_split_child.setText(0, 'Split bars manually')
        child2 = QTreeWidgetItem(0)
        self.bar_split_child.addChild(child2)
        self.tree.setItemWidget(child2, 0, self.cb_split_source)
        child2 = QTreeWidgetItem(0)
        self.bar_split_child.addChild(child2)
        self.tree.setItemWidget(child2, 0, self.tree_bar_split)
        item.addChild(self.bar_split_child)
        self.bar_split_child.setHidden(not self.tree_bar_split.filled)

        # 7: edit samples button
        self.edit_samples_child = child = QTreeWidgetItem(0)
        child.setText(0, 'Samples')
        item.addChild(child)
        self.add_info_button(child, 'samples.rst')

        find_child = QTreeWidgetItem(0)
        child.addChild(find_child)
        self.tree.setItemWidget(find_child, 0, self.btn_find_samples)
        self.add_info_button(find_child, 'find_samples.rst',
                             connections=[self.btn_find_samples])

        find_child2 = QTreeWidgetItem(0)
        samples_box = QGridLayout()
        samples_box.addWidget(QLabel('Minimum length'), 0, 0)
        samples_box.addWidget(QLabel('Maximum length'), 0, 1)
        samples_box.addWidget(self.txt_min_len, 1, 0)
        samples_box.addWidget(self.txt_max_len, 1, 1)
        samples_box.addWidget(QLabel('Minimum distance'),
                              2, 0)
        samples_box.addWidget(self.sp_pixel_tol, 2, 1)
        samples_box.addWidget(QLabel('px'), 2, 2)
        w = QWidget()
        w.setLayout(samples_box)
        find_child.addChild(find_child2)
        self.tree.setItemWidget(find_child2, 0, w)

        load_child = QTreeWidgetItem(0)
        child.addChild(load_child)
        self.tree.setItemWidget(load_child, 0, self.btn_load_samples)
        self.add_info_button(load_child, 'load_samples.rst',
                             connections=[self.btn_load_samples])

        edit_child = QTreeWidgetItem(0)
        child.addChild(edit_child)
        self.add_info_button(edit_child, 'edit_samples.rst',
                             connections=[self.btn_edit_samples])

        hbox_cols = QHBoxLayout()
        hbox_cols.addWidget(self.btn_edit_samples)
        hbox_cols.addWidget(self.btn_edit_full_data)
        hbox_cols.addWidget(self.btn_reset_samples)
        w = QWidget()
        w.setLayout(hbox_cols)

        self.tree.setItemWidget(edit_child, 0, w)

        edit_child2 = QTreeWidgetItem(0)
        samples_box = QGridLayout()
        samples_box.addWidget(self.cb_edit_separate, 0, 0, 1, 2)
        samples_box.addWidget(QLabel('Number of rows:'), 1, 0)
        samples_box.addWidget(self.txt_edit_rows, 1, 1)
        w = QWidget()
        w.setLayout(samples_box)
        edit_child.addChild(edit_child2)
        self.tree.setItemWidget(edit_child2, 0, w)

    def toggle_bar_split_source(self, i):
        """Fill the :attr:`tree_bar_split` based on the :attr:`cb_split_source`

        Parameters
        ----------
        i: int
            The :meth:`BarSplitter.fill_table` is called with either
            ``'too-long'`` (if `i` is 0), ``'overlaps'`` (if `i` is 1) or
            ``'all'``"""
        if i == 0:
            self.tree_bar_split.fill_table('too-long')
        elif i == 1:
            self.tree_bar_split.fill_table('overlaps')
        else:
            self.tree_bar_split.fill_table('all')

    def init_reader(self):
        """Initialize the reader

        Initialize the data reader with the
        :meth:`straditize.straditizer.Straditizer.init_reader` method"""
        # make sure, the StackedReader is registered
        import straditize.widgets.stacked_area_reader
        kws = self.init_reader_kws.copy()
        reader_type = self.cb_reader_type.currentText()
        kws['reader_type'] = reader_type
        kws['extraction_mode'] = extraction_mode_labels[
            self.cb_extraction_mode.currentText()]
        kws['segmentation_mode'] = segmentation_mode_labels[
            self.cb_segmentation_mode.currentText()]
        try:
            kws['target_colors'] = binary.DataReader.normalize_target_colors(
                self.txt_target_colors.text())
        except ValueError as exc:
            self._show_invalid_color_message(exc)
            return
        if self.straditizer.data_reader is not None:
            for reader in self.straditizer.data_reader.iter_all_readers:
                reader.remove_plots()
        self.straditizer.init_reader(**kws)
        self.straditizer.show_full_image()
        self.straditizer.draw_figure()
        self.straditizer_widgets.refresh()

    def init_exaggerated_reader(self):
        """Initialize the reader for exaggeration features"""
        reader_type = self.cb_exag_reader_type.currentText()
        if reader_type == get_reader_name(self.straditizer.data_reader):
            loader = None
        else:
            loader = binary.readers[reader_type]
        factor = float(self.txt_exag_factor.text())
        try:
            target_colors = binary.DataReader.normalize_target_colors(
                self.txt_exag_target_colors.text())
        except ValueError as exc:
            self._show_invalid_color_message(exc)
            return
        self.straditizer.data_reader.create_exaggerations_reader(
            factor, loader,
            extraction_mode=extraction_mode_labels[
                self.cb_exag_extraction_mode.currentText()],
            segmentation_mode=segmentation_mode_labels[
                self.cb_exag_segmentation_mode.currentText()],
            target_colors=target_colors,
            exaggeration_merge_mode=merge_mode_labels[
                self.cb_exag_merge_mode.currentText()])
        self.straditizer_widgets.refresh()

    def select_exaggerated_features(self):
        """Enable the selection of exaggerated features"""
        tb = self.selection_toolbar
        self.apply_button.clicked.connect(self.finish_exaggerated_features)
        reader = self.straditizer.data_reader
        if reader.is_exaggerated:
            reader = reader.non_exaggerated_reader
        tb.data_obj = reader
        tb.start_selection(
            tb.labels, rgba=reader.image_array(), remove_on_apply=False)
        candidate_mask = reader.suggest_exaggeration_mask()
        if candidate_mask.any():
            tb.prefill_selection_mask(candidate_mask)
            tb.add_select_action.setChecked(True)
            if not tb.wand_action.isChecked():
                tb.wand_action.setChecked(True)
                tb.toggle_selection()
        self.apply_button.setText('Select')

    def finish_exaggerated_features(self):
        """Save the exaggerations in the exaggerations reader

        This method finalizes the operation initialized by the
        :meth:`select_exaggerated_features` by calling the
        :meth:`straditize.binary.DataReader.mark_as_exaggerations` method"""
        mask = self.selection_toolbar.data_obj.selected_part
        self.straditizer.data_reader.mark_as_exaggerations(mask)

    def fill_cb_readers(self):
        """Fill the :attr:`cb_readers` combo based on the current reader"""
        self._change_reader = False
        self.cb_readers.clear()
        if self.straditizer is None or self.straditizer.data_reader is None:
            return
        reader = self.straditizer.data_reader
        if reader.columns:
            for child in chain([reader], reader.children):
                name = get_reader_name(child) or child.__class__.__name__
                exag = 'exag. ' if child.is_exaggerated else ''
                self.cb_readers.addItem(
                    exag + name + ': Columns ' +
                    int_list2str(child.columns or []))
        self._change_reader = True

    def new_reader_for_selection(self, cls=None):
        """Create a new child reader for the selected columns

        This method finishes the process started by
        :meth:`enable_col_selection_for_new_reader`

        Parameters
        ----------
        cls: type
            The subclass of the :class:`straditize.binary.DataReader` class
            to use for the new reader. If None, a QInputDialog is opened and
            we ask for a reader"""
        reader = self.straditizer.data_reader
        cols = sorted(reader._selected_cols)
        if not cols:
            raise ValueError("No columns selected!")
        if not cls:
            from straditize.binary import readers
            current = get_reader_name(reader)
            items = list(readers)
            try:  # put the current type at the front
                items.insert(0, items.pop(items.index(current)))
            except ValueError:
                pass
            name, ok = QInputDialog.getItem(
                self.straditizer_widgets, 'Reader type',
                'Select the reader type for the selected columns',
                items)
            if not ok:
                return
            cls = readers[name]
        reader.new_child_for_cols(cols, cls)
        self.straditizer_widgets.refresh()

    def change_reader(self, txt):
        """Change the current parent reader

        This changes the :attr:`straditize.straditizer.Straditizer.data_reader`
        using the :meth:`straditize.binary.DataReader.set_as_parent` method

        Parameters
        ----------
        s: str
            A string matching ``'Columns (\\d.*)'``, where the numbers are the
            columns of the reader to use"""
        if not self._change_reader:
            return
        match = re.search(r'Columns (\d.*)', txt)
        if not match:
            return
        cols = set(map(int, re.findall(r'\d+', match.group(1))))
        old = self.straditizer.data_reader
        children = chain([old], old.children)
        filter_func = filter if txt.startswith('exag') else filterfalse
        children = filter_func(lambda c: c.is_exaggerated, children)
        new = next(child for child in children if cols <= set(child.columns))
        new.set_as_parent()
        self.straditizer.data_reader = new
        self.straditizer_widgets.refresh()

    def enable_col_selection_for_new_reader(self):
        """Start the selection process to get a new reader for specific cols"""
        reader = self.straditizer.data_reader
        reader.start_column_selection()
        self.connect2apply(
            lambda: self.new_reader_for_selection(),
            reader.end_column_selection,
            reader.draw_figure)
        self.connect2cancel(
            reader.end_column_selection,
            reader.draw_figure)

    def find_samples(self):
        kws = dict(pixel_tol=self.sp_pixel_tol.value())
        if self.txt_min_len.text().strip():
            kws['min_len'] = int(self.txt_min_len.text())
        if self.txt_max_len.text().strip():
            kws['max_len'] = int(self.txt_max_len.text())
        reader = self.straditizer.data_reader
        finder = reader.find_samples
        if (get_reader_name(reader) == 'stacked area' and
                hasattr(reader, 'find_consensus_samples')):
            finder = reader.find_consensus_samples
        reader.add_samples(*finder(**kws))
        self.straditizer_widgets.refresh()

    def load_samples(self, fname=None):
        """Load the samples of a text file

        This method askes for a filename to update the samples. The first
        column in this file is taken as the sample locations. If the
        y-axis translation is already done, the new data is assumed to be in
        this transformed unit.

        Parameters
        ----------
        fname: str
            The path to the file to use. If None, a QFileDialog is opened and
            we ask for a name"""
        if fname is None or not isinstance(fname, six.string_types):
            fname = QFileDialog.getOpenFileName(
                self.straditizer_widgets, 'samples',
                self.straditizer_widgets.menu_actions._start_directory,
                'CSV files (*.csv);;'
                'Excel files (*.xls *.xlsx);;'
                'Straditize projects (*.nc *.nc4 *.pkl);;'
                'All files (*)'
                )
            if with_qt5:  # the filter is passed as well
                fname = fname[0]
        if not fname:
            return
        base, ext = osp.splitext(fname)
        if ext in ['.nc', '.nc4']:
            with xr.open_dataset(fname) as ds:
                df = self.straditizer.from_dataset(ds, plot=False).final_df
        elif ext == '.pkl':
            with open(fname, 'rb') as f:
                df = pickle.load(f).final_df
        elif ext in ['.xls', '.xlsx']:
            df = pd.read_excel(fname, index_col=0)
        else:
            df = pd.read_csv(fname, index_col=0)
        samples = np.array(df.index.values, copy=True)
        try:
            samples = self.straditizer.data2px_y(samples)
        except ValueError:
            pass
        # HACK: truncate to the available data region
        # This could be better solved through a dialog with the user...
        maxy = len(self.reader._full_df) - 1
        samples[samples < 0] = 0
        samples[samples > maxy] = maxy
        self.straditizer.data_reader.add_samples(
            np.unique(samples.astype(int)))
        self.straditizer_widgets.refresh()

    def edit_samples(self):
        """Enable the sample editing

        This method opens a
        :class:`straditize.widgets.samples_table.MultiCrossMarksEditor` or a
        :class:`straditize.widgets.samples_table.SingleCrossMarksEditor` to
        edit the samples in the GUI. Depending on whether the
        :attr:`cb_edit_separate` is checked or not, we use the
        :meth:`straditize.straditizer.Straditizer.marks_for_samples_sep` or
        :meth:`straditize.straditizer.Straditizer.marks_for_samples`
        method."""
        from psyplot_gui.main import mainwindow
        from straditize.widgets.samples_table import (
            MultiCrossMarksEditor, SingleCrossMarksEditor)
        draw_sep = self.cb_edit_separate.isChecked()
        ref = weakref.ref(self.straditizer)
        if draw_sep:
            fig, axes = self.straditizer.marks_for_samples_sep()
            if mainwindow.figures:  # using psyplot backend
                fig_dock = fig.canvas.manager.window
                stradi_dock = self.straditizer.ax.figure.canvas.manager.window
                mainwindow.tabifyDockWidget(stradi_dock, fig_dock)
                a = fig_dock.toggleViewAction()
                if not a.isChecked():
                    a.trigger()
                fig_dock.raise_()
            self._samples_editor = editor = MultiCrossMarksEditor(
                ref, axes=axes)
        else:
            self.straditizer.marks_for_samples()
            self._samples_editor = editor = SingleCrossMarksEditor(ref)
        editor.to_dock(
            mainwindow, title='Samples editor')
        editor.show_plugin()
        editor.maybe_tabify()
        editor.raise_()
        # zoom to the first 3 samples
        ncols = editor.table.model().columnCount() - 1
        nrows = min(3, editor.table.model().rowCount())
        if draw_sep:
            editor.table.zoom_to_cells(
                chain.from_iterable([i] * ncols for i in range(nrows)),
                list(range(ncols)) * nrows)
        self._draw_sep = draw_sep
        self.connect2apply(
            self._update_samples,
            self._close_samples_fig, self.straditizer_widgets.refresh)
        self.connect2cancel(
            self.straditizer.remove_marks, self._close_samples_fig)
        self.maybe_show_btn_reset_samples()

    def edit_full_data(self):
        """Open an interactive editor for the full digitized data.

        Left click adds a row at the clicked y-position. Right click removes
        the nearest existing row. With Shift held, left click adds a control
        point and Shift+right click removes the nearest optional control point.
        Turning-point marks on the plotted full data can be dragged horizontally
        to reshape the digitized profile.
        """
        from straditize.widgets import get_mainwindow

        reader = self.reader
        if reader is None or reader._full_df is None:
            return

        mainwindow = get_mainwindow(self.straditizer_widgets)
        editor = mainwindow.new_data_frame_editor(
            reader._full_df,
            'Full digitized data (pixel) - Drag points / Shift+click point '
            '/ Left click add row / Right click del row')
        model = editor.table.model()

        def refresh_plots(*args, **kwargs):
            pc = self.straditizer_widgets.plot_control.table
            if pc.can_plot_full_df() and pc.get_full_df_lines():
                pc.remove_full_df_plot()
                pc.plot_full_df()
                pc.refresh()
            self.straditizer.draw_figure()

        try:
            model.dataChanged.connect(refresh_plots)
        except AttributeError:
            pass
        try:
            model.modelReset.connect(refresh_plots)
        except AttributeError:
            pass

        self._disconnect_full_data_editor_events()
        self._full_data_editor = editor
        self._full_data_click_fig = weakref.ref(reader.ax.figure)
        self._full_data_click_cid = reader.ax.figure.canvas.mpl_connect(
            'button_press_event', self._edit_full_data_from_click)
        self._create_full_data_turning_point_marks()
        try:
            editor.destroyed.connect(self._disconnect_full_data_editor_events)
        except AttributeError:
            pass

        return editor

    def _disconnect_full_data_editor_events(self, *args, **kwargs):
        self._clear_full_data_marks(clear_state=True)
        fig = getattr(self, '_full_data_click_fig', lambda: None)()
        cid = getattr(self, '_full_data_click_cid', None)
        if fig is not None and cid is not None:
            fig.canvas.mpl_disconnect(cid)
        for attr in ['_full_data_click_fig', '_full_data_click_cid',
                     '_full_data_editor', '_full_data_control_rows',
                     '_full_data_required_rows']:
            if hasattr(self, attr):
                delattr(self, attr)

    def _coerce_full_data_index(self, y):
        index = self.reader._full_df.index
        if np.issubdtype(index.dtype, np.integer):
            return int(np.round(y))
        return float(y)

    def _add_full_data_row(self, y):
        reader = self.reader
        df = reader._full_df
        y_idx = self._coerce_full_data_index(y)
        if y_idx in df.index:
            return False
        if df.empty:
            return False

        y_interp = float(y_idx)
        values = {}
        for col, s in df.items():
            valid = s.dropna()
            if valid.empty:
                values[col] = np.nan
            elif len(valid) == 1:
                values[col] = valid.iloc[0]
            else:
                valid = valid.sort_index()
                x = valid.index.values.astype(float)
                values[col] = np.interp(y_interp, x, valid.values.astype(float))

        df.loc[y_idx] = pd.Series(values)
        df.sort_index(inplace=True)
        return True

    def _remove_nearest_full_data_row(self, y):
        reader = self.reader
        df = reader._full_df
        if len(df.index) <= 1:
            return False
        idx = nearest_index_position(df.index, y)
        df.drop(df.index[idx], inplace=True)
        return True

    def _full_data_row_y(self, row):
        reader = self.reader
        y0 = 0.0
        if reader.extent is not None:
            y0 = float(min(reader.extent[2:]))
        return float(row) + 0.5 + y0

    def _full_data_column_abs_bounds(self, col):
        reader = self.reader
        df = reader._full_df
        col_pos = list(df.columns).index(col)
        starts = np.asarray(reader.all_column_starts, dtype=float)
        ends = np.asarray(reader.all_column_ends, dtype=float)
        x0 = float(reader.extent[0] if reader.extent is not None else 0.0)
        return (col_pos, starts[col_pos] + x0, ends[col_pos] + x0)

    @staticmethod
    def _rdp_point_indices(x, y, epsilon):
        if len(x) <= 2:
            return [0, len(x) - 1] if len(x) else []

        start = np.array([x[0], y[0]], dtype=float)
        end = np.array([x[-1], y[-1]], dtype=float)
        vec = end - start
        norm = np.hypot(vec[0], vec[1])
        if norm == 0:
            dists = np.hypot(x[1:-1] - start[0], y[1:-1] - start[1])
        else:
            pts = np.column_stack([x[1:-1], y[1:-1]])
            rel = pts - start
            dists = np.abs(vec[0] * rel[:, 1] - vec[1] * rel[:, 0]) / norm
        if not len(dists):
            return [0, len(x) - 1]
        imax = int(np.argmax(dists))
        if dists[imax] <= epsilon:
            return [0, len(x) - 1]
        split = imax + 1
        left = DigitizingControl._rdp_point_indices(
            x[:split + 1], y[:split + 1], epsilon)
        right = DigitizingControl._rdp_point_indices(
            x[split:], y[split:], epsilon)
        return left[:-1] + [i + split for i in right]

    def _full_data_turning_rows(self, series, epsilon=1.0, max_points=24):
        valid = series.dropna()
        if valid.empty:
            return []
        index = valid.index.values.astype(float)
        values = valid.values.astype(float)
        split_locs = np.where(np.diff(index) > 1)[0] + 1
        row_groups = np.split(valid.index.values, split_locs)
        value_groups = np.split(values, split_locs)
        rows = []
        for seg_rows, seg_vals in zip(row_groups, value_groups):
            if len(seg_rows) <= 2:
                rows.extend(seg_rows.tolist())
                continue
            seg_x = np.asarray(seg_rows, dtype=float)
            seg_y = np.asarray(seg_vals, dtype=float)
            tol = float(epsilon)
            keep = self._rdp_point_indices(seg_x, seg_y, tol)
            while len(keep) > max_points:
                tol *= 1.5
                keep = self._rdp_point_indices(seg_x, seg_y, tol)
            rows.extend(seg_rows[keep].tolist())
        return list(unique_everseen(rows))

    def _compute_full_data_required_rows(self, series):
        valid = series.dropna()
        if valid.empty:
            return set()
        split_locs = np.where(
            np.diff(valid.index.values.astype(float)) > 1)[0] + 1
        row_groups = np.split(valid.index.values, split_locs)
        required = set()
        for seg_rows in row_groups:
            if len(seg_rows):
                required.add(seg_rows[0])
                required.add(seg_rows[-1])
        return required

    def _sync_full_data_control_rows(self):
        reader = self.reader
        if reader is None or reader._full_df is None:
            return
        if not hasattr(self, '_full_data_control_rows'):
            self._full_data_control_rows = {}
        if not hasattr(self, '_full_data_required_rows'):
            self._full_data_required_rows = {}
        if not hasattr(self, '_full_data_auto_rows'):
            self._full_data_auto_rows = {}
        if not hasattr(self, '_full_data_manual_rows'):
            self._full_data_manual_rows = {}
        for col in reader._full_df.columns:
            series = reader._full_df.loc[:, col]
            valid_rows = set(series.dropna().index.tolist())
            required = self._compute_full_data_required_rows(series)
            rows = set(self._full_data_control_rows.get(col, [])) & valid_rows
            auto_rows = set(self._full_data_auto_rows.get(col, [])) & valid_rows
            manual_rows = set(
                self._full_data_manual_rows.get(col, [])) & valid_rows
            if not rows:
                auto_rows = set(self._full_data_turning_rows(series))
                rows = set(auto_rows)
            auto_rows |= rows - manual_rows - required
            rows |= required
            self._full_data_control_rows[col] = sorted(rows)
            self._full_data_required_rows[col] = required
            self._full_data_auto_rows[col] = sorted(auto_rows & rows)
            self._full_data_manual_rows[col] = sorted(manual_rows & rows)

    def _full_data_mark_value(self, mark):
        value = float(mark.x) - float(mark._full_data_start_abs)
        return np.clip(value, 0.0, float(mark._full_data_width))

    def _clear_full_data_marks(self, clear_state=False):
        for mark in getattr(self, '_full_data_marks', []):
            try:
                mark.moved.disconnect(self._update_full_data_from_turning_point)
            except Exception:
                pass
            try:
                mark.remove()
            except Exception:
                pass
        if hasattr(self, '_full_data_marks'):
            del self._full_data_marks
        if clear_state:
            for attr in ['_full_data_control_rows', '_full_data_required_rows',
                         '_full_data_auto_rows', '_full_data_manual_rows']:
                if hasattr(self, attr):
                    delattr(self, attr)

    def _full_data_mark_visual_style(self, required=False, manual=False):
        if manual:
            color = full_data_mark_palette['manual']
        elif required:
            color = full_data_mark_palette['required']
        else:
            color = full_data_mark_palette['auto']
        return {
            'base_color': color,
            'guide_alpha': 0.45,
            'guide_lw': 1.2,
            'markerfacecolor': color,
            'markeredgecolor': '#ffffff',
            'markeredgewidth': 1.3,
            'markersize': 7.5 if manual else 6.5,
            'select_props': {
                'color': full_data_mark_palette['selected'],
                'markerfacecolor': full_data_mark_palette['selected'],
                'markeredgecolor': '#111111',
                'markersize': 8.5 if manual else 7.5,
            },
        }

    def _create_full_data_turning_point_marks(self):
        from straditize import cross_mark as cm

        reader = self.reader
        if reader is None or reader._full_df is None or reader.ax is None:
            return
        self._clear_full_data_marks()
        self._sync_full_data_control_rows()
        marks = []
        for col in reader._full_df.columns:
            series = reader._full_df.loc[:, col]
            rows = self._full_data_control_rows.get(col, [])
            if not rows:
                continue
            _, start_abs, end_abs = self._full_data_column_abs_bounds(col)
            width = max(float(end_abs - start_abs), 0.0)
            required_rows = set(self._full_data_required_rows.get(col, []))
            manual_rows = set(self._full_data_manual_rows.get(col, []))
            for row in rows:
                value = series.loc[row]
                if np.isnan(value):
                    continue
                required = row in required_rows
                manual = row in manual_rows
                style = self._full_data_mark_visual_style(
                    required=required, manual=manual)
                mark = cm.CrossMarks(
                    (start_abs + float(value), self._full_data_row_y(row)),
                    ax=reader.ax, selectable=['v'], draggable=['v'],
                    xlim=(start_abs, end_abs), ylim=reader.ax.get_ylim(),
                    select_props=style['select_props'], hide_horizontal=False,
                    auto_hide=False, lock=False, zorder=5, marker='o',
                    linewidth=0.0, color=style['base_color'],
                    markerfacecolor=style['markerfacecolor'],
                    markeredgecolor=style['markeredgecolor'],
                    markeredgewidth=style['markeredgewidth'],
                    markersize=style['markersize'])
                mark._full_data_column = col
                mark._full_data_row = row
                mark._full_data_start_abs = start_abs
                mark._full_data_width = width
                mark._full_data_required = required
                mark._full_data_manual = manual
                mark._full_data_base_color = style['base_color']
                mark.hline.set_linewidth(0.0)
                mark.hline.set_alpha(1.0)
                mark.vline.set_linewidth(style['guide_lw'])
                mark.vline.set_alpha(style['guide_alpha'])
                mark.vline.set_color(style['base_color'])
                mark.moved.connect(self._update_full_data_from_turning_point)
                marks.append(mark)
        self._full_data_marks = marks

    @staticmethod
    def _event_key_tokens(event):
        key = getattr(event, 'key', None)
        if not key:
            return set()
        if not isinstance(key, six.string_types):
            key = str(key)
        return set(filter(None, re.split(r'[\s,+;]+', key.lower())))

    def _is_full_data_control_point_event(self, event):
        return 'shift' in self._event_key_tokens(event)

    def _full_data_column_from_x(self, x):
        reader = self.reader
        x = float(x)
        x0 = float(reader.extent[0] if reader.extent is not None else 0.0)
        bounds = np.asarray(reader.all_column_bounds, dtype=float) + x0
        inside = np.where((x >= bounds[:, 0]) & (x <= bounds[:, 1]))[0]
        if len(inside):
            return reader._full_df.columns[int(inside[0])]
        distances = np.minimum(np.abs(x - bounds[:, 0]), np.abs(x - bounds[:, 1]))
        return reader._full_df.columns[int(np.argmin(distances))]

    def _nearest_full_data_row(self, col, y):
        series = self.reader._full_df.loc[:, col].dropna()
        if series.empty:
            return None
        return series.index[nearest_index_position(series.index, y)]

    def _add_full_data_control_point(self, event):
        reader = self.reader
        if reader is None or reader._full_df is None:
            return False
        valid_axes = [ax for ax in [reader.ax, self.straditizer.ax]
                      if ax is not None]
        if (event.inaxes not in valid_axes or event.xdata is None or
                event.ydata is None):
            return False
        col = self._full_data_column_from_x(event.xdata)
        row = self._nearest_full_data_row(col, self._event_to_full_data_y(event))
        if row is None:
            y = self._event_to_full_data_y(event)
            self._add_full_data_row(y)
            row = self._nearest_full_data_row(col, y)
            if row is None:
                return False
        already_present = row in set(self._full_data_control_rows.get(col, []))
        _, start_abs, end_abs = self._full_data_column_abs_bounds(col)
        value = np.clip(float(event.xdata) - start_abs, 0.0, end_abs - start_abs)
        reader._full_df.loc[row, col] = value
        self._sync_full_data_control_rows()
        rows = set(self._full_data_control_rows.get(col, []))
        rows.add(row)
        rows |= self._full_data_required_rows.get(col, set())
        self._full_data_control_rows[col] = sorted(rows)
        manual_rows = set(self._full_data_manual_rows.get(col, []))
        if not already_present:
            manual_rows.add(row)
        self._full_data_manual_rows[col] = sorted(manual_rows)
        self._rebuild_full_data_column_from_control_rows(col)
        return True

    def _mark_hit_distance(self, mark, event):
        """Calculate display pixel distance (or data pixel distance) between mark and event."""
        if self.reader is not None and self.reader.ax is not None:
            try:
                mx, my = self.reader.ax.transData.transform((mark.x, mark.y))
                if getattr(event, 'x', None) is not None and getattr(event, 'y', None) is not None:
                    ex, ey = event.x, event.y
                elif event.xdata is not None and event.ydata is not None:
                    ex, ey = self.reader.ax.transData.transform((float(event.xdata), float(event.ydata)))
                else:
                    return float('inf')
                return float(np.hypot(mx - ex, my - ey))
            except Exception:
                pass
        return float(np.hypot(mark.x - float(event.xdata), mark.y - float(event.ydata)))

    def _nearest_full_data_mark(self, event, max_screen_pixels=8.0):
        marks = getattr(self, '_full_data_marks', [])
        if not marks or event.xdata is None or event.ydata is None:
            return None
        distances = [self._mark_hit_distance(m, event) for m in marks]
        if not distances:
            return None
        idx = int(np.argmin(distances))
        if distances[idx] > max_screen_pixels:
            return None
        return marks[idx]

    def _nearest_optional_full_data_mark(self, event, max_screen_pixels=12.0):
        marks = [
            m for m in getattr(self, '_full_data_marks', [])
            if not getattr(m, '_full_data_required', False)]
        if not marks or event.xdata is None or event.ydata is None:
            return None
        distances = [self._mark_hit_distance(m, event) for m in marks]
        if not distances:
            return None
        idx = int(np.argmin(distances))
        if distances[idx] > max_screen_pixels:
            return None
        return marks[idx]

    def _remove_full_data_control_point(self, event):
        mark = self._nearest_optional_full_data_mark(event)
        if mark is None:
            return False
        col = mark._full_data_column
        rows = set(self._full_data_control_rows.get(col, []))
        rows.discard(mark._full_data_row)
        rows |= self._full_data_required_rows.get(col, set())
        self._full_data_control_rows[col] = sorted(rows)
        auto_rows = set(self._full_data_auto_rows.get(col, []))
        auto_rows.discard(mark._full_data_row)
        self._full_data_auto_rows[col] = sorted(auto_rows)
        manual_rows = set(self._full_data_manual_rows.get(col, []))
        manual_rows.discard(mark._full_data_row)
        self._full_data_manual_rows[col] = sorted(manual_rows)
        self._rebuild_full_data_column_from_control_rows(col)
        return True

    def _set_full_data_column_from_controls(self, col, rows, values):
        reader = self.reader
        if reader is None or reader._full_df is None:
            return
        series = reader._full_df.loc[:, col]
        valid = series.dropna()
        if valid.empty:
            return
        rows = np.asarray(rows, dtype=float)
        values = np.asarray(values, dtype=float)
        if not len(rows):
            return
        order = np.argsort(rows)
        rows = rows[order]
        values = values[order]
        unique_rows, idx = np.unique(rows, return_index=True)
        rows = unique_rows
        values = values[idx]
        target = valid.index.values.astype(float)
        if len(rows) == 1:
            new_values = np.full(target.shape, values[0], dtype=float)
        else:
            new_values = np.interp(target, rows, values)
        reader._full_df.loc[valid.index, col] = new_values

    def _rebuild_full_data_column_from_control_rows(self, col):
        reader = self.reader
        if reader is None or reader._full_df is None:
            return
        rows = self._full_data_control_rows.get(col, [])
        if not rows:
            return
        values = reader._full_df.loc[rows, col].values.astype(float)
        self._set_full_data_column_from_controls(col, rows, values)

    def _update_full_data_from_turning_point(self, old_pos, mark):
        reader = self.reader
        if reader is None or reader._full_df is None:
            return
        col = mark._full_data_column
        series = reader._full_df.loc[:, col].copy()
        valid = series.dropna()
        if valid.empty:
            return
        marks = [m for m in getattr(self, '_full_data_marks', [])
                 if getattr(m, '_full_data_column', None) == col]
        if not marks:
            return
        rows = [m._full_data_row for m in marks]
        values = [self._full_data_mark_value(m) for m in marks]
        self._set_full_data_column_from_controls(col, rows, values)
        self._refresh_full_data_editor_and_plot(rebuild_marks=False)

    def _refresh_full_data_editor_and_plot(self, rebuild_marks=False):
        editor = getattr(self, '_full_data_editor', None)
        if editor is not None:
            try:
                editor.set_df(self.reader._full_df, show=False)
            except RuntimeError:
                pass
        pc = self.straditizer_widgets.plot_control.table
        if pc.can_plot_full_df():
            if pc.get_full_df_lines():
                pc.remove_full_df_plot()
            pc.plot_full_df()
            pc.refresh()
        if rebuild_marks:
            self._create_full_data_turning_point_marks()
        self.straditizer.draw_figure()

    @staticmethod
    def _is_left_click(button):
        try:
            from matplotlib.backend_bases import MouseButton
        except ImportError:
            return button == 1
        return button in [1, MouseButton.LEFT]

    @staticmethod
    def _is_right_click(button):
        try:
            from matplotlib.backend_bases import MouseButton
        except ImportError:
            return button == 3
        return button in [3, MouseButton.RIGHT]

    def _event_to_full_data_y(self, event):
        y = float(event.ydata)
        reader = self.reader
        if event.inaxes is reader.ax:
            extent = getattr(reader, 'extent', None)
            if extent is not None:
                y -= float(min(extent[2:]))
        elif event.inaxes is self.straditizer.ax:
            ylim = getattr(self.straditizer, 'data_ylim', None)
            if ylim is not None:
                y -= float(min(ylim))
        # Full-data rows are plotted at row centers (row + 0.5), so convert
        # mouse picks back to the underlying index before nearest-row lookup.
        return y - 0.5

    def _edit_full_data_from_click(self, event):
        from straditize.straditizer import get_toolbar_mode

        reader = self.reader
        if reader is None or reader._full_df is None:
            return
        valid_axes = [ax for ax in [reader.ax, self.straditizer.ax]
                      if ax is not None]
        if (event.inaxes not in valid_axes or event.ydata is None or
                not (self._is_left_click(event.button) or
                     self._is_right_click(event.button)) or
                get_toolbar_mode(reader.ax.figure) != ''):
            return

        key_tokens = self._event_key_tokens(event)
        is_shift = 'shift' in key_tokens
        is_ctrl = 'control' in key_tokens or 'ctrl' in key_tokens
        has_xdata = getattr(event, 'xdata', None) is not None
        is_left = self._is_left_click(event.button)
        is_right = self._is_right_click(event.button)

        changed = False
        if is_left:
            # If Shift is pressed, always add/update control point.
            # If Shift is NOT pressed, only yield to dragging if clicked directly on an existing mark.
            if not is_shift and has_xdata and self._nearest_full_data_mark(event) is not None:
                return
            if has_xdata:
                changed = self._add_full_data_control_point(event)
            else:
                y = self._event_to_full_data_y(event)
                changed = self._add_full_data_row(y)
        elif is_right:
            # Right click: prioritize removing control mark under or near cursor
            if has_xdata and self._nearest_optional_full_data_mark(event) is not None:
                changed = self._remove_full_data_control_point(event)
            elif is_shift:
                changed = self._remove_full_data_control_point(event)
            elif is_ctrl or not has_xdata:
                y = self._event_to_full_data_y(event)
                changed = self._remove_nearest_full_data_row(y)

        if changed:
            self._refresh_full_data_editor_and_plot(rebuild_marks=True)

    def _update_samples(self):
        if self._draw_sep:
            self.straditizer.update_samples_sep()
        else:
            self.straditizer.update_samples()

    def _close_samples_fig(self):
        import matplotlib.pyplot as plt
        for l in self._samples_editor.table.model().lines:
            try:
                l.remove()
            except ValueError:
                pass
        try:
            fig = self._samples_fig()
        except (AttributeError, RuntimeError):
            self.straditizer.draw_figure()
        else:
            if fig is not None:
                plt.close(fig.number)
                del self._samples_fig
        self._samples_editor.dock.close()
        try:
            self.straditizer.mark_added.disconnect(
                self._samples_editor.table.model().load_new_marks)
        except ValueError:
            pass
        try:
            self.straditizer.mark_removed.disconnect(
                self._samples_editor.table.model().remove_mark)
        except ValueError:
            pass
        del self._samples_editor
        try:
            del self.straditizer._plotted_full_df
        except AttributeError:
            pass

    def digitize(self):
        """Digitize the data

        This method uses the :meth:`straditize.binary.DataReader.digitize`
        method to digitize the data of the current reader"""
        reader = self.reader
        if self.txt_tolerance and self.txt_tolerance.isEnabled():
            reader.tolerance = int(self.txt_tolerance.text())
        if reader.is_exaggerated:
            reader = reader.non_exaggerated_reader
        reader.digitize()
        pc = self.straditizer_widgets.plot_control.table
        if pc.can_plot_full_df():
            if pc.get_full_df_lines():
                pc.remove_full_df_plot()
            pc.plot_full_df()
            pc.refresh()

    def _plot_exaggeration_preview(self, reader, merged_df, mask_df, exag_df):
        """Create an overlay preview for exaggeration merge confirmation."""
        import matplotlib.pyplot as plt

        fig = create_matplotlib_figure(
            headless=should_use_headless_figure())
        ax = fig.subplots()
        extent = reader.extent
        if extent is None:
            image = np.asarray(reader.image)
            extent = [0, image.shape[1], image.shape[0], 0]
        ax.imshow(reader.image, extent=extent, zorder=0)
        try:
            fig.canvas.manager.set_window_title('Exaggeration merge preview')
        except Exception:
            pass

        y0 = float(extent[3])
        x0 = float(extent[0])
        y = np.asarray(merged_df.index, dtype=float) + 0.5 + y0
        bounds = np.asarray(reader.column_bounds, dtype=float)
        factor = float(reader.exaggerated_reader.is_exaggerated or 1.0)
        primary_df = reader.full_df
        exag_vals = exag_df / factor

        for i, col in enumerate(merged_df.columns):
            start = x0 + bounds[i, 0]
            primary = np.asarray(primary_df.loc[:, col], dtype=float)
            merged = np.asarray(merged_df.loc[:, col], dtype=float)
            exag = np.asarray(exag_vals.loc[:, col], dtype=float)
            used = np.asarray(mask_df.loc[:, col], dtype=bool)
            ax.plot(start + primary, y, color='black', alpha=0.45, lw=0.8)
            ax.plot(start + exag, y, color='#ff8c00', alpha=0.45, lw=0.8)
            merged_used = np.where(used, merged, np.nan)
            ax.plot(start + merged_used, y, color='#00ff66', alpha=0.95, lw=1.5)

        ax.set_title('Black: primary, Orange: exag/factor, Green: merged')
        ax.set_xlim(extent[0], extent[1])
        ax.set_ylim(extent[2], extent[3])
        ax.grid(False)
        fig.canvas.draw()
        return fig

    def _confirm_exaggeration_merge(self, reader, fraction, absolute, merge_mode):
        """Show a mandatory preview and ask for explicit apply confirmation."""
        import matplotlib.pyplot as plt

        exag = reader.exaggerated_reader
        if exag is None:
            QMessageBox.information(
                self.straditizer_widgets, 'No exaggeration reader',
                'Create an exaggeration reader first.')
            return False
        if not exag.binary.any():
            QMessageBox.information(
                self.straditizer_widgets, 'No exaggeration pixels',
                'No exaggeration pixels are selected yet. Use '
                '"Select exaggerations" first.')
            return False

        merged_df, mask_df = reader.digitize_exaggerated(
            fraction=fraction, absolute=absolute, inplace=False,
            return_mask=True, merge_mode=merge_mode)
        if not mask_df.values.any():
            QMessageBox.information(
                self.straditizer_widgets, 'No merge candidates',
                'The current settings produced no merge candidates. '
                'Adjust colors/mode or selection and try again.')
            return False
        exag_df = exag.digitize(inplace=False)
        fig = self._plot_exaggeration_preview(reader, merged_df, mask_df, exag_df)
        ret = QMessageBox.question(
            self.straditizer_widgets, 'Apply exaggeration merge',
            'Preview is ready. Apply this merge to the current full data?',
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        try:
            plt.close(fig.number)
        except Exception:
            pass
        return ret == QMessageBox.Yes

    def digitize_exaggerations(self):
        """Digitize the data

        This method uses the
        :meth:`straditize.binary.DataReader.digitize_exaggerated` method to
        digitize the exaggerated data of the current reader and merge it into
        the data obtained by the :meth:`digitize` method."""
        reader = self._base_reader()
        if reader is None:
            return
        fraction = float(self.txt_exag_percentage.text().strip() or 0) / 100.
        absolute = int(self.txt_exag_absolute.text().strip() or 0)
        merge_mode = merge_mode_labels[self.cb_exag_merge_mode.currentText()]
        if not self._confirm_exaggeration_merge(
                reader, fraction, absolute, merge_mode):
            return
        reader.digitize_exaggerated(
            fraction=fraction, absolute=absolute, merge_mode=merge_mode)
        self.straditizer_widgets.refresh()

    def remove_xaxes(self):
        """Remove x-axes in the plot

        This method uses the
        :meth:`straditize.binary.DataReader.recognize_xaxes` method to identify
        x-axes in the plot"""
        fraction = float(self.txt_line_fraction.text().strip() or 0) / 100.
        max_lw = self.sp_max_lw.value() if self.cb_max_lw.isChecked() else None
        min_lw = int(self.sp_min_lw.text().strip() or 1)
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.recognize_xaxes(fraction=fraction, min_lw=min_lw,
                                    max_lw=max_lw)
        self.apply_button.clicked.connect(
            lambda: self.reader.set_hline_locs_from_selection())
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
        tb.set_row_wand_mode()
        self.straditizer.draw_figure()

    def remove_hlines(self):
        """Remove horizontal lines

        This method uses the
        :meth:`straditize.binary.DataReader.recognize_hlines` method to
        identify horizontal lines in the plot"""
        fraction = float(self.txt_line_fraction.text().strip() or 0) / 100.
        max_lw = self.sp_max_lw.value() if self.cb_max_lw.isChecked() else None
        min_lw = int(self.sp_min_lw.text().strip() or 1)
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.recognize_hlines(fraction=fraction, min_lw=min_lw,
                                     max_lw=max_lw)
        self.apply_button.clicked.connect(
            lambda: self.reader.set_hline_locs_from_selection())
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
        tb.set_row_wand_mode()
        self.straditizer.draw_figure()

    def remove_hlines_manually(self):
        """Remove horizontal lines from user-defined endpoints."""
        self._remove_lines_from_endpoints(vertical=False)

    def remove_yaxes(self):
        """Remove y-axes in the plot

        This method uses the
        :meth:`straditize.binary.DataReader.recognize_yaxes` method to identify
        y-axes in the plot"""
        fraction = float(self.txt_line_fraction.text().strip() or 0) / 100.
        max_lw = self.sp_max_lw.value() if self.cb_max_lw.isChecked() else None
        min_lw = self.sp_min_lw.value()
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.recognize_yaxes(fraction=fraction, min_lw=min_lw,
                                    max_lw=max_lw)
        self.apply_button.clicked.connect(
            lambda: self.reader.set_vline_locs_from_selection())
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
        tb.set_col_wand_mode()
        self.straditizer.draw_figure()

    def remove_vlines(self):
        """Remove vertical lines

        This method uses the
        :meth:`straditize.binary.DataReader.recognize_vlines` method to
        identify vertical lines in the plot"""
        fraction = float(self.txt_line_fraction.text().strip() or 0) / 100.
        max_lw = self.sp_max_lw.value() if self.cb_max_lw.isChecked() else None
        min_lw = self.sp_min_lw.value()
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.recognize_vlines(fraction=fraction, min_lw=min_lw,
                                     max_lw=max_lw)
        self.apply_button.clicked.connect(
            lambda: self.reader.set_vline_locs_from_selection())
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
        tb.set_col_wand_mode()
        self.straditizer.draw_figure()

    def remove_vlines_manually(self):
        """Remove vertical lines from user-defined endpoints."""
        self._remove_lines_from_endpoints(vertical=True)

    def _parse_line_endpoints(self, text):
        endpoints = []
        float_pattern = r'[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?'
        for i, raw in enumerate(filter(None, map(str.strip, text.splitlines())),
                                start=1):
            nums = re.findall(float_pattern, raw)
            if len(nums) != 4:
                raise ValueError(
                    'Line %d: please provide exactly 4 numbers (x0,y0,x1,y1)'
                    % i)
            endpoints.append(tuple(map(float, nums)))
        if not endpoints:
            raise ValueError('No endpoints provided.')
        return endpoints

    @staticmethod
    def _line_to_mask_indices(shape, x0, y0, x1, y1, width=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        xs = np.round(np.linspace(x0, x1, n)).astype(int)
        ys = np.round(np.linspace(y0, y1, n)).astype(int)
        radius = max(int(width) // 2, 0)
        all_x = []
        all_y = []
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                xx = xs + dx
                yy = ys + dy
                valid = ((xx >= 0) & (xx < shape[1]) &
                         (yy >= 0) & (yy < shape[0]))
                if np.any(valid):
                    all_x.append(xx[valid])
                    all_y.append(yy[valid])
        if not all_x:
            return np.array([], dtype=int), np.array([], dtype=int)
        return np.concatenate(all_x), np.concatenate(all_y)

    def _remove_lines_from_endpoints(self, vertical=False):
        reader = self.reader
        if reader is None:
            return

        title = 'Manual %s lines by endpoints' % (
            'vertical' if vertical else 'horizontal')
        help_txt = (
            'Input one line per row: x0, y0, x1, y1\n'
            'Example:\n'
            '12, 34, 12, 180\n'
            '45, 60, 220, 60')
        text, ok = QInputDialog.getMultiLineText(
            self.straditizer_widgets, title, help_txt)
        if not ok:
            return
        try:
            endpoints = self._parse_line_endpoints(text)
        except ValueError as e:
            QMessageBox.warning(self.straditizer_widgets, 'Invalid input',
                                six.text_type(e))
            return

        extent = getattr(reader, 'extent', None)
        xoff = int(np.ceil(extent[0])) if extent is not None else 0
        yoff = int(np.ceil(min(extent[2:]))) if extent is not None else 0
        width = max(1, self.sp_min_lw.value())
        mask = np.zeros_like(reader.binary, dtype=bool)
        removed = 0

        for x0, y0, x1, y1 in endpoints:
            dx = abs(x1 - x0)
            dy = abs(y1 - y0)
            if vertical and dy < dx:
                continue
            if not vertical and dx < dy:
                continue
            xx, yy = self._line_to_mask_indices(
                reader.binary.shape, x0 - xoff, y0 - yoff, x1 - xoff,
                y1 - yoff, width=width)
            if len(xx):
                mask[yy, xx] = True
                removed += 1

        if not removed:
            QMessageBox.information(
                self.straditizer_widgets, 'No matching lines',
                'No %s lines matched the given endpoints.' % (
                    'vertical' if vertical else 'horizontal'))
            return

        reader.binary[mask] = 0
        reader.reset_labels()
        if reader.plot_im is not None:
            reader.plot_im.set_array(reader.labels)
        if reader.magni_plot_im is not None:
            reader.magni_plot_im.set_array(reader.labels)
        reader.draw_figure()
        self.straditizer_widgets.refresh()

    def _start_manual_line_removal(self, vertical=False):
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        tb.start_selection(tb.data_obj.labels, rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        tb.select_action.setChecked(True)
        tb.set_rect_select_mode()
        self.straditizer.draw_figure()

    def enable_occurences_selection(self):
        """Enable the selection of occurences

        This method starts the selection of features in the data image and
        connects the :meth:`select_occurences` to the :attr:`apply_button`."""
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        reader = tb.data_obj
        self.apply_button.clicked.connect(self.select_occurences)
        self.cancel_button.clicked.connect(
            partial(self.cb_remove_occurences.setVisible, False))
        tb.start_selection(reader.labels, rgba=reader.image_array(),
                           remove_on_apply=False)
        self.cb_remove_occurences.setVisible(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
            tb.toggle_selection()
        self.straditizer.draw_figure()

    def select_occurences(self):
        """Save (and potentially remove) the selected occurences

        Save the occurences with the
        :meth:`straditize.binary.DataReader.get_occurences` method and remove
        them if the :attr:`cb_remove_occurences` is checked"""
        self.reader.get_occurences()
        if self.cb_remove_occurences.isChecked():
            self.reader.remove_selected_labels(disable=False)
        self.cb_remove_occurences.setVisible(False)

    def show_disconnected_parts(self):
        """Remove disconnected parts

        This method uses the
        :meth:`straditize.binary.DataReader.show_disconnected_parts` to
        highlight and remove disconnected features in the diagram part. The
        algorithm can be modified by the :attr:`txt_fromlast` and
        :attr:`txt_from0` text editors"""
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        if self.cb_fromlast.isChecked():
            fromlast = int(self.txt_fromlast.text() or 0)
        else:
            fromlast = 0
        if self.cb_from0.isChecked():
            from0 = int(self.txt_from0.text() or 0)
        else:
            from0 = 0
        self.reader.show_disconnected_parts(
            fromlast=fromlast, from0=from0)
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
            tb.toggle_selection()
        self.straditizer.draw_figure()

    def show_cross_column_features(self):
        """Remove cross column features

        This method highlights features that span multiple columns using the
        :meth:`straditize.binary.DataReader.show_cross_column_features` method.
        The algorithm can be modified with the :attr:`txt_cross_column_px`
        line editor"""
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        min_px = int(self.txt_cross_column_px.text().strip() or 0)
        self.reader.show_cross_column_features(min_px)
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
            tb.toggle_selection()
        self.straditizer.draw_figure()

    def show_parts_at_column_ends(self):
        """Remove parts that touch the column ends

        This method highlights features that touch the column ends using the
        :meth:`straditize.binary.DataReader.show_parts_at_column_ends` method.
        """
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.show_parts_at_column_ends()
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
            tb.toggle_selection()
        self.straditizer.draw_figure()

    def show_small_parts(self):
        """Remove parts that touch the column ends

        This method highlights small features in the data image using the
        :meth:`straditize.binary.DataReader.show_small_parts` method.
        The maximal size of the small features can is taken from the
        :attr:`txt_max_small_size` line editor"""
        tb = self.selection_toolbar
        tb.data_obj = 'Reader'
        self.reader.show_small_parts(int(self.txt_max_small_size.text()))
        tb.start_selection(rgba=tb.data_obj.image_array())
        tb.remove_select_action.setChecked(True)
        if not tb.wand_action.isChecked():
            tb.wand_action.setChecked(True)
            tb.toggle_selection()
        self.straditizer.draw_figure()

    def _update_btn_show_small_parts(self, txt):
        if txt:
            self.btn_show_small_parts.setToolTip(
                'Remove parts smaller than %s pixels' % txt)
            self.btn_show_small_parts.setEnabled(
                self.should_be_enabled(self.btn_show_small_parts))
        else:
            self.btn_show_small_parts.setEnabled(False)
            self.btn_show_small_parts.setToolTip('')

    def _update_btn_highlight_small_selection(self, txt):
        if txt:
            self.btn_highlight_small_selection.setToolTip(
                'Highlight selected features smaller than %s pixels' % txt)
            self.btn_show_small_parts.setEnabled(
                self.should_be_enabled(self.btn_highlight_small_selection))
        else:
            self.btn_highlight_small_selection.setEnabled(False)
            self.btn_highlight_small_selection.setToolTip('')

    def toggle_btn_highlight_small_selection(self):
        """Enable or disable the :attr:`btn_highlight_small_selection`

        This method enables the :attr:`btn_highlight_small_selection` button
        if we are selecting something at the moment"""
        obj = self.selection_toolbar.data_obj
        if obj is not None and self.btn_highlight_small_selection.isChecked():
            obj.highlight_small_selections(
                n=int(self.txt_min_highlight.text()))
        elif obj is not None:
            obj.remove_small_selection_ellipses()
        else:
            return
        if obj._select_img is not None:
            obj._select_img.axes.figure.canvas.draw()

    def select_data_part(self, guess_lims=True):
        """Enable the selection of the diagram part

        This method uses the
        :meth:`straditize.straditizer.Straditizer.marks_for_data_selection`
        method to draw cross marks on the image for the diagram part"""
        self.straditizer.marks_for_data_selection(guess_lims=guess_lims)
        self.straditizer.draw_figure()
        self.connect2apply(self.straditizer.update_data_part,
                           self.straditizer.draw_figure,
                           self.straditizer_widgets.refresh)
        self.connect2cancel(self.straditizer.remove_marks,
                            self.straditizer.draw_figure)

    def edit_occurences(self):
        """Enable the editing of occurences

        This enables the editing of occurences using the
        :meth:`straditize.straditizer.Straditizer.marks_for_occurences`
        method for the occurences selected by the
        :meth:`select_occurences` method"""
        self.straditizer.marks_for_occurences()
        self.straditizer.draw_figure()
        self.connect2apply(lambda: self.straditizer.update_occurences(True),
                           self.straditizer.draw_figure,
                           self.straditizer_widgets.refresh)
        self.connect2cancel(self.straditizer.remove_marks,
                            self.straditizer.draw_figure)

    def align_vertical(self):
        """Create marks for vertical alignment of the columns

        See Also
        --------
        straditize.straditizer.Straditizer.marks_for_vertical_alignment
        straditize.straditizer.Straditizer.align_columns"""
        self.straditizer.marks_for_vertical_alignment()
        self.straditizer.draw_figure()
        self.connect2apply(self.straditizer.align_columns,
                           self.straditizer.draw_figure)
        self.connect2cancel(self.straditizer.remove_marks,
                            self.straditizer.draw_figure)

    def _ask_for_column_modification(self):
        answer = QMessageBox.Yes
        sw = self.straditizer_widgets
        if not sw.always_yes:
            msg = None
            if self.reader.children:
                msg = 'Column specific readers have already been created!'
            elif self.reader._full_df is not None:
                msg = 'The data has already been digitized!'
            if msg:
                answer = QMessageBox.question(
                    sw, 'Really modify columns?',
                    msg + ' Are you sure you want to conitnue? This might '
                    'result in unexpected behaviour')
        return answer == QMessageBox.Yes

    def select_column_starts(self):
        """Estimate the column starts and draw marks

        This methods estimates the column starts (if they are not yet set)
        based on the threshold in the :attr:`txt_column_thresh` and draws
        :class:`straditize.cross_marks.DraggableVLine` marks on the plot.

        See Also
        --------
        straditize.straditizer.Straditizer.marks_for_column_starts
        straditize.straditizer.Straditizer.update_column_starts"""
        if not self._ask_for_column_modification():
            return
        threshold = self.txt_column_thresh.text()
        threshold = float(threshold) / 100. if threshold else None
        self.straditizer.marks_for_column_starts(threshold)
        self.straditizer.draw_figure()
        self.connect2apply(self.straditizer.update_column_starts,
                           self.straditizer_widgets.refresh,
                           self.straditizer.draw_figure)
        self.connect2cancel(self.straditizer.remove_marks,
                            self.straditizer.draw_figure)

    def modify_column_ends(self):
        """Modify the column ends

        After having selected the :meth:`column starts <select_column_starts>`,
        this method enables the modification of the column ends

        See Also
        --------
        select_column_starts
        straditize.straditizer.Straditizer.marks_for_column_ends
        straditize.straditizer.Straditizer.update_column_ends"""
        if not self._ask_for_column_modification():
            return
        threshold = self.txt_column_thresh.text()
        threshold = float(threshold) / 100. if threshold else None
        self.straditizer.marks_for_column_ends(threshold)
        self.straditizer.draw_figure()
        self.connect2apply(self.straditizer.update_column_ends,
                           self.straditizer.draw_figure)
        self.connect2cancel(self.straditizer.remove_marks,
                            self.straditizer.draw_figure)


class BarSplitter(QTreeWidget, StraditizerControlBase):
    """A widget for splitting bars"""

    #: The QTreeWidgetItem that is currently shown in the plot
    selected_child = None

    #: The action in the matplotlib toolbar to go to the previous bar to split
    prev_action = None

    #: The action in the matplotlib toolbar to go to the next bar to split
    next_action = None

    #: Separator inserted before the navigation actions
    tb_separator = None

    #: A figure to show the other columns
    suggestions_fig = None

    @property
    def previous_item(self):
        """The QTreeWidgetItem for the previous bar to split"""
        child = self.selected_child
        top = child.parent()
        idx_child = top.indexOfChild(child)
        # for the first child, go to the previous topLevelItem (if possible)
        if idx_child == 0:
            idx_top = self.indexOfTopLevelItem(top)
            if idx_top == 0:
                return None
            previous_top = self.topLevelItem(idx_top - 1)
            return previous_top.child(previous_top.childCount() - 1)
        return top.child(idx_child - 1)

    @property
    def next_item(self):
        """The QTreeWidgetItem for the next bar to split"""
        child = self.selected_child
        top = child.parent()
        idx_child = top.indexOfChild(child)
        # for the last child, go to the next topLevelItem (if possible)
        if top.childCount() == idx_child + 1:
            idx_top = self.indexOfTopLevelItem(top)
            if self.topLevelItemCount() == idx_top + 1:
                return None
            next_top = self.topLevelItem(idx_top + 1)
            return next_top.child(0)
        return top.child(idx_child + 1)

    def __init__(self, straditizer_widgets, *args, **kwargs):
        super(BarSplitter, self).__init__(*args, **kwargs)
        self.init_straditizercontrol(straditizer_widgets)
        self.setColumnCount(1)
        self.setSelectionMode(QTreeWidget.SingleSelection)
        self.filled = False
        self._enable_doubleclick = False
        self.itemDoubleClicked.connect(self.start_splitting)
        self.source = 'too-long'
        try:
            if self.straditizer.data_reader._splitted:
                self.fill_table()
        except AttributeError:
            pass

    def get_overlapping_bars(self):
        """Get the bars the overlap with multiple bars in another column"""
        reader = self.straditizer.data_reader
        all_indices = list(map(np.array, reader._all_indices))
        ret = [[] for _ in range(len(all_indices))]
        for col, l in enumerate(all_indices):
            for (imin, imax) in l:
                for col2, l2 in enumerate(all_indices):
                    if col2 != col and len(l2) and \
                            ((l2 > imin) & (l2 < imax)).any(axis=1).sum() >= 2:
                        ret[col].append([imin, imax])
                        break
        return ret

    def fill_table(self, source='too-long'):
        """Fill the table with the bars that should be splitted

        Parameters
        ----------
        source: { 'too-long' | 'overlaps' | 'all' }
            The source with what to fill the table.

            too-long
                Only display the bars that are considered as *too long*
            overlap
                Only display the bars that overlap with multiple bars in
                another column (see :meth:`get_overlapping_bars`)
            all
                Display all bars"""
        self.clear()
        self.filled = self._enable_doubleclick = False
        self.source = source
        if source == 'too-long':
            try:  # use the bars that should be splitted
                items = self.straditizer.data_reader._splitted.items()
            except AttributeError:
                return
        elif source == 'overlaps':
            try:  # use overlapping bars
                items = enumerate(self.get_overlapping_bars())
            except AttributeError:
                return
        else:  # use all bars
            try:
                items = enumerate(self.straditizer.data_reader._all_indices)
            except AttributeError:
                return
        self.filled = True
        for col, lists in sorted(items):
            if not lists:
                continue
            top = QTreeWidgetItem(0)
            top.setText(0, 'Column %i - %i bars to split' % (col, len(lists)))
            for indices in lists:
                child = QTreeWidgetItem(0)
                child.setText(0, ', '.join(map(str, range(*indices))))
                top.addChild(child)
            self.addTopLevelItem(top)
            self._enable_doubleclick = True

    def refresh(self):
        """Reimplemented to use the :meth:`fill_table` method"""
        currently_expanded = [
            self._get_col(item)
            for item in map(self.topLevelItem, range(self.topLevelItemCount()))
            if item.isExpanded()]
        self.fill_table(self.source)
        for item in map(self.topLevelItem, range(self.topLevelItemCount())):
            if self._get_col(item) in currently_expanded:
                item.setExpanded(True)

    def start_splitting(self, item, *args, **kwargs):
        """Enable the splitting for the selected item"""
        parent = item.parent()
        found = False
        for top in map(self.topLevelItem, range(self.topLevelItemCount())):
            if parent is top:
                found = True
                break
        if not found:
            return
        # if we are already in the selection, we just switch to another
        # bar. Otherwise we check if this widget is enabled and if yes, zoom
        # to the item
        if self.selected_child is not None:
            self.remove_lines()
            self.disconnect()
            self.clearSelection()
            item.setSelected(True)
        elif not self._enable_doubleclick:
            return
        self._col = col = int(top.text(0).split()[1])
        reader = self.straditizer.data_reader
        extent = reader.extent
        if extent is not None:
            x0 = extent[0]
            y0 = min(extent[2:])
        else:
            x0 = y0 = 0
        indices = list(map(int, item.text(0).split(', ')))
        bounds = x0 + reader.column_bounds
        idx_col = reader.columns.index(col)
        ax = reader.ax
        ax.set_xlim(*bounds[idx_col])
        ylim = (y0 + max(indices) + len(indices) * 0.5,
                y0 + min(indices) - len(indices) * 0.5)
        ax.set_ylim(*ylim)
        self.lines = [ax.plot(
            bounds[idx_col, 0] + reader._full_df_orig.loc[indices, col].values,
            y0 + np.array(indices) + 0.5, marker='+', lw=0)[0]]
        self.selected_child = item
        self.selected_col = col
        self.selected_indices = list(indices)
        self.split_cid = ax.figure.canvas.mpl_connect(
            'button_press_event', self.prepare_for_split)
        if self.prev_action is None:
            self.add_toolbar_widgets()
        if self._enable_doubleclick:
            self.connect2apply(self.split_bars, self.remove_lines,
                               self.disconnect, self.remove_actions,
                               reader.draw_figure,
                               self.straditizer_widgets.digitizer.refresh)
            self.connect2cancel(self.remove_lines, self.disconnect,
                                self.remove_actions, reader.draw_figure,
                                self.remove_split_children)
        xmax = np.shape(self.straditizer.image)[1]
        suggestions = self.suggest_splits()

        # plot suggestions
        if self.suggestions_fig is None:
            headless = should_use_headless_figure()
            self.suggestions_fig = fig = create_matplotlib_figure(
                headless=headless)
            fig.add_subplot(131, sharey=ax)
            fig.add_subplot(132, sharey=ax)
            fig.add_subplot(133, sharey=ax)
            for ax in fig.axes:
                ax.callbacks.connect(
                    'xlim_changed', self.set_suggestions_fig_titles)
            from psyplot_gui.main import mainwindow
            source_manager = getattr(self.straditizer.fig.canvas, 'manager',
                                     None)
            target_manager = getattr(fig.canvas, 'manager', None)
            source_window = getattr(source_manager, 'window', None)
            target_window = getattr(target_manager, 'window', None)
            if (not headless and mainwindow.figures and
                    source_window is not None and target_window is not None):
                mainwindow.splitDockWidget(
                    source_window, target_window, Qt.Vertical)
        else:
            fig = self.suggestions_fig
            for im in self.images:
                im.remove()
        plotted_cols = []
        plot_suggestions = set(chain.from_iterable(suggestions.values()))
        for col, l in suggestions.items():
            if plot_suggestions.intersection(l):
                plotted_cols.append(col)
                plot_suggestions.difference_update(l)
        ys_10p = int(len(reader.binary) * 0.1)
        miny = max(0, indices[0] - ys_10p)
        maxy = indices[-1] + ys_10p
        im = reader.binary[miny:maxy]
        extent = [x0, reader.binary.shape[1] + x0, y0 + miny, y0 + maxy]
        self.images = [ax.imshow(im, cmap='binary', extent=extent)
                       for ax in fig.axes]
        for col, ax in zip(plotted_cols, fig.axes):
            ax.set_xlim(*bounds[col])
            ax.set_ylim(*ylim)

        # draw lines
        if not item.childCount():
            for y in unique_everseen(
                    chain.from_iterable(suggestions.values())):
                self.new_split(y, y0, draw_figure=False)
        else:
            axes = [reader.ax] + self.suggestions_fig.axes
            if reader.magni is not None:
                axes.append(reader.magni.ax)
            for i, child in enumerate(map(item.child,
                                          range(item.childCount()-1))):
                y = int(child.text(0).split(', ')[-1])
                for ax in axes:
                    self.lines.append(ax.hlines(
                        y0 + y + 1, 0, xmax, color='red'))

        reader.draw_figure()
        self.suggestions_fig.canvas.draw()

    def set_suggestions_fig_titles(self, ax):
        """Set the title in the suggestion figure with the displayed column
        """
        x = np.mean(ax.get_xlim())
        col = next(
                (i for i, (s, e) in enumerate(
                    self.straditizer.data_reader.all_column_bounds)
                 if x >= s and x <= e), None)
        ax.set_title(('Column %i' % col) if col else '')

    def suggest_splits(self):
        """Find overlaps for the current selected bar in other columns"""
        reader = self.straditizer.data_reader
        imin, imax = np.asarray(self.selected_indices)[[0, -1]]
        suggestions = {}
        for col, l in enumerate(map(np.ravel, reader._all_indices)):
            if col != self.selected_col:
                l[1::2] -= 1
                suggestions[col] = l[(l > imin) & (l < imax)]
        return suggestions

    def remove_lines(self):
        """Remove the plotted lines"""
        for l in self.lines:
            try:
                l.remove()
            except ValueError:
                pass
        self.lines.clear()

    def prepare_for_split(self, event):
        """Select or deselect a split location

        LeftButton selects the given location for a new split (see
        :meth:`new_split`), RightButton deselects it (see :meth:`revert_split`)
        """
        reader = self.straditizer.data_reader
        if (event.inaxes != reader.ax or event.button not in [1, 3] or
                get_toolbar_mode(reader.fig) != ''):
            return
        y = int(np.floor(event.ydata - 0.5))
        extent = reader.extent or [0] * 4
        idx_col = reader.columns.index(self._col)
        start, end = reader.column_bounds[idx_col] + min(extent[:2])
        indices = self.selected_indices
        if extent is not None:
            y0 = min(extent[2:])
            y -= y0
        if y not in indices or y in [indices[0], indices[-1]]:
            return
        if event.button == 1:
            self.new_split(y, y0)
        elif self.selected_child.childCount():
            self.revert_split(y, y0)

    @docstrings.get_sections(base='BarSplitter.new_split')
    def new_split(self, y, y0, draw_figure=True):
        """Mark the current item to be splitted at `y`

        This method draws a horizontal line at `y` and adds a new
        child QTreeWidgetItem to the :attr:`selected_child` to mark the split

        Parameters
        ----------
        y: int
            The vertical position of the split in the data image coordinate
            system
        y0: int
            The vertical start of the data image (see
            :attr:`straditize.binary.DataReader.extent`)
        draw_figure: bool
            If True, draw the figure
        """
        reader = self.straditizer.data_reader
        item = self.selected_child
        draw_line = False
        x0, x1 = self.straditizer.data_xlim
        if not item.childCount():
            indices = self.selected_indices
            c1 = QTreeWidgetItem(0)
            c2 = QTreeWidgetItem(1)
            item.addChildren([c1, c2])
            c1.setText(0, ', '.join(map(str, indices[:indices.index(y) + 1])))
            c2.setText(0, ', '.join(map(
                str, indices[indices.index(y) + 1:])))
            self.expandItem(item)
            draw_line = True
        else:
            for i, child in enumerate(map(item.child,
                                          range(item.childCount()))):
                indices = list(map(int, child.text(0).split(', ')))
                if y in indices:
                    if y in [indices[0], indices[-1]]:
                        return
                    c1 = QTreeWidgetItem(0)
                    c2 = child
                    item.insertChild(i, c1)
                    c1.setText(0, ', '.join(map(
                        str, indices[:indices.index(y) + 1])))
                    c2.setText(0, ', '.join(map(
                        str, indices[indices.index(y) + 1:])))
                    draw_line = True
        if draw_line:

            axes = [reader.ax] + self.suggestions_fig.axes
            if reader.magni is not None:
                axes.append(reader.magni.ax)
            for i, child in enumerate(map(item.child,
                                          range(item.childCount()-1))):
                y = int(child.text(0).split(', ')[-1])
                for ax in axes:
                    self.lines.append(ax.hlines(
                        y0 + y + 1, x0, x1, color='red'))
            if draw_figure:
                reader.draw_figure()
                self.suggestions_fig.canvas.draw()

    docstrings.delete_params('BarSplitter.new_split.parameters', 'draw_figure')

    @docstrings.with_indent(8)
    def revert_split(self, y, y0):
        """Revert the split

        Parameters
        ----------
        %(BarSplitter.new_split.parameters.no_draw_figure)s"""
        item = self.selected_child
        previous = None
        for i, child in enumerate(map(item.child,
                                      range(item.childCount()))):
            indices = list(map(int, child.text(0).split(', ')))
            if previous:
                previous.setText(0, previous.text(0) + ', ' + child.text(0))
                item.removeChild(child)
                if item.childCount() == 1:
                    item.removeChild(previous)
                break
            if y == indices[-1]:
                previous = child
        if previous:  # remove the drawn line
            y += y0 + 1
            for hline in self.lines[1:]:
                if y == hline.get_segments()[0][0, 1]:
                    hline.remove()
                    self.lines.remove(hline)
            self.straditizer.draw_figure()
            self.suggestions_fig.canvas.draw()

    def _get_col(self, item):
        """Convenience method for getting the column of a toplevel item"""
        return int(item.text(0).split()[1])

    def split_bars(self):
        """Split the bars after they have been separated manually"""

        def reset_values(col, indices):
            reader._full_df.loc[indices, col] = reader._full_df_orig.loc[
                indices, col].max()

        reader = self.straditizer.data_reader
        for item in map(self.topLevelItem, range(self.topLevelItemCount())):
            col = self._get_col(item)
            for child in map(item.child, range(item.childCount())):
                nchildren = child.childCount()
                if not nchildren:
                    continue
                all_indices = list(map(int, child.text(0).split(', ')))
                for i, l in enumerate(reader._all_indices[col]):
                    if l[0] == all_indices[0]:
                        indices = list(map(int, child.child(
                            nchildren - 1).text(0).split(', ')))
                        reader._all_indices[col][i] = [indices[0],
                                                       indices[-1] + 1]
                        reset_values(col, indices)
                        for child2 in map(child.child, range(nchildren - 1)):
                            indices = list(map(int,
                                               child2.text(0).split(', ')))
                            reader._all_indices[col].insert(
                                i, [indices[0], indices[-1] + 1])
                            reset_values(col, indices)
                        break
                for i, l in enumerate(reader._splitted.get(col, [])):
                    if l[0] == all_indices[0]:
                        del reader._splitted[col][i]
                        break

    def remove_split_children(self):
        """Remove all the child items that mark a split"""
        for item in map(self.topLevelItem, range(self.topLevelItemCount())):
            for child in map(item.child, range(item.childCount())):
                nchildren = child.childCount()
                if nchildren:
                    for child2 in list(map(child.child, range(nchildren))):
                        child.removeChild(child2)

    def disconnect(self):
        """Disconnect the events to split an item"""
        try:
            canvas = self.straditizer.data_reader.ax.figure.canvas
        except AttributeError:
            pass
        else:
            canvas.mpl_disconnect(self.split_cid)
        del self.selected_child, self.selected_col, self.selected_indices

    def add_toolbar_widgets(self):
        """Add an action to switch between the bars to the matplotlib toolbar
        """
        tb = self.straditizer.data_reader.ax.figure.canvas.toolbar
        if not isinstance(tb, QToolBar):
            return
        self.tb_separator = tb.addSeparator()
        self.prev_action = tb.addAction(
            QIcon(get_icon('prev_bar.png')), 'previous bar',
            self.go_to_prev_bar)
        self.prev_action.setToolTip(
            'Move to the previous bar that was too long')
        self.next_action = tb.addAction(
            QIcon(get_icon('next_bar.png')), 'next bar',
            self.go_to_next_bar)
        self.next_action.setToolTip('Move to the next bar that is too long')

    def remove_actions(self):
        """Remove the actions added by :meth:`add_toolbar_widgets`"""
        if self.prev_action is not None:
            try:
                tb = self.straditizer.data_reader.fig.canvas.toolbar
            except AttributeError:
                pass
            else:
                if self.next_action is not None:
                    tb.removeAction(self.next_action)
                tb.removeAction(self.prev_action)
                if self.tb_separator is not None:
                    tb.removeAction(self.tb_separator)
            self.prev_action = None
            self.next_action = None
            self.tb_separator = None
        import matplotlib.pyplot as plt
        plt.close(self.suggestions_fig)
        del self.suggestions_fig, self.images

    def go_to_next_bar(self):
        """Go to the :attr:`next_item`"""
        self._go_to_item(self.next_item)

    def go_to_prev_bar(self):
        """Go to the :attr:`previous_item`"""
        self._go_to_item(self.previous_item)

    def _go_to_item(self, item):
        self.start_splitting(item)
        self.expandItem(item.parent())
        self.expandItem(item)
        self.scrollToItem(item)
        if self.next_action is not None:
            self.next_action.setEnabled(self.next_item is not None)
        if self.prev_action is not None:
            self.prev_action.setEnabled(self.previous_item is not None)

    def enable_or_disable_widgets(self, b):
        if not b:
            self.setSelectionMode(QTreeWidget.SingleSelection)
            self._enable_doubleclick = True
        else:
            self.setSelectionMode(QTreeWidget.NoSelection)
            self._enable_doubleclick = False
