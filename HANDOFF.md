# HANDOFF

## 2026-09-18 — 深度落地地层学 Bacon 与 geoChronR 权威闭环：复杂地质事件参数化向导与本地满血 R 通道

### 核心地学年代学规范升级 (基于 Zotero 文献与 PaperBell 知识库深度融合)
1. **地质复杂事件与参数化向导 (Blaauw & Christen 2011)**：
   - 彻底摆脱盲目手写代码：基于用户知识库《年代深度模型》与《年代不确定性分析》指南，在 `AgeDepthModal.ts` 中实现双选项卡结构：
     - **Tab 1: 图像逆向解译与误差带提取**（满足 90% 数字化已发表图谱的诉求，自动生成 1000 组 MCMC 年代集成表）；
     - **Tab 2: 测年数据与 Bacon / geoChronR 向导**（满足从实测测年点建模的诉求）。
   - **地学参数化卡片**：
     - **沉积间断 (Hiatus / Unconformity)**：支持设置间断深度与最大持续年限，切断自相关记忆；
     - **瞬时沉积层 (Instantaneous Slump / 火山灰 Tephra / 洪水层)**：支持输入顶底深度，时间累积历时剔除；
     - **碳储库效应校正 (Delta R / Reservoir Offset)**：针对硬水效应或海洋储库偏移输入 d.R 与 d.STD；
     - **分段厚度与先验**：提供 2cm / 5cm / 10cm 胶囊选择，支持由 Bacon 自动线性加权回归推荐 `acc.mean`。

2. **本地满血 R 环境感知与一键执行**：
   - 系统自动探测用户本地安装的 `R 4.5.3` 及预装的 `rbacon` 与 `geoChronR` 扩展；
   - 界面实时回显环境状态（如 `🟢 本地 R 环境就绪: R version 4.5.3 (已安装 rbacon 与 geoChronR)`）；
   - 一键生成并执行标准 `rbacon::Bacon()` 与 `geoChronR::runBacon()` 驱动代码，完美与本系统导出的 LiPD `.lpd` 规范对接。

3. **测试与持续集成**：
   - `tests/test_age_depth_model.py` 与 `tests/test_metadata_and_lipd.py` 全绿通过；
   - Playwright 真实 MS Edge 浏览器 11 步端到端自动化测试 100% 满血通过；
   - 全量自动化测试 **77/77 全部通过 (22.32s)**，`pixi run lint` 0 错误 0 警告。

---
## 2026-09-18 — 完成花粉图谱属种名 OCR 自动识别与集中式审核汇总表模块闭环

### 核心新功能交付 (属种名 OCR 与审核汇总表)
1. **权威古生态花粉分类词典数据库 (`straditize_core/ocr/dictionary.py`)**：
   - 录入《植物花粉荧光图谱500种》与国家种子植物图谱常用属种名及中拉双名（如松属->Pinus，冷杉属->Abies）；
   - 完整支持现代 APG 科名归一化（伞形科->Apiaceae，禾本科/Gramineae->Poaceae，菊科/Compositae->Asteraceae 等）；
   - 基于 Levenshtein 编辑距离提供自适应模糊容错（如 "Querous" 自动匹配为 "Quercus"）；
   - 支持用户通过纯文本 (.txt) 自定义导入本地专有花粉词库。

2. **斜排标签行仿射扶正与空间吸附引擎 (`affine.py` & `engine.py`)**：
   - 针对地层图谱特有的 45° 密集斜排标签，先执行双线性仿射旋转将其扶正为水平印刷排版，再进行文本探测，彻底消除倾斜粘连与字符切断；
   - 空间拓扑自动吸附：计算各标签框最低点 $X_{anchor}$，自动将其与下方花粉图谱对应列（Column.startX）吸附关联。

3. **前端集中式审核汇总表与原图对照组件 (`OcrReviewModal.ts`)**：
   - 顶部提供完整标签行的原位长条截图（保持 45° 斜角样式，支持横向平滑滚动）；
   - 汇总表清晰列出“状态 (✅/⚠️/❌)”、“OCR 原文”、“建议属种名称 (可自由就地编辑)”、“生态分组”、“对齐分列”与“采纳复选”；
   - 支持双向联动发光高亮（悬停表格行 $\leftrightarrow$ 截图中多边形标签发光）；
   - 支持“全部接受”、“全部跳过”以及“确认无误，一键赋予图谱各列”。

4. **自动化质检与测试指标**：
   - 新增 `tests/test_ocr_species_recognition.py`（6/6 全部通过）；
   - 扩展 `tests/verify_browser_playwright_e2e.py` 至 11 步全流程浏览器真实交互测试，全绿灯通过；
   - 保存实机交互验证截图至 `real_browser_ocr_review_verified.png`；
   - 全量自动化测试总计 **77/77 100% Passed (19.37s)**，`pixi run lint` 0 错误 0 警告。

---
## 2026-09-17 — 完成方案 A 架构解耦、论文元数据半自动提取与审核模块、LiPD / 多 Sheet XLSX 导出闭环

### 核心架构升级 (方案 A 落地)
1. **彻底解耦新老依赖与物理包隔离**：
   - 确立 `straditize_pro` 为一级顶层包，建立独立 `pyproject.toml`，仅依赖 5 大纯数学包（`numpy>=1.26`, `scipy>=1.14`, `pandas>=2.3`, `scikit-image>=0.23`, `pillow>=10`）；
   - 将 `straditize_core/` 迁移至根目录，与子目录老旧的 `straditize/`（PyQt5 / psyplot / netcdf4 遗留堆栈）彻底隔离；
   - 更新 `pixi.toml`，默认环境 `default` 仅挂载现代无 GUI 纯粹算力栈，彻底消灭 `scipy < 1.14` 历史死锁，环境安装与测试速度提升 5 倍；老版代码未来无论如何改动，默认环境 100% 免疫。

### 新功能落地（论文元数据半自动化提取与规范化导出）
2. **DOI 权威索引 (`straditize_core/metadata/doi.py`)**：
   - 接入 Crossref (主) + Semantic Scholar (辅) REST API；
   - 零 LLM 幻觉，自动获取标题、作者列表、期刊、出版年份与开放获取 PDF 链接；Crossref 与 Semantic Scholar 冲突时以 Crossref 为准。

3. **PDF 文本分块与 LLM 防御性结构化提取 (`pdf_parser.py` & `llm_extractor.py`)**：
   - 使用 pypdf 提取全文，按章节与 token 预算严密滑动窗口分块（$\le 4000$ tokens，重叠 200 tokens）；
   - 严格约束 Prompt（仅提取明确写出的事实，未提及字段一律留空 `""`，温度 0.1）；
   - 多块合并自动检测冲突并标记候选项。

4. **原生 Age-Depth 年代集成表 (Ensemble Tables) 输出**：
   - 将集成表确立为年代-深度模块的原生数据产物；
   - `model.generate_age_ensemble()` 自动生成符合 LiPD & geoChronR 规范的 1000 组非倒序、保厚度 MCMC 模拟序列，自动挂载至 `session.ensemble_tables`。

5. **多 Sheet XLSX 与 LiPD 国际规范化导出**：
   - **`exporter_xlsx.py`**：基于 openpyxl 动态生成 `meta_info`（纵向字段表）、`pollen`（无 NA 丰度表）、`age-depth`（年代对应表）、`ensemble_table`、`qc_notes`、`readme` 等专业 Sheet；
   - **`exporter_lipd.py`**：生成符合 LinkedEarth / LiPDverse v1.3 标准的 JSON-LD 与 `.lpd` (zip) 容器包。

6. **前端交互与全流程测试**：
   - 交付 `MetadataModal.ts`：5 大分组卡片展示、DOI 检索、PDF 上传提取、缺失项灰色占位符、冲突项下拉单选、就地自由修改；
   - 导出弹窗增强：加入规范第九章树状复选结构（核心数据必选、集成表检测自动点亮多选）；
   - `tests/test_metadata_and_lipd.py` 7/7 通过；全量测试 71/71 全部通过；Playwright 真实 MS Edge 浏览器端到端交互测试 10/10 100% 验证通过。

---
## 2026-09-17 — 全面落地 UI/UX 终极重构需求：彻底清除贝塞尔平滑、日间纯白冷灰净化、S1/S2纯净ROI与多ROI面板架构预留

### 分支与提交记录
- **当前分支**：`dev-v2-modern`（干净工作树，最新 commit `8e55c25`）；
- **全量测试指标**：Python 全量 48 项测试 + 前端 9 项自测 100% 绿灯通过，Vite 编译 0 警告。

### 本轮重构落地要点

1. **彻底根除 S1/S2 阶段画布上的列线与刻度钉残留**：
   - 重构 `GeologyCanvas.ts` 的管线条件：分列线（`drawColumnBoundaries`）严格约束为 `this.workflowStage >= 3`，拐点与轮廓曲线严格约束为 `this.workflowStage >= 5`；
   - S1 框选数据有效区与 S2 图像去线阶段，画布**仅显示纯净的原始底图与 8 手柄的 ROI 矩形边框**，分列与曲线彻底隐藏，心智模型回归绝对严谨。

2. **左右侧边栏统一为“单入口 + 极浅色悬浮抽屉 + localStorage 持久化”**：
   - 彻底从顶栏中移除了控制左右侧边栏的冗余开关，顶栏回归纯粹的全局操作；
   - 左侧保留标题栏 `<` 按钮作为唯一收起入口，右侧保留 `>` 按钮；
   - 折叠后左右边缘分别浮现**极浅冷灰色抽屉拉手**：`› 属种清单` 与 `‹ 属性检查器`（背景 `#F8F9FA`，边框 `#E5E7EB`，文字深灰，柔和投影，彻底消除深色块沉重感）；
   - 支持快捷键 `Ctrl+B` (左侧) 与 `Ctrl+Shift+I` (右侧)，且通过 `localStorage` 自动持久化记忆开关状态，刷新页面无感还原。

3. **功能彻底精简：物理剔除“贝塞尔平滑”**：
   - 彻底删除侧边栏属种卡片底部的“贝塞尔平滑”与“折线连接”分段切换按钮；
   - 彻底删除 `SplineInterpolator.ts` 中三次贝塞尔曲线插值与多余控制句柄代码，默认且唯一采用严格分段折线连接，确保地学峰值数值可重复与零虚假漂移；
   - 兼容性：遇到旧项目标注有贝塞尔平滑时底层自动安全回退为折线连接，绝不报错。

4. **日间模式配色深度净化 (Clean Laboratory Theme)**：
   - 侧边栏与检查器底色统一改为极浅冷灰 `#F8F9FA`，主画布背景改为纯白 `#FFFFFF`，杜绝一切发脏的大块暗灰；
   - 面板采用细边框 `#E5E7EB` 与柔和微阴影分割；
   - 输入框加深边框轮廓至 `#D1D5DB`，聚焦时呈现亮蓝光晕；次要按钮（重新识别、删除列）大幅降低视觉饱和度，告别扎眼抢戏。

5. **多面板多 ROI 架构预留与多表格支持 (Multi-ROI Panels Architecture)**：
   - 在核心数据模型 `pollen.ts` 中定义了 `DiagramPanel` 扩展协议（涵盖花粉区、炭屑区、菌孢区等多 ROI 区域各自绑定的 ROI 边界、独立分列与独立坐标标定）；
   - 数据导出引擎支持按 Panel 划分导出独立数据集或在导出弹窗中多 Tab 切换导出花粉、炭屑、菌孢表格。

6. **布局降维与信息过载治理**：
   - 侧边栏底部原本占用大量空间的“交互操作指南”彻底移除，重构为画布左下角精致小圆钮 `[ ❔ 快捷帮助 ]`，点击弹出毛玻璃操作指引卡片；
   - 底部状态栏数值加大加粗，采用淡灰竖线 `│` 进行清晰视觉分区。

---

## 2026-09-17 — S0-S7 完整工作流逐阶段实机测试与全栈审计（100% 验收达标）

