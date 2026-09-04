# Android 实验性安装

> **Android 属于实验性支持，不保证一定可用。** 不同手机系统、DSHA 版本、网络和后台限制都可能导致安装或运行失败；当前安装脚本只能修复项目已知问题。

dsh-tavern 可以借助 [DSHA](https://github.com/qiannianhuanxiang/DSHA) 尝试在 Android 手机上安装和使用。

## 最简单的安装方法

1. 安装 DSHA，配置模型，并确认 DSHA 自身可以正常打开。
2. 打开 DSHA 的“创造模式”，把下面一句话发给 AI：

```text
请运行这条命令安装 DSH Tavern，完成后告诉我结果：curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/android/setup.sh | bash
```

3. 看到“全部完成”后重启 DSHA，点击侧栏里的 **酒馆工作台**。

如需从手机 Download 目录导入人物卡，还需在 Android 系统设置中允许 DSHA **访问所有文件**。酒馆检测到无法读取下载目录时会明确提示，也可尝试界面中的系统文件选择器。

不需要手工克隆仓库、进入目录、配置 Profile 或输入端口。

## 更新与修复

正常更新：打开酒馆，点击左侧栏底部的 **更新到最新版**。

酒馆打不开时：回到 DSHA 主界面，在 **酒馆工作台**入口点击 **更新/修复**。它不依赖 3088 已经启动。

这两个入口都会安全更新原安装、保留用户配置并重新启动酒馆。检测到项目目录有本地修改或分叉时会停止，不会强行覆盖。

脚本通常优先通过 Git 下载；如果当前网络无法完成 GitHub 的 Git 下载，会自动改用 `codeload.github.com` 的普通 HTTPS 压缩包。压缩包会先在临时目录解压并校验，确认完整后才整体替换源码；安装失败时恢复旧源码。

## 一键脚本做了什么

`android/setup.sh` 同时负责首次安装、更新和修复：

- 首次运行时下载到 DSHA 的应用目录，Git 失败时自动改用压缩包；
- 再次运行时优先安全快进更新，网络不支持 Git 时继续使用压缩包更新；
- 自动创建和配置 Tavern Profile；
- 自动安装新版移动端界面插件与酒馆入口，并清理旧版适配插件；
- 校验配置并启动酒馆。

这些是内部步骤，普通用户不需要逐项执行。

## 排错

- 一键命令下载失败：确认 DSHA 已完成基础安装并且手机能访问 GitHub，然后重试同一句话。
- 更新提示“存在未提交修改”或“已经分叉”：脚本为避免覆盖文件会主动停止，请先备份或移走 `/root/.dsh/apps/dsh-tavern` 中的手工修改。
- 酒馆仍未启动：点击一次 **更新/修复**；仍失败时查看 `/root/.dsh/logs/tavern.log`。
- 导入窗口显示无法读取下载目录：在系统设置中打开 DSHA 的 **访问所有文件** 权限，返回酒馆后点“刷新”。
- 如果 DSHA 使用的 Web Profile 既不是 `web` 也不是 `user`，安装前设置 `DSH_ANDROID_WEB_PROFILE`。
- 必须允许 DSHA 在后台运行；Android 杀死 DSHA 后，DSHA 和酒馆服务都会停止，重新打开 DSHA 后会自动拉起。
- 手机适配依赖 DSH 前端结构；DSH 更新后如有布局异常，先点击 **更新/修复** 获取最新版适配。

仅在需要人工排错时，才直接运行本地入口：

```bash
bash /root/.dsh/apps/dsh-tavern/android/setup.sh
```
