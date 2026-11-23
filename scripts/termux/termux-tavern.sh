#!/data/data/com.termux/files/usr/bin/bash
# DSH Tavern × Termux 单文件：装 + 移动版布局 + 启动 + 自动打开酒馆页面。
#   bash termux-tavern.sh [install|start|stop|restart|status|open|update|logs]
#   bash termux-tavern.sh reinstall          # 已在装的情况下强制重跑安装器（会清掉 .git 标记）
#   bash termux-tavern.sh branch [分支名]    # 把已装的 main 源码切到测试分支（默认 backup/main-20261106）
#   bash termux-tavern.sh branch-revert      # 回到上一次切换前的版本
#   tavern <dsh-tavern 子命令>                # 装好后可用：带上本方案的环境调用 dsh-tavern
#
# 原生方案（与 DSH Tavern Beta APK 同一套）：直接用 Termux 的 nodejs-lts 跑酒馆，不再装 Ubuntu + proot。
# 与 glibc Linux 的差异由仓库 android/native/shims 里的文件处理，下载到 $SHIM_DIR，经 NODE_OPTIONS 预加载：
#   - node-addon-require-builtin、node-addon-system/flock 没有 Android 预编译 → JS 替身
#     （预加载在解析阶段重定向；装完后也写进已装的包，覆盖清空了环境变量的子进程）；
#   - DSH 需要 --expose-internals，而它不能放进 NODE_OPTIONS → 预加载把 #!node 脚本改成 node --expose-internals 运行；
#   - sharp 没有 Android 预编译 → 补装同版本的 @img/sharp-wasm32；第三方安装脚本一律不跑，不需要原生编译。
# 旧版（proot 容器）里的存档在首次安装时自动复制过来，容器本身不动。探活只认端口和日志 token。
set -euo pipefail

