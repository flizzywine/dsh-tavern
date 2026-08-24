#!/usr/bin/env bash
set -euo pipefail

DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
REPO_ROOT="${DSH_TAVERN_SOURCE_ROOT:-}"

fail() {
  printf '更新失败：%s\n' "$1" >&2
  exit 1
}

[ -n "${REPO_ROOT}" ] || fail "缺少 DSH_TAVERN_SOURCE_ROOT。"
REPO_ROOT="$(CDPATH= cd -- "${REPO_ROOT}" && pwd)"
[ -f "${REPO_ROOT}/android/setup.sh" ] || fail "当前安装缺少 android/setup.sh。"

DSH_HOME="${DSH_ROOT}" DSH_TAVERN_ANDROID_APP_DIR="${REPO_ROOT}" \
  bash "${REPO_ROOT}/android/setup.sh"