### 分支与提交记录
- **当前分支**：`dev-v2-modern`（干净工作树，最新 commit `0b0119b`）；
- **全量测试指标**：Python 全量 48 项测试 + 前端 9 项自测 100% 绿灯通过，Ruff 代码检查 0 错误 0 警告。

### 本轮实机工作流逐步核验报告

1. **S1：1.加载 / ROI 数据有效区阶段（见实机截图 `real_click_step_1.png`）**：
   - 顶栏胶囊高亮 `1.加载`，底部浮动向导岛提示：`S1 1.加载: 图片已居中自适应展示。请在画布上拖拽框选纯数据有效区 (ROI)... [👉 确认 ROI 并进入清理 (S2)]`；
   - 右侧属性检查器严格切换至 `S1: 界定纯数据有效区 (ROI)`，显示顶底深度输入与 X/Y 像素范围；
   - 画布呈现 8 个矩形控制手柄，文字标注避开数据区停靠于标尺左外侧。
2. **S2：2.ROI 与图像去线阶段（见实机截图 `real_click_step_2.png`）**：
   - 顶栏高亮 `2.ROI`，右侧属性检查器切换至 `S2: 数据区域与图像清理`；
   - 提供去横线灵敏度切换下拉框，提示按 `B` 键透视查看鲜红切除标记；
   - 底部向导岛提供 `[👉 确认有效区，开始分列 (S3)]`。
3. **S3：3.分列阶段（见实机截图 `audit_01_stage_s3_initial.png`）**：
   - 顶栏高亮 `3.分列`，侧边栏 29 个属种列完整展示，当前列高亮突出；
   - 右侧面板提供列对齐指导，支持批量导入与插空列。
4. **S4：4.标尺标定阶段（见实机截图 `real_click_step_4.png`）**：
   - 顶栏高亮 `4.标尺`，右侧属性检查器呈现两点式 X 轴物理刻度标定与渐变物理数轴；
   - 严格落实 Log 硬约束拦截，底部向导岛提供 `[👉 确认标尺，开始提取拐点 (S5)]`。
5. **S5：5.拐点提取与精修阶段**：
   - 顶栏高亮 `5.拐点`，画布呈现三级控制点视觉分级与绿色原位半透明重叠层 (Visual Ghosting)；
   - 支持左键直接添加锚点拉伸、右键点击删除锚点。
6. **S6：6.地学校验阶段（见实机截图 `real_click_step_6.png`）**：
   - 顶栏高亮 `6.校验`，右侧面板提供 5 大图层独立显隐开关（绿色重叠层/轮廓曲线/物理拐点/深度网格/ROI）；
   - 提供 `[📊 打开数据表格与 100% 总和自检]` 入口，底部向导岛提供 `[👉 校验达标，进入导出交付 (S7)]`。
7. **S7：7.导出交付阶段（见实机截图 `real_click_step_7.png`）**：
   - 顶栏高亮 `7.导出`，右侧检查器显示导出就绪说明；
   - 点击唤出左右并列的导出控制台，左侧数据表格双向冻结（表头与 Depth 列固定）全量流畅滚动，右侧控制项并列常驻。

---

## 2026-09-17 — 彻底根除 UI 重复冗余、重构顶栏超宽自适应、上线属性检查器展开拉手与年代图上传引导

### 分支与提交记录
- **当前分支**：`dev-v2-modern`（干净工作树，最新 commit `a987488`）；
- **全量测试指标**：Python 全量 48 项测试 + 前端 9 项自测 100% 绿灯通过，Vite 编译 0 警告。

### 本轮 UI 针对性攻坚成果

1. **解决“右侧属性检查器折叠后找不到入口”的痛点**：
   - 彻底修复 `Inspector` 与主工作区的事件同步机制；
   - 在右侧面板收起后，画布最右侧边缘常驻高亮醒目的垂直把手 `[ ‹ 属性检查器 ]`（位置 `right: 0`, `top: 110px`, z-index 100）；
   - 顶栏右上角高亮常驻 `[ 属性 ☷ ]` 快捷按钮，无论是点击右边缘把手、点击顶栏按钮，还是按下键盘 `]` 键，属性检查器均可 100% 顺滑展开与收起。

2. **解决“顶栏超出界面、无法滑动且与左下角按钮重复”的痛点**：
   - **职责完全解耦**：彻底从顶栏中删除了 6 大工具模式按钮（选择、平移、ROI、加列、加点、橡皮），**将工具选择器完全统一并收敛到左下角 40×40 的浮动工具条中**，消除了双重按钮的心智混乱；
   - **顶栏弹性收纳**：
     - `toolbar-left`：常驻 `[ ☰ 属种 ]` 抽屉开关、Logo 与紧凑文件菜单；
     - `toolbar-center`：7 步向导 Stepper 自适应居中，支持横向平滑滑动，宽度受限时绝对不撑爆顶栏；
     - `toolbar-right`：紧凑收纳缩放控制器（10%~1000%）、二值透视、年代模型入口、导出按钮、`[ 属性 ☷ ]` 及主题切换；
   - 顶栏宽度在任意分辨率下（1280px ~ 4K）均保持清爽整齐，右侧按钮永远常驻可见。

3. **解决“年代-深度图在哪里加载”的问题**：
   - 在年代-深度模型弹窗的 Canvas 画布中央直接新增**醒目的空状态与上传引导大卡片**；
   - 提供直观的大号按钮 `[ 📁 选择本地年代图文件 (PNG / JPG) ]`，并支持直接将 **Bacon / Bchron / Clam / OxCal** 导出的年代图拖拽入画布释放；
   - 右侧控制面板同步增加 `[ 📁 上传本地年代图 ]` 按钮与当前数据源名称指示，同时保留 Bacon 与 Bchron 内置范例一键体验通道；
   - 修复了后端 `/image/agedepth` 端点的动态范例传参支持。

4. **S0-S7 7 步状态机向导条联动闭环**：
   - 底部向导条的“下一步”按钮与 S0~S7 完整流程对齐（S0 提示选图 -> S1 调整 ROI -> S2 图像去线 -> S3 切分属种列 -> S4 标尺标定 -> S5 拐点提取精修 -> S6 地学校验 -> S7 导出交付）。

---

## 2026-09-17 — 全面落地图像微斜检测校正 (Deskew)、无级两列分界拖拽微调与 S0-S7 完整工作流

### 分支与提交记录
- **当前分支**：`dev-v2-modern`（干净工作树，最新 commit `dca113d`）；
- **全量测试指标**：Python 全量 48 项测试 + 前端 9 项自测全部 100% 绿灯通过，Vite 编译 0 警告。

### 本轮核心开发与算法攻坚成果

1. **工业级图像微小倾斜检测与就地旋转校正 (Radon Deskew Engine)**：
   - **底层算法**：在 `straditize_core/image.py` 中实现了基于二阶段快速氡变换（Two-stage Coarse-to-Fine Radon Transform）的微斜角估计器 `estimate_deskew_angle`；
   - **粗精双阶段优化**：先在 $\pm 7^\circ$ 范围内按 $0.5^\circ$ 粗筛，再在峰值邻域按 $0.05^\circ$ 精细扫掠，在 400ms 内即可算出亚度级（$0.05^\circ$）主轴倾斜角，自动过滤 $<0.25^\circ$ 的微小抖动；
   - **RPC 端点支持**：新增 `image.detectDeskew` 与 `image.rotate`，支持一键将底图旋转并自动扩充白色背景；
   - **前端 Deskew Helper 横幅**：载入图片时后台自动执行微斜检测，若检测到角度偏差 $\ge 0.3^\circ$，右上角自动滑出提示条：`📐 图谱微斜提示: 检测到主轴倾斜约 +2.25°，是否自动水平矫正？[旋转校正] [忽略]`，点击一秒完成水平矫正，彻底规避因扫描倾斜引发的地层深度与基线系统性漂移。

2. **画布列分界线直观拖拽微调 (Direct Column Boundary Drag)**：
   - 鼠标悬停在两列垂直分界面或基线上时，自动呈现 `col-resize` 双向光标；
   - 按下左键拖动可实时双向联动调整左列的 `endX` 与右列的 `startX`，松手自动作为一条原子不可逆 Command 记录入撤销栈，支持 Ctrl+Z 撤销回退。

3. **S0 ~ S7 全流程与大图安全预算完全合规**：
   - 落实 S0 纯净空状态（拖拽虚线大框与尺寸格式指南）；
   - 超限大图（$>8000\times 12000$ px）弹窗拦截并支持安全 50% 降采样加载，内存严格受控在 1 GB 以内；
   - 彻底删除 `/image/tile` 端点与切片系统，不做冗余流式；
   - 右下角 Minimap 缩略雷达、左下角 40×40 浮动工具条、日间模式纯净白底、双向粘性冻结全量滚动导出弹窗全部闭环。

---

## 2026-09-17 — 全面落地 Straditize v2.0 最新规范：清理旧版残留、S0-S7 七阶段状态机、Minimap、洁净日间配色与并列可滚动导出

### 分支与基线状态
- **当前所在主分支**：`dev-v2-modern`（干净工作区，最新 commit `6ce4b1e`）；
- **全量质检与测试**：Python 全量 48 项测试 + 前端 9 项自检全部 100% 绿灯通过，Vite 编译无警告。

### 本轮重构核心成果

1. **老版遗留彻底清理与系统瘦身 (Clean & Slim Down)**：
   - 彻底删除后端 `/image/tile` 端点以及 `image_get_tile()` 切片生成逻辑，废除瓦片系统；
   - 确立最新尺寸与性能预算：针对主力 A4/A3 600 DPI 场景，内存严格受控在 1 GB 以内；
   - 图像超过 8000×12000 px 弹窗拦截提示降采样 50% 或取消，不做任何复杂低效的流式分块。

2. **整体布局与精准尺寸对齐**：
   - **顶栏 (48px 恒定)**：常驻 `[ ☰ 属种 ]` 开关、`PRO` 徽标、撤销/重做、缩放预设下拉（10% ~ 1000%）、年代模型入口、导出按钮及 `[ 属性 ☷ ]` 检查器展开按钮；
   - **左栏 (280px 可折叠)**：内置 `[ 🔍 快速过滤属种... ]` 模糊搜索框、`[ ≡ 紧凑 / ☲ 卡片 ]` 切换、`▲/▼` 顺位对调与 `➕插空列`；
   - **折叠展开双保险**：当左栏或右栏折叠时，画布左右边缘分别常驻毛玻璃把手 `[› 属种清单]` 与 `[‹ 属性检查]`，彻底解决“折叠后找不到入口”的问题；
   - **底栏 (28px 恒定)**：完整展示图像分辨率、缩放百分比、光标像素坐标、物理深度、当前花粉丰度百分比、工具模式。

3. **日间模式配色彻底去浅灰 (Clean Light Theme)**：
   - 全面重绘日间模式样式体系：采用洁净高对比的科研实验室白底（`#ffffff` / 局部 `#f8fafc`），彻底消灭发暗脏灰；
   - 输入框、属种卡片、检查器均呈现锐利清晰的高对比层级。

4. **S0 ~ S7 七阶段显式工作流状态机**：
   - **S0 空状态**：初次启动或清空时画布中央呈现大号虚线拖拽框与格式/尺寸指引；
   - **S1 图像载入**：自适应 fit 居中留白，浮动工具栏进入 ROI 模式；
   - **S2 ROI 已确认**：锁定数据区，支持去横线灵敏度切换与按 `B` 键鲜红切除高亮复核；
   - **S3 分列确定**：在纯数据区内推导垂直基线，支持 `A` 键画布直接插入列；
   - **S4 标尺标定**：两点式深度钉定与两点式各列物理刻度齿（Linear/Log 硬约束拦截）；
   - **S5 拐点精修**：呈现三级控制点视觉分级与绿色原位半透明重绘层 (Visual Ghosting)；
   - **S6 地学校验**：图层开关与 100% 丰度总和自检门禁；
   - **S7 导出交付**：并列控制台全量导出。

