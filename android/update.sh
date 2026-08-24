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
[ -d "${REPO_ROOT}/.git" ] || fail "当前 Android 安装不是 Git 克隆仓库，请重新克隆 dsh-tavern 后运行 bash android/install.sh。"
command -v git >/dev/null 2>&1 || fail "缺少 git，无法安全更新原克隆仓库。"

if ! git -C "${REPO_ROOT}" diff --quiet || ! git -C "${REPO_ROOT}" diff --cached --quiet; then
  fail "仓库存在未提交修改。请先提交或移走修改，再重试更新。"
fi

printf '正在检查 Android 版更新……\n'
git -C "${REPO_ROOT}" fetch origin main
if ! git -C "${REPO_ROOT}" merge-base --is-ancestor HEAD origin/main; then
  fail "当前分支包含本地提交或已经分叉，无法自动快进到 origin/main。"
fi
git -C "${REPO_ROOT}" merge --ff-only origin/main

printf '正在重启 Android Tavern……\n'
DSH_HOME="${DSH_ROOT}" node "${REPO_ROOT}/bin/dsh-tavern.mjs" stop
DSH_HOME="${DSH_ROOT}" bash "${REPO_ROOT}/android/install.sh"
