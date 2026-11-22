#!/usr/bin/env bash
# 把「Termux 编译的 Node + 酒馆源码 + 一次命令行版安装结果」组装成设备上可直接运行的目录树。
#   bash android/native/stage-payload.sh <termux-usr> <src> <dsh-home> <out> <device-root>
# 产物 <out>/payload.tar.gz 解包到 <device-root> 后：
#   <device-root>/usr                Termux 的 node 与依赖 .so
#   <device-root>/src                酒馆源码（profile 用相对软链接引用它）
#   <device-root>/home/.dsh-tavern   DSH 运行时、tavern profile、数据
#   <device-root>/run.sh             前台启动 DSH（--expose-internals，固定 tavern profile）
set -euo pipefail
USR=$(realpath "$1"); SRC=$(realpath "$2"); DSH_HOME=$(realpath "$3"); OUT=$4; DEVICE_ROOT=$5
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
STAGE="$OUT/stage"
rm -rf "$STAGE"; mkdir -p "$STAGE/home"
cp -a "$USR" "$STAGE/usr"
cp -a "$SRC" "$STAGE/src"
cp -a "$DSH_HOME" "$STAGE/home/.dsh-tavern"
H="$STAGE/home/.dsh-tavern"
rm -rf "$H/logs" "$H/backups"; mkdir -p "$H/logs"

# 0) 手机布局：安装器只在 host=android（DSHA）时选 dsh-web-mobile，命令行版不带。
#    它只有对 DSH 运行时的 peer 依赖；用仓库里已打补丁的同版本包，插到 dsh-web-app 之后。
if [ -n "${PAYLOAD_MOBILE_LAYOUT:-}" ]; then
  P="$H/profiles/tavern"
  rm -rf "$P/node_modules/dsh-web-mobile"
  cp -rL "$PAYLOAD_MOBILE_LAYOUT" "$P/node_modules/dsh-web-mobile"
  python3 - "$P/package.json" <<'PY'
import json, sys
path = sys.argv[1]; doc = json.load(open(path))
for holder, key in ((doc['dsh']['profile'], 'bundles'), (doc.setdefault('dshTavern', {}), 'managedBundles')):
    items = holder.get(key) or []
    if 'dsh-web-mobile' in items: continue
    at = items.index('@deepseek-ai/dsh-web-app') + 1 if '@deepseek-ai/dsh-web-app' in items else len(items)
    holder[key] = items[:at] + ['dsh-web-mobile'] + items[at:]
json.dump(doc, open(path, 'w'), indent=2, ensure_ascii=False)
PY
fi

# 1) 删掉其他平台的预编译包：bionic 上一个都加载不了，只占体积。
NM="$H/runtime/lib/node_modules"
before=$(du -sm "$STAGE" | cut -f1)
find "$NM" "$H/profiles" -mindepth 1 -maxdepth 6 -type d \
  \( -name '*-darwin-*' -o -name '*-win32-*' -o -name '*-linux-x64*' -o -name '*-linux-arm64*' \
     -o -name '*-linuxmusl-*' -o -name 'sherpa-onnx-linux-*' \) \
  ! -name 'dsh-win32-process' \
  -path '*node_modules*' -prune -exec rm -rf {} +
# node-pty 的各平台 prebuild（酒馆关了终端，不会加载）。
rm -rf "$NM/node-pty/prebuilds"
# Termux 包里与运行无关的部分。
rm -rf "$STAGE/usr/include" "$STAGE/usr/share/doc" "$STAGE/usr/share/man" "$STAGE/usr/lib/node_modules/npm" "$STAGE/usr/lib/node_modules/corepack" "$STAGE/usr/lib/cmake" "$STAGE/usr/lib/pkgconfig"

# 2) 换上 bionic 替身。
for target in $(find "$H" -type d -path '*node_modules/node-addon-require-builtin' -not -path '*/.pnpm/*/node_modules/*/node_modules/*'); do
  cp -f "$HERE/shims/node-addon-require-builtin/lib/index.js" "$target/lib/index.js"
done
for target in $(find "$H" -type d -path '*node_modules/@deepseek-ai/node-addon-system'); do
  cp -f "$HERE/shims/node-addon-system/lib/flock.js" "$target/lib/flock.js"
done
mkdir -p "$STAGE/usr/lib/dsh-android"
cp -f "$HERE/shims/android-preload.cjs" "$STAGE/usr/lib/dsh-android/preload.cjs"

