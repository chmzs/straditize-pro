/**
 * AgeDepthModal DOM 模板生成函数。
 * 包含 Visual Inspection、Table Studio、Dating & Downstream 三大面板与粘贴导入弹窗。
 */
export function createAgeDepthModalHtml(): string {
  return `
    <div class="modal-dialog agedepth-dialog">
      <div class="ui-modal__header">
        <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;">
          <h3 class="ui-modal__title">年代-深度模型</h3>
          <span class="ui-status">Bacon / geoChronR</span>
          <!-- 当前图谱来源。原先挂在右侧「图谱数据源」块里，与中间空白区的上传按钮重复，
               该块已删除；标签移到这里，既保留信息又不占一个操作位。 -->
          <span id="ad-current-source-label" style="color: var(--accent-blue); font-size: var(--font-size-sm);">正在检查...</span>
        </div>
        <button class="ui-icon-btn" id="ad-close-btn" aria-label="关闭年代模型窗口" title="关闭">&times;</button>
      </div>

      <!-- 选项卡切换: 视觉解译 vs 结果数据表 vs 测年建模向导 -->
      <div class="ad-tab-strip" role="tablist">
        <button class="ui-btn ui-btn--quiet ui-btn--sm ad-tab-btn active" id="ad-tab-btn-visual" role="tab" aria-selected="true">
          图像检查
        </button>
        <button class="ui-btn ui-btn--quiet ui-btn--sm ad-tab-btn" id="ad-tab-btn-table" role="tab" aria-selected="false">
          结果表
        </button>
        <button class="ui-btn ui-btn--quiet ui-btn--sm ad-tab-btn" id="ad-tab-btn-modeling" role="tab" aria-selected="false">
          测年与建模
        </button>
      </div>

      <div class="ui-modal__body">
        <!-- ================================================================= -->
        <!-- Tab 1: 视觉解译视口 (Visual Inspection) -->
        <!-- ================================================================= -->
        <div id="ad-tab-panel-visual" style="flex: 1; display: flex; gap: 14px; min-width: 0; min-height: 0; overflow: hidden;">
          <!-- 左侧: Canvas -->
          <div class="ad-viewport-pane" style="flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-curve" checked />
                  <span style="color: var(--accent-blue); font-weight: 600;">拟合代表线</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-envelope" checked />
                  <span style="color: var(--accent-amber); font-weight: 600;">95% 置信带</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="ad-chk-horizons" checked />
                  <span style="color: var(--accent-green); font-weight: 600;">花粉层位交点</span>
                </label>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>图层透明度:</span>
                <input type="range" id="ad-rng-opacity" min="0.1" max="1.0" step="0.05" value="0.65" style="width: 80px;" />
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-zoom-out" title="缩小 (快捷键 - / 滚轮)" style="padding: 1px 6px;">−</button>
                <span id="ad-zoom-label" style="font-family: var(--font-mono); min-width: 38px; text-align: center;">—</span>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-zoom-in" title="放大 (快捷键 + / 滚轮)" style="padding: 1px 6px;">＋</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-zoom-fit" title="适应窗口 (快捷键 F)" style="padding: 1px 6px;">⛶适应 (F)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-zoom-100" title="原始尺寸 100% (快捷键 Ctrl+1)" style="padding: 1px 6px;">1:1</button>
              </div>
            </div>

            <div id="ad-canvas-container" style="flex: 1; min-height: 240px; position: relative; background: var(--bg-tertiary); border: 2px dashed var(--border-color); border-radius: 6px; overflow: hidden;">
              <!-- 画布左上角控制点与测年点交互工具条 -->
              <div id="ad-floating-toolbar" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-fmode-btn active" data-fmode="adjust" title="微调控制点 (快捷键 S)">微调 (S)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-fmode-btn" data-fmode="add" title="在所选目标线上增加控制点 (快捷键 A)">加点 (A)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-fmode-btn" data-fmode="delete" title="删除控制点 (快捷键 D / Delete)">删点 (D)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-fmode-btn" data-fmode="pickDate" style="color: var(--accent-green);" title="拾取测年点 (快捷键 P)">拾取测年点 (P)</button>
                <div style="display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; padding-left: 6px; border-left: 1px solid var(--border-color);">
                  <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-undo" title="撤销操作 (快捷键 Ctrl+Z)" disabled style="padding: 1px 6px; opacity: 0.45; cursor: not-allowed;">撤销 (Ctrl+Z)</button>
                  <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-redo" title="重做操作 (快捷键 Ctrl+Y / Ctrl+Shift+Z)" disabled style="padding: 1px 6px; opacity: 0.45; cursor: not-allowed;">重做 (Ctrl+Y)</button>
                </div>
                <div style="display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; padding-left: 6px; border-left: 1px solid var(--border-color);">
                  <span style="font-size: 10px; color: var(--text-muted);">编辑目标:</span>
                  <div class="ad-target-btn-group" style="display: inline-flex; gap: 2px;">
                    <button class="ui-btn ui-btn--quiet ui-btn--xs ad-target-btn active" data-target="curve" style="color: var(--accent-blue); font-weight: 700; padding: 1px 5px;" title="编辑均值代表线 (快捷键 1)">均值 (1)</button>
                    <button class="ui-btn ui-btn--quiet ui-btn--xs ad-target-btn" data-target="lower" style="color: var(--accent-green); padding: 1px 5px;" title="编辑置信区间下界 (快捷键 2)">下界 (2)</button>
                    <button class="ui-btn ui-btn--quiet ui-btn--xs ad-target-btn" data-target="upper" style="color: var(--accent-red); padding: 1px 5px;" title="编辑置信区间上界 (快捷键 3)">上界 (3)</button>
                  </div>
                  <select id="ad-sel-edit-target" class="ui-select ui-select--xs" style="font-size: 10px; padding: 1px 4px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 3px; display: none;">
                    <option value="curve" selected>均值线 (Mean)</option>
                    <option value="lower">置信区间下界 (Lower)</option>
                    <option value="upper">置信区间上界 (Upper)</option>
                  </select>
                </div>
              </div>
              <canvas id="ad-inspection-canvas" style="position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; display: none;"></canvas>
              <div id="ad-loading-zone" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); z-index: 12; padding: 24px; text-align: center;">
                <div class="ui-spinner" style="margin-bottom: 12px;"></div>
                <h4 style="font-size: 14px; font-weight: 600; color: var(--text-heading); margin: 0 0 6px 0;">正在载入年代-深度模型...</h4>
                <p style="font-size: 11.5px; color: var(--text-muted); margin: 0;">正在从工程状态还原底图与解译轨迹</p>
              </div>
              <div id="ad-empty-drop-zone" style="position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); z-index: 10; padding: 24px; text-align: center;">
                <div class="ui-empty-glyph" aria-hidden="true"></div>
                <h4 style="font-size: 15px; font-weight: 700; color: var(--text-heading); margin: 0 0 6px 0;">请载入年代-深度模型图谱</h4>
                <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0 0 16px 0; max-width: 420px; line-height: 1.5;">
                  直接将 <strong>Bacon / Bchron / OxCal</strong> 年代图拖拽至此处，或选择内置范例。
                </p>
                <button id="ad-btn-center-browse" class="ui-btn ui-btn--primary" style="padding: 6px 18px; font-size: 12px; margin-bottom: 10px;">
                  选择本地年代图 (PNG/JPG)
                </button>
                <div style="display: flex; gap: 10px; align-items: center; font-size: 11px;">
                  <button id="ad-btn-center-bacon" class="ui-btn ui-btn--quiet ui-btn--xs" style="color: var(--accent-blue);">Hoya Bacon 范例</button>
                  <button id="ad-btn-center-bchron" class="ui-btn ui-btn--quiet ui-btn--xs" style="color: var(--accent-blue);">Bchron 阶梯范例</button>
                </div>
              </div>
              <div id="ad-canvas-hud" style="position: absolute; bottom: 8px; left: 8px; background: var(--bg-hud); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; font-family: var(--font-mono); color: var(--text-secondary); pointer-events: none; z-index: 15;">
                悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代
              </div>
            </div>

            <div style="font-size: 10.5px; color: var(--text-muted); display: flex; justify-content: space-between;">
              <span>视觉检查标准：高亮蓝线应精确穿过深色脊线（或均值红线）；琥珀色阴影应贴合灰色置信区间边缘。</span>
              <span id="ad-status-msg" style="color: var(--status-success);"></span>
            </div>

            <!-- 唯一的文件选择器：#ad-btn-center-browse 触发它；拖拽也走同一个 input。 -->
            <input type="file" id="ad-file-input" accept="image/*" style="display: none;" />
          </div>

          <!-- 分隔条：拖动改控制栏宽度，双击复位 -->
          <div class="ad-pane-splitter" id="ad-pane-splitter" role="separator"
               aria-orientation="vertical" tabindex="0"
               title="拖动调节控制栏宽度（双击复位）"></div>

          <!-- 右侧控制区：宽度由 --ad-pane-width 决定，不再写死 330px -->
          <div class="ad-control-pane">
            <!-- 原先这里有一个「图谱数据源 / 上传本地图谱」块，与画布空白区的
                 「选择本地年代图」按钮指向同一个 fileInput.click()，属重复入口，已删除。
                 上传只保留一个入口：画布中央 #ad-btn-center-browse；
                 当前图谱名称移到标题栏 #ad-current-source-label。 -->

            <!-- ============ 步骤 1：坐标轴标定 ============ -->
            <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 11px; font-weight: bold; color: var(--accent-blue);">① 坐标轴标定 (Calibration)</span>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-calib-reset" style="font-size: 9.5px; padding: 1px 6px;">重置</button>
              </div>

              <!-- 轴向翻转选择 (支持标准 Bacon 与深度为 X 的反向文献) -->
              <div style="display: flex; gap: 10px; margin-bottom: 8px; font-size: 10px;">
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="radio" name="ad-axis-orient" id="ad-orient-std" value="std" checked />
                  <span>X=年代, Y=深度</span>
                </label>
                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="radio" name="ad-axis-orient" id="ad-orient-rev" value="rev" />
                  <span>X=深度, Y=年代</span>
                </label>
              </div>

              <button class="ui-btn ui-btn--primary" id="ad-btn-calib-start" style="width: 100%; font-size: 11px; padding: 5px;">
                在图上点击 4 个标定点
              </button>

              <ol id="ad-calib-checklist" style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10px; line-height: 1.7; color: var(--text-muted);">
                <li data-kind="ageA">年龄轴端点 1（左/旧端刻度）</li>
                <li data-kind="ageB">年龄轴端点 2（右/新端刻度）</li>
                <li data-kind="depthA">深度轴端点 1（顶端刻度）</li>
                <li data-kind="depthB">深度轴端点 2（底端刻度）</li>
              </ol>

              <div id="ad-calib-hint" style="margin-top: 6px; font-size: 10px; color: var(--accent-amber); line-height: 1.5;"></div>

              <!-- 四点落位后一次性批量输入数值 -->
              <div id="ad-calib-values" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <div style="font-size: 10.5px; font-weight: 600; color: var(--text-primary); margin-bottom: 5px;">批量输入标定值:</div>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 5px 6px; font-size: 10.5px; align-items: center;">
                  <label style="color: var(--accent-blue);">① 年龄 1</label>
                  <input type="number" id="ad-inp-age-left" value="" placeholder="如 3000" style="width: 100%; font-size: 11px;" />
                  <label style="color: var(--accent-blue);">② 年龄 2</label>
                  <input type="number" id="ad-inp-age-right" value="" placeholder="如 0" style="width: 100%; font-size: 11px;" />
                  <label style="color: var(--accent-green);">③ 深度 1</label>
                  <input type="number" id="ad-inp-depth-top" value="" placeholder="如 0" style="width: 100%; font-size: 11px;" />
                  <label style="color: var(--accent-green);">④ 深度 2</label>
                  <input type="number" id="ad-inp-depth-bottom" value="" placeholder="如 150" style="width: 100%; font-size: 11px;" />
                </div>
                <div style="display: flex; gap: 12px; margin-top: 7px; font-size: 10px;">
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-age-log" />
                    <span>年龄轴 log 变换</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-depth-log" />
                    <span>深度轴 log 变换</span>
                  </label>
                </div>
                <!-- 年龄方向：由标定自动推出，用户可强制覆盖 -->
                <div style="margin-top: 7px; display: grid; grid-template-columns: auto 1fr; gap: 5px 6px; align-items: center;">
                  <label style="color: var(--text-secondary); font-size: 10px;">年代方向</label>
                  <select id="ad-sel-age-direction" style="width: 100%; font-size: 10.5px;">
                    <option value="auto" selected>自动（从标定推出）</option>
                    <option value="downcore">强制：向下年代变老</option>
                    <option value="upcore">强制：向下年代变新</option>
                  </select>
                </div>
                <div id="ad-age-direction-readout" style="margin-top: 4px; font-size: 9.5px; color: var(--text-muted); line-height: 1.5;"></div>
                <div id="ad-calib-readout" style="margin-top: 6px; font-size: 9.5px; color: var(--text-muted); font-family: var(--font-mono); line-height: 1.5;"></div>
              </div>
            </div>

            <!-- ============ 步骤 1b：物理量单位与 Y 轴对接 ============ -->
            <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border-left: 3px solid var(--accent-blue); background: var(--bg-card); border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <span style="font-size: 10.5px; font-weight: 700; color: var(--text-primary);">①b 物理量单位与 Y 轴对接</span>
                <span id="ad-ycal-sync-badge" style="font-size: 9.5px; padding: 1px 6px; border-radius: 3px; background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); font-weight: 600;">未对接</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 10px;">
                <div>
                  <label style="color: var(--text-muted); display: block; margin-bottom: 2px;">深度单位 (Depth Unit):</label>
                  <input type="text" id="ad-inp-depth-unit" list="ad-list-depth-units" value="cm" placeholder="cm" style="width: 100%; font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary);" />
                  <datalist id="ad-list-depth-units">
                    <option value="cm">cm (厘米 - 统一标准)</option>
                  </datalist>
                </div>
                <div>
                  <label style="color: var(--text-muted); display: block; margin-bottom: 2px;">年代单位 (Age Unit):</label>
                  <input type="text" id="ad-inp-age-unit" list="ad-list-age-units" value="cal yrBP" placeholder="如 cal yrBP / ka BP" style="width: 100%; font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary);" />
                  <datalist id="ad-list-age-units">
                    <option value="cal yrBP">cal yrBP (日历年前 - 统一标准)</option>
                    <option value="ka BP">ka BP (千年 - 1 ka = 1000 cal yrBP)</option>
                    <option value="14C BP">14C BP (未校正碳十四年)</option>
                  </datalist>
                </div>
              </div>
              <div id="ad-ycal-sync-hint" style="font-size: 9.5px; color: var(--text-muted); line-height: 1.45; margin-top: 5px;">
                建议标准单位：深度统一为 <code>cm</code>；年代统一为 <code>cal yrBP</code>。若原图标注为 <code>ka BP</code>，建议将标定读数直接乘 1000 录入为 <code>cal yrBP</code>，以保证与全球古气候事件同量纲对齐。
              </div>
            </div>

            <!-- ============ 步骤 2：提取深度范围 ============ -->
            <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <div style="font-size: 11px; font-weight: bold; color: var(--accent-green); margin-bottom: 6px;">② 提取深度范围 (Extraction Range)</div>
              <div style="display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 5px; font-size: 10.5px; align-items: center;">
                <label style="color: var(--text-muted);">最小</label>
                <input type="number" id="ad-inp-range-min" value="" placeholder="如 0" style="width: 100%; font-size: 11px;" />
                <label style="color: var(--text-muted);">最大</label>
                <input type="number" id="ad-inp-range-max" value="" placeholder="如 150" style="width: 100%; font-size: 11px;" />
              </div>
              <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;">
                范围可窄于标定区间：标定打在坐标轴末端，只提取实际分析段。
              </div>
            </div>

            <!-- ============ 步骤 3：识别与校对 ============ -->
            <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <div style="display: grid; grid-template-columns: auto 1fr; gap: 5px 6px; font-size: 10.5px; align-items: center;">
                <label style="color: var(--text-muted);" title="用哪个响应通道定位中位线。自动会同时试暗度与色度，取贯穿画布更高的那个。">识别通道</label>
                <select id="ad-sel-channel" class="sample-select" style="width: 100%; font-size: 11px;">
                  <option value="auto">自动（推荐）</option>
                  <option value="chroma">色度（彩色笔画）</option>
                  <option value="darkness">暗度（灰度笔画）</option>
                </select>
              </div>
              <div id="ad-channel-reason" style="font-size: 9.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;"></div>
            </div>

            <button class="ui-btn ui-btn--primary" id="ad-btn-extract" style="padding: 7px 10px; font-size: 11.5px; font-weight: 700;">
              ③ 运行识别并叠加视觉校对
            </button>

            <div id="ad-extract-error" style="display: none; font-size: 10px; color: var(--accent-red); line-height: 1.5; padding: 6px 8px; border-radius: 4px; background: rgba(239, 68, 68, 0.08);"></div>

            <!-- 排除笔刷（矩形橡皮擦） -->
            <div class="form-group" style="margin: 0; padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 10.5px; font-weight: 600;">排除干扰区 (橡皮擦)</span>
                <span id="ad-exclude-count" style="font-size: 9.5px; color: var(--text-muted);">0 个</span>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 5px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-exclude-add" style="flex: 1; font-size: 10px;">＋ 拖框添加</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-exclude-clear" style="font-size: 10px;">清空</button>
              </div>
              <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;">
                用于遮住图例、文字批注或测年点概率分布图；被遮区域不参与曲线识别。
              </div>
            </div>

            <!-- 年代-深度提取值表格呈现与层位预览 -->
            <div style="flex: 1; min-height: 140px; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 10.5px; font-weight: bold; color: var(--text-primary);">年代-深度提取值表:</span>
                <div style="display: flex; gap: 4px; align-items: center;">
                  <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-toggle-side-table" style="font-size: 9px; padding: 1px 6px;" title="在全量提取模型与花粉样品层位之间切换">全量模型</button>
                  <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-btn-expand-full-table" style="font-size: 9px; padding: 1px 6px; color: var(--accent-blue);" title="展开为全屏大表格进行批量编辑与导入导出">⛶ 展开大表</button>
                </div>
              </div>

              <!-- 提取质量指标卡片 (Quality Audit) -->
              <div id="ad-quality-card" style="display: none; margin-bottom: 6px; padding: 6px 8px; border-radius: 4px; background: var(--bg-tertiary); border: 1px solid var(--border-color); font-size: 9.5px; line-height: 1.4;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 3px;">
                  <span style="color: var(--text-heading);">解译质量诊断:</span>
                  <span id="ad-qc-badge" style="padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold;">--</span>
                </div>
                <div id="ad-qc-details" style="color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
                </div>
              </div>

              <div style="flex: 1; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: var(--bg-card);">
                <table id="ad-tbl-mapping" class="wpd-preview-table" style="width: 100%; font-size: 10px;">
                  <thead>
                    <tr>
                      <th style="width: 25%;">Depth</th>
                      <th style="width: 25%;">Age</th>
                      <th style="width: 32%;">95% CI</th>
                      <th style="width: 18%;" title="d(age)/d(depth)，由 1000 条集合成员求导得到的 95% 区间">Acc. rate</th>
                    </tr>
                  </thead>
                  <tbody id="ad-mapping-tbody">
                    <tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">尚未执行识别提取</td></tr>
                  </tbody>
                </table>
              </div>
              <div style="font-size: 9px; color: var(--text-muted); margin-top: 3px; line-height: 1.45;">
                单元格数值可直接修改，实时联动重绘底图。点击「展开大表」可增删行或复制/粘贴导入。
              </div>

              <!-- 速率口径：由用户勾选，工具只提供能从图中导出的量 -->
              <div style="margin-top: 6px; padding: 6px 8px; border-radius: 4px; background: var(--bg-card); border: 1px solid var(--border-light); font-size: 9.5px;">
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">导出速率列（随年代模型一并写入花粉数据集）:</div>
                <div style="display: flex; flex-direction: column; gap: 3px;">
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-rate-sr" checked />
                    <span title="逐点导数：曲线在该深度处的瞬时斜率取倒。反映局部变化，不带不确定度。">沉积速率：<code>sed_rate (cm/yr)</code>（逐点导数，无误差棒）</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-rate-ar" checked />
                    <span title="逐点导数：单位深度所代表的历时。反映局部变化，不带不确定度。">累积速率：<code>acc_rate (yr/cm)</code>（逐点导数，无误差棒）</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                    <input type="checkbox" id="ad-chk-rate-sr-win" />
                    <span title="固定深度厚度窗口内对 age~depth 做最小二乘，斜率取倒。地质平均量，带标准误。学术引用请用这一列。"><b>分窗沉积速率</b>：<code>sed_rate_windowed (cm/yr)</code> + <code>_se</code>（<b>带标准误，推荐</b>）</span>
                  </label>
                </div>
                <div style="font-size: 8.5px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                  「逐点导数」两列是曲线局部斜率，不带不确定度，且在保序回归压平段上为未定义（导出为空）。<br>
                  质量累积速率 (MAR, g/cm²/yr) 需乘干样容重 (dry bulk density)，本工具不推算未测定的物理量。
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================================================================= -->
        <!-- Tab 2: 年代-深度结果数据表与深度编辑 (Table Studio) -->
        <!-- ================================================================= -->
        <div id="ad-tab-panel-table" style="flex: 1; display: none; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; overflow: hidden;">
          <!-- 表格顶部工具栏 -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-tertiary); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 11px; font-weight: 700; color: var(--accent-blue); margin-right: 4px;">数据视图:</span>
              <button class="ui-btn ui-btn--quiet ui-btn--xs ad-table-view-btn active" id="ad-tbl-view-points" style="font-size: 10.5px; padding: 3px 8px;">① 年代深度图数值化点表 (三线控制点)</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs ad-table-view-btn" id="ad-tbl-view-samples" style="font-size: 10.5px; padding: 3px 8px;">② 花粉样品层位表 (共识层位)</button>
              <span style="border-left: 1px solid var(--border-color); height: 16px; margin: 0 4px;"></span>
              <select id="ad-tbl-points-filter" class="sample-select" style="font-size: 10.5px; padding: 2px 4px;">
                <option value="all" selected>全部线轨 (三条线)</option>
                <option value="curve">均值线 (Mean)</option>
                <option value="lower">95% 下界 (Lower)</option>
                <option value="upper">95% 上界 (Upper)</option>
              </select>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-tbl-btn-add-point" style="font-size: 10.5px; padding: 3px 8px; color: var(--accent-blue);">＋ 添加控制点</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-tbl-btn-add" style="font-size: 10.5px; padding: 3px 8px; color: var(--status-success); display: none;">添加层位</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-tbl-btn-sort" style="font-size: 10.5px; padding: 3px 8px;">按深度升序排序</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-tbl-btn-copy" style="font-size: 10.5px; padding: 3px 8px;">复制全部 (TSV)</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-tbl-btn-paste" style="font-size: 10.5px; padding: 3px 8px;">粘贴导入 (Excel/TSV)</button>
              <label style="display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--text-muted);"
                     title="只影响表格显示位数；数据本身、同步与导出仍是全精度原始值。悬停单元格可看原值。">
                浮点精度
                <select id="ad-tbl-fmt-digits" class="sample-select" style="font-size: 10.5px; padding: 2px 4px;">
                  <option value="">原始值</option>
                  <option value="0">0 位小数</option>
                  <option value="1">1 位小数</option>
                  <option value="2">2 位小数</option>
                  <option value="3" selected>3 位小数 (默认)</option>
                  <option value="4">4 位小数</option>
                  <option value="6">6 位小数</option>
                  <option value="8">8 位小数</option>
                </select>
              </label>
              <button class="ui-btn ui-btn--primary" id="ad-tbl-btn-sync" style="font-size: 10.5px; padding: 3px 12px;">保存同步至模型</button>
              <button class="ui-btn ui-btn--secondary" id="btn-ad-writeback-samples" style="font-size: 10.5px; padding: 3px 10px; color: var(--status-success); border-color: rgba(16,185,129,0.3);" title="将当前估算年代与 95% 置信区间直接回写至 Step 7 的花粉采样层位">回写至采样层位 (Step 7)</button>
            </div>
            <div id="ad-table-summary-badge" style="font-size: 10.5px; font-family: var(--font-mono); color: var(--text-secondary);">
              共 0 个层位
            </div>
          </div>

          <!-- 数据表格容器 -->
          <div style="flex: 1; min-height: 200px; overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-card);">
            <table id="ad-tbl-full" class="wpd-preview-table ad-full-table" style="width: 100%;">
              <thead>
                <tr>
                  <th style="width: 75px; text-align: center;" id="ad-tbl-th-id">共识层位 ID</th>
                  <th class="ad-th-sortable" data-sort="age" style="width: 120px; cursor: pointer;" title="点击按年代排序">age (<span class="ad-th-unit-age">cal yrBP</span>) <span class="ad-sort-ind"></span></th>
                  <th class="ad-th-sortable" data-sort="depth" style="width: 110px; cursor: pointer;" title="点击按深度排序">depth (<span class="ad-th-unit-depth">cm</span>) <span class="ad-sort-ind"></span></th>
                  <th class="ad-th-sortable" data-sort="upper" style="width: 110px; cursor: pointer;" title="点击按 95% 上界排序">age_upper <span class="ad-sort-ind"></span></th>
                  <th class="ad-th-sortable" data-sort="lower" style="width: 110px; cursor: pointer;" title="点击按 95% 下界排序">age_lower <span class="ad-sort-ind"></span></th>
                  <th style="width: 115px;">accrate_cmyr (<span class="ad-th-unit-rate">cm/yr</span>)</th>
                  <th style="width: 115px;">accrate_cmyr_upper</th>
                  <th style="width: 115px;">accrate_cmyr_lower</th>
                  <th style="width: 50px; text-align: center;">操作</th>
                </tr>
              </thead>
              <tbody id="ad-full-table-tbody">
                <tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">尚未执行识别提取或载入年代模型</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 简易沉积速率 (Sedimentation Rate) 曲线折叠区 -->
          <div id="ad-sedrate-panel" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 11px; color: var(--accent-blue);" id="ad-sedrate-title">沉积速率剖面 (Sedimentation Rate Profile)</strong>
                <div class="ad-sedrate-axis-toggle" style="display: inline-flex; align-items: center; gap: 2px; background: var(--bg-card); padding: 1px; border: 1px solid var(--border-color); border-radius: 4px;">
                  <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-sedrate-axis active" data-axis="age" style="font-size: 10px; padding: 1px 6px; border-radius: 3px;" title="X 轴以年代 (Age) 展开">X: 年代 (Age)</button>
                  <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-sedrate-axis" data-axis="depth" style="font-size: 10px; padding: 1px 6px; border-radius: 3px;" title="X 轴以深度 (Depth) 展开">X: 深度 (Depth)</button>
                </div>
                <!-- 变量选择下拉框，用于计算通量 Influx = acc * Concentration -->
                <div style="display: inline-flex; align-items: center; gap: 3px; font-size: 10px;">
                  <span style="color: var(--text-muted);">变量:</span>
                  <select id="ad-sel-sedrate-var" class="ui-select ui-select--xs" style="font-size: 10px; height: 20px; padding: 0 4px; border-radius: 3px; max-width: 140px;" title="选择要与沉积速率相乘的变量（如浓度列计算沉积通量 Influx）">
                    <option value="">纯速率 (accrate)</option>
                  </select>
                </div>
              </div>
              <span id="ad-sedrate-meta" style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">—</span>
            </div>
            <div style="height: 110px; width: 100%; position: relative; background: var(--bg-card); border-radius: 4px; overflow: hidden; border: 1px solid var(--border-light);">
              <canvas id="ad-sedrate-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--text-muted);">
            <span>提示：所有数值支持就地直接点击修改；修改年代将实时联动更新左侧图谱画布与 95% 置信带。深层比浅层年龄小处会自动标红提示倒置。</span>
            <span id="ad-table-sync-status" style="color: var(--status-success); font-weight: 600;"></span>
          </div>
        </div>

        <!-- ================================================================= -->
        <!-- Tab 3: 测年数据与 Bacon / geoChronR 向导 (Dating & Downstream) -->
        <!-- ================================================================= -->
        <div id="ad-tab-panel-modeling" style="flex: 1; display: none; gap: 16px; min-width: 0; min-height: 0; overflow-y: auto;">
          <!-- 左半边: 测年数据表格 (支持从 Excel 粘贴) -->
          <div style="flex: 1.2; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-light);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="font-size: 12px; color: var(--accent-blue);">1. 钻孔实测年代数据表 (Radiocarbon / Dating Table)</strong>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-ad-paste-dates" style="font-size: 10.5px; color: var(--status-success); border-color: rgba(16,185,129,0.3);">
                从 Excel 粘贴测年序列 (Ctrl+V)
              </button>
            </div>

            <div style="flex: 1; min-height: 240px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; background: var(--bg-card);">
              <table class="wpd-preview-table" style="width: 100%; font-size: 11px;">
                <thead>
                  <tr>
                    <th style="width: 70px;">测年ID</th>
                    <th style="width: 65px;">深度 (cm)</th>
                    <th style="width: 75px;">¹⁴C 年龄 (BP)</th>
                    <th style="width: 55px;">误差 (±1σ)</th>
                    <th style="width: 55px;">厚度 (cm)</th>
                    <th style="width: 75px;">校正曲线</th>
                    <th style="width: 38px; text-align: center;">操作</th>
                  </tr>
                </thead>
                <tbody id="ad-dating-tbody"></tbody>
              </table>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; color: var(--text-muted);">
              <span>* 支持 ¹⁴C、²¹⁰Pb、OSL 等多种年代类型；校正曲线 1=IntCal20, 2=Marine20, 0=非¹⁴C。</span>
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-ad-add-date-row" style="padding: 2px 8px; font-size: 10px;">加一行</button>
            </div>
          </div>

          <!-- 右半边: 复杂地质现象与 Bacon / geoChronR 参数设定 -->
          <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; background: var(--bg-tertiary); padding: 14px; border-radius: 6px; border: 1px solid var(--border-light); overflow-y: auto;">
            <strong style="font-size: 12px; color: var(--accent-amber);">2. 复杂地质事件与先验约束 (Blaauw 2011)</strong>

            <!-- 沉积间断 (Hiatus) -->
            <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <input type="checkbox" id="ad-chk-hiatus" />
                <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">存在沉积间断 / 不整合面 (Hiatus)</span>
              </label>
              <div id="ad-hiatus-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1;">
                    <span>间断深度 (cm):</span>
                    <input type="text" id="ad-inp-hiatus-depth" placeholder="如 45.0" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div style="flex: 1;">
                    <span>最大间断年限 (yr):</span>
                    <input type="number" id="ad-inp-hiatus-max" value="10000" style="width: 100%; font-size: 11px;" />
                  </div>
                </div>
                <span style="font-size: 9.5px; color: var(--text-secondary); display: block; margin-top: 2px;">说明：间断处将切断累积速率的连续自回归记忆。</span>
              </div>
            </div>

            <!-- 瞬时沉积层 (Slump / Tephra 火山灰 / 洪水层) -->
            <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <input type="checkbox" id="ad-chk-slump" />
                <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">瞬时沉积层 (Slump / 火山灰 / 洪水层)</span>
              </label>
              <div id="ad-slump-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1;">
                    <span>事件顶界 (cm):</span>
                    <input type="text" id="ad-inp-slump-top" placeholder="如 70.0" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div style="flex: 1;">
                    <span>事件底界 (cm):</span>
                    <input type="text" id="ad-inp-slump-bottom" placeholder="如 75.0" style="width: 100%; font-size: 11px;" />
                  </div>
                </div>
                <span style="font-size: 9.5px; color: var(--text-secondary); display: block; margin-top: 2px;">说明：该层段厚度将在年代累积模型中自动扣除（历时为 0 年）。</span>
              </div>
            </div>

            <!-- 碳储库效应校正 (Delta R) -->
            <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                <input type="checkbox" id="ad-chk-dr" />
                <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">碳储库效应 / 硬水效应校正 (ΔR)</span>
              </label>
              <div id="ad-dr-box" style="display: none; margin-top: 6px; font-size: 10.5px; color: var(--text-muted);">
                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1;">
                    <span>ΔR 偏移量 (yr):</span>
                    <input type="number" id="ad-inp-dr-val" value="150" style="width: 100%; font-size: 11px;" />
                  </div>
                  <div style="flex: 1;">
                    <span>误差 (±yr):</span>
                    <input type="number" id="ad-inp-dr-std" value="30" style="width: 100%; font-size: 11px;" />
                  </div>
                </div>
              </div>
            </div>

            <!-- 分段厚度与先验 -->
            <div class="form-group" style="margin: 0; font-size: 10.5px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="color: var(--text-muted);">分段厚度 (thick):</span>
                <span id="ad-val-thick" style="color: var(--accent-blue); font-weight: 700;">5 cm</span>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-thick" data-thick="2" style="flex: 1; font-size: 10px;">2 cm (高密)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-thick active" data-thick="5" style="flex: 1; font-size: 10px; border-color: var(--accent-blue);">5 cm (标准)</button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-thick" data-thick="10" style="flex: 1; font-size: 10px;">10 cm (长孔)</button>
              </div>
            </div>

            <!-- WebR 增量扩展包状态管理 -->
            <div class="form-group" style="margin: 0; background: var(--bg-card); padding: 8px; border-radius: 4px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 10.5px; font-weight: 600; color: var(--accent-blue);">WebR 浏览器纯内置算力包:</span>
                <span id="ad-webr-comp-status" style="font-size: 9.5px; color: var(--status-warning);">检查中...</span>
              </div>
              <div id="ad-webr-install-bar" style="display: flex; gap: 6px; margin-top: 5px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-ad-install-webr" style="flex: 1; font-size: 10px; color: var(--accent-blue); border-color: rgba(56,189,248,0.3);">
                  下载组件 (~40 MB)
                </button>
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-ad-import-webr-zip" style="font-size: 10px; padding: 2px 6px;" title="离线环境手动导入已下载的 age-modeling.zip">
                  离线导入
                </button>
                <input type="file" id="inp-ad-webr-zip" accept=".zip" style="display: none;" />
              </div>
              <div id="ad-webr-progress-box" style="display: none; margin-top: 4px;">
                <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                  <div id="ad-webr-progress-fill" style="width: 0%; height: 100%; background: var(--accent-blue); transition: width 0.2s;"></div>
                </div>
                <span id="ad-webr-progress-txt" style="font-size: 9px; color: var(--text-muted); display: block; margin-top: 2px;">准备下载...</span>
              </div>
            </div>

            <!-- 下游执行通道 -->
            <div style="margin-top: auto; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 10px;">
              <div id="ad-local-r-status" class="ui-status">
                正在检测本机 R 环境…
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="ui-btn ui-btn--primary ui-btn--sm" id="btn-ad-run-local-r" style="flex: 1.3;" title="调用本机 R + rbacon 运行年龄建模">
                  运行年龄建模（本机 R）
                </button>
                <button class="ui-btn ui-btn--secondary ui-btn--sm" id="btn-ad-export-geochronr" style="flex: 1;" title="生成绑定当前数据集的 geoChronR 驱动代码">
                  geoChronR 脚本
                </button>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 4px;">
                <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-ad-export-bacon-pkg" style="flex: 1; font-size: 10.5px; padding: 4px;" title="导出符合 rbacon 规范的标准工程目录 Cores/<core>/<core>.csv 与 R 驱动脚本 (ZIP 压缩包)">
                  导出 Bacon 标准工程包 (.zip)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ui-modal__footer">
        <div class="ad-footer-hint">
          确认拟合结果后应用，为当前花粉图谱赋予年代轴与 95% 置信带。
        </div>
        <div class="ad-footer-actions">
          <button class="ui-btn ui-btn--secondary" id="ad-btn-cancel">取消</button>
          <button class="ui-btn ui-btn--primary" id="ad-btn-apply">
            应用年代模型
          </button>
        </div>
      </div>

      <!-- 粘贴导入弹窗 -->
      <div id="ad-paste-data-modal" style="display: none; position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.65); align-items: center; justify-content: center; backdrop-filter: blur(4px);">
        <div style="width: 500px; background: var(--bg-card); padding: 18px; border-radius: 8px; border: 1px solid var(--border-color); box-shadow: 0 16px 36px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin: 0; font-size: 13px; font-weight: 700; color: var(--text-heading);">粘贴导入年代-深度数据表</h4>
            <button id="ad-paste-cancel-x" class="modal-close" style="background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer;">×</button>
          </div>
          <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.5;">
            支持从 Excel、Origin 或纯文本直接复制多行数据（制表符 Tab 或逗号分隔）：<br>
            • 2 列格式：<code>深度(Depth) [Tab] 年代(Age)</code><br>
            • 4 列格式：<code>深度 [Tab] 年代 [Tab] 95%下界 [Tab] 95%上界</code>
          </p>
          <textarea id="ad-paste-data-textarea" placeholder="例如：&#10;0&#9;50&#9;20&#9;90&#10;10&#9;180&#9;130&#9;230&#10;20&#9;350&#9;290&#9;410" style="width: 100%; height: 160px; font-family: var(--font-mono); font-size: 11px; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; padding: 8px; box-sizing: border-box; resize: vertical;"></textarea>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <label style="font-size: 11px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="ad-paste-replace-mode" checked />
              <span>覆盖替换现有全部数据 (取消则追加)</span>
            </label>
            <div style="display: flex; gap: 8px;">
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="ad-paste-cancel-btn">取消</button>
              <button class="ui-btn ui-btn--primary" id="ad-paste-confirm-btn" style="padding: 4px 14px; font-size: 11.5px;">确认导入</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
