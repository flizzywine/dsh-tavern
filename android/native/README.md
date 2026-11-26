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

## 启动页、后台保活、图片处理、两档更新（v3）

- **启动页**：状态（运行时长、内存、自动重启次数）、进入酒馆 / 重启 / 停止、检查更新、局域网访问开关（默认关闭；开启后
  DSH 仍固定监听 `127.0.0.1:3081` 并通过 `--trusted-host` 信任探测到的私有局域网/热点/VPN IPv4，由 `LanProxy` 在同端口透明转发，
  排除蜂窝网卡与公网 IP，展示带令牌链接并支持复制/分享/刷新地址）、后台运行设置、查看与分享日志、
  退出。默认服务就绪后直接进酒馆，在酒馆根页按返回键回到启动页；可关掉「打开应用后直接进入酒馆」。
  页底「高级」默认折叠，每次打开都收起：
  - 「救援存档」：不用启动酒馆，直接停服后调用 `tavern-plugin/lib/rescue-export.mjs` 按 `dataRoot` 离线导出标准 `.dshtransfer` 备份包
    （与酒馆内「导出」同源，不含 API key 与账号，可直接用酒馆「导入」恢复；局部文件损坏时跳过坏项并记录告警，尽量救出其余完好数据）。
    Node 或源码损坏导致脚本跑不起来时，自动兜底用 Java 把 `files/t` 下所有非程序文件（`!isProgram`，跳过 `quarantine`、`tmp` 和静态缓存）
    流式打成原始数据 `.zip`（含本机配置，弹窗提示妥善保管）。完成后通过系统 `ACTION_CREATE_DOCUMENT` 让用户选位置流式保存，
    完整日志写进 `files/logs/rescue.log`（随「分享日志」一并带出），服务自动恢复导出前状态。
  - 「修复酒馆」（取代原来的「重置程序文件」）：停服 → 清掉 `src.next`、`update-backup`、`pnpm-store` →
    数据体检（`DataRepair.java`，跳过程序文件、`node_modules`、`backups`）→ 重新解出程序文件 → 启动并等就绪（最多 3 分钟）。
    体检只移动不删除，原文件按原路径放进 `files/t/quarantine/<时间>/`：JSON/YAML 为空、含空字节、非 UTF-8 或 JSON 解析失败时，
    有完好的 `.bak` / `.backup` / `.prev` 就用它恢复，否则移走（安装包自带的随后补回，其余由酒馆重建）；JSONL 只有最后一行坏时
    备份后截掉该行，中间有坏行只报告；`*.tmp` 移走，`tmp-exports` 清掉。`cordis.patch.yml` 或 `.credentials.yaml` 被移走时提示重填
    API key。完成后弹窗给结果，完整报告在 `files/logs/repair.log`。
  - 「完全重置」：删除整个 `files/t`（程序文件和全部用户数据）、清掉 WebView 的 localStorage / Cookie / 缓存，再按首次启动
    重新解压；保留 `files/logs` 和启动页设置。两次警告，第二次的确认键禁用 5 秒。
- **后台保活**：前台服务 + 部分唤醒锁（可关）+ 申请电池优化白名单；Node 意外退出（Android 12+ 清理后台子进程、
  内存不足、崩溃）后 2 秒自动重启，5 分钟内超过 3 次则停下并提示；覆盖安装后由 `MY_PACKAGE_REPLACED` 拉起服务。
  服务重启后访问令牌会变，WebView 自动换新地址并清掉失效的返回历史。
- **图片处理**：sharp 没有 Android 预编译，打包时装上同版本的官方 `@img/sharp-wasm32`（`fetch-npm-packages.py`，
  校验 npm integrity），sharp 的加载器在 `android-*` 平台上会落到 wasm 版。
