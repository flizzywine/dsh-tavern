# Android 安装（实验性）

dsh-tavern 可以借助 [DSHA](https://github.com/qiannianhuanxiang/DSHA) 在 Android 手机上运行，但不保证所有设备和 DSH 版本都可用。

## 最简单的安装方法

1. 安装 DSHA，配置模型，并确认 DSHA 自身可以正常打开。
2. 打开 DSHA 的“创造模式”，把下面一句话发给 AI：

```text
请运行这条命令安装 DSH Tavern，完成后告诉我结果：curl -fsSL https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/android/setup.sh | bash
```

3. 看到“全部完成”后重启 DSHA，点击侧栏里的 **酒馆工作台**。

不需要手工克隆仓库、进入目录、配置 Profile 或输入端口。

## 更新与修复

正常更新：打开酒馆，点击左侧栏底部的 **更新到最新版**。

酒馆打不开时：回到 DSHA 主界面，在 **酒馆工作台**入口点击 **更新/修复**。它不依赖 3088 已经启动。

这两个入口都会安全更新原安装、保留用户配置并重新启动酒馆。检测到项目目录有本地修改或分叉时会停止，不会强行覆盖。

## 一键脚本做了什么

`android/setup.sh` 同时负责首次安装、更新和修复：

- 首次运行时下载到 DSHA 的应用目录；
- 再次运行时只进行安全快进更新；
- 自动创建和配置 Tavern Profile；
- 自动安装手机适配与酒馆入口；
- 校验配置并启动酒馆。

这些是内部步骤，普通用户不需要逐项执行。

## 排错

- 一键命令下载失败：确认 DSHA 已完成基础安装并且手机能访问 GitHub，然后重试同一句话。
- 更新提示“存在未提交修改”或“已经分叉”：脚本为避免覆盖文件会主动停止，请先备份或移走 `/root/.dsh/apps/dsh-tavern` 中的手工修改。
- 酒馆仍未启动：点击一次 **更新/修复**；仍失败时查看 `/root/.dsh/logs/tavern.log`。
- 如果 DSHA 使用的 Web Profile 既不是 `web` 也不是 `user`，安装前设置 `DSH_ANDROID_WEB_PROFILE`。
- 必须允许 DSHA 在后台运行；Android 杀死 DSHA 后，DSHA 和酒馆服务都会停止，重新打开 DSHA 后会自动拉起。
- 手机适配依赖 DSH 前端结构；DSH 更新后如有布局异常，先点击 **更新/修复** 获取最新版适配。

仅在需要人工排错时，才直接运行本地入口：

```bash
bash /root/.dsh/apps/dsh-tavern/android/setup.sh
```
