你是修复会话，负责 **#208 的子项 B**：`qa.spec.ts` 单独跑绿、跟 `contract.spec.ts` 一起跑就红。**污染源已经定位到 `contract.spec.ts`，你要找的是它留下的什么隐藏状态。**

## 复现（2 分钟一轮，已缩到最短）

```bash
cd /e/software_dev/straditize && git fetch origin
git worktree add ..\wt-fix208b -b fix/e2e-reset-hygiene origin/main
cd ../wt-fix208b/frontend
npm run build                                        # 必须：dist 比 src 旧时 fixtures.ts:132 直接判红
STRADITIZE_E2E_PORT=22926 npx playwright test contract.spec.ts qa.spec.ts --reporter=line
```

- **红**：`qa.spec.ts:146` → `n_horizons_empty` 期望 2、实际 1（只有 depth=148 仍算空）。
- **控制组**：`npx playwright test qa.spec.ts` → **绿**（`empty=2, max=103.2, n=76`）。

## 已排除（不要重复验证）

| 假设 | 证据 |
| :--- | :--- |
| 并发/资源争用 | 单跑 `contract qa` 仍红（无其他 playwright） |
| dist 陈旧 | 跑前 `npm run build` 通过 |
| 断言写错 | 失败的是后端返回值的差异，不是选择器 |
| qa 自污染 | `qa --repeat-each=2` → 绿 ×2 |
| `naming` / `agedepth-modal` / 7 个中间 spec | 与 qa 配对均绿 |

## 关键证据（这决定了要查"隐藏状态"）

在失败分支上打印过 `straditize.getDiagramData`（临时诊断，已回滚）：

```
contract 之后： {"image":2339x1654, "roi":[[100,210],[100,475]],
                 "cols":[{"n":"Pinus","sx":100,"ex":210,"st":0,"g":null}],
                 "cleanup":{"roi_id":"roi_2","stats":{}}, "empty":1,
                 "empties":[{"depth":148,"reason":"no ink read"}]}
单独运行：      同 image / 同 roi / 同 col(sx=100,ex=210,st=0,group=null) / cleanup 空 → empty=2
```

**可见状态逐项相同**，所以差异只能在不进这份 payload 的会话字段里。

## 三个高嫌疑字段（按顺序查）

1. **`column_points` / `_points_invalidated`**：`contract.spec` 若"建列→取 payload→删列"，删列后按旧 `col_index`
   留下的点会被新列（同 `col_index=0`）继承 → 该行"有读数"而不是 `no ink`。这是最贴合症状的解释。
2. **掩膜 / `algorithm.degrid` 结果**：若 contract 触发过去网格或 cleanup 打点，图像掩膜会改变"这行有没有墨迹"；
   `cleanup.stats` 显示空并不代表掩膜被还原。
3. **`x_ticks` / 标度残留**：列重建后 `x_ticks` 若沿用旧值，0 点会偏，压到 0% 的行可能落到 0 点左侧被拒
   （`-32602`），该行保留数字化读数 → 空层位少一个。qa 里已把轴粗钉 0，但 `x_ticks` 可能是另一条路。

## 怎么查（先查注册点，再查清理项）

```bash
rg -n '"e2e\.reset"' --type py            # 找注册点（示例：scripts/lead_probe/serve_zero.py:68）
rg -n 'e2e\.reset|e2eReset' frontend/     # 找前端调用点与期望语义
```

- `frontend/src/services/ProvenanceGate.ts:117` 的注释提到 `e2e.reset` 走**后端单会话串行**执行，可作为语义参考；
- 逐项列出 `e2e.reset` 清了哪些字段，与 `straditize_core` 里所有"会被写操作修改"的会话字段做差集——
  **差集就是候选**。

## 判据（缺一不算完）

1. `npx playwright test contract.spec.ts qa.spec.ts` → **绿**；
2. 且 `qa.spec.ts` 单独跑 **仍绿**（不能靠改断言或改顺序达成）；
3. 修法必须是**补 `e2e.reset` 的清理**或修被污染字段的归属，**不得修改 qa 的期望值**（那是掩盖）；
4. 补一条**回归钉子**：让 `contract` 之后再断言隐藏状态已还原（例如 `column_points` 为空 / `export.csv` 行集为基线），
   使"下一个污染源"能立刻暴露；
5. `contract.spec.ts`、`agedepth-modal.spec.ts`、`step2-roi.spec.ts` 三条不能因你的改动转红；
6. **必须有提交**（做完没提交 = 没做完）。

## 环境坑

- `gh` 的 REST 调用要 `HTTPS_PROXY=http://127.0.0.1:7890`；`git push` 走 SSH 不用。
- worktree 内 `cmd //c "mklink /J …"` 静默失败；Python 用共享解释器
  `E:/software_dev/straditize/.pixi/envs/default/python.exe`（editable 按 cwd 解析）。
- `STRADITIZE_E2E_PORT` 每次换一个；`reuseExistingServer: false` 会在该端口自起后端。
- 提交信息含反引号/`$` 时用 `git commit -F <文件>`。
- 别在跑 e2e 期间重建 `dist`。

## 第一步只回答，不动代码

① `e2e.reset` 的注册点在哪、它清了哪些字段（列出清单）
② 这些字段与"会被写操作修改的会话字段"的差集是什么
③ `contract.spec.ts` 具体修改过上述差集里的哪几个
