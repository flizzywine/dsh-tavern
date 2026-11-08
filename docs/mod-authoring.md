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
  stage.js          可选：导演事务钩子
  host/             可选：舞台宿主服务
  client/           可选：舞台画面（视图与样式）
  view/             可选：独立界面文档（如手机）
  prompts/ assets/  提示词片段、内置素材
  README.md         开发者说明（§4）
```

规则：

- 模组只 import 自己文件夹里的文件和 `tavern-plugin/packages/dsh-presentation-protocol/src/`；需要宿主或舞台的能力时经 `ctx` 注入的服务取得。两个模组之间不互相 import，用模组 API（§3）。
- 模组文件夹以外的代码不 import 模组，也不出现任何第一方模组 id。舞台和本体只认声明和接口，不认识具体模组。
- 模组代码只由舞台加载：舞台关闭或不用舞台的卡不加载、不执行任何模组代码。

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
| 导演事务钩子 | `stage.js`，`registerModStageContribution`（`lib/domain/mods/stage-contributions.js` 头注释列出全部钩子） | 状态归约、提示词里的状态、本轮事实与进度 |
| 舞台宿主服务 | `ctx` 的 `stageExtensions.register` | 跨请求的宿主侧服务与请求路由 |
| 舞台画面 | `ctx` 的 `stageFeatures.register` | 舞台上的视图与样式；HUD 用演出的 `regions` |
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

**新模组检查表**：建文件夹与 `package.json` → 写 `mod.json` 并通过校验 → `plugin.mjs` 登记接口 → Skill 说明 + 索引行 → README → 测试 → `tests/mod-structure.test.mjs` 通过。

## 7. 迁移（现状偏差）

`tests/mod-structure.test.mjs` 的 `PENDING` 列出现有偏差，只减不增；迁移完成后删除该表。

| # | 偏差 | 去向 |
|---|---|---|
| M1 | 第一方模组表写死在 `lib/mod-builtins.js`、`lib/mod-system-distributions.js`、`lib/domain/user-plugin-install.js`，由本体加载 | 扫描 `mods/*/mod.json`，由舞台加载 |
| M2 | 舞台包里的模组宿主代码 `dsh-tavern-stage/lib/mods/{timer,phone}/`，舞台按名 import | 移进 `mods/<name>/host/`，由模组自己登记 |
| M3 | 舞台客户端里的模组画面（textcard-*、timer、phone-*、call-views 等） | 移进 `mods/<name>/client/` |
| M4 | 本体客户端里的模组代码（dice-roll、dice-throw、phone-*、textcard-stage、timer-stage） | 同 M3 |
| M5 | 本体点名模组（骰子前台工具 `tools/dice.js`、`turn-orchestration.js`、`asset-pack-ui.js` 等） | 通用接口或清单声明 |
| M6 | 手机模组 import 本体内部（`lib/domain/*`、`prompt-catalog`、`bubble-line.cjs`） | 移进协议包或经 `ctx` 取得 |
| M7 | 两份清单与旧注册表 | 并为一份 `mod.json` |
| M8 | 已退役的 `mods/performance`、示例 `mods/demo` | 删除；最小示例写进本文档 |
| M9 | 所有模组的 Skill 挤在 `references/first-party.md` | 每模组一份 |
