# 人物卡自带 `phone-ctn` 小手机调研

日期：2026-09-05
DSH 基线：`2668f4e07af75860dfbd5d5ba5568599155da167`

## 结论

本次截图中的小手机不是 DSH 自研手机，也不是 `st-yuzi-phone`。它来自人物卡内置的 Tavern Helper 脚本：脚本运行时远程导入 `https://phone-ctn.pages.dev/index.js`，由 `phone-ctn` 自己渲染界面、组装上下文、请求模型并保存手机消息；DSH 提供脚本执行环境、酒馆 API 兼容面和状态栏承载位置。

它在玩家尚未发送第一条剧情消息时就能聊天并不神秘：选择人物卡、创建游戏后，DSH 已经创建 Chat，并把人物卡开场白保存成第一条 assistant 消息。手机读取的是这个已存在的 Chat、人物卡设定、世界书和 `phone_data`，不要求先有一条 user 剧情消息。

当前实现的手机记录也不是严格独立的数据库。私聊回复会包装成 `<chat_history target="人物名" type="private">...</chat_history>`，通过 `createChatMessages` 新增 assistant 楼层，或通过 `setChatMessages` 追加到最后一层。其他手机模块可能写成 `<phone_module type="...">...</phone_module>`。这些内容之后仍可被 `getChatMessages` 读回。

因此，现阶段最合理的产品判断仍是：**优先兼容人物卡自带手机，不承诺不同手机实现都具有相同能力，也不把它们误称为 DSH 原生游戏系统。** 若以后要提供 DSH 原生手机，应重新定义强隔离的消息、上下文和持久化协议，而不是继续扩大兼容脚本对主聊天的读写权限。

## 调研对象与证据边界

本次以导入后的 `岁岁年年` 人物卡和 2026-09-05 当时在线的 `phone-ctn` bundle 为样本。

| 对象 | 本次确认的事实 |
| --- | --- |
| 人物卡 | 内置启用脚本 `Abstract外置手机_热更新cloudflare`，内容为 `import 'https://phone-ctn.pages.dev/index.js'` |
| 人物卡数据 | `tavern_helper.variables.phone_data` 包含 `user`、`characters`、`groups`、`backgrounds`、`fonts`、`map`、`music` 等手机初始化资料 |
| DSH Chat | 初始快照已有 1 条 assistant 消息，正文长度 1064；这条消息就是人物卡开场白 |
| 远程 bundle | 2026-09-05 获取约 3.29 MB，SHA-256 为 `4114f63d851b1c4b96c0be8faf629c98d90675b39027d18d9f5cc5836244581d` |
| HTTP 响应 | `cache-control: public, max-age=0, must-revalidate`，ETag 为 `131e516f5b3eacbea4de3f0fd42f329c` |

远程地址是可变的 Cloudflare Pages URL，不是固定提交地址。这里记录的函数、提示词和哈希只是调研当天的快照；上游可以在人物卡和 DSH 均不变的情况下替换 bundle。

本次做了源码、导入资源和持久化快照核对，没有抓取一次真实手机模型请求的最终 HTTP body，也没有覆盖 `phone-ctn` 的每一个页面。文中“会进入最终模型请求”的内容，以 bundle 的组装代码为依据；若要把它升级为运行时事实，还需要在去除密钥后的真实发送边界抓包验证。

## 三个容易混淆的系统

| 系统 | 谁提供 | 当前作用 | 是否就是截图中的手机 |
| --- | --- | --- | --- |
| 人物卡自带 `phone-ctn` | 人物卡作者与远程 bundle | UI、联系人、提示词、模型请求、消息解析和手机记录读写 | 是 |
| DSH Tavern Helper 宿主 | DSH | 加载卡片脚本，提供人物卡、消息、世界书、变量、存储等兼容 API，并把卡片 UI 承载到状态栏 | 是它的运行宿主，不是手机业务本身 |
| DSH 自研手机 | DSH | 仓库中仍保留 `phoneChat`、联系人和独立模型请求实现 | 否；当前产品界面明确不挂载 |

另一个曾调研的 `yuzi83/st-yuzi-phone` 也不是这个系统。它有自己的 QQ、数据库桥和 IndexedDB 设计，不能用它的结论替代 `phone-ctn` 的实际行为。

## 挂载链路

当前链路可以概括为：

```text
导入人物卡
  ↓
DSH 读取 Tavern Helper 脚本与 phone_data
  ↓
人物卡脚本 import phone-ctn.pages.dev/index.js
  ↓
phone-ctn 在人物卡脚本运行环境创建 UI
  ↓
DSH 把人物卡应用承载到酒馆状态面板
  ↓
phone-ctn 通过 Tavern Helper API 读写消息、世界书和变量
```

因此“手机挂到了 DSH 网页上”并不是 DSH 重新实现了这个 App。更准确地说，是人物卡脚本在受控浏览器环境中创建了界面，DSH 再把这份界面投影到状态面板。

这也解释了为什么不同人物卡的小手机千差万别：它们可能使用不同脚本、DOM、数据结构、远程资源、模型后端和保存方式。宿主兼容 API 能提高运行率，但无法自动把所有手机变成同一种产品。

