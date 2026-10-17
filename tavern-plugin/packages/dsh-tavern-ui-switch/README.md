# dsh-tavern-ui-switch

在应用里一键切换 **酒馆界面 / 原版界面**。只在官方 Desktop 宿主安装。

## 为什么是「改 bundle 列表」

DSH 的界面形态完全由 profile 的 `dsh.profile.bundles` 决定：酒馆安装器把 `dsh-tavern-plugin` 等 bundle 写进这个数组，原版则只有 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`。

所以切换只需要改这一处：

- 切原版：把酒馆的 bundle 从数组里摘掉
- 切酒馆：放回去

不改 `dependencies`、不改 `cordis.patch.yml`、不动 `settings.yaml`、不碰会话与数据目录。每次写入前把旧清单备份到 `$DSH_HOME/backups/ui-switch/`。

## 安装器怎么接入

- `package.json` 的 `dsh.profile.bundles` 里加入本包
- `bin/profile-configuration.mjs` 把本包记入 `managedBundles` 与 `managedDependencies`（`link:` 指到本目录）
- 同时在 `dshTavern.officialBundles` 记录「原版界面该用哪些 bundle」，插件切换时优先用它，不再靠猜测
- 非 desktop 宿主直接排除本 bundle（切换要重启桌面外壳，其它宿主没有这条路径）

## 运行时

服务端插件注册四个接口（仅回环 + 自定义请求头，防跨站写入）：

| 接口 | 说明 |
| --- | --- |
| `GET /api/dsh-tavern-ui-switch/state` | 当前界面、酒馆是否安装、能否自动重启 |
| `POST /api/dsh-tavern-ui-switch/switch` | `{ mode: 'official' \| 'tavern' }`，改写 profile |
| `POST /api/dsh-tavern-ui-switch/restart` | 拉起独立的重启助手 |
| `POST /api/dsh-tavern-ui-switch/client-ready` | 前端挂载打点，只写日志 |

前端是一个 Shadow DOM 浮层，不依赖 React 或 slot，因此酒馆界面和原版界面都能显示。

## 为什么需要重启

桌面外壳只在启动时读取 profile，没有对外暴露重启 API，所以切换后由 `bin/relaunch.mjs` 作为独立进程关闭旧进程再拉起应用（约 7 秒）。任何一步失败都不会损坏数据，手动打开 DSH 即可。