VERSION=2026-11-23.1
: "${PREFIX:?请在 Termux 里运行}"
NODE_MIN=24.9.0
PORT=3081
ROOT=$HOME/.dsh-tavern
APP=$ROOT/apps/dsh-tavern
LOG=$ROOT/logs/tavern.log
# 放在安装目录之外：安装器要求全新安装的目录里没有别的东西。
SHIM_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/dsh-tavern-termux
SHIM_FILES='android-preload.cjs termux-preload.cjs node-addon-require-builtin/lib/index.js node-addon-system/lib/flock.js'
TMP=${TMPDIR:-$PREFIX/tmp}
WAIT_SCRIPT=$TMP/tavern-wait.sh
WAIT_OUT=$TMP/tavern-wait.out
BRANCH_SCRIPT=$TMP/tavern-branch.sh
START_OUT=$TMP/tavern-start.out
BRANCH_DEFAULT=${TERMUX_TAVERN_BRANCH:-backup/main-20261106}
# 安装脚本与替身的来源：raw.githubusercontent 实时反映 main；被墙时退回 jsDelivr。
SOURCE_URLS=${TERMUX_TAVERN_SOURCE_URLS:-https://raw.githubusercontent.com/flizzywine/dsh-tavern/main https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main}
# 旧版 proot 方案的位置：只用来迁移存档、停掉旧服务。
LEGACY_ROOTFS=$PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu
LEGACY_HOME=$LEGACY_ROOTFS/root/.dsh-tavern
LEGACY_PIDFILE=$PREFIX/var/run/tavern-proot.pid
URL_PAT='http://127[.]0[.]0[.]1:[0-9]*/?token=[A-Za-z0-9_-]*'
FORCE_INSTALL=0

mkdir -p "$TMP"
log() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

# 自更新：仓库里的 scripts/termux/termux-tavern.sh 是唯一源，脚本比对版本号后自替换，
# 之后手机上不必再手工传文件（CDN 未同步或离线时静默跳过）。
# 自更新源：raw.githubusercontent 实时反映 main；被墙时退回 jsDelivr。
SELF_URLS=${TERMUX_TAVERN_URL:-https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/scripts/termux/termux-tavern.sh https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/scripts/termux/termux-tavern.sh}
self_update() {
  [ -n "${TERMUX_TAVERN_NO_SELF_UPDATE:-}" ] && return 0
  command -v curl >/dev/null 2>&1 || return 0
  local self tmp new
  self=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
  [ -w "$self" ] || return 0
  tmp=$TMP/termux-tavern.new
  local got='' u
  for u in $SELF_URLS; do
    if curl -fsSL --connect-timeout 8 --max-time 25 "$u" -o "$tmp" 2>/dev/null; then got=1; break; fi
  done
  [ -n "$got" ] || return 0
  bash -n "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
  new=$(sed -n 's/^VERSION=//p' "$tmp" | head -n 1)
  [ -n "$new" ] && [ "$new" != "$VERSION" ] || { rm -f "$tmp"; return 0; }
  # 只接受更新：远端必须比本地新。否则用测试分支的脚本跑一次就被降级回 main 的旧版。
  # 老式 sort 不支持 -V 时退回原来的「有差异就替换」行为。
  if printf '%s\n%s\n' "$VERSION" "$new" | sort -V >/dev/null 2>&1; then
    if [ "$(printf '%s\n%s\n' "$VERSION" "$new" | sort -V | tail -n 1)" != "$new" ]; then
      rm -f "$tmp"
      return 0
    fi
  fi
  if cp "$tmp" "$self" && chmod +x "$self"; then
    rm -f "$tmp"
    log "脚本已更新：$VERSION → $new"
    TERMUX_TAVERN_NO_SELF_UPDATE=1 exec bash "$self" "$@"
  fi
  rm -f "$tmp"
  return 0
}

apt_install() {
  apt install -y "$@" 2>/dev/null && return 0
  local f
  for f in "$PREFIX"/etc/apt/sources.list.d/*; do
    [ -f "$f" ] || continue
    if grep -qs 'tur\.kcubeterm\.com' "$f"; then mv "$f" "$f.disabled"; fi
  done
  pkg update -y >/dev/null 2>&1 || true
  apt install -y "$@"
}
ensure_pkg() { command -v "$1" >/dev/null 2>&1 || apt_install "${2:-$1}"; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  env -u NODE_OPTIONS node -e '
const want = process.argv[1].split(".").map(Number), have = process.versions.node.split(".").map(Number)
for (let i = 0; i < 3; i++) if (have[i] !== want[i]) process.exit(have[i] > want[i] ? 0 : 1)' "$NODE_MIN"
}

ensure_node() {
  if ! node_ok; then
    log "[准备] 安装 Termux 的 nodejs-lts（需要 Node $NODE_MIN 或更高）"
    apt_install nodejs-lts || true
    hash -r
  fi
  node_ok || die "需要 Node $NODE_MIN 或更高，当前 $(node -v 2>/dev/null || printf '未安装')。装过 nodejs 的先 pkg uninstall nodejs，再 pkg install nodejs-lts"
  local platform
  platform=$(env -u NODE_OPTIONS node -p process.platform)
  [ "$platform" = android ] || die "当前的 node 不是 Termux 原生版（platform=$platform）。请直接在 Termux 里运行本脚本，不要在 proot 容器里运行"
  log "[准备] Node $(node -v)（Termux 原生）"
}

shims_ready() {
  local f
  for f in $SHIM_FILES; do [ -s "$SHIM_DIR/$f" ] || return 1; done
}
shims_valid() {
  local f
  for f in $SHIM_FILES; do [ -s "$1/$f" ] || return 1; done
  env -u NODE_OPTIONS node --check "$1/android-preload.cjs" >/dev/null 2>&1 \
    && env -u NODE_OPTIONS node --check "$1/termux-preload.cjs" >/dev/null 2>&1
}
# 预加载经 NODE_OPTIONS 传给所有 node 进程：安装器、pnpm、DSH 版本探测、酒馆服务、应用内更新。
use_preload() {
  shims_ready || return 0
  local preload="--require $SHIM_DIR/termux-preload.cjs"
  case " ${NODE_OPTIONS:-} " in
    *" $preload "*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }$preload" ;;
  esac
}
# 取 Android 替身（refresh=1 时总是重取；失败时保留已有的一份）。TERMUX_TAVERN_SHIM_SOURCE 可指向本地目录。
fetch_shims() {
  local refresh=${1:-0} tmp base f ok=''
  if [ "$refresh" != 1 ] && shims_ready; then use_preload; return 0; fi
  tmp=$(mktemp -d "$TMP/tavern-shims.XXXXXX")
  if [ -n "${TERMUX_TAVERN_SHIM_SOURCE:-}" ]; then
    if cp -R "$TERMUX_TAVERN_SHIM_SOURCE/." "$tmp/"; then ok=1; fi
  else
    for base in $SOURCE_URLS; do
      ok=1
      for f in $SHIM_FILES; do
        mkdir -p "$tmp/$(dirname -- "$f")"
        if ! curl -fsSL --connect-timeout 15 --max-time 120 "$base/android/native/shims/$f" -o "$tmp/$f" 2>/dev/null; then ok=''; break; fi
      done
      if [ -n "$ok" ]; then break; fi
    done
  fi
  if [ -n "$ok" ] && shims_valid "$tmp"; then
    mkdir -p "$(dirname -- "$SHIM_DIR")"
    rm -rf "$SHIM_DIR.old"
    if [ -d "$SHIM_DIR" ]; then mv "$SHIM_DIR" "$SHIM_DIR.old"; fi
    mv "$tmp" "$SHIM_DIR"
    rm -rf "$SHIM_DIR.old"
    log "[准备] Android 替身已就绪：$SHIM_DIR"
  else
    rm -rf "$tmp"
    shims_ready || die '下载 Android 替身失败（网络）'
    log '   替身更新失败，继续用已有的一份'
  fi
  use_preload
}

tavern_env() {
  export DSH_HOME=$ROOT DSH_TAVERN_CLI_HOME=$ROOT DSH_TAVERN_RUNTIME_HOST=cli
  # 与 APK 相同：命令行宿主也装手机布局 dsh-web-mobile；安装器和应用内更新都读这个变量。
  export DSH_TAVERN_MOBILE_LAYOUT=1 DSH_TAVERN_NO_OPEN=1
  # 不跑第三方安装脚本：Android 上没有它们要的原生预编译，也不在手机上编译。
  export npm_config_ignore_scripts=true pnpm_config_ignore_scripts=true
  export DSH_ANDROID_SHELL=$PREFIX/bin/sh DSH_ANDROID_PNPM_CLI=$ROOT/tools/lib/node_modules/pnpm/bin/pnpm.cjs
  export PATH=$ROOT/tools/bin:$HOME/.local/bin:$PATH
  use_preload
}

installed() { [ -f "$APP/bin/dsh-tavern.mjs" ]; }
tavern_cli() { node "$APP/bin/dsh-tavern.mjs" "$@"; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; }

# 把替身写进已装的包：清空了环境变量的子进程（如模板 worker）拿不到预加载，靠这一层。
# quick 只查 DSH 运行时里的两处（每次启动都做）；full 扫运行时、profile 与源码（装完 / 更新 / 切分支后做）。
patch_addons() {
  local scope=${1:-quick} rb=$SHIM_DIR/node-addon-require-builtin/lib/index.js fl=$SHIM_DIR/node-addon-system/lib/flock.js
  local dir src dst
  {
    if [ "$scope" = full ]; then
      find "$ROOT/runtime" "$ROOT/profiles" "$APP" -type d \
        \( -path '*/node_modules/node-addon-require-builtin' -o -path '*/node_modules/@deepseek-ai/node-addon-system' \) 2>/dev/null || true
    else
      printf '%s\n' "$ROOT/runtime/lib/node_modules/node-addon-require-builtin" "$ROOT/runtime/lib/node_modules/@deepseek-ai/node-addon-system"
    fi
  } | while IFS= read -r dir; do
    case $dir in
      */node-addon-require-builtin) src=$rb dst=$dir/lib/index.js ;;
      *) src=$fl dst=$dir/lib/flock.js ;;
    esac
    [ -f "$dst" ] || continue
    cmp -s "$src" "$dst" || cp -f "$src" "$dst"
  done
}