## 为什么没开始游戏也能聊天

界面上的“还没开始游戏”通常只表示玩家尚未发送第一条 user 剧情消息，并不表示系统中没有 Chat。

选择人物卡后已经发生了这些事：

1. DSH 创建 Tavern Chat 和对应 Session。
2. 人物卡开场白成为第一条 assistant 消息。
3. 人物卡设定、绑定世界书、玩家资料和 `phone_data` 已经可读。
4. 人物卡脚本开始运行，手机联系人和页面可以初始化。

本次检查的初始快照正好只有一条 assistant 开场消息。`phone-ctn` 只需要这些资料便能发起独立私聊请求，不需要等待玩家先推动正文剧情。

## 手机回复的请求链路

`phone-ctn` 的刷新操作并不是“让 DSH 前台 Agent 继续回复”。它会筛选手机 UI 中尚未处理的我方新消息，然后调用自己的私聊生成函数。

```text
用户在手机 UI 输入消息
  ↓
phone-ctn 收集 isNewMessage && isMe 的消息
  ↓
组装手机专用 prompt 和历史
  ↓
读取 phone_api_config
  ↓
直接 fetch OpenAI/Gemini 兼容模型端点
  ↓
解析模型返回的手机消息格式
  ↓
写回 <chat_history> 或 <phone_module>
```

如果用户没有新消息却点击刷新，当前 bundle 会给模型一条“我方没有回复，让对方继续发送消息”的任务。因此联系人可能主动连续发消息；这些消息不是从主剧情 Agent 自动冒出来的，而是手机自己的模型请求生成的。

手机使用保存在浏览器侧的 `phone_api_config`，包含 API URL、模型、格式、温度等配置。密钥属于敏感信息，本次没有读取或记录。由于请求由卡片脚本直接发出，DSH 前台 Agent 的轨迹不一定出现这次调用，DSH 的模型缓存、工具限制和请求诊断也不一定覆盖它。

## 上下文如何拼接

调研当天的 bundle 默认按以下模块组织私聊请求：

| 模块 | 内容来源 |
| --- | --- |
| 自定义 system 块 | 手机预设内配置的系统要求 |
| `worldbook-before` | 当前绑定世界书中符合手机前置命名约定的条目 |
| `char-description` | 当前人物卡 description |
| `persona-description` | 玩家 persona description |
| `history` | 当前 Tavern Chat 历史；默认最多 100 条，排除 system、包含 user，并移除配置的思考标签 |
| `worldbook-after` | 当前绑定世界书中符合手机后置命名约定的条目 |
| `user-character-info` | `phone_data` 中的用户资料与目标联系人资料 |
| `character` | 人物卡角色资料，以及标题匹配 `<人物|姓名>` 的世界书条目 |
| `page` | 标题匹配 `<页面|页面名>` 的世界书条目 |
| `format` | 私聊输出格式、媒体、贴纸和图片库约束 |
| `input` | 本次我方新消息；没有新消息时则是让联系人主动继续发送的任务 |

世界书的特殊标题约定包括 `<前置>`、`<后置>`、`<人物|姓名>` 和 `<页面|页面名>`。它们是 `phone-ctn` 自己实现的一套召回协议，不等于 DSH 正文 Agent 的世界书召回规则。

当前代码还会读取最新消息、Chat 变量、人物变量和全局变量，用于世界书条件判断。世界书条目的 `enabled` 状态是否在这条自定义扫描链路中得到完整尊重，单凭本次静态检查不能给出运行时保证；应在最终请求抓包中专门验证“禁用但标题匹配”的条目没有进入模型。

## 手机记录保存在哪里

对这个 `phone-ctn` 实现，答案是：**保存在 Tavern Chat 楼层中，而不是 DSH 的独立手机数据库。**

私聊大致保存为：

```xml
<chat_history target="联系人" type="private">
  ...手机消息...
</chat_history>
```

其他应用数据可能使用：

```xml
<phone_module type="模块名">
  ...模块数据...
</phone_module>
```

保存有两条路径：

- 默认可通过 `createChatMessages` 在末尾增加新的 assistant 楼层。
- 启用“追加到最后消息”类配置时，通过 `getChatMessages` 取得最后楼层，再用 `setChatMessages` 把块追加进去。

重新加载手机时，脚本再次调用 `getChatMessages`，从这些标签块还原手机记录。DSH 当前提供了这些兼容 API，所以手机可以跨刷新恢复。

这里必须区分“显示上独立”和“数据上独立”：手机 UI 按联系人展示独立会话，但底层原始内容仍在主 Chat 中。DSH 仓库里那套未挂载的自研手机才使用 `chat.phoneChat` 独立字段；它与本次截图无关。

## 上下文隔离问题

`phone-ctn` 在 UI 和输出格式上区分联系人，但它的 `history` 模块会读取最多 100 条 Tavern Chat 原始历史。这形成了几类风险：

