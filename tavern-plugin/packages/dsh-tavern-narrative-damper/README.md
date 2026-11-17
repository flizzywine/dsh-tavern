# dsh-tavern-narrative-damper（叙事阻尼器插件）

**DSH Tavern** 的叙事阻尼器面板：把原来「设置 › 叙事阻尼器」整页搬进侧栏「插件」里的独立页面。

阻尼引擎本身仍在宿主的关键路径上（每轮正文生成前并发裁定、后台 MVU 结算时钳制涨跌幅度），
这个插件负责它的全部配置面：开关、判定/阻尼模式、决策模型与密钥、阈值、超时与附加裁判准则。

## 面板内容

- **启用叙事阻尼器**、**在对话楼层显示裁定结果**：面板与楼层状态胶囊共用的两个开关。
- **判定模式**：角色扮演（只控制自己的角色）/ 写作 · 上帝视角（可为任意角色落笔，只拦吃书）。
- **阻尼模式**：标准拉扯（常规 ±5 / 突破 ±12）/ 慢热严苛（常规 ±3 / 突破 ±8）。
- **R18 送审语义分级脱敏**：只改发往决策模型的评估副本，三级降级（全量脱敏 → 骨架 → 结构摘要）。
- **后台 MVU 数值涨跌钳制**、**无 MVU 卡自动维护四维状态**。
- **决策模型与连接**：提供方、自定义接口地址、模型名、API Key（安全存储或环境变量名引用）、
  判定阈值、请求超时上限于附加裁判准则，并可在面板里直接「测试连接」。

API Key 存在宿主安全凭据库，不写进设置文件；面板只拿到 `{ configured, source, keyName }`。

## 宿主契约

宿主半（`lib/index.js`）把面板的调用转发给 `tavern.damperSettings`，与宿主旧 RPC
（`getNarrativeDamperSettings` / `updateNarrativeDamperSettings` / `setNarrativeDamperKey` /
`testNarrativeDamperConnection`）共用 `lib/domain/damper-settings.js` 一份实现：

| 插件处理函数 | 宿主调用 | 说明 |
| --- | --- | --- |
| `narrative-damper:read` | `tavern.readDamperSettings()` | 配置 + 凭据状态（不含明文） |
| `narrative-damper:update` | `tavern.updateDamperSettings({ patch })` | 只发改动字段，校验在宿主 |
| `narrative-damper:set-key` | `tavern.setDamperKey({ provider, value })` | `value: null` 清除；环境变量名转键名引用 |
| `narrative-damper:test` | `tavern.testDamperConnection({ config })` | 真发一次决策请求 |

宿主没有这套接口时，处理函数如实报错，面板显示「当前宿主不支持……请更新 DSH Tavern」。

## 构建

浏览器半是构建产物，改 `src/client/*.js` 后：

```sh
node tavern-plugin/packages/dsh-tavern-narrative-damper/build.mjs          # 重新生成 client.js
node tavern-plugin/packages/dsh-tavern-narrative-damper/build.mjs --check  # 只校验
```

`client.js` 由 `window.__ModuleLoader__.load` 包装，`id: 'dsh-tavern-narrative-damper'`，
`inject: ['tavernUi']`；面板走 `tavernUi.registerPanel`，与剧情罗盘同一种挂载方式。

## 安装

随酒馆发行：`bin/bundled-tavern-plugins.mjs` 把本包复制到 `<data>/plugins/dsh-tavern-narrative-damper`，
插件页里显示为「内置插件」（可停用、随酒馆更新、不可删除）。停用后侧栏面板消失，宿主引擎保留上一份配置。
