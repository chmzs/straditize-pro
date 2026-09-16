import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PropertyPanel } from './components/PropertyPanel';
import { Inspector } from './components/Inspector';
import { DiagramCalibration, DiagramData } from './types/pollen';
import { ImageDisplayMode } from './core/Viewport';

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

  // 4. 构建工作区 DOM
  const workspace = document.createElement('main');
  workspace.className = 'app-workspace';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';

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

  // 5. 底部状态栏 (顶部工具条 + 底部状态栏显示当前模式)
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="footer-left">
      <div class="footer-item" id="footer-tool-mode">模式: <strong>选择 (V)</strong></div>
      <div class="footer-item" id="footer-cursor">光标: <code>--</code></div>
      <div class="footer-item" id="footer-depth">深度: <code>--</code></div>
      <div class="footer-item" id="footer-pollen">含量: <code>--</code></div>
    </div>
    <div class="footer-right">
      <div class="footer-item" id="footer-active-taxa">当前属种: <strong>--</strong></div>
      <div class="footer-item" id="footer-anchors">锚点: <code>--</code></div>
    </div>
  `;

  // 6. 实例化画布组件
  const canvasComponent = new GeologyCanvas(canvasWrapper, initialData, history, {
    onTaxaChange: (_taxaId) => {
      sidebar.updateData(canvasComponent.data);
      inspector.updateData(canvasComponent.data);
      updateFooter();
    },
    onDataChange: () => {
      sidebar.updateData(canvasComponent.data);
      inspector.updateData(canvasComponent.data);
      toolbar.updateHistoryState();
      updateFooter();
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
      toolbar.updateFilterState(mode, binaryOverlay);
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
  });

  // 7. 实例化侧边栏
  const sidebar = new Sidebar(canvasComponent.data, {
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      updateFooter();
    },
    onToggleVisible: (taxaId) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.visible = !col.visible;
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
      }
    },
    onChangeCurveType: (taxaId, type) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.curveType = type;
        history.push(`Change Curve Type to ${type}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
      }
    },
    onUpdateTaxaColor: (taxaId, color) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.color = color;
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
      }
    },
    onBatchImportTaxa: (taxaNames) => {
      canvasComponent.batchUpdateTaxa(taxaNames);
      sidebar.updateData(canvasComponent.data);
      toolbar.updateHistoryState();
      updateFooter();
      setHudNotice(`✅ 成功批量导入 ${taxaNames.length} 个属种名单并完成自动拓展对齐！`, 3500);
    },
  });

  // 8. 标定与弹窗交互面板
  const propertyPanel = new PropertyPanel(
    document.body,
    canvasComponent.data,
    rpcClient,
    (newCal: DiagramCalibration) => {
      canvasComponent.data.calibration = newCal;
      history.push('Update Calibration', canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
      canvasComponent.requestRender();
      inspector.updateData(canvasComponent.data);
      updateFooter();
    },
    (projectData: DiagramData) => {
      canvasComponent.loadNewDiagram(projectData);
      history.reset(projectData.columns, projectData.activeTaxaId);
      sidebar.updateData(canvasComponent.data);
      inspector.updateData(canvasComponent.data);
      toolbar.updateHistoryState();
      toolbar.updateScale(canvasComponent.viewport.scale);
      updateFooter();
      setHudNotice('✅ 成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。', 4500);
    }
  );

  // 9. 动态属性检查器 (Context Inspector)
  const inspector = new Inspector(canvasComponent.data, history, {
    onDataChange: () => {
      canvasComponent.requestRender();
      sidebar.updateData(canvasComponent.data);
      toolbar.updateHistoryState();
      updateFooter();
    },
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      sidebar.updateData(canvasComponent.data);
      updateFooter();
    },
    onToggleCollapse: (collapsed) => {
      setHudNotice(collapsed ? '属性检查器已收起 (按 ] 键展开)' : '属性检查器已展开 (按 ] 键收起)', 2000);
      canvasComponent.handleResize();
    },
    onDigitizeActiveColumn: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      const points = await rpcClient.digitizeColumn(activeCol.id);
      if (points.length > 0) {
        activeCol.controlPoints = points;
        history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
        inspector.updateData(canvasComponent.data);
        setHudNotice(`⚡ 属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
      }
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

    setHudNotice(`正在载入地质图谱: ${file.name}...`, 8000);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
      img.onload = async () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        // 调用 RPC 客户端（若在线发送至 Python 会话进行专业尺寸与二值化解析，若离线自动生成初始建议）
        const newDiagramData = await rpcClient.loadCustomImage(dataUrl, w, h, file.name);

        // Canvas 视口即时加载并以高清晰度展示，重置居中并触发分列初始建议
        canvasComponent.loadNewDiagram(newDiagramData);
        history.reset(newDiagramData.columns, newDiagramData.activeTaxaId);

        sidebar.updateData(canvasComponent.data);
        toolbar.updateHistoryState();
        toolbar.updateScale(canvasComponent.viewport.scale);
        toolbar.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
        updateFooter();

        setHudNotice(`✅ 成功载入图谱 [${file.name}] (${w}×${h})，已自动重置视口居中并完成初始分列建议！`, 4000);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // 10. 处理范例图谱切换
  async function handleLoadSample(sampleKey: string) {
    setHudNotice(`正在切换内置范例图谱: ${sampleKey}...`, 5000);
    const newDiagramData = await rpcClient.loadSampleDiagram(sampleKey);

    canvasComponent.loadNewDiagram(newDiagramData);
    history.reset(newDiagramData.columns, newDiagramData.activeTaxaId);

    sidebar.updateData(canvasComponent.data);
    toolbar.updateHistoryState();
    toolbar.updateScale(canvasComponent.viewport.scale);
    toolbar.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
    updateFooter();

    const nameMap: Record<string, string> = {
      hoya: 'Hoya del Castillo 花粉剖面',
      verification: '标定验证地质图谱',
      beginner: '初学者沉积图谱',
    };
    setHudNotice(`✅ 已载入范例: ${nameMap[sampleKey] || sampleKey}，已自动居中重置！`, 3500);
  }

  // 11. 实例化顶部工具栏
  const toolbar = new Toolbar(history, rpcClient.getStatus(), {
    onFit: () => {
      canvasComponent.fitToScreen();
      toolbar.updateScale(canvasComponent.viewport.scale);
    },
    onReset100: () => {
      canvasComponent.resetZoom100();
      toolbar.updateScale(canvasComponent.viewport.scale);
    },
    onZoomIn: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 1.25);
      canvasComponent.requestRender();
      toolbar.updateScale(canvasComponent.viewport.scale);
    },
    onZoomOut: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 0.8);
      canvasComponent.requestRender();
      toolbar.updateScale(canvasComponent.viewport.scale);
    },
    onUndo: () => {
      const prev = history.undo();
      if (prev) {
        canvasComponent.data.columns = prev.columns;
        canvasComponent.data.activeTaxaId = prev.activeTaxaId;
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
        toolbar.updateHistoryState();
      }
    },
    onRedo: () => {
      const next = history.redo();
      if (next) {
        canvasComponent.data.columns = next.columns;
        canvasComponent.data.activeTaxaId = next.activeTaxaId;
        canvasComponent.requestRender();
        sidebar.updateData(canvasComponent.data);
        toolbar.updateHistoryState();
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
        sidebar.updateData(canvasComponent.data);
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
      toolbar.updateFilterState(mode, canvasComponent.viewport.showBinaryOverlay);
      setHudNotice(`底图滤镜模式切换为: ${mode}`);
    },
    onToggleBinaryOverlay: () => {
      const active = canvasComponent.viewport.toggleBinaryOverlay();
      canvasComponent.requestRender();
      toolbar.updateFilterState(canvasComponent.viewport.imageMode, active);
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
  });

  const clientStatus = rpcClient.getStatus();
  if (clientStatus.isDesktopMode ?? initialData.isDesktopMode) {
    toolbar.setDesktopMode(true);
  }

  // 12. 组装与挂载页面
  workspace.appendChild(sidebar.getElement());
  workspace.appendChild(canvasWrapper);
  workspace.appendChild(inspector.getElement());

  appContainer.appendChild(toolbar.getElement());
  appContainer.appendChild(workspace);
  appContainer.appendChild(footer);

  // 全局快捷键 [ 和 ] 折叠/展开侧边栏与检查器
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    if (e.key === '[' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const isCol = sidebar.toggleCollapse();
      setHudNotice(isCol ? '属种分列列表已收起 (按 [ 键展开)' : '属种分列列表已展开 (按 [ 键收起)', 2000);
      canvasComponent.handleResize();
    } else if (e.key === ']' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      inspector.toggleCollapse();
    }
  });

  function updateFooter() {
    const col = canvasComponent.getActiveColumn();
    const activeEl = document.getElementById('footer-active-taxa');
    const anchorsEl = document.getElementById('footer-anchors');

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
    toolbar.updateScale(canvasComponent.viewport.scale);
  });

  window.addEventListener('resize', () => {
    canvasComponent.handleResize();
  });

  // 容器初次挂载后自适应画布尺寸并居中图谱
  requestAnimationFrame(() => {
    canvasComponent.handleResize();
    canvasComponent.fitToScreen();
    toolbar.updateScale(canvasComponent.viewport.scale);
  });

  updateFooter();
  toolbar.updateScale(canvasComponent.viewport.scale);
  toolbar.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
