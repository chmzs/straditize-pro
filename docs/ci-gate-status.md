# CI 门禁现状（2026-11-27 收口轮）

> 交接用。`HANDOFF.md` 被 `.gitignore` 忽略（只在本地），所以状态写明在这里，任何 clone 都看得到。
> 更新纪律：只改"现状 / 未闭合 / 下一步"三节，历史放文件末尾。

## 现状：main 与已合入的修复

| 项 | 值 |
| :--- | :--- |
| main | `68cbf74`（含 #203 #200 #199 #202 #206 #201） |
| 待合 PR | **#209** `fix/agedepth-table-mode`（`e4a7d21` + `ba222ce`） |
| 本轮关闭 issue | #178 #197 #194 #198 #156 #171 #172 #180 #158 #185 #143 #181 #182 #150 #157 #175 #186 #195 |
| 仍开 issue | #204 #205 #207 #208 #177（+ 历史债） |

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

1. **#205 / #207** —— 已在 #209 修好（`agedepth-modal` 7 passed、`contract.spec` 5 passed、`test_agedepth_sync_none` 1 passed），等 #209 合并即关。
2. **#208** —— 全量 e2e 的两条红：`qa` 空层位 2→1、`step2-roi` 超时并弹**空文本**通知。**注意：单独跑 `qa.spec.ts --grep "76 层位"` 通过（`empty=2, max=103.2`）**，全量跑红 → 先怀疑"并发/资源争用"，再怀疑代码。
3. **#204** —— `synth_s3` 非撞界单行残余 `+0.5px`（P3，交 digitize 作者）。
4. **#177** —— 跨图载入丢掩膜，始终未复现，保持 open。

## 下一步原子动作

跑一次**没有其他 playwright 在跑**的全量 e2e（CPU 争用会造成 60s 超时假红）：

```bash
cd frontend && STRADITIZE_E2E_PORT=22916 npx playwright test --reporter=line
```

- 全绿 → #208 收敛为"并发假红"，记录后关闭；
- 仍有红 → 取该用例的 `test-results-*/error-context.md`，按"是不是跨用例状态残留"排查（`serve_e2e_backend.py` 的 `e2e.reset` 是否漏清 `samples` / `columns`）。

## 环境坑（跨会话通用）

- `gh` 的 REST 调用（`pr checks` / `run view` / `api`）直连常 `EOF` 或 `TLS handshake timeout`；加 `HTTPS_PROXY=http://127.0.0.1:7890`。`git push` 走 SSH，不需要代理。
- worktree 里 `cmd //c "mklink /J .pixi …"` 静默失败；直接用共享解释器 `E:/software_dev/straditize/.pixi/envs/default/python.exe`，editable 安装按 cwd 解析、测的是当前 worktree 的代码。
- e2e 前置：`frontend/dist` 必须比 `frontend/src` 新，否则 `fixtures.ts:132` 直接判红（防"测旧产物"）。
- 提交信息里含反引号/`$` 时，`git commit -m "…"` 会被 shell 执行；用 `-F <文件>`。

## 历史（倒序）

- 2026-11-27：验收轮收尾。#178 像素角+撞界双判据（s2 误差归零）；#197 定位为 `c38a028` 的快照欠账；
  #194 19 类动作迁 `undoStack`；#198 不变量 15 两档口径；#207 `float(None)` 崩溃改"跳过并回报行号"。
