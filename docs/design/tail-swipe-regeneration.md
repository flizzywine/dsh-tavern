# 尾部正文重新生成与 Swipe 固化方案

> 状态：已实施；自动化验证已覆盖，真实游玩验收待进行。
> 范围：只改“重新生成最后一轮正文”和最后一轮 Swipe 切换；现有回退实现保持不变。

## 问题

DSH Session 是只追加的事件流，酒馆 Chat 则可以为同一条助手消息保存多个 Swipe。当前重新生成流程在同一个前台 Session 中追加内部重新生成指令和新正文，完成后又用一个空 assistant 节点替换从旧正文到新正文的整段 Surface：

```text
Session 事件：旧正文 → 内部重新生成指令 → 新正文 → 空替换节点
模型可见：空替换节点被 DSH 过滤，因此旧正文和新正文都不可见
Chat 展示：当前选中的新 Swipe
```

界面与模型上下文由此分离。下一轮模型可能看不到玩家刚刚选定的正文。

## 决定

Swipe 是尾部编辑能力，不是任意历史编辑能力：

1. 只有最后一条、且尚无后续玩家输入的助手正文可以重新生成或切换 Swipe。
2. Chat 保存所有 Swipe，并以当前 `swipeId` 作为唯一权威选择。
3. 未选中的 Swipe 仅是备选内容，不进入模型可见 Session。
4. 用户左右切换时只修改 Chat，不立即追加 Session 事件。
5. 下一次前台请求开始前，只把最终选中的 Swipe 固化为 Session 尾部正文。
6. 新玩家消息一旦进入 Session，上一轮 Swipe 锁定；修改更早正文必须走回退或分支，不提供直接切换。
7. 回退继续使用现有空 assistant 墓碑。DSH 会过滤空 assistant，它正确表示最后一轮已从模型消息面移除。

## 权威状态与投影

- Story Timeline / Chat：权威剧情、Swipe 列表、当前 `swipeId`、各 Swipe 变量与结算回执。
- DSH Session 事件：只追加的执行历史，保留旧正文、内部重新生成指令和模型输出以供追溯。
- DSH Session Surface：模型当前可见的剧情投影，只保留最终选中的尾部正文。
- UI：从 Chat 展示当前 Swipe，不以 Session Surface 反推选择。

任何恢复和请求组装都从 Chat 的当前 `swipeId` 重建尾部投影，Session Surface 不是第二份权威状态。

## 模块

尾部 Swipe 的约束和 Session 投影集中在 `tail-swipe-regeneration.js`，由现有重生成流程、Host Adapter 和前台编排分别调用：

```js
selectedTailSwipe(chat, { messageId, swipeId })
projectTailSwipeView(chat)
synchronizeTailSwipeSurface({ chat, session })
```

该模块负责：

- 验证目标确实是最后一条助手正文，且后面没有玩家输入；
- 校验并投影最后一条助手正文；
- 定位需要替换的 Session Surface 尾部；
- 在重启或部分提交后幂等修复 Chat 与 Surface 的差异。

`round-history.js` 保留重生成工作流、Swipe 合并和连续 Surface 区间替换；Host Adapter 负责切换、生命周期 revision 与后台重新结算。回退仍走原实现。

## 重新生成时序

1. 通过 `regenInProgress` 标记锁定同一 Chat 的尾部编辑。
2. 读取 Chat、Story Timeline 和 Session，确认目标为最后一组“玩家输入 + 助手正文”。
3. 快照 `{ branchId, revision, lifecycleRevision, messageId, swipeId, sourceDigest }`。
4. 在同一 Agent Session 中追加内部重新生成指令并等待模型生成；生成失败时恢复原 Chat，不改变当前有效 Surface。
5. 把模型新正文追加到原助手消息的 `swipes`，为它追加对应变量槽位，并把新 Swipe 设为当前选择。
6. 提交 Chat，递增 `tavernHelperLifecycleRevision`；旧 Swipe 的在途结算由版本检查判定为过期。
7. 将“原 Surface 尾部正文至本次内部生成正文”的连续区间替换为一条非空 assistant 节点，内容是新 Swipe 的 `sessionText`，turn 仍使用原剧情 turn。
8. Surface 投影成功后，为新 Swipe 排队后台变量结算。
9. 返回包含新 `swipeId` 的视图。

替换节点必须包含当前正文，不能再使用 `content: []`。内部重新生成指令和合成 turn 保留在事件日志中，但不进入后续模型上下文。

## Swipe 切换时序

