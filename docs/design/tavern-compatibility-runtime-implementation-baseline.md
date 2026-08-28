# 酒馆兼容运行时实施基线

> 固定日期：2026-08-28
>
> 状态：第一阶段实施门槛已满足

## 固定上游

| 组件 | 固定提交 | 许可证 | 当前复用决定 |
| --- | --- | --- | --- |
| SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`（release） | AGPL-3.0 | 行为规范与差分基准；不整体搬入 |
| MagVarUpdate | `0a730cd4a9b99689d1135a49b542c780b977c24c` | MIT | 允许受控移植；保留许可证和来源 |
| ST Prompt Template | `9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d` | AGPL-3.0 | 先建立 Adapter 与行为测试；是否复制源码单独审查 |
| Tavern Helper / JS-Slash-Runner | `4dd4b873f191accb5dd933089ddf36b846458585` | AFPL | 不整库复制；先实现宿主接口和可观察行为 |

固定提交是回归测试基线，不表示以后永不升级。升级必须单独变更版本、兼容矩阵和真实卡回归结果，禁止继续使用无 ref 的 CDN 地址作为权威代码。

## 代码边界

新增一个 `Tavern Compatibility Runtime` 深模块，现有兼容请求编译器和 UI 不直接理解 MVU、EJS 或 Helper 的内部细节。

初始 seam：

- `initializeChat`：解释人物卡开场白、`<initvar>`、世界书初值和所有开场 swipe；
- `settleResponse`：对原始助手输出执行 MVU 命令、事件和变量快照结算；
- `renderMessage`：在状态已结算后执行显示正则和 Helper UI 投影。

接入位置：

1. `startChat` 调用 `initializeChat`，保存开场消息及全部 swipe 的变量快照；
2. `turn-orchestration.finalize` 在显示投影之前调用 `settleResponse`；
3. `reply-presentation` 只读取结算结果，不成为权威状态源；
4. 后续 EJS 与 Helper 继续进入同一模块，由 DSH Adapter 提供模型、消息、存储、网络和 UI 能力。

单项兼容资产失败时返回诊断并保留原始消息，不得让整轮生成或聊天损坏。

## 消息与 Swipe 映射

保持现有 `sourceText`、`projectionText`、`displayText` 三层不变，并补充酒馆兼容状态：

```text
message
├── sourceText                 原始/宏处理后的权威消息文本
├── projectionText            发送侧投影
├── displayText               显示侧投影
├── swipeId                   当前选中的 swipe 下标
├── swipes[]                  每个候选的 sourceText
└── variables[]               与 swipes 一一对应的 MVU 快照
```

`variables[swipeId]` 是该楼层当前分支的权威状态。下一条消息从此前最近一个有效快照克隆后结算。切换 swipe、重新生成、删除或回退消息时通过消息快照恢复，不能只修改一棵聊天级全局对象。

旧聊天没有这些字段时按单 swipe 读取，并在发生新结算时渐进补全；未知字段原样保留。

## MVU 最小宿主

官方 MVU 第一阶段所需宿主能力为：

- 当前聊天消息和选中 swipe；
- YAML/JSON 与 MVU 命令解析；
- 深路径读写、数组插入/删除/移动和数值增量；
- `VARIABLE_INITIALIZED`、`VARIABLE_UPDATE_STARTED`、`COMMAND_PARSED`、`VARIABLE_UPDATE_ENDED`、`BEFORE_MESSAGE_UPDATE` 事件；
- 人物卡内嵌世界书与 `<initvar>` 读取；
- 宏上下文；
- Schema/变量守卫的事件接入点；
- 状态栏占位符与显示生命周期。

额外模型解析、设置面板和广泛 Tavern Helper API 不属于第一笔 MVU 核心提交，但接口必须允许后续加入，且不能改变已经持久化的消息/Swipe 状态形状。

模型输出中的非 JSON JavaScript 表达式是兼容风险点。它只允许在隔离执行环境中求值，不得用 Node 主进程的 `eval` 或 `new Function` 直接执行。

## 《灯火阑珊》验收基线

真实卡只作为本机回归语料，不把整张卡及 CG 复制进仓库。测试至少观察：

1. 能发现卡内 MVU、变量结构、动态世界书、变量守卫和状态栏五个 Helper 脚本；
2. 开场白中的 `<initvar>` 优先于世界书初值，并为每个开场 swipe 建立独立快照；
3. 前台模型输出的标准 MVU 命令更新当前消息的对应 swipe，不污染上一楼层；
4. 下一轮请求保留原始正文和卡内 MVU 协议所要求的上下文；
5. 状态占位符在变量结算后进入显示正则，状态栏读取选中 swipe 的变量；
6. 切换 swipe、回退和失败命令后，状态与 UI 回到对应快照；
7. 动态世界书、变量守卫或状态栏脚本单独失败时，正文仍可保存和继续对话。

自动化测试使用可提交的最小合成卡；若本机存在《灯火阑珊》资源，再运行真实卡集成测试。最终“完整支持”必须以固定 SillyTavern 基线的同输入差分结果为准，不能以单测通过代替。

## 首轮实施顺序

1. MVU 解析、初始化、消息/Swipe 快照和生命周期事件；
2. `startChat` 与 `finalize` 接入，并完成真实卡状态结算；
3. 最小 Helper 宿主，让状态栏和卡内变量读取脚本运行；
4. ST Prompt Template / EJS；
5. 继续按《灯火阑珊》的实际缺口补齐动态世界书、变量守卫与 UI 生命周期。

## 当前实施结果

截至 `e46f344`，上述首轮顺序均已形成可运行实现：纯前台请求保留卡内 MVU 规则，Host 结算标准补丁并保存消息/Swipe 快照；隔离 Helper Host 常驻运行非 Host 接管脚本；动态世界书能够在发送前修改绑定世界书；变量守卫能够在 `COMMAND_PARSED` 阶段改写命令后再交还 Host 执行；状态栏能够读取结算后的变量并加载远程 CG。

当前仍统一标记为“受限支持”，因为尚未完成固定 SillyTavern 基线的同输入、同输出差分。默认隔离模式不开放父页面同源 DOM；用户可在设置中显式开启“受信任人物卡模式”，使人物卡消息界面和常驻 Helper iframe 获得同源父页面能力。详见[《灯火阑珊》MVU 兼容链路验收](../research/lighthouse-mvu-compatibility-e2e-2026-08-28.md)。

常驻 Helper 脚本按会话实行服务端租约：同一会话即使被多个浏览器窗口同时打开，也只有一个浏览器获得脚本执行权；其余窗口继续显示消息 UI，但不重复运行动态世界书和变量守卫。所有者停止续租后，其他窗口可接管。

人物卡 Helper 脚本和显示正则中的 jsDelivr GitHub 浮动引用在运行投影前锁定为固定提交，并写入独立 Profile 记录；原卡保持无损。解析失败时禁用对应运行时脚本并显示诊断，避免继续执行未知版本。该机制不等于远程文件内容缓存，离线运行和递归依赖锁定仍是后续范围。

正文重新生成已改为 SillyTavern 风格的 Swipe 语义：旧正文和旧 MVU 快照留在原楼层，新正文及其快照追加为新的选中 Swipe；生成前后分别向 Helper 发出 `MESSAGE_SWIPED` 与 `MESSAGE_RECEIVED(messageId, 'swipe')`，并抑制中间回滚投影产生的伪删除事件。

所有多候选助手消息现在都在消息楼层提供 Swipe 切换，不要求人物卡启用 MVU。切换会选中对应正文，并在 MVU 卡中同步恢复同下标变量快照，再触发 Helper 的 `MESSAGE_SWIPED` 生命周期。内置世界书写入按人物卡串行；资源扫描排除 durable write 的锁与待恢复文件，损坏锁也可安全回收，避免生命周期脚本把内部锁误识别成人物卡后永久阻断写入。

“回退本轮”在恢复 checkpoint 并持久化消息后，会按固定 SillyTavern 基线以删除后的消息总数发出一次 `MESSAGE_DELETED`。显式生命周期修订号抑制浏览器根据消息数量变化再次推导同一事件，避免动态世界书重复结算。

消息 iframe 与常驻 Helper 的变量/消息写入均携带其观察到的生命周期版本。Swipe 或回退推进版本后，迟到的旧 iframe 写入会被判为 `stale`，只返回最新上下文而不再尝试覆盖权威状态；同版本的真实字段冲突仍明确报错。

DSH `surface replace` 只负责恢复模型消息面；DSH 的人类 transcript 按设计仍展示追加来源事件。因此，正文重生成产生的合成回合以及被回退的回合，另由 Tavern 对话中的 `suppressedDshTurns` 持久记录并投影到界面。折叠结果在刷新和换窗口后仍成立，不再依赖当前浏览器的 `localStorage`；旧版本留下的本地隐藏记录仅作为历史会话兼容回退。

显示与发送正则继续按固定 SillyTavern `8172dcd` 的可观察语义收敛：`trimStrings` 只过滤被替换引用的匹配内容，不会误删替换模板中的固定文字；命名捕获组 `$<name>` 与缺失捕获组的空串行为已经纳入自动化回归。

人物卡声明的 Tavern Helper 可见按钮现在由酒馆状态页承载，事件名沿用上游 `script_id + "_" + getStringHash(button_name)`。Helper iframe 提供最小 `getCharData()` 与 `SillyTavern.Popup` 兼容面；脚本通过 `setChatMessages()` 写入成功后，宿主会刷新权威对话投影。真实《灯火阑珊》“开场白索引”已能列出全部 15 个 Swipe，并在不刷新页面的情况下切换开场、变量快照和状态栏。

MagVarUpdate 固定基线的命令差分切片现在还覆盖无前导斜杠路径、`add` 参数校验、`COMMAND_PARSED` 的 insert/move 参数形状、上游固定版本的 mathjs 表达式、数字字段接收引号数字时的强制转换，以及点分字段引号和带空格 bracket 的常见路径修正。它用于逐步收窄差异，不代表已经运行官方整包或完成全量差分。
