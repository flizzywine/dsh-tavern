#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
TAVERN_PROFILE_DIR="${DSH_ROOT}/profiles/tavern"
TAVERN_PORT=3088

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1。请先在 DSHA 中安装对应依赖。"
}

find_web_profile() {
  if [ -n "${DSH_ANDROID_WEB_PROFILE:-}" ]; then
    printf '%s\n' "${DSH_ANDROID_WEB_PROFILE}"
  elif [ -f "${DSH_ROOT}/profiles/web/package.json" ]; then
    printf '%s\n' web
  elif [ -f "${DSH_ROOT}/profiles/user/package.json" ]; then
    printf '%s\n' user
  else
    fail "找不到 DSHA 的 web 或 user Profile。请先启动一次 DSHA，或设置 DSH_ANDROID_WEB_PROFILE。"
  fi
}

probe_port() {
  node - "$1" <<'NODE'
const net = require('node:net')
const port = Number(process.argv[2])
const socket = net.createConnection({ host: '127.0.0.1', port })
const done = (ok) => {
  socket.destroy()
  process.exit(ok ? 0 : 1)
}
socket.setTimeout(1500)
socket.once('connect', () => done(true))
socket.once('timeout', () => done(false))
socket.once('error', () => done(false))
NODE
}

require_command node
require_command dsh
if ! command -v pnpm >/dev/null 2>&1; then
  require_command npm
  printf '\n未检测到 pnpm，正在安装……\n'
  npm install --global pnpm
fi
[ -f "${REPO_ROOT}/package.json" ] || fail "脚本必须位于完整的 dsh-tavern 仓库中。"
[ -f "${SCRIPT_DIR}/dsh-tavern-entry/package.json" ] || fail "缺少 dsh-tavern-entry。"
[ -f "${SCRIPT_DIR}/dsh-client-ui-mobile-adapt/package.json" ] || fail "缺少 dsh-client-ui-mobile-adapt。"

WEB_PROFILE_NAME="$(find_web_profile)"
WEB_PROFILE_DIR="${DSH_ROOT}/profiles/${WEB_PROFILE_NAME}"

printf '\n正在安装 dsh-tavern 核心依赖……\n'
pnpm --dir "${REPO_ROOT}" install --frozen-lockfile
DSH_HOME="${DSH_ROOT}" node "${REPO_ROOT}/bin/dsh-tavern.mjs" install --host android

printf '\n正在把安卓插件加入 tavern 与 %s Profile……\n' "${WEB_PROFILE_NAME}"
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"

pnpm --dir "${TAVERN_PROFILE_DIR}" install
pnpm --dir "${WEB_PROFILE_DIR}" install
dsh --profile tavern --dump-config >/dev/null
dsh --profile "${WEB_PROFILE_NAME}" --dump-config >/dev/null

printf '\n正在启动 3088 酒馆服务……\n'
DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
  DSH_TAVERN_RUNTIME_HOST="android" \
  node "${REPO_ROOT}/bin/dsh-tavern.mjs" start

probe_port "${TAVERN_PORT}" || fail "3088 端口未能启动，请查看 ${DSH_ROOT}/logs/tavern.log。"

printf '\n安装完成。\n'
printf '酒馆地址：http://127.0.0.1:%s\n' "${TAVERN_PORT}"
if probe_port 3080; then
  printf 'DSHA Web：http://127.0.0.1:3080（当前可访问）\n'
else
  printf '提示：3080 当前未监听；重启 DSHA 后再检查。\n'
fi
printf '请重启一次 DSHA，使自动拉起和手机适配插件正式加载。\n'
