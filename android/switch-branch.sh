#!/usr/bin/env bash
# dsh-tavern 测试分支切换脚本（Termux / Android）
#
# 作用：把当前已安装的 main 版本（默认 $HOME/.dsh/apps/dsh-tavern）
#       整体切到指定分支（默认 backup/main-20261106），随后重跑
#       android/install.sh 重写 tavern Profile 配置并重启 3088 酒馆服务。
#
# 用法：
#   bash switch-branch.sh            # 执行切换（默认切到 backup/main-20261106）
#   bash switch-branch.sh --dry-run  # 只打印计划与版本号，不动任何文件
#   bash switch-branch.sh --revert   # 回到切换前记录的那个版本
#   bash switch-branch.sh --locate   # 扫描本机，打印候选安装目录
#   bash switch-branch.sh --list     # 列出所有切换记录
#   bash switch-branch.sh --restore <记录目录>  # 按指定记录回滚
#
# 可覆盖的环境变量：
#   DSH_HOME                       默认 $HOME/.dsh
#   DSH_TAVERN_SOURCE_ROOT         已安装源码目录；未设置时用 $DSH_HOME/apps/dsh-tavern
#   DSH_TAVERN_REPOSITORY          默认 https://github.com/flizzywine/dsh-tavern.git
#   DSH_TAVERN_TARGET_BRANCH       默认 backup/main-20261106
#   DSH_TAVERN_TARBALL_URL         覆盖压缩包地址（默认按目标分支拼 codeload 地址）
#   DSH_TAVERN_PORT                默认 3088
#   DSH_TAVERN_SWITCH_STATE_DIR    备份/记录目录，默认 $DSH_HOME/backups/branch-switch
#   DSH_TAVERN_SWITCH_NO_INSTALL=1 只换源码、不跑安装器（自测用）
#
# 数据说明：会话与存档在 $DSH_HOME/profile-data/tavern/data，不在源码目录里，
# 换源码不会动它；旧目录里的 data/ 也会随源码一起整份备份，便于回滚。
set -euo pipefail

DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
APP_DIR="${DSH_TAVERN_SOURCE_ROOT:-${DSH_TAVERN_ANDROID_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}}"
REPOSITORY="${DSH_TAVERN_REPOSITORY:-https://github.com/flizzywine/dsh-tavern.git}"
TARGET_BRANCH="${DSH_TAVERN_TARGET_BRANCH:-backup/main-20261106}"
TARBALL_URL="${DSH_TAVERN_TARBALL_URL:-https://codeload.github.com/flizzywine/dsh-tavern/tar.gz/refs/heads/${TARGET_BRANCH}}"
TAVERN_PORT="${DSH_TAVERN_PORT:-3088}"
STATE_ROOT="${DSH_TAVERN_SWITCH_STATE_DIR:-${DSH_ROOT}/backups/branch-switch}"
MARKER=".dsh-tavern-branch"
SKIP_INSTALL="${DSH_TAVERN_SWITCH_NO_INSTALL:-0}"

MODE=switch
DRY_RUN=0
START_TIME=$(date +%s)
STEP=0
TEMP_ROOT=""
CANDIDATE=""
CANDIDATE_KIND=""
CANDIDATE_REV=""
STATE_DIR=""
SOURCE_BACKUP=""
SWAPPED=0
CARRIED=0
STASHED=0
PREVIOUS_KIND=""
PREVIOUS_BRANCH=""
PREVIOUS_COMMIT=""
PREVIOUS_VERSION=""
TARGET_VERSION=""

usage() {
  cat <<'TEXT'
用法：bash switch-branch.sh [--dry-run | --revert | --restore <记录目录>]

  （无参数）  把已安装的 main 版本切到 backup/main-20261106
  --dry-run   只打印当前版本、目标版本与执行计划，不修改任何文件
  --revert    回退到上一次切换前的版本（安装回旧代码并重启服务）
  --locate    扫描本机，打印找到的候选安装目录（不改任何文件）
  --list      列出所有切换记录（记录目录保留，可重复 --restore）
  --restore <记录目录>  按某条记录回滚

环境变量：DSH_HOME / DSH_TAVERN_SOURCE_ROOT / DSH_TAVERN_TARGET_BRANCH / DSH_TAVERN_PORT，见脚本头部说明。
TEXT
}

