# Straditize Pro (v2.0)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logos/logo-horizontal-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logos/logo-horizontal-light.svg">
    <img src="docs/assets/logos/logo-horizontal-light.svg" alt="Straditize Pro Logo" width="460" />
  </picture>
</p>

<p align="center">
  <strong>下一代专业地质剖面、地层花粉与古气候图表数字化科研解译系统</strong><br>
  <em>Next-Generation Scientific Digitization System for Palynological & Stratigraphic Diagrams</em>
</p>

<p align="center">
  <a href="https://chmzs.github.io/straditize-pro/"><img src="https://img.shields.io/badge/Website-chmzs.github.io%2Fstraditize--pro-0284c7.svg?style=flat-square&logo=googlechrome&logoColor=white" alt="Official Website" /></a>
  <a href="https://github.com/chmzs/straditize-pro/releases/latest"><img src="https://img.shields.io/badge/Release-v2.0.0-059669.svg?style=flat-square" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Windows-Setup.exe%20%7C%20Portable.zip-059669.svg?style=flat-square&logo=windows" alt="Windows Support" />
  <img src="https://img.shields.io/badge/OCR-PP--OCRv6%20(Latin%20Script)-7c3aed.svg?style=flat-square" alt="PP-OCRv6" />
  <img src="https://img.shields.io/badge/Python-3.12%2B-blue.svg?style=flat-square&logo=python" alt="Python 3.12+" />
  <img src="https://img.shields.io/badge/Frontend-TypeScript%20%7C%20120FPS%20Canvas-10b981.svg?style=flat-square&logo=typescript" alt="TypeScript Frontend" />
  <img src="https://img.shields.io/badge/Metadata-LiPD%20v1.3%20%7C%20FAIR-d97706.svg?style=flat-square" alt="LiPD v1.3" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-lightgrey.svg?style=flat-square" alt="License" />
</p>

<p align="center">
  <a href="https://chmzs.github.io/straditize-pro/"><strong>🌐 访问官方宣传主页与完整文档 (Official Website) &rarr;</strong></a><br>
  <a href="https://github.com/chmzs/straditize-pro/releases/latest"><strong>🚀 下载 Windows 一键安装包 (.exe)</strong></a> &nbsp;|&nbsp;
  <a href="#-8-阶段地学科学解译工作流"><strong>📖 8 步地学工作流快速上手</strong></a> &nbsp;|&nbsp;
  <a href="docs/tutorials/01_quickstart.md"><strong>📚 实战教程</strong></a>
</p>

---

## 💡 为什么选择 Straditize Pro？

传统图表采集工具（如通用 Digitizer）受制于沉重的桌面图形库与相对像素假定，在地学场景中存在致命局限：
- **相对比例失真**：强行假定每列宽代表 0~100%，无法处理次要属种小刻度（0~20%）、对数浓度（Log）或同位素负值区间；
- **矩阵充满伪 `NA`**：因各列提取点位高低不一，拼接数据表充斥缺失值，直接破坏下游 R 语言 `rioja`、`vegan` 排序与 CONISS 聚类分析；
- **缺乏年代学与元数据链**：年代-深度图谱与花粉图谱割裂，无法追溯 95% 置信包络不确定性，缺失 FAIR 国际数据标准。

**Straditize Pro v2.0** 专为第四纪古生态学、古气候学、地层学与沉积学打造：
- **纯 Python 高性能计算内核 (`straditize_core`)**：脱离桌面 GUI 负担，基于 NumPy / SciPy 提供微秒级横向等深求交与贝叶斯集合采样；
- **120 FPS 视网膜级视口 (`frontend`)**：TypeScript + HTML5 Canvas 2D 架构，支持平滑漫游、视网膜 DPR 自适应与 B 键二值化实时透视；
- **真实数据不变量**：**面向用户的数据只有唯一来源——后端真实数学计算**，彻底物理剔除伪造插值通路。

---

## 🖥️ 界面实测预览 (Preview)

![Straditize Pro 8步完整工作流实机录制动图演示](docs/assets/tutorials/01_workflow_8steps.gif)

> 上图为真实浏览器中驱动 Straditize Pro 完成 8 步工作流解译经典图谱 *Hoya del Castillo* 并导出科学矩阵与 `riojaPlot` 脚本的实录演示。

---

## 📥 下载与安装 (Downloads)

### 1. Windows 用户（推荐一键安装）

