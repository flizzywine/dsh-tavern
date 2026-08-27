# Windows 聊天落盘、候选失败与后台压缩排查报告

- 日期：2026-08-27
- 状态：聊天持久化与候选失败分层已实现，等待 Windows 实机复现；前后台联合压缩仍受回退门禁约束
- 日志包：`dsh-session-session-1bdc36b3-328d-40d7-9b22-29519f9ed14e.zip`
- SHA-256：`ba7d1c239f09c06243628ef0d0dc9e786486824df728ad213e5dddd30c2abac8`
- 分析代码基线：`main`，`1774fce`

## 0. 实施进展

当前工作区已按本报告第 5 节实现以下修复：

1. Windows 原子替换重试耗尽后，新版本保留为带单调 revision 的 pending snapshot；`readJson`、`updateJson`、`version` 和 `remove` 均识别该快照。
2. 后续替换成功会把最新版本提升为 canonical target，并清理旧 pending artifacts；进程重启后也能自动恢复读取。
3. 同一目标增加跨 Store 写锁；活跃多写者会明确报冲突，已退出进程遗留的锁会自动回收；同 revision 分叉不会按 mtime 静默覆盖。
4. 候选任务现在区分 `generating`、`validating`、`committing`、`publishing` 和 `completed`，并分别报告模型失败、输出无效以及“已经生成但保存失败”。

5. Tavern 压缩现在会分别执行前台与后台 Session：前台继续使用剧情压缩提示词，后台使用 DSH 内置提示词；两边结果独立保存并可报告部分成功。
6. 后台压缩开始前会持久标记该 Session；后续正文回退不再复用可能含废弃剧情的 summary，而是从 Tavern 权威状态重建后台 Session。

联合压缩的自动回归契约已经建立。真实 DSH 上仍需观察两边 token 变化以及压缩后回退生成的新后台 Session，作为实机验收而非功能启用前的未解决设计门禁。

## 1. 用户症状

群友报告一条 Tavern 对话超过约 30 轮后：

1. 生成候选项失败；
2. 前台上下文注入明显变慢；
3. 执行 `/compact` 后改善不明显。

“30 轮”是用户观察到的相关点，不是目前已证明的代码阈值。

## 2. 结论摘要

这份日志暴露了两个独立问题，不能只用“上下文太长”解释。

### 2.1 已确认：前台压缩没有覆盖常驻后台 Session

前台 `/compact` 确实成功：它压缩了 78 个 history item，约 38,559 token；前台后续请求的 `cacheReadTokens` 从约 91,392 降到 9,472。

但后台 Session 中没有任何 `compaction/start`、`compaction/end` 或 summary 事件。前台压缩后，后台 `cacheReadTokens` 仍从 21,248 继续增长到 31,104。

候选任务的输入规模也持续增长：

| 后台回合 | 输入 token | 耗时 | 结果 |
| --- | ---: | ---: | --- |
| 2 | 1,744 | 4.9 秒 | 有效 `4 action + 1 scene` |
| 6 | 4,377 | 12.3 秒 | 有效 `4 action + 1 scene` |
| 8 | 5,131 | 7.8 秒 | 有效 `4 action + 1 scene` |
| 23 | 14,794 | 15.9 秒 | 有效 `4 action + 1 scene` |
| 35 | 24,283 | 7.8 秒 | 有效 `4 action + 1 scene` |

因此，后台历史增长是真问题，但这份日志没有证明它已经导致候选模型调用失败。

### 2.2 已确认：聊天 JSON 在 Windows 上反复替换失败

主 Session 一共 51 个 turn：36 个完成，15 个报错。其中 13 个错误是：

```text
EPERM: operation not permitted, rename '<chat>.json.tmp-...' -> '<chat>.json'
```

错误从第 17 轮开始，而不是第 30 轮才出现。第 34、35 轮另有两次请求因为后台仍在执行 settlement 而被拒绝。

当前存储流程先写唯一临时文件，再用 `rename(temp, target)` 替换目标；Windows 下对 `EPERM`、`EACCES`、`EBUSY` 最多重试约 5.15 秒，仍失败时保留临时快照并向上抛错。代码见 [`profile-data-store.js`](../../tavern-plugin/lib/profile-data-store.js)。

### 2.3 高可信推断：候选可能“生成成功，但保存或发布失败”

