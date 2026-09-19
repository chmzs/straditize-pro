## [FLOW] 2026-09-19 23:40 — 分列 colxx 与 OCR 匹配流
- 初始无列，S3 分列后自动产生 `colxx`（col01…）编号列；OCR 仅由用户点击触发，识别后匹配并一键赋予新列名。
- 未分列时侧边栏禁用导入并给占位说明。
- 下一步：启动应用验证 colxx 分列 + OCR 匹配流；修 `straditize_core/age_depth.py` 的 R→JSON 输出（char 534 非法）。
