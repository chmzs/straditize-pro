# 撤销/重做重做方案（2026-11-11）

> 触发：实机测到撤销链路**整体不成立**（`hands-on-ledger` H-05）。本文只给设计与切片，
> 代码改动按切片逐个落地，每片自带红测试与金丝雀。

## 1 现状（实测，不是推断）

| 动作 | 撤销按钮 | 撤销时发出的 RPC | 后端是否回退 |
| --- | --- | --- | --- |
| 拖 ROI 手柄 | 可点 | **0 条** | 否 |
| Y 轴标定 | 可点 | `roi.update{x0,x1,y0,y1}`（与标定无关） | 否 |
| 列改名 | 可点 | `algorithm.applyLineRemoval` / `algorithm.measureRuler` / 0 条（三轮不同） | 否 |
| 改 ROI 名 / 切主 ROI / 删 ROI / 加排除区 | **灰** | — | 否 |

一句话：**撤销只做"前端快照整体重放"，而重放路径里只剩两条写通道；它永不命中被撤销的那个动作。**
撤销后再按 Ctrl+Z 也救不回来（第二次同样发无关请求或什么都不发）。

`window.__straditize` 不暴露 `history`，所以"按钮可点但没反应"只能靠"按钮 disabled 状态 + 撤销时 RPC 计数"取证。

## 2 为什么不能靠"修快照"

`HistorySnapshot` 目前只存 `columns` / `calibration` / `roi(s)` 等**前端自有**字段，
而用户动作的真实效果分散在后端多个存储（`control_points`、`manual_points`、`calibration`、
`line_strokes`、`column.name` …）。**不同动作的还原方式根本不同**，统一重放必然张冠李戴。

## 3 方案：每个可撤销动作注册自己的"逆操作"

```
interface UndoableOp {
  label: string;                       // 显示用："改名 Pinus → Pinus2"
  inverse: () => Promise<void>;        // 撤销：调后端把状态改回去
  forward: () => Promise<void>;        // 重做：再改回来
  verify: () => Promise<boolean>;      // 可选的核对：改完读后端确认真的变了
}
```

- 动作提交点（`onRenameColumn` / `onCommitYCalibration` / `onRoiUpdate` / `setLineStrokes` …）在**成功后**把
  `UndoableOp` 压栈，参数里带**改前的值**（如 `renameColumn(old)`、`calibrateAxes(旧五点)`）。
- 撤销 = `pop()` 并 `await inverse()`；成功后再读一次后端权威状态确认，**不确认就不弹出栈**。
- **没有逆操作的动作不允许入栈**：按钮保持 `disabled`，hover 说明"此操作不可撤销"（如"删除有列 ROI"）。
- 栈深度设为有限（如 50），超限丢最旧，并在 UI 标明。

## 4 分片（每片独立可交付、可验证）

| 片 | 内容 | 验收判据（红→绿→金丝雀） |
| --- | --- | --- |
| U1 | 基础设施：`UndoableOp` 栈 + 按钮状态由"栈是否为空"驱动（不再由快照决定） | 无操作时按钮 disabled；任何入栈动作后 enabled；**注掉入栈即红** |
| U2 | 标定（Y/X）可撤销 | 撤销后后端 `calibration` 逐字段回到旧值；重做再回去；金丝雀：把 inverse 改成空 → 红 |
| U3 | 列名 / ROI 名可撤销 | 撤销后后端 `columns[].name` / `rois[].name` 回到旧值（不是 DOM 文本） |
| U4 | ROI 几何（拖手柄）可撤销 | 撤销后 `rois[].xlim/ylim` 与拖动前逐值相同 |
| U5 | 清理笔迹可撤销（单笔） | 撤销后 `line_strokes` 少一条且 `manual_erase_pixels` 相应回退；这是用户决策②的落点 |
| U6 | 明确"不可撤销"的动作：删除有列 ROI、删除列 | 按钮 disabled + 文案；**不得**出现"可点但无效" |

顺序 U1 → U2 → U3 → U4 → U5 → U6。U5 依赖 U1 的栈与后端 `setLineStrokes`（全量覆盖语义，天然适合"撤销一笔 = 推 strokes[:-1]"）。

## 5 明确不做

- 不做"编辑器级"细粒度撤销（笔画内部的点级）；
- 不做跨会话持久化撤销栈；
- 不保留旧 `applyHistorySnapshot` 的标定/列回写（T-04 已证明它会撒谎），只保留它写"前端显示偏好"的部分（`depthInterval` / `depthGridEnabled`）。

## 6 遗留（本轮查清、但与本方案无关）

- **空集 e2e 场景仍造不干净**：`resetBaseline + clearAllRois` 后前端仍读到 38 个控制点。
  探针已证明 `column.add` **不会**自动数字化（新建列 `control_points=0`），所以来源在
  `resetBaseline`（`e2e.reset`）与 `clearAllRois` 的交互上，待下轮定位。
  该规则本身已由 `frontend/test-qa-verdict.mjs` 的 8 条纯函数判据钉住。
