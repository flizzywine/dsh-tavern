# 原生 bionic 原型（方案 ③）

目标：APK 不再内置 Ubuntu + proot，直接用 Termux 编译好的 Android 原生 Node 跑酒馆 DSH。
本目录可复现两样东西：命令行验证（推到 `/data/local/tmp` 跑）和**可安装的 APK 外壳**。

## APK（2026-11-22，x86_64 模拟器 Android 16 / API 36）

`node android/native/apk-smoke.mjs` 从卸载开始全流程通过，验收直接操作 APK 里的 WebView（远程调试），页面零报错：

| 项 | 本原型 | 现有 DSHA 改版 APK |
| --- | --- | --- |
| APK 体积（arm64 + x86_64 两套 Node） | **412 MB** | 686 MB（仅 arm64） |
| 安装 | 4.1 s | — |
| 首次启动（解压 1.3 GB + 起服务） | **18.4 s** | 需先解出 Ubuntu rootfs 再装酒馆 |
| 之后的冷启动 | 5.8 s | — |
| 设备占用 | 1.7 GB | — |
| 内存 | DSH 主进程 464 MB；两个子进程 202 / 127 MB | — |
| 开局 / 发一轮 / 刷新 / 强停重开后存档仍在 | 通过 | — |
| 以应用身份请求 `https://api.deepseek.com/` | 证书校验通过（401，未带 key） | — |

结构（`build-apk.sh`，不用 Gradle：javac + d8 + aapt2 + zipalign + apksigner）：

- `lib/<abi>/libnode.so` 等：`pack-jnilibs.py` 把 Termux 的 node 改名放进 jniLibs（数据目录禁止 execve），
  带版本号的依赖改名为 `libt*.so`（避开系统同名的 libssl/libcrypto/libicuuc），同步改 DT_NEEDED、SONAME、
  符号版本表里的文件名，RUNPATH 改 `$ORIGIN`。Termux 的 aarch64 产物 LOAD 段按 16 KB 对齐，静态上满足 16 KB 页设备。
- `assets/payload.bin`：DSH 运行时 + tavern profile + 源码（gzip tar，STORED 存放以便 `openFd`），首次启动由 Java 解到 `files/t`。
- `TavernService`：前台服务（specialUse），清空环境后用 `--use-bundled-ca --expose-internals --require preload.cjs` 拉起 DSH。
- `MainActivity`：状态页 + 全屏 WebView，支持文件选择、外链交给浏览器、按系统栏/键盘让出边距，返回键退到后台不停服务。

APK 阶段新发现并处理的：

| 问题 | 处理 |
| --- | --- |
| Termux 的 node 读 Termux 路径下的 CA 文件，APK 里没有 → **所有 HTTPS 校验失败**（真实模型调用必挂；命令行验证用固定输出模型没暴露） | `--use-bundled-ca`，并在 `NODE_OPTIONS` 里给继承环境的子进程也加上 |
| PackageManager 只解出 `lib*.so`；Termux 库名带版本号 | `pack-jnilibs.py` 改名并改写引用 |
| 命令行版安装不带手机布局（安装器只在 host=android 时选 `dsh-web-mobile`） | `stage-payload.sh` 用仓库里已打补丁的 `dsh-web-mobile@3.1.0` 补进 profile |
| Playwright 按 `ps -A \| grep <pid>` 反查 WebView 包名，会取到父进程号相同的 `libnode.so` | 验收脚本按 pid 选 WebView |

```sh
# 准备好 src 与 dsh-home（见下方「用法」1–2 步）后：
bash android/native/build-apk.sh output/native-proto/src output/native-proto/fakehome/.dsh-tavern
# 只改了 Java/清单：REUSE_PAYLOAD=1 跳过载荷组装
node android/native/apk-smoke.mjs            # 卸载 → 安装 → 验收；报告在 output/native-proto/apk-smoke/
```

**发布前必须解决**：

- ~~程序与数据没分开~~（v2 已解决）：换 APK 后只替换程序文件（`src/`、`usr/`、`home/.dsh-tavern/runtime/`、
  `profiles/tavern/` 下除 `cordis.patch.yml` 以外的内容），其余用户数据只在缺失时播种。模型与服务商设置在
  `profiles/tavern/cordis.patch.yml`，按用户数据保留。`apk-upgrade-smoke.mjs` 验证：旧版玩一局并改动凭据、模型设置、
  自定义文件 → 覆盖安装新版 → 改动全部保留、旧程序文件被清掉、旧对局能接着玩。
  代价：`cordis.patch.yml` 里安装器管理的条目（侧栏页签、内置插件路径）在升级时不会更新。
- ~~数据目录写死~~（v2 已解决）：打包时记录含设备路径的文件（`.payload-root-files`），实际目录不同时启动前改写。
  多用户 / 工作资料环境未实测。
- 应用内更新：v2 起由 `DSH_TAVERN_UPDATE_CHANNEL=apk` 关闭（检查更新照常，开始更新提示覆盖安装新 APK）。
- 系统代理：v2 起由 Java 读 `ConnectivityManager.getDefaultProxy()` 传入 `HTTP(S)_PROXY`；`settings get` 的传参错误已在
  `proxy-environment.mjs` 修复（应用进程能否执行 `settings` 因机型而异）。
- 调试签名、`android:debuggable="true"`、包名 `io.github.flizzywine.dshtavern.bionic` 都是原型用的。
- **arm64 真机**：用户实测能安装、开局、生成（2026-11-22）；其他功能未测。

