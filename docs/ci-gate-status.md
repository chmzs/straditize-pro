# CI 门禁现状（2026-11-27 收口轮）

> 交接用。`HANDOFF.md` 被 `.gitignore` 忽略（只在本地），所以状态写明在这里，任何 clone 都看得到。
> 更新纪律：只改"现状 / 未闭合 / 下一步"三节，历史放文件末尾。

## 现状：main 与已合入的修复

| 项 | 值 |
| :--- | :--- |
| main | `68cbf74`（含 #203 #200 #199 #202 #206 #201） |
| 已合 PR | #209（`429ba1a`）、#210、**#211**（外派任务书）→ main **`9581a09`** |
| 未合 PR | **0** |
| 本轮关闭 issue | #178 #197 #194 #198 #156 #171 #172 #180 #158 #185 #143 #181 #182 #150 #157 #175 #186 #195 |
| 仍开 issue | **#208**（CI 最后两条红）+ **#204**（+0.5px 残余）+ **#177**（掩膜未复现）+ 历史债 |

## 一键验证（按成本从低到高）

```bash
cd frontend && npm run build                     # 必须：dist 比 src 旧时 e2e 会拒绝跑（fixtures.ts:132）
npx playwright test contract.spec.ts             # ~50s，期望 5 passed
npx playwright test agedepth-modal                # ~1.5m，期望 7 passed
STRADITIZE_E2E_PORT=22916 npx playwright test     # 全量 218 例，20–35 分钟
pixi run lint && pixi run test                    # 后端：ruff + 全量 pytest（pytest 约 25 分钟）
```

端口口径：`STRADITIZE_E2E_PORT` 每次换一个（22890+），`reuseExistingServer: false` 会在该端口自起后端并 `e2e.reset` 预载 hoya。

## 未闭合

1. ~~#205 / #207~~ —— 已随 #209 合入并关闭（`agedepth-modal` 7 passed、`contract.spec` 5 passed、`test_agedepth_sync_none` 1 passed）。
2. **#208** —— 已拆成两个**可外派**的子项，任务书都入库了：
   - **A｜`step2-roi.spec.ts:115`**：`page.reload` **60s 不完成** + 一条**空文本**通知 → 应用在某状态重载挂住（真缺陷，建议 P1）。任务书 **`docs/PROMPT-208.md`**。
   - **B｜`qa.spec.ts` 单独绿 / 全量红**：**污染源已定位为 `contract.spec.ts`**（`contract qa` 两分钟可复现）。二分矩阵与"可见状态逐项相同、差异在隐藏状态"的证据在
     [issue 评论](https://github.com/chmzs/straditize-pro/issues/208#issuecomment-7209241337)。任务书 **`docs/PROMPT-208B.md`**。
3. **#204** —— `synth_s3` 非撞界单行残余 `+0.5px`（P3，交 digitize 作者）。
4. **#177** —— 跨图载入丢掩膜，始终未复现，保持 open。

## 下一步原子动作

两条都已外派，接手指令即对应任务书：

```bash
# A：重载挂死（P1）
#   文件：docs/PROMPT-208.md
STRADITIZE_E2E_PORT=22921 npx playwright test step2-roi.spec.ts --reporter=line

# B：reset 卫生（P2，污染源已定位）
#   文件：docs/PROMPT-208B.md
STRADITIZE_E2E_PORT=22926 npx playwright test contract.spec.ts qa.spec.ts --reporter=line
```

两份任务书都要求**第一步只回答、不动代码**（A：三个观察点；B：`e2e.reset` 的清理清单与差集），
并明令 **不得修改 qa 的期望值**（那是掩盖）。

## 环境坑（跨会话通用）

- `gh` 的 REST 调用（`pr checks` / `run view` / `api`）直连常 `EOF` 或 `TLS handshake timeout`；加 `HTTPS_PROXY=http://127.0.0.1:7890`。`git push` 走 SSH，不需要代理。
- worktree 里 `cmd //c "mklink /J .pixi …"` 静默失败；直接用共享解释器 `E:/software_dev/straditize/.pixi/envs/default/python.exe`，editable 安装按 cwd 解析、测的是当前 worktree 的代码。
- e2e 前置：`frontend/dist` 必须比 `frontend/src` 新，否则 `fixtures.ts:132` 直接判红（防"测旧产物"）。
- 提交信息里含反引号/`$` 时，`git commit -m "…"` 会被 shell 执行；用 `-F <文件>`。

## 历史（倒序）

- 2026-11-27：验收轮收尾。#178 像素角+撞界双判据（s2 误差归零）；#197 定位为 `c38a028` 的快照欠账；
  #194 19 类动作迁 `undoStack`；#198 不变量 15 两档口径；#207 `float(None)` 崩溃改"跳过并回报行号"。
