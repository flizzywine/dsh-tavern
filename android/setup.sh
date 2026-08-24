#!/usr/bin/env bash
set -euo pipefail

DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
APP_DIR="${DSH_TAVERN_SOURCE_ROOT:-${DSH_TAVERN_ANDROID_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}}"
REPOSITORY="${DSH_TAVERN_REPOSITORY:-https://github.com/flizzywine/dsh-tavern.git}"

fail() {
  printf 'DSH Tavern 安装失败：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1，请先完成 DSHA 的基础安装。"
}

require_command git
require_command bash

if [ ! -e "${APP_DIR}" ]; then
  printf '正在下载 DSH Tavern……\n'
  mkdir -p "$(dirname -- "${APP_DIR}")"
  git clone --branch main --single-branch "${REPOSITORY}" "${APP_DIR}"
else
  [ -d "${APP_DIR}/.git" ] || fail "${APP_DIR} 已存在但不是 Git 仓库，请移走该目录后重试。"
  if ! git -C "${APP_DIR}" diff --quiet || ! git -C "${APP_DIR}" diff --cached --quiet; then
    fail "项目目录存在未提交修改。为避免覆盖你的文件，已停止更新。"
  fi
  printf '正在检查 DSH Tavern 更新……\n'
  git -C "${APP_DIR}" fetch origin main
  if ! git -C "${APP_DIR}" merge-base --is-ancestor HEAD origin/main; then
    fail "项目目录包含本地提交或已经分叉，无法自动安全更新。"
  fi
  git -C "${APP_DIR}" merge --ff-only origin/main
fi

[ -f "${APP_DIR}/android/install.sh" ] || fail "下载内容不完整，缺少 android/install.sh。"

if [ -f "${DSH_ROOT}/profiles/tavern/package.json" ] && [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
  printf '正在停止旧版酒馆服务……\n'
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT=3088 \
    node "${APP_DIR}/bin/dsh-tavern.mjs" stop
fi

DSH_HOME="${DSH_ROOT}" bash "${APP_DIR}/android/install.sh"

printf '\n全部完成。请重启 DSHA，然后点击侧栏里的“酒馆工作台”。\n'