fail() {
  printf '切换失败：%s\n' "$1" >&2
  exit 1
}

step() {
  STEP=$((STEP + 1))
  printf '\n== [步骤 %s] %s（已用 %ss）==\n' "${STEP}" "$*" "$(( $(date +%s) - START_TIME ))"
}

info() { printf '   %s\n' "$*"; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1，请先在 Termux 里装好（pkg install $1）。"
}

cleanup() {
  if [ -n "${TEMP_ROOT}" ] && [ -d "${TEMP_ROOT}" ]; then
    rm -rf -- "${TEMP_ROOT}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

verify_source() {
  local source="$1"
  [ -f "${source}/package.json" ] || fail "源码不完整，缺少 package.json：${source}"
  [ -f "${source}/bin/dsh-tavern.mjs" ] || fail "源码不完整，缺少 bin/dsh-tavern.mjs：${source}"
  [ -f "${source}/android/install.sh" ] || fail "源码不完整，缺少 android/install.sh：${source}"
}

source_version() {
  local dir="$1"
  [ -f "${dir}/package.json" ] || return 0
  node -e 'try { process.stdout.write(String(require(process.argv[1]).version || "")) } catch (error) {}' "${dir}/package.json" 2>/dev/null || true
}

git_head_of() {
  local dir="$1"
  [ -d "${dir}/.git" ] || return 0
  git -C "${dir}" rev-parse --short HEAD 2>/dev/null || true
}

git_branch_of() {
  local dir="$1"
  [ -d "${dir}/.git" ] || return 0
  git -C "${dir}" rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

port_open() {
  node - "$1" <<'NODE'
const net = require('node:net')
const socket = net.createConnection({ host: '127.0.0.1', port: Number(process.argv[2]) })
const done = (ok) => { socket.destroy(); process.exit(ok ? 0 : 1) }
socket.setTimeout(1500)
socket.once('connect', () => done(true))
socket.once('timeout', () => done(false))
socket.once('error', () => done(false))
NODE
}

stop_service() {
  local dir="${1:-${APP_DIR}}"
  [ -f "${dir}/bin/dsh-tavern.mjs" ] || return 0
  # 必须带上 RUNTIME_HOST：缺 .dsh-tavern-local.json 时宿主会退化成 cli，
  # DSH_ROOT 变成 ~/.dsh-tavern，stop 会静默空操作（launcher-environment.mjs:15-24）。
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" DSH_TAVERN_RUNTIME_HOST=android \
    node "${dir}/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
  local waited=0
  while port_open "${TAVERN_PORT}" && [ "${waited}" -lt 20 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if port_open "${TAVERN_PORT}"; then
    info "端口 ${TAVERN_PORT} 仍在监听，继续切换（新版本会再停一次）。"
  else
    info "酒馆服务已停止。"
  fi
}

start_service() {
  local dir="${1:-${APP_DIR}}"
  [ -f "${dir}/bin/dsh-tavern.mjs" ] || return 0
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" DSH_TAVERN_RUNTIME_HOST=android \
    node "${dir}/bin/dsh-tavern.mjs" start >/dev/null 2>&1 || true
}

download_file() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 900 \
      -o "${destination}" "${url}"
    return
  fi
  node - "${url}" "${destination}" <<'NODE'
const fs = require('node:fs')
const [url, destination] = process.argv.slice(2)
fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) })
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.arrayBuffer()
  })
  .then(body => fs.writeFileSync(destination, Buffer.from(body)))
  .catch(error => {
    console.error(`下载失败：${error.message}`)
    process.exitCode = 1
  })
NODE
}

remote_revision() {
  command -v git >/dev/null 2>&1 || return 0
  git ls-remote "${REPOSITORY}" "refs/heads/${TARGET_BRANCH}" 2>/dev/null | awk '{print $1; exit}' || true
}

