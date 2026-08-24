#!/usr/bin/env bash
set -euo pipefail

DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
APP_DIR="${DSH_TAVERN_SOURCE_ROOT:-${DSH_TAVERN_ANDROID_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}}"
DEFAULT_REPOSITORY="https://github.com/flizzywine/dsh-tavern.git"
REPOSITORY="${DSH_TAVERN_REPOSITORY:-${DEFAULT_REPOSITORY}}"
DEFAULT_TARBALL_URL="https://codeload.github.com/flizzywine/dsh-tavern/tar.gz/refs/heads/main"
TARBALL_URL="${DSH_TAVERN_TARBALL_URL:-${DEFAULT_TARBALL_URL}}"
SOURCE_MARKER=".dsh-tavern-tarball-source"
TEMP_ROOT=""
SOURCE_BACKUP=""
SOURCE_SWAPPED=0

fail() {
  printf 'DSH Tavern 安装失败：%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1，请先完成 DSHA 的基础安装。"
}

cleanup() {
  if [ -n "${TEMP_ROOT}" ] && [ -d "${TEMP_ROOT}" ]; then
    rm -r -- "${TEMP_ROOT}"
  fi
}
trap cleanup EXIT

prepare_temp_root() {
  if [ -z "${TEMP_ROOT}" ]; then
    mkdir -p "$(dirname -- "${APP_DIR}")"
    TEMP_ROOT="$(mktemp -d "$(dirname -- "${APP_DIR}")/.dsh-tavern-download.XXXXXX")"
  fi
}

verify_source() {
  local source="$1"
  [ -f "${source}/package.json" ] || fail "下载内容不完整，缺少 package.json。"
  [ -f "${source}/bin/dsh-tavern.mjs" ] || fail "下载内容不完整，缺少 bin/dsh-tavern.mjs。"
  [ -f "${source}/android/install.sh" ] || fail "下载内容不完整，缺少 android/install.sh。"
}

replace_source() {
  local candidate="$1"
  verify_source "${candidate}"
  if [ -d "${APP_DIR}/data" ] && [ ! -e "${candidate}/data" ]; then
    cp -a "${APP_DIR}/data" "${candidate}/data"
  fi
  if [ -e "${APP_DIR}" ]; then
    SOURCE_BACKUP="${TEMP_ROOT}/previous-source"
    mv -- "${APP_DIR}" "${SOURCE_BACKUP}"
  fi
  if ! mv -- "${candidate}" "${APP_DIR}"; then
    if [ -n "${SOURCE_BACKUP}" ] && [ -d "${SOURCE_BACKUP}" ]; then mv -- "${SOURCE_BACKUP}" "${APP_DIR}"; fi
    fail "无法替换源码目录，旧版本已恢复。"
  fi
  SOURCE_SWAPPED=1
}

rollback_source() {
  [ "${SOURCE_SWAPPED}" -eq 1 ] || return 0
  if [ -e "${APP_DIR}" ]; then mv -- "${APP_DIR}" "${TEMP_ROOT}/failed-source"; fi
  if [ -n "${SOURCE_BACKUP}" ] && [ -d "${SOURCE_BACKUP}" ]; then mv -- "${SOURCE_BACKUP}" "${APP_DIR}"; fi
  SOURCE_SWAPPED=0
}

install_from_tarball() {
  require_command curl
  require_command tar
  prepare_temp_root
  local archive="${TEMP_ROOT}/dsh-tavern.tar.gz"
  local candidate="${TEMP_ROOT}/tarball-source"
  printf 'Git 下载失败，正在改用 GitHub 压缩包……\n'
  curl -fL --retry 2 --connect-timeout 20 -o "${archive}" "${TARBALL_URL}" || fail "Git 与压缩包下载均失败，请检查网络后重试。"
  mkdir -p "${candidate}"
  tar -xzf "${archive}" -C "${candidate}" --strip-components=1 || fail "压缩包无法解压，旧版本未被修改。"
  verify_source "${candidate}"
  printf '%s\n' "${TARBALL_URL}" > "${candidate}/${SOURCE_MARKER}"
  replace_source "${candidate}"
}

install_source() {
  prepare_temp_root
  if command -v git >/dev/null 2>&1; then
    local candidate="${TEMP_ROOT}/git-source"
    printf '正在通过 Git 下载 DSH Tavern……\n'
    if git clone --branch main --single-branch "${REPOSITORY}" "${candidate}"; then
      replace_source "${candidate}"
      return
    fi
  else
    printf '未检测到 Git，直接使用 GitHub 压缩包。\n'
  fi
  install_from_tarball
}

update_source() {
  if [ -d "${APP_DIR}/.git" ]; then
    require_command git
    if ! git -C "${APP_DIR}" diff --quiet || ! git -C "${APP_DIR}" diff --cached --quiet; then
      fail "项目目录存在未提交修改。为避免覆盖你的文件，已停止更新。"
    fi
    printf '正在检查 DSH Tavern 更新……\n'
    if git -C "${APP_DIR}" fetch origin main; then
      if ! git -C "${APP_DIR}" merge-base --is-ancestor HEAD origin/main; then
        fail "项目目录包含本地提交或已经分叉，无法自动安全更新。"
      fi
      git -C "${APP_DIR}" merge --ff-only origin/main
      return
    fi
    install_from_tarball
    return
  fi
  if [ -f "${APP_DIR}/${SOURCE_MARKER}" ]; then
    if [ -z "${DSH_TAVERN_TARBALL_URL:-}" ]; then
      TARBALL_URL="$(sed -n '1p' "${APP_DIR}/${SOURCE_MARKER}")"
      [ -n "${TARBALL_URL}" ] || TARBALL_URL="${DEFAULT_TARBALL_URL}"
    fi
    install_from_tarball
    return
  fi
  fail "${APP_DIR} 已存在但不是受支持的 Git 或压缩包安装，请备份并移走该目录后重试。"
}

require_command bash
require_command node

if [ ! -e "${APP_DIR}" ]; then
  install_source
else
  update_source
fi

verify_source "${APP_DIR}"

if [ -f "${DSH_ROOT}/profiles/tavern/package.json" ]; then
  printf '正在停止旧版酒馆服务……\n'
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT=3088 \
    node "${APP_DIR}/bin/dsh-tavern.mjs" stop
fi

if ! DSH_HOME="${DSH_ROOT}" bash "${APP_DIR}/android/install.sh"; then
  rollback_source
  fail "依赖或 Profile 安装失败，源码已恢复到更新前版本。"
fi

SOURCE_SWAPPED=0
printf '\n全部完成。请重启 DSHA，然后点击侧栏里的“酒馆工作台”。\n'
