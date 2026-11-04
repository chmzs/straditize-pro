/**
 * 应用外壳的 DOM 构建（顶栏之外：工作区、抽屉页签、HUD、页脚）。
 *
 * ## 为什么单独成模块
 *
 * `main.ts` 的 `bootstrap()` 曾把 DOM 构建、组件构造、事件绑定、自动存档全塞在
 * 一个 800 行函数里。拆开后这里的约定是：**纯 DOM，零组件依赖**——只接收数据、
 * 返回元素句柄，不碰 RPC、不碰画布、不注册全局监听。任何需要组件的东西都不该进来。
 *
 * 这样它可被单测（构造后在 jsdom 里断言结构），也不会因为组件顺序调整而失效。
 */
import type { DiagramData } from '../types/pollen';
import { t } from '../i18n';

/** 深/浅色主题：只读 localStorage 的一个键，缺省浅色。 */
export function applyTheme(): void {
  const savedTheme = localStorage.getItem('straditize-theme');
  if (savedTheme === 'dark') {
    document.body.classList.remove('theme-light');
  } else {
    document.body.classList.add('theme-light');
  }
}

export interface WorkspaceDom {
  workspace: HTMLElement;
  canvasWrapper: HTMLElement;
  leftDrawerTab: HTMLElement;
  rightDrawerTab: HTMLElement;
  /** 语言切换后重刷页签文案（原 `updateDrawers`）。 */
  updateDrawers: () => void;
}

/** 工作区骨架：中间画布容器 + 左右抽屉的展开页签。 */
export function createWorkspaceDom(): WorkspaceDom {
  const workspace = document.createElement('main');
  workspace.className = 'app-workspace';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';

  const leftDrawerTab = document.createElement('div');
  leftDrawerTab.className = 'drawer-toggle-tab left-tab';
  leftDrawerTab.style.display = 'none';
  workspace.appendChild(leftDrawerTab);

  const rightDrawerTab = document.createElement('div');
  rightDrawerTab.className = 'drawer-toggle-tab right-tab';
  rightDrawerTab.style.display = 'none';
  workspace.appendChild(rightDrawerTab);

  const updateDrawers = (): void => {
    leftDrawerTab.title = t('drawer.taxaTitle');
    leftDrawerTab.innerHTML = `<span>›</span><span>${t('drawer.taxa')}</span>`;
    rightDrawerTab.title = t('drawer.inspectorTitle');
    rightDrawerTab.innerHTML = `<span>‹</span><span>${t('drawer.inspector')}</span>`;
  };
  updateDrawers();

  return { workspace, canvasWrapper, leftDrawerTab, rightDrawerTab, updateDrawers };
}

/** 画布上的 HUD 条（只建 DOM；文案随后由 main 的 `setHudNotice` 写）。 */
export function createHudDom(): HTMLElement {
  const hud = document.createElement('div');
  hud.id = 'canvas-hud';
  hud.className = 'canvas-hud';
  hud.innerHTML = `
    <span id="hud-text">${t('hud.default')}</span>
  `;
  return hud;
}

/** 页脚：初始尺寸直接取自工程数据，其余项等第一次 `updateFooter()` 填。 */
export function createFooterDom(initialData: DiagramData): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="footer-left" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-dimensions">${t('footer.image')}: <code>${initialData.imageWidth}×${initialData.imageHeight}</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-zoom">${t('footer.zoom')}: <code>100%</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-cursor">${t('footer.cursor')}: <code>--</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-depth">${t('footer.depth')}: <strong style="font-size: 11.5px; color: var(--text-primary);">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-pollen">${t('footer.abundance')}: <strong style="font-size: 11.5px; color: var(--accent-blue);">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-tool-mode">${t('footer.mode')}: <strong>${t('footer.modeSelect')}</strong></div>
    </div>
    <div class="footer-right" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-active-taxa">${t('footer.activeTaxa')}: <strong>--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-anchors">${t('footer.anchors')}: <code>--</code></div>
    </div>
  `;
  return footer;
}
