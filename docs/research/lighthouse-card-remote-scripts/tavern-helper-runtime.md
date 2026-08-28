# Tavern Helper 角色卡脚本运行机制

## 结论

酒馆助手没有为角色卡脚本实现一套独立解释器。它从角色卡扩展字段读取脚本配置，筛选出已授权且启用的脚本，然后为每个脚本创建一个隐藏 iframe，将脚本文本直接放进 `<script type="module">`。因此《灯火阑珊》里的远程 `import` 是由浏览器原生 ES Module 加载器从 CDN 下载并执行的。

```text
角色卡 data.extensions.tavern_helper.scripts
→ 解析并筛选 enabled 脚本
→ 每个脚本创建一个隐藏 iframe
→ 脚本文本成为 <script type="module">
→ 浏览器原生 import 下载远程模块
→ predefine.js 将父页面的 TavernHelper/ST API 注入 iframe
```

这里的 iframe 能分开脚本的全局命名空间和生命周期，但**不是安全沙箱**：iframe 没有 `sandbox` 属性，而且脚本被明确赋予 `window.parent`、SillyTavern 和 TavernHelper 的广泛能力。启用角色卡脚本，安全意义上接近于允许该卡作者的第三方 JavaScript 在 SillyTavern 页面内运行。

## 审计基线

- 官方仓库：<https://github.com/N0VI028/JS-Slash-Runner>
- 本地快照：`upstreams/JS-Slash-Runner`
- 分支：`main`
- 锁定提交：`4dd4b873f191accb5dd933089ddf36b846458585`
- 审计时 `refs/heads/main`：同一提交
- 酒馆助手清单版本：`4.9.3`（`manifest.json:1-15`）

以下结论来自该提交的静态源码；没有运行恶意测试脚本，也没有抓取实际浏览器网络流量。

## 1. 如何发现角色卡脚本

酒馆助手把新格式字段名固定为 `tavern_helper`（`src/type/settings.ts:1-4`）。角色设置的结构包含 `scripts` 和 `variables`（`src/type/settings.ts:117-123`）。

读取当前角色时，它从 `character.data.extensions.tavern_helper` 取值并用 `CharacterSettings` 校验；旧格式 `data.extensions.TavernHelper_scripts` 和 `TavernHelper_characterScriptVariables` 会先迁移（`src/store/settings/character.ts:10-42`）。在 dsh-tavern 保存的《灯火阑珊》原始卡对象中，对应位置是 `raw.data.extensions.tavern_helper.scripts`。

脚本项包含：

- `enabled`、`name`、`id`、`content`；
- `button.enabled` 和按钮列表；
- 脚本私有 `data`；
- `export_with.data`、`export_with.button`。

字段结构见 `src/type/scripts.ts:4-34`。

脚本是否真正运行有两道开关：角色名必须进入全局 `script.enabled.characters`，并且脚本/所在文件夹自身也必须启用；最终得到 `enabled_scripts`（`src/store/scripts.ts:54-91`）。第一次发现某张角色卡含嵌入脚本时，酒馆助手会弹窗询问是否启用整张卡的脚本，确认后才把角色名加入启用列表（`src/panel/script/use_check_enablement_popup.ts:84-116`）。这是整卡级授权，不是逐脚本或逐权限授权。

## 2. `data`、`button`、`export_with`

`data` 是绑定到单个脚本的持久变量。脚本调用 `getVariables({type: 'script'})` 时，实际按当前 iframe 解析出 script id，再读取对应脚本项的 `data`（`src/function/variables.ts:84-103`）；替换脚本变量则直接写回 `script.data`（`src/function/variables.ts:174-183`）。

按钮配置会生成 `script id + 按钮名哈希` 的事件 ID。只有脚本按钮功能已开启且按钮 `visible` 的项目才显示（`src/store/iframe_runtimes/script.ts:47-61`）；点击后通过 SillyTavern 的 `eventSource.emit` 发出该事件（`src/panel/Script.vue:40-55`）。

`export_with` 不决定运行权限，只控制导出人物卡/预设时是否携带脚本私有 `data` 和按钮定义。角色卡导出前会在导出副本中清空被排除的数据，导出后恢复内存中的完整设置（`src/store/settings/character.ts:101-148`）；预设采用相同清理语义（`src/store/settings/preset.ts:59-72`）。

## 3. 如何执行脚本文本和远程 `import`

所有全局、预设和角色脚本在应用就绪后合并为 computed runtime；runtime只携带脚本的 `id`、`name`、来源、`content` 和重载标记（`src/store/iframe_runtimes/script.ts:26-45`）。页面随后为每个 runtime 创建一个 iframe（`src/panel/Script.vue:28-38`）。

iframe组件是 `v-show="false"` 的隐藏 iframe，源码没有设置 `sandbox` 或 `allow`（`src/panel/script/Iframe.vue:1-8`）。完整 HTML 默认通过 `srcdoc` 注入；可选模式使用 Blob HTML URL（`src/panel/script/Iframe.vue:10-24`）。

关键执行点在 `src/panel/script/iframe.ts:5-22`：脚本文本未经 `eval` 或 `new Function`，直接插入：