日志中的 5 次候选 Agent 回合全部 completed，返回 JSON 也都满足当前候选校验契约。候选模型调用完成后，系统仍需：

1. 把候选写入 `chat.candidates`；
2. 提交 Story Timeline operation；
3. 更新持久任务 mailbox；
4. 让前端同步最终状态。

这些步骤都会继续写同一个 chat JSON。任何一次落盘失败都可能让界面显示失败，即使模型已经给出了有效候选。相关路径见 [`candidate-generation.js`](../../tavern-plugin/lib/domain/candidate-generation.js)、[`background-task-coordinator.js`](../../tavern-plugin/lib/domain/background-task-coordinator.js) 和 [`durable-task-mailbox.js`](../../tavern-plugin/lib/domain/durable-task-mailbox.js)。

日志包没有插件内部阶段计时，也没有对应 chat JSON，无法把群友所说的某一次候选失败精确定位到上述某个写入步骤。因此该结论是高可信推断，不是假装已经直接复现。

### 2.4 已确认：30 轮后的主要等待发生在前台模型调用之前

第 45～48 轮从 `turn/start` 到第一条 `user/message` 写入 Session，分别等待约 228、137、174、175 秒。同一时段对应的后台 settlement 模型回合只用了约 22、8、5、6 秒。

前台 Handoff 会等待后台 settlement 完整结束后才准备本轮上下文，见 [`foreground-handoff.js`](../../tavern-plugin/lib/domain/foreground-handoff.js)。Context Planner 本身只是本地投影。因此，分钟级等待发生在“后台模型完成后的提交/落盘/协调链路”，不是前台模型正在读取 30 轮上下文。

由于缺少各内部阶段时间戳，目前不能仅凭 Session 日志断言全部等待都花在某一次 `rename` 上；Windows 实机必须补充边界计时。

## 3. 已排除的误判

1. **不是前台 `/compact` 完全无效。** 前台 cache read 明显下降。
2. **不是第 30 轮存在固定失败阈值。** 文件错误第 17 轮已经发生，第 35 个后台回合的候选仍然有效。
3. **这份日志不是候选模型输出格式错误。** 5 次候选均为可解析、数量有效的 JSON。
4. **不能把所有延迟归因于后台 token 增长。** 后台模型耗时远小于前台准备阶段的总等待。

## 4. Windows 实机排查步骤

### 4.1 准备

1. 备份 `%USERPROFILE%\.dsh\profile-data\tavern`。
2. 使用与问题日志相同的模型、人物卡和玩法模式。
3. 记录当前 dsh-tavern commit、DSH 版本、Node 版本和启动方式。
4. 确认没有同时启动两个 DSH/Tavern 进程；记录所有相关 PID。
5. 不要用包含隐私正文的日志截图公开反馈；只保留时间戳、阶段、文件名、错误码和耗时。

PowerShell 基础信息：

```powershell
dsh --version
node --version
git -C C:\path\to\dsh-tavern rev-parse HEAD
Get-Process | Where-Object { $_.ProcessName -match 'dsh|node|electron' } |
  Select-Object Id, ProcessName, Path
```

### 4.2 用 Process Monitor 找出锁文件的进程

使用 Microsoft Process Monitor，过滤：

- `Path` contains `profile-data\tavern\data\chats`
- `Path` ends with 当前 `<chatId>.json`
- `Operation` 包括 `CreateFile`、`WriteFile`、`SetRenameInformationFile`
- `Result` 重点观察 `SHARING VIOLATION`、`ACCESS DENIED`

目标不是只看到 dsh-tavern 的 rename 失败，而是确认失败瞬间哪个进程持有目标文件，以及打开时使用的 sharing flags。

需要区分三种情况：

1. **同一个 DSH 进程自锁或重复写入**：优先修统一写入所有权和队列。
2. **另一个 DSH/Electron 进程同时写**：先落实单实例/单写者约束。
3. **杀毒、索引、同步盘等短暂占用**：实现可恢复的延迟提交，不能只继续增加同步等待时间。

### 4.3 增加最小阶段计时

只记录元数据，不记录人物卡或对话正文。推荐统一前缀 `[TAVERN-PERSIST]` 和 `[TAVERN-TURN]`。

每次 chat 写入至少记录：

- `chatId`、PID、调用阶段；
- JSON 字节数；
- 临时文件写入开始/结束；
- 每次 rename 的 attempt、错误码和累计耗时；
- 同一 target 的进程内队列长度；
- 最终状态：promoted、deferred 或 failed。