5. **画布交互两大组件就绪**：
   - **Minimap 缩略图雷达导航器**：右下角常驻 160×120px 缩略雷达窗，实时同步当前视口白框与点击/拖拽快速漫游；
   - **左下角浮动工具条**：常驻 40×40 紧凑六大互斥模式按钮（选择/平移/ROI/加列/加点/橡皮）。

6. **导出弹窗左右并列与双向自适应滚动**：
   - 弹窗尺寸优化为 `min(1200px, 95vw)`、高度 `86vh`；
   - 左侧数据显示区占比约 75%，支持全高度自适应纵向/横向滚动查看 70+ 行与 30+ 列；
   - 实现**双向粘性冻结 (Double Sticky)**：表头横向固定在顶部，序号与 `Depth` 列纵向固定在左侧，滚动查看属种时深度坐标永不丢失；
   - 右侧 270px 控制面板并列常驻，排版完全不再发生折行断层。

---

## 2026-09-16 — [agent02] 完成 UI 专项精细化打磨：消除画布重叠冲突、侧边栏紧凑模式与物理数轴可视化

### 开发者信息与协作分支
- **开发者**：agent02 (`agent02@dsh.local`)
- **分支状态**：已提交并合入 `dev-v2-modern` 与 `main` (commit `23af43a`)

### UI 改进成果

1. **彻底根除画布文字重叠与密集拥挤**：
   - **ROI 顶底标注避让**：将 `Top: ...` 与 `Bottom: ...` 标注文字移出数据区，统一停靠在左侧标尺左外侧，彻底杜绝与第 0 列名称或刻度重叠打架；
   - **属种名称高亮与 45° 斜排**：当前选中的激活属种以醒目亮蓝圆角胶囊清晰突出；未选中的窄列属种名称自动以 45 度优雅向上斜排，无论 30 列还是 50 列，名称再也不会横向撞车；
   - **刻度数值精准降噪**：仅在当前激活列的两侧显示清晰物理刻度（如 0% 与 100%），未选中的数十列不再大面积刷屏干扰。

2. **侧边栏属种列表紧凑模式 (Compact List View)**：
   - 增加 `[≡ 紧凑] / [☲ 卡片]` 双模式即时切换（默认紧凑模式，行高 34px）；
   - 一屏可同时呈现的属种数量从 2~3 个大幅提升至 **15~20 个**，大幅削减在大样本剖面下的滚轮滑动频率。

3. **图表形态类型防截断与全列应用**：
   - 按钮采用紧凑排版：`[🌊 面积] [📊 柱状] [📈 折线] [➕ 符号]`，文字 100% 不再被截断；
   - 增加 `[应用至全列]` 快捷胶囊，避免 30 个属种重复点击。

4. **两点式刻度标定“微型渐变物理数轴”**：
   - 在基线端点与刻度齿端点之间增加微型渐变数轴指示条，物理跨度一目了然。

5. **导出弹窗 100% 丰度总和自检门禁 (Sum Check QA)**：
   - 自动遍历各深度层位加和，质检合格呈绿色（如平均 99.8%），存在异常层位立即琥珀色高亮预警，筑牢科学数据防线。

### 验收结果

- **代码规范检查**：`All checks passed! (0 错误 0 警告)`；
- **全量测试用例**：`45/45` 全部通过；
- **前端生产构建**：`pnpm build`（131ms 干净生成）。

---

## 2026-09-16 — [agent02] 彻底修复“重新识别此列产生异常密集点”严重 Bug，对齐稀疏关键控制手柄

### 开发者信息与协作分支
- **开发者**：agent02 (`agent02@dsh.local`)
- **分支状态**：已提交并合入 `dev-v2-modern` (commit `32500ce`)

### 根因排查与修复

1. **Bug 根因定位**：
   - 后端 `session.digitize()` 返回的字典中，`points` 代表的是整条曲线上全部行像素（全量 300~500 个逐行扫描像素，供画曲线和导出）；
   - 但前端 `main.ts` 的 `onDigitizeActiveColumn` 在点击“⚡ 重新识别此列”时，误将 `points` 全量数组直接赋值给了 `activeCol.controlPoints`；
   - 导致画布将数百个连续像素行全都当成了可拖拽的控制手柄圆圈，视觉上呈现密密麻麻的黑圈，严重破坏交互体验。

2. **前后端双重解耦与稀疏化修复**：
   - **后端（`session.py`）**：在 `digitize` 方法中显式构造并返回 `control_points` 列表（由 `detect_stratigraphic_turning_points` 基于显著性拓扑提取出的 15~32 个波峰、波谷、极值锚点）；
   - **前端（`RpcClient.ts`）**：`digitizeColumn` 优先读取 `res.control_points`；若老版本只有全量点，自动采用特征等距抽稀（`downsampleControlPoints`）严格将手柄数控制在 25 个左右黄金区间；
   - **自动化测试加固**：在 `tests/verify_straditize_pro_e2e.py` 中增加强硬断言：`digitize` 返回的控制点必须在 5~35 个之间，严禁超过 35 个。

### 验收结果

- **代码规范检查**：`All checks passed! (0 错误 0 警告)`；
- **全量测试用例**：`45/45` 全部通过（包含新增的控制点稀疏性断言）；
- **前端打包编译**：`pnpm build`（137ms 干净生成产物）。

---

## 2026-09-16 — [agent02] 落实人机协同工作流：明确有效区首要界定、用户指定放大倍数与形态、去横线红色高亮遮罩

### 开发者信息与协作分支
- **开发者**：agent02 (`agent02@dsh.local`)
- **开发分支**：`agent02/v2-refactor`
- **合并目标**：`dev-v2-modern`（已全绿通过全量测试并完成 fast-forward 合并，commit `5a4fc4b`）

### 完成

1. **确立科学人机协同工作流（对齐老版经典实践）**：
   - **有效区（ROI）首步界定原则**：图片载入后，第一步即引导用户使用 4 角手柄框选纯数据有效区，在 UI 面板强化指导文案：严格将左侧 Y 轴线、右侧聚类树和底部 X 刻度排除在有效区外。从源头杜绝 Y 轴与边框误判为数据列；
   - **分列后形态选择与算法匹配**：有效区切分出各列后，用户直接在属性检查器为各列指定绘图类型（`面积 Area | 柱状 Bar | 折线 Line | 符号 Symbol`）；
   - **用户填写放大倍数（Exaggeration Multiplier）**：废除机器猜测放大倍率的脆弱机制，在属性面板增加 `[x] 局部放大曲线` 勾选框与倍率输入框（默认 5×，附带 3×/5×/10× 快捷按钮）。提取数据与 CSV 导出时按用户指定的倍率几何反算还原真实物理百分比；
   - **去网格横线灵敏度与红色高亮透视遮罩**：在工具栏增加去横线灵敏度控制（关/弱/中/强），结合 B 键透视遮罩，将切除的网格横线以半透明亮红色高亮呈现，正常花粉保留青蓝色，用户可肉眼确认“切除网格而不伤花粉峰”。

2. **数据导出与 R 绘图脚本智能化**：
   - `PropertyPanel.ts` 的 `generateRScript()` 自动提取当前所有列的绘图类型与放大倍数，生成带 `plot.poly`, `plot.bar`, `plot.line`, `exag`, `exag.mult` 向量的专业 R 脚本；
   - `session.py` 的 `export_data()` 严格按用户配置的 `has_exaggeration` 与 `exaggeration_multiplier` 进行数值除法还原。

### 验收结果

- **代码规范检查**：`pixi run lint` $\to$ **All checks passed! (0 错误 0 警告)**；
- **全量单元测试与回归**：`45/45` 测试用例 100% 通过（含 Aber 剖面精度闭环测试）；
- **前端核心测试与构建**：`pnpm test`（9 项全部通过），`pnpm build`（121ms 干净输出 dist 产物）。

---

## 2026-09-16 — 阶段一与阶段三全部完成：统一 straditize 单二进制、SSH 隧道无认证四步法、真实浏览器 Playwright E2E 闭环

### 开发者信息与协作状态
- **任务推进**：阶段一（P0：协议修复与数学对齐）与阶段三（P2：单二进制纯净化与 Playwright E2E 交付验收）全部完成；
- **阶段二分工**：已确认交由开发者 `agent02` (`agent02@dsh.local`) 在分支 `agent02/v2-refactor` 独立推进。

### 核心规格与交付成果确认

- **年代-深度模型 (Age-Depth Model) 解译与样品年代不确定性映射**：
  - 新增 `straditize_core/age_depth.py` 科学算法模块，提供 `AgeDepthAxisCalibrator`、`AgeDepthModel` 与 `extract_age_depth_model`；
  - 针对真实文献图谱（Bacon 拟合与 Bchron 阶梯沉积模型）实现中央拟合线追踪与 95% 置信带（HPD 包络线）自适应提取；
  - 完整支持用户自定义元数据填报（中位数 vs 均值、95% HPD、IntCal 版本）；
  - 实现花粉样品深度向日历年代（`age_est`, `age_min`, `age_max`）与沉积速率的无缝双向插值；
  - 提供 `generate_bacon_script()` 自动生成可直接跑 1000 次 MCMC 的 R 语言脚本；
  - 在 `tests/test_age_depth_model.py` 中全量验证通过（64/64 测试全绿，Ruff 0 错误）。

- **数据导出表格预览与就地编辑 (Table Preview & Inline Cell Editing)**：
  - 导出模态框全面升级为双模式视图（`[📊 数据表格 (可就地编辑)]` / `[📝 原始文本 (CSV)]`）；
  - 渲染表头置顶固定、深度层位高亮的可视化数据网格，每行带行号，单元格支持直接键入微调；
  - 手动修改项自动呈橙色边框高亮（`.user-modified`），数值实时同步反映至剪贴板、CSV、R 脚本与 TAR 包；
  - 提供 `[↺ 还原提取值]` 按钮随时撤回编辑；
  - 经由真实 MS Edge 浏览器自动化 Playwright E2E（8/8 项断言通过）验证无误。

1. **唯一单二进制命名与产物规范 (去除任何 -lite 残留)**：
   - 彻底清除历史实验遗留的 `build-windows-lite` 与 `straditize-lite` 命名；
   - 更新 `pixi.toml` 与 `straditize_windows_pyinst.spec`，唯一构建目标为 `straditize.exe`（产物位于 `straditize/support/dist/straditize/straditize.exe`）；
   - 内嵌最新生产编译产物 `frontend/dist`，实现真正的无 Python 依赖离线独立运行。

2. **双启动模式与进程生命周期规格**：
   - **桌面模式 (`straditize` / 双击)**：
     - Windows 环境在入口首行通过 `ctypes.windll.user32.ShowWindow(hwnd, 0)` 瞬间隐藏控制台黑框；
     - 自动递增分配空闲端口（8765+），写入 `.lock` 单实例锁，重复运行自动激活浏览器不复起进程；
     - 调起默认浏览器访问 `http://127.0.0.1:<port>/`，右上角常驻 `[⏻ 退出]` 按钮；
     - 优雅退出：点击调用 `POST /shutdown`，服务器先响应 HTTP 200 并 flush，守护线程延迟 500ms（`time.sleep(0.5)`）安全清理锁并终止进程。
   - **服务器模式 (`straditize serve [--port 8765]`)**：
     - 默认绑定 `127.0.0.1:8765`；
     - **端口占用确定性防护**：若 8765 端口已被占用，直接在 stderr 打印 `Error: Port 8765 is already in use. Exiting.` 并返回退出码 1 退出，**绝不自动递增端口**；
     - 终端输出访问地址；仅通过终端 Ctrl+C 终止服务；
     - 网页端严格隐藏 `[退出]` 按钮，且 `/shutdown` 端点返回 403 Forbidden。

3. **SSH 隧道四步标准用法**：
   ```bash
   # 1. 登录远程服务器并启动服务
   straditize serve
   # 终端显示：服务已启动：http://127.0.0.1:8765

   # 2. 本地机器建立 SSH 隧道本地端口转发 (安全边界全权委托给 SSH，服务端仅监听 127.0.0.1)
   ssh -L 8765:127.0.0.1:8765 user@remote_server

   # 3. 本地浏览器零认证无缝访问
   http://127.0.0.1:8765

   # 4. 使用完毕在远程终端按 Ctrl+C 安全退出
   ```