# sharp 没有 Android 预编译：装同版本的官方 wasm 版，sharp 的加载器在 android 上会落到它。
install_sharp_wasm() {
  local nm=$ROOT/runtime/lib/node_modules want have tmp pkg
  [ -f "$nm/sharp/package.json" ] || return 0
  want=$(node -p 'require(process.argv[1]).version' "$nm/sharp/package.json")
  have=$(node -p 'try { require(process.argv[1]).version } catch { "" }' "$nm/@img/sharp-wasm32/package.json" 2>/dev/null || true)
  [ "$have" != "$want" ] || return 0
  log "[安装] 图片处理：补装 @img/sharp-wasm32@$want"
  tmp=$(mktemp -d "$TMP/tavern-sharp.XXXXXX")
  # wasm 包声明了 cpu=wasm32，npm 按本机平台会拒装；--force 只跳过这项检查，integrity 照常校验。
  if ! npm install --prefix "$tmp" --no-save --no-package-lock --no-audit --no-fund --ignore-scripts --force \
      "@img/sharp-wasm32@$want" >"$tmp.log" 2>&1 || [ ! -f "$tmp/node_modules/@img/sharp-wasm32/package.json" ]; then
    tail -n 5 "$tmp.log" >&2 || true
    rm -rf "$tmp" "$tmp.log"
    return 1
  fi
  rm -rf "$nm/@img/sharp-wasm32"
  mkdir -p "$nm/@img"
  cp -R "$tmp/node_modules/@img/sharp-wasm32" "$nm/@img/"
  # 它的依赖（@emnapi/runtime 等）只补缺的，不动 DSH 运行时已有的包。
  for pkg in "$tmp"/node_modules/* "$tmp"/node_modules/@*/*; do
    [ -f "$pkg/package.json" ] || continue
    pkg=${pkg#"$tmp/node_modules/"}
    if [ ! -e "$nm/$pkg" ]; then
      mkdir -p "$nm/$(dirname -- "$pkg")"
      cp -R "$tmp/node_modules/$pkg" "$nm/$pkg"
    fi
  done
  rm -rf "$tmp" "$tmp.log"
}

# Termux 的命令 `tavern`：带上本方案的环境（替身预加载、手机布局等）调用 dsh-tavern。
write_wrapper() {
  local self
  self=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
  cat > "$PREFIX/bin/tavern" <<WRAPPER_EOF
#!$PREFIX/bin/sh
# 由 termux-tavern.sh 生成。
exec bash "$self" cli "\$@"
WRAPPER_EOF
  chmod +x "$PREFIX/bin/tavern"
}

post_install() {
  log '[安装] 把 Android 替身写进已装的包'
  patch_addons "${1:-full}"
  install_sharp_wasm || log '   sharp wasm 补装失败：只影响图片缩放（附件预览等），可稍后运行 update 重试'
  write_wrapper
}

# 停掉旧版 proot 方案留下的服务：它占着同一个端口。
stop_legacy() {
  local pid=''
  if [ -r "$LEGACY_PIDFILE" ]; then pid=$(cat "$LEGACY_PIDFILE" 2>/dev/null || true); fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log '[迁移] 停止旧版 proot 容器里的酒馆'
    if command -v proot-distro >/dev/null 2>&1; then
      env -u NODE_OPTIONS proot-distro login ubuntu -- bash -lc 'export PATH=/usr/local/node/bin:$HOME/.local/bin:$PATH; dsh-tavern stop' >/dev/null 2>&1 || true
    fi
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$LEGACY_PIDFILE"
}

# 旧版容器里有 CLI 安装时，作为迁移来源交给安装器（bin/cli-runtime.mjs migrateCliHome：
# 复制存档、人物卡、凭据与模型设置，原文件不动，只做一次）。
legacy_source() {
  [ -z "${TERMUX_TAVERN_NO_MIGRATE:-}" ] || return 1
  [ -f "$LEGACY_HOME/profiles/tavern/package.json" ] || return 1
  [ ! -f "$ROOT/.cli-home-migrated.json" ] || return 1
  local record=$LEGACY_HOME/logs/tavern.pid.json
  if [ -f "$record" ]; then
    if port_open; then
      log "   端口 $PORT 上还有服务在跑，跳过存档迁移；先 bash $0 stop 再 reinstall" >&2
      return 1
    fi
    # 旧服务已随容器停掉，这份记录只是残留；不挪开的话安装器会去找容器里的启动器而失败。
    mv "$record" "$record.termux-native-stale"
  fi
  printf '%s\n' "$LEGACY_HOME"
}

run_installer() {
  local ti=$TMP/tavern-install.sh base got='' legacy=''
  for base in $SOURCE_URLS; do
    if curl -fsSL --connect-timeout 15 --max-time 300 "$base/install.sh" -o "$ti"; then got=1; break; fi
    log "   下载失败：$base/install.sh"
  done
  [ -n "$got" ] || die '酒馆安装脚本下载失败（网络）'
  if ! installed; then legacy=$(legacy_source || true); fi
  if [ -n "$legacy" ]; then log "[迁移] 从旧版容器复制存档、人物卡与模型设置：$legacy（原文件保留）"; fi
  env DSH_TAVERN_HOST=cli ${legacy:+"DSH_TAVERN_LEGACY_DSH_HOME=$legacy"} sh "$ti" \
    || die "安装失败（输出见上）。重试：bash $0 reinstall${legacy:+；迁移旧存档出错时可加 TERMUX_TAVERN_NO_MIGRATE=1 先跳过迁移}"
}

do_install() {
  stop_legacy
  if [ "$FORCE_INSTALL" = 1 ] && [ -d "$APP" ]; then
    log '[安装] 强制重装：先清掉切换分支留下的 git 标记'
    rm -rf "$APP/.git"
    rm -f "$APP/.termux-tavern-branch"
  fi
  if installed && [ "$FORCE_INSTALL" != 1 ]; then
    log '[安装] 酒馆已安装，跳过'
    post_install quick
  else
    log '[安装] 安装酒馆（首次约 10–30 分钟，视网络而定）'
    run_installer
    post_install full
  fi
  if [ -d "$LEGACY_ROOTFS" ]; then
    log "旧版 proot 容器仍在：$LEGACY_ROOTFS。确认存档都在之后，可用 proot-distro remove ubuntu 释放空间。"
  fi
}

# 分支切换：停服务 → 备份现有源码 → 换成目标分支 → 重装依赖与 Profile →
# 补回移动版布局；随后由外层 do_start 重新拉起并打开页面。
# 备份留在 $HOME/.dsh-tavern/backups/branch-<时间戳>/，branch-revert 用最新一条。
write_branch() {
  cat > "$BRANCH_SCRIPT" <<'BRANCH_SCRIPT_EOF'
set -euo pipefail
ROOT="$HOME/.dsh-tavern"
APP="$ROOT/apps/dsh-tavern"
BACKUPS="$ROOT/backups"
REPO="${DSH_TAVERN_REPOSITORY:-https://github.com/flizzywine/dsh-tavern.git}"
TARBALL_BASE="${DSH_TAVERN_TARBALL_BASE:-https://codeload.github.com/flizzywine/dsh-tavern/tar.gz/refs/heads}"
BRANCH="$1"
ACTION="${2:-switch}"
export PATH="$ROOT/tools/bin:$HOME/.local/bin:$PATH"
# Termux 没有可写的 /tmp：临时文件放 $TMPDIR。
TARBALL="${TMPDIR:-/tmp}/tavern-branch.tar.gz"

fail() { printf '切换失败：%s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

[ -f "$APP/bin/dsh-tavern.mjs" ] || fail "没有找到已安装的酒馆：$APP（先运行 bash termux-tavern.sh install）"

version_of() {
  node -e 'try { process.stdout.write(String(require(process.argv[1]).version || "")) } catch (error) {}' \
    "$1/package.json" 2>/dev/null || true
}

pnpm_bin() {
  if [ -x "$ROOT/tools/bin/pnpm" ]; then printf '%s\n' "$ROOT/tools/bin/pnpm"
  else command -v pnpm; fi
}

stop_tavern() {
  node "$APP/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
  local i=0 tries=16
  [ -n "${TERMUX_TAVERN_STOP_WAIT:-}" ] && tries=$(( TERMUX_TAVERN_STOP_WAIT * 2 ))
  while [ "$i" -lt "$tries" ]; do
    (exec 3<>/dev/tcp/127.0.0.1/3081) >/dev/null 2>&1 || return 0
    sleep 0.5
    i=$((i + 1))
  done
  say '   端口 3081 仍在监听，继续切换。'
}

fetch_branch() {
  local dest="$1"
  rm -rf "$dest" 2>/dev/null || true
  if command -v git >/dev/null 2>&1; then
    if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 clone \
        --filter=blob:none --no-checkout --branch "$BRANCH" --single-branch \
        "$REPO" "$dest" >/dev/null 2>&1 \
      && git -C "$dest" sparse-checkout set --no-cone '/*' '!**/docs/' >/dev/null 2>&1 \
      && git -C "$dest" checkout -q "$BRANCH" >/dev/null 2>&1; then
      return 0
    fi
    rm -rf "$dest" 2>/dev/null || true
    say '   Git 拉取失败，改用压缩包'
  fi
  mkdir -p "$dest"
  curl -fsSL --connect-timeout 15 --max-time 900 -o "$TARBALL" "$TARBALL_BASE/$BRANCH" \
    || return 1
  tar -xzf "$TARBALL" -C "$dest" --strip-components=1 \
    --exclude='*/docs' --exclude='*/docs/*' || return 1
  rm -f "$TARBALL"
}

same_lock() {
  cmp -s "$APP/pnpm-lock.yaml" "$1/pnpm-lock.yaml" || return 1
  cmp -s "$APP/pnpm-workspace.yaml" "$1/pnpm-workspace.yaml" || return 1
  if [ -d "$APP/patches" ] || [ -d "$1/patches" ]; then
    diff -rq "$APP/patches" "$1/patches" >/dev/null 2>&1 || return 1
  fi
}

install_profile() {
  DSH_HOME="$ROOT" node "$APP/bin/dsh-tavern.mjs" install --host cli
}

# CLI 宿主会剔除 dsh-web-mobile，手机上必须补回来；与首次安装里的处理等价且幂等。
mobile_layout() {
  local P="$ROOT/profiles/tavern" PNPM
  [ -f "$P/package.json" ] || return 0
  if grep -q '"dsh-web-mobile"' "$P/package.json"; then
    say '   移动版布局已启用'
    return 0
  fi
  say '   启用移动版布局 dsh-web-mobile'
  PNPM="$(pnpm_bin)" || return 0
  (
    cd "$P"
    node -e '
const fs=require("fs");
const f="package.json"; const p=JSON.parse(fs.readFileSync(f,"utf8"));
p.dependencies=p.dependencies||{}; p.dependencies["dsh-web-mobile"]="3.1.0";
const dsh=p.dsh||(p.dsh={}); const prof=dsh.profile||(dsh.profile={});
const b=Array.isArray(prof.bundles)?prof.bundles:[];
if(!b.includes("dsh-web-mobile")) b.push("dsh-web-mobile");
prof.bundles=b; fs.writeFileSync(f, JSON.stringify(p,null,2)+"\n");
'
    [ -f patches/dsh-web-mobile@3.1.0.patch ] \
      || cp "$APP/patches/dsh-web-mobile@3.1.0.patch" patches/ 2>/dev/null || true
    if ! grep -q "dsh-web-mobile@3.1.0" pnpm-workspace.yaml; then
      sed -i.tavern-mobile '/^patchedDependencies:/a\
  dsh-web-mobile@3.1.0: patches/dsh-web-mobile@3.1.0.patch
' pnpm-workspace.yaml
      rm pnpm-workspace.yaml.tavern-mobile
    fi
    "$PNPM" install --reporter=append-only
  )
}

record() {
  local dir="$1"
  printf '%s\n' "$dir" >"$BACKUPS/branch-latest"
  printf '%s\n' "$BRANCH" >"$dir/target-branch"
  printf '%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" >"$dir/created"
}

# 整包切换：新建备份目录、整棵替换源码。首次切分支、换分支、源码不是 git 检出时用。
do_switch_full() {
  local stamp dir prev_ver new_ver
  stamp=$(date +%Y%m%d-%H%M%S)
  dir="$BACKUPS/branch-$stamp"
  mkdir -p "$dir"
  prev_ver=$(version_of "$APP")
  say "[切换] 当前 ${prev_ver:-未知} → 目标分支 $BRANCH"
  stop_tavern
  say '[切换] 拉取目标分支源码'
  fetch_branch "$dir/new-source" || fail "取不到分支 $BRANCH 的源码（网络或分支名）"
  [ -f "$dir/new-source/package.json" ] || fail '源码不完整（缺 package.json）'
  [ -f "$dir/new-source/bin/dsh-tavern.mjs" ] || fail '源码不完整（缺 bin/dsh-tavern.mjs）'
  new_ver=$(version_of "$dir/new-source")
  if [ -d "$APP/data" ] && [ ! -e "$dir/new-source/data" ]; then
    cp -a "$APP/data" "$dir/new-source/data"
    say '   已保留 data/'
  fi
  if [ -d "$APP/node_modules" ] && [ ! -e "$dir/new-source/node_modules" ] && same_lock "$dir/new-source"; then
    if mv "$APP/node_modules" "$dir/new-source/node_modules" 2>/dev/null; then
      say '   依赖未变，复用 node_modules'
    fi
  fi
  # 记下旧源码是不是 git 检出：回滚时要按原样还原，否则残留的 .git 会让
  # 应用内更新认为「这是 git 仓库，请自己 git pull」，直接拒绝更新。
  if [ -d "$APP/.git" ]; then printf '1\n' >"$dir/previous-git"; else printf '0\n' >"$dir/previous-git"; fi
  mv "$APP" "$dir/previous-source" || fail "无法移走旧源码：$APP"
  if ! mv "$dir/new-source" "$APP"; then
    mv "$dir/previous-source" "$APP"
    fail '替换源码失败，旧版本已恢复'
  fi
  say '[切换] 安装程序依赖'
  ( cd "$APP" && "$(pnpm_bin)" install --frozen-lockfile \
      --config.minimum-release-age=0 --reporter=append-only ) || fail 'pnpm install 失败'
  say '[切换] 重写 tavern Profile'
  install_profile || fail 'profile 安装失败（新版本可能不兼容当前 DSH）'
  mobile_layout
  if [ -d "$APP/.git" ]; then
    printf '%s\n%s\n' "$BRANCH" "$(git -C "$APP" rev-parse --short HEAD)" >"$APP/.termux-tavern-branch"
  else
    printf '%s\n' "$BRANCH" >"$APP/.termux-tavern-branch"
  fi
  record "$dir"
  say "[切换] 完成：${prev_ver:-未知} → ${new_ver:-未知}"
  say "   旧源码保留在 $dir/previous-source"
}

# 已在目标分支且源码是 git 检出时：只 fetch + 快进，不建备份、不重装依赖。
# 切分支后的日常「更新到分支最新」走这条路。
do_update_in_place() {
  local before after target
  say "[更新] 已在 ${BRANCH}，走增量更新（不新建备份）"
  stop_tavern
  if ! git -C "$APP" fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"; then
    say '   拉取失败，退回整包切换'
    do_switch_full
    return
  fi
  target=$(git -C "$APP" rev-parse "origin/$BRANCH")
  before=$(git -C "$APP" rev-parse HEAD)
  if [ "$target" = "$before" ]; then
    say "   已是最新（$(git -C "$APP" rev-parse --short HEAD)），跳过重装"
    return 0
  fi
  say "   更新 $(git -C "$APP" rev-parse --short HEAD) → $(git -C "$APP" rev-parse --short "origin/$BRANCH")"
  if ! git -C "$APP" reset --hard -q "$target"; then
    say '   无法快进到分支头部，退回整包切换'
    do_switch_full
    return
  fi
  # data/ 与 node_modules 都是未跟踪/忽略项，reset 不会动它们。
  if ! cmp -s "$APP/node_modules/.pnpm/lock.yaml" "$APP/pnpm-lock.yaml" 2>/dev/null; then
    say '   依赖清单有变化，重装依赖'
    ( cd "$APP" && "$(pnpm_bin)" install --frozen-lockfile \
        --config.minimum-release-age=0 --reporter=append-only ) || fail 'pnpm install 失败'
  else
    say '   依赖未变，跳过 pnpm install'
  fi
  install_profile || fail 'profile 安装失败'
  mobile_layout
  after=$(git -C "$APP" rev-parse --short HEAD)
  printf '%s\n%s\n' "$BRANCH" "$after" >"$APP/.termux-tavern-branch"
  say "[更新] 完成，当前 $after"
}

do_switch() {
  local current_branch=""
  [ -f "$APP/.termux-tavern-branch" ] && current_branch=$(sed -n '1p' "$APP/.termux-tavern-branch")
  if [ "$current_branch" = "$BRANCH" ] && [ -d "$APP/.git" ] && [ "${TERMUX_TAVERN_FORCE_FULL:-0}" != 1 ]; then
    do_update_in_place
    return
  fi
  do_switch_full
}

do_revert() {
  local dir cur_ver
  dir=$(cat "$BACKUPS/branch-latest" 2>/dev/null || true)
  if [ ! -d "$dir/previous-source" ]; then
    dir=$(ls -1dt "$BACKUPS"/branch-*/ 2>/dev/null | head -n 1 || true)
    dir="${dir%/}"
  fi
  [ -n "$dir" ] && [ -d "$dir/previous-source" ] \
    || fail "没有可回退的切换记录：$BACKUPS"
  say "[回退] 使用记录 $dir"
  stop_tavern
  rm -rf "$APP.failed" 2>/dev/null || true
  mv "$APP" "$APP.failed" || fail "无法移开当前源码：$APP"
  if ! mv "$dir/previous-source" "$APP"; then
    mv "$APP.failed" "$APP"
    fail '恢复旧源码失败'
  fi
  if [ "$(cat "$dir/previous-git" 2>/dev/null || printf '0')" != 1 ]; then
    rm -rf "$APP/.git" 2>/dev/null || true
    rm -f "$APP/.termux-tavern-branch" 2>/dev/null || true
    say '   已清掉切换留下的 .git 标记，应用内更新恢复可用'
  fi
  say '[回退] 重装依赖与 Profile'
  ( cd "$APP" && "$(pnpm_bin)" install --frozen-lockfile --reporter=append-only ) \
    || say '   依赖安装未完成，继续'
  install_profile || fail 'profile 安装失败'
  mobile_layout
  cur_ver=$(version_of "$APP")
  rm -rf "$APP.failed" 2>/dev/null || true
  rm -rf "$dir" 2>/dev/null || true
  rm -f "$BACKUPS/branch-latest" 2>/dev/null || true
  say "[回退] 完成，当前 ${cur_ver:-未知}"
}

case "$ACTION" in
  switch) do_switch ;;
  revert) do_revert ;;
  *) fail "未知动作：$ACTION" ;;
