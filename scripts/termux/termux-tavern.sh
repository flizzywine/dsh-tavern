#!/data/data/com.termux/files/usr/bin/bash
# DSH Tavern × Termux 单文件：装 + 移动版布局 + 启动 + 自动打开酒馆页面。
#   bash termux-tavern.sh [install|start|stop|restart|status|open|update|logs]
#   bash termux-tavern.sh branch [分支名]    # 把已装的 main 源码切到测试分支（默认 backup/main-20261106）
#   bash termux-tavern.sh branch-revert      # 回到上一次切换前的版本
# 三条硬约束（脚本已按它们处理）：服务必须活在常驻 proot 里（proot 退出=进程失去
# rootfs）；容器脚本走 --shared-tmp 传入、不支持时退回 stdin；探活只认端口和日志 token。
set -euo pipefail

VERSION=2026-11-07.1
DISTRO=ubuntu
NODE_VERSION=24.20.0
PORT=3081
INNER='export PATH=/usr/local/node/bin:$HOME/.local/bin:$PATH'
PIDFILE=$PREFIX/var/run/tavern-proot.pid
INNER_SCRIPT=$PREFIX/tmp/tavern-inner.sh
WAIT_SCRIPT=$PREFIX/tmp/tavern-wait.sh
WAIT_OUT=$PREFIX/tmp/tavern-wait.out
BRANCH_SCRIPT=$PREFIX/tmp/tavern-branch.sh
BRANCH_DEFAULT=${TERMUX_TAVERN_BRANCH:-backup/main-20261106}

mkdir -p "$(dirname -- "$PIDFILE")" "$(dirname -- "$INNER_SCRIPT")"
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
  tmp=$PREFIX/tmp/termux-tavern.new
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