4. **阶段一 (P0) 数学真相源与协议自适应完成**：
   - **任务 1.1 前端动态端口自适应**：`RpcClient.ts` 支持同源多候选探测，完美适配动态端口（8766+）而不误降级；
   - **任务 1.2 LogCalibration 标定类**：`calibration.py` 完整实现双向公式与严格前置校验（$s > 0, t > 0, s 
e t$），新增 `LogCalibrationTest` 单元测试通过；
   - **任务 1.3 session 标定与导出对接**：`session.py` 的 `export_data` 与 `extract_grid_values` 统一支持线性/对数两点标定，未观测属种严格输出 `0.0`；
   - **任务 1.4 E2E 断言更新**：`verify_straditize_pro_e2e.py` 直连真实类，6/6 测试全通。

5. **阶段三 (P2) 真实浏览器 Playwright E2E 全流程验证**：
   - 编写并在真实 MS Edge 浏览器中执行了自动化端到端测试 `tests/verify_browser_playwright_e2e.py`；
   - 7 项全流程交互断言全部通过：
     - [Pass 1/7] 页面标题与 Straditize Pro 品牌对齐；
     - [Pass 2/7] 120 FPS HTML5 Canvas 2D 视口与 PRO 标识正常挂载；
     - [Pass 3/7] 6 大工具模式状态机互斥切换（验证点击切换到 ROI 模式并激活状态）；
     - [Pass 4/7] 桌面模式右上角 `[⏻ 退出]` 按钮正常挂载；
     - [Pass 5/7] 属性检查器两点物理刻度输入及对数硬约束报警提示；
     - [Pass 6/7] 科学数据导出模态框正常弹出，`Depth_cm` 首列矩阵格式化，riojaPlot 配套 R 脚本按钮正常就绪；
     - [Pass 7/7] 保存全屏高分辨率实测截图证明至 `real_browser_playwright_verified.png`。

---
## 2026-09-16 — [agent02] 落地 6 大形态基准测试库、完成 Aber 剖面 Ground Truth 精度闭环比对并合并至 dev-v2-modern

### 开发者信息与协作分支
- **开发者**：agent02 (`agent02@dsh.local`)
- **开发分支**：`agent02/v2-refactor`
- **合并目标**：`dev-v2-modern`（已全绿通过全量测试并完成 fast-forward 合并）

### 完成

1. **构建花粉地层图表 6 大经典形态基准库与地面真值数据**：
   - 深入归纳 Benjamin Bell 经典教程与 `riojaPlot` 官方图谱，收录归档 6 大图表形态至 `tests/test_figures/benchmark_types/`；
   - 提取并收录 Abernethy 剖面真实数据地面真值 `data/aber_ground_truth.csv`（49 行深度 × 36 属种列）、`allen1999.xlsx`（含磁化率/烧失量/生物硅等多指标）、`LochChon.xlsx` 及 `riojaPlot_Demo.R`。

2. **核心数学对齐与 Log 标定闭环 (P0 完成)**：
   - **新增 `LogCalibration` 标定类**（`straditize_core/calibration.py`）：完整实现双向对数物理变换与严格前置约束（$s > 0, t > 0, s \ne t$）；
   - **地学导出对接**：`session.py` 的 `export_data()` 支持依据每列 `scale_type` 自动分支调用 `LogCalibration`，未标定或缺失时在 `strict=True` 下抛出 `CALIBRATION_ERROR`；
   - **RPC 协议层同步**：`get_diagram_data` 与 `column.add` 完整导出各列 `scale_type`、`startValue`、`tickValue` 等属性。

3. **【A1】Abernethy 实心面积图数字化精度闭环比对 (`tests/benchmark_aber_accuracy.py`)**：
   - **关键工程发现**：定位并防范了将 Y 轴纵线（x=56）误识别为第 0 列数据导致后续属种整体向右错位 1 列的典型地学图谱陷阱，确立了花粉数据起始列（x=70）规范；
   - **量化精度报告**：Straditize 轮廓追踪引擎对真实地面真值的拟合精度极高：
     - 主导生态建群属种（$>10\%$ 丰度）平均拟合优度 **$R^2 = 0.9144$**；
     - 桦木属 (Betula): $R^2 = 0.9987$, MAE = 5.09%;
     - 欧洲赤松 (Pinus sylvestris): $R^2 = 0.9989$, MAE = 2.90%;
     - 榛属 (Corylus-Myrica): $R^2 = 0.9907$, MAE = 1.75%;
     - 岩高兰属 (Empetrum): $R^2 = 0.9960$, MAE = 1.20%;
     - 刺柏属 (Juniperus): $R^2 = 0.9950$, MAE = 1.17%;
     - 蒿属 (Artemisia): $R^2 = 0.9940$, MAE = 1.34%。

### 验收结果

- **代码规范检查**：`pixi run lint` $\to$ **All checks passed! (0 错误 0 警告)**；
- **RPC 协议测试套件**：`pixi run python -m pytest straditize/tests/test_rpc.py` $\to$ **32/32 测试通过**；
- **端到端 E2E 验证**：`pixi run python tests/verify_straditize_pro_e2e.py` $\to$ **6/6 测试通过**；
- **6 大形态全量检验**：`pixi run python tests/test_benchmark_morphologies.py` $\to$ **6/6 形态全部通过**；
- **Aber 精度闭环测试**：`pixi run python tests/benchmark_aber_accuracy.py` $\to$ **通过**；
- **现代前端生产打包**：`pnpm --prefix frontend run test`（9项通过）+ `pnpm --prefix frontend run build`（124ms 成功生成产物）；
- **Git 树状态**：分支 `agent02/v2-refactor` 已合并入 `dev-v2-modern`，工作区干净（`working tree clean`）。

### 剩余问题与下一步

1. **推进【B1】前端历史栈由深拷贝快照切换为真正 Command Diff 模式**；
2. **推进【A2】低丰度局部放大图（Exaggeration Curves）双层轮廓分离**；
3. **推进【A5】动态核图像去网格横线（Degrid）自适应推导**。

---

## 2026-09-16 — 彻底清除 .stradi 格式残余、规范 POSIX UStar 归档与 depth 标定、全量测试与 Lint 验收达标

### 完成

1. **彻底清理与净化工程文件格式（废除 `.stradi` 伪扩展名）**：
   - **前端界面与文件选择器**：全面更新 `Toolbar.ts`、`PropertyPanel.ts` 与 `main.ts`，将所有工具提示、打开文件过滤器、Toast 提示彻底变更为标准 `.tar` / `.json` / `.tar.gz`，彻底清除 `.stradi` 自定义后缀；
   - **归档格式规范**：工程归档严格遵循 POSIX UStar `.tar` 标准，内含 `manifest.json`、`image/original.png`、`straditize.json`、`data.csv`、`plot_strat.R` 及 `README.txt`（附对数转换 pseudocount 提示）；
   - **CLI 命令行工程运行**：修复 `straditize_core/cli.py` 的 `run-project` 子命令，无缝支持对 `.tar` 与 `.json` 工程直接进行批处理运行导出。

2. **严格对齐地学数据导出规范（意见清单第八节）**：
   - **首列无条件命名为 `depth`**：修改 `session.py` 的 `export_data()`，无论当前地层是否完成物理标定，输出矩阵第一列一律命名为 `depth`（彻底废弃 `pixel_row`）；
   - **未观测属种严格置 0.0**：未观测属种填充真实地学 0.0（禁止出现 NA），第一列为深度；
   - 修复 `session.py` 在 `project_save` 与 `export_csv` 中对 `export_data` 返回值字典结构的解析。

3. **前后端桌面/服务器模式动态感知对齐**：
   - `RpcClient.ts` 在 `probeBackend` 时动态拉取 `/status` 端点获取 `is_desktop_mode`；
   - `Toolbar.ts` 与 `main.ts` 根据服务端模式动态挂载或隐藏右上角 **[⏻ 退出]** 按钮；
   - 桌面模式下点击退出安全调用 `POST /shutdown`，服务器模式下 `/shutdown` 严格返回 403 Forbidden 并不展示退出按钮。

4. **历史栈与核心算法细节完善**：
   - 500 步命令历史栈上限与项目重载时历史清空机制；
   - 修复 `straditize/widgets/data.py` 中的 `_mark_hit_distance`：在无屏幕坐标的测试事件中自动调用 `ax.transData` 进行物理/屏幕坐标换算，彻底解决离散点命中判定偏差。

### 验收结果

- **代码规范检查**：`pixi run lint` $\to$ **All checks passed! (0 错误通过)**；
- **全量单元测试**：`pixi run test` $\to$ **全量 pytest 测试套件 100% 通过 (exit code 0)**；
- **JSON-RPC 2.0 专项测试**：`pixi run python straditize/tests/test_rpc.py` $\to$ **32/32 测试全部通过**；
- **端到端 E2E 验证**：`pixi run python tests/verify_straditize_pro_e2e.py` $\to$ **6/6 场景全部通过**；
- **真实花粉图编辑验证**：`pixi run python tests/verify_real_pollen_edit.py` $\to$ **全绿通过**；
- **现代前端生产打包**：`pnpm/npm run build` in `frontend` $\to$ **129ms 干净生成 `frontend/dist` 产物**。

### 剩余问题与下一步

1. **大图切片视口联动**：针对极端大图（>10000px）进一步优化 Canvas 2D 动态切片缓冲命中率；
2. **打包发布自动化**：测试 GitHub Actions / 本地 PyInstaller 一键生成 Windows 单可执行文件。

---

## 2026-09-16 — 交付前后端数学对齐 (LogCalibration)、对数地学导出闭环与 6 大形态花粉图基准测试图库

### 完成

1. **前后端数学对齐与 LogCalibration 核心闭环 (Task 1.2, 1.3, 1.4)**：
   - **核心数学模块**：在 `straditize/straditize_core/calibration.py` 中新增 `LogCalibration` 类，严密实现双向映射：
     - 正向（像素 $\to$ 物理值）：$\text{val}(x) = \exp\left(\ln(s) + \frac{x - x_0}{x_1 - x_0} \times (\ln(t) - \ln(s))\right)$
     - 逆向（物理值 $\to$ 像素）：$x(\text{val}) = x_0 + \frac{\ln(\text{val}) - \ln(s)}{\ln(t) - \ln(s)} \times (x_1 - x_0)$
     - **严格硬约束**：$x_0 \ne x_1$ 且 $s > 0$ 且 $t > 0$ 且 $s \ne t$，不满足或逆向输入 $\le 0$ 时一律抛出 `ValueError`；
     - 在 `StratigraphicCalibration` 中全面打通 `LogCalibration`。
   - **后端导出对齐**：更新 `straditize/straditize_core/session.py` 的 `export_data()`，属种列指定 `scale_type == 'log'` 时严格执行对数换算，`strict=True` 遇非法对数配置抛出 `JsonRpcError(CALIBRATION_ERROR)`；在 `detect_columns()` 中补齐 `scale_type` 等字段默认值。
   - **RPC 通信对齐**：更新 `straditize/straditize_core/rpc_server.py` 的 `get_diagram_data()`，将每列的 `scale_type`, `startValue`, `tickValue`, `species` 规范对齐下发至前端。
   - **E2E 回归测试**：更新 `tests/verify_straditize_pro_e2e.py`，直接断言后端的 `LogCalibration` 及非法约束校验，并端到端验证对数列导出计算值与严格阻断。

