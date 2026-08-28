# 《灯火阑珊》远程脚本与 CG 供应链审计

审计日期：2026-08-28。结论来自人物卡 JSON、锁定后的上游源码，以及 Apeiria 发布包自带 source map；这是静态源码审计，不等于在 SillyTavern/酒馆助手里的端到端运行证明。

## 一句话结论

这张卡不是一个自包含的数据文件，而是一个远程应用加载器：卡内保存了若干很短的 `import` 和 HTML 加载语句，运行时再从 jsDelivr、`testingcf.jsdelivr.net` 和 Cloudflare R2 拉取程序及图片。MVU 会管理每条消息、每个 swipe 的状态，也可以额外调用模型；其他脚本在 MVU 事件管线中校验变量、改写指令、切换世界书和开场白。最值得警惕的不是代码量，而是**远程地址未锁版本、模型输出可进入 `new Function`、状态栏约 1712 张角色图全部来自未版本化 R2 对象**。

## 审计快照

人物卡原件：`/Users/cf/.dsh/profile-data/tavern/data/resources/cards/灯火阑珊.json`，SHA-256 `6a1170f695071676020123fa05f2b1816516afa3a809de6f3b8129919544314c`。为避免报告依赖个人数据目录，只摘录了远程入口到 `evidence/card-extension-snapshot.json:1-32`。

| 上游 | 本地快照 | 锁定提交 | 卡实际加载方式 |
| --- | --- | --- | --- |
| MagicalAstrogy/MagVarUpdate | `upstreams/MagVarUpdate` | `0a730cd4a9b99689d1135a49b542c780b977c24c` | `.../gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js`，没有 ref |
| Alice233-Alice/Apeiria | `upstreams/Apeiria` | `4b8f897b7fa07d1eb851018e98893a86f42be6b6` | `.../gh/Alice233-Alice/Apeiria@main/...` |
| StageDog/tavern_resource（变量结构的传递依赖） | `upstreams/tavern_resource` | `14e03abb53e56210b0351ef02873739c967c5406` | `.../gh/StageDog/tavern_resource/dist/util/mvu_zod.js`，没有 ref |

人物卡五个 Helper 脚本入口见 `evidence/card-extension-snapshot.json:4-29`，状态栏 HTML 入口见 `evidence/card-extension-snapshot.json:31`。审计时逐个下载线上 URL 并与本地快照比较，字节一致：

| 在线对象 | SHA-256 |
| --- | --- |
| MVU `artifact/bundle.js` | `3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f` |
| 灯火阑珊-变量结构 | `df9891067e9c3aba045cee90477c9c0b7890248eef0e13a67bcc376d9e4e0085` |
| 踏月寻仙-动态世界书管理 | `f96c485cced12fcaf5b54d5ade71c87f639ca6ba031ef2c306d0dd5e919a348f` |
| 开场白索引 | `2fa8a26a58892791d4322a6d39ed1b3607dae9190b87f12c0d461cbeda7389cf` |
| 踏月寻仙-变量守卫 | `141329c72db2fb03da750555b58f20e734da4afc8266e2921fb5784fc1c5dcb3` |
| 灯火阑珊-状态栏 HTML | `9302fdb06d227260f556b659e8b39cfa6b8c8521648ba5a265c9e2fa3f7c3c64` |
| `mvu_zod.js` | `78c40f52d81022d9d769a923a49e673b8babb562656051a7d0410b6b19f45184` |

这些哈希只证明“2026-08-28 下载到的内容对应本报告快照”，卡本身没有检查哈希，今后同一 URL 可以返回别的代码。

## 五个脚本分别做什么

### 1. MVU：核心状态机，也是唯一直接调用模型的模块

