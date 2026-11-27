你是修复会话，负责 **#208 的子项 A**：`step2-roi.spec.ts:115` 在 `page.reload` 处挂死 60 秒，并弹出一条**空文本**通知。

## 复现（4 分钟一轮）

```bash
cd /e/software_dev/straditize && git fetch origin
git worktree add ..\wt-fix208 -b fix/step2-roi-reload origin/main
cd ../wt-fix208/frontend
# worktree 内没有 node_modules，别用 mklink（MSYS 下静默失败），直接借用：
#   先用共享解释器跑后端 / 或用 `npm --prefix` 指向共享 node_modules 的方式跑 playwright
npm run build                       # 必须：dist 比 src 旧时 fixtures.ts:132 直接判红
STRADITIZE_E2E_PORT=22921 npx playwright test step2-roi.spec.ts --reporter=line
```

**期望**：用例跑完（reload 后界面可用）。
**实际**：`Test timeout of 60000ms exceeded`，挂在 `page.reload()`；同时 fixture 报一条未预期通知，内容是**空字符串**。

## 已排除（不要重复验证）

| 假设 | 结论 | 证据 |
| :--- | :--- | :--- |
| 并发/资源争用 | **不是** | 单独跑同一条仍红（无其他 playwright 在跑） |
| dist 陈旧 | **不是** | 跑前 `npm run build` 通过（`fixtures.ts:132` 有新鲜度门禁） |
| 断言写错 | **不是** | 失败点是 `page.reload` 超时，不是断言不符 |
| 与 `qa.spec.ts` 互相污染 | **不是** | 配对跑 `step2-roi qa` 时 qa 通过、step2-roi 仍红 |

## 要查的三个观察点

1. **挂起期间后端是否还活着**：reload 后在 10s 内轮询 `http://127.0.0.1:<port>/health`。若 `/health` 不响应 → 后端被前一步的操作卡住（`e2e.reset` 或某个 RPC 长阻塞），问题在后端；若响应正常 → 前端 bootstrap 卡住。
2. **前端 bootstrap 卡在哪个 RPC**：给 `page.on('response')` 或 `page.on('request')` 记日志，看 reload 后发出的最后一个请求是什么、有没有 pending 未返回。
3. **空文本通知的来源**：`notify()` 会 `trim` 后丢弃空串，所以这条不是 `notify('')`。找 `notifyError(...)` 的调用点，看传进去的是不是 `err.message` 为空的非 Error 对象（后端返回 `{}` 或 `undefined`）。**空文本通知本身是缺陷**：应用唯一的用户可见报错通道给出空白，比不给更糟。

## 判据（缺一不算完）

1. `step2-roi.spec.ts` **全绿**，且 reload 后 10s 内界面可交互（不是靠把超时调大）；
2. 那条空文本通知**要么有可读文本、要么不再出现**；
3. 若是后端阻塞，要有"哪个调用阻塞了多久"的证据（日志或计时），不能只说"现在好了"；
4. `qa.spec.ts`、`contract.spec.ts`、`agedepth-modal.spec.ts` 三条不能因你的改动转红；
5. **必须有提交**（做完没提交 = 没做完）。

## 环境坑（本项目已踩过，别再踩）

- `gh` 的 REST 调用要加 `HTTPS_PROXY=http://127.0.0.1:7890`；`git push` 走 SSH 不用。
- worktree 里 `cmd //c "mklink /J .pixi …"` 静默失败；Python 用共享解释器
  `E:/software_dev/straditize/.pixi/envs/default/python.exe`（editable 安装按 cwd 解析，测的是当前 worktree 代码）。
- `STRADITIZE_E2E_PORT` 每次换一个（22890+），`reuseExistingServer: false` 会在该端口自起后端。
- 提交信息含反引号/`$` 时用 `git commit -F <文件>`，别用 `-m "…"`（会被 shell 执行）。
- 别在跑 e2e 期间重建 `dist`（会让另一条 spec 判"dist 陈旧"）。

## 第一步只回答，不动代码

① reload 挂起时 `/health` 是否响应（给时间戳）
② reload 后最后一个 pending 的请求是什么
③ 空文本通知的调用链（哪个 `notifyError`，传入对象长什么样）