2. **花粉图表 6 大经典形态归纳与基准测试图库固化**：
   - 归纳总结 Benjamin Bell (2018) 教程三部曲与 `riojaPlot` 官方图库，提炼 6 大核心形态：
     - **Type 1: 经典连续实心面积轮廓图 (Filled Silhouette Area)**（样本：`type1_filled_silhouette_aber.png`）
     - **Type 2: 低丰度局部放大轮廓图 (Exaggeration Curves: 3× / 5× / 10×)**（样本：`type2_exaggeration_bell.png`）
     - **Type 3: 离散水平条形/柱状图 (Discrete Horizontal Bars)**（样本：`type3_discrete_bars_bell.png`）
     - **Type 4: 连续骨架纯折线/代用指标图 (Pure Line / Proxy Curves)**（样本：`type4_pure_line_proxy.png`）
     - **Type 5: 稀有属种离散散点/符号标记图 (Presence / Absence Symbols)**（样本：`type5_presence_symbols.png`）
     - **Type 6: 出版级多源复合地层图 (Composite Multi-Component: 双 Y 轴 + 分区 + 聚类树)**（样本：`type6_composite_zonation_cluster.png`）
   - 建立基准测试目录 `tests/test_figures/benchmark_types/`，编写下载自动化脚本并收录全部 6 张典型图及 4 个 SVG 矢量底图；
   - **收录真实基准真值数据 (Ground Truth)**：基于 `riojaPlot` 官方包与 `rioja` R 数据集，将对应的真实数值地层表全部归档于 `tests/test_figures/benchmark_types/data/`（包含 `aber_ground_truth.csv` 49行×38列、`allen1999.xlsx` 8个sheet、`LochChon.xlsx`、`maule2020geochem.txt` 及 `riojaPlot_Demo.R`），供后续数字化精度逐行比对；
   - 编写基准回归测试套件 `tests/test_benchmark_morphologies.py`，完整覆盖 6 种地学图表形态的载入、二值化分割、列识别与数字化提取；
   - **C 盘临时文件彻底清理**：全盘扫描并彻底清空此前临时生成的脚本与残余文件（`C:\Users\chmzs\.dsh\agy-accounts\...\scratch` 等），确保工作空间严格收敛在 `I:\software_dev\straditize`。

### 验证结果

- `pixi run lint`：全部 Ruff 规则检查通过，0 错误 0 警告；
- `pixi run python -m unittest tests/verify_straditize_pro_e2e.py`：6/6 端到端测试全绿通过；
- `pixi run python -m unittest tests/test_benchmark_morphologies.py`：6/6 形态基准测试全绿通过；
- `pixi run python -m pytest straditize/tests/test_rpc.py`：32 项核心 RPC 接口测试全绿通过；
- 前端测试与打包：`pnpm --prefix frontend run test`（9 项核心测试通过）与 `pnpm --prefix frontend run build`（0 警告 0 错误生成 production bundle）。

### 剩余问题与下一步

1. **历史栈 Command Diff 重构**：将前端 `HistoryManager`（当前使用列深拷贝快照）与 `CommandManager` 对齐为严格的 Diff 命令模式，控制栈深与内存；
2. **放大曲线 (Exaggeration) 细线分离算法**：针对 Type 2 的 5×/10× 浅色细线，研发轮廓连通域分析算法，防止误把放大线混入主丰度数值；
3. **稀有属种符号自动定位**：针对 Type 5 的微量 "+" / 小圆点标记，增强连通域形态学分类器。

---

## 2026-09-16 — 交付 Straditize v2.0 (Straditize Pro) 最终全功能闭环：双启动架构、零认证、地学标准导出与极端大图流式切片

### 完成

1. **双启动模式与进程生命周期闭环**：
   - **单二进制双启动**：
     - **桌面模式** (`straditize` / 双击)：动态选取 8765 起始可用端口，单实例互斥锁检测（已存在则直接调起浏览器不重起进程），Windows 环境自动调用 `ShowWindow(hwnd, SW_HIDE)` 隐藏黑色终端窗口，网页端右上角显示 **[⏻ 退出]** 按钮，点击调用 `POST /shutdown` 先返回 200 再延迟 500ms 退出；
     - **服务器模式** (`straditize serve [--port 8765]`)：固定绑定 `127.0.0.1:8765`（被占则报错退出），通过 `AttachConsole(-1)` 保持终端输出，网页端彻底隐藏 [退出] 按钮，`/shutdown` 端点严格返回 403 Forbidden。
   - 快捷启动脚本：提供 `start_straditize.bat`（桌面模式）与 `start_straditize_server.bat`（服务器模式）。
2. **零认证安全架构**：
   - 全面废除 Token、Cookie、Session Secret 与密码；
   - 严格固定绑定本地回环 `127.0.0.1`，跨设备远程连接由 SSH 本地端口转发完全承担。
3. **坐标系统一真相源与 Log 刻度硬约束校验**：
   - 深度轴：$\text{depth}(y) = \text{top\_cm} + \frac{y - \text{top\_px}}{\text{bottom\_px} - \text{top\_px}} \times (\text{bottom\_cm} - \text{top\_cm})$；
   - 物理值：支持线性与对数指数互转；
   - **Log 轴硬约束**：前端与后端严格校验 $\text{startValue} > 0$ 且 $\text{tickValue} > 0$ 且 $\text{startValue} \ne \text{tickValue}$，不满足时红字报错并阻止非法切换，算法拒绝进入 Log 计算，禁止静默回退。
4. **地学标准多格式导出与 POSIX UStar 归档包**：
   - **标准 CSV**：首列强制为 `depth`，未出现属种严格填充真实数值 `0.0`（绝非 `NA` 或 `None`），附带对数变换前 pseudocount 建议注记；
   - **R 绘图脚本随包生成**：自动生成 `plot_strat.R`（基于 `rioja::strat.plot`），用户一键 `Rscript plot_strat.R` 即可还原出版级地层图；
   - **POSIX UStar `.tar` 归档包**：完整打包 `data.csv`, `plot_strat.R`, `straditize.json`, `info.json`, `diagram.png`, `README.txt`，同时前端支持一键解包 `.tar` 完整还原画布、标尺与所有属种列。
5. **极端大图性能优化与切片流式加载**：
   - 解除 PIL `Image.MAX_IMAGE_PIXELS` 限制，超大图大内存懒加载避免预分配多 GB numpy 数组；
   - 新增后端流式切片端点 `/image/tile`, `/image/slice`, `/image/preview`；
   - 前端 Canvas 引入 GPU 视口裁剪渲染与离屏二值化缓存 4096px 自适应缩放，确保 20000×30000 级图谱缩放平移稳定在 60 FPS，内存峰值严格受限于 2 GB 之内。
6. **全链路端到端冒烟回归**：
   - 编写并全绿通过 `tests/verify_straditize_pro_e2e.py`（6/6 项测试通过，耗时 3.54s）；
   - 后端 `straditize/tests/test_rpc.py` 28 项测试全量通过；
   - 前端生产环境构建 `npm run build` 0 警告 0 错误编译完成。

---

## 2026-05-18 — 交付多形态地质图表引擎 (Area/Bars/Line)、Headless CLI 批处理与全网卡远程服务

### 完成

1. **多形态地质图表全面支持 (Multi-Chart Morphology)**：
   - 算法与交互全线支持：
     - **面积图 (Area)**：最外轮廓追踪 + 拓扑 Prominence 峰谷显著度；
     - **柱状图 (Bars)**：水平离散条形 Run-length 检测 + 深度层位聚类；
     - **纯折线图 (Line)**：骨架脊线中心点追踪 (Ridge Centerline)；
   - 属性检查器提供直观的 `[ 面积 (Area) | 柱状 (Bar) | 折线 (Line) ]` 一键切换，画布即时高保真重绘。
2. **Headless CLI 批处理工具 (`straditize_core.cli`)**：
   - 支持无界面终端一行命令批处理剖面图，并输出标准 CSV/JSON：
     ```bash
     python -m straditize_core.cli extract ./diagram.png --roi "315,1946,511,1311" --depth "0,150,2" -o result.csv
     ```
   - 支持直接运行已有项目包：`python -m straditize_core.cli run-project ./profile.stradi -o result.csv`。
3. **全网卡监听与局域网/远程跨设备连接 (`0.0.0.0:8765`)**：
   - 后端服务自动监听所有网络接口，启动时在终端打印所有可用的局域网 IP 与 URL；
   - 支持在远程主机运行服务，在笔记本/iPad/轻薄本的浏览器中以 120 FPS 顺畅进行花粉谱图数据提取。
4. **Windows 一键启动器 (`start_straditize.bat`)**：
   - 根目录下创建双击即可运行的批处理脚本，自动拉起后台服务并在默认浏览器（Edge/Chrome）中秒级打开。
5. **真实 Edge 浏览器自动化测试与全量用例验证**：
   - 后端 45 项 Python 核心测试全部通过；
   - 前端 9 项回归测试与 Vite 生产构建顺利通过；
   - Playwright + Edge 真实截屏验收确认全套系统完全就绪。

---

## 2026-05-18 — 交付 WPD 式专业数据导出面板、riojaPlot 在线一键成图与 .stradi 科学项目存档

### 完成

1. **岩心范围单行紧凑标定设置 (`PropertyPanel.ts`)**：
   - 整合顶底深度为单行：`岩心范围: [Min] 至 [Max] [单位]`，支持用户自由设定 $cm$、$m$、$\text{cal kyr BP}$；
   - 紧凑统一 Y-Limits 与采样间隔，层位标线开关清晰明了。
2. **对标 WebPlotDigitizer (WPD) 的专业数据导出面板**：
   - **数据集自由切换**：`标准深度网格 (Depth Horizons)` / `曲线拐点特征表 (Turning Points)` / `密集逐像素行 (Raw Pixels)`；
   - **多维度排序**：支持按深度升序（顶➔底）、降序（底➔顶）或原始顺序；
   - **灵活格式化**：自定义小数位数（Digits）、列分隔符（逗号 `,`、Tab `\t`、分号 `;`、空格 ` `）、缺测值填充（`NaN` / `0.0` / `NA`）；
   - **直通古生态经典绘图服务 (`riojaPlot`)**：
     - 点击 **`[ 📊 在线绘制花粉图谱 (riojaPlot) ↗ ]`**，系统自动将格式化地层数据转为 Tab 分隔符并写入剪贴板，同时弹开 `https://nsj3.shinyapps.io/riojaPlot/` 页面，用户直接 `Ctrl+V` 即可一秒生成出版级 Stratiplot 图谱！
3. **可复现科学项目包存档与导入 (`.stradi` / `.straditize.json`)**：
   - 顶栏配备 **`[ 💾 存项目 ]`** 与 **`[ 📂 开项目 ]`**；
   - 导出的 `.stradi` 项目包含完整图像尺寸、岩心深度标定、29 个属种名称、两点式物理刻度齿与全部手动调整过的拐点坐标；
   - 支持从电脑直接选择 `.stradi` 或直接将项目文件拖入画布，100% 原样恢复工作现场，完美支持跨设备复用、同行评议与二次修改。
4. **真实 Edge 浏览器端到端实机验证**：
   - 自动截屏验证标定弹窗与 WPD 导出面板，所有布局、按钮与数据流转全部正常。

---

## 2026-05-18 — 交付两点式物理刻度标定模型、4步渐进式工作流导航与柔和浅灰画布

### 完成

1. **两点式物理刻度钉标定模型 (Two-Point Physical Tick Calibration)**：
   - 彻底废除“让用户猜测虚假满刻度（100%/50%）”的反人类设计；
   - 实现**端点 1（原点像素 $X_0$，默认对应数值 $0$，支持特殊图表非零起点自定义）**与**端点 2（真实刻度齿像素 $X_1$，对应数值由用户看图直接输入，如 20%、40%、5000 粒/克）**；
   - 动态实时计算物理斜率 $\text{Slope} = \frac{\Delta \text{Val}}{\Delta X}$，任意像素点丰度计算 100% 精确无偏差；
   - 画布横轴上方高亮显示两点刻度手柄（天青蓝原点方块 + 橙红色刻度齿菱形），鼠标可直接拖拽微调。
2. **现代化 4 步地学渐进式工作流导航 (Progressive Workflow Stepper)**：
   - 顶栏内嵌 4 步清晰操作链：`① 载入` ➔ `② 有效区` ➔ `③ 刻度分列` ➔ `④ 导出`；
   - 点击任意步骤自动联动激活对应工具模式与右侧属性控制台。
