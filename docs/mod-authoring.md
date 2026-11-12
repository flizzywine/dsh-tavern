# 舞台模组编写合同

舞台本体（运行时、导演、演出、皮肤）稳定以后，新的可选舞台功能一律以**舞台模组**加入：骰子、手机、文字卡、计时器都是这样的模组。本文规定一个模组的代码、清单、设置、接口、文档和测试放在哪里、写成什么样。机械部分由 `tests/mod-structure.test.mjs` 强制执行。

卡自带的玩法插件（`registerGameModeView`、舞台借用等，见 `docs/plugin-design.md`）是**本体插件**，不是舞台模组，不受本文约束。

## 1. 一个模组 = 一个文件夹

第一方模组放在 `tavern-plugin/mods/<name>/`，id 固定为 `dsh.<name>`。第三方模组在自己的仓库里用同一个布局，经代码同意安装。

```
tavern-plugin/mods/<name>/
  mod.json          唯一清单（§2）
  package.json      name = mod.json 的 packageName；exports 指向 plugin.mjs
  plugin.mjs        Cordis 入口：apply(ctx) 里登记本模组用到的全部接口（§3），别处不替它登记
  runtime.js        指令执行、提示词准备等宿主侧逻辑，纯函数优先
  stage.js          可选：导演事务钩子，按文件夹自动发现并登记（§3）
  host/             可选：舞台宿主服务，由 stage.js 的 hostExtension 带入
  tools.js          可选：前台工具，按文件夹自动发现并登记（§3）
  client/           可选：舞台画面；入口 client/stage.cjs（+ client/stage.css），由舞台构建打包
  view/             可选：独立界面文档（如手机）
  prompts/ assets/  提示词片段、内置素材
  README.md         开发者说明（§4）
```

规则：

- 模组只 import 自己文件夹里的文件和 `tavern-plugin/packages/dsh-presentation-protocol/src/`；需要宿主或舞台的能力时经 `ctx` 注入的服务取得。两个模组之间不互相 import，用模组 API（§3）。
- 本体辅助函数只有一条通道：`tavern-plugin/lib/mod-library.js` 是模组可用本体函数的唯一清单（提示词分段与内置提示词、气泡解析与配音标记、气泡提示词说明、识别音频、人物目录、变量猜测提示等）。模组不 import 它，而是由本体交给模组：舞台宿主服务从请求绑定的 `bindings.hostLibrary` 取得，导演事务钩子 `configFields(fields, library)` 从第二个参数取得。模组需要新的本体函数时，加进这份清单。
- 模组文件夹以外的代码不 import 模组，也不出现任何第一方模组 id。舞台和本体只认声明和接口，不认识具体模组。
- 模组代码只由舞台加载：舞台关闭或不用舞台的卡不加载、不执行任何模组代码。唯一例外是前台工具 `tools.js`：工具表按已安装的模组在启动时冻结，所以由本体在启动时读取；工具只在本卡开着该模组、或本局历史已经调用过它时提供。

## 2. 清单 `mod.json`

字段由 `tavern-plugin/lib/domain/mod-system-contract.js` 校验（`validateDistributionManifest`），在安装和加载时校验一次，读取时不再校验。

| 分组 | 字段 | 说明 |
|---|---|---|
| 身份 | `format` `schemaVersion` `id` `name` `summary` `packageName` `version` `hostApi` | `id` = `dsh.<name>`；`version` 是语义化版本，公开 API 跟随它 |
| 依赖 | `dependencies[]` `conflicts[]` `api` | 依赖写其他模组 id + 版本范围 + `onMissing`（默认 notify）；`api.operations` 是对其他模组公开的操作 |
| 设置 | `config` `preferences` | `config` 可随卡携带，全局 / 本卡两层叠加，`userAdjustable` 决定玩家能否在设置页调；`preferences` 只在全局（如音量）。设置页由 schema 生成，模组不自绘设置页 |
| 素材 | `assetKinds` `coreAssets` | `assetKinds` 是本模组自己的素材条目种类（走蓝灯 / 绿灯 / 关）；`coreAssets` 是随代码发行的内置素材，没有灯态 |
| 导演 | `prompts[]` `performances[]` | 提示词贡献（slot、order、`byteBudget`、`when`）；本模组放的演出种类（hold、区域、履历行、回放） |
| 权限 | `permissions` | `stage.state` `stage.presentation` `source.dialogue` `models.*`；声明不是授权 |
| 入口 | `entry` `dataVersion` | `entry` 是 plugin.mjs |