ensure_pkg() {
  command -v "$1" >/dev/null 2>&1 && return 0
  apt install -y "$1" 2>/dev/null && return 0
  local f
  for f in "$PREFIX"/etc/apt/sources.list.d/*; do
    [ -f "$f" ] || continue
    grep -qs 'tur\.kcubeterm\.com' "$f" && mv "$f" "$f.disabled"
  done
  pkg update -y >/dev/null 2>&1 || true
  apt install -y "$1"
}

container_ready() { proot-distro login "$DISTRO" -- true >/dev/null 2>&1; }
daemon_alive() { [ -r "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

write_inner() {
  cat > "$INNER_SCRIPT" <<'INNER_EOF'
set -e
V=24.20.0
export DEBIAN_FRONTEND=noninteractive
grab() {
  local out=$1; shift
  local u
  for u in "$@"; do
    curl -fsSL --connect-timeout 15 --max-time 900 "$u" -o "$out" && return 0
    echo "   下载失败：$u"
  done
  return 1
}
if ! command -v curl >/dev/null || ! command -v tar >/dev/null || ! command -v git >/dev/null; then
  echo '[容器] 安装基础包'
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl tar xz-utils git procps
fi
if [ ! -x /usr/local/node/bin/node ]; then
  echo "[容器] 安装 Node $V"
  d=$(mktemp -d)
  grab "$d/n.txz" \
    "https://nodejs.org/dist/v$V/node-v$V-linux-arm64.tar.xz" \
    "https://npmmirror.com/mirrors/node/v$V/node-v$V-linux-arm64.tar.xz" \
    "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v$V/node-v$V-linux-arm64.tar.xz" \
    || { echo 'Node 下载失败（网络）' >&2; exit 1; }
  tar -tJf "$d/n.txz" >/dev/null 2>&1 || { echo 'Node 包不完整' >&2; exit 1; }
  mkdir -p /usr/local/node
  tar -xJf "$d/n.txz" -C /usr/local/node --strip-components=1
  rm -rf "$d"
fi
export PATH=/usr/local/node/bin:$HOME/.local/bin:$PATH
echo "[容器] Node $(node -v)"
if [ ! -f "$HOME/.dsh-tavern/apps/dsh-tavern/bin/dsh-tavern.mjs" ]; then
  echo '[容器] 安装酒馆（首次 10–30 分钟）'
  grab /tmp/ti.sh \
    "https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/install.sh" \
    "https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh" \
    || { echo '酒馆安装脚本下载失败（网络）' >&2; exit 1; }
  DSH_TAVERN_HOST=cli sh /tmp/ti.sh
else
  echo '[容器] 酒馆已安装，跳过'
fi
# 移动版布局：CLI 的 host 是 cli，安装器会主动剔除 dsh-web-mobile，
# 手机上必须显式加回来（幂等；APK 用的就是这一版 + 这个补丁）。
P="$HOME/.dsh-tavern/profiles/tavern"
if [ -f "$P/package.json" ]; then
  if grep -q '"dsh-web-mobile"' "$P/package.json"; then
    echo '[容器] 移动版布局已启用'
  else
    echo '[容器] 启用移动版布局 dsh-web-mobile'
    dsh-tavern stop >/dev/null 2>&1 || true
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
      [ -f patches/dsh-web-mobile@3.1.0.patch ] || cp "$HOME/.dsh-tavern/apps/dsh-tavern/patches/dsh-web-mobile@3.1.0.patch" patches/ 2>/dev/null || true
      grep -q "dsh-web-mobile@3.1.0" pnpm-workspace.yaml \
        || sed -i '/^patchedDependencies:/a\  dsh-web-mobile@3.1.0: patches/dsh-web-mobile@3.1.0.patch' pnpm-workspace.yaml
      PNPM=$HOME/.dsh-tavern/tools/bin/pnpm
      [ -x "$PNPM" ] || PNPM=$(command -v pnpm)
      "$PNPM" install --reporter=append-only
    )
  fi
fi

cat > /usr/local/bin/tavern <<'W'
#!/bin/bash
set -euo pipefail
export PATH=/usr/local/node/bin:$HOME/.local/bin:$PATH
exec dsh-tavern "$@"
W
chmod +x /usr/local/bin/tavern
echo '[容器] 就绪'
INNER_EOF
}

# 分支切换：在容器里停服务 → 备份现有源码 → 换成目标分支 → 重装依赖与 Profile →
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
export PATH="$ROOT/tools/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

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
  dsh-tavern stop >/dev/null 2>&1 || true
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
  curl -fsSL --connect-timeout 15 --max-time 900 -o /tmp/tavern-branch.tar.gz "$TARBALL_BASE/$BRANCH" \
    || return 1
  tar -xzf /tmp/tavern-branch.tar.gz -C "$dest" --strip-components=1 \
    --exclude='*/docs' --exclude='*/docs/*' || return 1
  rm -f /tmp/tavern-branch.tar.gz
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
    grep -q "dsh-web-mobile@3.1.0" pnpm-workspace.yaml \
      || sed -i '/^patchedDependencies:/a\  dsh-web-mobile@3.1.0: patches/dsh-web-mobile@3.1.0.patch' pnpm-workspace.yaml
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
  say "[更新] 已在 $BRANCH，走增量更新（不新建备份）"
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

run_branch() {
  if ! proot-distro login "$DISTRO" --shared-tmp -- bash "$BRANCH_SCRIPT" "$@"; then
    log '带 --shared-tmp 执行失败，改用标准输入重试…'
    proot-distro login "$DISTRO" -- bash -s -- "$@" < "$BRANCH_SCRIPT"
  fi
}

do_branch() {
  local branch=${1:-$BRANCH_DEFAULT}
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
  ensure_ready
  write_branch
  log "切换分支：$branch"
  run_branch "$branch" switch
  do_start
}

do_branch_revert() {
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
  ensure_ready
  write_branch
  run_branch "$BRANCH_DEFAULT" revert
  do_start
}

write_wait() {
  cat > "$WAIT_SCRIPT" <<'WAIT_EOF'
export PATH=/usr/local/node/bin:$HOME/.local/bin:$PATH
LOG=$HOME/.dsh-tavern/logs/tavern.log
# 端口探测用 bash 内建 /dev/tcp：连上就算就绪，不阻塞。
port_open() { (exec 3<>/dev/tcp/127.0.0.1/3081) >/dev/null 2>&1; }
# 只把真正的启动行打出来（事件 / Web 地址 / 报错），同一行不会重复。
tail -n 0 -F "$LOG" 2>/dev/null | grep --line-buffered -E '"event"|dsh web|error|Error|ERR' >&2 &
TPID=$!
i=0
while [ $i -lt 300 ]; do
  if port_open; then break; fi
  if [ $((i % 5)) -eq 0 ]; then printf '[%3ss] 等待端口…\n' "$i" >&2; fi
  sleep 1; i=$((i+1))
done
kill "$TPID" 2>/dev/null || true
if [ $i -lt 300 ]; then
  printf '[%3ss] 端口已就绪\n' "$i" >&2
  grep -o 'http://127[.]0[.]0[.]1:[0-9]*/?token=[A-Za-z0-9_-]*' "$LOG" 2>/dev/null | tail -n 1
else
  printf '[%3ss] 300 秒内没有监听端口，服务没起来\n' "$i" >&2
fi
WAIT_EOF
}