- 加载时注册 UI、全局 API、初始化与清理逻辑；聊天切换时重新初始化（`upstreams/MagVarUpdate/src/main.ts:23-40`、`:95-150`）。
- 监听 `MESSAGE_SENT`、`MESSAGE_RECEIVED` 等事件，初始化并更新变量（`upstreams/MagVarUpdate/src/function/update/index.ts:7-20`、`upstreams/MagVarUpdate/src/function/initvar/index.ts:5-17`）。
- 状态实际存放在 `SillyTavern.chat[message_id].variables[swipe_id]`，也就是每个楼层的每个 swipe 都可有独立快照（`upstreams/MagVarUpdate/src/util.ts:8-31`）；初始化时会为开场白的各 swipe 写入状态（`upstreams/MagVarUpdate/src/function/initvar/variable_init.ts:130-200`）。
- 解析模型输出中的变量指令，发出 `VARIABLE_UPDATE_STARTED`、`COMMAND_PARSED`、`VARIABLE_UPDATE_ENDED` 等事件，再把结果写回消息变量；必要时还会修改助手消息正文（`upstreams/MagVarUpdate/src/function/update_variables.ts:680-746`、`:1500-1573`）。
- “额外模型解析”不是比喻：它会构造历史、世界书、提示词和 API 配置，然后调用酒馆助手提供的 `generate` / `generateRaw`；结果会追加到当前助手消息再进入变量更新流程（`upstreams/MagVarUpdate/src/function/update/on_message_received.ts:8-73`、`upstreams/MagVarUpdate/src/function/update/invoke_extra_model.ts:428-581`）。API URL、key、model、并发/重试策略均属于可配置项（`upstreams/MagVarUpdate/src/store.ts:123-247`）。
- 它还拦截世界书装载和请求设置事件，从正文模型请求里过滤或选择 `[mvu_update]`、`[mvu_plot]` 条目（`upstreams/MagVarUpdate/src/function/request/index.ts:7-30`、`upstreams/MagVarUpdate/src/function/request/filter_entries.ts:30-81`、`upstreams/MagVarUpdate/src/function/request/filter_prompts.ts:3-30`）。

### 2. 灯火阑珊-变量结构：不只是类型声明，而是运行时裁判

- 入口本身很短：远程导入 `mvu_zod.js`，再把大份 Zod Schema 注册给 MVU（`evidence/apeiria-source-map/灯火阑珊-变量结构/灯火阑珊-变量结构/index.ts:1-8`）。
- Schema 定义字段、默认值、约束和转换（`evidence/apeiria-source-map/灯火阑珊-变量结构/灯火通明/schema.ts:391-514`）。
- `mvu_zod` 会在 MVU 的 `COMMAND_PARSED` 阶段逐条模拟执行命令，只保留能通过 Schema 的命令；更新结束后再清理状态（`upstreams/tavern_resource/util/mvu_zod.ts:34-223`）。因此它能改变模型更新的实际结果，不是只给编辑器看的类型。

### 3. 踏月寻仙-动态世界书管理：确定性上下文路由器

- 从最近聊天文本、输入框草稿和最新 MVU `stat_data` 推断当前地点、宗门、情境（`evidence/apeiria-source-map/踏月寻仙-动态世界书管理/踏月寻仙-动态世界书管理/index.ts:2091-2150`、`:2202-2288`）。
- 用 `updateWorldbookWith` 把主世界书条目的策略在 `constant` 与 `selective` 之间切换，从而决定下一次请求带哪些世界书内容（同文件 `:2450-2564`）。
- 把宗门推断结果和内部快照写回最新消息变量（同文件 `:685-704`）。
- 监听发送前、提示词合并前、收信、swipe、编辑、删除、切换聊天、角色页加载和 MVU 更新完成等大量事件（同文件 `:2783-2906`）。
- 源码中没有额外模型调用、`fetch`、`eval` 或 `new Function`。它是规则引擎，但会全局改写当前人物主世界书，若异常中断或事件竞态，可能让后续请求携带错误条目。默认调试日志还可能把最近消息内容打到浏览器控制台。

### 4. 开场白索引：切换开场白 swipe 的 UI

