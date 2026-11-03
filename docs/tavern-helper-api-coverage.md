# Tavern Helper API 兼容补全（2026-10-04）

## 审计基线

- DSH Tavern：`4bbff696ebf9bd5b87e1aa2c899c723a5364385f`
- Tavern Helper：`46ec10df770b47e1ce6562de747d72f1bde3549e`

本报告按「脚本能调用、能产生实际作用或合理结果」判断实现状态。原生实现和可用模拟都算已实现；实现机制与 SillyTavern 不同只列为差异，不因此归为缺失。空函数或假成功不算实现。

仍区分「共享脚本沙箱」「消息 iframe」「开场预览」，避免把某一环境可用误写成所有环境都可用。上游当前 API、旧别名、iframe 全局接口不是同一集合，因此不按函数名数量计算兼容率。

## 第一批：API 桥接与基础行为

### 世界书桥接

- 延迟资源模式仍向消息 iframe 传递当前世界书的轻量 `name/resourceAccess` 描述符；读取书名无需下载全部条目
- `getWorldbookNames`、`getCharWorldbookNames` 读取实时上下文，不再固定为 iframe 初始化时的值
- `getGlobalWorldbookNames` 返回 `[]`、`getChatWorldbookName` 返回 `null`（2026-10-24 补）：人物卡绑定的多本书和全局书合并成一本交给脚本，脚本不能按单本书名读写，因此不单独列出；DSH 没有单独的聊天世界书。`createWorldbook` 不提供：新建的书脚本无法按名读写，提供它只会让卡片界面亮起用不了的「新建世界书」
- 世界书变更、名称、全局/角色变量通过上下文增量传播；部分 RPC 回包不会误删已有世界书描述符
- 验证覆盖实际 `getSession` 的完整、延迟和缓存投影，以及消息 iframe RPC/上下文更新

### 命令桥接

- 正式游戏共享脚本沙箱现在提供 `triggerSlash` 和 `TavernHelper.triggerSlash`
- `/pass`（`/return`）、`/findentry`（`/findlore`、`/findwi`）支持有边界的只读管道；支持转义和 `{{pipe}}`
- `/findentry` 仅访问当前会话绑定世界书，支持 `key/keysecondary/comment/name/content/uid`。匹配为不区分大小写的精确匹配优先、其次子串匹配；**不是** SillyTavern Fuse.js 模糊搜索的完全替代
- 字符串管道结果不会再被 `Object.assign` 拆成字符索引对象；已有发送/生成返回对象保持原行为
- 鉴权通过但未实现的 Helper RPC 显式返回错误，不再留下永不完成的 Promise
- 共享脚本命令保留前台、生命周期和关闭事件保护，并等待此前排队的写入
- 不支持的混合管道先整体拒绝，不会只执行其中的发送或其他副作用

详见[命令兼容范围](./slash-command-compatibility.md)。`/pass` 经 Helper 调用时支持本批只读身份/变量宏，保留 `{{pipe}}` 给管道处理；不执行写变量/eval 类宏。准备页的命令路径仍按该文档列出的开局命令处理。

### 消息、变量与工具 API

