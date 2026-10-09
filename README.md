# Straditize Pro (v2.0)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logos/logo-horizontal-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logos/logo-horizontal-light.svg">
    <img src="docs/assets/logos/logo-horizontal-light.svg" alt="Straditize Pro Logo" width="480" />
  </picture>
</p>

<p align="center">
  <strong>专为第四纪古生态学、古气候学与沉积地层学打造的高精度多指标图表数字化科研系统</strong><br>
  <em>Scientific Digitization System for Stratigraphic & Palynological Diagrams in Quaternary Geology & Paleoclimatology</em>
</p>

<p align="center">
  <a href="https://chmzs.github.io/straditize-pro/"><img src="https://img.shields.io/badge/Website-chmzs.github.io%2Fstraditize--pro-0284c7.svg?style=flat-square&logo=googlechrome&logoColor=white" alt="Official Website" /></a>
  <a href="https://github.com/chmzs/straditize-pro/releases/latest"><img src="https://img.shields.io/badge/Release-v2.0.0-059669.svg?style=flat-square" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20(Setup%20%7C%20Portable)%20%7C%20Web-059669.svg?style=flat-square&logo=windows" alt="Platform Support" />
  <img src="https://img.shields.io/badge/OCR-PP--OCRv6%20Taxa%20Engine-7c3aed.svg?style=flat-square" alt="PP-OCRv6" />
  <img src="https://img.shields.io/badge/Python-3.12%2B-blue.svg?style=flat-square&logo=python" alt="Python 3.12+" />
  <img src="https://img.shields.io/badge/Frontend-TypeScript%20%7C%20HTML5%20Canvas%202D-10b981.svg?style=flat-square&logo=typescript" alt="TypeScript Frontend" />
  <img src="https://img.shields.io/badge/Metadata-LiPD%20v1.3%20%7C%20FAIR-d97706.svg?style=flat-square" alt="LiPD v1.3" />
  <img src="https://img.shields.io/badge/License-GPL--3.0--or--later-lightgrey.svg?style=flat-square" alt="License" />
</p>

<p align="center">
  <a href="https://chmzs.github.io/straditize-pro/"><strong>🌐 官方主页与在线文档</strong></a> &nbsp;|&nbsp;
  <a href="https://github.com/chmzs/straditize-pro/releases/latest"><strong>🚀 下载 Windows 独立安装包 (.exe)</strong></a> &nbsp;|&nbsp;
  <a href="#-8-阶段科学解译工作流"><strong>📖 8 步解译工作流</strong></a> &nbsp;|&nbsp;
  <a href="docs/tutorials/01_quickstart.md"><strong>📚 实战教程</strong></a>
</p>

---

## 🎯 为什么需要 Straditize Pro？

在地质学、第四纪环境演变、古生态学与湖泊/海洋沉积研究中，大量宝贵的数据仅以**图表形式（文献扫描件或光栅图）**保存在历史出版物中。研究人员在提取这些数据时面临突出的科研痛点：

### 传统数字化工具的局限
1. **单曲线工具无法应对多列图谱（Polydiagrams）**  
   地层花粉图谱和多指标综合图通常并列展示数十至上百个属种（Taxa）及地球化学曲线。使用通用数字化软件时，必须手动为每个属种重复建立数据集、多次手工标定坐标轴并逐字输入拉丁学名，费时耗力且极易出错。
2. **非对齐采样产生“伪空值（Pseudo-NA）”**  
   通用工具在各曲线上独立采点，导致不同属种的深度/层位坐标无法严格对齐。拼接出的数据矩阵充斥着大量虚假缺失值（`NA`），直接阻碍下游 R 语言 `rioja` 地层绘图、`vegan` 多元统计、CONISS 约束聚类以及古气候定量重建。
3. **图层网格与背景噪声干扰**  
   地质图谱中广泛存在水平沉积相分带线、岩性符号、剖面网格线以及曲线填充阴影，通用阈值算法容易将其误判为数据点，需要大量繁重的人工修剪。
4. **年代学与元数据链条断裂**  
   百分比数据与沉积剖面的年代-深度模型（Bacon / Bchron / 放射性碳测年）割裂，缺乏对 95% 年代不确定性包络的完整追踪，无法直接生成符合国际 FAIR 原则与 LiPD 格式的标准数据。

### Straditize Pro 的解决方案
**Straditize Pro** 是专为解决上述地质学图表解译痛点而设计的专业科研系统。通过融合**计算机视觉、专属古生物 OCR、严密几何横截算法与贝叶斯年代学建模**，实现了从图谱光栅图像到出版级标准数据矩阵的全流程高效解译。

