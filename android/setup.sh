#!/usr/bin/env bash
set -euo pipefail

DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
APP_DIR="${DSH_TAVERN_SOURCE_ROOT:-${DSH_TAVERN_ANDROID_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}}"
DEFAULT_REPOSITORY="https://github.com/flizzywine/dsh-tavern.git"
REPOSITORY="${DSH_TAVERN_REPOSITORY:-${DEFAULT_REPOSITORY}}"
# Follows the main branch, same as install.sh.
BRANCH="${DSH_TAVERN_BRANCH:-main}"
DEFAULT_TARBALL_URL="https://codeload.github.com/flizzywine/dsh-tavern/tar.gz/refs/heads/main"
TARBALL_URL="${DSH_TAVERN_TARBALL_URL:-${DEFAULT_TARBALL_URL}}"
# 运行清单与 CDN 源：按文件哈希逐个比对，只下载有变化的文件（整包压缩包为备用方案）。
CDN_METADATA_URL="${DSH_TAVERN_CDN_METADATA_URL:-https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@runtime-archive-main/dsh-tavern-runtime.json}"
CDN_ROOT_URL="${DSH_TAVERN_CDN_ROOT_URL:-https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern}"
SOURCE_CDN="${DSH_TAVERN_SOURCE_CDN:-1}"
SOURCE_MARKER=".dsh-tavern-tarball-source"
OFFLINE_TARBALL="/root/tavern-offline.tar"
OFFLINE_DIR="${DSH_ROOT}/tavern-offline"
# 独立 APK 升级时由原生层传入：用本次 APK 自带快照离线替换源码与依赖，
# 并带上期望提交，避免复用上一个 APK 留下的解包目录。
APK_BUNDLE_UPDATE="${DSH_TAVERN_APK_BUNDLE_UPDATE:-0}"
APK_BUNDLE_REVISION="${DSH_TAVERN_APK_BUNDLE_REVISION:-}"
TEMP_ROOT=""
SOURCE_BACKUP=""
SOURCE_SWAPPED=0
NODE_MODULES_CARRIED=0

fail() {
  printf 'DSH Tavern 安装失败：%s\n' "$1" >&2
  exit 1
}

# 全程带步骤序号与耗时，日志会原样落到 APK 的安装日志里，方便判断卡在哪一步。
START_TIME=$(date +%s)
STEP=0
stage() {
  STEP=$((STEP + 1))
  printf '\n== [步骤 %s] %s（已用 %ss）==\n' "${STEP}" "$*" "$(( $(date +%s) - START_TIME ))"
}
info() { printf '   %s\n' "$*"; }

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

# APK 自带的离线包：{ revision, source/, store/, cache/, registry, pnpm-runtime/ }。
# 首装完全离线；解包一次后保留在数据目录，失败重试时不必再解。
OFFLINE_READY=0
prepare_offline_bundle() {
  [ "${OFFLINE_READY}" -eq 1 ] && return 0
  # APK 升级时以本次 APK 的提交为准：旧 APK 失败后留下的解包目录不能复用。
  if [ -n "${APK_BUNDLE_REVISION}" ] && [ -f "${OFFLINE_DIR}/revision" ] \
    && [ "$(cat "${OFFLINE_DIR}/revision" 2>/dev/null || true)" != "${APK_BUNDLE_REVISION}" ]; then
    info "内置快照版本变化（$(cat "${OFFLINE_DIR}/revision" 2>/dev/null || echo 未知) → ${APK_BUNDLE_REVISION}），重新解包"
    rm -rf -- "${OFFLINE_DIR}" 2>/dev/null || true
  fi
  if [ -f "${OFFLINE_DIR}/revision" ] && [ -d "${OFFLINE_DIR}/store" ] && [ -d "${OFFLINE_DIR}/source" ]; then
    # 新 APK 可能带更新的源码/缓存；只按目录存在复用会把旧 store 和缺失的
    # metadata 缓存一直留着，首装继续退回联网。比对包内 revision，不同就重解。
    local bundled_revision=""
    if [ -f "${OFFLINE_TARBALL}" ]; then
      bundled_revision="$(tar -xzOf "${OFFLINE_TARBALL}" revision 2>/dev/null || true)"
    fi
    if [ -z "${bundled_revision}" ] || [ "$(cat "${OFFLINE_DIR}/revision")" = "${bundled_revision}" ]; then
      info "复用已解包的离线依赖：${OFFLINE_DIR}"
      OFFLINE_READY=1
      return 0
    fi
    info "内置依赖包版本变化（$(cat "${OFFLINE_DIR}/revision" 2>/dev/null) → ${bundled_revision}），重新解包"
    rm -rf -- "${OFFLINE_DIR}" 2>/dev/null || true
  fi
  [ -f "${OFFLINE_TARBALL}" ] || return 1
  stage "解开 APK 内置依赖包（$(du -h "${OFFLINE_TARBALL}" 2>/dev/null | cut -f1)，约 20-60s）"
  info "源文件：${OFFLINE_TARBALL}"
  mkdir -p "${OFFLINE_DIR}"
  # 分步解，日志里能看到每个目录的落盘时间，便于判断是慢还是卡死。
  tar -xzf "${OFFLINE_TARBALL}" -C "${OFFLINE_DIR}" \
    || { info '离线包解压失败，改用联网安装。'; return 1; }
  if [ ! -f "${OFFLINE_DIR}/revision" ] || [ ! -d "${OFFLINE_DIR}/store" ] || [ ! -d "${OFFLINE_DIR}/source" ]; then
    info '离线包内容不完整，改用联网安装。'
    return 1
  fi
  info "离线包就绪：源码 $(find "${OFFLINE_DIR}/source" -type f | wc -l) 个文件，store $(du -sh "${OFFLINE_DIR}/store" 2>/dev/null | cut -f1)"
  # 已解包则可以删掉压缩包，省出与包体相当的空间。
  rm -f -- "${OFFLINE_TARBALL}" 2>/dev/null || true
  OFFLINE_READY=1
  return 0
}