| API | 共享脚本 | 消息 iframe | 本批范围 |
| --- | --- | --- | --- |
| `getChatMessages` | 改进 | 改进 | 负索引、负数范围、`role/hide_state`、`data/extra/swipes_info`；保留 DSH 旧字段别名 |
| `getAllVariables` | 已实现 | 已实现（DSH 快照模拟） | 脚本顺序为 global→character→script→chat，不掺入全部聊天消息；消息为 global→character→chat→当前楼层 |
| `deleteVariable` | 修正 | 新增 | 等待写入，返回 `{variables, delete_occurred}`；`delete_occurred` 使用 lodash `unset` 的结果 |
| `getMessageId` | 新增 | 新增 | 支持官方消息 iframe 名称和 DSH token 名称；拒绝非消息 iframe 名称 |
| `getIframeName` | 新增 | 新增 | 共享沙箱按当前脚本返回虚拟脚本名；消息使用当前真实 iframe 名称 |
| `errorCatched` | 修正 | 修正 | 保持 `this` 和结果；同步/异步错误报告后重新抛出原错误，报告失败也不覆盖原错误 |
| `retrieveDisplayedMessage` | 实现有限适配 | 实现有限适配 | 当前或同会话已渲染、同源消息 iframe 的真实 DOM；无权访问/隐藏/未显示时返回空集合 |
| `getAllEnabledScriptButtons` | 新增 | 未实现 | 保留按钮组启用状态；返回启用脚本中可见按钮及其真实事件 ID |
| `initializeGlobal/waitGlobalInitialized` | 已实现（本地模拟） | 已实现（本地模拟） | 实际等待同一运行文档中初始化，保留 MVU bootstrap 等待语义；通过 namespace 与全局函数访问 |

消息读取遵循固定上游实现对超界索引的 clamp 行为，非法格式返回空数组。`include_swipes` 两个重载所需字段均可读取；DSH 为旧卡兼容保留字段超集，不会因切换该选项删除旧字段。`extra/swipes_info` 读取已有插件元数据，缺失值为 `{}`，并不表示已实现这些字段的完整写入语义。

`preset/extension` 等未实现变量作用域现在明确报错，不再错误地读写当前消息变量。

## 第二批：可用模拟实现

### 生成和取消

`generate`、`generateRaw`、`stopGenerationById`、`stopAllGeneration` 在共享脚本、消息 iframe 和开场预览都提供可用接口。

- `generate` 使用实际角色定义、当前/指定预设、绑定世界书激活结果、选中 swipe 的历史、覆盖项和深度注入，编译成独立请求；提示词正则与变量宏参与，不写入剧情或切换预设设置
- `generateRaw` 保留显式提示词顺序语义；已有模拟流式属于已实现：收到全文后发出完整/增量 token 兼容事件，脚本能得到文本并结束流式 UI
- 两个生成接口均有稳定 generation ID，发送开始/结束通知；失败或取消也结束 UI 生命周期
- 取消真实传递 AbortSignal 到 DSH 模型查找及 provider stream，并及时 reject Promise；provider 不理会信号时也不会把迟到结果当作成功返回
- 排队任务可以立即取消，不会被此前卡住的写入堵住；每请求 token 的有界取消记录处理「停止先于生成请求到达」的竞争，避免误取消同 ID 的下一次请求
- 脚本退出、消息文档销毁/切换、开场草稿释放或过期，取消各自拥有的任务；不停止前台普通聊天生成
- 模型和连接仍由 DSH 选择；`custom_api` 的温度/输出上限可用，不会把脚本内凭据发送到任意外部地址

明确报错的输入包括未渲染的可执行 EJS、图片、工具调用或结构化 schema 请求。可以传入已渲染文本/覆盖项或使用 `generateRaw`。这不影响文本生成接口被归为已实现。

### 正则、显示和只读宏

| API | 状态 | 实際作用 |
| --- | --- | --- |
| `formatAsTavernRegexedString` | 已实现（共用 DSH 引擎） | 按来源、显示/提示词目标、可选深度，顺序执行全局→当前预设→角色规则；支持捕获、裁剪、字符替换及只读宏 |
| `isCharacterTavernRegexesEnabled` | 已实现（DSH 权限投影） | 返回当前是否有绑定角色；DSH 无需 ST 的额外局部正则开关 |
| `formatAsDisplayedMessage` | 已实现（显示模拟） | 选择楼层角色/深度，应用正则和宏，再用内置固定版本 Marked 输出 Markdown/原始 HTML |
| `refreshOneMessage` | 已实现（DOM 刷新模拟） | 重读存储消息并更新对应可访问 DOM 或调用者指定目标；不保存正文、不重放嵌入脚本，发出渲染完成事件 |
| `substitudeMacros` / `substituteMacros` | 已实现（只读宏模拟） | 展开 user/char/楼层编号、getvar/getglobalvar、消息/聊天/角色/全局变量路径；其余宏保留原文，不擅自执行副作用 |