- **两档更新**（`shims/source-update.mjs`，用仓库现成的 `bin/download.cjs` 读运行清单、下载 `runtime.zip`）：
  1. **应用内更新**（v5 起依赖变化也走这一档）：清单里有更大的 `releaseSequence`，且 DSH 运行时（`config/cli-runtime`）没变 →
     下载到 `src.next` → 停服 → 换上（旧的留作 `src.prev`）→ 备份 profile 配置 → 跑一遍与命令行版相同的两步安装
     （`pnpm install --prod` 装根依赖 + `bin/dsh-tavern.mjs install --host cli`）→ 启动。安装用 APK 自带的 pnpm 11.24
     （`usr/lib/dsh-android/pnpm`，与打包时装 node_modules 的版本一致），已装好的包原样复用，只下载新增和变化的包。
     - 依赖指纹（`package.json` 的依赖字段、各锁文件、补丁、`config/dsh-compatibility.json`）变了时，`node_modules`
       先整份复制给新源码、profile 的 `node_modules` 也整份备份，任何一步失败都能原样换回；没变时直接搬过去。
     - 安装失败或新版本 3 分钟内起不来 → 自动回退源码与 profile；完整输出在 `files/logs/update.log`。
     - pnpm 参数：`package-import-method=copy`（不能硬链接）、`ignore-scripts`、`prefer-offline`、默认镜像 npmmirror
       （`DSH_TAVERN_NPM_REGISTRY` 可改）；pnpm 11 只读 `pnpm_config_*` 环境变量，`npm_config_*` 不生效。
       各 `.modules.yaml` 里打包机的 store 路径会先改成手机上的，否则 pnpm 会清空整个目录重装。
     - 平台：根依赖用 `--os=android --cpu=arm64 --cpu=x64 --cpu=wasm32`，sharp 只装 wasm 版。
     - 预加载补的平台差异：应用数据目录里的文件不能执行，`dsh` 之类 `#!/usr/bin/env node` 脚本改成用 libnode.so 运行，
       `pnpm` 命令映射到自带的 pnpm，`command -v node|pnpm` 探测直接放行，直接跑 DSH 的 `bin.js` 时补 `--expose-internals`。
     - 安装器在 `DSH_TAVERN_MOBILE_LAYOUT=1` 时与 Android 宿主一样装 `dsh-web-mobile`（`bin/profile-configuration.mjs`）。
  2. **整包更新**：DSH 运行时变了，或有 versionCode 更大的安装包 → 读发布信息 `dsh-tavern-native.json`（`build-apk.sh` 生成，
     随 APK 上传到 GitHub Release，默认地址 `releases/latest/download/dsh-tavern-native.json`）→ 流式下载并校验 SHA-256
     → PackageInstaller 覆盖安装。覆盖安装时，热更新过、比安装包自带的新、且依赖指纹相同的源码会保留。
  源码版本记录在 `src/.native-source.json`（打包时由 `stage-payload.sh` 写入，同一份放在 `assets/payload-source.json`）。
- **离线内置**：运行需要的东西全部在 APK 里，首次启动不联网。v5 起额外内置：根依赖 `src/node_modules`（安装器自己要用，
  65 MB）、pnpm（21 MB）、预置 npm 元数据缓存 `pnpm-cache`（57 MB，打包时 `--lockfile-only` 解析得到），APK 由 416 MB 增至 444 MB。
  因此应用内更新只为新增/变化的包联网。仍需联网的：模型 API；卡片脚本从 jsDelivr 等 CDN 加载的库（经酒馆静态资源缓存，
  首次加载后离线可用）；更新本身。
- 验收：`apk-launcher-smoke.mjs`（本机起 HTTP 服务充当更新源，`make-test-release.sh` 生成清单、`runtime.zip` 与发布信息）、
  `apk-deps-update-smoke.mjs`（依赖变化的应用内更新与失败回退）。
  模拟器上全流程通过：sharp wasm 缩放 1600×1200→400×300 WebP 约 0.3 秒；`kill -9` 后约 8 秒自动重启；退到后台 + 强制 Doze
  30 秒服务仍在；依赖没变的源码更新约 50 秒（含重启；v5 起也会跑一遍安装器）；插件新增依赖时应用内更新 37 秒（含重启；有预置元数据缓存时只下载 14 个包，没有时 59 个），新依赖可解析，
  存档与手机布局保留；依赖装不上（404）时 15 秒内回退到原版本、服务照常；更换 DSH 运行时提示新安装包，下载校验后覆盖安装，
  热更新过的源码与存档都保留。单测：`tests/android-native-source-update.test.mjs`（指纹、运行时指纹、换源码/备份/回退/清理）。

已知限制：

- 依赖有变化的更新期间要额外占用约一份 node_modules 的空间（复制 + 备份，约 450 MB），完成后清掉。
- 新版安装包检查（v7 起）：启动页打开时由 Java 直接读发布信息，不依赖 Node。依次读 main 上的
  `android/native/latest.json`（GitHub raw → jsDelivr），都读不到再读 `releases/latest/download/dsh-tavern-native.json`
  （1.0.0-beta.1 只认这个地址，新酒馆 Release 仍要带上它）。6 小时内复用上次结果，手动「检查更新」不受限；失败只记日志。
  有新版时：在启动页弹窗（下载安装 / 浏览器下载 / 跳过此版本），已进酒馆时通知栏显示「有新版安装包」，点通知回启动页弹窗。
  `signer`（发布证书 SHA-256）与本机签名不同时不提示；当前版本低于 `minVersionCode` 时弹窗不能跳过。
  发布顺序：先上传 APK、`.sha256` 与 `dsh-tavern-native.json` 并核对字节数和 SHA-256，最后才把 `build-apk.sh` 生成的同一份内容
  提交为 `android/native/latest.json`，避免先提示后 404。测试源仍用 extra-env 的 `DSH_NATIVE_APK_FEED`（覆盖全部地址）。