## 命令行验证（2026-11-22，同一模拟器）

`node android/native/device-smoke.mjs` 连续 2 次全新数据目录通过，页面零报错：

| 项 | 结果 |
| --- | --- |
| 冷启动到监听 | 约 5.2 s（无 proot、无 rootfs 解包） |
| 首屏可操作 | 约 1.2 s |
| 开局（写开场白） | 约 1.1 s |
| 发一轮到正文出现（固定输出模型） | 约 1.9–2.1 s |
| kill -9 后冷重启、存档仍在 | 通过 |
| 服务端卡脚本 / MVU 结算（jsdom + `--permission` 子进程） | 通过（`gold` 结算为 10） |
| DSH 主进程 RSS | 445–502 MB；另有模板 worker 约 130 MB |
| 设备上占用 | 1.7 GB（Node 及依赖 92 MB，DSH 运行时 1.0 GB，profile 344 MB，源码 270 MB） |
| 传输包 | 378 MB（gzip） |

Termux 的 Node 不需要 Termux 应用：`/data/local/tmp` 下解开 .deb 就能跑，`process.platform === 'android'`。

## 必须处理的 5 个平台差异

| # | ��题 | 现象 | 处理 |
| --- | --- | --- | --- |
| 1 | `node-addon-require-builtin` 无 bionic 预编译 | 启动即失败 | `shims/node-addon-require-builtin`：`--expose-internals` 下直接 `require`；`internal/bootstrap/realm` 改从 `internal/test/binding` 取 `internalBinding` |
| 2 | `node-addon-system` 的 flock 无 bionic 预编译 | 会话写不进 | `shims/node-addon-system/lib/flock.js`：单进程直接视为加锁成功，保留 EBADF |
| 3 | SELinux 拒绝 `link(2)`（EACCES） | 开局报「写入人物卡开场白失败」；解 pnpm 包时硬链接失败 | `shims/android-preload.cjs`：link 回退为同目录副本 + 不覆盖 rename；打包用 `tar --hard-dereference` |
| 4 | Termux Node 把 `shell:true` 写死成 `/data/data/com.termux/files/usr/bin/sh` | `exec` 报 ENOENT | 同一预加载：默认 shell 换成 `/system/bin/sh` |
| 5 | 模板 worker 只传 `NODE_ENV`，`LD_LIBRARY_PATH` 丢失 | 「服务端提示词模板进程退出 (1)」 | `patch-runpath.py`：Node 与 .so 的 RUNPATH 原地改成 `$ORIGIN`，与环境变量无关 |

另外：`--expose-internals` 不能放进 `NODE_OPTIONS`，只能写在启动参数里（`run.sh` 已这样做）。

## 用法

```sh
# 1) 取 Termux 的 nodejs-lts 及依赖（校验 SHA-256，写 lock.json）
python3 android/native/fetch-termux-node.py --arch x86_64 --out output/native-proto/termux-x86_64   # 真机用 aarch64

# 2) 在隔离目录做一次命令行版安装（src 与 home 须同一父目录）
git archive HEAD | tar -x -C output/native-proto/src
#    安装时加 npm_config_ignore_scripts=true：不运行任何第三方安装脚本，也不需要原生编译。
#    注意：安装器会替换 ~/.local/bin/dsh-tavern（会留 .backup.* 备份），装完要换回去。

# 3) 组装：删其他平台预编译、换替身、改 RUNPATH、改写主机绝对路径、生成 run.sh
bash android/native/stage-payload.sh output/native-proto/termux-x86_64/usr output/native-proto/src \
  output/native-proto/fakehome/.dsh-tavern output/native-proto/out /data/local/tmp/np

# 4) 推送并验收
adb push output/native-proto/out/payload.tar.gz /data/local/tmp/np/ && adb shell 'cd /data/local/tmp/np && tar -xzf payload.tar.gz'
node android/native/device-smoke.mjs        # 报告与截图在 output/native-proto/smoke/
```

## 还没做 / 已知问题

- **arm64 真机未验证**：只在 x86_64 模拟器上跑过。Termux aarch64 产物已按 16 KB 对齐，但没有真机结果。
- **依赖按 linux-x64 安装后再裁剪**：正式构建应直接按目标平台解析（`npm --os=android --cpu=arm64`）。sharp、ripgrep、node-pty 目前缺失，暂时只影响懒加载的附件预览等功能。
- **link 回退有 TOCTOU 窗口、flock 是空实现**：单进程可接受。正式版建议用 NDK 编一个小 N-API addon，提供真正的 `flock` 和 `renameat2(RENAME_NOREPLACE)`，这样 #2、#3 的语义都能和上游一致。
- **APK 外壳**：已完成原型，见上方「APK」一节。
- **体积**：DSH 运行时 1.0 GB 是大头，`@deepseek-ai` 下约 520 MB，尚未分析哪些是酒馆用不到的。
- **噪声**：`proxy-environment.mjs` 在 android 上调用 `settings get global http_proxy`，会打出 6 行 `Invalid namespace`；`internal/test/binding` 警告的过滤还没生效。两者都不影响功能。
- 安装器写出的 `cordis.patch.yml` 里有一条 `dsh-asset-library` 指向开发仓库的绝对路径（`/mnt/E/vibecode/dsh-tavern/node_modules/...`），后面还有一条正确的同 id 条目覆盖它。
