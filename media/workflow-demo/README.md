# workflow-demo — Straditize 8 步工作流演示片

Remotion 工程，产出两样东西：

| 产物 | 规格 | 用途 |
| --- | --- | --- |
| `docs/assets/video/workflow-8steps.mp4` | 1920×1080 / 30fps / H.264 / faststart | 文档站与投稿视频 |
| `docs/assets/tutorials/01_workflow_8steps.gif` | 1152px 宽 / 循环 | 网页首屏演示（原位替换同名文件） |

## 素材从哪来

全部来自仓库内**已提交的真实界面截图**，不联网、不调后端：

```
docs/assets/tutorials/step1_load.png
docs/assets/tutorials/step2_roi.png
docs/assets/tutorials/step3_ycalib.png
docs/assets/tutorials/step4_cleanup.png
docs/assets/tutorials/step4_binary_overlay.png
docs/assets/tutorials/step5_naming.png
docs/assets/tutorials/step6_xticks.png                            # 28/28 列检出刻齿（ad7bb68 重拍）
docs/assets/tutorials/step6_roi_not_covering_axis.png             # 框没盖住轴行时的实测诊断
docs/assets/tutorials/step7_samples.png
docs/assets/tutorials/step8_qa_export.png
docs/assets/tutorials/modal_export_uncalibrated.png
```

渲染前把它们同步进 `public/shots/`（Remotion 只认 `public/` 下的 `staticFile`）：

```bash
cp ../../docs/assets/tutorials/{step1_load,step2_roi,step3_ycalib,step4_cleanup,step4_binary_overlay,step5_naming,step6_xticks,step6_roi_not_covering_axis,step7_samples,step8_qa_export,modal_export_uncalibrated}.png public/shots/
```

`competition_materials/live_captures/` 那批是 2026-10 的旧界面，只做过构图参考，**没有一帧进入成片**。

## 安装与渲染

```bash
cd media/workflow-demo
npm i                      # 首次；若 npm 报 EPERM，加 --cache "$LOCALAPPDATA/npm-cache"
npx remotion studio        # 预览，改动实时刷新
npx remotion render Workflow8Steps out/workflow-8steps.mp4
ffmpeg -y -i out/workflow-8steps.mp4 -c copy -movflags +faststart ../../docs/assets/video/workflow-8steps.mp4
```

抽帧自检（任意帧导出 PNG）：

```bash
npx remotion render Workflow8Steps out/frames --frames=40,188,378 \
  --image-format=png
```

生成网页动图**必须**走紧凑版 + PNG 序列，不要从长片 mp4 直接转：

```bash
# 1) 紧凑版 740 帧 → PNG 序列（PNG 帧在静止区域是逐像素相同的，差分压缩才有意义）
npx remotion render Workflow8StepsCompact out/seq --sequence --image-format=png

# 2) 调色板 + 套用；-gifflags +transdiff 是关键
ffmpeg -y -framerate 30 -start_number 0 -i out/seq/element-%03d.png \
  -vf "fps=20,scale=1152:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" -frames:v 1 out/pal.png
ffmpeg -y -framerate 30 -start_number 0 -i out/seq/element-%03d.png -i out/pal.png \
  -lavfi "[0:v]fps=20,scale=1152:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle" \
  -gifflags +transdiff -loop 0 ../../docs/assets/tutorials/01_workflow_8steps.gif

rm -rf out/seq            # 739 MB，别留在仓库里
```

**三条踩过的坑（复现时别再试错）：**

1. 从 69 秒长片直接转 GIF → 40 MB。整片都在做 1.7 倍推近，每帧像素全变，差分压缩完全失效。
2. `-gifflags +transdiff` **必须显式给**。不给时 ffmpeg 会逐帧整幅重编，连 30 张完全相同的帧也能编出 6.8 MB。
3. 输入用 PNG 序列而不是 H.264 解码帧：mp4 的色度噪声会让"看起来静止"的区域也逐帧不同，差分照样失效。

## 换演示对象 / 换图怎么改

**只改 `src/scenario.ts` 一个文件**，场景组件不写死任何坐标与数字：

- `SHOTS` —— 帧图文件名（换成新截图只改这里 + 覆盖 `public/shots/`）
- `STEPS[]` —— 每个镜头一段：`frames`（时长）、`camera`（运镜关键帧）、`boxes`（高亮框，素材像素坐标）、`crop`/`cardHeight`（取景裁切与竖版卡片）、`caption`（步骤号 / 标题 / 说明 / 读数）
- `LEDGER_ROWS` —— 结尾账本回收的数字

**数字铁律**：`caption.stat` 与 `LEDGER_ROWS` 里的每个值都必须能在对应截图上读到。
改图必须同时改数，不允许只换图不改数。

## 结构与实现要点

```
src/
  scenario.ts            演示对象唯一配置（帧路径 / 运镜 / 高亮框 / 字幕真值）
  theme.ts               画布尺寸、卡片落位、配色、字体栈
  lib/camera.ts          关键帧 → 相机变换（缓入缓出 + 边界钳制，不越出素材）
  components/
    Backdrop.tsx         深色底 + 网格 + 暗角；Slot 负责遮罩滑动转场
    Screen.tsx           截图卡：卡片 → 相机层 → 素材 + 叠加层
    Highlight.tsx        高亮框：按周长生长描边 + 柔光
    MaskLayer.tsx        同色遮罩滑入（合法收窄画面）
    Caption.tsx          lower-third 字幕 + 大号读数
    CaptionTrack.tsx     全局字幕轨：任一帧有且只有一条字幕
    Counter.tsx          计数上浮
  scenes/
    Opening.tsx          开场（首帧全暗，供 GIF 循环）
    StepShotView.tsx     通用镜头外壳（10 个步骤镜头共用）
    Ledger.tsx           账本页
    Closing.tsx          收尾（末帧全暗）
  Workflow.tsx           Sequence 重叠排布（转场）+ 全片进度线
  WorkflowCompact.tsx    动图专用紧凑剪辑（定位镜头 + 硬切）
```

