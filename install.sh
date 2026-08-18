#!/bin/sh

set -eu

REPOSITORY=${DSH_TAVERN_REPOSITORY:-flizzywine/dsh-tavern}
ARCHIVE_URL=${DSH_TAVERN_ARCHIVE_URL:-https://github.com/${REPOSITORY}/archive/refs/heads/main.tar.gz}
DSH_ROOT=${DSH_HOME:-${HOME}/.dsh}
APP_DIR=${DSH_TAVERN_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}
RUNTIME_ROOT=${DSH_ROOT}/runtime
RUNTIME_BIN=${RUNTIME_ROOT}/bin
COMMAND_BIN=${HOME}/.local/bin
TMP_BASE=${TMPDIR:-/tmp}
TMP_BASE=${TMP_BASE%/}
TEMP_DIR=$(mktemp -d "${TMP_BASE}/dsh-tavern-install.XXXXXX")

cleanup() {
  case "${TEMP_DIR}" in
    "${TMP_BASE}"/dsh-tavern-install.*) rm -rf -- "${TEMP_DIR}" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "安装失败：$1" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js 22.19 或更高版本：https://nodejs.org/" >&2
  if command -v open >/dev/null 2>&1; then open https://nodejs.org/ >/dev/null 2>&1 || true; fi
  fail "未找到 Node.js。安装后重新运行本命令。"
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' >/dev/null 2>&1; then
  fail "Node.js 版本过低，需要 22.19 或更高版本（当前：$(node --version)）。"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "未找到 npm，请重新安装 Node.js。"
fi

set --
if ! command -v pnpm >/dev/null 2>&1; then set -- "$@" pnpm; fi
if ! command -v dsh >/dev/null 2>&1; then set -- "$@" @deepseek-ai/dsh; fi
if [ "$#" -gt 0 ]; then
  echo "正在补齐：$*……"
  mkdir -p "${RUNTIME_ROOT}"
  npm install --global --prefix "${RUNTIME_ROOT}" "$@"
  PATH=${RUNTIME_BIN}:${PATH}
  export PATH
fi

command -v pnpm >/dev/null 2>&1 || fail "安装后仍未找到 pnpm。"
command -v dsh >/dev/null 2>&1 || fail "安装后仍未找到 DSH。"

DSH_TAVERN_BIN_DIR=${COMMAND_BIN}
export DSH_TAVERN_BIN_DIR

command -v curl >/dev/null 2>&1 || fail "未找到 curl。"
command -v tar >/dev/null 2>&1 || fail "未找到 tar。"

echo "正在下载 DSH Tavern……"
curl -fL --retry 3 --connect-timeout 15 "${ARCHIVE_URL}" -o "${TEMP_DIR}/app.tar.gz"
mkdir -p "${TEMP_DIR}/extract"
tar -xzf "${TEMP_DIR}/app.tar.gz" -C "${TEMP_DIR}/extract"
SOURCE_DIR=$(find "${TEMP_DIR}/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[ -n "${SOURCE_DIR}" ] && [ -f "${SOURCE_DIR}/package.json" ] || fail "下载内容不完整。"

if [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
  DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
fi

mkdir -p "${APP_DIR}"
# 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data/ 用户数据会保留。
cp -R "${SOURCE_DIR}/." "${APP_DIR}/"

echo "正在配置 Tavern……"
DSH_HOME=${DSH_ROOT} pnpm --dir "${APP_DIR}" run install:tavern
DSH_HOME=${DSH_ROOT} pnpm --dir "${APP_DIR}" run start:tavern

case ${SHELL:-} in
  */zsh) SHELL_PROFILE=${HOME}/.zprofile ;;
  *) SHELL_PROFILE=${HOME}/.profile ;;
esac
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
if [ ! -f "${SHELL_PROFILE}" ] || ! grep -F "${PATH_LINE}" "${SHELL_PROFILE}" >/dev/null 2>&1; then
  printf '\n# DSH Tavern\n%s\n' "${PATH_LINE}" >>"${SHELL_PROFILE}"
fi

echo "DSH Tavern 安装完成：http://127.0.0.1:3081"
echo "以后可以使用：dsh-tavern {start|stop|restart|status|update}（新终端生效）"
if [ "${DSH_TAVERN_NO_OPEN:-0}" != "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open http://127.0.0.1:3081 >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://127.0.0.1:3081 >/dev/null 2>&1 || true
  fi
fi
