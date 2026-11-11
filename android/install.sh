#!/usr/bin/env bash
set -euo pipefail
export DSH_TAVERN_RUNTIME_HOST=android
export DSH_TAVERN_START_TIMEOUT="${DSH_TAVERN_START_TIMEOUT:-120}"

export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
# pnpm 11 reads pnpm_config_* instead of npm_config_*.
export pnpm_config_registry="$npm_config_registry"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
TAVERN_PROFILE_DIR="${DSH_ROOT}/profiles/tavern"
TAVERN_PORT=3088
PNPM_VERSION=11.25.0

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

# 分步日志：APK 的安装日志框只追加新行，用步骤头能把「慢」和「卡死」区分开。
START_TIME=$(date +%s)
STEP=0
stage() {
  STEP=$((STEP + 1))
  printf '\n== [步骤 %s] %s（已用 %ss）==\n' "${STEP}" "$*" "$(( $(date +%s) - START_TIME ))"
}
info() { printf '   %s\n' "$*"; }

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
# 依赖缓存放在 DSH_ROOT 下长期复用：更新时 pnpm 直接从本地 store 链接，
# 不再把 287 个包重新下载一遍。内置包只负责首装，它的 store/cache 会在
# 安装成功后转存到这里（见文件末尾）。
STORE_DIR="${DSH_TAVERN_PNPM_STORE_DIR:-${DSH_ROOT}/runtime/tavern-pnpm-store}"
CACHE_DIR="${DSH_TAVERN_PNPM_CACHE_DIR:-${DSH_ROOT}/runtime/tavern-pnpm-cache}"
# APK 首装会先把内置依赖包解到 DSH_TAVERN_OFFLINE_DIR（源码 + pnpm store + pnpm 运行时）。
OFFLINE_DIR="${DSH_TAVERN_OFFLINE_DIR:-}"
if [ -n "${OFFLINE_DIR}" ] && [ -d "${OFFLINE_DIR}/store" ]; then
  export DSH_TAVERN_PNPM_STORE="${OFFLINE_DIR}/store"
  # store 只存包内容，离线解析还需要 pnpm 的 metadata 缓存；随包带上，
  # 并让所有 pnpm（含 Profile 安装）优先用缓存，避免再等 registry 元数据。
  if [ -d "${OFFLINE_DIR}/cache" ]; then
    export pnpm_config_cache_dir="${OFFLINE_DIR}/cache"
    export pnpm_config_prefer_offline=true
  fi
  # 构建时用的 registry 决定 metadata 的缓存键；用户显式指定镜像时不覆盖。
  if [ -f "${OFFLINE_DIR}/registry" ] && [ -z "${DSH_TAVERN_NPM_REGISTRY:-}" ]; then
    export npm_config_registry="$(cat "${OFFLINE_DIR}/registry")"
    export pnpm_config_registry="$npm_config_registry"
  fi
  info "使用内置依赖包：${DSH_TAVERN_PNPM_STORE}（$(du -sh "${DSH_TAVERN_PNPM_STORE}" 2>/dev/null | cut -f1)）"
else
  OFFLINE_DIR=""
  export DSH_TAVERN_PNPM_STORE="${DSH_TAVERN_PNPM_STORE:-${STORE_DIR}}"
  export pnpm_config_cache_dir="${pnpm_config_cache_dir:-${CACHE_DIR}}"
  if [ -d "${pnpm_config_cache_dir}" ]; then
    export pnpm_config_prefer_offline=true
  fi
  if [ -d "${DSH_TAVERN_PNPM_STORE}" ]; then
    info "复用本地依赖缓存：${DSH_TAVERN_PNPM_STORE}（$(du -sh "${DSH_TAVERN_PNPM_STORE}" 2>/dev/null | cut -f1)）"
  else
    info "首次联网安装依赖；安装后缓存保存在 ${DSH_TAVERN_PNPM_STORE}，以后更新不再重下。"
  fi
