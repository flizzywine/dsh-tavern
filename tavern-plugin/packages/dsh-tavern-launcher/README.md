# dsh-tavern 启动器

在 DSH NEXT 的「DSH 终端」运行一次：

```powershell
dsh plugin --profile desktop add "github:flizzywine/dsh-tavern#path:/tavern-plugin/packages/dsh-tavern-launcher"
```

重启 NEXT，切到 `desktop`，打开「设置 → 酒馆启动器」。点「安装酒馆」会创建独立的 `tavern` Profile 并从 GitHub 安装正式插件版。点「打开酒馆」会让 NEXT 切到 `tavern`。酒馆里也有同一个「设置 → 酒馆启动器」页面，点「切回原版 DSH」即可回到 `desktop`，再从启动器更新或卸载。

更新使用 DSH 的插件管理器，不需要 npm 发布。卸载由 NEXT 移入恢复备份，保留人物卡、聊天记录和共享设置。已有源码版或同名 Profile 冲突时，启动器会提示处理冲突。

这是独立的 DSH 插件包 `dsh-tavern-launcher`。市场可以从本仓库的子目录安装，或使用打包后的 `.tgz`。
