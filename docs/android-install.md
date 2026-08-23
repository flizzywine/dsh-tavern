# Android 安装（实验性）

dsh-tavern 可以借助 [DSHA](https://github.com/qiannianhuanxiang/DSHA) 在 Android 手机上运行，但不保证所有设备和 DSH 版本都可用。

## 安装

1. 从 DSHA 仓库下载 APK，在手机上安装并添加模型 API。
2. 打开 DSHA 的“创造模式”。
3. 把下面这段话发给 AI：

```text
请把 https://github.com/flizzywine/dsh-tavern 克隆或更新到
/root/.dsh/apps/dsh-tavern，然后进入该目录执行：

bash android/install.sh

安装完成后重启 DSHA，并验证：
1. http://127.0.0.1:3080 可以访问；
2. http://127.0.0.1:3088 可以访问；
3. 重启 DSHA 后，3088 能被自动拉起；
4. 手机窄屏下侧栏、输入区和候选项可以正常操作。
```

安装脚本会：

- 创建独立的 `tavern` Profile；
- 在 3088 启动 dsh-tavern；
- 将手机适配插件加入 `tavern` 和 DSHA Web Profile；
- 将自动拉起插件加入 DSHA Web Profile；
- 校验两个 Profile，并确认 3088 已经启动。

候选项滚动已经是 dsh-tavern 的内置功能，安装时不会修改项目源码。脚本也不会安装 `dsh-cost-meter` 等非必要插件。

## 更新

让创造模式中的 AI 更新仓库，然后重新运行：

```bash
cd /root/.dsh/apps/dsh-tavern
bash android/install.sh
```

脚本可以重复执行：它会保留 Profile 中的其他依赖，只更新本项目需要的 bundle。

## 限制与排错

- 必须允许 DSHA 在后台运行；Android 杀死 DSHA 后，3080 和 3088 都会停止。
- DSHA 重新启动并加载 Web Profile 后，`dsh-tavern-entry` 会在 4 秒后检查 3088，之后每 60 秒复查。
- 酒馆启动失败时查看 `/root/.dsh/logs/tavern.log`。
- 如果 DSHA 使用的 Web Profile 既不是 `web` 也不是 `user`，运行脚本前设置 `DSH_ANDROID_WEB_PROFILE`。
- 手机适配依赖 DSH 前端结构；DSH 更新后如有布局异常，需要同步更新适配插件。
