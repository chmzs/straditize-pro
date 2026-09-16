"""Test module for the :mod:`straditizer.widgets` module"""
import _base_testing as bt
import unittest
import numpy as np
from unittest import mock


class StraditizerWidgetsTest(bt.StraditizeWidgetsTestCase):
    """Test case for the :class:`straditizer.widgets.StraditizerWidgets`"""

    def test_stop_tutorial_when_not_running_is_safe(self):
        self.straditizer_widgets.start_tutorial(False)
        self.assertIsNone(self.straditizer_widgets.tutorial)

    def test_window_layout_action_initialized(self):
        """The docked widget should keep a reference to its layout action."""
        action = self.straditizer_widgets.menu_actions.window_layout_action
        self.assertIsNotNone(action)
        self.assertIs(action, self.straditizer_widgets.window_layout_action)

    def test_edit_attrs(self):
        """Test editing the attributes"""
        self.open_img()
        n = len(self.window.dataframeeditors)
        editor, combo = self.straditizer_widgets.edit_attrs()
        self.assertEqual(len(self.window.dataframeeditors), n+1)
        combo.addItem('latitude')
        combo.setCurrentText('latitude')
        self.assertIn('latitude', self.straditizer.attrs.index)

    def test_create_straditizer_from_args_01(self):
        fname = self.get_fig_path('basic_diagram.png')
        xlim = np.array([9, 30])
        ylim = np.array([10, 30])
        self.straditizer_widgets.create_straditizer_from_args(
            [fname],
            None,  # project
            xlim, ylim,
            False,  # full
            'area'  # reader_type
            )
        self.assertIsNotNone(self.straditizer)
        self.assertEqual(list(self.straditizer.data_xlim), list(xlim))
        self.assertEqual(list(self.straditizer.data_ylim), list(ylim))

    def test_create_straditizer_from_args_02(self):
        fname = self.get_fig_path('basic_diagram.png')
        self.straditizer_widgets.create_straditizer_from_args(
            [fname],
            None,  # project
            None, None,  # xlim, ylim
            True,  # full
            'area'  # reader_type
            )
        self.assertIsNotNone(self.straditizer)
        self.assertEqual(list(self.straditizer.data_xlim), [0, 40])
        self.assertEqual(list(self.straditizer.data_ylim), [0, 40])

    def test_autosave_failure_is_non_fatal(self):
        self.init_reader()
        autosaved = list(self.straditizer_widgets.autosaved)
        with mock.patch.object(
                self.straditizer, 'to_dataset',
                side_effect=ValueError('autosave failed')):
            self.straditizer_widgets.autosave()

        self.assertEqual(self.straditizer_widgets.autosaved, autosaved)


if __name__ == '__main__':
    unittest.main()