install_from_offline() {
  prepare_offline_bundle || return 1
  stage "使用 APK 内置源码快照（$(cat "${OFFLINE_DIR}/revision")）"
  prepare_temp_root
  # 复制而不是移动：离线目录保持完整，安装失败重试时不必重新解包。
  local candidate="${TEMP_ROOT}/offline-source"
  cp -a "${OFFLINE_DIR}/source" "${candidate}" || { info '复制内置源码失败，改用联网安装。'; return 1; }
  verify_source "${candidate}"
  info "源码已就绪：$(find "${candidate}" -type f | wc -l) 个文件"
  # 快照没有 .git：写 tarball 标记，之后的更新走官方压缩包覆盖，行为与既有压缩包安装一致。
  printf '%s\n' "${DEFAULT_TARBALL_URL}" >"${candidate}/${SOURCE_MARKER}"
  replace_source "${candidate}"
  return 0
}

download_file() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    # 手机网络可能在传输中途停住：60 秒低于 1 KB/s 或 15 分钟总时长即失败，
    # 交给上层回退/重试，而不是像以前那样无限等待、看起来像卡死。
    curl -fL --retry 2 --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 900 \
      -o "${destination}" "${url}"
    return
  fi
  printf '未检测到 curl，正在通过 Node.js 下载……\n'
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
    console.error(`Node.js 下载失败：${error.message}`)
    process.exitCode = 1
  })
NODE
}

# 依赖锁文件没变时，已装的 node_modules 可以原样复用；整体替换源码时把它搬进新目录，
# 后续 pnpm install 只是校验一遍，不再把 287 个包重新复制或下载。
same_lockfile() {
  local candidate="$1"
  cmp -s "${APP_DIR}/pnpm-lock.yaml" "${candidate}/pnpm-lock.yaml" || return 1
  cmp -s "${APP_DIR}/pnpm-workspace.yaml" "${candidate}/pnpm-workspace.yaml" || return 1
  # 依赖补丁变了也要重装，不能只看 lockfile。
  if [ -d "${APP_DIR}/patches" ] || [ -d "${candidate}/patches" ]; then
    diff -rq "${APP_DIR}/patches" "${candidate}/patches" >/dev/null 2>&1 || return 1
  fi
  return 0
}

