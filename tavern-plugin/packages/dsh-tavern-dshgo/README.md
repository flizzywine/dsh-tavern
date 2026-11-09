# dsh-tavern-dshgo

[dsh-go](https://github.com/ccch1mneyyy/dsh-go) 上的酒馆启动器。装进 dsh-go 本机引擎的 `web` profile 后，App 里出现一个原生「酒馆」面板和一行状态条，用来看酒馆装没装、版本多少、缺哪个 bundle。

## 它不做什么

dsh-go 的本机引擎固定启动 `dsh web`，只有 `web` 和救援 profile 两种模式，不能切 profile，也拿不到 Desktop 的 `desktopProfiles`。所以桌面版启动器那一套（`profiles/desktop ↔ profiles/tavern` 目录互换 + 重启应用）在这里用不了。

对应的做法是：**酒馆的 bundle 直接叠加在 `web` profile 上，启动器只负责看状态和开关**。启用后去 App 的「引擎」页重启，网页版就是酒馆。

## 装

在 dsh-go 的终端（本机引擎里的 shell）里：

```sh
dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-tavern/tavern-plugin/packages/dsh-tavern-dshgo
```

装完不用重启引擎：面板和状态条几秒内就会出现在 App 里。

## 限制

- **只对 dsh-go 的原生界面生效**：`dshGo` 清单和 `ctx.dshGo` 是 App 专用的，网页版看不到它们，也不需要有——网页版里酒馆就是页面本身。
- **不提供一键打开**：dsh-go 的 `open` 效果只认 App 页面 id 和 `panel:<id>`，`link` 只收 `https://`，插件打不开本机 `http://127.0.0.1:3080`。启用后请从「界面」进网页版。
- **重置引擎会删数据**：dsh-go 的「重置引擎」只保留 `~/.dsh/dsh-go`、`~/.dsh/skills`、`~/.agents/skills`、`~/.dsh/profiles`、`~/.dsh/cordis.patch.yml`、`~/.dsh/.env`；`~/.dsh/profile-data/` 不在保留项里，而酒馆的角色卡、世界书、预设和存档都在 `profile-data/tavern/`。重置前先备份 `profile-data/tavern`。
- **启用期间会话库会切到酒馆**：酒馆的 `cordis.patch.yml` 把 `session-persistence-jsonl.root` 指向 `profile-data/tavern/sessions`，并把默认 preset 设为 `tavern`。启用后 App 原生聊天页看不到原来的普通会话，停用并重启后恢复。

## 当前版本

只读面板：状态条（≤24 字）、面板（阶段、配置目录、bundle 计数、缺失项、刷新）。启停与预检在下一个版本。

自查：

```sh
node <dsh-go>/sdk/plugin-kit/bin/check.mjs tavern-plugin/packages/dsh-tavern-dshgo --load
```