- 打包时源码的 `releaseSequence` 取仓库里 `dsh-tavern-runtime.json` 的值，只有 CI 发布了更大的序号才会提示更新。
- 预检查只能从清单比对锁文件与补丁；只改了 `package.json` 时显示「依赖可能有变化」，下载后才最终判定。
- 模拟器上的发现：强制 Doze 后 `uiautomator` 有时看不到应用窗口；启动页曾因每 0.5 秒无条件刷新文字而一直不空闲，已改为只在变化时更新。

## 启动页、图标与正式 Beta（v6 起）

- **外观**：启动页配色、圆角、分段按钮、列表行取自酒馆本体（米白底 `#faf9f5`、米色槽 `#f3eae2`、强调色 `#c27d5d`）。
  应用名「DSH Tavern Beta」；启动器图标由 `make-icons.py` 从 `docs/assets/brand/dsh-tavern-app-icon-512.png` 生成
  （自适应图标，背景取图标自身的米色），通知栏小图标是图标线稿。
- **状态栏**：主题设为浅色状态栏（深色图标）；进入酒馆后每 1.5 秒取页面顶部的实际背景色，状态栏底色与图标深浅跟着变，
  酒馆切到深色主题也看得清。
- **预置 CDN 资源**：`seed-static-cache.mjs` 在打包时用酒馆自己的静态资源缓存下载卡片 iframe 每次都加载的 SillyTavern 兼容样式表
  （20 个，约 380 KB，列表从 `client.js` 的 `SILLYTAVERN_CSS_COMPAT` 读），写进用户数据的缓存目录，首次打开卡片不联网。
  本机 15 份历史缓存的统计里，只有这 20 个是所有安装都会取的；其余是各卡片自己的图片、字体，不预置。
  MVU 依赖、jQuery、Vue、lodash、zod 等早已随酒馆内置（`tavern-plugin/lib/vendor`）。
- **正式版构建**：`RELEASE=1` 关闭 debuggable、用发布密钥签名、WebView 远程调试随之关闭；发布信息里的 `url` 用 `APK_URL`
  给绝对地址（GitHub 资产会重定向到别的域名，相对地址解析会错）。安装包随酒馆版本发布：APK、`.sha256` 与
  `dsh-tavern-native.json` 上传到对应的酒馆 Release（如 `v3.4`），更新源默认读「最新 Release」里的 `dsh-tavern-native.json`，
  所以每个新的酒馆 Release 都要带上这三个文件，否则启动页显示「还没有发布原生版安装包」。调试版与正式版签名不同，不能互相覆盖安装。
  正式版不可调试，`run-as` 用不了：设备验收脚本照旧用调试版跑；正式版用 `release-smoke.mjs` 走界面冒烟
  （全新安装 → 首次启动 → 进酒馆 → 回启动页 → 检查更新）。发布密钥在打包机的 `~/.config/dsh-tavern-android/`（不进仓库），
  丢了就无法给已安装的用户发覆盖更新，务必备份。
- **发布脚本**：`bash android/native/release.sh <versionCode> <versionName> <酒馆 Release 标签>`（如 `8 1.0.0-beta.3 v3.5`）。
  依次导出 HEAD 源码、隔离安装、`RELEASE=1` 打包，核对包名/版本号、非 debuggable、签名指纹与 `latest.json` 一致、发布信息的
  字节数与 SHA-256；再上传 APK、`.sha256`、`dsh-tavern-native.json`，下载回来逐个比对并按公开地址核对字节数，全部通过后才在本地提交
  `latest.json`（不推送）。`NO_UPLOAD=1` 只打包核对，`SKIP_BUILD=1` 复用已打好的包续跑；`RELEASE_NOTES`、`MIN_VERSION_CODE` 透传给发布信息。
  versionCode 不大于 `latest.json` 时拒绝（`FORCE=1` 跳过）；目标标签不是最新 Release 时提醒（1.0.0-beta.1 只读最新 Release）。
- **1.0.0-beta.1**（versionCode 6，发布在 `v3.4`）：模拟器上正式版冒烟通过，首次启动 22 秒就绪、冷启动 6 秒，
  检查更新显示「已是最新」。

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
