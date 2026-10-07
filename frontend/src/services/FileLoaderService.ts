import { DiagramData } from '../types/pollen';
import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Toolbar } from '../components/Toolbar';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { HistoryManager } from '../core/HistoryManager';
import { t } from '../i18n';

export interface FileLoaderCallbacks {
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (action: string, error: unknown) => void;
  updateWorkflowBar: () => void;
  updateFooter: () => void;
  setCurrentStage: (stage: number) => void;
  openProjectFile: (file: File) => void;
}

export class FileLoaderService {
  private rpcClient: RpcClient;
  private canvasComponent: GeologyCanvas;
  private history: HistoryManager;
  private getSidebar: () => Sidebar | undefined;
  private getToolbar: () => Toolbar | undefined;
  private getInspector: () => Inspector | undefined;
  private callbacks: FileLoaderCallbacks;

  constructor(
    rpcClient: RpcClient,
    canvasComponent: GeologyCanvas,
    history: HistoryManager,
    getSidebar: () => Sidebar | undefined,
    getToolbar: () => Toolbar | undefined,
    getInspector: () => Inspector | undefined,
    callbacks: FileLoaderCallbacks
  ) {
    this.rpcClient = rpcClient;
    this.canvasComponent = canvasComponent;
    this.history = history;
    this.getSidebar = getSidebar;
    this.getToolbar = getToolbar;
    this.getInspector = getInspector;
    this.callbacks = callbacks;
  }

  public async handleOpenFile(file: File): Promise<void> {
    const lowerName = file.name.toLowerCase();
    if (
      lowerName.endsWith('.tar') ||
      lowerName.endsWith('.json') ||
      lowerName.endsWith('.tar.gz')
    ) {
      this.callbacks.openProjectFile(file);
      return;
    }

    const validImgExts = ['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp', '.bmp', '.pdf'];
    const hasValidExt = validImgExts.some((ext) => lowerName.endsWith(ext));
    if (!file.type.startsWith('image/') && !hasValidExt) {
      this.callbacks.setHudNotice(
        '请选择或拖入有效的图片文件 (.png, .jpg, .tiff, .pdf) 或项目文件 (.tar / .json)'
      );
      return;
    }

    if (this.history.canUndo()) {
      if (
        !window.confirm('当前项目有未保存修改，重新加载图片将清空当前工作区。是否继续？')
      ) {
        return;
      }
    }

    this.callbacks.setHudNotice(`正在载入地质图谱: ${file.name}...`, 8000);

    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const reader = new FileReader();
    reader.onload = async (e) => {
      let dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      if (isPdf) {
        const inputPage = window.prompt(
          `检测到 PDF 文档 [${file.name}]\n请输入要提取图谱的页码 (从 1 开始):`,
          '1'
        );
        if (inputPage === null) {
          this.callbacks.setHudNotice('已取消载入 PDF');
          return;
        }
        const pageNum = Math.max(1, parseInt(inputPage.trim() || '1', 10) || 1);

        let newDiagramData: DiagramData;
        try {
          newDiagramData = await this.rpcClient.loadCustomImage(
            dataUrl,
            0,
            0,
            file.name,
            pageNum
          );
        } catch (err) {
          this.callbacks.reportBackendFailure('图谱载入', err);
          return;
        }

        this.canvasComponent.loadNewDiagram(newDiagramData);
        this.history.reset([], '');
        this.callbacks.setCurrentStage(1);
        this.callbacks.updateWorkflowBar();

        this.getSidebar()?.updateData(this.canvasComponent.data);
        this.getInspector()?.updateData(this.canvasComponent.data);
        this.getToolbar()?.updateHistoryState();
        this.getToolbar()?.updateScale(this.canvasComponent.viewport.scale);
        this.getToolbar()?.updateFilterState(
          this.canvasComponent.viewport.imageMode,
          this.canvasComponent.viewport.showBinaryOverlay
        );
        this.callbacks.updateFooter();

        this.callbacks.setHudNotice(
          `✅ 成功载入 PDF [${file.name}] 第 ${pageNum} 页图谱 (${newDiagramData.imageWidth}×${newDiagramData.imageHeight})！请在画布上调整数据有效区 (Step 1)。`,
          5000
        );
        return;
      }

      const img = new Image();
      img.onerror = () => {
        this.callbacks.reportBackendFailure(
          '图谱载入',
          new Error('浏览器无法解码该图像文件，请确认是否为有效图片格式。')
        );
      };
      img.onload = async () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // 图像尺寸与性能预算安全检查
        const MAX_W = 8000;
        const MAX_H = 12000;
        const WARN_W = 6000;
        const WARN_H = 9000;

        if (w > MAX_W || h > MAX_H) {
          const okDownsample = window.confirm(
            `【图像尺寸过大提示】\n当前图像尺寸为 ${w}×${h} px，超过建议最大限制 (${MAX_W}×${MAX_H} px)。\n直接加载可能会耗尽浏览器内存导致崩溃。\n\n点击【确定】以 50% 降采样安全加载 (${Math.round(
              w / 2
            )}×${Math.round(h / 2)} px)；\n点击【取消】中止加载。`
          );
          if (!okDownsample) {
            this.callbacks.setHudNotice('已取消加载超限大图');
            return;
          }
          const downsampled = this.downsampleImage(img, 0.5);
          dataUrl = downsampled.dataUrl;
          w = downsampled.w;
          h = downsampled.h;
        } else if (w >= WARN_W && h >= WARN_H) {
          this.callbacks.setHudNotice(
            `提示: 图像尺寸较大 (${w}×${h} px)，建议在充足内存环境下操作。`,
            4000
          );
        }

        // 调用 RPC 客户端：图像必须由后端真正载入成功，失败即中止
        let newDiagramData: DiagramData;
        try {
          newDiagramData = await this.rpcClient.loadCustomImage(dataUrl, w, h, file.name);
        } catch (err) {
          this.callbacks.reportBackendFailure('图谱载入', err);
          this.callbacks.setHudNotice(
            '❌ 图谱载入失败：后端未确认接收该图像，未进入工作流。',
            6000
          );
          return;
        }

        // 进入 S1 时清空：ROI、所有列、所有点、深度标定、撤销栈、选中状态
        this.canvasComponent.loadNewDiagram(newDiagramData);
        this.history.reset([], '');
        this.callbacks.setCurrentStage(1);
        this.callbacks.updateWorkflowBar();

        this.getSidebar()?.updateData(this.canvasComponent.data);
        this.getInspector()?.updateData(this.canvasComponent.data);
        this.getToolbar()?.updateHistoryState();
        this.getToolbar()?.updateScale(this.canvasComponent.viewport.scale);
        this.getToolbar()?.updateFilterState(
          this.canvasComponent.viewport.imageMode,
          this.canvasComponent.viewport.showBinaryOverlay
        );
        this.callbacks.updateFooter();

        this.callbacks.setHudNotice(
          `✅ 成功载入图谱 [${file.name}] (${w}×${h})！请在画布上调整数据有效区 (Step 1)，随后点击下方推进。`,
          5000
        );

        // 异步执行微小倾斜检测提示 (Deskew Helper)
        this.rpcClient
          .detectDeskew()
          .then((skewRes) => {
            if (
              skewRes &&
              skewRes.has_skew &&
              Math.abs(skewRes.suggested_rotation_angle) >= 0.3
            ) {
              const ang = skewRes.suggested_rotation_angle;
              const banner = document.createElement('div');
              banner.className = 'deskew-notice-banner';
              banner.style.cssText =
                'position: fixed; top: 52px; right: 20px; z-index: 9999;';
              banner.innerHTML = `
                <div class="app-toast-badge" style="border: 1px solid #f59e0b;">
                  <span>📐 <strong>图谱微斜提示</strong>: 检测到主轴倾斜约 <strong>${
                    ang > 0 ? '+' : ''
                  }${ang}°</strong>，是否自动水平矫正？</span>
                  <div style="display: flex; gap: 6px;">
                    <button id="btn-deskew-apply" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px; background: #f59e0b; border-color: #f59e0b;">旋转校正</button>
                    <button id="btn-deskew-ignore" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
                  </div>
                </div>
              `;
              document.body.appendChild(banner);
              banner.querySelector('#btn-deskew-apply')?.addEventListener('click', async () => {
                banner.remove();
                this.callbacks.setHudNotice(`正在旋转矫正图谱 (${ang}°)...`, 5000);
                try {
                  const rotRes = await this.rpcClient.rotateImage(ang);
                  if (rotRes && rotRes.success) {
                    const refreshed = await this.rpcClient.getDiagramData();
                    this.canvasComponent.loadNewDiagram(refreshed);
                    this.history.reset([], '');
                    this.callbacks.setCurrentStage(1);
                    this.callbacks.updateWorkflowBar();
                    this.callbacks.setHudNotice(`✅ 已水平矫正图谱！有效区已重置。`, 3500);
                  } else {
                    throw new Error(t('error.unknown'));
                  }
                } catch (err) {
                  this.callbacks.reportBackendFailure('图谱旋转校正', err);
                }
              });
              banner.querySelector('#btn-deskew-ignore')?.addEventListener('click', () => {
                banner.remove();
              });
            }
          })
          .catch((err) => {
            this.callbacks.reportBackendFailure('图谱倾斜检测', err);
          });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  public downsampleImage(
    img: HTMLImageElement,
    ratio: number = 0.5
  ): { dataUrl: string; w: number; h: number } {
    const targetW = Math.round(img.naturalWidth * ratio);
    const targetH = Math.round(img.naturalHeight * ratio);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = targetW;
    offCanvas.height = targetH;
    const ctx = offCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);
    }
    return {
      dataUrl: offCanvas.toDataURL('image/png'),
      w: targetW,
      h: targetH,
    };
  }