same_lockfile() {
  local candidate="$1"
  [ -f "${APP_DIR}/pnpm-lock.yaml" ] || return 1
  cmp -s "${APP_DIR}/pnpm-lock.yaml" "${candidate}/pnpm-lock.yaml" || return 1
  if [ -f "${APP_DIR}/pnpm-workspace.yaml" ] || [ -f "${candidate}/pnpm-workspace.yaml" ]; then
    cmp -s "${APP_DIR}/pnpm-workspace.yaml" "${candidate}/pnpm-workspace.yaml" || return 1
  fi
  if [ -d "${APP_DIR}/patches" ] || [ -d "${candidate}/patches" ]; then
    diff -rq "${APP_DIR}/patches" "${candidate}/patches" >/dev/null 2>&1 || return 1
  fi
  return 0
}

prepare_temp_root() {
  if [ -z "${TEMP_ROOT}" ]; then
    mkdir -p -- "$(dirname -- "${APP_DIR}")"
    TEMP_ROOT="$(mktemp -d "$(dirname -- "${APP_DIR}")/.dsh-tavern-branch-switch.XXXXXX")"
  fi
}

write_record() {
  local kind="$1"
  mkdir -p -- "${STATE_DIR}"
  {
    printf 'KIND=%s\n' "${kind}"
    printf 'APP_DIR=%s\n' "${APP_DIR}"
    printf 'PREVIOUS_BRANCH=%s\n' "${PREVIOUS_BRANCH}"
    printf 'PREVIOUS_COMMIT=%s\n' "${PREVIOUS_COMMIT}"
    printf 'PREVIOUS_VERSION=%s\n' "${PREVIOUS_VERSION}"
    printf 'TARGET_BRANCH=%s\n' "${TARGET_BRANCH}"
    printf 'TARGET_REV=%s\n' "${CANDIDATE_REV}"
    printf 'TARGET_VERSION=%s\n' "${TARGET_VERSION}"
    printf 'CREATED=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } >"${STATE_DIR}/state.env"
  printf '%s\n' "${STATE_DIR}" >"${STATE_ROOT}/latest"
}

write_marker() {
  [ -d "${APP_DIR}" ] || return 0
  {
    printf '%s\n' "${TARGET_BRANCH}"
    printf '%s\n' "${CANDIDATE_REV}"
    date '+%Y-%m-%d %H:%M:%S'
  } >"${APP_DIR}/${MARKER}"
}

# 目标分支源码：优先 Git 稀疏克隆，失败退回 GitHub 压缩包。
fetch_candidate() {
  prepare_temp_root
  local cloned=0
  if command -v git >/dev/null 2>&1; then
    local candidate="${TEMP_ROOT}/git-source"
    step "用 Git 拉取分支 ${TARGET_BRANCH}"
    info "仓库：${REPOSITORY}"
    if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 \
      clone --filter=blob:none --no-checkout --branch "${TARGET_BRANCH}" --single-branch \
      "${REPOSITORY}" "${candidate}" \
      && git -C "${candidate}" sparse-checkout set --no-cone '/*' '!**/docs/' \
      && git -C "${candidate}" checkout --quiet "${TARGET_BRANCH}"; then
      CANDIDATE="${candidate}"
      CANDIDATE_KIND=git
      CANDIDATE_REV="$(git -C "${candidate}" rev-parse HEAD)"
      cloned=1
    else
      info 'Git 拉取失败，改用 GitHub 压缩包。'
      rm -rf -- "${candidate}" 2>/dev/null || true
    fi
  else
    info '未检测到 Git，直接用 GitHub 压缩包。'
  fi
  if [ "${cloned}" -eq 0 ]; then
    require_command tar
    local archive="${TEMP_ROOT}/branch.tar.gz"
    local candidate="${TEMP_ROOT}/tarball-source"
    step "下载分支压缩包"
    info "地址：${TARBALL_URL}"
    download_file "${TARBALL_URL}" "${archive}" || fail "分支压缩包下载失败，请检查网络后重试。"
    mkdir -p -- "${candidate}"
    tar -xzf "${archive}" -C "${candidate}" --strip-components=1 --exclude='*/docs' --exclude='*/docs/*' \
      || fail "压缩包解压失败，旧版本未被修改。"
    rm -f -- "${archive}" 2>/dev/null || true
    CANDIDATE="${candidate}"
    CANDIDATE_KIND=tarball
  fi
  verify_source "${CANDIDATE}"
  if [ -z "${CANDIDATE_REV}" ]; then CANDIDATE_REV="$(remote_revision)"; fi
  TARGET_VERSION="$(source_version "${CANDIDATE}")"
  info "目标源码：${TARGET_VERSION:-未知版本} ${CANDIDATE_REV:+(${CANDIDATE_REV:0:10})}"
}

# 整目录替换：保留 data/，lockfile 未变时把 node_modules 搬过去省一次安装。
swap_source() {
  step "备份旧源码并替换为分支源码"
  if [ -d "${APP_DIR}/data" ] && [ ! -e "${CANDIDATE}/data" ]; then
    cp -a "${APP_DIR}/data" "${CANDIDATE}/data" || fail "复制 data 目录失败，旧版本未被修改。"
    info '已复制旧目录下的 data/'
  fi
  if [ -d "${APP_DIR}/node_modules" ] && [ ! -e "${CANDIDATE}/node_modules" ] && same_lockfile "${CANDIDATE}"; then
    if mv -- "${APP_DIR}/node_modules" "${CANDIDATE}/node_modules" 2>/dev/null; then
      CARRIED=1
      info '依赖未变化，复用已安装的 node_modules'
    fi
  fi
  SOURCE_BACKUP="${STATE_DIR}/previous-source"
  mv -- "${APP_DIR}" "${SOURCE_BACKUP}" || fail "无法移走旧源码目录，未做任何修改。"
  if ! mv -- "${CANDIDATE}" "${APP_DIR}"; then
    mv -- "${SOURCE_BACKUP}" "${APP_DIR}" 2>/dev/null || true
    fail "替换源码目录失败，旧版本已恢复。"
  fi
  CANDIDATE=""
  SWAPPED=1
  CANDIDATE_KIND=swap
  # 快照没有 .git：写 tarball 标记，之后的 setup.sh / 应用内更新继续按目标分支取源码。
  if [ ! -d "${APP_DIR}/.git" ]; then
    printf '%s\n' "${TARBALL_URL}" >"${APP_DIR}/.dsh-tavern-tarball-source"
    info "已写入压缩包源标记：${TARBALL_URL}"
  fi
  write_record swap
}

# Git 安装原地切分支：不需要复制整棵树，失败会退回整目录替换。
switch_in_place() {
  [ -d "${APP_DIR}/.git" ] || return 1
  command -v git >/dev/null 2>&1 || return 1
  step "在 Git 工作区内切到 ${TARGET_BRANCH}"
  if [ -n "$(git -C "${APP_DIR}" status --porcelain 2>/dev/null || true)" ]; then
    local patch="${STATE_DIR}/local-changes.patch"
    git -C "${APP_DIR}" diff >"${patch}" 2>/dev/null || true
    # 只暂存已跟踪文件的修改：data/ 与用户自己的未跟踪文件都留在原地。
    if git -C "${APP_DIR}" stash push -m "tavern-branch-switch $(date +%H%M%S)" >/dev/null 2>&1; then
      STASHED=1
      info "本地未提交修改已 stash，并另存为 ${patch}"
    else
      info '本地修改无法 stash，改用整目录替换（旧目录会整份保留）。'
      return 1
    fi
  fi
  git -C "${APP_DIR}" config remote.origin.promisor true 2>/dev/null || true
  git -C "${APP_DIR}" config remote.origin.partialclonefilter blob:none 2>/dev/null || true
  git -C "${APP_DIR}" sparse-checkout set --no-cone '/*' '!**/docs/' 2>/dev/null || true
  if ! git -C "${APP_DIR}" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 \
    fetch origin "+refs/heads/${TARGET_BRANCH}:refs/remotes/origin/${TARGET_BRANCH}"; then
    info 'Git 拉取分支失败，改用整目录替换。'
    if [ "${STASHED}" -eq 1 ]; then
      git -C "${APP_DIR}" stash pop >/dev/null 2>&1 || true
      STASHED=0
    fi
    return 1
  fi
  if ! git -C "${APP_DIR}" checkout --quiet -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"; then
    info '切换分支失败，改用整目录替换。'
    if [ "${STASHED}" -eq 1 ]; then
      git -C "${APP_DIR}" stash pop >/dev/null 2>&1 || true
      STASHED=0
    fi
    return 1
  fi
  SWAPPED=1
  CANDIDATE_KIND=git
  CANDIDATE_REV="$(git -C "${APP_DIR}" rev-parse HEAD)"
  TARGET_VERSION="$(source_version "${APP_DIR}")"
  write_record git
  return 0
}

run_installer() {
  local dir="$1"
  step "重装依赖、重写 Profile 配置并重启酒馆（这一步最慢）"
  info "源码目录：${dir}"
  if [ "${SKIP_INSTALL}" = 1 ]; then
    info 'DSH_TAVERN_SWITCH_NO_INSTALL=1：跳过安装器（自测模式）'
    return 0
  fi
  require_command dsh
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_START_TIMEOUT="${DSH_TAVERN_START_TIMEOUT:-180}" \
    bash "${dir}/android/install.sh"
}

record_state_value() {
  local dir="$1"
  local key="$2"
  sed -n "s/^${key}=//p" "${dir}/state.env" 2>/dev/null | head -1
}

latest_state_dir() {
  [ -f "${STATE_ROOT}/latest" ] || return 1
  local dir
  dir="$(head -1 "${STATE_ROOT}/latest")"
  [ -n "${dir}" ] && [ -f "${dir}/state.env" ] || return 1
  printf '%s\n' "${dir}"
}

list_states() {
  [ -d "${STATE_ROOT}" ] || { printf '还没有切换记录：%s\n' "${STATE_ROOT}"; return 0; }
  local entry
  for entry in "${STATE_ROOT}"/*/; do
    [ -f "${entry}/state.env" ] || continue
    printf '%s\t%s -> %s (%s)\n' "$(basename -- "${entry}")" \
      "$(record_state_value "${entry}" PREVIOUS_VERSION)" \
      "$(record_state_value "${entry}" TARGET_VERSION)" \
      "$(record_state_value "${entry}" CREATED)"
  done
}

# 把源码恢复到记录里的旧版本，然后重装旧版本（Profile 配置要指回去）。
restore_state() {
  local state_dir="$1"
  PREVIOUS_KIND="$(record_state_value "${state_dir}" KIND)"
  PREVIOUS_BRANCH="$(record_state_value "${state_dir}" PREVIOUS_BRANCH)"
  PREVIOUS_COMMIT="$(record_state_value "${state_dir}" PREVIOUS_COMMIT)"
  stop_service
  step "恢复切换前的源码（$(record_state_value "${state_dir}" PREVIOUS_VERSION)）"
  case "${PREVIOUS_KIND}" in
    git)
      require_command git
      [ -n "${PREVIOUS_COMMIT}" ] || fail "记录里缺少旧提交号：${state_dir}/state.env"
      git -C "${APP_DIR}" checkout --quiet -f "${PREVIOUS_COMMIT}" \
        || fail "无法切回旧提交 ${PREVIOUS_COMMIT}，源码未修改。"
      if [ -n "${PREVIOUS_BRANCH}" ] && [ "${PREVIOUS_BRANCH}" != HEAD ] && [ "${PREVIOUS_BRANCH}" != "${TARGET_BRANCH}" ]; then
        git -C "${APP_DIR}" checkout --quiet -B "${PREVIOUS_BRANCH}" 2>/dev/null || true
      fi
      if [ "${STASHED}" -eq 1 ]; then
        git -C "${APP_DIR}" stash pop >/dev/null 2>&1 || true
        STASHED=0
      fi
      ;;
    swap)
      local backup="${state_dir}/previous-source"
      [ -d "${backup}" ] || fail "找不到旧源码备份：${backup}"
      local failed="${state_dir}/failed-source"
      if [ -e "${failed}" ]; then failed="${failed}-$(date +%s)"; fi
      if [ -e "${APP_DIR}" ]; then mv -- "${APP_DIR}" "${failed}" || fail "无法移开当前源码：${APP_DIR}"; fi
      if [ "${CARRIED}" -eq 1 ] && [ -d "${failed}/node_modules" ] && [ ! -e "${backup}/node_modules" ]; then
        mv -- "${failed}/node_modules" "${backup}/node_modules" 2>/dev/null || true
      fi
      mv -- "${backup}" "${APP_DIR}" || fail "无法恢复旧源码，保留在：${backup}"
      info "换下来的源码保留在：${failed}"
      ;;
    *) fail "未知的记录类型：${PREVIOUS_KIND}" ;;
  esac
  SWAPPED=0
  write_marker_revert "${state_dir}"
  run_installer "${APP_DIR}" || { start_service; fail "旧版本重装失败，源码已恢复，可手动启动酒馆。"; }
  if [ -f "${STATE_ROOT}/latest" ] && [ "$(head -1 "${STATE_ROOT}/latest")" = "${state_dir}" ]; then
    rm -f -- "${STATE_ROOT}/latest"
    info "已消费这条切换记录；记录目录仍保留：${state_dir}"
  fi
  report
}

write_marker_revert() {
  [ -d "${APP_DIR}" ] || return 0
  local state_dir="$1" commit
  commit="$(git_head_of "${APP_DIR}")"
  [ -n "${commit}" ] || commit="$(record_state_value "${state_dir}" PREVIOUS_COMMIT)"
  {
    printf '%s\n' "${PREVIOUS_BRANCH:-main}"
    printf '%s\n' "${commit}"
    date '+%Y-%m-%d %H:%M:%S'
  } >"${APP_DIR}/${MARKER}"
}

report() {
  local version commit branch
  version="$(source_version "${APP_DIR}")"
  commit="$(git_head_of "${APP_DIR}")"
  branch="$(git_branch_of "${APP_DIR}")"
  printf '\n版本：%s\n' "${version:-未知}"
  printf '分支：%s\n' "${branch:-非 Git 安装（压缩包/快照）}"
  printf '提交：%s\n' "${commit:-未知}"
  [ -f "${APP_DIR}/${MARKER}" ] && printf '分支标记：%s\n' "$(head -1 "${APP_DIR}/${MARKER}")"
  if port_open "${TAVERN_PORT}"; then
    printf '酒馆服务：http://127.0.0.1:%s 已就绪\n' "${TAVERN_PORT}"
  else
    printf '酒馆服务：%s 当前未监听，请查看 %s/logs/tavern.log\n' "${TAVERN_PORT}" "${DSH_ROOT}"
  fi
}

# 切换 DSH_HOME 也跟随发现的 home（用户显式设置时不动）。
adopt_root() {
  DSH_ROOT="$1"
  [ -n "${DSH_TAVERN_SWITCH_STATE_DIR:-}" ] || STATE_ROOT="${DSH_ROOT}/backups/branch-switch"
}

profile_source_of() {
  local manifest="$1"
  [ -f "${manifest}" ] || return 0
  node -e 'try { const p = require(process.argv[1]); process.stdout.write(String(p?.dshTavern?.source || "")) } catch (error) {}' \
    "${manifest}" 2>/dev/null || true
}

# 扫描本机找候选安装目录。按标志文件找，不信任目录名：
#   bin/dsh-tavern.mjs   → 源码目录（取两级父目录核对 package.json）
#   profiles/tavern/package.json → 记录里的 dshTavern.source 就是源码目录
#   tavern.pid.json      → 运行记录，上一级是安装根
# find 带 -L：$HOME/.dsh 常被做成软链接，不跟随就整棵漏掉。
locate_installs() {
  local roots=() extra=() root hit dir app home_hit found=0
  local seen_file
  seen_file="$(mktemp)"
  roots+=("${HOME:-}")
  [ -d /root ] && roots+=(/root)
  [ -d /storage/emulated/0 ] && roots+=(/storage/emulated/0)
  if [ -n "${DSH_TAVERN_SEARCH_ROOTS:-}" ]; then
    IFS=: read -r -a extra <<<"${DSH_TAVERN_SEARCH_ROOTS}"
    roots+=("${extra[@]}")
  fi
  step "扫描安装目录（按标志文件，深度 7，只读）"
  for root in "${roots[@]}"; do
    [ -d "${root}" ] || continue
    info "扫描：${root}"
    while IFS= read -r hit; do
      [ -n "${hit}" ] || continue
      grep -qxF "${hit}" "${seen_file}" && continue
      case "${hit}" in
        */bin/dsh-tavern.mjs)
          app="$(dirname -- "$(dirname -- "${hit}")")"
          [ -f "${app}/package.json" ] || continue
          grep -qxF "${app}" "${seen_file}" && continue
          printf '%s\n' "${app}" >>"${seen_file}"
          found=$((found + 1))
          printf '%s\t版本 %s\t分支 %s\t提交 %s\n' "${app}" \
            "$(source_version "${app}")" "$(git_branch_of "${app}")" "$(git_head_of "${app}")"
          ;;
        */profiles/tavern/package.json)
          printf '%s\n' "${hit}" >>"${seen_file}"
          home_hit="${hit%/profiles/tavern/package.json}"
          app="$(profile_source_of "${hit}")"
          if [ -n "${app}" ] && [ -f "${app}/package.json" ]; then
            grep -qxF "${app}" "${seen_file}" && continue
            printf '%s\n' "${app}" >>"${seen_file}"
            found=$((found + 1))
            printf '%s\t版本 %s\t分支 %s\t（来自 %s 的 profile 记录）\n' "${app}" \
              "$(source_version "${app}")" "$(git_branch_of "${app}")" "${home_hit}"
          else
            printf '（profile 存在但 dshTavern.source 指向的目录不在：%s）\n' "${root}"
          fi
          ;;
        */tavern.pid.json)
          printf '%s\n' "${hit}" >>"${seen_file}"
          printf '%s\t（PID 记录，安装根在两级之上）\n' "${hit}"
          ;;
      esac
    done < <(find -L "${root}" -maxdepth 7 \
      \( -path '*/bin/dsh-tavern.mjs' -o -name 'tavern.pid.json' -o -path '*/profiles/tavern/package.json' \) \
      2>/dev/null)
  done
  rm -f -- "${seen_file}" 2>/dev/null || true
  if [ "${found}" -eq 0 ]; then
    info '没扫到源码目录。可直接看这几个位置：'
    printf '    ls -la %s/.dsh ~/.dsh-tavern 2>/dev/null\n' "${HOME:-$HOME}"
    info '或加根目录再扫：DSH_TAVERN_SEARCH_ROOTS=/path1:/path2 bash switch-branch.sh --locate'
  else
    info '用上面第一条的目录：DSH_TAVERN_SOURCE_ROOT=<目录> bash switch-branch.sh --dry-run'
  fi
}