esac
BRANCH_SCRIPT_EOF
}

do_branch() {
  local branch=${1:-$BRANCH_DEFAULT}
  installed || die "还没安装：先运行 bash $0 install"
  write_branch
  log "切换分支：$branch"
  bash "$BRANCH_SCRIPT" "$branch" switch
  post_install full
  do_start
}

do_branch_revert() {
  installed || die "还没安装：先运行 bash $0 install"
  write_branch
  bash "$BRANCH_SCRIPT" "$BRANCH_DEFAULT" revert
  post_install full
  do_start
}

write_wait() {
  cat > "$WAIT_SCRIPT" <<'WAIT_EOF'
export PATH=$HOME/.dsh-tavern/tools/bin:$HOME/.local/bin:$PATH
LOG=$HOME/.dsh-tavern/logs/tavern.log
PAT='http://127[.]0[.]0[.]1:[0-9]*/?token=[A-Za-z0-9_-]*'
# 日志只追加：先记下启动前的行数，之后只认本次启动新增的行。
# 上一次运行留下的 token 属于已经退出的进程，拿它打开只会得到 401。
BASE=$(wc -l < "$LOG" 2>/dev/null || echo 0)
# 端口探测用 bash 内建 /dev/tcp：连上就算就绪，不阻塞。
port_open() { (exec 3<>/dev/tcp/127.0.0.1/3081) >/dev/null 2>&1; }
# 用 token 换一次 cookie：303 才说明它是当前进程的凭证。
url_ok() {
  local code
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$1" 2>/dev/null || true)
  [ "$code" = 303 ] || [ "$code" = 200 ]
}
new_url() { tail -n +"$((BASE + 1))" "$LOG" 2>/dev/null | grep -o "$PAT" | tail -n 1; }
latest_url() {
  local u
  for u in $(grep -o "$PAT" "$LOG" 2>/dev/null | tail -n 20 | awk '{url[NR]=$0} END {for (i=NR; i>0; i--) print url[i]}'); do
    url_ok "$u" && { printf '%s\n' "$u"; return 0; }
  done
  return 1
}
# 只把真正的启动行打出来（事件 / Web 地址 / 报错），同一行不会重复。
tail -n 0 -F "$LOG" 2>/dev/null | grep --line-buffered -E '"event"|dsh web|error|Error|ERR' >&2 &
TPID=$!
# 服务本来就在跑（端口已通）且日志里还有一条能用的 token：沿用，不再等新行。
if port_open && url=$(latest_url); then
  printf '[  0s] 端口已就绪（服务已在运行）\n' >&2
  kill "$TPID" 2>/dev/null || true
  printf '%s\n' "$url"
  exit 0
fi
i=0
while [ $i -lt 300 ]; do
  # 端口通只说明监听起来了，dsh 打出「dsh web: <token 地址>」可能晚几秒到几十秒。
  # 只看本次启动新增的行，绝不复用历史 token。
  url=$(new_url)
  if [ -n "$url" ] && url_ok "$url"; then
    printf '[%3ss] 端口已就绪\n' "$i" >&2
    kill "$TPID" 2>/dev/null || true
    printf '%s\n' "$url"
    exit 0
  fi
  if [ $((i % 5)) -eq 0 ]; then printf '[%3ss] 等待端口…\n' "$i" >&2; fi
  sleep 1; i=$((i+1))
done
kill "$TPID" 2>/dev/null || true
printf '[%3ss] 300 秒内没拿到本次启动的地址，服务没起来\n' "$i" >&2
printf '日志尾部：\n' >&2
tail -n 30 "$LOG" >&2 || true
exit 1
WAIT_EOF
}

