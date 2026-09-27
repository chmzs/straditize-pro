"""E2E browser tests for Settings modal, topbar slimming, theme/locale toggle, and remote access."""

from __future__ import annotations

import json
import time

from tests.e2e.conftest import run_playwright_eval


def test_settings_modal_e2e_flow(e2e_server):
    """Test topbar slimming, opening settings modal, changing language & theme, enabling remote switch, and saving."""
    url = e2e_server["url"]

    # 1. 验证顶栏瘦身：中英切换、主题图标、RPC 状态胶囊已移除；[⚙ 设置] 常驻
    js_topbar_check = """
      const btnLocale = document.getElementById('btn-toggle-locale');
      const btnTheme = document.getElementById('btn-toggle-theme');
      const rpcPill = document.getElementById('rpc-status-pill');
      const btnSettings = document.getElementById('btn-settings');
      const btnExport = document.getElementById('btn-export-csv');
      const btnOcr = document.getElementById('btn-ocr-review-modal');
      const btnAge = document.getElementById('btn-age-depth-modal');

      return JSON.stringify({
        has_btn_locale: Boolean(btnLocale),
        has_btn_theme: Boolean(btnTheme),
        has_rpc_pill: Boolean(rpcPill),
        has_btn_settings: Boolean(btnSettings),
        has_btn_export: Boolean(btnExport),
        has_btn_ocr: Boolean(btnOcr),
        has_btn_age: Boolean(btnAge),
      });
    """
    res1 = json.loads(run_playwright_eval(url, js_topbar_check, session_name="e2e_settings_check"))
    assert res1["has_btn_locale"] is False, "Legacy [中 / EN] button must be removed from topbar"
    assert res1["has_btn_theme"] is False, "Legacy theme icon button must be removed from topbar"
    assert res1["has_rpc_pill"] is False, "Legacy RPC pill button must be removed from topbar"
    assert res1["has_btn_settings"] is True, "New [⚙ 设置] button must be present in topbar"
    assert res1["has_btn_export"] is True, "Export button must be present in topbar"
    assert res1["has_btn_ocr"] is True, "OCR button must be present in topbar"
    assert res1["has_btn_age"] is True, "Age-depth button must be present in topbar"

    # 2. 点击 [⚙ 设置] -> 切换为英文 -> 切换为暗色 -> 勾选远程开关并填入 192.168.1.100 -> 保存 -> 即时断言
    js_interact_and_assert = """
      // Click settings button
      document.getElementById('btn-settings')?.click();

      // Ensure modal opened
      const modal = document.querySelector('.settings-dialog');
      if (!modal) throw new Error('Settings modal did not open');

      // 1. Switch language to English
      const langSelect = document.getElementById('settings-language');
      langSelect.value = 'en';
      langSelect.dispatchEvent(new Event('change'));

      // 2. Switch theme to dark
      const darkRadio = document.getElementById('theme-dark-radio');
      darkRadio.checked = true;
      darkRadio.dispatchEvent(new Event('change'));

      // 3. Toggle remote access
      const remoteToggle = document.getElementById('settings-remote-toggle');
      remoteToggle.checked = true;
      remoteToggle.dispatchEvent(new Event('change'));

      // 4. Fill allowed hosts
      const hostsTextarea = document.getElementById('settings-allowed-hosts');
      hostsTextarea.value = '192.168.1.100';

      // 5. Click Save & Apply
      const saveBtn = document.getElementById('btn-settings-save');
      saveBtn.click();

      // Check results in browser DOM and localStorage
      const savedTheme = localStorage.getItem('straditize-theme');
      const savedLocale = localStorage.getItem('straditize-locale');
      const isThemeDark = !document.body.classList.contains('theme-light');
      const modalClosed = document.querySelector('.settings-dialog') === null;
      const htmlLang = document.documentElement.getAttribute('lang');

      const diagramBtnText = document.getElementById('btn-open-file')?.textContent?.trim() || '';
      const settingsBtnText = document.getElementById('btn-settings')?.textContent?.trim() || '';
      const exportBtnText = document.getElementById('btn-export-csv')?.textContent?.trim() || '';
      const step1BtnText = document.querySelector('.workflow-step-btn[data-step="1"] span:last-child')?.textContent?.trim() || '';
      const footerDimText = document.getElementById('footer-dimensions')?.textContent?.trim() || '';
      const sidebarTitleText = document.querySelector('.sidebar-title span')?.textContent?.trim() || '';
      const insertGapBtnText = document.getElementById('btn-insert-gap-col')?.textContent?.trim() || '';
      const searchPlaceholder = document.getElementById('inp-search-taxa')?.placeholder || '';
      const inspectorTitleText = document.querySelector('.inspector-title span')?.textContent?.trim() || '';
      const stepTitleText = document.querySelector('.step-title')?.textContent?.trim() || '';
      const floatingAdjustText = document.querySelector('[data-fmode="select"] span')?.textContent?.trim() || '';

      return JSON.stringify({
        saved_theme: savedTheme,
        saved_locale: savedLocale,
        is_theme_dark: isThemeDark,
        modal_closed: modalClosed,
        html_lang: htmlLang,
        diagram_btn_text: diagramBtnText,
        settings_btn_text: settingsBtnText,
        export_btn_text: exportBtnText,
        step1_btn_text: step1BtnText,
        footer_dim_text: footerDimText,
        sidebar_title_text: sidebarTitleText,
        insert_gap_btn_text: insertGapBtnText,
        search_placeholder: searchPlaceholder,
        inspector_title_text: inspectorTitleText,
        step_title_text: stepTitleText,
        floating_adjust_text: floatingAdjustText,
      });
    """
    res2 = json.loads(run_playwright_eval(url, js_interact_and_assert, session_name="e2e_settings_act"))
    assert res2["saved_theme"] == "dark", "localStorage straditize-theme must be dark"
    assert res2["saved_locale"] == "en", "localStorage straditize-locale must be en"
    assert res2["is_theme_dark"] is True, "document.body must reflect dark theme"
    assert res2["modal_closed"] is True, "Settings modal must be closed after saving"
    assert res2["html_lang"] == "en", "<html lang> must be set to en"
    assert "Diagram" in res2["diagram_btn_text"], f"Diagram button must be in English: {res2['diagram_btn_text']}"
    assert "Settings" in res2["settings_btn_text"], f"Settings button must be in English: {res2['settings_btn_text']}"
    assert "Export" in res2["export_btn_text"], f"Export button must be in English: {res2['export_btn_text']}"
    assert "1.Load" in res2["step1_btn_text"], f"Step 1 button must be in English: {res2['step1_btn_text']}"
    assert "Image" in res2["footer_dim_text"], f"Footer image label must be in English: {res2['footer_dim_text']}"
    assert "Taxa Columns List" in res2["sidebar_title_text"], f"Sidebar title must be in English: {res2['sidebar_title_text']}"
    assert "Insert Gap" in res2["insert_gap_btn_text"], f"Insert gap button must be in English: {res2['insert_gap_btn_text']}"
    assert "Search taxa" in res2["search_placeholder"], f"Search placeholder must be in English: {res2['search_placeholder']}"
    assert "Inspector" in res2["inspector_title_text"], f"Inspector title must be in English: {res2['inspector_title_text']}"
    assert "Adjust" in res2["floating_adjust_text"], f"Floating adjust tool must be in English: {res2['floating_adjust_text']}"
