# dsh-tavern 启动器

在 DSH NEXT 的「DSH 终端」运行一次：

```powershell
dsh plugin --profile desktop add https://raw.githubusercontent.com/flizzywine/dsh-tavern/plugin-next-downloads/dsh-tavern-launcher-1.2.0.tgz
```

重启 NEXT，切到 `desktop`，打开「设置 → 酒馆启动器」。点「安装酒馆」会创建独立的 `tavern` Profile 并从 GitHub 安装正式插件版。点「打开酒馆」会让 NEXT 切到 `tavern`。酒馆里也有同一个「设置 → 酒馆启动器」页面，点「切回原版 DSH」即可回到 `desktop`，再从启动器更新或卸载。

安装和更新使用 DSH 的插件管理器，优先从 GitHub 下载正式发布包，失败时尝试 jsDelivr。用户无需安装 Git 或 Node.js。卸载由 NEXT 移入恢复备份，保留人物卡、聊天记录和共享设置。已有源码版或同名 Profile 冲突时，启动器会提示处理冲突。

启动器是独立的 `dsh-tavern-launcher` 包。维护者可在本目录运行 `pnpm publish --access public --registry=https://registry.npmjs.org/`。发布后用户可通过 DSH 用包名安装，也可使用已同步的国内 npm 镜像。酒馆本体继续通过 GitHub 发布。
