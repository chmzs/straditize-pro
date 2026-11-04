/**
 * 页脚状态刷新（尺寸 / 缩放 / 光标 / 深度 / 丰度 / 当前列 / 控制点）。
 *
 * 原来是 `bootstrap()` 内部的 `updateFooter`，被 12 处回调调用。抽出来只为两件事：
 * 1. 让"页脚读哪些字段"集中在一处，不再散落在回调里手写 innerHTML；
 * 2. 用 `getCanvas` 取组件，而不是在闭包里直接引用一个 800 行函数内的 const
 *    （那会让"页脚依赖画布"这件事隐形，移动代码顺序就炸）。
 *
 * 纯读：不写后端、不改画布状态、不触发渲染。
 */
import type { GeologyCanvas } from '../components/GeologyCanvas';
import { t } from '../i18n';

export interface FooterDeps {
  /** 延迟取画布：页脚在组件构造完成后才会被调用。 */
  getCanvas: () => GeologyCanvas;
}

export function createFooterUpdater(deps: FooterDeps): () => void {
  return () => {
    const canvasComponent = deps.getCanvas();
    const col = canvasComponent.getActiveColumn();
    const activeEl = document.getElementById('footer-active-taxa');
    const anchorsEl = document.getElementById('footer-anchors');
    const dimEl = document.getElementById('footer-dimensions');
    const zoomEl = document.getElementById('footer-zoom');

    if (dimEl) {
      dimEl.innerHTML = `${t('footer.image')}: <code>${canvasComponent.data.imageWidth}×${canvasComponent.data.imageHeight}</code>`;
    }
    if (zoomEl) {
      zoomEl.innerHTML = `${t('footer.zoom')}: <code>${Math.round(canvasComponent.viewport.scale * 100)}%</code>`;
    }
    if (activeEl) {
      activeEl.innerHTML = col
        ? `${t('footer.activeTaxa')}: <span style="color: ${col.color};">●</span> <strong>${col.name}</strong>`
        : `${t('footer.activeTaxa')}: <strong>--</strong>`;
    }
    if (anchorsEl) {
      if (col) {
        const manual = col.controlPoints.filter((p) => p.isManual).length;
        anchorsEl.innerHTML = `${t('footer.anchors')}: <code>${manual} ${t('footer.manual')} / ${col.controlPoints.length} ${t('footer.total')}</code>`;
      } else {
        anchorsEl.innerHTML = `${t('footer.anchors')}: <code>--</code>`;
      }
    }
  };
}