replace_source() {
  local candidate="$1"
  verify_source "${candidate}"
  if [ -d "${APP_DIR}/data" ] && [ ! -e "${candidate}/data" ]; then
    cp -a "${APP_DIR}/data" "${candidate}/data"
  fi
  if [ -d "${APP_DIR}/node_modules" ] && [ ! -e "${candidate}/node_modules" ] && same_lockfile "${candidate}"; then
    if mv -- "${APP_DIR}/node_modules" "${candidate}/node_modules" 2>/dev/null; then
      NODE_MODULES_CARRIED=1
      info '依赖未变化，复用已安装的 node_modules'
    fi
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

# 把 SOURCE_BACKUP 换回 APP_DIR。调用方先确认可以动这两个目录。
swap_in_previous() {
  [ -n "${SOURCE_BACKUP}" ] && [ -d "${SOURCE_BACKUP}" ] || return 0
  # 复用过去的 node_modules 跟着新源码一起回滚，别让旧版本失去可用依赖。
  if [ "${NODE_MODULES_CARRIED}" = 1 ] && [ -d "${APP_DIR}/node_modules" ] \
    && [ ! -e "${SOURCE_BACKUP}/node_modules" ]; then
    mv -- "${APP_DIR}/node_modules" "${SOURCE_BACKUP}/node_modules" 2>/dev/null || true
  fi
  if [ -e "${APP_DIR}" ]; then
    local target="${TEMP_ROOT}/failed-source"
    local suffix=1
    while [ -e "${target}" ]; do
      target="${TEMP_ROOT}/failed-source.${suffix}"
      suffix=$((suffix + 1))
    done
    mv -- "${APP_DIR}" "${target}"
  fi
  mv -- "${SOURCE_BACKUP}" "${APP_DIR}"
  SOURCE_BACKUP=""
  SOURCE_SWAPPED=0
}

rollback_source() {
  [ "${SOURCE_SWAPPED}" -eq 1 ] || return 0
  # Never move code out from underneath a still-running service. Keep both
  # versions for repair if shutdown failed or the PID record cannot be trusted.
  if ! node - "${DSH_ROOT}/logs/tavern.pid.json" <<'NODE'
const fs = require('node:fs')
try {
  const record = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (!Number.isInteger(record.pid) || record.pid <= 0) process.exit(1)
  try { process.kill(record.pid, 0); process.exit(1) }
  catch (error) { if (error.code !== 'ESRCH') process.exit(1) }
} catch (error) { if (error.code !== 'ENOENT') process.exit(1) }
NODE
  then
    printf '服务可能仍在运行，保留源码和备份：%s\n' "${TEMP_ROOT}" >&2
    TEMP_ROOT=""
    return 1
  fi
  swap_in_previous
}

# 更新被取消时，整棵安装进程树会被直接结束，脚本自己的回滚往往来不及跑，
# 上一次的源码就留在 <父目录>/.dsh-tavern-download.*/previous-source 里。
# 更新器确认执行链已停止后用 --restore-previous 调这里，把备份换回原位：
# 退出码 0 表示已恢复，3 表示没有可恢复的备份。
restore_previous() {
  local app="$1"
  local parent directory backup="" temp=""
  parent="$(dirname -- "${app}")"
  while IFS= read -r directory; do
    [ -n "${directory}" ] || continue
    if [ -f "${directory}/previous-source/package.json" ]; then
      temp="${directory}"
      backup="${directory}/previous-source"
      break
    fi
  done < <(ls -1dt -- "${parent}"/.dsh-tavern-download.* 2>/dev/null || true)
  if [ -z "${backup}" ]; then
    printf '没有可恢复的更新前源码备份。\n' >&2
    exit 3
  fi
  APP_DIR="${app}"
  TEMP_ROOT="${temp}"
  # 取消时旧服务通常还在跑（独立 APK 更新期间它本来就不停），替换源码本身
  # 不影响已经加载进内存的进程，所以这里不套用 rollback_source 的进程检查。
  if [ -d "${app}/node_modules" ] && [ ! -e "${backup}/node_modules" ] \
    && cmp -s "${backup}/pnpm-lock.yaml" "${app}/pnpm-lock.yaml" 2>/dev/null; then
    NODE_MODULES_CARRIED=1
  else
    NODE_MODULES_CARRIED=0
  fi
  SOURCE_BACKUP="${backup}"
  SOURCE_SWAPPED=1
  swap_in_previous
  local version=""
  version="$(node -e 'try { process.stdout.write(String(require(process.argv[1]).version || "")) } catch (error) {}' "${app}/package.json" 2>/dev/null || true)"
  # 保留换下来的那份源码，便于事后排查；下次更新不会把它当成备份。
  printf '换下来的源码保留在：%s\n' "${TEMP_ROOT}"
  TEMP_ROOT=""
  printf 'DSH_STATUS 已恢复更新前的源码%s\n' "${version:+ v${version}}"
}

# 增量更新：按 jsDelivr 运行清单逐文件比对，只下载有变化的文件，其余直接复用
# 已安装目录。完整源码包十几 MB，而一次更新真正变化的文件往往只有几百 KB。
install_from_cdn() {
  [ "${SOURCE_CDN}" != 0 ] || return 1
  [ -f "${APP_DIR}/bin/download.cjs" ] || return 1
  prepare_temp_root
  local candidate="${TEMP_ROOT}/cdn-source"
  local version=""
  version="$(node -e 'process.stdout.write(String(require(process.argv[1]).version || ""))' "${APP_DIR}/package.json" 2>/dev/null || true)"
  local args=(runtime "${CDN_METADATA_URL}" "${CDN_ROOT_URL}" "${candidate}" "${APP_DIR}" --stall 15 --budget 90)
  if [ -n "${version}" ]; then args+=(--min-version "${version}"); fi
  stage "增量下载源码（只下载有变化的文件）"
  if ! node "${APP_DIR}/bin/download.cjs" "${args[@]}"; then
    info '增量下载不可用，改用完整源码包。'
    return 1
  fi
  # 旧版运行清单还没有 android/：保留已安装的安装脚本，保证源码校验通过。
  if [ ! -f "${candidate}/android/install.sh" ]; then
    rm -rf -- "${candidate}/android"
    if ! cp -a "${APP_DIR}/android" "${candidate}/android"; then
      info '无法保留 Android 安装脚本，改用完整源码包。'
      return 1
    fi
  fi
  # 快照没有 .git：写 tarball 标记，之后继续走 CDN/压缩包覆盖。
  printf '%s\n' "${DEFAULT_TARBALL_URL}" >"${candidate}/${SOURCE_MARKER}"
  replace_source "${candidate}"
  return 0
}

install_from_tarball() {
  require_command tar
  prepare_temp_root
  local archive="${TEMP_ROOT}/dsh-tavern.tar.gz"
  local candidate="${TEMP_ROOT}/tarball-source"
  printf '正在改用 GitHub 压缩包下载源码……\n'
  if ! download_file "${TARBALL_URL}" "${archive}"; then
    info 'GitHub 压缩包下载失败。'
    return 1
  fi
  mkdir -p "${candidate}"
  if ! tar -xzf "${archive}" -C "${candidate}" --strip-components=1 --exclude='*/docs' --exclude='*/docs/*'; then
    info 'GitHub 压缩包无法解压，旧版本未被修改。'
    return 1
  fi
  verify_source "${candidate}"
  printf '%s\n' "${TARBALL_URL}" > "${candidate}/${SOURCE_MARKER}"
  replace_source "${candidate}"
}

install_source() {
  prepare_temp_root
  if command -v git >/dev/null 2>&1; then
    local candidate="${TEMP_ROOT}/git-source"
    local attempt
    for attempt in 1 2 3; do
      printf '正在通过 Git 下载 DSH Tavern（第 %s/3 次）……\n' "${attempt}"
      if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 clone --filter=blob:none --no-checkout --branch "${BRANCH}" --single-branch "${REPOSITORY}" "${candidate}" \
        && git -C "${candidate}" sparse-checkout set --no-cone '/*' '!**/docs/' \
        && git -C "${candidate}" checkout "${BRANCH}"; then
        replace_source "${candidate}"
        return
      fi
      # A failed clone or checkout can leave a directory that blocks the next clone.
      if [ -e "${candidate}" ]; then rm -rf -- "${candidate}"; fi
      if [ "${attempt}" -lt 3 ]; then sleep 2; fi
    done
  else
    printf '未检测到 Git，直接使用 GitHub 压缩包。\n'
  fi
  if install_from_tarball; then return; fi
  if install_from_cdn; then return; fi
  fail "Git、GitHub 压缩包与 jsDelivr 均未能取到源码，请检查网络后重试。"
}

is_disposable_upgrade_residue() {
  [ -d "${APP_DIR}" ] || return 1
  [ -z "$(find "${APP_DIR}" -mindepth 1 ! -type d ! -type l -print -quit 2>/dev/null)" ]
}

update_source() {
  # APK 升级：新 APK 自带比已装源码更新的快照时，直接离线换源码 + 依赖。
  # 原生层已经确认“用户没在应用内更新过”，所以这里不需要再比较版本。
  if [ "${APK_BUNDLE_UPDATE}" = 1 ]; then
    if [ -f "${OFFLINE_TARBALL}" ] || [ -d "${OFFLINE_DIR}/source" ]; then
      if install_from_offline; then
        info '已用 APK 内置快照完成离线升级'
        return
      fi
      info '内置快照不可用，改为常规方式更新。'
    fi
  fi
  if [ -d "${APP_DIR}/.git" ]; then
    require_command git
    if ! git -C "${APP_DIR}" diff --quiet || ! git -C "${APP_DIR}" diff --cached --quiet; then
      fail "项目目录存在未提交修改。为避免覆盖你的文件，已停止更新。"
    fi
    printf '正在检查 DSH Tavern 更新……\n'
    # Apply before fetching so existing installations also stop requesting doc blobs.
    git -C "${APP_DIR}" config remote.origin.promisor true
    git -C "${APP_DIR}" config remote.origin.partialclonefilter blob:none
    git -C "${APP_DIR}" sparse-checkout set --no-cone '/*' '!**/docs/'
    # 60 秒低于 1 KB/s 就中止：GitHub 不可达时不要让 fetch 无限挂起。
    if git -C "${APP_DIR}" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch origin "${BRANCH}"; then
      if ! git -C "${APP_DIR}" merge-base --is-ancestor HEAD "origin/${BRANCH}"; then
        local generated_only=1
        local commit subject files
        while IFS= read -r commit; do
          [ -n "${commit}" ] || continue
          subject="$(git -C "${APP_DIR}" show -s --format=%s "${commit}")"
          files="$(git -C "${APP_DIR}" diff-tree --no-commit-id --name-only -r "${commit}")"
          if [ "${subject}" != 'chore: publish runtime manifest [skip ci]' ] || [ "${files}" != 'dsh-tavern-runtime.json' ]; then
            generated_only=0
            break
          fi
        done < <(git -C "${APP_DIR}" rev-list "origin/${BRANCH}..HEAD")
        if [ "${generated_only}" -eq 1 ]; then
          printf '仅检测到自动生成的运行清单分叉，正在安全重新下载源码……\n'
          install_source
          return
        fi
        fail "项目目录包含本地提交或已经分叉，无法自动安全更新。"
      fi
      git -C "${APP_DIR}" merge --ff-only "origin/${BRANCH}"
      return
    fi
    # Git 走不通时先整包下载（GitHub 的 codeload），最后才用 jsDelivr 清单增量替换：
    # CDN 的 @main 会滞后十几小时，把它当兜底比当首选更安全。
    if install_from_tarball; then return; fi
    if install_from_cdn; then return; fi
    fail "Git、GitHub 压缩包与 jsDelivr 均未能取到源码，请检查网络后重试。"
    return
  fi
  if [ -f "${APP_DIR}/${SOURCE_MARKER}" ]; then
    if [ -z "${DSH_TAVERN_TARBALL_URL:-}" ]; then
      TARBALL_URL="$(sed -n '1p' "${APP_DIR}/${SOURCE_MARKER}")"
      [ -n "${TARBALL_URL}" ] || TARBALL_URL="${DEFAULT_TARBALL_URL}"
    fi
    if install_from_tarball; then return; fi
    if install_from_cdn; then return; fi
    fail "GitHub 压缩包与 jsDelivr 均未能取到源码，请检查网络后重试。"
    return
  fi
  if is_disposable_upgrade_residue; then
    printf '检测到 DSHA 升级残留的空依赖目录，正在重新安装 DSH Tavern……\n'
    install_source
    return
  fi
  fail "${APP_DIR} 已存在但不是受支持的 Git 或压缩包安装，请备份并移走该目录后重试。"
}

# 恢复模式：只把更新前的源码换回来，不下载、不安装。
if [ "${1:-}" = "--restore-previous" ]; then
  restore_previous "${2:-${APP_DIR}}"
  exit 0
fi

require_command bash
require_command node

stage "准备酒馆源码"
if [ ! -e "${APP_DIR}" ]; then
  # 全新安装优先用 APK 内置快照：不联网、不受网络质量影响。
  if install_from_offline; then
    info '使用 APK 内置源码（离线）'
  else
    info '未找到可用的内置依赖包，改为联网下载。'
    install_source
  fi
else
  info '已有安装，检查更新。'
  update_source
fi

verify_source "${APP_DIR}"

stage "安装依赖并配置 Profile（最慢的一步，日志会持续输出）"
if ! DSH_HOME="${DSH_ROOT}" DSH_TAVERN_OFFLINE_DIR="${OFFLINE_DIR}" bash "${APP_DIR}/android/install.sh"; then
  rollback_source || fail "无法确认服务已停止，未回滚源码，请检查进程后重试。"
  fail "依赖或 Profile 安装失败，源码已恢复到更新前版本。"
fi

SOURCE_SWAPPED=0
# 安装成功后内置依赖包已无用，清掉可释放数百 MB（失败时保留，重试更快）。
if [ -d "${OFFLINE_DIR}" ]; then
  rm -rf -- "${OFFLINE_DIR}" 2>/dev/null || true
fi
if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" = 1 ]; then
  printf '\n全部完成。请返回 DSH Tavern 应用并重新启动酒馆。\n'
else
  printf '\n全部完成。请重启 DSHA，然后点击侧栏里的“酒馆工作台”。\n'
fi