fi
# Keep Tavern's package manager independent of DSHA's bundled pnpm and PATH.
PNPM_ROOT="${DSH_ROOT}/runtime/tavern-pnpm/${PNPM_VERSION}"
PNPM_COMMAND="${PNPM_ROOT}/bin/pnpm"
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
if [ "${INSTALLED_PNPM_VERSION}" != "${PNPM_VERSION}" ]; then
  if [ -n "${OFFLINE_DIR}" ] && [ -x "${OFFLINE_DIR}/pnpm-runtime/bin/pnpm" ]; then
    stage "安装 Tavern 专用 pnpm ${PNPM_VERSION}（来自内置包，免联网）"
    mkdir -p "$(dirname -- "${PNPM_ROOT}")"
    rm -rf -- "${PNPM_ROOT}.copying" 2>/dev/null || true
    cp -R "${OFFLINE_DIR}/pnpm-runtime" "${PNPM_ROOT}.copying" || fail "复制内置 pnpm 运行时失败。"
    rm -rf -- "${PNPM_ROOT}" 2>/dev/null || true
    mv -- "${PNPM_ROOT}.copying" "${PNPM_ROOT}"
    info "pnpm 运行时已就位：${PNPM_ROOT}"
  else
    require_command npm
    stage "安装 Tavern 专用 pnpm ${PNPM_VERSION}（联网）"
    # Restored backups can contain ordinary bin files without node_modules.
    # Build and verify a fresh prefix before replacing the version-owned runtime.
    (
      mkdir -p "$(dirname -- "${PNPM_ROOT}")"
      pnpm_stage=$(mktemp -d "${PNPM_ROOT}.install.XXXXXX")
      pnpm_backup="${pnpm_stage}.previous"
      pnpm_committed=0
      cleanup_pnpm_install() {
        rm -rf -- "${pnpm_stage}"
        if [ -e "${pnpm_backup}" ] || [ -L "${pnpm_backup}" ]; then
          if [ "${pnpm_committed}" = 1 ]; then
            rm -rf -- "${pnpm_backup}"
          elif [ ! -e "${PNPM_ROOT}" ] && [ ! -L "${PNPM_ROOT}" ]; then
            mv -- "${pnpm_backup}" "${PNPM_ROOT}"
          fi
        fi
      }
      trap cleanup_pnpm_install EXIT
      npm install --global --prefix "${pnpm_stage}" "pnpm@${PNPM_VERSION}"
      staged_version=$("${pnpm_stage}/bin/pnpm" --version 2>/dev/null || :)
      [ "${staged_version}" = "${PNPM_VERSION}" ] || fail "新 pnpm 安装后校验失败，原目录未修改。"
      if [ -e "${PNPM_ROOT}" ] || [ -L "${PNPM_ROOT}" ]; then
        mv -- "${PNPM_ROOT}" "${pnpm_backup}"
      fi
      mv -- "${pnpm_stage}" "${PNPM_ROOT}"
      pnpm_committed=1
    )
  fi
fi
INSTALLED_PNPM_VERSION=$("${PNPM_COMMAND}" --version 2>/dev/null || :)
[ "${INSTALLED_PNPM_VERSION}" = "${PNPM_VERSION}" ] || fail "Tavern 专用 pnpm ${PNPM_VERSION} 安装后校验失败（当前：${INSTALLED_PNPM_VERSION:-不可用}）。"
# Node/DSH child processes also invoke pnpm by name. Scope their resolution and
# version-check policy to this installer; do not alter the user's system PATH.
export PATH="${PNPM_ROOT}/bin:${PATH}"
export pnpm_config_update_notifier=false
# All dependency and Profile installs below use this exact executable.
# pnpm 的 config 子命令不接受 --store-dir；把 store 写进环境变量，所有 install
# 和它们派生的 pnpm 都会使用内置 store，也不会污染 `pnpm config set` 的参数。
if [ -n "${DSH_TAVERN_PNPM_STORE:-}" ]; then
  export pnpm_config_store_dir="${DSH_TAVERN_PNPM_STORE}"
fi
# 进度逐行追加：APK 日志框只追加新行，pnpm 默认的回车原地刷新在那里看起来像卡死。
# 用配置项而不是命令行参数，避免污染包装函数传参顺序。
export pnpm_config_reporter=append-only
# 慢速移动网络保留 10 分钟超时，也允许调用方覆盖。pnpm 11 会把环境变量
# 转为数字；--config.fetchTimeout 会保留字符串，传给 AbortSignal.timeout 后报错。
# 导出后，配置阶段派生的 pnpm 也使用同一设置，不污染 config 子命令的参数。
export pnpm_config_fetch_timeout="${pnpm_config_fetch_timeout:-600000}"
pnpm() {
  "${PNPM_COMMAND}" --config.update-notifier=false "$@"
}
# 缓存命中时先跑一遍（秒级完成）；缺什么补什么，而不是直接放弃。
# 这里不能再传 --offline：pnpm 11 在 “Verifying lockfile against supply-chain
# policies” 阶段要读每个包的 metadata，缓存里少一条（例如 undici.jsonl）就会在
# 把 287 个包全部从 store 复制完之后整轮失败，然后联网把同样 287 个包再复制一遍，
# 日志里就是同一串 “Progress: … reused 286, downloaded 0, added …” 来回重复。
# --prefer-offline 命中缓存就走本地，缺 metadata 时只补缺的部分，不会白跑一轮。
pnpm_install() {
  if [ -n "${DSH_TAVERN_PNPM_STORE:-}" ]; then
    if pnpm "$@" --prefer-offline; then return 0; fi
    info '缓存优先安装未完成，改为联网补齐（只下载缺失项）……'
  fi
  if pnpm "$@"; then return 0; fi
  # 镜像缺包时（例如新版本 lockfile 里的 undici 在 npmmirror 上 metadata 没同步，
  # 报 ERR_PNPM_NO_OFFLINE_META 或 404）整轮更新就白跑；换官方源再试一次。
  # 用户显式指定过 DSH_TAVERN_NPM_REGISTRY 时不动他的选择。
  if [ -n "${DSH_TAVERN_NPM_REGISTRY:-}" ]; then return 1; fi
  info '当前镜像安装失败，改用官方源 registry.npmjs.org 重试一次……'
  pnpm "$@" --registry=https://registry.npmjs.org
}
# Android 的 proot 会把硬链接模拟成符号链接，pnpm 默认导入方式可能因此
# 生成无法进行相对 require 的包目录。DSHA 中的所有后续安装也必须沿用复制模式。
pnpm config set package-import-method copy --location=user
pnpm config set side-effects-cache false --location=user

