# 重构后的职责与验证

本轮保持外部 RPC/CLI、请求语义及存档格式。每个职责单独提交。

## 回合历史操作

- `domain/round-history.js` 负责重生成和回退的完整执行顺序：读取目标、准备历史 revision、调用时间线、脚本事件、DSH 生成、失败恢复、Swipe 提交、后台结算和原生消息替换。
- `index.js` 仅提供 Chat、Session、脚本和展示的宿主接口，保留 `regenBody` / `rollbackTurn` RPC。
- `story-timeline.js` 继续独占分支、revision 和 checkpoint 规则；`tavern-swipe-regeneration.js` 保留 Swipe 合并和冲突判断；`rollback-surface.js` 保留 DSH 消息定位。没有新增第二套历史。
- 客户端 `createTurnHistoryProjection()` 集中处理权威隐藏轮次与旧 localStorage 记录。`TurnHistoryProjection` 独立挂载，候选面板不再维护历史隐藏。继续使用 DSH loader，不引入浏览器打包协议。
- 重生成目标和浏览器隐藏测试改为调用生产接口，不再截取源码；新增完整流程测试，覆盖成功、抛错、缺少正文、空正文、连续重生成、重新创建模块、回退 checkpoint 与旧剧本。

验证：完整 Node 测试 989 项，985 通过、4 项环境条件跳过、0 失败。浏览器加载实际客户端模块，确认回退隐藏目标整轮、保留相邻轮；旧隐藏记录保留用户输入而隐藏正文。浏览器检查使用隔离夹具，不接触真实用户会话，不等同真实模型/所有 DSH 平台验收。
