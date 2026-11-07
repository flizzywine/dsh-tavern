# dsh-tavern 启动器

在 DSH NEXT 的「DSH 终端」运行一次：

```powershell
dsh plugin --profile desktop add https://github.com/flizzywine/dsh-tavern/releases/download/next-launcher-v1.4.4/dsh-tavern-1.4.4.tgz
```

重启 NEXT，切到 `desktop`，打开「设置 → 酒馆启动器」。点「安装酒馆」会创建独立的 `tavern` Profile 并安装正式插件版。两边的 Profile 切换都通过「酒馆启动器」完成。酒馆运行时可以点「切回原版 DSH」，也可以直接发起更新或卸载。NEXT 会在切回 `desktop` 后继续操作，并在卸载前弹出确认。

安装和更新使用 DSH 的插件管理器，优先从 GitHub 下载正式发布包，失败时尝试 jsDelivr。用户无需安装 Git 或 Node.js。卸载由 NEXT 移入恢复备份，保留人物卡、聊天记录和共享设置。已有源码版或同名 Profile 冲突时，启动器会提示处理冲突。

点「检查更新」可比较当前安装与最新发布的版本和源码提交。提交号链接到 GitHub 上对应的源码。

启动器包名是 `dsh-tavern`，通过本仓库的 GitHub Release 安装。已有 NEXT 安装请先用旧启动器更新酒馆本体，再从 `desktop` Profile 移除旧启动器并安装新版。
