import { DiagramData } from '../types/pollen';
import { RpcClient } from '../services/RpcClient';
import {
  AgeDepthModelInspectionData,
  DatingPoint,
  CalibKind,
  CalibMarker,
} from './agedepth/types';
import { AgeDepthCanvas } from './agedepth/AgeDepthCanvas';
import { AgeDepthDatingTable } from './agedepth/AgeDepthDatingTable';
import { AgeDepthController } from './agedepth/AgeDepthController';
import { createAgeDepthModalHtml } from './agedepth/AgeDepthTemplate';
import { notifyError } from '../ui/feedback';

export type {
  AgeDepthModelInspectionData,
  DatingPoint,
  CalibKind,
  CalibMarker,
};

/**
 * 年代-深度模型视觉检查与解译弹窗 (AgeDepthModal)。
 *
 * 现代架构重构：
 * - AgeDepthCanvas: 负责视口、Canvas 渲染、控制点与标定点交互。
 * - AgeDepthDatingTable: 负责钻孔实测年代数据表、结果大表、侧边预览表及地质事件。
 * - AgeDepthController: 负责与后端 RPC 交互、环境探测、WebR 算力包与状态同步。
 * - AgeDepthModal: 组装容器，负责弹窗生命周期与子组件协调。
 */
export class AgeDepthModal {
  private container: HTMLElement;
  private rpcClient: RpcClient;
  private onApplyAgeModel: (model: AgeDepthModelInspectionData) => void;