run_dsh() {
  node --expose-internals "$(command -v dsh)" "$@"
}
[ -f "${REPO_ROOT}/package.json" ] || fail "脚本必须位于完整的 dsh-tavern 仓库中。"
[ -f "${SCRIPT_DIR}/dsh-tavern-entry/package.json" ] || fail "缺少 dsh-tavern-entry。"

WEB_PROFILE_NAME="$(find_web_profile)"
WEB_PROFILE_DIR="${DSH_ROOT}/profiles/${WEB_PROFILE_NAME}"

# 旧版 setup.sh 是整目录替换：它把旧源码留在 apps/.dsh-tavern-download.*/previous-source，
# 新版安装器在它被清理前把 node_modules 接回来，这次更新就不必再重装一遍依赖。
if [ ! -e "${REPO_ROOT}/node_modules" ]; then
  for previous in "${DSH_ROOT}/apps"/.dsh-tavern-download.*/previous-source; do
    [ -d "${previous}/node_modules" ] || continue
    if cmp -s "${previous}/pnpm-lock.yaml" "${REPO_ROOT}/pnpm-lock.yaml" 2>/dev/null; then
      mv -- "${previous}/node_modules" "${REPO_ROOT}/node_modules" 2>/dev/null \
        && info '复用更新前的依赖目录（lockfile 未变），跳过重新安装'
      break
    fi
  done
fi

# 更新而不是重装：lockfile 没变、node_modules 与它一致时 pnpm 只会做一次空校验，
# 直接跳过；桌面版更新也是这个行为。只有依赖真的变化（或首次安装）才装。
DEPS_CHECKED_BY_TREE=0
deps_up_to_date() {
  if [ -f "${REPO_ROOT}/node_modules/.pnpm/lock.yaml" ]; then
    cmp -s "${REPO_ROOT}/node_modules/.pnpm/lock.yaml" "${REPO_ROOT}/pnpm-lock.yaml" && return 0
    return 1
  fi
  # 这份记录会被复制或中断的安装弄丢，旧版安装器也从没写过它（node_modules 完整却
  # 每次重装 287 个包就卡在这里）。缺了不整批重装，改为按 lockfile 逐项核对
  # node_modules 是否真的装到位：装全了跳过，少包或版本不符才装。
  [ -d "${REPO_ROOT}/node_modules" ] || return 1
  [ -f "${REPO_ROOT}/bin/dependency-tree-check.mjs" ] || return 1
  node "${REPO_ROOT}/bin/dependency-tree-check.mjs" "${REPO_ROOT}" >/dev/null 2>&1 || return 1
  DEPS_CHECKED_BY_TREE=1
  return 0
}
if [ "${DSH_TAVERN_FORCE_DEPENDENCIES:-0}" != 1 ] && deps_up_to_date; then
  stage "检查酒馆核心依赖"
  if [ "${DEPS_CHECKED_BY_TREE}" = 1 ]; then
    info 'node_modules/.pnpm/lock.yaml 缺失，已按 pnpm-lock.yaml 逐项核对：依赖齐全，跳过安装'
  else
    info '依赖未变化（lockfile 未变），跳过安装'
  fi
else
  stage "安装酒馆核心依赖（287 包；本地依赖缓存命中时通常 10-60s，需要联网补齐则取决于网速）"
  info "依赖目录：${REPO_ROOT}/node_modules"
  # 桌面端两条安装器都带 --config.minimum-release-age=0；安卓这边缺了它，pnpm 11
  # 就会跑 “Verifying lockfile against supply-chain policies”，逐包去registry 要
  # metadata——store 里明明有包（复用 286、下载 0），却会因为新包 undici 的 metadata
  # 没缓存而整轮失败，日志就停在同一串计数上。
  pnpm_install --dir "${REPO_ROOT}" install --frozen-lockfile --config.minimum-release-age=0
  info "核心依赖完成，node_modules：$(du -sh "${REPO_ROOT}/node_modules" 2>/dev/null | cut -f1)"