# 只认当前进程的 token：日志是追加的，最后一条未必属于正在跑的实例，
# 用历史 token 打开只会被 401 挡回来（dsh web authentication required）。
# 从新到旧逐条用 curl 换 cookie，303/200 的第一条才是能用的。
latest_url() {
  local u c
  for u in $(grep -o "$URL_PAT" "$LOG" 2>/dev/null | tail -n 20 | tac); do
    c=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$u" 2>/dev/null || true)
    case "$c" in 200|303) printf '%s\n' "$u"; return 0 ;; esac
  done
  return 1
}

# 打开失败要能看出是哪一步失败的：Termux 的 PATH 默认没有 /system/bin，
# termux-open-url 内部就是调 am，缺 am 时它会静默失败。
# 打不开浏览器时至少把地址放进剪贴板（需要 pkg install termux-api + Termux:API 应用）
copy_url() {
  local url=$1
  command -v termux-clipboard-set >/dev/null 2>&1 || return 1
  printf '%s' "$url" | termux-clipboard-set >/dev/null 2>&1
}

open_url() {
  local url=$1 am c
  for c in termux-open-url termux-open; do
    command -v "$c" >/dev/null 2>&1 || continue
    if "$c" "$url" >/dev/null 2>&1; then return 0; fi
    log "   $c 调用失败" >&2
  done
  for am in /system/bin/am am; do
    command -v "$am" >/dev/null 2>&1 || continue
    if "$am" start --user 0 -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1; then return 0; fi
    if "$am" start -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1; then return 0; fi
    log "   $am start 失败" >&2
  done
  return 1
}

