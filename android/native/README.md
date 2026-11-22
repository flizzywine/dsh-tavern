# 原生 bionic 原型（方案 ③）

目标：APK 不再内置 Ubuntu + proot，直接用 Termux 编译好的 Android 原生 Node 跑酒馆 DSH。
本目录是可复现的原型：取包 → 组装 → 推到设备 → 浏览器验收。还没有 APK 外壳。

## 结论（2026-11-22，x86_64 模拟器 Android 16 / API 36，4 KB 页）

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

- **arm64 真机、16 KB 页设备未验证**：只在 x86_64 模拟器上跑过。aarch64 包的取法相同。
- **依赖按 linux-x64 安装后再裁剪**：正式构建应直接按目标平台解析（`npm --os=android --cpu=arm64`）。sharp、ripgrep、node-pty 目前缺失，暂时只影响懒加载的附件预览等功能。
- **link 回退有 TOCTOU 窗口、flock 是空实现**：单进程可接受。正式版建议用 NDK 编一个小 N-API addon，提供真正的 `flock` 和 `renameat2(RENAME_NOREPLACE)`，这样 #2、#3 的语义都能和上游一致。
- **APK 外壳**：Node 以 `libnode.so` 放进 `jniLibs`（数据目录禁止执行），.so 同目录、RUNPATH `$ORIGIN`；前台服务拉起 Node + WebView。可复用 DSHA 里 `HarnessService` / `WebPreviewActivity` 的结构。
- **体积**：DSH 运行时 1.0 GB 是大头，`@deepseek-ai` 下约 520 MB，尚未分析哪些是酒馆用不到的。
- **噪声**：`proxy-environment.mjs` 在 android 上调用 `settings get global http_proxy`，会打出 6 行 `Invalid namespace`；`internal/test/binding` 警告的过滤还没生效。两者都不影响功能。
- 安装器写出的 `cordis.patch.yml` 里有一条 `dsh-asset-library` 指向开发仓库的绝对路径（`/mnt/E/vibecode/dsh-tavern/node_modules/...`），后面还有一条正确的同 id 条目覆盖它。
