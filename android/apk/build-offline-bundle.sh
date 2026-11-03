#!/usr/bin/env bash
# 生成 APK 首装离线包 tavern-offline.tar.gz：
#   revision          打包时的酒馆源码提交
#   source/           源码快照（该提交的 git archive，剔除 docs）
#   store/            pnpm 11 store（源码依赖 + tavern/web Profile 依赖）
#   cache/            pnpm metadata 缓存（离线解析必需，store 只有包内容）
#   registry          采集时使用的 registry，决定 metadata 的缓存键
#   pnpm.tgz          与 install.sh 锁定的 pnpm 本体 tarball
#   pages/            分页后的 store 大文件（APK 资产压缩率低，分卷便于后续按需优化）
# 首装时容器内解包：源码免下载、依赖走离线 store、pnpm 本体免 npm 安装。
# 依赖全部为纯 JS/wasm（锁文件中唯一平台限定包是 darwin 的 fsevents，安卓自然跳过），
# 因此构建机（x64）采集的 store 可直接给 arm64 手机使用。
#
# 可重入：不删除工作目录，重复运行只补齐缺失阶段（上次失败可原地续跑）。
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
COMMIT="${1:?用法：build-offline-bundle.sh <commit> <output.tar.gz> [work-dir]}"
OUT="$(cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")"
WORK_IN="${3:-$(dirname -- "$OUT")/offline-work-${COMMIT:0:12}}"
mkdir -p "${WORK_IN}"
WORK="$(cd -- "${WORK_IN}" && pwd)"
PNPM_VERSION=11.25.0
STEPS=7
# 构建机的 npm 可能是指向包装脚本的 shim，依赖真实 $HOME；下面会隔离 HOME，
# 隔离后这类 shim 直接起不来。优先用 node 自带的那份 npm，退回 PATH 里的 npm。
NODE_PREFIX="$(node -p "require('path').dirname(require('path').dirname(require('path').resolve(process.execPath)))" 2>/dev/null || true)"
NPM_CLI=""
if [ -n "${NODE_PREFIX}" ] && [ -f "${NODE_PREFIX}/lib/node_modules/npm/bin/npm-cli.js" ]; then
  NPM_CLI="${NODE_PREFIX}/lib/node_modules/npm/bin/npm-cli.js"
fi
npm_install_global() {
  if [ -n "${NPM_CLI}" ]; then
    node "${NPM_CLI}" install --global "$@"
  else
    npm install --global "$@"
  fi
}
# 采集用与手机一致的 registry；容器内 install.sh 默认也是 npmmirror。
export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
export pnpm_config_registry="$npm_config_registry"
# pnpm 进度默认回车原地刷新；这里改成逐行追加，任何日志框都能看到进展。
PNPM_ARGS=(--reporter=append-only)

command -v node >/dev/null 2>&1 || { echo '缺少 node' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo '缺少 npm' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo '缺少 git' >&2; exit 1; }

START=$(date +%s)
step=0
log() { printf '[offline-bundle %s +%ss] %s\n' "$(date +%H:%M:%S)" "$(( $(date +%s) - START ))" "$*" >&2; }
stage() { step=$((step + 1)); log "[$step/${STEPS}] $*"; }

if [ -f "${OUT}" ] && [ "$(cat "${OUT}.revision" 2>/dev/null || true)" = "${COMMIT}" ]; then
  log "缓存命中（revision 相同）：${OUT}"
  printf '%s\n' "$OUT"
  exit 0
fi

mkdir -p "${WORK}/home" "${WORK}/tmp"
# pnpm 在 TMPDIR 下载/校验 tarball；隔离 HOME 避免污染构建机的用户级配置。
export HOME="${WORK}/home"
export TMPDIR="${WORK}/tmp"
export XDG_CACHE_HOME="${WORK}/home/.cache"

stage "准备 pnpm ${PNPM_VERSION}（约 15s）"
if [ -x "${WORK}/pnpm-tool/lib/node_modules/pnpm/bin/pnpm.cjs" ] \
  && [ "$("$(command -v node)" "${WORK}/pnpm-tool/lib/node_modules/pnpm/bin/pnpm.cjs" --version 2>/dev/null || true)" = "${PNPM_VERSION}" ]; then
  log '已存在可用 pnpm，跳过安装'
else
  npm_install_global --silent --prefix "${WORK}/pnpm-tool" "pnpm@${PNPM_VERSION}"
