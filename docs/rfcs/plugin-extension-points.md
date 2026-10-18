# RFC：为独立维护的插件开放舞台/轮次/上下文扩展点

状态：提议，欢迎讨论；本文不代表已经发布的 API 或实现承诺。

## 背景与边界

我们在一个偏 Galgame 体验的分支中实现了增量舞台导演、跨轮持续状态、素材包、开场演出、对话气泡与 TTS 缓存，希望将这些能力迁为独立维护的插件，而非长期修改 Tavern 的宿主、领域编排和正文渲染器。这里请求的是可复用的扩展边界，不是把整套演出逻辑或界面偏好合入本体。

上游已经有充分的插件基础：[插件接口](../plugin-api.md)提供 `registerStageView`、`getStage` / `watchStage`、`registerPanel`、`registerMediaRenderer`、`registerMessageAction`、`registerComposerAction`、`registerStartGroup`、`registerCardListView`。宿主侧已有轮次读取、插件数据与媒体、任务、正文/候选/压缩及结算说明、结算工具和 `replaceSettlement`，也有 `onTimelineChanged`、分叉时复制插件数据/媒体、按 `textVersion` 拒绝过期写入。`readCardRaw` / `updateCardRaw`、Skill 读写和 `speechProvider` 也应继续复用。

因此，本 RFC **不是重新申请插件系统、自定义舞台或时间线通知**。缺口是这些能力之间的一份共享权威状态合同、可参与的变更生命周期，以及内置 UI 的稳定组合点。遵循[领域契约](../../CONTEXT.md)与[架构](../architecture.md)：Story Timeline 仍是唯一剧情真相；插件不另建权威时间线，不直接写原生日志，不以浏览器挂载/卸载作为持久化依据。

## 建议接口

以下所有签名均为**提议的接口草图**，不是可直接调用的现有 API；名称、归属和类型可随讨论调整。能通过扩展现有接口达成的，不必另设同义入口。注册函数返回撤销函数；跨进程传输仍走现有宿主/浏览器边界。

### P0：先稳定状态、事务与输入

**P0-1：舞台快照与增量生产者。** 现有舞台读取/替换渲染能力无需重做，但增量导演还需要冻结的素材目录/上下文、检查点、可展示前缀和跨轮状态。建议：

```ts
stage.getSnapshot({ gameId, turn })
  -> { sourceToken, persistentState, presentableThrough, beats }
stage.subscribe(gameId, listener) -> dispose
registerStageProducer({ id, prepare, update, commit, discard }) -> dispose
```

`sourceToken` 是宿主签发的不可由插件拼装的版本标识，至少绑定分支、revision、正文版本和轮次。`prepare` 接收只读快照及冻结的目录/上下文；`update` 返回绑定该 token 的增量与检查点；`commit` / `discard` 跟随宿主事务。`presentableThrough` 表示同一源版本中已确认可展示的连续演出前缀，订阅不暴露未完成的半份状态；最终持久快照在权威提交后发布。迟到的更新必须拒绝。

服装、站位、背景和 BGM 等持续状态遵循“省略即保持”，只有显式变更才清除或替换。刷新、换轮、重挂载不等于重置；历史查看或跳过不补播一次性动作。素材失效可以在展示投影中降级，但不改写历史。

**P0-2：现有轮次事务的参与者。** `onTimelineChanged` 与现有分叉复制很有价值；需要补充的是准备、权威提交、失效和分叉之间的确定顺序，让舞台、媒体与插件派生状态同步，而非各自监听后补救。

```ts
registerTurnParticipant({ id, prepare, commit, invalidate, fork }) -> dispose
// 回调上下文：{ transactionId, operation, oldSourceToken, newSourceToken }
// prepare / fork 返回：仅属于当前插件命名空间的 effects
// invalidate 额外携带：被废弃的 sourceTokens
```

宿主沿用已有事务或 journal ID，校验并纳入准备阶段的效果；权威提交成功后才调用 `commit`。回退、重生成、撤销和分叉均由同一合同驱动；失效回调用于取消任务、释放资源和撤下旧投影。通知重放以事务 ID 幂等处理。准备失败不发布该插件的效果，提交后通知失败不回滚已提交的剧情。具体持久化方式留给上游，但不可留下“剧情已回退、插件仍指向旧版本”的可见状态。P0-1 的生产者应建立在此合同上，而不是第二套事务系统。

**P0-3：共享投影与上下文寿命。** 复用现有正文、候选、结算等注入入口，补齐一致的只读输入和缓存寿命，避免插件把任务元数据误当完整上下文，或自行读 raw 后各自裁剪。

```ts
registerContextContributor({ id, purposes, lifetime, contribute }) -> dispose
contribute({ projection, expectedSourceToken, frozenTools })
  -> { sections: [{ name, order, text, utf8Bytes }], toolRefs, toolSchemaBytes }
// lifetime: 'session' | 'compaction' | 'per-turn'
```

`purposes` 声明正文、候选、导演等使用方；宿主提供已经投影的上下文，任务启动时统一校验来源。会话/压缩周期内的稳定前缀保持字节不变，逐轮补充用于需要动态相关性的后台任务；工具定义引用冻结版本。分节字节统计用于衡量新增提示词成本，不要求每个插件另造上下文规划器。

**P0-4：带版本约束的卡扩展编辑。** 已有 `updateCardRaw`，建议在现有卡编辑器上补充 expected revision 与受限扩展校验/事务参与能力，而不是开放任意文件写入。

```ts
cards.editRaw({ path, expectedRevision, patch }) -> { revision, projection }
cards.registerExtension({ namespace, validate, prepare, commit }) -> dispose
```

