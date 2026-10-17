# dsh-tavern-launcher

> 此入口已由官方 Desktop 的直接安装方式替代，本分支不再需要安装它。升级时会移除 desktop 配置中对此启动器的引用，避免启动第二个酒馆服务；原插件文件保留。以下内容仅供维护旧安装时参考。

把 **DSH Tavern 的启动按钮注册进 [DSH Better Sidebar](https://github.com/RevolutionLA/dsh-better-sidebar)**：在 DSH Desktop 的 GUI 里直接启动 / 停止 tavern 服务，并在新窗口打开酒馆界面，不必再依赖托盘菜单。

这是 DSH 的「双半侧插件」：宿主半侧负责进程生命周期，浏览器半侧负责 UI。

## 安装

目标 profile 必须是**装了 dsh-better-sidebar 的那一个**（桌面版即 `desktop`）：

```bash
dsh plugin --profile desktop add link:<仓库路径>/desktop-launcher
```

`dsh plugin` 会跑 pnpm 安装，并把声明了 `dsh.bundle.patch` 的包登记进该 profile 的 `dsh.profile.bundles`。安装完成后**刷新一次 GUI 页面**（客户端模块在页面启动时加载），侧边栏「+」菜单里就会出现 **Tavern**。

卸载：

```bash
dsh plugin --profile desktop remove dsh-tavern-launcher
```

## 用法

侧边栏新增的 **Tavern** tab：

| 控件 | 行为 |
| --- | --- |
| 状态标签 | `未运行` / `启动中` / `运行中`（每 5 秒刷新，页面不可见时暂停轮询） |
| 启动 Tavern | 拉起 `tavern` profile 的 DSH web 服务；已运行时幂等返回当前地址 |
| 停止 | 结束该服务（带 PID 记录校验，不会误杀占用同一端口的其他进程） |
| 打开 Web | 用带 token 的完整地址在新窗口打开酒馆界面 |

## 设计

**宿主半侧（`lib/index.js`）**

- 定位 tavern 源码树：`DSH_TAVERN_SOURCE` → `$DSH_HOME/profiles/tavern/package.json` 的 `dshTavern.source`。
- **复用 tavern 自己的生命周期实现**：动态 `import` 该仓库的 `bin/launcher-environment.mjs` 与 `bin/service-lifecycle.mjs`，直接调用 `startService()` / `stopService()`，不复制一份启动逻辑。这样桌面 0.2.0「Electron + app.asar 内 CLI」的启动形态、PID 记录、端口就绪探测、日志里取带 token 的 Web URL 等细节都与 CLI 完全一致。
- 在 DSH Web 服务器上注册同源路由 `POST /tavern-launcher/api`，方法：`status` / `start` / `stop` / `open`。
- 路由安全沿用 `dsh-better-sidebar`、`dsh-dream-skin` 同一套信任栅栏：Host 必须回环（或 `webRuntime.trustedHosts`）且浏览器标记同源——这是 DNS rebinding / 跨站防御，不是身份认证。
- `start` / `stop` 串行化，避免并发点击互相踩 PID 记录与端口探测。

**浏览器半侧（`lib/client.js`）**

- 按 `@deepseek-ai/dsh-client-modules` 的契约手写 bundle：`window.__ModuleLoader__.load({ id, factory })`，`require("react")` 从平台种子表拿到宿主 React（同一份实例，hooks 正常）。
- `dsh.client` 的 `inject` 为空：better-sidebar 走**软依赖**——启动时 `ctx.get("betterSidebar")`，并监听 `internal/service` 在它更晚出现时补注册。这样没装 better-sidebar 的 profile 不会在组合阶段直接失败。

## 验证

宿主半侧（真机）：

```bash
curl -X POST http://127.0.0.1:19387/tavern-launcher/api \
  -H 'content-type: application/json' -d '{"method":"status"}'
```

浏览器半侧离线验证台（用真实 React 复刻加载路径：捕获 factory → 物化 → `apply(ctx)` → 断言 `registerTab` → `react-dom/server` 真渲染 → 卸载）：

```bash
node <dsh 工作区>/tmp/launcher-client-harness.mjs
```

## 排障

| 现象 | 处理 |
| --- | --- |
| 侧边栏没有 Tavern tab | 确认 profile 装了 `dsh-better-sidebar` 并已刷新页面；`dsh plugin --profile desktop list` 看包在不在 |
| 点启动报「未找到 DSH Tavern 源码目录」 | 设置 `DSH_TAVERN_SOURCE`，或确认 `$DSH_HOME/profiles/tavern/package.json` 里有 `dshTavern.source` |
| 启动很慢 | 首次启动要等 DSH 服务初始化，状态标签会停在「启动中」；日志见状态里的 `logPath`（默认 `$DSH_HOME/logs/tavern.log`） |