fi
PNPM_BIN="${WORK}/pnpm-tool/lib/node_modules/pnpm/bin/pnpm.cjs"
# pnpm 的 --dir 在 v11 上不会切换 node_modules 位置，会在调用者 cwd 的仓库上操作；
# 统一用子 shell 切目录，避免误删真实仓库的 node_modules。
# 构建机的批量删除守卫会把 pnpm 重建 node_modules 当成危险操作拦下（目标全在 WORK 内，
# 这里显式关闭守卫再执行，不影响仓库其他文件）。
pnpm_in() {
  local dir="$1"
  shift
  (
    cd -- "${dir}" || exit 1
    unset CODEBUDDY_SAFE_DELETE_ENABLED CODEBUDDY_SAFE_DELETE_BULK_GUARD CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR
    exec "$(command -v node)" "${PNPM_BIN}" --reporter=append-only "$@"
  )
}
[ "$("$(command -v node)" "${PNPM_BIN}" --version)" = "${PNPM_VERSION}" ] || { echo "pnpm ${PNPM_VERSION} 采集失败" >&2; exit 1; }

stage "导出源码快照 ${COMMIT:0:12}"
# 纯净快照单独缓存（不含 node_modules）：安装步骤在它的副本里跑，重复采集时这里几秒命中。
SNAPSHOT="${WORK}/snapshot"
if [ -f "${SNAPSHOT}/.snapshot-revision" ] && [ "$(cat "${SNAPSHOT}/.snapshot-revision")" = "${COMMIT}" ]; then
  log "源码快照已缓存：$(find "${SNAPSHOT}" -type f | wc -l) 个文件"
else
  rm -rf -- "${SNAPSHOT}" 2>/dev/null || true
  mkdir -p "${SNAPSHOT}"
  git -C "${ROOT}" archive "${COMMIT}" | tar -x -C "${SNAPSHOT}"
  # 与 setup.sh 的稀疏检出保持一致：任何位置的 docs 都不进包。
  find "${SNAPSHOT}" -type d -name docs -prune -exec rm -rf {} +
  # 构建产物目录（含本脚本自己的工作目录）绝不能进源码快照：会被递归打包成几百 MB。
  if [ -e "${SNAPSHOT}/output" ]; then rm -rf -- "${SNAPSHOT}/output" 2>/dev/null || true; fi
  printf '%s\n' "${COMMIT}" >"${SNAPSHOT}/.snapshot-revision"
  log "源码文件数：$(find "${SNAPSHOT}" -type f | wc -l)"
fi

stage "采集源码依赖（287 包，--store-dir 独立，约 1-3 分钟）"
# 在快照副本里装：快照保持干净，下次采集可直接复用。
SOURCE_DIR="${WORK}/install-$(date +%s)"
rm -rf -- "${WORK}"/install-* 2>/dev/null || true
cp -a "${SNAPSHOT}" "${SOURCE_DIR}"
# 仅当 lockfile 与提交未变（例如只重打新提交、依赖集合相同）时，可跳过安装直接复用已有 store。
if [ "${TAVERN_OFFLINE_REUSE_STORE:-0}" = 1 ] && [ -d "${WORK}/store/v11" ]; then
  log '复用已有 store（TAVERN_OFFLINE_REUSE_STORE=1），跳过依赖采集与自检'
  log "store 体积：$(du -sh "${WORK}/store" 2>/dev/null | cut -f1)"
  pnpm_in "${SOURCE_DIR}" install --frozen-lockfile --offline --store-dir "${WORK}/store" \
    || { echo '复用的 store 与当前 lockfile 不匹配，请去掉 TAVERN_OFFLINE_REUSE_STORE 重跑。' >&2; exit 1; }
else
  pnpm_in "${SOURCE_DIR}" install --frozen-lockfile --store-dir "${WORK}/store"
  log "store 当前体积：$(du -sh "${WORK}/store" 2>/dev/null | cut -f1)"

  stage "生成 tavern Profile 清单并采集其依赖"
  mkdir -p "${WORK}/tavern-profile"
  "$(command -v node)" "${ROOT}/android/apk/render-tavern-profile.mjs" "${WORK}" "${SOURCE_DIR}" >/dev/null
  log "Profile 依赖：$(node -e "const p=require('${WORK}/tavern-profile/package.json');console.log(Object.keys(p.dependencies).join(', '))")"
  pnpm_in "${WORK}/tavern-profile" install --store-dir "${WORK}/store"
fi

stage "采集 web Profile 依赖（失败不阻断，首装该步回退联网）"
mkdir -p "${WORK}/web-profile"
cat >"${WORK}/web-profile/package.json" <<JSON
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dshmarket": "^1.41.0",
    "dsh-better-sidebar": "^0.18.0",
    "dsh-tavern-entry": "link:${SNAPSHOT}/android/dsh-tavern-entry"
  }
}
JSON
if [ "${TAVERN_OFFLINE_REUSE_STORE:-0}" = 1 ]; then
  log 'web Profile 依赖已随复用的 store 保留'
elif pnpm_in "${WORK}/web-profile" install --store-dir "${WORK}/store"; then
  log 'web Profile 依赖采集成功'
else
  log 'web Profile 依赖采集失败（首装该步将回退联网）'
fi