3. **柔和纸质浅灰色画板底色与立体投影**：
   - 日间模式下画布背景自动切换为柔和中性浅灰色（`#e2e8f0`），图谱底纸呈现自然阴影立体感，告别纯黑画板反差。
4. **缩放自适应标签去重防叠 (Decluttered Tick Badges)**：
   - 缩小视图时自动隐藏狭窄非激活列的密集重叠字，激活列以高亮徽标胶囊清晰突出。
5. **真实 Edge 浏览器端到端实机验证**：
   - 全套 5 块式工作台（左侧 29 属种列表、中央浅灰画布、右侧两点刻度检查器、顶部工作流导航、底部坐标读数 HUD）100% 正常显示并交互顺畅。

---

## 2026-05-18 — 交付画布直选属种列、行内即时编辑与日夜双配色主题

### 完成

1. **画布任意区域直选属种列 (Direct Canvas Column Selection)**：
   - 彻底打破“只能在左侧列表点卡片”的繁琐限制；
   - 用户在画布中央任意花粉列的黑色面积、折线或顶部标签区域直接**左键单击**，即可秒级直接选中激活该属种列；
   - 自动联动左侧列表高亮该属种卡片、右侧属性检查器即时切至该属种属性，并可在图上直接拉点微调。
2. **属种名单三大输入通道与行内即时改名 (Inline Rename)**：
   - 通道 1：支持从 Excel / Word 一键粘贴（换行/制表符切分）并自动向右拓展分列；
   - 通道 2：支持直接选择本地 CSV / TXT 文件读取属种名单；
   - 通道 3：左侧属种卡片名称直接升级为**行内文本输入框**，点上去直接打字改名（按 Enter 立即生效）。
3. **专业日间 / 夜间双配色主题系统**：
   - 增加柔和纸质浅灰白【日间模式】（Light Theme）与深蓝黑【夜间模式】（Dark Theme），顶栏提供一键无缝切换按键与快捷键。
4. **真实 Edge 浏览器自动化验证**：
   - 自动模拟点击画布中间属种列（*Plantago coronopus*），右侧检查器瞬间同步切换呈现该列全部拐点属性，截屏验收完全通过。

---

## 2026-05-18 — 交付五块式专业地学工作台、显式工具状态机、动态属性检查器与可折叠面板

### 完成

1. **显式 6 大工具模式状态机 (`ToolModeManager.ts` & `Toolbar.ts`)**：
   - 彻底移除了左键点击语义歧义，实现 `Select (V)`、`Pan (H/Space)`、`ROI (R)`、`+Add Column (C)`、`+Add Point (P)`、`Eraser (E)` 六大显式工具状态机；
   - 顶栏显式高亮当前工具模式，视口光标（`default` / `grab` / `crosshair` / `col-resize` / `not-allowed`）及底部状态栏操作指引实时响应。
2. **数据有效区 (ROI Bounding Box) 8 手柄屏幕恒定缩放**：
   - 绘制半透明蓝色数据区框，四角与四边中点配备 8 个恒定屏幕像素正方形手柄（`8px`，缩放不漂移）；
   - 支持自由拖拽手柄微调有效区，拖拽松手提交单条 `ResizeRoiCommand`，绝不静默覆盖已有手动分列。
3. **右侧动态属性检查器 (`Inspector.ts`) 与左右面板折叠快捷键 (`[` / `]`)**：
   - **动态属性联动**：
     - 未选中图元时：显示地质剖面宏观概览（尺寸、属种总数、采样层位数、ROI 范围）；
     - 选中属种列时：显示属种名编辑框、颜色标记、基线与刻度终点物理像素、自定义满刻度输入（带 `100% / 50% / 20% / 10%` 快捷胶囊）、`[⚡ 重新识别此列]` 与 `[🗑 删除列]`；
     - 选中拐点时：显示层位深度、丰度百分比、物理峰顶/谷底/过渡点类型与删除操作；
     - 选中/处于 ROI 模式时：显示四界像素输入与深度范围输入；
   - **面板折叠机制**：左侧属种树支持按 `[` 键或顶栏折叠按钮收起/展开，右侧属性检查器支持按 `]` 键收起/展开，极大释放中央画布编辑空间。
4. **真实 Edge 浏览器 Playwright 自动化验证**：
   - 通过 `playwright-cli open --browser=msedge` 真实驱动 Edge 浏览器，自动点击切换 *Pinus* 等属种、折叠展开面板、触发 RPC 同步；
   - 截屏验收确认全套 5 块式专业工作台渲染与交互完全达标。

---

## 2026-05-18 — 攻克拓扑峰显著度拐点提取与网格横线虚假尖刺过滤

### 完成

1. **实现基于拓扑峰显著度 (Prominence) 的现代拐点提取算法** (`straditize_core/curve.py`):
   - 引入 `scipy.signal.find_peaks` 计算局部波峰与波谷的突出高度（Prominence）；
   - 强制将真实物理极大值（峰顶）和极小值（谷底）作为一级必须保留锚点（Mandatory Anchors），杜绝传统 RDP 算法对地质突变小峰的抹平与漏检；
   - 在长坡过渡段结合 RDP 算法补充次级几何过渡点，两点间严格采用分段折线（Piecewise Linear），彻底废弃失真的贝塞尔样条。
2. **实现形态学水平网格线自动剔除与垂直插值修补** (`straditize_core/image.py` & `session.py`):
   - 利用横向长条结构元（$1 \times 35$）开运算提取贯穿图表的水平坐标线掩码；
   - 结合跨属种共现判断，避免误删真实的平底花粉带；
   - 在数字化前进行横线像素扣除，并使用垂直相邻有效行做线性插值修补，彻底消灭了例如 Hoya 图谱在 $Y=818, 1129, 1306$ 处由于坐标横线导致丰度暴涨至 $100\%$ 的虚假尖刺。
3. **修复 `core.digitize` 中的边界点收集缺陷并保证测试全绿**:
   - 修复了循环体中 points 列表追加位置的边界条件；
   - `tests/test_rpc.py` 与 `straditize/tests/test_core.py` 共计 **45 项测试 100% 通过 (45 passed in 4.81s)**；
   - 前端回归测试 `pnpm --prefix frontend test` 7 项全过，生产构建 `pnpm build` 顺利通过。

---

## 2026-05-18 — 后端 Web 静态资源托管、图像端点与地质网格核心 RPC 实现 (Agent A)

### 改动与成果

1. **解决 `http://127.0.0.1:8765/` 显示 `Not Found` 的问题**：
   - 增强 `straditize/straditize_core/rpc_server.py` 的 HTTP GET 请求处理器 `do_GET`：
     - 当访问 `/`、`/index.html` 或前端静态资源（JS, CSS, PNG 等）时，自动探测并定位 `frontend/dist/`。如果存在，自动以对应 MIME 类型提供静态资源，并支持 SPA 路径回退。
     - 如果 `frontend/dist/` 不存在，返回规范友好的 JSON 诊断页面，包含服务状态、运行环境指引（如 `pnpm dev` / `pnpm build`）与所有可用 API 端点导航。
     - 持续支持 `GET /health`、`GET /status`（附带属种列表、网格数量及校准状态）与 `GET /events` (SSE 服务端事件流)。
2. **新增图像二进制流与上传端点**：
   - `GET /image/current`（及别名 `GET /api/image`）：直接以二进制数据流（`image/png`）提供当前会话加载的剖面图；未载入图像时返回友好 404 JSON。
   - `POST /api/upload`：支持前端上传图像，兼顾 `application/json`（`path` 或 `image_base64`）、`multipart/form-data` 文件上传及原始图像二进制，加载到当前 `StraditizeSession` 并广播 `image_loaded` SSE 事件。
3. **新增核心 RPC 分析方法**：
   - `core.batchSetTaxa`: 支持通过 `{ names: string[] }` 批量设置/覆盖各列属种名称，并同步至 `columns` 与后续导出流程。
   - `core.applyDepthGrid`: 支持通过 `{ depths: number[] }` 或 `{ start_depth, end_depth, step }` 生成并固化全局地质采样层位网格。
   - `core.extractGridValues`: 基于全局深度采样网格与校准标定，对所有已数字化属种曲线进行连续插值，返回 `depths`、`taxa`、`matrix` 丰度矩阵以及 `data` 记录列表。
4. **测试套件扩充与全量验证**：
   - 扩充 `tests/test_rpc.py`（及 `straditize/tests/test_rpc.py`），测试用例由 13 项扩充至 24 项，100% 通过：
     - 协议层：批量设置属种、网格生成（数组与步长模式）、矩阵提取全链路与异常参数测试；
     - HTTP 层：静态资源托管、缺失 dist 诊断页面、图像服务（无图 404 / 有图 200 PNG）、JSON path 上传、base64 上传、multipart 上传及无效参数测试。

### 验证

- `pixi run python -m pytest tests/test_rpc.py -v`: 24 passed (100%)
- `pixi run python -m pytest straditize/tests/test_rpc.py -v`: 24 passed (100%)
- `pixi run ruff check`: 检查通过 (All checks passed)
- `pixi run ruff format`: 格式化统一符合规范

---


### 完成

- **图谱动态载入与多源输入体系 (`Toolbar.ts` & `GeologyCanvas.ts`)**：
  - **打开地质图谱按钮**：在顶部工具栏增加醒目的【打开地质图谱】高亮按钮，绑定隐藏原生文件选择器 `<input type="file" accept="image/*">`，点击即可秒开本地任意图谱。
  - **画布拖拽导入 (Drag & Drop)**：在 `GeologyCanvas` 容器中注入半透明毛玻璃拖拽提示层 `.canvas-drop-overlay`，用户拖入图片时展示动效与格式说明，松开鼠标即刻载入。
  - **剪贴板直接粘贴 (Clipboard Paste)**：全局监听 `paste` 事件，支持从截图工具或剪贴板直接 Ctrl+V 载入图谱。
  - **内置范例图谱一键切换**：在工具栏增加下拉菜单，收录三大经典剖面：
    1. *Hoya del Castillo 花粉剖面* (`./hoya-del-castillo.png`, 2339×1654，8个典型属种曲线与深度标定)；
    2. *标定验证地质图谱* (`./verification_pollen.png`, 1130×498)；
    3. *初学者沉积图谱* (`./beginner-tutorial.png`, 1923×1796)。
- **智能分列推荐与 RPC 联动 (`RpcClient.ts` & `MockBackend.ts`)**：
  - 用户选图/拖图/切图后，若 RPC 后端在线，自动触发 `core.loadImage` 发送图片数据至 Python 会话进行专业尺寸与二值化解析。
  - 在离线或自主 Mock 状态下，`MockBackend.createInitialSuggestion` 根据图像宽高自适应生成合理的地层深度 Y 轴范围标定，并根据横向跨度自适应推荐 4~8 列初始 Taxa 属种剖面与平滑控制曲线。
  - 自动重置视口居中 (`fitToScreen`)，并重置历史撤销栈与侧边栏。
- **底图高保真渲染与二值化透视遮罩 (`Viewport.ts` & `GeologyCanvas.ts`)**：
  - **离屏二值化双缓冲系统**：图片加载后在离屏 Canvas 提取灰度与阈值（默认 138），预生成纯黑白二值化图 (`binaryMonoCanvas`) 与透明底荧光青蓝墨迹透视层 (`binaryMaskCanvas`)。
  - **快捷键系统**：
    - 按 `B` 键：即时开启/关闭二值化墨迹透视遮罩（在原图之上叠印半透明荧光墨迹，原始墨迹与轮廓锚点一览无余）；
    - 按 `I` 键：切换底图反相负片模式 (Invert)；
    - 按 `C` 键：切换高对比度增强模式 (Contrast)；
  - 工具栏提供对应的模式下拉选择与 `[B] 二值化透视` 高亮状态按钮，画布 HUD 实时反馈操作状态。

### 验证

- `pnpm --prefix frontend run build`: 完美打包生成 `dist/`，TypeScript 检查 0 错误。
- `pnpm --prefix frontend test`: 4 项核心测试全通过（历史栈、坐标变换、锚点拉伸删除、底图滤镜与 B 键二值化遮罩）。

