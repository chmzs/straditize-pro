import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PropertyPanel } from './components/PropertyPanel';
import { Inspector } from './components/Inspector';
import { AgeDepthModal } from './components/AgeDepthModal';
import { DiagramCalibration, DiagramData } from './types/pollen';
import { ImageDisplayMode } from './core/Viewport';
import { WORKFLOW_STAGES, WorkflowStage } from './types/workflow';
import { tokens } from './styles/tokens';

async function bootstrap() {
  const appContainer = document.getElementById('app');
  if (!appContainer) throw new Error('Missing #app container');

  // 1. 初始化 JSON-RPC Client（先尝试探测后端，无后端自动降级为 Mock）
  const rpcClient = new RpcClient();
  await rpcClient.probeBackend();

  // 2. 获取初始图谱数据
  const initialData = await rpcClient.getDiagramData();

  // 3. 初始化历史状态管理器 (支持 500 步命令撤销/重做)
  const history = new HistoryManager(500);
  history.reset(initialData.columns, initialData.activeTaxaId);

  // 自动暂存与草稿防翻车保护 (Autosave & Recovery Protection)
  const AUTOSAVE_KEY = 'straditize_autosave_draft_v2';
  let autosaveTimer: number | null = null;
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      try {
        const draft = {
          timestamp: Date.now(),
          data: canvasComponent.data,
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
      } catch {
        // 忽略配额错误
      }
    }, 1000);
  }

  window.addEventListener('beforeunload', (e) => {
    if (history.canUndo()) {
      e.preventDefault();
      e.returnValue = '您有未保存的地学数字化工程修改，确定离开吗？';
    }
  });

  let sidebar: any = null;
  let inspector: any = null;
  let toolbar: any = null;

  // 4. 构建工作区 DOM
  const workspace = document.createElement('main');
  workspace.className = 'app-workspace';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';

  // 左右抽屉展开把手 (Drawer Tabs) - 直接挂载在 workspace 边缘，折叠时永远清晰可见
  const leftDrawerTab = document.createElement('div');
  leftDrawerTab.className = 'drawer-toggle-tab left-tab';
  leftDrawerTab.title = '展开属种分列清单 (快捷键: [)';
  leftDrawerTab.innerHTML = `<span>›</span><span>属种清单</span>`;
  leftDrawerTab.style.display = 'none';
  workspace.appendChild(leftDrawerTab);

  const rightDrawerTab = document.createElement('div');
  rightDrawerTab.className = 'drawer-toggle-tab right-tab';
  rightDrawerTab.title = '展开属性检查器 (快捷键: ])';
  rightDrawerTab.innerHTML = `<span>‹</span><span>属性检查器</span>`;
  rightDrawerTab.style.display = 'none';
  workspace.appendChild(rightDrawerTab);

  function setSidebarCollapsed(collapsed: boolean) {
    if (sidebar) sidebar.setCollapsed(collapsed);
    leftDrawerTab.style.display = collapsed ? 'flex' : 'none';
    if (toolbar) toolbar.setSidebarActive(!collapsed);
    setHudNotice(collapsed ? '属种分列列表已收起 (可点击左边缘把手或按 [ 键展开)' : '属种分列列表已展开', 2000);
    canvasComponent.handleResize();
  }

  function setInspectorCollapsed(collapsed: boolean) {
    if (inspector) inspector.setCollapsed(collapsed);
    rightDrawerTab.style.display = collapsed ? 'flex' : 'none';
    if (toolbar) toolbar.setInspectorActive(!collapsed);
    setHudNotice(collapsed ? '属性检查器已收起 (点击右边缘把手或顶栏 [属性 ☷] 即可展开)' : '属性检查器已展开', 2500);
    canvasComponent.handleResize();
  }

  function toggleSidebar() {
    setSidebarCollapsed(!sidebar?.getIsCollapsed());
  }

  function toggleInspector() {
    setInspectorCollapsed(!inspector?.getIsCollapsed());
  }

  leftDrawerTab.addEventListener('click', () => setSidebarCollapsed(false));
  rightDrawerTab.addEventListener('click', () => setInspectorCollapsed(false));

  // 浮动 HUD 提示
  const hud = document.createElement('div');
  hud.className = 'canvas-hud';
  hud.innerHTML = `
    <span class="hud-dot"></span>
    <span id="hud-text">就绪：单击左键添加锚点拉伸轮廓 | 拖拽微调 | 右键删点 | 按 B 键即时透视二值化墨迹</span>
  `;
  canvasWrapper.appendChild(hud);

  let hudTimer: number | null = null;
  const defaultHudText = '就绪：单击左键添加锚点拉伸轮廓 | 拖拽微调 | 右键删点 | 按 B 键即时透视二值化墨迹';

  function setHudNotice(text: string, duration: number = 3000) {
    const hudTextEl = document.getElementById('hud-text');
    if (!hudTextEl) return;
    hudTextEl.textContent = text;

    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = window.setTimeout(() => {
      hudTextEl.textContent = defaultHudText;
      hudTimer = null;
    }, duration);
  }

  // 5. 底部状态栏 (28px 恒定)
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="footer-left">
      <div class="footer-item" id="footer-dimensions">图像: <code>${initialData.imageWidth}×${initialData.imageHeight}</code></div>
      <div class="footer-item" id="footer-zoom">缩放: <code>100%</code></div>
      <div class="footer-item" id="footer-cursor">光标: <code>--</code></div>
      <div class="footer-item" id="footer-depth">深度: <code>--</code></div>
      <div class="footer-item" id="footer-pollen">丰度: <code>--</code></div>
      <div class="footer-item" id="footer-tool-mode">模式: <strong>选择 (V)</strong></div>
    </div>
    <div class="footer-right">
      <div class="footer-item" id="footer-active-taxa">当前属种: <strong>--</strong></div>
      <div class="footer-item" id="footer-anchors">锚点: <code>--</code></div>
    </div>
  `;

  // 6. 实例化画布组件
  const canvasComponent = new GeologyCanvas(canvasWrapper, initialData, history, {
    onTaxaChange: (_taxaId) => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    onDataChange: () => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
    },
    onHoverInfo: (info) => {
      const cursorEl = document.getElementById('footer-cursor');
      const depthEl = document.getElementById('footer-depth');
      const pollenEl = document.getElementById('footer-pollen');

      if (info) {
        if (cursorEl) cursorEl.innerHTML = `坐标: <code>X:${info.worldX} Y:${info.worldY}</code>`;
        if (depthEl) {
          const unit = canvasComponent.data.calibration.unit;
          if (info.horizonDepth !== undefined && info.horizonDepth !== null) {
            depthEl.innerHTML = `深度: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code> <strong style="color: #38bdf8; margin-left: 6px;">[层位: ${info.horizonDepth} ${unit}]</strong>`;
          } else {
            depthEl.innerHTML = `深度: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code>`;
          }
        }
        if (pollenEl) {
          pollenEl.innerHTML = `丰度: <code>${info.percent !== undefined ? info.percent + '%' : '--'}</code>`;
        }
      }
    },
    onFilterChange: (mode, binaryOverlay) => {
      toolbar?.updateFilterState(mode, binaryOverlay);
    },
    onDropFile: (file) => {
      handleOpenFile(file);
    },
    onStatusNotice: (text) => {
      setHudNotice(text, 2500);
    },
    onOpenCalibration: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenFileDialog: () => {
      (document.getElementById('file-input-image') as HTMLInputElement)?.click();
    },
  });

  // 6.2 显式分步推进状态机 (Step-by-Step Workflow State Machine)
  let currentStage: WorkflowStage = canvasComponent.data.columns.length > 0 ? 3 : 1;
  canvasComponent.setWorkflowStage(currentStage);

  const workflowActionBar = document.createElement('div');
  workflowActionBar.className = 'workflow-action-bar';
  workflowActionBar.style.cssText = `
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 95;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 16px;
    max-width: calc(100% - 40px);
    width: max-content;
    box-sizing: border-box;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid ${tokens.color.border.focus};
    border-radius: ${tokens.radius.full}px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.65);
    font-size: 11px;
    color: ${tokens.color.text.primary};
    pointer-events: auto;
  `;
  canvasWrapper.appendChild(workflowActionBar);

  function updateWorkflowBar() {
    const meta = WORKFLOW_STAGES[currentStage];
    canvasComponent.setWorkflowStage(currentStage);
    if (typeof toolbar !== 'undefined' && toolbar) {
      toolbar.setWorkflowStep(currentStage);
    }
    if (typeof inspector !== 'undefined' && inspector) {
      inspector.setWorkflowStage(currentStage);
    }

    workflowActionBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span style="background: ${tokens.color.column.activeBadge}; color: #fff; font-weight: 700; font-size: 10px; padding: 2px 7px; border-radius: 9999px; flex-shrink: 0;">S${currentStage}</span>
        <strong style="color: ${tokens.color.text.accent}; flex-shrink: 0;">${meta.stepName}</strong>
        <span style="color: ${tokens.color.text.secondary}; font-size: 11px; max-width: 320px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${meta.guideText}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${currentStage > 1 ? `<button id="btn-wf-prev" class="tool-btn" style="padding: 3px 8px; font-size: 10px;">↺ 上一步</button>` : ''}
        ${meta.primaryActionLabel ? `<button id="btn-wf-next" class="btn btn-primary" style="padding: 4px 10px; font-size: 10.5px; font-weight: 600; white-space: nowrap;">${meta.primaryActionLabel}</button>` : ''}
      </div>
    `;

    workflowActionBar.querySelector('#btn-wf-prev')?.addEventListener('click', () => {
      if (currentStage > 1) {
        currentStage = (currentStage - 1) as WorkflowStage;
        updateWorkflowBar();
      }
    });

    workflowActionBar.querySelector('#btn-wf-next')?.addEventListener('click', async () => {
      if (currentStage === 0) {
        // S0 -> S1
        (document.getElementById('file-input-image') as HTMLInputElement)?.click();
      } else if (currentStage === 1) {
        // S1 -> S2: 用户确认纯数据有效区，进入图像清理
        currentStage = 2;
        updateWorkflowBar();
        setHudNotice('✅ 数据有效区 (ROI) 已锁定！可在此阶段开启图像去横线并按 B 键预览，满意后进入分列。', 4500);
      } else if (currentStage === 2) {
        // S2 -> S3: 开始推导各花粉属种列
        setHudNotice('正在基于纯数据有效区推导各花粉属种垂直基线...', 5000);
        const cal = canvasComponent.data.calibration;
        const cols = await rpcClient.detectColumnsInRoi({
          x0: cal.dataXMin,
          x1: cal.dataXMax,
          y0: cal.dataYMin,
          y1: cal.dataYMax,
        });
        currentStage = 3;
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        updateWorkflowBar();
        updateFooter();
        setHudNotice(`✅ 成功切分 ${cols.length} 个属种列！请在侧边栏核对名单或使用 ▲/▼ 对调顺位。`, 4000);
      } else if (currentStage === 3) {
        // S3 -> S4: 推进至标尺标定
        currentStage = 4;
        updateWorkflowBar();
        setHudNotice('👉 请在右侧属性检查器核查或微调两点式深度标尺与各列物理刻度齿。', 4000);
      } else if (currentStage === 4) {
        // S4 -> S5: 标尺确认，开始全列拐点数字化提取
        setHudNotice('正在提取各列花粉多边形轮廓与显著控制手柄...', 8000);
        const cols = canvasComponent.data.columns;
        for (const col of cols) {
          const pts = await rpcClient.digitizeColumn(col.id);
          if (pts.length > 0) col.controlPoints = pts;
        }
        currentStage = 5;
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        updateWorkflowBar();
        updateFooter();
        setHudNotice('✅ 数字化完成！绿色半透明逆向对比层已开启，可直接在画布拖拽控制点微调。', 4500);
      } else if (currentStage === 5) {
        // S5 -> S6: 进入地学校验与自检
        currentStage = 6;
        updateWorkflowBar();
        propertyPanel.openExportModal();
        setHudNotice('🔍 已进入地学校验阶段：正在核验 100% 丰度总和自检门禁。', 4000);
      } else if (currentStage === 6) {
        // S6 -> S7: 进入导出交付
        currentStage = 7;
        updateWorkflowBar();
        propertyPanel.openExportModal();
      } else if (currentStage === 7) {
        propertyPanel.openExportModal();
      }
    });
  }

  // 7. 实例化侧边栏
  sidebar = new Sidebar(canvasComponent.data, {
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      updateFooter();
    },
    onToggleVisible: (taxaId) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.visible = !col.visible;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onChangeCurveType: (taxaId, type) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.curveType = type;
        history.push(`Change Curve Type to ${type}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onUpdateTaxaColor: (taxaId, color) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.color = color;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onBatchImportTaxa: (taxaNames) => {
      canvasComponent.batchUpdateTaxa(taxaNames);
      sidebar?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
      setHudNotice(`✅ 成功批量导入 ${taxaNames.length} 个属种名单并完成自动拓展对齐！`, 3500);
    },
    onSwapTaxaNames: (idx1, idx2) => {
      const cols = canvasComponent.data.columns;
      if (idx1 >= 0 && idx1 < cols.length && idx2 >= 0 && idx2 < cols.length) {
        const tmpName = cols[idx1].name;
        cols[idx1].name = cols[idx2].name;
        cols[idx2].name = tmpName;
        history.push(`Swap Taxa Names (${cols[idx1].name} <-> ${cols[idx2].name})`, cols, canvasComponent.data.activeTaxaId);
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        updateFooter();
        scheduleAutosave();
        setHudNotice(`🔀 已对调属种顺位: ${cols[idx1].name} 与 ${cols[idx2].name}`);
      }
    },
    onInsertGapColumn: (afterTaxaId) => {
      const cols = canvasComponent.data.columns;
      const curIdx = cols.findIndex((c) => c.id === afterTaxaId);
      const insertAt = curIdx !== -1 ? curIdx + 1 : cols.length;
      const refCol = curIdx !== -1 ? cols[curIdx] : cols[cols.length - 1];
      const startX = refCol ? refCol.endX : canvasComponent.data.calibration.dataXMin;
      const width = refCol ? (refCol.endX - refCol.startX) : 60;

      const newCol = {
        id: `col_${Date.now()}_gap`,
        name: `Gap_Col_${insertAt + 1}`,
        color: '#94a3b8',
        startX: startX,
        endX: startX + width,
        maxPercent: 20,
        tickEndX: startX + width,
        unit: '%',
        isLocked: false,
        curveType: 'linear' as const,
        visible: true,
        controlPoints: [],
        scale_type: 'linear' as const,
        startValue: 0,
        tickValue: 20,
        plotType: 'area' as const,
      };
      cols.splice(insertAt, 0, newCol);
      canvasComponent.data.activeTaxaId = newCol.id;
      history.push(`Insert Gap Column at ${insertAt + 1}`, cols, newCol.id);
      canvasComponent.requestRender();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
      setHudNotice(`➕ 已插入空缺占位列 [Gap_Col_${insertAt + 1}]，后续属种名字已顺延后推！`, 4000);
    },
  });

  // 8.1 年代-深度模型解译与视觉检查弹窗
  const ageDepthModal = new AgeDepthModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    (ageModel) => {
      setHudNotice(`✅ 成功关联年代模型 [${ageModel.metadata.curve_type || "Median"}]！导出时将自动注入日历年代与 95% 置信区间。`, 4000);
    }
  );

  // 8. 标定与弹窗交互面板
  const propertyPanel = new PropertyPanel(
    document.body,
    canvasComponent.data,
    rpcClient,
    (newCal: DiagramCalibration) => {
      canvasComponent.data.calibration = newCal;
      history.push('Update Calibration', canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    (projectData: DiagramData) => {
      canvasComponent.loadNewDiagram(projectData);
      history.reset(projectData.columns, projectData.activeTaxaId);
      currentStage = 3;
      updateWorkflowBar();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      toolbar?.updateScale(canvasComponent.viewport.scale);
      updateFooter();
      setHudNotice('✅ 成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。', 4500);
    }
  );

  // 9. 动态属性检查器 (Context Inspector)
  inspector = new Inspector(canvasComponent.data, history, {
    onDataChange: () => {
      canvasComponent.requestRender();
      sidebar?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
    },
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      sidebar?.updateData(canvasComponent.data);
      updateFooter();
    },
    onToggleCollapse: (collapsed) => {
      setInspectorCollapsed(collapsed);
    },
    onDigitizeActiveColumn: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      const points = await rpcClient.digitizeColumn(activeCol.id);
      if (points.length > 0) {
        activeCol.controlPoints = points;
        history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        setHudNotice(`⚡ 属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
      }
    },
    onOpenDataViewer: () => {
      propertyPanel.openExportModal();
    },
    onToggleLayerVisibility: (layer, visible) => {
      if (layer === 'ghost') {
        canvasComponent.viewport.showGhosting = visible;
        canvasComponent.requestRender();
        setHudNotice(visible ? '🟢 绿色原位半透明对比层已开启' : '绿色对比层已关闭');
      }
    },
    onChangeDegridStrength: (strength) => {
      canvasComponent.setDegridStrength(strength);
      setHudNotice(`去网格横线灵敏度设为: ${strength.toUpperCase()} (按 B 键透视查看红色切除预览)`);
    },
  });

  // 9. 处理自定义图片或项目包打开与加载逻辑
  async function handleOpenFile(file: File) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.tar') || lowerName.endsWith('.json') || lowerName.endsWith('.tar.gz')) {
      propertyPanel.openProjectFile(file);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setHudNotice('请选择或拖入有效的图片文件或项目文件 (.tar / .json)');
      return;
    }

    if (history.canUndo()) {
      if (!window.confirm('当前项目有未保存修改，重新加载图片将清空当前工作区。是否继续？')) {
        return;
      }
    }

    setHudNotice(`正在载入地质图谱: ${file.name}...`, 8000);

    const reader = new FileReader();
    reader.onload = async (e) => {
      let dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = async () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // 图像尺寸与性能预算安全检查 (规范第一节)
        const MAX_W = 8000;
        const MAX_H = 12000;
        const WARN_W = 6000;
        const WARN_H = 9000;

        if (w > MAX_W || h > MAX_H) {
          const okDownsample = window.confirm(
            `【图像尺寸过大提示】\n当前图像尺寸为 ${w}×${h} px，超过建议最大限制 (${MAX_W}×${MAX_H} px)。\n直接加载可能会耗尽浏览器内存导致崩溃。\n\n点击【确定】以 50% 降采样安全加载 (${Math.round(w / 2)}×${Math.round(h / 2)} px)；\n点击【取消】中止加载。`
          );
          if (!okDownsample) {
            setHudNotice('已取消加载超限大图');
            return;
          }
          const downsampled = downsampleImage(img, 0.5);
          dataUrl = downsampled.dataUrl;
          w = downsampled.w;
          h = downsampled.h;
        } else if (w >= WARN_W && h >= WARN_H) {
          setHudNotice(`提示: 图像尺寸较大 (${w}×${h} px)，建议在充足内存环境下操作。`, 4000);
        }

        // 调用 RPC 客户端（若在线发送至 Python 会话进行专业尺寸与二值化解析，若离线自动生成初始建议）
        const newDiagramData = await rpcClient.loadCustomImage(dataUrl, w, h, file.name);

        // 进入 S1 时清空：ROI、所有列、所有点、深度标定、撤销栈、选中状态
        canvasComponent.loadNewDiagram(newDiagramData);
        history.reset([], '');
        currentStage = 1;
        updateWorkflowBar();

        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        toolbar?.updateScale(canvasComponent.viewport.scale);
        toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
        updateFooter();

        setHudNotice(`✅ 成功载入图谱 [${file.name}] (${w}×${h})！请在画布上调整数据有效区 (Step 1)，随后点击下方推进。`, 5000);

        // 异步执行微小倾斜检测提示 (Deskew Helper)
        rpcClient.detectDeskew().then((skewRes) => {
          if (skewRes && skewRes.has_skew && Math.abs(skewRes.suggested_rotation_angle) >= 0.3) {
            const ang = skewRes.suggested_rotation_angle;
            const banner = document.createElement('div');
            banner.className = 'deskew-notice-banner';
            banner.style.cssText = 'position: fixed; top: 52px; right: 20px; z-index: 9999;';
            banner.innerHTML = `
              <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid #f59e0b; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); font-size: 11px; color: #f8fafc;">
                <span>📐 <strong>图谱微斜提示</strong>: 检测到主轴倾斜约 <strong>${ang > 0 ? '+' : ''}${ang}°</strong>，是否自动水平矫正？</span>
                <div style="display: flex; gap: 6px;">
                  <button id="btn-deskew-apply" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px; background: #f59e0b; border-color: #f59e0b;">旋转校正</button>
                  <button id="btn-deskew-ignore" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
                </div>
              </div>
            `;
            document.body.appendChild(banner);
            banner.querySelector('#btn-deskew-apply')?.addEventListener('click', async () => {
              banner.remove();
              setHudNotice(`正在旋转矫正图谱 (${ang}°)...`, 5000);
              const rotRes = await rpcClient.rotateImage(ang);
              if (rotRes && rotRes.success) {
                // 重新拉取图片数据
                const refreshed = await rpcClient.getDiagramData();
                canvasComponent.loadNewDiagram(refreshed);
                history.reset([], '');
                currentStage = 1;
                updateWorkflowBar();
                setHudNotice(`✅ 已水平矫正图谱！有效区已重置。`, 3500);
              }
            });
            banner.querySelector('#btn-deskew-ignore')?.addEventListener('click', () => {
              banner.remove();
            });
          }
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function downsampleImage(img: HTMLImageElement, ratio: number = 0.5): { dataUrl: string; w: number; h: number } {
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

  // 10. 处理范例图谱切换
  async function handleLoadSample(sampleKey: string) {
    setHudNotice(`正在切换内置范例图谱: ${sampleKey}...`, 5000);
    const newDiagramData = await rpcClient.loadSampleDiagram(sampleKey);

    canvasComponent.loadNewDiagram(newDiagramData);
    history.reset(newDiagramData.columns, newDiagramData.activeTaxaId);
    currentStage = 3;
    updateWorkflowBar();

    sidebar?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    toolbar?.updateScale(canvasComponent.viewport.scale);
    toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
    updateFooter();

    const nameMap: Record<string, string> = {
      hoya: 'Hoya del Castillo 花粉剖面',
      verification: '标定验证地质图谱',
      beginner: '初学者沉积图谱',
    };
    setHudNotice(`✅ 已载入范例: ${nameMap[sampleKey] || sampleKey}，已自动居中重置！`, 3500);
  }

  // 11. 实例化顶部工具栏
  toolbar = new Toolbar(history, rpcClient.getStatus(), {
    onFit: () => {
      canvasComponent.fitToScreen();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onReset100: () => {
      canvasComponent.resetZoom100();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onZoomIn: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 1.25);
      canvasComponent.requestRender();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onZoomOut: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 0.8);
      canvasComponent.requestRender();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onUndo: () => {
      const prev = history.undo();
      if (prev) {
        canvasComponent.data.columns = prev.columns;
        canvasComponent.data.activeTaxaId = prev.activeTaxaId;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
      }
    },
    onRedo: () => {
      const next = history.redo();
      if (next) {
        canvasComponent.data.columns = next.columns;
        canvasComponent.data.activeTaxaId = next.activeTaxaId;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
      }
    },
    onDigitize: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      const points = await rpcClient.digitizeColumn(activeCol.id);
      if (points.length > 0) {
        activeCol.controlPoints = points;
        history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onExport: async (format) => {
      const exportContent = await rpcClient.exportData(format);
      propertyPanel.openExportModal(exportContent, format);
    },
    onSaveProject: () => {
      propertyPanel.saveProjectFile();
      setHudNotice('💾 数字化项目已打包导出为标准归档包 (.tar)！', 3500);
    },
    onOpenProjectFile: (file) => {
      propertyPanel.openProjectFile(file);
    },
    onOpenCalibrationModal: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenAgeDepthModal: () => {
      ageDepthModal.open();
    },
    onToggleRpcConfig: () => {
      propertyPanel.openRpcConfigModal(() => {
        toolbar.updateStatus(rpcClient.getStatus());
      });
    },
    onOpenFile: (file) => {
      handleOpenFile(file);
    },
    onLoadSample: (sampleKey) => {
      handleLoadSample(sampleKey);
    },
    onChangeImageMode: (mode: ImageDisplayMode) => {
      canvasComponent.viewport.imageMode = mode;
      canvasComponent.requestRender();
      toolbar?.updateFilterState(mode, canvasComponent.viewport.showBinaryOverlay);
      setHudNotice(`底图滤镜模式切换为: ${mode}`);
    },
    onToggleBinaryOverlay: () => {
      const active = canvasComponent.viewport.toggleBinaryOverlay();
      canvasComponent.requestRender();
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, active);
      setHudNotice(active ? '透视遮罩: 墨迹高亮模式 [开启] (青蓝=保留花粉，红=切除横线，快捷键 B)' : '透视遮罩: [关闭]');
    },
    onChangeDegridStrength: (strength) => {
      canvasComponent.setDegridStrength(strength);
      setHudNotice(`去网格横线灵敏度设为: ${strength.toUpperCase()} (按 B 键透视查看红色切除预览)`);
    },
    onSelectToolMode: (mode) => {
      canvasComponent.setToolMode(mode);
      toolbar.setToolMode(mode);
      const desc = canvasComponent.toolModeManager.getToolDescription(mode);
      const footerModeEl = document.getElementById('footer-tool-mode');
      if (footerModeEl) {
        footerModeEl.innerHTML = `模式: <strong>${desc.name} (${desc.shortcut})</strong>`;
      }
      setHudNotice(`工具模式切换: ${desc.name} (${desc.shortcut}) - ${desc.hint}`);
    },
    onToggleSidebar: () => {
      toggleSidebar();
    },
    onToggleInspector: () => {
      toggleInspector();
    },
    onStepClick: (step) => {
      currentStage = step as WorkflowStage;
      updateWorkflowBar();
      const meta = WORKFLOW_STAGES[currentStage];
      setHudNotice(`切换至步骤 ${step}: ${meta.stepName} - ${meta.title}`);
    },
  });

  const clientStatus = rpcClient.getStatus();
  if (clientStatus.isDesktopMode ?? initialData.isDesktopMode) {
    toolbar.setDesktopMode(true);
  }

  // 13. 组装与挂载页面
  workspace.appendChild(sidebar.getElement());
  workspace.appendChild(canvasWrapper);
  workspace.appendChild(inspector.getElement());

  appContainer.appendChild(toolbar.getElement());
  appContainer.appendChild(workspace);
  appContainer.appendChild(footer);

  // 挂载就绪后更新初始工作流向导条
  updateWorkflowBar();

  // 全局快捷键 [ 和 ] 折叠/展开侧边栏与检查器
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    if (e.key === '[' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleSidebar();
    } else if (e.key === ']' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleInspector();
    }
  });

  function updateFooter() {
    const col = canvasComponent.getActiveColumn();
    const activeEl = document.getElementById('footer-active-taxa');
    const anchorsEl = document.getElementById('footer-anchors');
    const dimEl = document.getElementById('footer-dimensions');
    const zoomEl = document.getElementById('footer-zoom');

    if (dimEl) {
      dimEl.innerHTML = `图像: <code>${canvasComponent.data.imageWidth}×${canvasComponent.data.imageHeight}</code>`;
    }
    if (zoomEl) {
      zoomEl.innerHTML = `缩放: <code>${Math.round(canvasComponent.viewport.scale * 100)}%</code>`;
    }
    if (col && activeEl) {
      activeEl.innerHTML = `当前属种: <span style="color: ${col.color};">●</span> <strong>${col.name}</strong>`;
    }
    if (col && anchorsEl) {
      const manual = col.controlPoints.filter((p) => p.isManual).length;
      anchorsEl.innerHTML = `锚点数: <code>${manual} 手动 / ${col.controlPoints.length} 总计</code>`;
    }
  }

  // 监听滚轮更新 Toolbar 显示的缩放比例
  canvasComponent.canvas.addEventListener('wheel', () => {
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  window.addEventListener('resize', () => {
    canvasComponent.handleResize();
  });

  // 容器初次挂载后自适应画布尺寸并居中图谱
  requestAnimationFrame(() => {
    canvasComponent.handleResize();
    canvasComponent.fitToScreen();
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  updateFooter();
  toolbar?.updateScale(canvasComponent.viewport.scale);
  toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);

  // 检查是否存在未保存的自动草稿快照
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      const draft = JSON.parse(saved);
      if (draft && draft.data && Array.isArray(draft.data.columns) && draft.data.columns.length > 0 && (Date.now() - draft.timestamp < 7 * 86400 * 1000)) {
        const draftTime = new Date(draft.timestamp).toLocaleTimeString();
        const banner = document.createElement('div');
        banner.className = 'draft-recovery-banner';
        banner.style.cssText = 'position: fixed; top: 48px; left: 50%; transform: translateX(-50%); z-index: 9999;';
        banner.innerHTML = `
          <div style="background: rgba(15, 23, 42, 0.95); border: 1px solid #38bdf8; border-radius: 6px; padding: 7px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 18px rgba(0,0,0,0.5); font-size: 11px; color: #f8fafc;">
            <span>📋 发现上次未保存的草稿 (${draftTime}, 含 ${draft.data.columns.length} 个属种列)</span>
            <div style="display: flex; gap: 6px;">
              <button id="btn-restore-draft" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">恢复草稿</button>
              <button id="btn-discard-draft" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
            </div>
          </div>
        `;
        document.body.appendChild(banner);
        banner.querySelector('#btn-restore-draft')?.addEventListener('click', () => {
          canvasComponent.loadNewDiagram(draft.data);
          history.reset(draft.data.columns, draft.data.activeTaxaId);
          sidebar?.updateData(canvasComponent.data);
          inspector?.updateData(canvasComponent.data);
          toolbar?.updateHistoryState();
          updateFooter();
          banner.remove();
          setHudNotice('✅ 成功恢复上次自动暂存的项目草稿！', 3500);
        });
        banner.querySelector('#btn-discard-draft')?.addEventListener('click', () => {
          localStorage.removeItem(AUTOSAVE_KEY);
          banner.remove();
        });
      }
    }
  } catch {
    // 忽略异常
  }

  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