正则/角色元数据随消息上下文更新，已挂载 iframe 不会一直使用旧规则。Marked 16.3.0 已随包附带并保留许可证，运行无需 CDN 下载。原 DSH 正则展示引擎行为保持一致。

### 事件与 globals

- 消息 iframe 新增可用的 `eventOnce`、`eventMakeFirst/Last`、`eventRemoveListener`、`eventClearEvent/Listener/All`，支持顺序、去重、一次性、解除监听及重入
- `eventEmitAndWait` 在两种 iframe 都能等待当前监听器结束；共享脚本保留原有按脚本归属隔离的事件总线
- 消息 iframe 提供 `injectPrompts` / `uninjectPrompts`（以及 `TavernHelper.injectPrompts` / `TavernHelper.uninjectPrompts`），并在提交生成前触发 `tavern_events.GENERATION_AFTER_COMMANDS`（别名 `generation_after_commands`）并等待挂起的提示词注入回执完成，保证 `once: true` 的 `in_chat` 提示词能在当轮 `prepareTurn` 前写入会话
- `initializeGlobal` / `waitGlobalInitialized` 在消息帧也真正等待初始化，不再立即返回未定义
- `eventWaitOnce` 是额外便利接口，返回下一次本地事件参数数组，不冒充上游已有函数
- 页面退出会拒绝尚未完成的等待并清理本地监听器；这些是同运行文档内的模拟，不承诺任意 iframe 间共享 globals

## Discussion #127 第三项的边界

帖子后续已经澄清：播放桥与回主页脚本被执行了，失败的是它们对消息 DOM 的假设。V31 在顶层 `#chat/body` 扫描 `.jzy-st`，不进入 iframe；这不等同于调用 `retrieveDisplayedMessage`。

本批提供可用的正规消息 DOM 访问接口，并清理共享脚本退出后留在同会话消息文档中的 jQuery 监听器，避免跨会话残留。**这不能证明原 V31/回主页脚本无需改动即可工作。** 尚未取得原卡/脚本，未做其真实点击链路验证；没有全局劫持 `document` 查询，也没有把脚本重复注入每个消息 iframe。原生 `addEventListener`、直接顶层 DOM 扫描等私有页面假设仍需针对真实卡验证与适配。

## 真正还没接上的能力与现有实现差异

### 尚未实现的功能

- 消息的非末尾插入、删除/旋转历史；完整写入 name/role/is_hidden/extra/swipes 等字段，需要协调 DSH 剧情与存档
- preset/extension 变量表；当前明确拒绝这些作用域，避免误写消息数据
- 角色/预设正则写入；脚本树 CRUD、消息 iframe 的全脚本按钮查询
- 完整世界书库 CRUD/绑定、人物/预设/persona CRUD、模型列表、音频/扩展管理
- V31 等脚本直接扫描顶层 `#chat` 的私有 DOM 假设，仍需真实卡验证适配

### 已实现模拟的行为差异（不计作 API 缺失）

- 流式事件由已完成全文模拟，不逐 token 转发
- 消息 `getAllVariables` 使用 global→character→chat→当前楼层快照，不同步下载全部冷历史做累计合并
- globals/事件以当前运行文档为边界，不自动跨任意 iframe
- 显示刷新操作可访问的真实 DOM，不重放其中的脚本、不持久化显示改动
- `/findentry` 精确/子串匹配，不使用 Fuse.js；通用 ST 管道及副作用宏仍有边界
- 文本生成有实际 DSH 上下文，但不自行执行动态 EJS 或采用脚本自带外部模型连接

## 验证方式