每个前台回合至少记录以下边界：

```text
turn.start
settlement.wait.start
settlement.model.end
settlement.commit.end
foreground.plan.end
foreground.chat-write.end
agent.request.start
```

每个候选任务至少记录：

```text
candidate.prepare.start
candidate.model.start
candidate.model.end
candidate.validate.end
candidate.commit.start
candidate.commit.end
mailbox.publish.end
```

所有临时诊断日志必须带统一前缀，修复完成后删除，避免长期污染和泄露。

## 5. 修复建议 A：聊天文件持久化

### 5.1 必须先确立的存储契约

一次 `writeJson` 只有在以下任一条件成立时才能返回成功：

1. 新版本已经原子替换 canonical target；或
2. 新版本已经持久化为系统能够在重启后自动识别的 pending snapshot，并且 Tavern 后续读取会把它视为最新权威版本。

仅仅“把 `.tmp-*` 路径写进错误消息”不构成自动恢复。

### 5.2 推荐方案：可恢复的 deferred promotion

保留“写临时文件 + 原子替换”主路径；Windows 的目标文件在重试期限内仍被占用时，不要改成直接覆盖或先删除旧文件，而是进入 deferred 状态：

1. 临时快照必须完整写入并关闭文件句柄；必要时执行 flush。
2. pending 文件名携带单调 revision/时间和唯一 ID，不依赖 PID 排序。
3. `readJson`、`updateJson` 和 `version` 统一解析 canonical target 与 pending snapshots，选择最新的完整版本。
4. `updateJson` 必须基于最新 pending 版本更新，不能重新读旧 canonical target。
5. 后续写入或后台恢复器再次尝试 promotion；成功后清理更旧的 pending snapshots。
6. 进程重启后第一次读取必须自动发现 pending snapshot，不能依赖内存 Map。
7. `remove` 必须同时处理 canonical target 和属于该 target 的 pending snapshots。
8. 如果发现多个写进程产生不可比较的分叉 snapshot，必须报跨进程冲突，不能按 mtime 静默覆盖。

在确认单进程写入之前，不要把“最新 mtime 获胜”当作跨进程一致性协议。

### 5.3 不建议的修法

- 无限延长同步重试：会把明确失败变成数分钟卡死。
- rename 失败后直接 `writeFile(target)`：崩溃时可能留下半截 JSON。
- 先删除 target 再 rename：删除成功、rename 失败时 canonical 文件消失。
- 把每个领域模块各自加一套重试：会破坏唯一写入所有权。
- 捕获 `EPERM` 后直接宣告成功但不改变读取路径：当前进程和重启后的进程会读到不同状态。

### 5.4 候选错误分层

候选任务必须保留真实失败阶段，建议 mailbox `stage` 至少区分：

- `preparing`
- `generating`
- `validating`
- `committing`
- `publishing`
- `completed`

用户错误对应为：

- 模型调用错误：`候选 Agent 生成失败`
- 输出不足或 JSON 无效：`候选输出无效`
- chat 写入错误：`候选已经生成，但保存失败`
- mailbox 发布错误：`候选已经保存，但界面状态同步失败；请重新读取状态`
- revision 改变：`剧情状态已变化，本次候选已作废`

保存失败时不要自动再次调用模型；先用同一个 `requestId` 恢复或重试提交，避免重复计费和推进两次剧本游标。

## 6. 修复建议 B：前后台联合压缩

### 6.1 原始缺口（已实现）

原界面“压缩上下文”只执行：

```js
ctx.remote.commands.execute(foregroundSessionId, "/compact", [])
```

常驻后台 Session ID 保存在 Story Timeline 的 background participant 中，候选和 settlement 复用该 Session。前台按钮没有对它执行压缩。

### 6.2 推荐交互契约

把按钮语义升级为 Tavern 对话级压缩，而不是单 Session 命令：

1. 解析 Tavern chat 和当前 background participant Session ID。
2. 前台或后台正在运行时不启动联合压缩。
3. 分别执行前台和后台 `/compact`，保留两个独立结果。
4. 没有后台 Session 时，前台成功即整体成功。
5. 一个成功、一个失败时显示“部分成功”，不得笼统显示完成。
6. 完成后展示前后台各自的 shadowed item/token 数，便于确认真实效果。

