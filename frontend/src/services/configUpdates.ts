/**
 * `system.updateConfig` 的局部载荷判定：这次保存要不要带 `rscript_path`。
 *
 * ## 为什么单独抽出来（issue #104）
 *
 * 设置页原先**无条件**发送 `rscript_path`。于是两种无关情形都会被后端读成
 * 「用户要清空」：① 配置还没加载出原值；② 类型里缺该字段导致读到 `undefined`。
 * 结果是把 `config.json` 里已经存好的 Rscript 路径抹掉，用户看到「填了保存不了」。
 *
 * 语义边界：**用户把输入框清空 = 明确要清除**（后端用 `""` 表示回到自动探测），
 * 所以清空要发；只有「没动过」才不发。
 */
export function rscriptPathUpdate(
  initial: string,
  current: string
): { rscript_path?: string } {
  const next = current.trim();
  if (next === initial.trim()) return {};
  return { rscript_path: next };
}