```html
<script type="module">
  <!-- 人物卡中的 content -->
</script>
```

因此，类似：

```js
import 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';
```

会由浏览器原生 ES Module 机制请求远程 URL，并在该 iframe 的 JavaScript realm 中执行。是否加载成功受浏览器网络、CORS和页面 CSP约束；酒馆助手源码没有实现自定义 module loader。对 `src/` 的检索也没有发现用 `eval` 或 `new Function` 执行卡内脚本。

## 4. API是如何交给脚本的

酒馆助手首先在主页面创建全局 `TavernHelper` 对象（`src/function/index.ts:472-479`）。该对象包含：

- 事件监听与清理、脚本按钮、变量和 iframe工具（`src/function/index.ts:210-265`）；
- `getChatMessages`、消息增删改（`src/function/index.ts:285-304`）；
- `generate`、`generateRaw`（`src/function/index.ts:336-343`）；
- 世界书、角色、预设、人格、正则、扩展安装管理等能力（`src/function/index.ts:314-469`）。

iframe加载时，`predefine.js` 直接从 `window.parent` 复制 lodash、`TavernHelper`、EJS、YAML、Zod等对象，并把需要识别当前 iframe 的函数绑定到 iframe window（`src/iframe/predefine.js:1-19`）。它还暴露 SillyTavern context（`src/iframe/predefine.js:26-34`）和已存在的 MVU对象（`src/iframe/predefine.js:36-44`）。父页面 jQuery也被直接赋给 iframe（`src/iframe/parent_jquery.js:1-2`）。

例如：

- `eventOn` 最终把监听器注册到 SillyTavern 的 `eventSource`（`src/function/event.ts:77-105`）；
- `getChatMessages` 直接读取主页面 `chat`，并返回当前或全部 swipe 数据（`src/function/chat_message.ts:71-165`）；
- `updateWorldbookWith` 读取世界书、调用脚本提供的 updater，再写回（`src/function/worldbook.ts:429-439`）；
- `generate` 和 `generateRaw` 最终进入酒馆助手自己的生成流程（`src/function/generate/index.ts:392-404`）。

这不是 `postMessage` 式的窄桥接，而是把主页面对象和高权限函数直接提供给同源 iframe。

## 5. 生命周期与角色切换

酒馆助手扩展初始化时注册宏、事件、TavernHelper对象等，并把 Vue面板挂载到 SillyTavern 的扩展设置区；页面离开时卸载应用（`src/index.ts:38-51`）。只有收到应用就绪事件后，computed runtime 才开始返回脚本（`src/store/settings/global.ts:31-49`；`src/store/iframe_runtimes/script.ts:26-32`）。

切换聊天/角色时，角色 store在 `CHAT_CHANGED` 上更新角色 id/name，并重新读取该卡的设置（`src/store/settings/character.ts:51-70`）。computed runtime随之变化，Vue会移除旧 iframe并为新角色脚本创建 iframe。runtime key包含来源、script id和重载标记（`src/panel/Script.vue:28-37`）；编辑脚本文本、数据或按钮名时会触发 reload（`src/panel/script/ScriptItem.vue:96-113`）。

每个 iframe在 `pagehide` 时清除它注册到共享 `eventSource` 的监听器（`src/iframe/predefine.js:46-48`；`src/function/event.ts:145-164`）。可选 cleanup protector会尝试恢复写入父窗口的属性、移除标记过的 DOM并断开 observer（`src/iframe/cleanup_protector.js:276-315`），但该选项默认关闭（`src/type/settings.ts:61-73`）。

## 6. 权限与供应链结论

### 已确认的源码事实

- iframe没有 `sandbox` 或 `allow` 限制（`src/panel/script/Iframe.vue:1-8`）。
- 代码主动读取并暴露 `window.parent` 的对象和功能（`src/iframe/predefine.js:1-44`）。
- API能读取/修改消息、变量、世界书、角色和预设，调用模型，甚至管理扩展（`src/function/index.ts:285-469`）。
- cleanup protector仍允许真正写入 parent，只记录旧值以便稍后恢复（`src/iframe/cleanup_protector.js:90-147`）。
- README明确警告第三方脚本可能窃取 API密钥、聊天记录，修改设置或发送未授权请求（`README.md:3-19`）。
- 仓库没有为角色脚本实现域名白名单、资源哈希、逐能力授权或独立 CSP；清单也未声明这些边界（`manifest.json:1-18`）。

### 基于源码的工程判断

iframe提供的是独立 window/global realm和方便销毁的生命周期容器，不是可信安全边界。默认 `srcdoc` 与父页面同源，且源码主动桥接 parent，即使单看设计意图也不能把它当沙箱。

若人物卡脚本内容是未锁定版本的 CDN `import`，人物卡只保存远程入口；仓库更新、CDN返回内容变化或传递依赖变化后，同一张卡可能执行不同代码。当前执行链没有哈希校验或固定依赖解析机制来保证可复现性。

所以最准确的权限模型是：

> 用户确认启用某张卡的 Helper 脚本后，相当于信任该卡内所有已启用脚本及其远程依赖，并授予它们接近 SillyTavern 页面脚本级别的能力。
