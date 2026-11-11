# dsh-tavern-dshgo

[dsh-go](https://github.com/ccch1mneyyy/dsh-go) 上的酒馆启动器。装进 dsh-go 本机引擎的 `web` profile 后，App 里出现一个原生「酒馆」面板和一行状态条：看酒馆装没装、版本多少、缺哪个 bundle、宿主会不会加载它，以及一键启用/停用。

## 它不做什么

dsh-go 的本机引擎固定启动 `dsh web`，只有 `web` 和救援 profile 两种模式，不能切 profile，也拿不到 Desktop 的 `desktopProfiles`。所以桌面版启动器那一套（`profiles/desktop ↔ profiles/tavern` 目录互换 + 重启应用）在这里用不了。

对应的做法是：**酒馆的 bundle 直接叠加在 `web` profile 上，启动器负责看状态、开关和安装**。启用后去 App 的「引擎」页重启，网页版就是酒馆。

## 装

**第一步：把包装进 profile**（一次性）。这一步需要 shell：dsh-go 的终端在「会话详情页」的按钮里，或功能目录搜「终端」。

```sh
node /root/.dsh/dsh-go/plugins/dsh-tavern/tavern-plugin/packages/dsh-tavern-dshgo/scripts/install-on-dshgo.mjs
```

它会做四件事，任何一步不满足就直接报错停下，不留半成品：

1. 六个私有包复制到 `profiles/web/vendor/`，两个打过补丁的 npm 包按 `patches/` 里的版本装上；
2. 五个 `@deepseek-ai/*` 写成 `overrides → link:/opt/dsh/node_modules/*`，指向 App 自己那一份（另装一份会让插件拿不到同一个服务实例）；
3. 合并 `profiles/web/package.json`，改之前留 `package.json.pre-tavern`；
4. 装完逐个校验 8 个 bundle 与 5 个宿主包能否解析。

先看要做什么而不改文件：加 `--dry-run`。路径不是默认的（`~/.dsh`、`/opt/dsh`）就加 `--dsh-home` / `--app-root`。

**第二步：让 App 看到启动器本体**：

```sh
dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-tavern/tavern-plugin/packages/dsh-tavern-dshgo
```

装完不用重启引擎，面板和状态条几秒内出现。

**第三步：在面板上点「启用酒馆」**，然后到 App 的「引擎」页重启。

## 面板

- 状态条：`酒馆 3.2.0` / `酒馆未启用` / `酒馆 · 读不到配置`
- 面板：当前阶段、配置目录、bundle 计数（`8/8`）、缺哪些包
- 存档目录那条 callout：存档实体在 `~/.dsh/dsh-go/tavern-data`，`~/.dsh/profile-data/tavern` 只是相对链接，所以「重置引擎」删不到它
- 按钮：启用/停用、体检、刷新

「体检」在面板里跑九项检查（包在不在、宿主肯不肯加载、存档安不安全…），结果逐条列在面板上，不用开终端。其中「宿主肯不肯加载」问的是 `@deepseek-ai/dsh-app-boot` 的 `skippedBundles`；这个判断不能用 `dsh --dump-config` 代替——它遇到被跳过的 bundle 退出码仍是 0、也不报错。

## 回滚

```sh
cp ~/.dsh/profiles/web/package.json.pre-tavern ~/.dsh/profiles/web/package.json
```

再从 App 重启引擎。存档不受影响（在 `dsh-go/tavern-data` 下）。

## 限制

- **只对 dsh-go 的原生界面生效**：`dshGo` 清单和 `ctx.dshGo` 是 App 专用的，网页版看不到它们，也不需要有——网页版里酒馆就是页面本身。
- **不提供一键打开**：dsh-go 的 `open` 效果只认 App 页面 id 和 `panel:<id>`，`link` 只收 `https://`，插件打不开本机 `http://127.0.0.1:3080`。启用后请从「界面」进网页版。
- **启用期间会话库会切到酒馆**：酒馆的 `cordis.patch.yml` 把 `session-persistence-jsonl.root` 指向 `profile-data/tavern/sessions`，并把默认 preset 设为 `tavern`。启用后 App 原生聊天页看不到原来的普通会话，停用并重启后恢复。
- **重启得自己去点**：插件拿不到重启引擎的能力，App 也不给插件入口。启用/停用后都要手动去「引擎」页重启。
- **私有包不在 npm 上**：六个私有包靠 `file:` 引用 `profiles/web/vendor/`，`dsh-dream-skin`（63 MB）默认也装；空间紧的话可以去掉它，但面板的 bundle 计数会显示缺项。

## 自查

```sh
node <dsh-go>/sdk/plugin-kit/bin/check.mjs tavern-plugin/packages/dsh-tavern-dshgo --load
```