遵循仓库 `AGENTS.md`，本批运行相关测试子集，不运行仅供发布时使用的全量测试。覆盖共享脚本、消息 iframe、RPC 宿主投影、旧能力诊断、变量/MVU、世界书持久化、上下文增量、按钮导入、jQuery teardown 和客户端构建一致性。测试没有调用真实模型、发布 PR、推送或部署。

可复现命令（先按仓库说明准备对应 DSH 宿主及依赖）：

```sh
node bin/build-tavern-client.mjs --check
# 本环境排除无法启动的浏览器文件，其他相关测试统一运行
files=()
for file in tests/helper-*.test.mjs tests/tavern-helper-*.test.mjs; do
  [[ "$file" = tests/helper-webkit-imports.test.mjs ]] || files+=("$file")
done
TEMPLATE_EXECUTOR=server node bin/test-tavern.mjs "${files[@]}" \
  tests/inline-message-renderer.test.mjs tests/frame-variable-read.test.mjs \
  tests/frame-variable-storage.test.mjs tests/status-refresh-fallback.test.mjs \
  tests/session-resource-access.test.mjs tests/card-extension-reading.test.mjs \
  tests/script-session-owner.test.mjs tests/mvu-incremental-context.test.mjs \
  tests/mvu-view-refresh-cost.test.mjs tests/tavern-script-host-adapter.test.mjs \
  tests/plugin-startup.test.mjs tests/status-bar-session-view.test.mjs \
  tests/tavern-client-build.test.mjs tests/tavern-regex-order.test.mjs \
  tests/card-opening-previews.test.mjs tests/template-variable-display.test.mjs \
  tests/opening-preparation.test.mjs tests/opening-transport.test.mjs \
  tests/opening-retention.test.mjs tests/candidate-generation.test.mjs
node --import ./tests/fixtures/host-session-patch-preload.mjs --test \
  --test-name-pattern '^(opening slash|pre-game)' tests/opening-slash.test.mjs
```

### 本次云端验证结果

- 最终相关合集：**338 通过，0 失败，0 跳过**；另单独运行开场命令非浏览器用例 2 项通过。浏览器专用范围另列，未混入通过数
- 实跑宿主：官方 DSH 0.1.5-rc.2 的 boot/session/agent/tools/subagent/typert/filesystem 核心依赖；覆盖真实插件启动、世界书 session 投影、持久化与 MVU/上下文相关测试，以及真实 LlmRuntime/LlmAdapter 请求适配和 AbortSignal 转发（使用测试 provider，不消耗真实模型）
- 客户端生成一致性、插件包一致性、JavaScript 语法和 `git diff --check` 通过；仓库没有独立配置的通用 lint/typecheck 命令
- 真实浏览器范围（`helper-webkit-imports`、`full-template-display-chain`、`opening-slash` 的浏览器向导用例）**受环境阻塞，不能算通过**：Chromium 官方下载包不完整，系统 Chromium 因 Unix socket 受限而无法启动；WebKit 缺 GTK4、Graphene、Harfbuzz ICU 等动态库
- 原始 V31/回主页实卡验证未执行，因为尚未提供卡或脚本

## 官方语义依据

- [变量](https://github.com/N0VI028/JS-Slash-Runner/blob/46ec10df770b47e1ce6562de747d72f1bde3549e/src/function/variables.ts)
- [消息](https://github.com/N0VI028/JS-Slash-Runner/blob/46ec10df770b47e1ce6562de747d72f1bde3549e/src/function/chat_message.ts)
- [工具](https://github.com/N0VI028/JS-Slash-Runner/blob/46ec10df770b47e1ce6562de747d72f1bde3549e/src/function/util.ts)
- [显示消息](https://github.com/N0VI028/JS-Slash-Runner/blob/46ec10df770b47e1ce6562de747d72f1bde3549e/src/function/displayed_message.ts)
- [脚本按钮](https://github.com/N0VI028/JS-Slash-Runner/blob/46ec10df770b47e1ce6562de747d72f1bde3549e/src/store/iframe_runtimes/script.ts)