fi

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" != 1 ] && [ -f "${TAVERN_PROFILE_DIR}/package.json" ]; then
  stage "停止旧版酒馆服务"
  DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
    node "${REPO_ROOT}/bin/dsh-tavern.mjs" stop
fi

stage "写入 tavern Profile 配置"
# CI lets pnpm rebuild Profile modules without a TTY if the store moved.
# The nested Profile install already passes --no-frozen-lockfile.
CI=true DSH_HOME="${DSH_ROOT}" node "${REPO_ROOT}/bin/dsh-tavern.mjs" install --host android

stage "把安卓插件加入 tavern 与 ${WEB_PROFILE_NAME} Profile"
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"

stage "安装 Profile 依赖（tavern / ${WEB_PROFILE_NAME}）"
# configure-profiles can add links after the previous lockfile was written.
info "tavern：${TAVERN_PROFILE_DIR}"
CI=true pnpm_install --dir "${TAVERN_PROFILE_DIR}" install --no-frozen-lockfile
info "tavern Profile 完成"
info "${WEB_PROFILE_NAME}：${WEB_PROFILE_DIR}"
CI=true pnpm_install --dir "${WEB_PROFILE_DIR}" install --no-frozen-lockfile
info "${WEB_PROFILE_NAME} Profile 完成"
# pnpm 处理 link: 依赖时可能重新生成绝对链接。最后再规范化一次，确保
# DSHA 从 Android 宿主 rootfs 检查 bundle 时也能解析酒馆入口。
node "${SCRIPT_DIR}/configure-profiles.mjs" "${REPO_ROOT}" "${TAVERN_PROFILE_DIR}" "${WEB_PROFILE_DIR}"
stage "校验 Profile 配置与运行时依赖"
run_dsh --profile tavern --dump-config >/dev/null
info 'tavern Profile 配置可解析'
run_dsh --profile "${WEB_PROFILE_NAME}" --dump-config >/dev/null
info "${WEB_PROFILE_NAME} Profile 配置可解析"
# --dump-config never imports the plugin. Fail (and let setup.sh roll back) when the
# Profile installs above left the plugin without one of its runtime packages.
node "${REPO_ROOT}/bin/runtime-dependencies.mjs" "${REPO_ROOT}"
info '运行时依赖完整'

# 首装的内置 store/cache 转存到持久目录：下次更新（源码会整体换掉）直接复用，
# 不必再联网下载依赖。只在安装成功后移动，失败重试仍能用到完整的内置包。
if [ -n "${OFFLINE_DIR}" ]; then
  if [ -d "${OFFLINE_DIR}/store" ] && [ ! -e "${STORE_DIR}" ]; then
    mkdir -p "$(dirname -- "${STORE_DIR}")"
    if mv -- "${OFFLINE_DIR}/store" "${STORE_DIR}" 2>/dev/null; then
      info "依赖缓存已保存：${STORE_DIR}（下次更新直接复用）"
    fi
  fi
  if [ -d "${OFFLINE_DIR}/cache" ] && [ ! -e "${CACHE_DIR}" ]; then
    mkdir -p "$(dirname -- "${CACHE_DIR}")"
    mv -- "${OFFLINE_DIR}/cache" "${CACHE_DIR}" 2>/dev/null || true
  fi
fi

if [ "${DSH_TAVERN_ANDROID_STANDALONE:-0}" = 1 ]; then
  printf '\n安装完成（总耗时 %ss）。请返回 DSH Tavern 应用并重新启动酒馆。\n' "$(( $(date +%s) - START_TIME ))"
  exit 0
fi

stage "启动 3088 酒馆服务"
DSH_HOME="${DSH_ROOT}" DSH_TAVERN_PORT="${TAVERN_PORT}" \
  DSH_TAVERN_RUNTIME_HOST="android" \
  node "${REPO_ROOT}/bin/dsh-tavern.mjs" start

probe_port "${TAVERN_PORT}" || fail "3088 端口未能启动，请查看 ${DSH_ROOT}/logs/tavern.log。"

printf '\n安装完成（总耗时 %ss）。\n' "$(( $(date +%s) - START_TIME ))"
printf '酒馆地址：http://127.0.0.1:%s\n' "${TAVERN_PORT}"
if probe_port 3080; then
  printf 'DSHA Web：http://127.0.0.1:3080（当前可访问）\n'
else
  printf '提示：3080 当前未监听；重启 DSHA 后再检查。\n'
fi
printf '请重启一次 DSHA，使自动拉起和移动端界面正式加载。\n'