清单里**没有开关字段**。新装模组一律全局关闭；四态开关（全局开启 / 全局关闭 / 本卡开启 / 本卡关闭，按「本卡关闭 > 全局开启 > 本卡开启 > 全局关闭」生效）由宿主统一管理，模组不能改默认值。授权与开关独立。

> 迁移中：导演指令语法（`commands`）、准入（`admission.entryKinds`）、内置素材表与文件表目前还在旧发行清单 `manifest.json` 里，由旧注册表读取。迁移把它们并进 `mod.json` 并删除 `manifest.json` 与旧注册表（§7 M7）；新模组届时只写 `mod.json`。

## 3. 能用的接口

模组只经下列已声明的接口接入，不改本体或舞台核心：

| 接口 | 登记方式 | 用途 |
|---|---|---|
| 导演指令 | 清单 `commands`；`registerMod` 的 `command` | 导演能下的结构化指令，op 为 `mod.<id>.<cmd>`，带每轮次数和字节上限 |
| 提示词 | 清单 `prompts` | 本轮准入时注入的说明 |
| 导演事务钩子 | `stage.js` 的默认导出；`lib/mod-builtins.js` 按文件夹发现并 `registerModStageContribution`（`lib/domain/mods/stage-contributions.js` 头注释列出全部钩子） | 状态归约、提示词里的状态、本轮事实与进度、导演目录片段（`catalogueFragments`） |
| 楼层字段 | `stage.js` 的 `floorFields` | 模组存在助手消息上的字段；舞台读取每层时带上 |
| 舞台宿主服务 | `stage.js` 的 `hostExtension(core)`，舞台在服务启动前按模组 id 登记（`stage-extensions.js`） | 跨请求的宿主侧服务（`deps`）与本模组自己的 RPC 方法（`requests`：`{methods, call}`，或 `bindings => {methods, call, work?}`，用舞台的请求绑定建起，`work()` 向部署报告在途活动）；`core.stage` 提供状态折叠与读取范围工具，`bindings.hostLibrary` 提供与本体共用的辅助函数（不 import 本体文件） |
| 前台工具 | `tools.js` 默认导出 `[{name, create(core)}]`；`lib/mod-tools.js` 按文件夹发现，本体据此登记、提供和管控，不点名工具 | 正文模型可调用的工具（如骰子的 `tavern_roll`）；`core` 给出回合读取与 `authorize(chat)`、`markUsed(chat)` 两个按本模组生效的回调 |
| 舞台画面 | `client/stage.cjs` 导出 `{views}`，可加 `backlog`（按演出声明 `backlog.renderer` 名给出履历行）、`takeover`（`views => 视图`：播放时接管舞台的视图，形状 `useStage(props) → {accepts,play,skip,cancel,up,busy,node}`）、`hud`（`views => 视图`：常驻 HUD 视图，形状 `useSlot(props) → {shown,element,onInputActivity,fallbackRef}`，见计时器）、`sourceDevice`（`views => 设备`：至多一个手持来源设备，来源挂件按它排版与直接调节，形状 `{modId, presentation, glyph, mark, group, threads(state), prefs, min, useAdjust}`，见手机）和 `skipShows`（`kind => 布尔`：只是页面 DOM、快进时仍显示的本模组演出）；可 `require` 本文件夹内文件；`client/stage.css` 是它的样式。舞台构建（`dsh-tavern-stage/build.mjs`）打包后按文件夹名 `stageFeatures.register` | 舞台上的视图与样式；HUD 用演出的 `regions` |
| 本体客户端部件 | `client/core.js` 调 `tavernModClients.register(modId, part)`，用 `// @include-mod <name>/client/…` 引入本文件夹文件；本体构建的 `// @include-mods client/core.js` 按文件夹编入（`src/client/mod-clients.js` 头注释列出插槽与 props）；同一模组 id 多次登记会合并 | `floor` 聊天楼层正文前、`page` 舞台文本框上沿、`overlay` 舞台叠层、`backlog` 履历行（按演出种类）；面板显示字段 `description` 说明、`glyph` 图标、`fieldHelp` 设置项说明、`assetKind` 带来的素材种类 `[kind, label]`、`settings` 设置页组件（用设置页工厂内的部件，所以放 `client/settings.js`，由 `mod-config-pages.js` 的 `// @include-mods client/settings.js` 编入）。本体与舞台按插槽渲染，不出现部件名（`tests/mod-structure.test.mjs` 的 names-part）；聊天楼层不经舞台，所以这部分随本体客户端加载 |
| 独立界面 | `registerMod` 的 `render` | 手机这类自带文档的界面 |
| 素材 | 清单 `assetKinds`、`coreAssets` | 素材库条目与内置素材 |
| 模型 | 清单 `permissions` 的 `models.*` | 本模组的模型槽 |
| 模组 API | 清单 `dependencies` / `api`；`registerMod` 的 `api` | 调用另一个模组（如计时器的 countdown） |