# 2b) RUNPATH 改成 $ORIGIN：子进程即使被清空环境（模板 worker 只传 NODE_ENV）也能找到自己的 .so。
python3 "$HERE/patch-runpath.py" '$ORIGIN/../lib' "$STAGE/usr/bin/node" >/dev/null
python3 "$HERE/patch-runpath.py" '$ORIGIN' $(find "$STAGE/usr/lib" -maxdepth 1 -name '*.so*' -type f) >/dev/null

# 3) 主机绝对路径改成设备路径（只改文本配置；node_modules 内部是相对软链接）。
HOST_ROOT=$(dirname "$SRC")
[ "$(dirname "$(dirname "$DSH_HOME")")" = "$HOST_ROOT" ] || { echo "src 与 dsh-home 需位于同一父目录（profile 的 link: 依赖按相对路径解析）" >&2; exit 1; }
HOST_HOME_PARENT=$(dirname "$DSH_HOME")
grep -rIl --exclude-dir=node_modules -e "$HOST_ROOT" "$H" | while read -r f; do
  sed -i -e "s|$HOST_HOME_PARENT|$DEVICE_ROOT/home|g" -e "s|$HOST_ROOT/src|$DEVICE_ROOT/src|g" "$f"
done
for f in "$H/profiles/tavern/node_modules/.pnpm/lock.yaml"; do
  [ -f "$f" ] && sed -i -e "s|$HOST_HOME_PARENT|$DEVICE_ROOT/home|g" -e "s|$HOST_ROOT/src|$DEVICE_ROOT/src|g" "$f"
done
# profile 指向 src 的软链接：在主机上是 ../../.. 相对于 fakehome；设备上改成 home 布局后层级不变则无需处理。
broken=$(find "$H/profiles" -maxdepth 3 -xtype l | head -5)

# 4) 设备侧启动脚本。
cat > "$STAGE/run.sh" <<EOF
#!/system/bin/sh
# 前台运行酒馆 DSH。APK 外壳将来做的事与此相同：清空环境、指定 HOME、带 --expose-internals 启动。
R=$DEVICE_ROOT
export HOME=\$R/home TMPDIR=\$R/tmp LD_LIBRARY_PATH=\$R/usr/lib
export DSH_HOME=\$HOME/.dsh-tavern DSH_TAVERN_CLI_HOME=\$HOME/.dsh-tavern DSH_TAVERN_RUNTIME_HOST=cli
export PORT=\${PORT:-3081} NODE_OPTIONS=--use-bundled-ca
mkdir -p \$TMPDIR
# 打包机文件系统可能不保留权限（如 NTFS 全是 755）；DSH 要求凭据文件仅属主可读。
[ -f \$DSH_HOME/.credentials.yaml ] && chmod 600 \$DSH_HOME/.credentials.yaml
cd \$R/src
exec \$R/usr/bin/node --max-old-space-size=\${DSH_TAVERN_MAX_OLD_SPACE_MB:-1024} --use-bundled-ca --expose-internals --require \$R/usr/lib/dsh-android/preload.cjs \\
  \$DSH_HOME/runtime/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile tavern --host 127.0.0.1 --port \$PORT --no-open
EOF
chmod +x "$STAGE/run.sh"
# APK 模式：node 和 .so 走 jniLibs（pack-jnilibs.py），载荷里只留预加载脚本。
if [ "${PAYLOAD_SKIP_NATIVE:-0}" = 1 ]; then
  find "$STAGE/usr" -mindepth 1 -maxdepth 1 ! -name lib -exec rm -rf {} +
  find "$STAGE/usr/lib" -mindepth 1 -maxdepth 1 ! -name dsh-android -exec rm -rf {} +
  rm -f "$STAGE/run.sh"
fi
after=$(du -sm "$STAGE" | cut -f1)
# 设备实际数据目录与打包时不同（多用户、工作资料）时，APK 按这份清单改写路径。
printf '%s\n' "$DEVICE_ROOT" > "$STAGE/.payload-root"
( cd "$STAGE" && grep -rlIF -e "$DEVICE_ROOT" --exclude=.payload-root . | sed 's|^\./||' | sort ) > "$STAGE/.payload-root-files"
echo "含设备路径、需要按实际目录改写的文件：$(wc -l < "$STAGE/.payload-root-files") 个"
# Android SELinux 不允许应用创建硬链接（link(2) 被拒），pnpm 的硬链接一律存成普通文件。
tar -C "$STAGE" --hard-dereference -czf "$OUT/payload.tar.gz" .
echo "stage: ${before} MB → ${after} MB；payload.tar.gz $(du -m "$OUT/payload.tar.gz" | cut -f1) MB"
[ -z "$broken" ] || { echo "警告：profile 下有失效软链接：" >&2; echo "$broken" >&2; }