  public async handleLoadSample(sampleKey: string): Promise<void> {
    this.callbacks.setHudNotice(`正在切换内置范例图谱: ${sampleKey}...`, 5000);
    let newDiagramData: DiagramData;
    try {
      newDiagramData = await this.rpcClient.loadSampleDiagram(sampleKey);
    } catch (err) {
      this.callbacks.reportBackendFailure('内置范例载入', err);
      return;
    }

    this.canvasComponent.loadNewDiagram(newDiagramData);
    this.history.reset(newDiagramData.columns, newDiagramData.activeTaxaId);
    this.callbacks.setCurrentStage(1);
    this.callbacks.updateWorkflowBar();

    this.getSidebar()?.updateData(this.canvasComponent.data);
    this.getInspector()?.updateData(this.canvasComponent.data);
    this.getToolbar()?.updateHistoryState();
    this.getToolbar()?.updateScale(this.canvasComponent.viewport.scale);
    this.getToolbar()?.updateFilterState(
      this.canvasComponent.viewport.imageMode,
      this.canvasComponent.viewport.showBinaryOverlay
    );
    this.callbacks.updateFooter();

    const nameMap: Record<string, string> = {
      hoya: 'Hoya del Castillo 花粉剖面',
      verification: '标定验证地质图谱',
      beginner: '初学者沉积图谱',
    };
    this.callbacks.setHudNotice(
      `✅ 已载入范例: ${nameMap[sampleKey] || sampleKey}，已自动居中重置！`,
      3500
    );
  }
}