---

## ✨ 核心特性

### 1. 自动化地层视觉与专属古生物 OCR
- **倾斜自动校正**：基于 Radon 变换自动检测扫描微倾斜并完成亚像素级水平校正。
- **智能去线与二值化透视**：自适应滤除水平分带线与背景网格；提供实时二值化透视遮罩（快捷键 `B`），直观预览算法识别靶区。
- **PP-OCRv6 属种名称提取**：内置离线拉丁学名识别引擎，支持多角度倾斜文字识别；内嵌 500+ 花粉、硅藻及微体古生物分类学词典，提供智能拼写纠错与模糊对齐。

### 2. 两点式物理刻度与统一解析管道
- **物理刻度标定**：刻度钉支持自由锚定基线原点与任意已知刻度齿，与图谱裁剪框物理解耦，精确适配主属种与微量属种的不同刻度跨度。
- **Linear / Log 统一多尺度支持**：原生支持线性比例与对数比例，并在算法底层实施数值有效性前置验证，避免坐标变换偏差。

### 3. 等深横向几何求交与零 NA 规范
- **全属种共识深度对齐**：沿连续地层剖面，以统一采样深度网格横向截交全部分类单元的轮廓多边形。
- **真值保留保证**：对剖面中未检出或低于检出限的层位，算法严格赋予真值 `0.00`，绝不引入破坏生态学统计模型的虚假 `NA`，生成的矩阵可直接输入各类分析管线。

### 4. 内置年代-深度模型提取与不确定性传递
- **曲线中位数与包络自动提取**：从图谱中直接解译 Bacon 或 Bchron 沉积年代模型的中位数曲线及 95% 置信区间。
- **1000 集合年代学重构**：基于速率空间高斯过程与单调先验，自动生成 1000 条年代学集合，完整打包进国际古气候标准 **LiPD v1.3** 格式。

### 5. 现代化免安装运行与直通 R 语言生态
- **开箱即用出图**：一键导出匹配 R 语言 `rioja::strat.plot` 的出版级脚本，实现数据解译到重新成图的无缝闭环。
- **多格式导出与百分和校验**：支持导出 CSV、多表头 Excel、JSON、LiPD 及开放 POSIX UStar `.tar` 归档工程包；内置 $\sum\% \approx 100\%$ 生态学自洽性校验门禁。
- **跨平台与轻量化架构**：Windows 提供打包独立执行程序，双击即用；底层核心与交互视口解耦，支持超大图谱流畅交互与移动设备局域网协同。

---

## 🖥️ 工作流演示

![Straditize Pro 8步完整工作流实机演示](docs/assets/tutorials/01_workflow_8steps.gif)

> *实测演示：在浏览器视口中完成经典地质图谱从扫描载入、网格去线、属种识别、物理标定到矩阵导出的完整解译流程。*

---

## 🧭 8 阶段科学解译工作流

系统采用严格的状态机工作流驱动，每个步骤均提供直观的交互与反馈，已完成步骤可随时自由回溯微调：

```
[1. 载入] → [2. 取数区] → [3. Y标定] → [4. 去线] → [5. 分列命名] → [6. X刻度] → [7. 数字化] → [8. 校验导出]
   📁           🔲           📏          🧹           🏷️            📐           📈           📊
```

| 步骤 | 阶段核心功能 | 解决的关键科学与技术问题 |
| :---: | :--- | :--- |
| **1. 载入** | 支持 PNG、JPG、TIFF、WebP 及单页 PDF 格式；Radon 变换自动矫正图像旋转角度。 | 纠正纸质文献扫描或翻拍引入的几何几何微倾斜。 |
| **2. 取数区** | 多取数区（Multi-ROI）管理，将有效剖面与图名、图例、深度标尺和聚类分析树物理隔离。 | 避免外部文字和树状图干扰曲线识别；支持多剖面同图分块解译。 |
| **3. Y 轴标定** | 两点式映射物理深度（或年代）坐标，配置度量单位（cm、m、cal yr BP），支持正反向递增。 | 消除选框边缘等于坐标极值的机械假设，实现高精度绝对物理定位。 |
| **4. 去线清理** | 自动提取水平沉积边界线；键盘 `B` 键切换二值化透视遮罩；提供保护阈值防止截断实心花粉带。 | 清除网格线与分带线噪点，保留连续地层花粉轮廓完整性。 |
| **5. 分列命名** | 自动识别属种列基线；集成 PP-OCRv6 离线识别与 500+ 古生物学分类词库模糊纠错。 | 消除手动逐列输入几十个拉丁分类单元名称的繁琐负担。 |
| **6. X 轴刻度** | 两点式刻度钉标定；支持属种分组同步应用；内置对数（Log）尺度的数学有效性验证。 | 精准还原各属种独立变化幅度（如主成分 50% 与微量属种 5%）。 |
| **7. 数字化** | 提取显著拓扑拐点与轮廓多边形；提取共识采样层位；支持提取 Bacon 年代-深度模型。 | 将光栅图像重构为连续矢量形态，完整保留 95% 年代置信区间。 |
| **8. 校验导出** | 执行 $\sum\% \approx 100\%$ 生态学自洽性校验；导出无空值 CSV、Excel、LiPD 格式及 `rioja` 绘图脚本。 | 确保交付数据的科学严谨性，下游无缝衔接 R 统计分析与学术出版。 |