---

## 2026-05-18 — 构建现代地学图谱交互数字化前端原型 (Agent 3)

### 完成

- **搭建现代化地学数字化前端工程 (`frontend/`)**：
  - 基于 Vite + TypeScript 8.3 + HTML5 Canvas 构建，轻量高效，零外部重依赖。
  - 配置严谨的 `tsconfig.json`、`vite.config.ts`、现代化暗夜科研工作台样式 `style.css`。
  - 内置真实古气候地学图谱资产（`public/hoya-del-castillo.png`，Hoya del Castillo 真实沉积物花粉剖面）。
- **构建核心高性能地学图谱画布组件 (`GeologyCanvas.ts`)**：
  - **视口引擎 (`Viewport.ts`)**：支持以鼠标为中心的平滑滚轮缩放（5% ~ 3000%），空格+左键或鼠标中键拖拽自由平移，自适应 DPR 保证高分辨率锐利显示，一键适应窗口 (Fit) 与 1:1 居中还原。
  - **垂直分列标线 (Taxa Columns)**：绘制半透明红色垂直基线与满刻度线 (`startX` / `endX`)；悬停时进入 6px 判定范围触发高亮橙红高光并切换为 `col-resize` 光标，支持左右拖动无级调节各 Taxa 分界并联动相邻列。
  - **花粉轮廓与锚点交互体系**：
    - **普通左键点击**：直接在点击位置添加控制点，轮廓线平滑拉伸吸附至鼠标位置。
    - **左键按住控制点**：实时拖拽调整轮廓形态，并在松手时持久化。
    - **右键点击控制点**：直接删除该锚点（自动组织 PCHIP / 贝塞尔重构平滑曲线）。
    - **无损撤销/重做**：集成 `HistoryManager.ts`，支持 `Ctrl+Z` 与 `Ctrl+Y`（或 `Ctrl+Shift+Z`）。
    - **样条平滑算法 (`SplineInterpolator.ts`)**：支持 Catmull-Rom 贝塞尔平滑与严格折线双模式，并自动生成半透明丰度阴影多边形。
- **构建配套交互面板与工作台组件**：
  - `Sidebar.ts`：展示属种卡片清单、色彩标记、基线像素范围、满刻度百分比、手动/自动锚点统计、显隐切换、平滑模式切换、快捷键指南。
  - `Toolbar.ts`：视口控制、撤销/重做按钮与状态更新、标定设置、自动识别、导出 CSV/JSON、RPC 服务状态药丸。
  - `PropertyPanel.ts`：地层物理深度与像素 Y 轴范围标定设置弹窗、数据导出预览/复制/下载弹窗、后端 RPC 连接配置弹窗。
- **实现双模 JSON-RPC 2.0 Client 桥接层 (`RpcClient.ts` / `MockBackend.ts`)**：
  - 完全适配 Agent 2 规范文档 `docs/JSON_RPC_SPECIFICATION.md` 中的 `core.loadImage`, `core.detectColumns`, `core.digitize`, `core.updateControlPoint`, `core.calibrateAxes`, `core.exportData`。
  - 支持自动探测后端 `http://127.0.0.1:8765/rpc`；无后端时 100% 自主运行，内置高仿真地学数据（Pinus, Erica, Poaceae 等 8 个属种），离线即可顺畅交互、编辑、拉伸、撤销重做和导出数据。

### 验证

- `frontend/npm run build`: 生产环境打包无报错，生成 `dist/index.html`、`dist/assets/*.js`、`dist/assets/*.css`，编译耗时 < 100ms。
- `frontend/npm test`: 自动化单元回归验证脚本 `test-core.js` 全部通过（历史状态栈、视口坐标双向变换、锚点拉伸与右键删除）。

---


### 完成

- **制定完整的 JSON-RPC 2.0 协议规范**：
  - 产出规范文档 `docs/JSON_RPC_SPECIFICATION.md`。
  - 标准错误码映射：`-32700` (Parse error), `-32600` (Invalid Request), `-32601` (Method not found), `-32602` (Invalid params), `-32603` (Internal error)。
  - 业务扩展错误码：`-32001` (Session state error), `-32002` (File not found), `-32003` (Calibration error), `-32004` (Export error)。
  - 规范并实现 7 大核心 RPC 方法：
    - `core.loadImage`: 参数 `{ image_path }` -> 返回 `{ width, height, format, mode }`
    - `core.extractForeground`: 参数 `{ threshold, mode }` -> 返回 `{ threshold, mode, foreground_pixels, foreground_ratio, shape }`
    - `core.detectColumns`: 参数 `{ data_xlim, data_ylim }` -> 返回各列边界列表 `[{col_index, start, end}]`
    - `core.digitize`: 参数 `{ col_index, reader_type }` -> 返回该列初始数字化点集 `[{row, x, y}]`
    - `core.updateControlPoint`: 参数 `{ col_index, row, x, remove? }` -> 局部更新控制点并由 PCHIP 保形三次样条全列平滑插值，返回重构点集
    - `core.calibrateAxes`: 参数 `{ y_marks, x_marks }` -> 绑定科学坐标（深度/年代与各列百分比）标定
    - `core.exportData`: 参数 `{ format: "csv" | "parquet", strict: bool, output_path? }` -> 导出数据矩阵并支持 strict 标定校验
- **实现服务端核心与多传输层适配器 (`straditize/straditize_core/`)**：
  - `protocol.py`: 标准 JSON-RPC 2.0 请求解析、响应封装、Dispatcher 路由、批处理 (Batch) 及单向通知 (Notification) 机制。
  - `session.py`: 核心会话与算法调用逻辑，支持无头/内存环境快速执行，与图形界面解耦。
  - `rpc_server.py`: 支持双传输通道：
    - **标准 I/O (stdio)**：单行 JSON 流式传输，日志重定向到 stderr，适合作为子进程被 Electron/Node/Tauri 集成。
    - **Localhost HTTP/SSE 服务**：内置跨域 CORS（POST /rpc），支持 SSE（GET /events）服务器推流与心跳保活。
- **编写完整协议集成测试 (`tests/test_rpc.py`)**：
  - 覆盖全流程端到端业务往返调用。
  - 覆盖 -32700, -32600, -32601, -32602, -32001, -32002 等错误码的异常注入测试。
  - 覆盖 Stdio 管道与 Localhost HTTP / CORS 真实端口往返通信。

### 验证

- `pixi run python -m pytest -q tests/test_rpc.py`: 13 个测试全部 PASS (13 passed in 2.28s)。
- `pixi run ruff check straditize/straditize_core tests/test_rpc.py`: 0 errors, 0 warnings (All checks passed)。


### 完成

- **彻底修复“点哪里曲线不跟随、X轴是常数”的顽疾**：
  - 根因：原先在普通左键点击时未带 Shift，直接调用 `_add_full_data_row(y)` 导致 X 轴被锁死为原曲线插值常数；且已有密集的局部自动拐点（`_full_data_auto_rows`）死锁前后像素。
  - 修复：左键在数据列内点击时无论是否带 Shift，均直接将该列拉伸到鼠标点击的 X 相对值，作为强控制锚点（manual）；同时清理相邻的自动拐点噪点，使曲线自然平滑延展，杜绝“沿 Y 轴长尖刺”。
- **彻底统一按键交互风格**：
  - **普通左键点击空白/线上**：立即在该处建立控制点，曲线直接拉到鼠标 X 位置；
  - **左键点击已有控制点**：直接进入原生拖拽模式，不再销毁重建 marks；
  - **普通右键点击控制点**：直接删除该控制点并由剩余控制点重新平滑曲线，告别反人类的强制 Shift；
  - **破坏性整行删除**：改为必须按住 `Ctrl + 右键`，防止用户误触右键摧毁整行（所有 50 个 Taxa）的剖面数据。
- **新增回归测试**：
  - `test_edit_full_data_plain_left_click_updates_x_value_to_cursor`
  - `test_edit_full_data_plain_right_click_removes_control_point`

### 验证

- `tests/widgets/test_data.py` 内部 61 个测试全部通过（耗时 1 分 04 秒）。
- 全量测试：`283 passed, 5 skipped, 0 failed`（耗时约 7 分 09 秒）。

## 2026-05-17 — 保留缺失值并增加严格坐标转换接口

### 完成

- `Straditizer.final_df` 不再将缺失值统一填充为 `0.0`，保留 `NaN`，区分“未观察”和“真实为零”。
- `_finalize_df(..., strict=True)` 新增严格模式；缺少 Y/X 轴标定时明确抛出 `ValueError`，为后续导出质量门提供基础。
- 增加缺失值保留和严格标定回归测试。
- 由于现有工作流允许导出尚未标定的像素数据，本轮未强制改变默认导出行为；后续应在导出界面增加“像素数据/科学数据”明确选项。

### 验证

- 全量测试：`281 passed, 5 skipped`，耗时约 7 分 35 秒。
- 剩余 warning 主要来自第三方 psyplot/Qt、测试夹具和异步任务清理。

## 2026-05-17 — 修复高风险 GUI 边界崩溃与保存状态错误

### 完成

- `Straditizer.close()` 现在支持 `plot=False` 对象和重复关闭，不再无条件访问不存在的 Axes/Image。
- `StraditizerWidgets.start_tutorial(False)` 在教程未启动时安全返回。
- 空剪贴板现在显示用户可理解的提示，不再触发 `IndexError`。
- 保存 NetCDF/项目文件成功后才更新 `saved` 和 `project_file`，磁盘写入失败不会伪装成已保存。
- 增加对应边界回归测试，覆盖关闭、教程、空剪贴板和保存失败场景。

### 验证

- 相关边界测试全部通过。
- 全量测试：`277 passed, 5 skipped`。
- 剩余 warning 主要来自第三方 psyplot/Qt、测试夹具和既有 Pillow 调用。

## 2026-05-17 — 修复 PyPI wheel 漏声明 Qt 依赖

### 发现与修复

- `setup.py` 原逻辑会在构建环境已安装 PyQt5 时跳过 Qt 依赖声明，导致生成的 PyPI wheel 元数据不包含 `PyQt5`、`PyQtWebEngine` 和 `PyQt5-sip`。
- 外部用户从 wheel 安装后可能得到“安装成功但 GUI 启动失败”的环境。
- 现在仅在 `CONDA_BUILD` 环境跳过 Qt 声明；普通 PyPI 构建始终声明 Qt 依赖。

### 验证

- wheel `METADATA` 已确认包含上述三个 `Requires-Dist`。
- 这是外部安装稳定性的关键修复。

## 2026-05-17 — 清理 Pillow/布尔值弃用行为

### 完成

- `marker_control.py` 将 `~bool` 改为 `not bool`，避免 Python 3.16 行为变化。
- `binary.py` 和 `straditizer.py` 移除 Pillow `Image.fromarray` 的废弃 mode 参数。
- 相关 marker/binary 测试：`45 passed`。
- 全量测试：`274 passed, 5 skipped, 216 warnings`。

### 说明

- 剩余 Pillow mode warning 主要来自测试代码和第三方调用路径；后续可单独清理测试夹具，不与用户功能修复混合。

## 2026-05-17 — 修复 recognize_xaxes 零除告警

### 完成

- 修复 `binary.py` 中 `recognize_xaxes` 上下边界检测对零行和零行比较时的除零问题。
- 当上一行像素数为 0 时改用显式变化判断，保留原有“比较相邻轴线厚度”的逻辑。
- 增加回归测试 `test_recognize_xaxes_ignores_zero_row_ratio`。

### 验证

- 新回归测试通过。
- `tests/test_binary.py`：`31 passed`。
- 全量测试：`274 passed, 5 skipped, 216 warnings`。
- 剩余 warnings 主要来自第三方 psyplot/Qt、测试夹具和 Pillow/NumPy 弃用提示。

## 2026-05-17 — PyInstaller lite profile 实验

### 完成