- 读取人物卡 `alternate_greetings` 和聊天中的 swipes，建立索引（`evidence/apeiria-source-map/开场白索引/开场白索引/index.ts:22-57`）。
- 选中后通过 `setChatMessages` 改指定消息的 `swipe_id` 并整体刷新（同文件 `:79-161`）。
- 监听脚本按钮和 `CHAT_CHANGED`，并用定时重试等待按钮出现（同文件 `:298-344`）。
- 不调用模型和网络，也不动态执行代码。主要风险是它按“首个存在多个 swipe 的消息”定位开场楼层，异常聊天结构下可能切错楼层。

### 5. 踏月寻仙-变量守卫：在 MVU 管线里修复/阻止命令

- 统一命令路径、繁简字和角色别名（`evidence/apeiria-source-map/踏月寻仙-变量守卫/踏月寻仙-变量守卫/index.ts:33-109`）。
- 对派生只读字段拦截写入，并保护同伴等级等状态（同文件 `:112-195`）。
- 监听 MVU `COMMAND_PARSED` 和 `VARIABLE_UPDATE_ENDED`，直接改写命令或重新用 Schema 解析整份状态（同文件 `:197-248`）。
- 不调用模型、网络或动态执行代码。不过它引用的是 `踏月寻仙-测试版/schema`，而“变量结构”注册的是 `灯火通明/schema`（同文件 `:1`；变量结构入口 `:2`），两套 Schema 漂移时可能出现“前面允许、后面又改掉”的隐蔽行为。

## 危险能力与依赖

### 高风险：模型输出进入动态 JavaScript 执行

MVU 解析非标准对象/数组值时，会尝试 `new Function(`return ${value}`)()`（`upstreams/MagVarUpdate/src/function/update_variables.ts:85-115`）。`mvu_zod` 在模拟命令时复制了同类逻辑（`upstreams/tavern_resource/util/mvu_zod.ts:247-300`）。由于 `value` 的上游可以是正文模型或额外解析模型生成的变量指令，这不是普通 JSON 解析，而是一个模型可影响的 JavaScript 执行点。它最终能接触哪些权限取决于酒馆助手 iframe/CSP，本次静态审计不能证明沙箱边界。

### 高风险：远程代码全部漂浮

- MVU 顶层 URL 没有 `@commit`；Apeiria 全是 `@main`；StageDog 依赖也没有 ref（`evidence/card-extension-snapshot.json:4-31`、变量结构入口 `:1`）。
- 编译包继续从 `testingcf.jsdelivr.net/npm/.../+esm` 拉取未写版本号的 Pinia、klona、mathjs、JSON5 等依赖。即使只把顶层 GitHub URL改成 commit，传递依赖仍会漂移。
- 没有 SRI、签名或启动时哈希校验。上游账号、分支、CDN 或 npm 最新版任何一处变化，都能在用户不重新导入卡的情况下改变行为。

### 中风险：多个脚本共享可变状态

MVU 写消息/聊天变量，变量结构和守卫改同一条命令管线，动态世界书管理又在多个事件点改世界书与派生变量。这里没有清晰的事务边界；执行顺序、异常和版本不兼容都可能产生“界面看起来正常，但下一次请求上下文已经变了”的问题。

## CG / 图片资产供应链

### 图片在哪里

人物卡 JSON 只直接出现一张祥云图和一个状态栏 HTML 远程加载器（`evidence/card-extension-snapshot.json:31-32`）。大量 CG 并不在卡里，也不在 Apeiria Git 仓库里；仓库只保存文件名/编号清单，真正的二进制位于 Cloudflare R2：

`https://pub-4d14ab94aa29488b977bc5be9f2a06ef.r2.dev/picgo`