# 找已安装源码目录：显式变量 > profile 记录的 dshTavern.source > 常见位置。
# APK 侧的安装常落在 /root/.dsh，而 Termux 宿主 shell 的 $HOME 是另一个目录，
# 所以不能只信默认值。
discover_source() {
  local explicit="${DSH_TAVERN_SOURCE_ROOT:-${DSH_TAVERN_ANDROID_APP_DIR:-}}"
  if [ -n "${explicit}" ]; then
    APP_DIR="${explicit}"
    return 0
  fi
  if [ -f "${APP_DIR}/package.json" ]; then return 0; fi
  local root candidate
  for root in "${DSH_HOME:-}" "${HOME}/.dsh" /root/.dsh "${HOME}/.dsh-tavern"; do
    [ -n "${root}" ] || continue
    for candidate in "${root}/apps/dsh-tavern" "${root}/app/dsh-tavern"; do
      if [ -f "${candidate}/package.json" ]; then
        APP_DIR="${candidate}"
        adopt_root "${root}"
        info "自动找到安装目录：${APP_DIR}（DSH_HOME=${DSH_ROOT}）"
        return 0
      fi
    done
    candidate="$(profile_source_of "${root}/profiles/tavern/package.json")"
    if [ -n "${candidate}" ] && [ -f "${candidate}/package.json" ]; then
      APP_DIR="${candidate}"
      adopt_root "${root}"
      info "按 tavern Profile 记录找到安装目录：${APP_DIR}（DSH_HOME=${DSH_ROOT}）"
      return 0
    fi
  done
  return 1
}