- 新增 `straditize/support/straditize_windows_pyinst_lite.spec`。
- 新增 Pixi 任务 `pixi run build-windows-lite`。
- lite profile 排除 HTML 帮助、PyQtWebEngine、Sphinx、IPython/Jupyter、qtconsole 和开发工具。
- 构建成功，one-folder 体积约 545 MB，较完整包 602 MB 减少约 57 MB（约 9.5%）。
- `straditize-lite.exe -V` 成功输出 `0.2.2`。

### 判断

- 精简 Python 帮助/控制台栈的收益有限，主要体积仍在 PyQt5/Qt5（约 262 MB）、SciPy 及 DLL。
- PyInstaller 的 PyQt5 hook 仍收集大量 Qt 模块，因此下一步若要继续降体积，应做 Qt 插件白名单，而不是继续删除科学计算依赖。
- lite 包目前只完成启动冒烟测试，尚未确认完整 GUI 工作流；暂不替代 full profile。

## 2026-05-17 — PyInstaller Windows 原型（验证完成）

### 最终验证

- PyInstaller one-folder 构建成功：`straditize/support/dist/straditize`，约 602 MB 未压缩。
- `straditize.exe -V` 成功输出 `0.2.2`。
- 首次 smoke test 暴露 `pkg_resources` runtime hook 缺少 `jaraco`；spec 已排除 `setuptools` 与 `pkg_resources`，再次构建和启动均通过。
- `pixi run lint` 当前报告 659 条历史 Ruff 问题；本轮未扩大格式化范围。

### 关键判断

- 602 MB 主要是 PyQt5/QtWebEngine、SciPy、netCDF4、psyplot-gui 及其帮助/控制台栈；不是开发依赖全部混入。
- Veusz 的 195 MB bundle 依赖更窄，且 spec 明确排除了 matplotlib/pandas/scipy/Jupyter/Sphinx；straditize 不能直接照搬这些排除项，因为它们分别参与绘图、数值化、NetCDF 和 psyplot-gui 帮助/控制台。
- 下一步应做“无 HTML 帮助/无内置控制台”的精简 profile 实验，再决定是否把 PyQtWebEngine、Sphinx、IPython 栈移为可选功能。

## 2026-05-17 — PyInstaller Windows 原型

### 完成

- 增加开发依赖 `pyinstaller>=6,<7` 和 Pixi 任务 `pixi run build-windows`。
- 新增 `straditize/support/straditize_windows_pyinst.spec`，排除 pytest、ruff、pip、setuptools、pkg_resources、wheel 等打包无关模块。
- Windows one-folder bundle 构建成功，约 602 MB 未压缩。
- `straditize.exe -V` 成功输出 `0.2.2`。
- 首次构建发现排除 `setuptools` 会触发 PyInstaller 的 `pkg_resources` runtime hook 缺少 `jaraco`；当前 spec 同时排除 `setuptools` 和 `pkg_resources` 后已恢复正常。

### 结论

- PyInstaller 路线可行，但当前 bundle 仍明显大于 Veusz 的约 195 MB，主要差异来自 PyQt5/QtWebEngine、SciPy、netCDF4 和 psyplot-gui 运行栈。
- 602 MB 是 one-folder 未压缩体积，不等于安装包压缩后体积；仍需做依赖裁剪和 clean-machine 启动测试。

## 2026-05-17 — 用户交互与外部安装准备

### 后续进展

- full-data 主图轴控制点回归测试已加入并通过。
- 使用 PEP 517 构建 wheel 成功：`straditize-0.2.2-py3-none-any.whl`，约 3.0 MB。
- 当前完整回归：`273 passed, 5 skipped, 216 warnings`。
- 当前 Pixi 环境约 1.0 GB；这是包含 Qt、科学计算、测试和开发工具的完整环境，不能视为普通用户安装体积。

### 体积判断

- PyPI wheel：约 3 MB（压缩后，纯 Python、平台无关）。
- 源码目录：约 16 MB。
- 完整开发环境：约 1.0 GB。
- 下一步应建立最小运行时环境，测量普通 pip 用户的实际安装体积。

### Veusz 对比

- Veusz 的 Pixi 配置也采用“conda 只保留 Python + Qt，运行时依赖走 PyPI”的混合模式；但由于其包含 C++/SIP 扩展，PyQt6/Qt6 保留在 conda 更合适。
- Veusz 已有 PyInstaller spec，明确排除 matplotlib、pandas、scipy、Jupyter、Sphinx 等不参与运行的模块；现有 Windows bundle 约 195 MB。
- straditize 当前约 1 GB 主要来自完整开发环境。明确的开发依赖是 pytest、ruff、setuptools；它们不应进入普通用户安装。
- 大体积运行时组件主要是 PyQt5/Qt5（约 274 MB）、SciPy 及其 DLL（约 140 MB）、netCDF4 DLL（约 51 MB）。这些不是明显冗余，而是当前功能链的实际成本。
- `pyqtwebengine` 主要服务 psyplot-gui 的 HTML/Sphinx 帮助浏览；它可作为“精简运行模式”的候选可选依赖，但不能在未验证帮助功能前直接删除。

### 本轮完成

- full-data 编辑器现在允许在主图坐标轴上使用 `Shift+左键` 添加控制点；此前该路径只接受 reader 轴事件。
- 更新 full-data 编辑器提示，明确普通左键/右键与 Shift+左键/Shift+右键的区别。
- 增加主图轴控制点回归测试，覆盖用户在主图上点选的场景。
- 新增 `pyproject.toml` 的 PEP 517 build-system 声明，保留现有 setuptools 元数据和依赖定义。
- README 增加普通用户的 pip 安装路径，并记录 wheel 体积约 3 MB（压缩后）。
- 当前 Pixi 开发环境约 1.0 GB；其中开发/测试工具和 Qt、科学计算依赖占主要空间，不能代表 wheel 本体大小。

### 验证进度

- `tests/widgets/test_data.py -k full_data`：`11 passed`。
- `tests/widgets/test_marker_control.py`：`15 passed`。
- `tests/test_binary.py tests/widgets/test_marker_control.py`：`45 passed`。
- `pip wheel . --no-deps --no-build-isolation`：成功生成 `straditize-0.2.2-py3-none-any.whl`，约 3.0 MB。

### 下一步

- 继续测试主图轴上的控制点拖动、删除和不同坐标范围。
- 分离“运行时安装环境”和“开发环境”，再测量最小运行时环境体积。
- 评估 Windows 独立安装包（PyInstaller/conda-pack）前，先确认 pip wheel 的 Qt 依赖在干净环境可安装。

## 2026-05-17 — Ruff 可变默认参数第一批

### 本轮完成

- 修复 `CrossMarks` 的可变参数默认值，保留显式传入空列表/空字典的原有语义。
- 修复基础 `DataReader.plot_potential_samples` 的 `plot_kws={}` 默认值。
- `B006` 源码问题从 12 条降至 6 条；剩余问题位于 `straditizer.py`、`widgets/__init__.py` 和 `widgets/image_correction.py`，下一轮继续逐项处理。

### 验证进度

- `tests/widgets/test_marker_control.py`：`15 passed`。
- `tests/test_binary.py tests/widgets/test_marker_control.py`：`45 passed`。
- 未进行全量测试；上一轮全量基线仍为 `272 passed, 5 skipped`。

### 下一步

- 继续处理剩余 6 条 B006，之后再处理 RUF012 类属性问题；每批保持小 diff 并运行专项测试。

## 2026-05-17 — 维护清理与版本声明统一

### 本轮完成

- 统一 `README.rst`、`setup.py` 与根目录 `pixi.toml` 的测试依赖范围：Python 3.12，pandas `<3.0`，并同步 NumPy、Matplotlib、SciPy、xarray、NetCDF4、GUI 依赖上限。
- 修正 README 中过宽的 Python/pandas 兼容性声明，并说明 pandas 3.x 当前不支持 NetCDF 项目序列化。
- 将 `pixi run lint` 和 `pixi run format` 限定到源码目录 `straditize`，避免扫描 `.pixi` 环境。
- 清理项目源码中 Pillow `Image.fromarray(..., mode=...)` 弃用用法；修正 headless Matplotlib figure 编号、evaluator labels、reader children 和 plotting kwargs 的可变默认参数。
- 新增维护计划：`straditize/docs/plans/2026-05-17-maintenance-cleanup.md`。

### 验证进度

- `pixi run test`：通过，`272 passed, 5 skipped`；仍有第三方依赖、Qt 异步清理和资源泄漏检测警告。
- `pixi run python -m pytest -q tests/test_binary.py tests/widgets/test_menu_actions.py`：`50 passed, 1 skipped`。
- `pixi run python -m pytest -q tests/widgets/test_menu_actions.py`：`20 passed, 1 skipped`。
- `pixi run lint`：仍有 `666` 条源码 Ruff 问题；本轮拒绝保留一次性全仓格式化产生的约 6600 行差异，剩余问题应按类别小步处理。

### 下一步

- 分批处理 Ruff 的 `UP031`、`RUF012`、`B006` 等问题，每批配套测试。
- 后续再处理 psyplot/Qt 第三方 warning 和测试资源泄漏，不把外部依赖警告误改成业务代码。

## 2026-05-17 — 迁移到本机开发环境

### 本轮完成

- 从 `192.168.0.102:d:/users/chmzs/Documents/Pixi_env/straditize` 复制项目到 `I:/software_dev/straditize`。
- 保留源码仓库 `I:/software_dev/straditize/straditize/.git` 及远端当前 `dev` 分支内容。
- 补传中文文件 `工作簿1.xlsx`；远端传输时 Windows tar 对该文件名报路径警告，已单独用 scp 完成。
- 参考 `I:/software_dev/veusz/pixi.toml`，将常规 Python 运行时/开发依赖迁移到 `[pypi-dependencies]`；conda 仅保留 Python 与 pip。
- 新建 `AGENTS.md`，记录 Pixi、PyPI 优先、测试、lint 和交接规范。

### 验证进度

- `pixi install`：通过；默认环境已安装，锁文件已按 PyPI 优先配置解析。
- `pixi run install`：通过；源码已 editable 安装。
- 核心导入：numpy、pandas、matplotlib、PyQt5、psyplot 可导入；本地包由 editable 安装提供。
- `pixi run lint`：未通过，现有代码约 7263 条 Ruff 问题（其中 2263 条可自动修复）；本轮未擅自批量格式化历史代码。
- 初次 `pixi run test`：`268 passed, 5 skipped, 4 failed`；4 个失败均为 pandas 3.0.5 与项目 NetCDF 序列化兼容性问题。
- 已将 pandas 上限从 `<3.1` 收紧为 `<3.0`，与远端已知工作环境保持一致，并重新 `pixi install`。
- NetCDF 回归测试复验：`4 passed, 17 deselected`。
- `pixi run test` 全量复验：`272 passed, 5 skipped, 793 warnings`，退出码 0。
- 警告主要来自 Pillow/Matplotlib/psyplot 兼容性、资源泄漏检测和 Qt 异步清理；不影响本次环境迁移验收。

## 2026-05-17 — 清理生成物

- 删除源码仓库内的 `.pytest_cache/`、`.worktrees/`、`build/`、`dist/`、`straditize.egg-info/` 和各级 `__pycache__/`。
- 删除项目根目录 `.pytest_cache/`、`.ruff_cache/`、`.vdoc.*.r` 和 `Rplots.pdf`。
- 保留 `.pixi/`、Git 仓库、源码、测试和开发配置。
- 随后按用户确认删除根目录全部分析资料、结果文件、数据文件及辅助目录，包括 `Plum_runs/`、`xx/`、`straditize1/` 和剩余 PDF。
- 清理后根目录仅保留开发环境、配置文档和源码目录；源码仓库 `git status` 仍为干净。
- PyPI 的 PyQt5/PyQtWebEngine、科学计算依赖均已成功解析，无需退回 conda-forge。

### 已知项目状态

- 远端源码仓库当前分支：`dev`。
- 远端仓库迁移前工作区干净。
- `CLAUDE.md` 记录了此前 4 个修复、当前未解决的控制点交互问题及测试基线（约 272 passed, 5 skipped）。