**缺接口时**：先在 README 写清缺什么、现有接口为什么不够，再给舞台或宿主加一个**不点名任何模组**的通用接口（单独提交，带测试），之后模组使用它。不在核心里为某个模组加分支或特例。

## 4. 文档

- **Skill 说明**：`presets/tavern/skills/stage-mods/references/<name>.md`，并在 `stage-mods/SKILL.md` 里加一行索引。写：用途；设置项（全局 / 本卡各管什么）；导演会在什么时候用它；能用哪些素材；一两个例子。不写：四态、授权、设置写法等通用规则（SKILL.md 已有），内部实现，错误码。第三方模组的说明随自己的包发布。
- **开发者 README**：`mods/<name>/README.md`。写：用途；用了哪些接口；持久状态在哪、何时清除；提示词各分节的 UTF-8 字节与工具 schema 字节实测值；测试文件列表。

## 5. 测试与提示词预算

- 至少一个自己的测试（`tests/` 下文件名含 `<name>`），覆盖指令归约、设置两层和画面。
- 模组关着、或本轮没有可用条目时，不注入任何说明；工具 schema 按已安装模组冻结，开关不改 schema。前台提示词只在会话开始或压缩后重算。
- 增加提示词或工具时测量分节字节和工具 schema 字节，写进 README。

## 6. 发布

第一方模组随本仓库发布，改动走普通 PR。发行包（`.dshmod`）由整个模组文件夹打成，入口替换为预构建的 bundle（`tavern-plugin/lib/host/mod-<name>.mjs`）。

最小入口（只贡献提示词的模组，`registerMod(manifest, {})` 合法；name 等于 `mod.json` 的 packageName 与 package.json 的 name）：

```js
import manifest from './mod.json' with {type: 'json'}
export const name = 'dsh-tavern-mod-example'
export const inject = ['tavern']
export function apply(ctx) {
  ctx.tavern.registerMod(manifest, {})
}
```

**新模组检查表**：建文件夹与 `package.json` → 写 `mod.json` 并通过校验 → `plugin.mjs` 登记接口 → Skill 说明 + 索引行 → README → 测试 → `tests/mod-structure.test.mjs` 通过。

## 7. 迁移（现状偏差）

`tests/mod-structure.test.mjs` 的 `PENDING` 列出现有偏差，只减不增；迁移完成后删除该表。

| # | 偏差 | 去向 |
|---|---|---|
| M1 | 第一方模组表写死在 `lib/mod-builtins.js`、`lib/mod-system-distributions.js`、`lib/domain/user-plugin-install.js`，由本体加载 | 扫描 `mods/*/mod.json`，由舞台加载 |
| M2 | 舞台包里按名 import 的模组宿主代码（计时器、手机的目录与通话已迁到 `mods/<name>/host/`；手机的呈现读取仍在 `mod-service.js` / `rpc.js`） | 移进 `mods/<name>/host/`，由模组自己登记 |
| M3 | 舞台客户端里的模组画面（phone-*、call-views 等；计时器、文字卡已迁） | 移进 `mods/<name>/client/` |
| M4 | 本体客户端里的模组代码（phone-*；骰子已迁到 `mods/dice/client/`，文字卡的本体适配已删） | 同 M3，聊天楼层上的部件走 `client/core.js` |
| M5 | 本体点名模组（`asset-pack-ui.js` 等；骰子前台工具已迁到 `mods/dice/tools.js`；设置页、说明、图标、素材种类已由各模组 `client/core.js` / `client/settings.js` 登记，`asset-pack-ui.js`、`mod-config-pages.js`、`mod-page.js` 不再点名） | 通用接口或清单声明 |
| M6 | 手机模组 import 本体内部（`lib/domain/*`、`prompt-catalog`、`bubble-line.cjs`）（已改为经 `hostLibrary` 取得，`lib/mod-library.js`） | 经 `bindings.hostLibrary` 取得 |
| M7 | 两份清单与旧注册表 | 并为一份 `mod.json` |
| M9 | 所有模组的 Skill 挤在 `references/first-party.md` | 每模组一份 |