switch_branch() {
  discover_source || fail "没有找到已安装的源码目录。试过：${APP_DIR}、\$HOME/.dsh、/root/.dsh。请用 DSH_TAVERN_SOURCE_ROOT=/path/to/dsh-tavern 指过去。"
  verify_source "${APP_DIR}"
  PREVIOUS_VERSION="$(source_version "${APP_DIR}")"
  PREVIOUS_BRANCH="$(git_branch_of "${APP_DIR}")"
  PREVIOUS_COMMIT="$(git_head_of "${APP_DIR}")"

  local free_kb=0
  if command -v df >/dev/null 2>&1; then
    free_kb="$(df -Pk "$(dirname -- "${APP_DIR}")" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  fi
  if [ -n "${free_kb}" ] && [ "${free_kb}" -lt 400000 ]; then
    info "可用空间约 $((free_kb / 1024))MB，切换需要复制一份源码，建议先清理。"
  fi

  if [ "${DRY_RUN}" -eq 1 ]; then
    CANDIDATE_REV="$(remote_revision)"
    step "切换计划（dry-run，不修改任何文件）"
    info "源码目录：${APP_DIR}"
    info "当前版本：${PREVIOUS_VERSION:-未知} ${PREVIOUS_COMMIT:+(${PREVIOUS_COMMIT})} 分支：${PREVIOUS_BRANCH:-非 Git 安装}"
    info "目标分支：${TARGET_BRANCH} ${CANDIDATE_REV:+(${CANDIDATE_REV:0:10})}"
    info '步骤：停服务 → 备份旧源码到 backups/branch-switch → 拉取目标分支 → 替换源码（保留 data/ 与 node_modules）→ 跑 android/install.sh → 校验 3088'
    info "记录目录：${STATE_ROOT}"
    return 0
  fi

  [ -d "${APP_DIR}/.git" ] || info '当前不是 Git 安装，将整目录替换。'
  STATE_DIR="${STATE_ROOT}/$(date +%Y%m%d-%H%M%S)"
  mkdir -p -- "${STATE_DIR}"
  info "切换记录：${STATE_DIR}"

  stop_service
  if ! switch_in_place; then
    fetch_candidate
    swap_source
  else
    info "已切到 ${TARGET_BRANCH}（Git 工作区）"
  fi

  if ! run_installer "${APP_DIR}"; then
    printf '\n安装器失败，开始回滚……\n' >&2
    restore_state "${STATE_DIR}" || true
    fail "新版本安装失败，已恢复切换前的版本。详情见上方日志。"
  fi
  write_marker
  report
  printf '\n切换完成。返回 DSH Tavern 应用，重新加载“酒馆工作台”即可。\n'
  printf '要回到切换前的版本：bash %s --revert\n' "${BASH_SOURCE[0]}"
}

