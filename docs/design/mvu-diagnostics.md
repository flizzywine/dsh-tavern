# MVU 日志

## 边界

日志独立保存在 Profile 数据目录的 `diagnostics/mvu-<session hash>.json`，不写入模型上下文、剧情或 Session 事件。它不改变工具接收、MVU 执行和变量持久化的先后顺序；自动纠错不属于本次变更。

每次结算尝试使用 `diagnosticId`，关联 operation、剧情分支/revision、消息/swipe、后台 Session。记录阶段：

- `start`：变量容器与 schema 是否存在、顶层字段；不复制完整变量快照。
- `submitted` / `submission-rejected`：操作及格式校验结果，不重复记录分析与正文。
- `runtime-dispatch`：浏览器是否在线、就绪或忙碌。
- `runtime-completed`：事件返回、超时、退出、错误及浏览器警告。
- `persisted` / `runtime-or-persistence-failed`：草稿是否保存及写入次数。
- `result` / `failed` / `stale`：实际差异、未生效项及最终结果。

Helper iframe 将 `console.warn/error`（含 `toastr.warning/error`）关联到当前事件；每事件最多捕获 50 条。父页面校验 iframe 来源和 token，事件门校验运行时所有权。没有事件编号的初始化错误以 `script-runtime` 单独记录。明确的运行时警告可在失败回执中展示；没有具体原因时只报告“未观察到对应变量变化”，不猜测是 schema 拒绝。

## 导出

Tavern 对话顶部的“日志”及下载图标替换原生 Session 日志按钮。仍保留纯对话 TXT；DSH 原生 `/export` 命令保持不变。

ZIP 包含前台 `session.jsonl`、后台/子任务日志、日志引用的图片、`mvu/diagnostics.json`、运行时版本信息及 README。活跃 Session 导出前 flush。缺失资源、容量裁剪会写进 README，不悄悄宣称日志完整。

每会话最多保留 200 条、约 2 MiB 结构化诊断；单条超过 32 KiB 则明确标记截断。导出包上限 32 MiB，为诊断预留空间；超限 Session/附件明确标注跳过。日志中的已知凭据字段、鉴权文本和 URL 参数会脱敏，但对话与附件仍属敏感内容，分享前应检查。历史故障不补录。日志落盘失败不得触发变量重复执行。

## 验证

`tests/mvu-diagnostics.test.mjs` 覆盖非抛出警告从事件门到回执的链路、持久化隔离、磁盘失败、容量、脱敏、子任务/附件与 ZIP 解压；`tests/inline-message-renderer.test.mjs` 覆盖 iframe 来源校验和事件诊断归属。

`node tests/fixtures/tavern-log-export-smoke.mjs` 提供真实导出组件的隔离浏览器验证页，不创建或修改用户对话。