1. 确认当前没有正文生成或重生成，并验证 `messageId` 是最后一条助手正文。
2. 验证 `swipeId` 存在；若选择未变化，幂等返回。
3. 只更新 Chat 的当前 `swipeId`、正文投影字段和生命周期 revision，不修改 Session Surface。
4. 触发 `MESSAGE_SWIPED`，使用该 Swipe 自己的变量槽位和展示投影。
5. 旧 Swipe 的后台结算自动过期；当前 Swipe 尚未结算或回执过期时，为它重新排队结算。

用户可以在发送下一条消息前反复切换。无论切换多少次，都不产生 Session 事件；只有最终选择需要固化。

## 下一轮发送前固化

`synchronizeTailSwipeSurface()` 必须位于新玩家消息进入 Session 之前：

1. 读取当前尾部 `{ messageId, swipeId, text }`。
2. 读取当前 Session Surface 的最后一条剧情助手正文。
3. 若其内容已经等于所选 Swipe 的 `sessionText`，直接返回，不追加事件。
4. 若不同，追加一条非空 assistant 替换节点，仅替换当前尾部助手节点；内容为最终选中 Swipe 的 `sessionText`。
5. 前台随后才可追加新玩家消息并开始模型请求；运行中的正文 operation 会锁定 Swipe 切换。

发送开始后，前一轮 Swipe 锁定。生成期间收到针对该楼层的切换请求时，返回明确的“该 Swipe 已进入剧情历史，请先回退本轮”错误。

这个顺序只改变最后一条 assistant，之前的请求前缀保持稳定。切换最终选择导致尾部缓存失效是正确性所必需的；用户未发送前的反复切换不消耗缓存。

## 失败与恢复

Chat 和 Session 是两个存储，不能声称跨存储原子提交。采用“Chat 权威、发送前修复”的顺序：

- 模型生成失败：不新增 Swipe，不替换有效 Surface。
- Chat 提交失败：不采用模型新正文，Surface 保持原选择。
- Chat 已提交但 Surface 替换失败或进程重启：保留 Chat 选择；下一次 `synchronizeTailSwipeSurface()` 根据当前 `swipeId` 修复 Surface。
- Surface 已固化但新玩家消息尚未追加时重启：再次同步得到幂等结果。
- Swipe 在后台结算期间改变：旧任务返回 stale，不写入；当前 Swipe 重新结算。
- 下一轮已经开始：拒绝旧楼层 Swipe 切换，不能在有下游剧情时改写上游。

Chat 应保存足以判断投影是否一致的尾部选择事实；优先复用已有 `messageId`、`swipeId`、正文和 lifecycle revision，不为可重建的 Session 状态增加第二份存档。

## 现有数据迁移

不改写旧 Session 事件。对于已经存在“空重新生成墓碑”的对话：

1. 从 Chat 最后一条助手消息读取当前 `swipeId`；
2. 在下一次发送前发现 Surface 缺少该正文；
3. 追加一条包含当前 Swipe `sessionText` 的尾部替换节点；
4. 后续按新规则运行。

该修复是幂等投影恢复，不需要批量迁移用户存档。

## 非目标

- 不修改回退实现。
- 不支持切换任意历史楼层的 Swipe。
- 不把未选 Swipe 注入模型上下文。
- 不把重新生成迁移到临时 Session 或新 Agent。
- 不重写、删除或重排既有 Session 事件。
- 不改变 MVU“后台结算、不向前台注入变量”的原则。

## 验收标准

### 生产接口测试

1. 重新生成 2 号 Swipe 后，下一轮最终模型请求包含 2 号正文，不含旧正文和内部重新生成指令。
2. 在 1、2 号之间反复切换但不发送，不新增 Session Surface 事件。
3. 最终切回 1 号再发送，下一轮请求包含 1 号正文，不含 2 号正文。
4. 同一选择重复同步不追加事件。
5. 下一轮发送后切换旧 Swipe 被明确拒绝。
6. 结算 1 号期间切到 2 号，1 号结果 stale，2 号按自己的变量槽位结算。
7. Chat 提交后模拟 Surface 写入失败或重启，下一轮发送前能够自动修复。
8. 旧空墓碑对话无需迁移即可在下一轮发送前恢复当前正文。
9. 回退现有测试保持不变，并继续证明空 assistant 不进入 `Session.deriveMessages()`。
10. 模型请求中，所选尾部之前的消息序列与哈希保持不变。

### 运行时验收

- 在真实对话中生成至少三个 Swipe，按 `1 → 3 → 2` 切换后继续游玩；捕获最终模型请求，确认只包含 2 号正文。
- 切换期间重启 DSH，继续发送后模型仍看到重启前最终选择。
- 在变量结算运行中切换 Swipe，界面不显示旧 Swipe 的变量回执，新 Swipe 能完成结算。
- 回退最后一轮后继续发送，最终模型请求不包含被回退的玩家输入、正文或空 assistant。
- 完整测试、`git diff --check` 和真实浏览器交互通过。
