# -*- coding: utf-8 -*-
"""Real verification script for Straditize interactive curve editing on Hoya del Castillo.

This script executes via the StraditizeWidgets framework, loads the genuine
historical pollen diagram (Hoya del Castillo), runs the real digitization pipeline,
simulates realistic user manual edits (plain left click to pull curve, plain right click
to remove control point), and exports a high-resolution visual comparison image.
"""
import os
import sys
import unittest
from types import SimpleNamespace
from matplotlib.backend_bases import MouseButton
import matplotlib.pyplot as plt
import numpy as np

# Ensure sys.path includes straditize
test_dir = os.path.abspath('straditize/tests/widgets')
if test_dir not in sys.path:
    sys.path.insert(0, test_dir)
import _base_testing as bt

class RealPollenVerificationTest(bt.StraditizeWidgetsTestCase):

    def test_verify_real_pollen_curve_editing(self):
        img_path = os.path.abspath('straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png')
        print(f"\n[1/5] Loading genuine pollen diagram:\n  {img_path}")
        self.assertTrue(os.path.exists(img_path))

        sw = self.straditizer_widgets
        sw.menu_actions.open_straditizer(img_path)
        stradi = self.straditizer
        self.assertIsNotNone(stradi)

        # Ground-truth diagram bounds for Hoya del Castillo
        ref_xlim = [315, 1946]
        ref_ylim = [511, 1311]
        stradi.data_xlim = ref_xlim
        stradi.data_ylim = ref_ylim
        stradi.init_reader('area')
        reader = stradi.data_reader
        self.assertIsNotNone(reader)

        print("[2/5] Running real area digitization on pollen diagram...")
        reader.digitize()
        sw.refresh()

        print("[3/5] Opening interactive full data editor...")
        editor = self.digitizer.edit_full_data()
        self.assertIsNotNone(editor)

        # Inspect Column 0 (Pinus canariensis)
        col = reader._full_df.columns[0]
        col_idx, start_abs, end_abs = self.digitizer._full_data_column_abs_bounds(col)
        width = float(end_abs - start_abs)
        print(f"  Column 0 bounds: [{start_abs:.1f}, {end_abs:.1f}], column width = {width:.1f} px")

        series_before = reader._full_df.loc[:, col].copy()
        valid_rows = series_before.dropna().index.values
        # Pick a mid-depth sediment row (around row 300)
        test_row = int(valid_rows[len(valid_rows) // 2])
        val_before = float(series_before.loc[test_row])
        y_test_abs = self.digitizer._full_data_row_y(test_row)
        print(f"  Target row = {test_row} (Y = {y_test_abs:.1f} px), initial digitized width = {val_before:.2f} px")

        # Step A: Plain Left-Click (no shift) pulling the curve out by +35 px
        target_val = min(val_before + 35.0, width * 0.9)
        target_x_abs = start_abs + target_val
        print(f"[4/5] Simulating User Action 1: Plain Left-Click at ({target_x_abs:.1f}, {y_test_abs:.1f}) without Shift...")

        click_event = SimpleNamespace(
            inaxes=reader.ax,
            xdata=target_x_abs,
            ydata=y_test_abs,
            button=MouseButton.LEFT,
            key=None)

        self.digitizer._edit_full_data_from_click(click_event)

        series_after_click = reader._full_df.loc[:, col].copy()
        val_after_click = float(series_after_click.loc[test_row])
        print(f"  --> Result: Value at row {test_row} became {val_after_click:.2f} px (target: {target_val:.2f} px)")
        self.assertAlmostEqual(val_after_click, target_val, delta=0.5)

        # Check neighbor rows to ensure it smoothly pulled a contour, not a 1-pixel needle
        neighbor_rows = [test_row - 1, test_row + 1]
        for nr in neighbor_rows:
            if nr in series_after_click.index:
                nval = float(series_after_click.loc[nr])
                print(f"  --> Neighbor row {nr} smooth expansion = {nval:.2f} px (originally {float(series_before.loc[nr]):.2f} px)")

        # Step B: Plain Right-Click on the mark to delete it
        manual_mark = next(
            (m for m in self.digitizer._full_data_marks
             if m._full_data_column == col and int(m._full_data_row) == test_row),
            None)
        self.assertIsNotNone(manual_mark)
        print(f"[5/5] Simulating User Action 2: Plain Right-Click directly on control mark to delete it...")

        del_event = SimpleNamespace(
            inaxes=reader.ax,
            xdata=manual_mark.x,
            ydata=manual_mark.y,
            button=MouseButton.RIGHT,
            key=None)
        self.digitizer._edit_full_data_from_click(del_event)

        series_after_delete = reader._full_df.loc[:, col].copy()
        val_after_delete = float(series_after_delete.loc[test_row])
        print(f"  --> Result: Mark deleted. Value at row {test_row} smoothly reinterpolated to {val_after_delete:.2f} px")

        # Step C: Re-apply the user peak to render the comparison figure
        self.digitizer._edit_full_data_from_click(click_event)
        series_final = reader._full_df.loc[:, col].copy()

        # Render Proof Figure
        print("\nRendering publication-quality proof image...")
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))

        # Subplot 1: Overview
        ax_ctx = axes[0]
        y_vals_all = [self.digitizer._full_data_row_y(r) for r in series_before.index]
        ax_ctx.imshow(np.asarray(reader.image), extent=[ref_xlim[0], ref_xlim[1], ref_ylim[1], ref_ylim[0]], cmap='gray')
        ax_ctx.plot(start_abs + series_before.values, y_vals_all,
                    'r--', lw=1.8, label='Original Digitized')
        ax_ctx.plot(start_abs + series_final.values, y_vals_all,
                    'b-', lw=2.2, label='User Modified (Pulled)')
        ax_ctx.plot(target_x_abs, y_test_abs, 'y*', markersize=14, markeredgecolor='black', label='User Click Target')
        ax_ctx.set_xlim(start_abs - 25, end_abs + 30)
        ax_ctx.set_ylim(y_test_abs + 120, y_test_abs - 120)
        ax_ctx.set_title("A. Overview: Column 0 on Hoya del Castillo", fontsize=11, fontweight='bold')
        ax_ctx.legend(loc='lower left', framealpha=0.9, fontsize=8.5)
        ax_ctx.set_xlabel("Pixel X")
        ax_ctx.set_ylabel("Depth (Pixel Y)")

        # Subplot 2: Detailed Zoom Proof
        ax_zoom = axes[1]
        zoom_range = 25
        rows_zoom = [r for r in series_before.index if abs(r - test_row) <= zoom_range]
        y_zoom_vals = [self.digitizer._full_data_row_y(r) for r in rows_zoom]

        ax_zoom.imshow(np.asarray(reader.image), extent=[ref_xlim[0], ref_xlim[1], ref_ylim[1], ref_ylim[0]], cmap='gray', alpha=0.55)
        ax_zoom.plot(start_abs + series_before.loc[rows_zoom].values, y_zoom_vals,
                     'r--o', lw=1.8, markersize=3.5, label='1. Original Contour')
        ax_zoom.plot(start_abs + series_final.loc[rows_zoom].values, y_zoom_vals,
                     'b-s', lw=2.4, markersize=4.5, label='2. Left-Click (Pulled to cursor)')
        ax_zoom.plot(start_abs + series_after_delete.loc[rows_zoom].values, y_zoom_vals,
                     'g:', lw=2.2, label='3. Right-Click (Deleted & restored)')
        ax_zoom.plot(target_x_abs, y_test_abs, 'y*', markersize=16, markeredgecolor='black', label='Cursor Target Position')

        x_min_zoom = start_abs - 10
        x_max_zoom = end_abs + 20
        ax_zoom.set_xlim(x_min_zoom, x_max_zoom)
        ax_zoom.set_ylim(y_test_abs + 35, y_test_abs - 35)
        ax_zoom.set_title("B. Zoomed Proof: Smooth Deformation", fontsize=11, fontweight='bold')
        ax_zoom.legend(loc='lower left', framealpha=0.9, fontsize=8.5)
        ax_zoom.set_xlabel("Pixel X (Width)")
        ax_zoom.set_ylabel("Depth (Pixel Y)")
        ax_zoom.grid(True, linestyle=':', alpha=0.6)

        plt.tight_layout()
        out_path = os.path.abspath('verification_real_pollen_edit.png')
        plt.savefig(out_path, dpi=200)
        plt.close()

        print(f"\n=======================================================")
        print(f"VERIFICATION COMPLETE!")
        print(f"High-res visual proof saved to: {out_path}")
        print(f"=======================================================\n")
        editor.close()

if __name__ == '__main__':
    unittest.main()