open_page() {
  local url=$1
  log "访问地址：$url"
  if open_url "$url"; then
    log '已用系统浏览器打开'
  elif copy_url "$url"; then
    log '自动打开失败（原因见上），地址已复制到剪贴板，粘贴到浏览器打开'
  else
    log '自动打开失败（原因见上），手动复制上面的地址'
  fi
}

wait_url() {
  local url
  bash "$WAIT_SCRIPT" >"$WAIT_OUT" || true
  url=$(tail -n 1 "$WAIT_OUT" 2>/dev/null || true)
  if [ -z "$url" ]; then
    log '启动命令的输出：' >&2
    tail -n 20 "$START_OUT" >&2 2>/dev/null || true
    die "5 分钟没起来。完整日志：bash $0 logs"
  fi
  open_page "$url"
}

# 服务由 dsh-tavern 以独立进程拉起，脚本退出后照常运行；唤醒锁防止熄屏后被系统挂起。
do_start() {
  installed || die "还没安装：先运行 bash $0 install"
  if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
  patch_addons quick
  write_wait
  log '服务启动中：启动日志按行实时打印，就绪即停。'
  nohup node "$APP/bin/dsh-tavern.mjs" start >"$START_OUT" 2>&1 </dev/null &
  wait_url
}

do_stop() {
  if installed; then tavern_cli stop || true; fi
  stop_legacy
  log '已停止。'
}