后台 Session 不应使用“小说正文压缩器”提示词；它保存的是候选与状态结算轨迹，应使用 DSH 默认压缩或专门的后台任务摘要契约。

### 6.3 上线门禁：压缩后回退必须正确

当前架构通过 `surface replace` 把 checkpoint 之后的后台消息遮蔽。后台 compact 可能先把旧消息折叠成 summary；随后回退如果只能遮蔽 summary，却不能恢复 summary 之前需要保留的 Surface，就会破坏剧情分支正确性。

联合压缩上线前必须在真实 DSH 上通过：

```text
后台完成 turn 1..5
记录 turn 2 的 checkpoint boundary
执行后台 /compact
把 Tavern 正文回退到 turn 2
执行一次新的 settlement 或 candidate
抓取真正发送给模型的 messages
```

验收：新请求包含 turn 1..2 仍有效的信息，不包含 turn 3..5 的废弃剧情。

如果失败，不得直接上线后台 `/compact`。应选择以下方案之一：

1. DSH 提供能够在 compact 后恢复指定 checkpoint Surface 的原生能力；或
2. compact 后需要回退到摘要之前时，从 Tavern 权威 checkpoint 创建新的后台 Session，并注入明确的权威快照。

Story Timeline 仍是唯一权威状态，不能让 compact summary 反过来决定剧情真相。

## 7. 回归测试清单

### 7.1 存储层自动测试

1. Windows rename 连续返回 `EPERM`，新版本成为可读取的 pending snapshot。
2. 进程“重启”（重新创建 Store）后仍读取 pending snapshot。
3. 下一次 promotion 成功后 canonical target 更新，旧 snapshot 被清理。
4. `updateJson` 基于 pending，而不是基于旧 target。
5. pending 写入本身失败时明确报错，旧 target 保持完好。
6. 并发进程内更新不丢字段。
7. 多写者分叉不会静默按 mtime 覆盖。
8. `remove` 不遗留会被下次启动错误恢复的 snapshot。

建议最小反馈命令：

```powershell
node --test tests/profile-data-store.test.mjs
```

### 7.2 候选链路自动测试

1. 模型成功、commit 失败：错误必须是“已经生成，但保存失败”。
2. commit 成功、mailbox publish 失败：重新 sync 能找回已保存候选。
3. 相同 `requestId` 重试不产生第二次模型调用。
4. 保存失败不推进两次剧本游标。
5. 后台忙时返回 busy，不伪装为模型失败。

### 7.3 联合压缩自动与实机测试

1. 前台和后台都空闲时分别调用两个 Session。
2. 没有后台 participant 时只压缩前台。
3. 后台忙时不执行半套无提示的操作。
4. 部分失败能显示两个独立结果。
5. 压缩后两边 token/cache footprint 都明显下降。
6. 必须通过第 6.3 节的真实 DSH“压缩后回退”测试。

### 7.4 完整验证

```powershell
pnpm test
git diff --check
```

然后用同一人物卡连续运行至少 50 个正文回合：

- 每轮 settlement 最终进入 terminal 状态；
- 每 5～10 轮生成一次候选；
- 候选失败时能看到准确阶段；
- 不出现未自动恢复的 `.tmp-*`；
- 不出现数分钟的 `turn.start → agent.request.start` 空白；
- 前后台联合压缩后分别记录 token 变化；
- 压缩后执行一次正文回退并验证后台请求内容。

## 8. 推荐实施与提交顺序

每个阶段独立提交，避免把存储正确性和压缩语义混为一个补丁：

1. `test: reproduce deferred Windows chat persistence`
2. `fix: recover Windows chat writes after locked rename`
3. `fix: report candidate generation and persistence stages`
4. `test: define foreground and background compaction contract`
5. `feat: compact foreground and background Tavern sessions`
6. `test: verify background rewind after compaction`

如果第 6 步失败，第 5 步不得发布；先补 DSH checkpoint/Surface 能力或实现从 Tavern 权威 checkpoint 重建后台 Session。

## 9. 当前测试基线

在 macOS、`main@1774fce` 上执行：

```text
node --test \
  tests/profile-data-store.test.mjs \
  tests/background-agent-runner.test.mjs \
  tests/candidate-generation.test.mjs \
  tests/story-compaction.test.mjs
```

结果：42/42 通过。

这只能证明当前单元行为稳定，不能证明 Windows 外部文件占用已经解决，也没有覆盖前后台联合压缩。