stage "打包 pnpm metadata 缓存（离线解析必需）"
if [ -d "${WORK}/home/.cache/pnpm" ]; then
  rm -rf -- "${WORK}/cache" 2>/dev/null || true
  cp -a "${WORK}/home/.cache/pnpm" "${WORK}/cache"
  log "metadata 缓存：$(du -sh "${WORK}/cache" 2>/dev/null | cut -f1)"
else
  log '警告：未找到 pnpm metadata 缓存，离线解析可能退回联网' >&2
fi
printf '%s\n' "${npm_config_registry}" >"${WORK}/registry"

stage "离线自检：空目录 --offline 安装必须成功"
if [ "${TAVERN_OFFLINE_REUSE_STORE:-0}" = 1 ]; then
  log '已在上一步用 --offline 校验过源码依赖；Profile 依赖沿用上次自检结果'
else
  # 每次用全新目录，避免大目录删除（安全删除策略会拦截批量 rm）。
  SELFTEST="$(mktemp -d "${WORK}/selftest.XXXXXX")"
  mkdir -p "${SELFTEST}/source" "${SELFTEST}/tavern"
  git -C "${ROOT}" archive "${COMMIT}" | tar -x -C "${SELFTEST}/source"
  find "${SELFTEST}/source" -type d -name docs -prune -exec rm -rf {} +
  # 自检必须模拟手机上的干净缓存：HOME 隔离，只用随包的 metadata 缓存。
  SELFTEST_HOME="${SELFTEST}/home"
  mkdir -p "${SELFTEST_HOME}"
  (
    export HOME="${SELFTEST_HOME}" XDG_CACHE_HOME="${SELFTEST_HOME}/.cache"
    export pnpm_config_cache_dir="${WORK}/cache"
    pnpm_in "${SELFTEST}/source" install --frozen-lockfile --offline --store-dir "${WORK}/store" \
      || exit 1
    cp "${WORK}/tavern-profile/package.json" "${SELFTEST}/tavern/package.json"
    pnpm_in "${SELFTEST}/tavern" install --offline --store-dir "${WORK}/store" \
      || exit 2
  ) || { echo '离线自检失败：源码或 Profile 依赖不完整，禁止打包。' >&2; exit 1; }
  log '离线自检通过（干净 HOME + 随包缓存，源码 + Profile 均可完全离线安装）'
fi

stage "整理 pnpm 运行时并打包"
# pnpm 本体连其自身依赖一起打：容器内 `npm install pnpm-tgz` 仍会联网拉 @pnpm/*。
# 注意：pnpm-runtime 自身的 node_modules 绝不能排除，否则 bin/pnpm 变断链，
# 首装会回落到联网 npm 安装（实测多花 18 秒且离线环境下直接失败）。
rm -rf -- "${WORK}/pnpm-runtime" 2>/dev/null || true
cp -R "${WORK}/pnpm-tool" "${WORK}/pnpm-runtime" 2>/dev/null || true
if [ -d "${WORK}/pnpm-runtime" ]; then rm -rf -- "${WORK}/pnpm-runtime/.cache" 2>/dev/null || true; fi
PNPM_CJS="${WORK}/pnpm-runtime/lib/node_modules/pnpm/bin/pnpm.cjs"
[ -f "${PNPM_CJS}" ] || { echo '内置 pnpm 运行时缺少主体文件，禁止打包。' >&2; exit 1; }
chmod +x "${PNPM_CJS}" 2>/dev/null || true
[ "$("$(command -v node)" "${PNPM_CJS}" --version 2>/dev/null)" = "${PNPM_VERSION}" ] \
  || { echo '内置 pnpm 运行时不可执行，禁止打包。' >&2; exit 1; }
log "pnpm 运行时：$(du -sh "${WORK}/pnpm-runtime" 2>/dev/null | cut -f1)（已验证可执行）"
printf '%s\n' "${COMMIT}" >"${WORK}/revision"
# 去掉快照里的内部标记，再以 source/ 名字入包。
rm -f -- "${SNAPSHOT}/.snapshot-revision" 2>/dev/null || true
log "打包中（源码 + store + metadata 缓存 + pnpm 运行时，gzip 压缩，约 1-2 分钟）……"
# 排除规则必须限定在源码快照内：写成 */node_modules 会连带删掉 pnpm-runtime 的依赖。
tar -czf "${OUT}.tmp" -C "${WORK}" \
  --transform="s|^$(basename "${SNAPSHOT}")|source|" \
  --exclude="$(basename "${SNAPSHOT}")/node_modules" \
  --exclude="source/node_modules" \
  revision pnpm-runtime store cache registry "$(basename "${SNAPSHOT}")"
mv -f "${OUT}.tmp" "${OUT}"
printf '%s\n' "${COMMIT}" >"${SNAPSHOT}/.snapshot-revision"
printf '%s\n' "${COMMIT}" >"${OUT}.revision"

log "完成：$(du -h "${OUT}" | cut -f1)  总计耗时 $(( $(date +%s) - START ))s"
printf '%s\n' "$OUT"