revert_branch() {
  local state_dir recorded
  state_dir="$(latest_state_dir)" || fail "没有可回退的切换记录（${STATE_ROOT}）。"
  recorded="$(record_state_value "${state_dir}" APP_DIR)"
  if [ -n "${recorded}" ] && [ ! -f "${APP_DIR}/package.json" ] && [ -f "${recorded}/package.json" ]; then
    APP_DIR="${recorded}"
    case "${recorded}" in
      */apps/*) adopt_root "${recorded%/apps/*}" ;;
    esac
    info "按切换记录使用源码目录：${APP_DIR}"
  fi
  info "使用记录：${state_dir}"
  restore_state "${state_dir}"
  printf '\n已回退到切换前的版本。\n'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --revert) MODE=revert ;;
    --list) MODE=list ;;
    --locate) MODE=locate ;;
    --restore)
      MODE=restore
      shift
      [ "$#" -gt 0 ] || fail "--restore 需要记录目录"
      STATE_DIR="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1（--help 查看用法）" ;;
  esac
  shift
done

case "${MODE}" in
  switch) switch_branch ;;
  revert) revert_branch ;;
  list) list_states ;;
  locate) locate_installs ;;
  restore)
    [ -f "${STATE_DIR}/state.env" ] || fail "不是有效的切换记录：${STATE_DIR}"
    restore_state "${STATE_DIR}"
    ;;
esac