run_inner() {
  if ! proot-distro login "$DISTRO" --shared-tmp -- bash /tmp/tavern-inner.sh; then
    log '带 --shared-tmp 执行失败，改用标准输入重试…'
    proot-distro login "$DISTRO" -- bash -s < "$INNER_SCRIPT"
  fi
}

ensure_ready() {
  ensure_pkg proot-distro
  command -v tar >/dev/null 2>&1 || ensure_pkg tar
  if container_ready; then log '[容器] 已存在'; else log '[容器] 安装 Ubuntu…'; proot-distro install "$DISTRO"; fi
  write_inner
  write_wait
  run_inner
}

latest_url() {
  proot-distro login "$DISTRO" -- bash -lc "$INNER; grep -o 'http://127[.]0[.]0[.]1:[0-9]*/?token=[A-Za-z0-9_-]*' \"\$HOME/.dsh-tavern/logs/tavern.log\" 2>/dev/null | tail -n 1" 2>/dev/null || true
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

wait_url() {
  local url
  # stdout 收进文件，stderr 原样透出：等待期间的心跳就靠它
  if proot-distro login "$DISTRO" --shared-tmp -- bash /tmp/tavern-wait.sh >"$WAIT_OUT"; then :; else
    proot-distro login "$DISTRO" -- bash -s < "$WAIT_SCRIPT" >"$WAIT_OUT" || true
  fi
  url=$(tail -n 1 "$WAIT_OUT" 2>/dev/null || true)
  [ -n "${url:-}" ] || die "5 分钟没起来。日志尾部：$(proot-distro login "$DISTRO" -- bash -lc "$INNER; tail -n 60 \"\$HOME/.dsh-tavern/logs/tavern.log\"" 2>/dev/null || true)"
  log "访问地址：$url"
  if open_url "$url"; then
    log '已用系统浏览器打开'
  elif copy_url "$url"; then
    log '自动打开失败（原因见上），地址已复制到剪贴板，粘贴到浏览器打开'
  else
    log '自动打开失败（原因见上），手动复制上面的地址'
  fi
}

do_start() {
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
  if daemon_alive; then
    log "容器守护已在运行：PID $(cat "$PIDFILE")"
  else
    nohup proot-distro login "$DISTRO" -- bash -lc "
      $INNER
      dsh-tavern start || true
      exec sleep infinity
    " >/dev/null 2>&1 &
    echo $! > "$PIDFILE"
    log "容器守护已后台启动：PID $!（它常驻，服务才活得下去）"
    log '服务启动中：启动日志按行实时打印，就绪即停。'
  fi
  wait_url
}

do_stop() {
  proot-distro login "$DISTRO" -- bash -lc "$INNER; dsh-tavern stop" >/dev/null 2>&1 || true
  daemon_alive && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
  log '已停止。'
}

do_status() {
  log "脚本版本：$VERSION"
  if daemon_alive; then log "容器守护：PID $(cat "$PIDFILE")"; else log '容器守护：未运行'; fi
  proot-distro login "$DISTRO" -- bash -lc "$INNER; curl -sS -m 5 -o /dev/null -w '端口 %{http_code}\n' http://127.0.0.1:$PORT/" 2>/dev/null || log '端口：无响应'
  latest_url
}

self_update "$@"

case "${1:-install}" in
  install) ensure_ready; do_start ;;
  start)   ensure_ready; do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  open)
    url=$(latest_url)
    [ -n "${url:-}" ] || die '没拿到地址：先 bash termux-tavern.sh start'
    log "访问地址：$url"
    if open_url "$url"; then
      log '已用系统浏览器打开'
    elif copy_url "$url"; then
      log '自动打开失败（原因见上），地址已复制到剪贴板'
    else
      log '自动打开失败（原因见上）'
    fi
    ;;
  update)  proot-distro login "$DISTRO" -- bash -lc "$INNER; dsh-tavern update" ;;
  branch|switch) do_branch "${2:-}" ;;
  branch-revert|revert) do_branch_revert ;;
  logs)    proot-distro login "$DISTRO" -- bash -lc "$INNER; tail -n 80 \"\$HOME/.dsh-tavern/logs/tavern.log\"" ;;
  *)       log "用法：bash $0 [install|start|stop|restart|status|open|update|logs|branch [分支]|branch-revert]" >&2; exit 2 ;;
esac