  private modalEl: HTMLElement | null = null;
  private canvasComp: AgeDepthCanvas | null = null;
  private tableComp: AgeDepthDatingTable | null = null;
  private controller: AgeDepthController | null = null;
  private disposers: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    pollenData: DiagramData,
    rpcClient: RpcClient,
    onApplyAgeModel: (model: AgeDepthModelInspectionData) => void
  ) {
    this.container = container;
    void pollenData;
    this.rpcClient = rpcClient;
    this.onApplyAgeModel = onApplyAgeModel;
  }

  public open(): void {
    this.close();

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = createAgeDepthModalHtml();
    this.container.appendChild(modal);
    this.modalEl = modal;

    const canvasEl = modal.querySelector('#ad-inspection-canvas') as HTMLCanvasElement;

    // 1. 初始化子模块
    this.canvasComp = new AgeDepthCanvas(modal, canvasEl, {
      onModelRefitted: () => {
        const insp = this.canvasComp?.getInspectionData() || null;
        this.tableComp?.setInspectionData(insp);
      },
      onCalibMarkersChanged: () => {
        this.canvasComp?.updateCalibReadout();
        this.canvasComp?.updateCalibChecklist();
      },
      onDatingPointPicked: () => {
        const points = this.canvasComp?.getDatingPoints() || [];
        this.tableComp?.setDatingPoints(points);
      },
      onExcludeBoxesChanged: () => {
        this.canvasComp?.updateExcludeCount();
      },
    });

    this.tableComp = new AgeDepthDatingTable(modal, {
      onModelModified: () => {
        this.canvasComp?.syncPxPointsFromModel();
        this.canvasComp?.renderCanvas();
      },
      onDatingPointsChanged: (points) => {
        this.canvasComp?.setDatingPoints(points);
        this.canvasComp?.renderCanvas();
      },
      onRequestSyncModel: async () => {
        const insp = this.canvasComp?.getInspectionData();
        if (insp && this.controller) {
          await this.controller.syncModelToBackend(insp);
        }
      },
      onSwitchTab: (tab) => this.switchTab(tab),
    });

    this.controller = new AgeDepthController(modal, this.rpcClient, {
      onImageLoaded: (img, label) => {
        if (!this.canvasComp || !this.tableComp) return;
        this.canvasComp.setBgImage(img);
        const emptyZone = modal.querySelector('#ad-empty-drop-zone') as HTMLElement | null;
        if (emptyZone) emptyZone.style.display = 'none';

        const lbl = modal.querySelector('#ad-current-source-label');
        if (lbl) lbl.textContent = label;

        this.canvasComp.setInspectionData(null);
        this.tableComp.setInspectionData(null);
        this.canvasComp.setMappedSamples(null);
        this.tableComp.setMappedSamples(null);
        this.canvasComp.clearExcludeBoxes();

        if (label.startsWith('范例:')) {
          this.canvasComp.seedCalibration(img.naturalWidth, img.naturalHeight);
        } else {
          this.canvasComp.startCalibration();
        }
        this.canvasComp.fitViewport();
        this.canvasComp.renderCanvas();
      },
      onSessionModelRestored: (payload) => {
        if (!this.canvasComp || !this.tableComp) return;
        this.canvasComp.setBgImage(payload.img);
        const emptyZone = modal.querySelector('#ad-empty-drop-zone') as HTMLElement | null;
        if (emptyZone) emptyZone.style.display = 'none';
        const lbl = modal.querySelector('#ad-current-source-label');
        if (lbl) lbl.textContent = '已载入工程年代图';

        const cs = payload.calibState;
        if (cs && Array.isArray(cs.calib_markers) && cs.calib_markers.length === 4) {
          this.canvasComp.setCalibMarkers(
            cs.calib_markers.map((m: any) => ({
              kind: m.kind,
              x: Number(m.x),
              y: Number(m.y),
            }))
          );
          this.canvasComp.setCalibPicking(false);
        } else if (
          cs &&
          Array.isArray(cs.age_px) &&
          cs.age_px.length === 2 &&
          Array.isArray(cs.depth_px) &&
          cs.depth_px.length === 2
        ) {
          const padX = payload.img.naturalWidth * 0.022;
          const padY = payload.img.naturalHeight * 0.022;
          this.canvasComp.setCalibMarkers([
            { kind: 'ageA', x: Number(cs.age_px[0]), y: Number(cs.depth_px[1]) + padY },
            { kind: 'ageB', x: Number(cs.age_px[1]), y: Number(cs.depth_px[1]) + padY },
            { kind: 'depthA', x: Number(cs.age_px[0]) - padX, y: Number(cs.depth_px[0]) },
            { kind: 'depthB', x: Number(cs.age_px[0]) - padX, y: Number(cs.depth_px[1]) },
          ]);
          this.canvasComp.setCalibPicking(false);
        } else {
          this.canvasComp.seedCalibration(payload.img.naturalWidth, payload.img.naturalHeight);
        }

        if (cs) {
          if (Array.isArray(cs.age_vals) && cs.age_vals.length === 2) {
            const inpL = modal.querySelector('#ad-inp-age-left') as HTMLInputElement | null;
            const inpR = modal.querySelector('#ad-inp-age-right') as HTMLInputElement | null;
            if (inpL) inpL.value = String(cs.age_vals[0]);
            if (inpR) inpR.value = String(cs.age_vals[1]);
          }
          if (Array.isArray(cs.depth_vals) && cs.depth_vals.length === 2) {
            const inpT = modal.querySelector('#ad-inp-depth-top') as HTMLInputElement | null;
            const inpB = modal.querySelector('#ad-inp-depth-bottom') as HTMLInputElement | null;
            if (inpT) inpT.value = String(cs.depth_vals[0]);
            if (inpB) inpB.value = String(cs.depth_vals[1]);
          }
          if (Array.isArray(cs.exclude_boxes)) {
            this.canvasComp.setExcludeBoxes(
              cs.exclude_boxes.map((b: number[]) => [b[0], b[1], b[2], b[3]])
            );
            this.canvasComp.updateExcludeCount();
          }
          this.canvasComp.updateCalibChecklist();
          this.canvasComp.updateCalibReadout();
        }

        if (payload.inspection) {
          this.canvasComp.setInspectionData(payload.inspection);
          this.tableComp.setInspectionData(payload.inspection);
          const statusEl = modal.querySelector('#ad-status-msg');
          if (statusEl) {
            statusEl.textContent = `✅ 已从工程还原年代模型（${(payload.inspection.depths || []).length} 个深度层位）`;
          }
        }
        this.canvasComp.fitViewport();
        this.canvasComp.renderCanvas();
      },
      onExtractionSuccess: (res) => {
        if (!this.canvasComp || !this.tableComp) return;
        this.canvasComp.setInspectionData(res.inspection);
        this.canvasComp.setMappedSamples(res.mapped_samples);
        this.tableComp.setInspectionData(res.inspection);
        this.tableComp.setMappedSamples(res.mapped_samples);
        this.canvasComp.renderCanvas();
      },
      onLocalBaconSuccess: (res) => {
        if (!this.canvasComp || !this.tableComp) return;
        this.canvasComp.setInspectionData(res.inspection);
        this.canvasComp.setMappedSamples(res.mapped_samples);
        this.tableComp.setInspectionData(res.inspection);
        this.tableComp.setMappedSamples(res.mapped_samples);
        this.canvasComp.renderCanvas();
        this.switchTab('visual');
      },
      onRateSelectionChanged: () => {
        this.tableComp?.updateMappingTable();
      },
    });

    // 2. 绑定装配胶水事件
    this.bindModalEvents();

    // 3. 初始状态同步
    this.canvasComp.updateExcludeCount();
    this.canvasComp.updateCalibChecklist();
    this.controller.checkLocalR();
    this.controller.checkComponentStatus();
    this.controller.setupSseListener();
    this.controller.renderRateOptionsNote();

    void this.controller.restoreExistingSessionModel();
  }

  public close(): void {
    this.disposers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* teardown must not throw */
      }
    });
    this.disposers = [];

    this.canvasComp?.dispose();
    this.canvasComp = null;

    this.controller?.dispose();
    this.controller = null;

    this.tableComp = null;

    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private switchTab(tab: 'visual' | 'table' | 'modeling'): void {
    if (!this.modalEl) return;
    const btnVisual = this.modalEl.querySelector('#ad-tab-btn-visual') as HTMLElement | null;
    const btnTable = this.modalEl.querySelector('#ad-tab-btn-table') as HTMLElement | null;
    const btnModeling = this.modalEl.querySelector('#ad-tab-btn-modeling') as HTMLElement | null;
    const pVisual = this.modalEl.querySelector('#ad-tab-panel-visual') as HTMLElement | null;
    const pTable = this.modalEl.querySelector('#ad-tab-panel-table') as HTMLElement | null;
    const pModeling = this.modalEl.querySelector('#ad-tab-panel-modeling') as HTMLElement | null;

    const tabs: Array<[HTMLElement | null, string]> = [
      [btnVisual, 'visual'],
      [btnTable, 'table'],
      [btnModeling, 'modeling'],
    ];
    tabs.forEach(([btn, name]) => {
      btn?.classList.toggle('active', name === tab);
      btn?.setAttribute('aria-selected', name === tab ? 'true' : 'false');
    });

    if (pVisual) pVisual.style.display = 'none';
    if (pTable) pTable.style.display = 'none';
    if (pModeling) pModeling.style.display = 'none';

    if (tab === 'visual') {
      if (pVisual) pVisual.style.display = 'flex';
      this.canvasComp?.renderCanvas();
      this.tableComp?.updateMappingTable();
    } else if (tab === 'table') {
      if (pTable) pTable.style.display = 'flex';
      this.tableComp?.renderFullDataTable();
    } else if (pModeling) {
      pModeling.style.display = 'flex';
    }
  }

  private bindModalEvents(): void {
    if (!this.modalEl) return;
    const modal = this.modalEl;

    // 关闭与取消
    modal.querySelector('#ad-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#ad-btn-cancel')?.addEventListener('click', () => this.close());

    // 选项卡切换
    modal.querySelector('#ad-tab-btn-visual')?.addEventListener('click', () => this.switchTab('visual'));
    modal.querySelector('#ad-tab-btn-table')?.addEventListener('click', () => this.switchTab('table'));
    modal.querySelector('#ad-tab-btn-modeling')?.addEventListener('click', () => this.switchTab('modeling'));

    // 视觉复选框
    modal.querySelector('#ad-chk-curve')?.addEventListener('change', (e) => {
      this.canvasComp?.setDisplayOptions({ showCurve: (e.target as HTMLInputElement).checked });
    });
    modal.querySelector('#ad-chk-envelope')?.addEventListener('change', (e) => {
      this.canvasComp?.setDisplayOptions({ showEnvelope: (e.target as HTMLInputElement).checked });
    });
    modal.querySelector('#ad-chk-horizons')?.addEventListener('change', (e) => {
      this.canvasComp?.setDisplayOptions({ showPollenHorizons: (e.target as HTMLInputElement).checked });
    });
    modal.querySelector('#ad-rng-opacity')?.addEventListener('input', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value) || 0.65;
      this.canvasComp?.setDisplayOptions({ overlayOpacity: v });
    });

    // 缩放操作
    modal.querySelector('#ad-btn-zoom-in')?.addEventListener('click', () => this.canvasComp?.zoomAtCentre(true));
    modal.querySelector('#ad-btn-zoom-out')?.addEventListener('click', () => this.canvasComp?.zoomAtCentre(false));
    modal.querySelector('#ad-btn-zoom-fit')?.addEventListener('click', () => {
      this.canvasComp?.fitViewport();
      this.canvasComp?.renderCanvas();
    });
    modal.querySelector('#ad-btn-zoom-100')?.addEventListener('click', () => this.canvasComp?.reset100());

    // 浮动交互工具条模式切换
    modal.querySelectorAll('.ad-fmode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ad-fmode-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-fmode') as any;
        if (mode && this.canvasComp) this.canvasComp.setActiveFMode(mode);
      });
    });

    // 四点标定按钮与输入
    modal.querySelector('#ad-btn-calib-start')?.addEventListener('click', () => this.canvasComp?.startCalibration());
    modal.querySelector('#ad-btn-calib-reset')?.addEventListener('click', () => this.canvasComp?.resetCalibration());
    modal.querySelector('#ad-chk-age-log')?.addEventListener('change', () => this.canvasComp?.updateCalibReadout());
    modal.querySelector('#ad-chk-depth-log')?.addEventListener('change', () => this.canvasComp?.updateCalibReadout());
    (['ad-inp-age-left', 'ad-inp-age-right', 'ad-inp-depth-top', 'ad-inp-depth-bottom'] as const).forEach(
      (id) => modal.querySelector(`#${id}`)?.addEventListener('input', () => this.canvasComp?.updateCalibReadout())
    );

    // 排除笔刷
    modal.querySelector('#ad-btn-exclude-add')?.addEventListener('click', () => this.canvasComp?.toggleExcludeArmed());
    modal.querySelector('#ad-btn-exclude-clear')?.addEventListener('click', () => this.canvasComp?.clearExcludeBoxes());

    // 速率列勾选
    (['ad-chk-rate-sr', 'ad-chk-rate-ar'] as const).forEach((id) =>
      modal.querySelector(`#${id}`)?.addEventListener('change', () => this.controller?.renderRateOptionsNote())
    );

    // 载入范例
    modal.querySelector('#ad-btn-load-bacon')?.addEventListener('click', () => this.controller?.loadSampleImage('bacon'));
    modal.querySelector('#ad-btn-center-bacon')?.addEventListener('click', () => this.controller?.loadSampleImage('bacon'));
    modal.querySelector('#ad-btn-load-bchron')?.addEventListener('click', () => this.controller?.loadSampleImage('bchron'));
    modal.querySelector('#ad-btn-center-bchron')?.addEventListener('click', () => this.controller?.loadSampleImage('bchron'));

    // 本地文件上传
    const fileInput = modal.querySelector('#ad-file-input') as HTMLInputElement | null;
    modal.querySelector('#ad-btn-upload-file')?.addEventListener('click', () => fileInput?.click());
    modal.querySelector('#ad-btn-center-browse')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.controller?.handleCustomImageFile(file);
    });

    // 运行视觉提取
    modal.querySelector('#ad-btn-extract')?.addEventListener('click', () => {
      if (!this.canvasComp || !this.controller) return;
      void this.controller.executeExtraction({
        calibMarkers: this.canvasComp.getCalibMarkers(),
        excludeBoxes: this.canvasComp.getExcludeBoxes(),
        markerMap: this.canvasComp.markerMap(),
      });
    });

    // 确认应用
    modal.querySelector('#ad-btn-apply')?.addEventListener('click', async () => {
      const inspection = this.canvasComp?.getInspectionData();
      if (!inspection) {
        notifyError('请先运行提取或生成年代模型！');
        return;
      }
      try {
        if (this.controller) await this.controller.syncModelToBackend(inspection);
      } catch (err) {
        console.warn('Sync age model to backend warning:', err);
      }
      this.onApplyAgeModel(inspection);
      this.close();
    });

    // 运行 Bacon 年龄建模
    modal.querySelector('#btn-ad-run-local-r')?.addEventListener('click', () => {
      if (!this.tableComp || !this.controller) return;
      void this.controller.handleRunBaconModeling({
        dates: this.tableComp.getDatingTableData(),
        thickness: this.tableComp.getSelectedThickness(),
        hiatusDepths: this.tableComp.getHiatusDepths(),
        deltaR: this.tableComp.getDeltaR(),
        deltaRStd: this.tableComp.getDeltaRStd(),
      });
    });

    // 导出 geoChronR 脚本
    modal.querySelector('#btn-ad-export-geochronr')?.addEventListener('click', () => {
      this.controller?.exportGeoChronRScript();
    });

    // WebR 组件安装与离线导入
    modal.querySelector('#btn-ad-install-webr')?.addEventListener('click', () => {
      void this.controller?.handleInstallComponent();
    });
    const zipInput = modal.querySelector('#inp-ad-webr-zip') as HTMLInputElement | null;
    modal.querySelector('#btn-ad-import-webr-zip')?.addEventListener('click', () => zipInput?.click());
    zipInput?.addEventListener('change', () => {
      const file = zipInput.files?.[0];
      if (file) void this.controller?.handleOfflineZipUpload(file);
    });
  }
}