1. 主剧情会进入手机上下文；这是手机能理解当前故事的来源，也是上下文膨胀来源。
2. 其他联系人的 `<chat_history>` 也可能随原始历史一起被读到。
3. `<phone_module>` 等手机内部楼层也可能再次进入后续请求。
4. 被正则隐藏或仅从显示层移除的文本，仍可能存在于原始消息中；显示正则不是安全边界。
5. 提示词可以要求“不同私聊不要共享”，但这是模型软约束，不是宿主级数据隔离。

所以当前实现可以说“视觉上和格式上是私聊”，不能说“技术上保证各联系人私聊互不可见”。若人物卡涉及秘密信息、多人博弈或不同角色知识边界，这一点会直接影响玩法正确性。

## 远程代码与可复现性

人物卡导入的是可变的 Cloudflare Pages 地址。DSH 当前的远程资源锁定模块主要识别固定或可解析的 jsDelivr GitHub 引用，这个 Pages URL 不在该锁定协议内。

由此带来三个问题：

- 同一人物卡今天与下周可能加载不同代码。
- 上游更新可能改变宿主 API 需求、模型请求、存储格式和 UI，而本地没有 commit 变化。
- 离线、网络受限或上游故障时，手机可能整体不可用。

本报告记录 bundle 哈希只是为了复盘，不代表 DSH 已自动固定该版本。若 `phone-ctn` 成为正式兼容目标，应保存“URL + 内容哈希 + 获取时间”，并考虑由用户显式接受更新，而不是每次无感加载最新版。

## 与 DSH 架构的关系

从原生 LLM 游戏角度看，小手机属于 Game View：它应该展示受控投影，并把玩家操作转换成 Command，不应自己拥有世界状态权威。但当前人物卡手机继承的是酒馆生态的脚本模式：View 同时负责上下文拼装、模型调用、消息解析和持久化。

兼容阶段可以接受这种结构，但应保持边界诚实：

- DSH 负责兼容宿主能力和安全边界，不负责保证第三方手机的业务逻辑正确。
- 人物卡脚本写入的标签楼层是兼容数据，不应被误认为 DSH 原生状态模型。
- DSH 不应为了兼容某一张卡，悄悄改变 Story Timeline、MVU 或后台 Agent 的权威关系。
- “脚本成功加载”只证明执行入口存在，不证明图片、字体、模型、上下文、保存和刷新全链路均兼容。

## 后续建议

短期继续采用“人物卡自带手机优先”的路线，但把承诺限定为宿主兼容：

1. 在诊断日志中显示手机脚本来源、远程 bundle 哈希、缺失 API 和最近一次模型/保存错误，但不记录密钥与消息正文。
2. 为 `phone-ctn` 建立一个不含私密剧情的固定测试卡，覆盖开局加载、图标、私聊发送、无输入刷新、保存、切换对话和重启恢复。
3. 在去除凭据的发送边界捕获最终请求，验证世界书 enabled、联系人隔离、隐藏文本和历史上限。
4. 对可变远程入口增加内容固定或更新确认机制，避免无感漂移。
5. 不把兼容手机数据自动纳入 MVU 状态结算；若剧情需要消费手机事件，应通过明确的领域 Command 或投影规则进入世界状态。

若将来重启 DSH 原生手机项目，建议定义独立协议：

- 每个联系人独立 thread 和持久化空间。
- Host 只提供当前 branch/revision 下允许披露的剧情摘要、角色知识和目标私聊历史。
- 手机 Agent 不能直接读取其他联系人原始记录。
- 回复先形成 Phone Message Event，再由显式规则决定是否影响剧情、变量或世界书。
- UI 只是事件与状态的投影，可更换皮肤而不迁移业务数据。

这条路线比“把任意人物卡手机自动转换成 DSH 手机”可靠，但属于后续原生 LLM 游戏能力，不应与当前兼容工作混在一起。

## 代码与数据证据

- 人物卡脚本加载与 `phone_data`：本机导入资源 `年年岁岁.json`，本报告仅记录结构和脚本入口，不复制人物卡正文及隐私数据。
- 初始 Chat：本机 `岁岁年年` 的 `000000000001.json` 快照，仅核对角色、条数和长度，不复制剧情正文。
- DSH 状态面板说明：[tavern-plugin/src/client/main.js](../../tavern-plugin/src/client/main.js)，`TavernPhone` 上方明确注明自研实现暂不挂载。
- DSH 自研手机：[tavern-plugin/lib/domain/phone-chat.js](../../tavern-plugin/lib/domain/phone-chat.js)，仅用于区分系统，不是本次截图运行链路。
- DSH 酒馆消息兼容：[tavern-plugin/lib/domain/tavern-helper-context.js](../../tavern-plugin/lib/domain/tavern-helper-context.js) 与 [tests/helper-host-api.test.mjs](../../tests/helper-host-api.test.mjs)。
- DSH 远程资源锁定：[tavern-plugin/lib/domain/tavern-remote-assets.js](../../tavern-plugin/lib/domain/tavern-remote-assets.js)。
- 既有生态审计：[ACU 数据库、玉子手机：DSH 宿主兼容性审计](acu-yuzi-host-api-audit-2026-09-01.md)。
- 调研当天的远程入口：[phone-ctn bundle](https://phone-ctn.pages.dev/index.js)。