do_status() {
  log "脚本版本：$VERSION（Termux 原生 Node）"
  log "Node：$(node -v 2>/dev/null || printf '未安装')"
  if installed; then tavern_cli status || true; else log '酒馆：未安装'; fi
  if port_open; then log "端口 $PORT：监听中"; else log "端口 $PORT：无响应"; fi
  if [ -d "$LEGACY_ROOTFS" ]; then log "旧版 proot 容器：$LEGACY_ROOTFS（确认存档已迁移后可 proot-distro remove ubuntu）"; fi
  latest_url || true
}

do_update() {
  installed || die "还没安装：先运行 bash $0 install"
  tavern_cli update
  post_install full
  do_start
}

prepare() {
  if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
  ensure_pkg curl
  ensure_pkg tar
  ensure_pkg git
  ensure_node
  fetch_shims "${1:-0}"
}

# `tavern` 命令走 cli：不做自更新检查，避免每条命令都联网。
[ "${1:-}" = cli ] || self_update "$@"
tavern_env

case "${1:-install}" in
  install) prepare 1; do_install; do_start ;;
  reinstall|force-install)
    FORCE_INSTALL=1
    prepare 1
    do_install
    do_start
    ;;
  start)
    prepare
    installed || do_install
    do_start
    ;;
  stop)    do_stop ;;
  restart) do_stop; prepare; do_start ;;
  status)  do_status ;;
  open)
    url=$(latest_url || true)
    [ -n "${url:-}" ] || die "没拿到地址：先 bash $0 start"
    open_page "$url"
    ;;
  update)  prepare 1; do_update ;;
  branch|switch) prepare; do_branch "${2:-}" ;;
  branch-revert|revert) prepare; do_branch_revert ;;
  logs)    tail -n 80 "$LOG" ;;
  cli)
    shift
    installed || die "还没安装：先运行 bash $0 install"
    exec node "$APP/bin/dsh-tavern.mjs" "$@"
    ;;
  *)       log "用法：bash $0 [install|reinstall|start|stop|restart|status|open|update|logs|branch [分支]|branch-revert]" >&2; exit 2 ;;
esac