直接前往 [**GitHub Releases**](https://github.com/chmzs/straditize-pro/releases/latest) 下载打包好的 Windows 可执行程序：

| 版本类型 | 下载文件名 | 说明 |
| :--- | :--- | :--- |
| **🚀 Windows 一键安装包（推荐）** | `Straditize-Pro-v2.0.0-Windows-x64-Setup.exe` | **普通用户首选**。直接双击运行，自动生成**桌面快捷方式**与**开始菜单图标**，双击桌面图标即可启动；自带完整卸载程序，无需管理员权限。 |
| **📦 绿色便携免安装包** | `straditize-v2.0.0-windows-x64-portable.zip` | 解压至任意文件夹，双击运行 `straditize.exe` 即可使用，适合 U 盘携带或实验室无安装权限电脑。 |

*注：Windows 发行包已内嵌独立 Python 运行时、ONNX Runtime、最新 PP-OCRv6 离线识别权重与完整前端资源，电脑无需安装 Python 或 Node.js 即可直接运行。*

---

### 2. 源码部署与开发者模式 (From Source)

#### 环境要求
- **Python**: `>= 3.12`
- **Node.js**: `>= 20`
- **环境工具**: 推荐使用 [Pixi](https://pixi.sh)（零冲突管理 C/C++ 与 Python 科学计算依赖）

#### 快速启动三步法
```bash
# 1. 克隆代码仓库
git clone https://github.com/chmzs/straditize-pro.git
cd straditize-pro

# 2. 一键安装依赖并构建前端 SPA
pixi run install
npm --prefix frontend install
npm --prefix frontend run build

# 3. 启动应用 (自动打开浏览器直达系统)
pixi run app
```

*(Windows 开发者也可在根目录下双击 `start_straditize.bat` 一键启动)*

---

## 🧭 8 阶段地学科学解译工作流

Straditize Pro 严格遵循 8 步状态机架构，顶部胶囊高亮显示当前进度，已完成步骤可随时自由回跳：

```
[1.载入] → [2.取数区] → [3.Y标定] → [4.去线] → [5.分列与命名] → [6.X刻度与样式] → [7.数字化与层位] → [8.校验与导出]
   ✓          ✓          ✓         ✓           ✓              ✓               ✓               ●
```

| 步骤 | 阶段核心功能 | 解决的地学与技术痛点 |
| :---: | :--- | :--- |
| **1. 载入** | 支持 PNG/JPG/TIFF/WebP 与**单页 PDF**；自带 Radon 氡变换检测扫描微斜（一键水平矫正）。 | 消除复印件、论文截图扫描歪斜导致的几何投影偏差。 |
| **2. 取数区** | 多取数区 (**Multi-ROI**) 分组管理，将纯数据区与坐标轴、图注、CONISS 聚类树彻底物理隔离。 | 避免坐标轴线条被误算为花粉曲线；支持主花粉图与副图（炭屑、磁化率）同图分块解译。 |
| **3. Y 轴标定** | **两点式标定物理轴线**（任意两已知深度行映射物理读数与单位），**与取数区完全解耦**。 | 杜绝传统软件“拿选框边界当刻度”的虚假假设；支持向下递增（深度）与向上递增（年代）。 |
| **4. 去线清理** | 智能检测水平分带线与网格线；**按键盘 `B` 键开启双色二值化透视遮罩**（白=保留，红=剔除）。 | 所见即数字化所用；实心花粉轮廓被横线穿过处受厚度门禁保护，绝不被切断。 |
| **5. 分列命名** | 自动探测属种基线；集成 **PP-OCRv6 离线识别**（支持 0°/30°/45°/60° 旋转投影与拉丁科属词典纠错）。 | 告别繁琐的手工逐列打字；内置 500+ 花粉、硅藻、微体古生物词库，单字容错自动吸附。 |
| **6. X 轴刻度** | **两点式物理刻度钉**（基线原点 $P_1$ + 印刷刻度齿 $P_2$）；列组统一应用；**对数 (Log) 尺度硬约束拦截**。 | 支持各属种独立刻度（如 20%、50%）；对数起点 $\le 0$ 时自动拦截红字警示，根绝 $\ln(0)$ 崩塌。 |
| **7. 数字化** | 高显著性拓扑拐点提取；**自动提取共识采样层位**；内嵌 **Bacon/Bchron 年代-深度模型提取**。 | 自动解译中位数年代曲线与 95% 置信包络，基于贝叶斯先验生成 1000 条单调年代学集合。 |
| **8. 校验导出** | **$\sum\%$ 百和检验门禁**（标出偏离 100% 层位）；未标定列醒目标注；录入 **FAIR / LiPD v1.3 标准元数据**。 | 杜绝带病导出；提供免 Token 外部 AI 导入助手；一键导出无 NA CSV、多表 Excel、LiPD 与配套 R 绘图脚本。 |

---

## 🌟 核心科研技术突破

### 1. 统一坐标真相源 (Single Source of Truth)
- **两点式物理刻度标定**：
  $$\text{线性标定: } \text{val}(x) = \text{startVal} + \frac{x - \text{startX}}{\text{tickEndX} - \text{startX}} \times (\text{tickVal} - \text{startVal})$$
  $$\text{对数标定: } \text{val}(x) = \exp\left(\ln(\text{startVal}) + \frac{x - \text{startX}}{\text{tickEndX} - \text{startX}} \times (\ln(\text{tickVal}) - \ln(\text{startVal}))\right)$$
- 导出与 QA 诊断严格共享唯一解析管道，彻底消除因计算分支不一致导致的数据漂移。

### 2. 等深层位横向几何求交与“零 NA 原则”
- 以地层连续剖面的深度层位横向截交全属种插值多边形；
- 未检出或低于检出限层位**严格输出真值 `0.00`**，绝不产生使 R 语言 `vegan::cca()` 或 `rioja` 报错丢行的伪 `NA`；
- 首列强制命名为 `depth`，无缝衔接各类多元统计分析管线。

### 3. 年代-深度模型与 1000 集合不确定性追踪
- 支持从图谱直接识别并提取 Bacon、Bchron 沉积模型的中位数与 95% 置信包络；
- 在速率空间构造满足单调先验的 1000 条年代集合实现，并完整打包进国际古气候标准 **LiPD v1.3** 结构（`chronEnsembleTable`）。

### 4. 开放标准工程包 (.tar)
- 项目完全保存为符合 POSIX UStar 标准的开放 `.tar` 归档文件；
- 包含原图、`straditize.json` 矢量模型、`data.csv`、`plot_strat.R` 及 LiPD 元数据，同行评议 100% 离线无损重现。

---

## 📚 详细图文教程

- [📖 教程 1：五分钟快速上手古生态图谱数字化 (8 步全流程)](docs/tutorials/01_quickstart.md)
- [📐 教程 2：两点式物理刻度钉标定与对数 (Log) 尺度实战](docs/tutorials/02_twopoint_calibration.md)
- [📊 教程 3：数据导出规范、无 NA 原则与 riojaPlot 一键成图](docs/tutorials/03_export_and_riojaplot.md)

---

## 🔒 远程与多设备协作 (Remote Access)

Straditize Pro 针对不同的网络场景提供双轨远程方案，兼顾**便捷性**与**绝对安全性**：

### 模式一：局域网 / Tailscale 直连 + 访问密码保护（推荐平板/跨设备）
适合在实验室连同一 WiFi，或使用 iPad、笔记本躺在沙发上看图标注：
1. 在宿主机右上角点击 **`⚙️ 设置`** $\to$ **`🌐 远程访问`**；
2. 勾选 **“允许局域网远程连接”**，并在 **“远程访问保护密码”** 处输入你的专属 PIN 码或密码（留空则仅依赖 IP 白名单）；
3. 在 iPad 或其他设备浏览器直接输入宿主机的局域网 IP（如 `http://192.168.1.100:8765`）；
4. 页面弹出安全锁屏，输入设定密码后一键解锁，自动保持会话，**彻底摆脱路由器 DHCP 导致的 IP 白名单失效困扰**（宿主机本机访问永远免密）。

### 模式二：公网云服务器 / 超算节点 + SSH 隧道（推荐公网/VPS）
适合在无显示器的远程高性能服务器或租赁的云主机上运行：
```bash
# 1. 远程服务器启动服务 (默认绑定回环，外网扫描完全不可见)
pixi run app --port 8765

# 2. 本地电脑建立 SSH 端口转发
ssh -L 8765:127.0.0.1:8765 username@server-ip

# 3. 本地浏览器免密直接访问 (全链路端到端强加密)
http://127.0.0.1:8765
```

---

## 🧪 自动化测试与质量门禁

本项目建立了覆盖数学内核、RPC 通信协议与真实浏览器端到端行为的三层严密质量门禁：

```bash
pixi run lint             # 语法规范与跨文件一致性静态核对 (A~G 8项)
npm --prefix frontend test# 前端模型、词汇表与状态自检测试
pixi run test             # 后端全量测试套件 (核心算法/JSON-RPC/年代模型等)
pixi run test-contract    # 真实浏览器 JSON-RPC 契约快速门禁 (Playwright)
pixi run build-windows    # 构建独立可执行发行包 (PyInstaller)
pixi run build-installer  # 构建 Windows 安装包 Setup.exe (NSIS)
pixi run record-tutorials # 真实浏览器自动录制全流程教学动图
```

---

## 📄 引用与开源许可证 (Citation & License)

本项目采用 **GNU General Public License v3.0 or later (GPL-3.0-or-later)** 开源。

如在科研论文、学位论文、第四纪古环境重建或专著中使用了 Straditize Pro，欢迎引用本项目及原始文献：
- **Straditize Pro v2.0**: [https://github.com/chmzs/straditize-pro](https://github.com/chmzs/straditize-pro) (主要开发者: `chmzs`)
- **原始文献**: Sommer, P. S. (2019). *Straditize: A Python package for digitizing pollen diagrams*. Journal of Open Source Software, 4(34), 1216. [doi:10.21105/joss.01216](https://doi.org/10.21105/joss.01216).