`path` 由宿主解析为已授权卡资源，不是任意文件系统路径；也可沿用现有 `card` 参数。插件仅可修改自己的扩展命名空间，素材绑定、开场配置和变量绑定共用卡锁、队列、未知字段保留与变更通知。素材 revision 与 raw 修改必须在同一编辑边界校验；冲突返回 `REVISION_CONFLICT`，不能覆盖后来编辑。

### P1：减少界面与媒体接线补丁

**P1-1：内置界面的组合点。** 独立 panel 与替换卡列表不等于向内置状态页/设置页添加内容；完整重画页面又容易漏掉上游新增功能。

```ts
registerStatusSection({ id, render }) -> dispose
registerSettingsSection({ id, render }) -> dispose
registerStatusRenderer({ id, render }) -> dispose
registerCardImporter({ id, extensions, priority, probe, importCard }) -> dispose
// render props：{ owner, session, busy, error, save, sections? }
```

`owner` 由宿主提供；保存动作仍由授权宿主执行。状态页 renderer 接收并组合已有 sections，保留固定面板等内置能力。导入器声明扩展名及探测优先级，原生 `.charx` / `.dshcard` 优先交回原生入口，不因都带 ZIP 文件头而抢占。开场配置 UI 也可使用这些组合点，无需再造舞台或卡列表注册接口。

**P1-2：完整轮次的展示生命周期。** 气泡、开场和持久 iframe 需要完整轮次归属与资源保留规则；局部 marker/media renderer 无法独自解决。

```ts
registerTurnPresentation({ id, render, retain, release }) -> dispose
// render 输入：{ turnProjection, sourceToken, closingStepOwner,
//                opening: 'preview' | 'committed' | null, historyVisible }
retain({ sourceToken, resources }) -> lease
release(lease)
```

只读 canonical turn projection 明确由哪个 closing step 承载整轮展示，避免多个 step 重复挂载。允许套展示 wrapper，不替换权威正文。资源 lease 有界，历史不可见、撤回、源版本失效或卸载时释放；预览开场不能写成已提交演出。

**P1-3：复用媒体存储而非再造 CAS。** 卡素材包、演员资源与插件媒体需要共享存储归属和引用生命周期，不只是能读到文件。

```ts
mediaStore.put(input) -> mediaRef
mediaStore.resolve(mediaRef) -> resource
mediaStore.materialize(mediaRef, target) -> resource
mediaStore.commitRoots({ transactionId, roots })
mediaStore.lease({ refs, sourceToken }) -> lease
```

这是一组可注入的宿主存储能力，目标位置必须受宿主约束。媒体 ID 对应完整引用；保留业务层 pack/asset UUID，root 发布衔接现有编辑事务。统一 owner 检查与鉴权 GET/HEAD/Range，插件不绕过访问边界获取裸文件路径。不要求另一套 CAS，也不要求读取已存资源时重复计算哈希。

### P2：完善配音与安装扩展

**P2-1：配音身份与取消合同。** 优先扩展现有 `speechProvider`，让 TTS 缓存成为 provider，而不是另起一套轮次监听。

```ts
// 拟议补充到现有 provider 的 synthesize 输入/返回值
synthesize({ speakerId, utteranceId, sourceToken, text, voice, signal })
  -> { audioRef, lease, dispose }
```

规范 speaker/utterance 的 canonical identity，使增量导演片段、音频缓存和正文版本一致；沿用停止播放能力，明确取消、失效及卸载释放规则。缓存身份还须包含音色及合成参数。先统一身份与生命周期，再讨论 UI；不要求自动迁移或重新合成现有语音缓存。

**P2-2：内置 Skill 来源与本地安装策略。** 用户 Skill 读写不完全覆盖内置来源优先级；插件也不能自行修补启动器。

```ts
registerBuiltinSkillSource({ root, priority, scope }) -> dispose
// 拟议宿主配置（非浏览器 API）：
{ updatePolicy: 'managed' | 'local-checkout', pluginSourceRoot, dependencyAnchor }
```

Skill 根目录限定在宿主授权范围，明确来源优先级和作用域。源码根与依赖定位由宿主配置，安装更新采用显式策略；远程更新不得覆盖本地 Git checkout。这部分可以独立讨论，不阻塞舞台与事务合同。

## 共同要求与建议落地顺序

- 在现有 `apiVersion` 基础上提供可查询的能力版本；所有注册可撤销、卸载自动清理，缺少能力时插件明确停用对应功能。
- owner 从宿主插件作用域取得，不相信浏览器传入的身份；沿用同源鉴权及 card/game 访问边界。
- 扩展错误只隔离该扩展，不中断基础游玩，也不把旧版本结果“尽量”写入。只标准化真实边界错误，如版本冲突、资源不可用、无权限，不增加庞大的兼容层。

建议先共同确定 **P0-1/2 的一份 snapshot/transaction 合同**，再迁移增量导演和舞台运行时；随后稳定 **P0-4/3 的 editor/context 边界**，最后迁移 **P1 的 UI 与媒体接线**，按需补齐 P2。每完成一块就移除对应本体补丁，以插件是否无需访问内部模块、差异是否实际缩小来验收。

首批验证可聚焦：跨轮持续状态不重置；回退/重生成后迟到结果被拒绝；分叉不串写；卡并发编辑冲突；稳定前缀字节不漂移；历史展示与卸载释放资源。该 RFC 只讨论接口，不要求更改现有存档格式，也不要求新增逐卡功能开关；演出选择可继续由素材条目和插件全局设置表达。

希望优先讨论：哪些约束可直接补入现有 API，以及事务参与与舞台快照的最小边界。接口名称和后续 UI 细节可以在核心合同达成共识后逐项确定。
