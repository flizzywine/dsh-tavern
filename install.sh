#!/bin/sh

set -eu

INSTALL_HOST=${DSH_TAVERN_HOST:-cli}
case ${INSTALL_HOST} in
  cli|desktop) ;;
  *) echo "安装失败：不支持的安装宿主 ${INSTALL_HOST}" >&2; exit 1 ;;
esac

REPOSITORY=${DSH_TAVERN_REPOSITORY:-flizzywine/dsh-tavern}
REPOSITORY_URL=${DSH_TAVERN_GIT_URL:-https://github.com/${REPOSITORY}.git}
ARCHIVE_URL=${DSH_TAVERN_ARCHIVE_URL:-https://codeload.github.com/${REPOSITORY}/tar.gz/refs/heads/main}
COMMIT_URL=${DSH_TAVERN_COMMIT_URL:-https://api.github.com/repos/${REPOSITORY}/commits/main}
CDN_METADATA_URL=${DSH_TAVERN_CDN_METADATA_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}@main/dsh-tavern-runtime.json}
CDN_ROOT_URL=${DSH_TAVERN_CDN_ROOT_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}}
DSH_ROOT=${DSH_HOME:-${HOME}/.dsh}
APP_DIR=${DSH_TAVERN_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}
RUNTIME_ROOT=${DSH_ROOT}/runtime
RUNTIME_BIN=${RUNTIME_ROOT}/bin
COMMAND_BIN=${HOME}/.local/bin
SOURCE_CACHE=${DSH_ROOT}/source-cache/dsh-tavern.git
RUNTIME_PATHS='package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml install.ps1 install.sh bin config presets tavern-plugin'
TMP_BASE=${TMPDIR:-/tmp}
TMP_BASE=${TMP_BASE%/}
TEMP_DIR=$(mktemp -d "${TMP_BASE}/dsh-tavern-install.XXXXXX")
TARGET_COMMIT=${DSH_TAVERN_TARGET_COMMIT:-}

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

if [ "${INSTALL_HOST}" = "cli" ] && ! command -v npm >/dev/null 2>&1; then
  fail "未找到 npm，请重新安装 Node.js。"
fi

# UI updates start in a fresh process that may not inherit the install-time PATH.
# Reuse pnpm and DSH from Tavern's managed runtime before treating them as missing.
PATH=${RUNTIME_BIN}:${PATH}
export PATH

if [ "${INSTALL_HOST}" = "cli" ]; then
  DSH_TAVERN_BIN_DIR=${COMMAND_BIN}
  export DSH_TAVERN_BIN_DIR
fi

command -v tar >/dev/null 2>&1 || fail "未找到 tar。"

echo "正在增量同步 DSH Tavern……"
USED_GIT=0
USED_CDN=0
if command -v git >/dev/null 2>&1; then
  echo "正在通过 Git 增量同步（不下载文档与图片）……"
  mkdir -p "$(dirname -- "${SOURCE_CACHE}")"
  if { [ -f "${SOURCE_CACHE}/HEAD" ] || git clone --bare --filter=blob:none --depth 1 --single-branch --branch main "${REPOSITORY_URL}" "${SOURCE_CACHE}"; } \
    && git --git-dir="${SOURCE_CACHE}" remote set-url origin "${REPOSITORY_URL}" \
    && git --git-dir="${SOURCE_CACHE}" fetch --depth 1 origin main \
    && TARGET_COMMIT=$(git --git-dir="${SOURCE_CACHE}" rev-parse FETCH_HEAD) \
    && git --git-dir="${SOURCE_CACHE}" archive --format=tar --output="${TEMP_DIR}/app.tar" FETCH_HEAD -- ${RUNTIME_PATHS}; then
    USED_GIT=1
  else
    echo "Git 增量更新不可用，将回退到完整 ZIP。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ]; then
  echo "GitHub 直连不可用，正在通过 jsDelivr 备用源下载运行代码……"
  mkdir -p "${TEMP_DIR}/cdn-source"
  if CDN_METADATA_URL="${CDN_METADATA_URL}" CDN_ROOT_URL="${CDN_ROOT_URL}" CDN_SOURCE="${TEMP_DIR}/cdn-source" node <<'NODE'
const { createHash } = require('node:crypto')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const allowed = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|bin\/|config\/|presets\/|tavern-plugin\/)/
async function get(url, timeout = 30000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}
;(async () => {
  const metadata = await (await get(process.env.CDN_METADATA_URL, 15000)).json()
  if (!/^[0-9a-f]{40}$/i.test(String(metadata.revision || ''))) throw new Error('jsDelivr 运行清单缺少有效提交号')
  const files = (metadata.files || []).map((file) => ({ ...file, path: String(file.path || '').replace(/^\/+/, '') }))
    .filter((file) => allowed.test(file.path) && !file.path.split('/').includes('..') && /^[0-9a-f]{64}$/i.test(String(file.sha256 || '')))
  if (files.length === 0) throw new Error('jsDelivr 未返回运行文件清单')
  for (const file of files) {
    const bytes = Buffer.from(await (await get(`${process.env.CDN_ROOT_URL}@${metadata.revision}/${file.path}`)).arrayBuffer())
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== String(file.sha256).toLowerCase()) throw new Error(`jsDelivr 文件校验失败：${file.path}`)
    const target = path.join(process.env.CDN_SOURCE, ...file.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await writeFile(path.join(process.env.CDN_SOURCE, '.revision'), metadata.revision)
})().catch((error) => { console.error(error.message); process.exit(1) })
NODE
  then
    USED_CDN=1
    TARGET_COMMIT=$(cat "${TEMP_DIR}/cdn-source/.revision")
    rm -f -- "${TEMP_DIR}/cdn-source/.revision"
  else
    echo "jsDelivr 备用源不可用，将回退到完整 ZIP。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ] && [ "${USED_CDN}" -eq 0 ]; then
  command -v curl >/dev/null 2>&1 || fail "Git 不可用且未找到 curl，无法下载完整 ZIP。"
  echo "正在下载完整 ZIP……"
  if [ -z "${TARGET_COMMIT}" ]; then
    TARGET_COMMIT=$(curl -fsSL --connect-timeout 10 "${COMMIT_URL}" | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n 1 || true)
  fi
  curl -fL --retry 3 --connect-timeout 15 "${ARCHIVE_URL}" -o "${TEMP_DIR}/app.tar.gz"
fi
mkdir -p "${TEMP_DIR}/extract"
if [ "${USED_CDN}" -eq 1 ]; then
  SOURCE_DIR=${TEMP_DIR}/cdn-source
elif [ "${USED_GIT}" -eq 1 ]; then
  tar -xf "${TEMP_DIR}/app.tar" -C "${TEMP_DIR}/extract"
  SOURCE_DIR=${TEMP_DIR}/extract
else
  tar -xzf "${TEMP_DIR}/app.tar.gz" -C "${TEMP_DIR}/extract"
  SOURCE_DIR=$(find "${TEMP_DIR}/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
fi
[ -n "${SOURCE_DIR}" ] || fail "下载内容不完整。"
[ -f "${SOURCE_DIR}/package.json" ] || fail "下载内容不完整。"

# Read the downloaded release's version, not the bootstrap script's or npm's latest.
ADAPTED_DSH_VERSION=$(node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --version)
node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --notice
if [ "${INSTALL_HOST}" = "cli" ]; then
  set --
  if ! command -v pnpm >/dev/null 2>&1; then set -- "$@" pnpm; fi
  if ! command -v dsh >/dev/null 2>&1; then
    set -- "$@" "@deepseek-ai/dsh@${ADAPTED_DSH_VERSION}"
  fi
  if [ "$#" -gt 0 ]; then
    echo "正在安装缺失依赖：$*……"
    mkdir -p "${RUNTIME_ROOT}"
    npm install --global --prefix "${RUNTIME_ROOT}" "$@"
  fi
fi
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。"
command -v dsh >/dev/null 2>&1 || fail "未找到 DSH。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。"

if [ "${INSTALL_HOST}" = "cli" ] && [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
  DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
fi

mkdir -p "${APP_DIR}"
# 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data/ 用户数据会保留。
cp -R "${SOURCE_DIR}/." "${APP_DIR}/"
if [ "${USED_CDN}" -eq 1 ]; then rm -f -- "${APP_DIR}/.dsh-tavern-release.json"; fi
case ${TARGET_COMMIT} in
  *[!0-9a-fA-F]*|'') ;;
  ????????????????????????????????????????)
    printf '{"commit":"%s","installedAt":"%s"}\n' "${TARGET_COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${APP_DIR}/.dsh-tavern-release.json"
    ;;
esac

echo "正在安装程序依赖……"
pnpm --dir "${APP_DIR}" install --frozen-lockfile

echo "正在配置 Tavern……"
DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" install --host "${INSTALL_HOST}"

if [ "${INSTALL_HOST}" = "desktop" ]; then
  echo "DSH Tavern Desktop 版安装完成。"
  echo "请重启 DSH Desktop，再从托盘的 Profile 菜单切换到 tavern。"
else
  DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" start
  case ${SHELL:-} in
    */zsh) SHELL_PROFILE=${HOME}/.zprofile ;;
    *) SHELL_PROFILE=${HOME}/.profile ;;
  esac
  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
  if [ ! -f "${SHELL_PROFILE}" ] || ! grep -F "${PATH_LINE}" "${SHELL_PROFILE}" >/dev/null 2>&1; then
    printf '\n# DSH Tavern\n%s\n' "${PATH_LINE}" >>"${SHELL_PROFILE}"
  fi
  echo "DSH Tavern 安装完成。请使用上方完整访问地址，或运行 dsh-tavern open 打开网页。"
  echo "以后可以使用：dsh-tavern {start|open|stop|restart|status|update}（新终端生效）"
fi