---

## 📥 下载与使用

### 1. Windows 用户（推荐独立安装）

前往 [**GitHub Releases**](https://github.com/chmzs/straditize-pro/releases/latest) 下载预打包的 Windows 版本：

| 版本类型 | 文件名 | 说明 |
| :--- | :--- | :--- |
| **🚀 Windows 一键安装包（推荐）** | `Straditize-Pro-v2.0.0-Windows-x64-Setup.exe` | **科研人员首选**。双击即可安装，自动创建桌面快捷方式，内嵌完整离线模型与独立计算环境，开箱即用。 |
| **📦 绿色免安装便携版** | `straditize-v2.0.0-windows-x64-portable.zip` | 解压至任意目录，双击 `straditize.exe` 即可运行，适合 U 盘随身携带或实验室公用电脑。 |

*注：Windows 发行版已内嵌完整 Python 运行时、ONNX Runtime 视觉推理引擎与 PP-OCRv6 模型权重，计算机无需预装 Python 或 Node.js。*

---

### 2. 源码安装与开发者模式

#### 环境依赖
- **Python**: `>= 3.12`
- **Node.js**: `>= 20`
- **环境管理工具**: 推荐使用 [Pixi](https://pixi.sh) 或 Conda

#### 快速启动
```bash
# 1. 获取项目代码
git clone https://github.com/chmzs/straditize-pro.git
cd straditize-pro

# 2. 安装依赖并构建前端
pixi run install
npm --prefix frontend install
npm --prefix frontend run build

# 3. 启动应用 (自动唤起默认浏览器)
pixi run app
```

*(Windows 开发者亦可在项目根目录双击 `start_straditize.bat` 脚本启动)*

---

## 📖 实战教程

- [📘 教程一：5 分钟快速上手古生态图谱数字化全流程](docs/tutorials/01_quickstart.md)
- [📐 教程二：两点式物理刻度钉精细标定与对数（Log）曲线实战](docs/tutorials/02_twopoint_calibration.md)
- [📊 教程三：数据导出规范、零 NA 矩阵与 R 语言 riojaPlot 一键成图](docs/tutorials/03_export_and_riojaplot.md)

---

## 🌐 远程协作与多设备支持

系统支持灵活的运行部署架构，适应实验室不同硬件条件：

- **平板与移动端局域网标注**：在主控机设置面板中开启“局域网连接”并配置访问 PIN 码，即可在同一 WiFi 下使用 iPad 或触摸平板进行高精度手写标注与图谱审查。
- **远程服务器与算力中心部署**：通过原生命令行模式在服务器后台运行，配合 SSH 端口转发（`ssh -L 8765:127.0.0.1:8765 user@remote`），本地浏览器可获得端到端强加密的流畅交互体验。

---

## 📄 引用与开源许可

本项目基于 **GNU General Public License v3.0 or later (GPL-3.0-or-later)** 开源。

如在学术研究、学位论文、专著出版或科研项目中使用了 Straditize Pro，欢迎引用本项目及初始算法文献：

- **Straditize Pro v2.0**: [https://github.com/chmzs/straditize-pro](https://github.com/chmzs/straditize-pro) (主要维护者: `chmzs`)
- **基础理论文献**: Sommer, P. S. (2019). *Straditize: A Python package for digitizing pollen diagrams*. Journal of Open Source Software, 4(34), 1216. [doi:10.21105/joss.01216](https://doi.org/10.21105/joss.01216).
