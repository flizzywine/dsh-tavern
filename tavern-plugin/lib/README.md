# 插件服务端

`index.js` 是 DSH 插件入口，负责创建存储、会话与后台运行模块，连接依赖，
注册宿主能力并恢复运行状态。主要实现按以下职责组织：

- `tools/`：按用途注册模型工具，包含原有描述、参数、输出格式和执行逻辑。
- `hooks/request.js`：请求坐标、重试限制和前台步骤准备。
- `hooks/model-stream.js`：导入上下文检查、模板投影、压缩请求和模型日志。
- `hooks/turn-lifecycle.js`：回合结束、失败清理、正文提交和 system 提示词组装。
- `http/routes.js`：HTTP 路由、资源响应、请求校验和 RPC 错误封装。
- `rpc/`：各请求组独立接收其所需的 Tavern 接口。舞台请求和工作台工具分别接线。
- `domain/regenerated-round.js`：原生与插件重生成共用 Story Timeline 提交和提交后的结算接续。
  `domain/regeneration-recovery.js` 根据持久记录恢复 DSH Session 投影，`domain/rollback-projection.js` 负责回退后的宿主同步。
- `domain/chat-writes.js`：存档提交后的候选失效、摘要同步、状态通知、模板和压缩调度；
  各种写入口的豁免规则集中在此，原始导入写入不触发这些处理。
- `domain/game-save-export.js`：在稳定快照内收集存档历史、人物卡、剧本、图片和当前分支插件媒体。
- `domain/settings-transfer.js`：预设包导入导出与同名资源处理；
  `domain/system-prompt-documents.js` 管理系统提示词文档校验、展示和默认值差异。
- `domain/` 的其他文件：既有业务规则和运行模块。

这些文件是 ES 模块。纯函数和固定定义直接 import；每次插件启动独有的对象与
函数由入口显式传入。注册函数同步执行，保留入口中的调用顺序；不要把模块级
可变状态用于保存某个 Profile 的运行对象，也不要将共享闭包整体作为上下文传入。

入口装配各请求组并统一分派。新增请求时在所属请求组声明所需接口，依赖的初始化和释放由其所有者管理。

改动工具或 hooks 后运行相关行为测试及 `tests/plugin-startup.test.mjs`；
后者在隔离 Profile 中调用真实 `apply()` 并检查各类工具已注册。
HTTP 行为由 `tests/mvu-asset-route.test.mjs` 和 `tests/tavern-rpc-errors.test.mjs`
等测试覆盖，cordis 补丁的入口由 `tests/tavern-plugin-patch.test.mjs` 检查。
发布工作流对将要分发的 ZIP 校验清单并运行真实 DSH 的浏览器打开验收。