- 转场是**遮罩滑动**（`Slot` 的 `clipPath` 竖帘，5 帧，帘边一道青光）；
  纯排版镜头（开场/账本/收尾）用硬切，因为整屏是字，扫进来会出现半屏空暗场的中间帧。
  `Slot` 还会给每个镜头铺一层与全片同源的底，保证扫过时不会透出上一镜。
  时间轴上相邻镜头重叠 7 帧，帘扫过时两侧各自完整 —— 不重影、不变暗、不虚。
  试过并否掉的两个方案，写在 `Slot` 的注释里：交叉淡化会成重影，淡到 0 再淡回 1 会在每个交界闪一下全黑。
- 运镜统一 `Easing.bezier(.33,0,.15,1)`，末端做边界钳制，画面不会移出素材外。
- 全片没有画鼠标指针；指示位置一律用高亮框。
- 步长：`OPENING_FRAMES` + `STEPS[].frames` 之和 + `LEDGER_FRAMES` + `CLOSING_FRAMES` = `TOTAL_FRAMES`（当前 2069 帧 ≈ 69.0 s @30fps）。

## 字体

`FONT = "Noto Sans SC","Microsoft YaHei",…`，用系统已装字体（本机 `C:/Windows/Fonts/NotoSansSC-VF.ttf`），
不打包字体文件（可变字体 17.7 MB，塞进仓库不划算）。渲染前务必抽一帧确认无豆腐块。

## 两版剪辑的关系

| | `Workflow8Steps`（长片） | `Workflow8StepsCompact`（动图） |
| --- | --- | --- |
| 时长 | 2069 帧 / 69.0 s | 740 帧 / 24.7 s |
| 镜头 | 开场 + 10 个步骤镜头 + 账本 + 收尾 | 暗场拍子 + 8 个步骤镜头 + 暗场拍子 |
| 运镜 | 每段 1.5–3 s 缓入缓出推近，最长 1.72× | **定位镜头**：固定 1.2× 裁切，不推拉 |
| 转场 | 镜头之间遮罩滑动（竖帘 + 边缘光，5 帧）；开场/账本/收尾硬切 | 硬切 |
| 动效来源 | 运镜 + 高亮 + 字幕 + 计数 | 高亮描边生长 + 字幕淡入 + 计数上浮 |
| 真值 | 完全一致（同一个 `STEPS`） | 完全一致（同一个 `STEPS`） |

动图那版之所以不推镜，是压缩现实：GIF 的差分压缩只对静止像素有效，一推镜整屏都在变，
实测 69 秒版转出来 40 MB、24 秒版带推镜也有 12 MB，都过不了 8 MB 的网页预算。

## 已知取舍（如实记录）

1. **⑧ 导出拦截镜头用取景裁切，不用遮罩。** 弹窗截图来自另一次会话（横幅上是 601 层位 / 174.2%），
   与 ⑧ 正片用的 112 / 85 / 170.8% 不同源；而且弹窗左侧的表区本身是空的（0 rows），
   整张 1440×900 一进画框就有三分之一是纯白，观众会读成「面板白屏」。
   处理方式：`scenario.ts` 里给这一镜配 `crop: {x:1015, y:140, w:285, h:390}` + `cardHeight:780`，
   只取右栏那一竖条（readiness 清单 + Dataset + 橙色 caption）并放大到 2.0 倍展示。
   横幅与空表都被**裁到画外**，不是拿色块盖。字幕显式写出「拒绝导出 ⇒ 表区为空，不是一张 0 值表」。
2. **⑥ 刻度标定镜头是静态推镜**：素材是单张截图，无法演出「点齿→填读数」的连续过程；
   文字与高亮框承担说明，不做假动画。⑥ 的字幕只写两条已确认稳定的事实
   （`检出 28 列 · 刻距 11px · 刻距不均` / `仍需人工点一个刻度齿填读数，才定得下斜率`），
   不绑定 XTicksPanel 可能随版本变动的灰字提示——换图换数只改 `scenario.ts`，不用改组件。
3. **④ 清理镜头**用两张真实截图（遮罩关/开）做同机位切换，是本片唯一「状态变化」镜头。
4. 开场/账本/收尾三镜为纯排版，无截图。
5. 无配乐、无音效：无可商用素材，按要求留空。
6. **读数出现时机**：大号读数与单位标签一起，在开始计数的第 8–14 帧透出，
   否则会出现「0 列 / 0.0000 cm/px」这类中间态（含只剩一个「归属列数」空标签）被抽帧抽到。
7. **字幕是全局一层（`CaptionTrack`），不放在镜头里**。放镜头里时，遮罩滑动会让两条字幕
   在左下角同一位置叠字；提到全局后按时间轴只取「当前主镜头」的字幕，任一帧有且只有一条。