图片构造器把数字 `n` 变成 `${角色名} (${n}).png`，字符串则直接当历史文件名，再拼到上述 base URL（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/character-assets/image-url.ts:1-10`）。所以 URL 是运行时动态拼接的，而不是 1712 条完整 URL 明写在卡中。

### 约 1712 张角色图是怎么算出来的

状态栏 source map 中 11 个角色清单共 1727 个 token；去掉各清单内部重复后，可展开为 **1712 个不同的 R2 角色图片 URL**：

| 角色 | 唯一 URL 数 |
| --- | ---: |
| 南宫云裳 | 133 |
| 安迟迟 | 95 |
| 晚棠 | 135 |
| 朔望舒 | 152 |
| 朔璃鸢 | 137 |
| 梦杳泠 | 139 |
| 白清弦 | 192 |
| 羽岚 | 117 |
| 虞汐颜 | 268 |
| 许听雨 | 169 |
| 阮忘忧 | 175 |
| **合计** | **1712** |

清单证据位于 `evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/character-assets/characters/`；例如南宫云裳的编号与构造调用见 `南宫云裳.ts:4-26`，白清弦的大清单见 `白清弦.ts:4-226`，虞汐颜见 `虞汐颜.ts:4-42`。这个数字是对源码清单的展开统计，没有逐张联网验证对象仍然存在。

此外还有至少三张动态拼接的世界地图（`evidence/apeiria-source-map/灯火阑珊-状态栏/compiled-components/WorldMapCanvas.compiled.js:68-84`）、祥云主题图（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/themes.ts:54-136`）和 Catbox 占位图（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/character-assets.ts:45-53`）。

### 谁决定显示哪张 CG

1. 状态栏读取当前消息正文里的 `<visual_cards>` 块（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/stores/gallery-cards.ts:384-466`）。
2. 模型给出角色名与 `img_code`；代码把它映射到内置角色池，支持指定编号或无重复随机抽取（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/character-assets.ts:56-136`、`:320-370`）。模型通常不能直接为内置角色提供任意外部 URL，但能选择角色/编号或触发随机图。
3. 当前图和邻近图用 `new Image().src = url` 预加载，浏览画廊时继续换图（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/stores/gallery-cards.ts:469-510`、`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/stores/data-store.ts:539-611`）。
4. 用户上传的自定义立绘通过 `FileReader.readAsDataURL` 变成本地 data URL（`evidence/apeiria-source-map/灯火阑珊-状态栏/compiled-components/CompanionsPanel.compiled.js:134-165`），再写入 `stat_data.红颜角色库.<name>.自定义立绘` 和消息变量（`evidence/apeiria-source-map/灯火阑珊-状态栏/灯火阑珊/stores/data-store.ts:850-900`）。这不依赖外网，但会显著膨胀每个消息/swipe 的变量体积，并可能随变量上下文进入模型请求。

### 图片供应链风险

- R2 URL 没有版本号、内容哈希或 SRI；同名对象可在 Git 历史之外被替换或删除。
- 状态栏代码自身由浮动 `@main` HTML 加载；图片清单、选择算法和资源可以同时变化。
- Apeiria 仓库不能作为图片备份。当前快照只保存了编号与 URL 生成逻辑，没有下载 1712 张二进制 CG。
- 人物卡和已审计源码没有给出这些 CG 的作者、许可证或再分发授权；本报告无法确认美术资产的版权来源与使用权限。
- 浏览会向同一个 R2 域名持续发送图片请求；这会暴露访问时间、IP 和所请求角色/编号等常规 CDN 元数据。

## 建议的工程化处理顺序

1. **先冻结可执行代码**：把五个脚本、状态栏和全部传递依赖改为 commit/版本锁定或本地 vendoring，并保存 SHA-256 manifest。
2. **删除动态执行口**：对象/数组值只接受严格 JSON、JSON5 或明确白名单语法，不允许 `new Function`。
3. **制作资产清单**：把 1712 个展开 URL、哈希、尺寸和授权来源记录为 manifest；重要 CG 镜像到受控存储并使用内容寻址。
4. **建立权限边界**：脚本声明是否可调用模型、改消息、改世界书、联网和执行代码；卡片内容与可执行模块分开审阅、安装和升级。
5. **固定 Schema 单一来源**：变量结构、守卫、状态栏和动态世界书使用同一锁定版本，避免 `灯火通明` / `踏月寻仙-测试版` 并存漂移。

当前目录只是审计快照，**没有修改人物卡或 dsh-tavern 产品代码，也不会让运行中的卡自动改用本地副本**。
