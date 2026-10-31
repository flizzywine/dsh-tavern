#!/bin/sh

set -eu

# Inherit the registry throughout bootstrap, Profile and plugin installation.
export npm_config_registry="${DSH_TAVERN_NPM_REGISTRY:-https://registry.npmmirror.com}"
# pnpm 11 reads pnpm_config_* instead of npm_config_*.
export pnpm_config_registry="$npm_config_registry"
# Optional pnpm version checks must not hold a completed installation open.
export pnpm_config_update_notifier=false

INSTALL_HOST=${DSH_TAVERN_HOST:-desktop}
case ${INSTALL_HOST} in
  desktop|cli) ;;
  *) echo "安装失败：只支持官方桌面和独立命令行，不支持宿主 ${INSTALL_HOST}" >&2; exit 1 ;;
esac

REPOSITORY=${DSH_TAVERN_REPOSITORY:-flizzywine/dsh-tavern}
REPOSITORY_URL=${DSH_TAVERN_GIT_URL:-https://github.com/${REPOSITORY}.git}
ARCHIVE_URL=${DSH_TAVERN_ARCHIVE_URL:-https://codeload.github.com/${REPOSITORY}/tar.gz/refs/heads/main}
COMMIT_URL=${DSH_TAVERN_COMMIT_URL:-https://api.github.com/repos/${REPOSITORY}/commits/main}
CDN_METADATA_URL=${DSH_TAVERN_CDN_METADATA_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}@main/dsh-tavern-runtime.json}
CDN_ROOT_URL=${DSH_TAVERN_CDN_ROOT_URL:-https://cdn.jsdelivr.net/gh/${REPOSITORY}}
# This installer's release (package.json, written by bin/build-installer-scripts.mjs): never install older code.
INSTALLER_VERSION='3.2.0'
LEGACY_DSH_ROOT=${DSH_TAVERN_LEGACY_DSH_HOME:-${DSH_HOME:-${HOME}/.dsh}}
DSH_ROOT=${DSH_HOME:-${HOME}/.dsh}
if [ "${INSTALL_HOST}" = "cli" ]; then
  # CLI directory selection: explicit paths and existing installations never prompt.
  DSH_ROOT=${DSH_TAVERN_CLI_HOME:-}
  if [ -z "$DSH_ROOT" ]; then
    if [ -f "$PWD/apps/dsh-tavern/.dsh-tavern-local.json" ] || [ -f "$PWD/.dsh-tavern-install-root" ]; then
      DSH_ROOT=$PWD
    elif [ -f "$HOME/.dsh-tavern/apps/dsh-tavern/.dsh-tavern-local.json" ] || [ -f "$HOME/.dsh-tavern/.dsh-tavern-install-root" ]; then
      DSH_ROOT=$HOME/.dsh-tavern
    else
      if ! ( : </dev/tty ) 2>/dev/null; then
        echo '无法交互选择安装目录。请设置 DSH_TAVERN_CLI_HOME 后重新运行。' >&2
        exit 1
      fi
      printf '\n请选择 CLI 安装目录：\n  1. 默认目录：%s/.dsh-tavern\n  2. 当前目录：%s（回车默认）\n  3. 其他目录\n程序、运行时和游戏数据存入所选目录；命令入口和包管理器缓存可能位于目录外。\n' "$HOME" "$PWD" >/dev/tty
      while :; do
        printf '请选择 [1/2/3，默认 2]：' >/dev/tty
        IFS= read -r choice </dev/tty || exit 1
        case "$choice" in
          1) DSH_ROOT=$HOME/.dsh-tavern; break ;;
          2|'') DSH_ROOT=$PWD; break ;;
          3) printf '请输入完整安装路径：' >/dev/tty
             IFS= read -r DSH_ROOT </dev/tty || exit 1
             case "$DSH_ROOT" in /*) break ;; *) echo '请输入绝对路径。' >/dev/tty ;; esac ;;
          *) echo '请输入 1、2 或 3。' >/dev/tty ;;
        esac
      done
    fi
  fi
  case "$DSH_ROOT" in /*) ;; *) DSH_ROOT=$PWD/$DSH_ROOT ;; esac
  if [ ! -f "$DSH_ROOT/apps/dsh-tavern/.dsh-tavern-local.json" ] && [ ! -f "$DSH_ROOT/.dsh-tavern-install-root" ]; then
    for entry in apps runtime tools profiles profile-data source-cache logs backups settings.yaml; do
      if [ -e "$DSH_ROOT/$entry" ] || [ -L "$DSH_ROOT/$entry" ]; then
        echo "安装目录存在冲突：${DSH_ROOT}/${entry}。请选择空目录，或使用原有安装目录。" >&2
        exit 1
      fi
    done
  fi
  printf 'CLI 安装目录：%s\n' "$DSH_ROOT"
  DSH_TAVERN_CLI_HOME=${DSH_ROOT}
  DSH_TAVERN_LEGACY_DSH_HOME=${LEGACY_DSH_ROOT}
  export DSH_TAVERN_CLI_HOME DSH_TAVERN_LEGACY_DSH_HOME
fi
DSH_HOME=${DSH_ROOT}
export DSH_HOME
APP_DIR=${DSH_TAVERN_APP_DIR:-${DSH_ROOT}/apps/dsh-tavern}
RUNTIME_ROOT=${DSH_ROOT}/tools
RUNTIME_BIN=${RUNTIME_ROOT}/bin
PNPM_VERSION=11.25.0
COMMAND_BIN=${HOME}/.local/bin
SOURCE_CACHE=${DSH_ROOT}/source-cache/dsh-tavern.git
RUNTIME_PATHS='package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml install.ps1 install.sh bin config presets patches tavern-plugin'
TMP_BASE=${TMPDIR:-/tmp}
TMP_BASE=${TMP_BASE%/}
TEMP_DIR=$(mktemp -d "${TMP_BASE}/dsh-tavern-install.XXXXXX")
TARGET_COMMIT=${DSH_TAVERN_TARGET_COMMIT:-}

INSTALL_COMPLETED=0
STAGED_INSTALL=0
APP_SWAPPED=0
PREVIOUS_APP=0
STAGER=
INSTALL_LOCK_CREATED=0
INSTALL_INTERRUPTED=0
cleanup() {
  install_exit=$1
  # Older macOS sh can report zero after a nounset error inside a conditional.
  if [ "$install_exit" -eq 0 ] && [ "${INSTALL_COMPLETED:-0}" -ne 1 ]; then install_exit=1; fi
  trap - EXIT HUP INT TERM
  if command -v update_log >/dev/null 2>&1; then update_log installer.finished bootstrap "$install_exit" '' ''; fi
  if [ "${STAGED_INSTALL:-0}" -eq 1 ] && [ "$install_exit" -ne 0 ]; then
    if [ "${APP_SWAPPED:-0}" -eq 1 ]; then
      echo "安装未完成，正在恢复原版本……" >&2
      # UI updates restart the service from the updater after this job has ended.
      if node "${STAGER}" rollback --app "${APP_DIR}" >&2 && [ "${PREVIOUS_APP:-0}" -eq 1 ] && [ "${DSH_TAVERN_DEFER_SERVICE_START:-0}" != "1" ]; then
        DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" start >&2 || echo "原版本已恢复，但服务启动失败，请运行 dsh-tavern start。" >&2
      fi
    else
      # The running app was never touched; only drop the unused staging copy.
      node "${STAGER}" discard --app "${APP_DIR}" >&2 || true
    fi
  fi
  if [ "${INSTALL_LOCK_CREATED:-0}" -eq 1 ]; then
    if [ "${INSTALL_INTERRUPTED:-0}" -eq 1 ]; then
      node "${TEMP_DIR}/installation-state.cjs" retain --home "$DSH_ROOT" --attempt "$DSH_TAVERN_INSTALL_ATTEMPT" --reason 'Bootstrap interrupted; descendant cleanup is unverified' --owner-done 1 >&2 || true
    else
      node "${TEMP_DIR}/installation-state.cjs" release --home "$DSH_ROOT" --attempt "$DSH_TAVERN_INSTALL_ATTEMPT" --generation "$INSTALL_LOCK_GENERATION" --pid "$$" >&2 || install_exit=1
    fi
  fi
  case "${TEMP_DIR}" in
    "${TMP_BASE}"/dsh-tavern-install.*) rm -rf -- "${TEMP_DIR}" ;;
  esac
  exit "$install_exit"
}
trap 'cleanup "$?"' EXIT
trap 'INSTALL_INTERRUPTED=1; cleanup 129' HUP
trap 'INSTALL_INTERRUPTED=1; cleanup 130' INT
trap 'INSTALL_INTERRUPTED=1; cleanup 143' TERM

fail() {
  echo "安装失败：$1" >&2
  exit 1
}

if [ "${INSTALL_HOST}" = "desktop" ]; then
  desktop_executable=${DSH_DESKTOP_APP_EXECUTABLE:-}
  if [ -z "$desktop_executable" ] && [ "$(uname -s)" = "Darwin" ]; then
    # Only official DeepSeek Harness is supported.
    for desktop_name in "DeepSeek Harness"; do
      for desktop_app in "/Applications/${desktop_name}.app" "$HOME/Applications/${desktop_name}.app"; do
        if [ -x "$desktop_app/Contents/MacOS/${desktop_name}" ]; then desktop_executable="$desktop_app/Contents/MacOS/${desktop_name}"; break 2; fi
      done
    done
  fi
  if ! { [ -n "$desktop_executable" ] && [ -x "$desktop_executable" ]; }; then
    # A community app installed instead of the official one gets told where its installer is.
    for community_name in "DSH NEXT" "DSH Desktop"; do
      for community_app in "/Applications/${community_name}.app" "$HOME/Applications/${community_name}.app"; do
        [ -d "$community_app" ] && fail "检测到社区版 ${community_name}，当前版本只支持官方 DeepSeek Harness（https://deepseek.com/harness/）。继续用社区版请改用稳定版的安装命令：https://github.com/flizzywine/dsh-tavern/blob/stable/README.md"
      done
    done
    fail "请先安装官方 DeepSeek Harness（https://deepseek.com/harness/）"
  fi
  cat >"${TEMP_DIR}/official-desktop-runtime.cjs" <<'DSH_OFFICIAL_DESKTOP_MODULE'
// Bootstrap for official DeepSeek Harness only. Electron reads packaged app.asar files.
const fs = require('node:fs');
const path = require('node:path');
const OFFICIAL = '@deepseek-ai/dsh-desktop';
const APP_NAMES = ['DeepSeek Harness'];
// Read archive metadata under plain Node as well, so unsupported hosts fail before mutation.
function asarRead(archive, relative, contents) {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(16);
    fs.readSync(fd, sizes, 0, 16, 0);
    const headerSize = sizes.readUInt32LE(4), jsonSize = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    let entry = JSON.parse(json.toString('utf8'));
    for (const part of relative.split(/[\\/]/).filter(Boolean)) entry = entry?.files?.[part];
    if (!entry || entry.files) return null;
    if (!contents) return '';
    if (entry.unpacked || !Number.isSafeInteger(Number(entry.offset))) return null;
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return data.toString('utf8');
  } catch { return null; } finally { fs.closeSync(fd); }
}
// Split a path at the archive that contains it; null when it is not inside one. A directory named
// *.asar is not told apart here: exists() finds its files directly, and asarRead fails on it.
// (A trailing-separator check does not work: on Windows "app.asar\\" exists for the file too.)
function inAsar(file) {
  const match = /^(.*?\.asar)[\\/](.+)$/.exec(file);
  return match ? { archive: match[1], relative: match[2] } : null;
}
// A file the runner can load: on disk, or inside app.asar (readable under Electron only).
function exists(file) {
  if (fs.existsSync(file)) return true;
  const packed = inAsar(file);
  return packed !== null && fs.existsSync(packed.archive) && asarRead(packed.archive, packed.relative, false) !== null;
}
function packageName(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name || ''; } catch {}
  try { return app.endsWith('.asar') ? String(JSON.parse(asarRead(app, 'package.json', true) || '{}').name || '') : ''; } catch { return ''; }
}
function layout(executable, platform = process.platform) {
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  const unpacked = path.join(resources, 'app'), packed = path.join(resources, 'app.asar');
  const app = fs.existsSync(path.join(unpacked, 'package.json')) ? unpacked : packed;
  const name = packageName(app);
  const host = path.join(app, 'dsh');
  return { resources, app, name, host, bootstrap: path.join(host, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), pnpm: path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
}
function prepare({ executable, home, env = process.env, platform = process.platform }) {
  if (!executable || !home) throw Error('请先安装官方 DeepSeek Harness，并指定安装目录');
  const paths = layout(executable, platform);
  if (paths.name !== OFFICIAL) throw Error('桌面版仅支持官方 DeepSeek Harness：' + executable
    + '（读到的应用包名：' + (paths.name || '无法读取') + '，应用目录：' + paths.app + '）');
  const bootstrap = paths.bootstrap;
  for (const file of [bootstrap, paths.pnpm]) if (!exists(file)) throw Error('桌面运行时不完整：' + file);
  const runner = executable;
  const dshRunner = runner, pnpmRunner = runner;
  const runnerOf = name => name === 'dsh' ? dshRunner : name === 'pnpm' ? pnpmRunner : runner;
  const variableOf = name => name === 'dsh' ? 'DSH_DESKTOP_DSH_RUNNER' : name === 'pnpm' ? 'DSH_DESKTOP_PNPM_RUNNER' : 'DSH_DESKTOP_NODE_EXECUTABLE';
  const bin = path.join(home, 'tools', 'official-desktop', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const [name, entry] of [['node', null], ['pnpm', paths.pnpm], ['dsh', bootstrap]]) {
    const file = path.join(bin, name + (platform === 'win32' ? '.cmd' : ''));
    const text = platform === 'win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%' + variableOf(name) + '%" --expose-internals ' + (entry ? '"%' + (name === 'dsh' ? 'DSH_DESKTOP_DSH_BOOTSTRAP' : 'DSH_DESKTOP_PNPM_ENTRY') + '%" ' : '') + '%*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ' + quote(runnerOf(name)) + ' --expose-internals ' + (entry ? quote(entry) + ' ' : '') + '"$@"\n';
    fs.writeFileSync(file, text, { mode: 0o755 });
  }
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  // NODE_EXECUTABLE runs installer code and `node`; PNPM_RUNNER runs pnpm; DSH_RUNNER runs the DSH entry.
  return { DSH_HOME: path.resolve(home), DSH_DESKTOP_NODE_EXECUTABLE: runner, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_DESKTOP_PNPM_RUNNER: pnpmRunner, DSH_DESKTOP_DSH_RUNNER: dshRunner, DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap, DSH_DESKTOP_PNPM_ENTRY: paths.pnpm,
    DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(paths.host, 'package.json'),
    [key]: bin + (platform === 'win32' ? ';' : ':') + (env[key] || '') };
}
function discover(env = process.env, platform = process.platform) {
  // A standalone node executable is not a desktop host.
  const node = env.DSH_DESKTOP_NODE_EXECUTABLE && !/^node(\.exe)?$/i.test(path.basename(env.DSH_DESKTOP_NODE_EXECUTABLE)) ? env.DSH_DESKTOP_NODE_EXECUTABLE : undefined;
  const candidates = [env.DSH_DESKTOP_APP_EXECUTABLE, node, process.versions.electron ? process.execPath : undefined];
  for (const app of APP_NAMES) {
    if (platform === 'darwin') candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(require('node:os').homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    if (platform === 'win32') for (const root of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]) if (root) candidates.push(path.join(root, app, app + '.exe'));
  }
  const executable = candidates.find(file => file && fs.existsSync(file));
  if (!executable) throw Error('找不到官方 DeepSeek Harness；请先安装，或用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径');
  return executable;
}
// Installer code always runs under the official app's Electron.
function runner(executable) { return executable; }
module.exports = { layout, prepare, discover, runner, APP_NAMES };
if (require.main === module) {
  try {
    const result = prepare({ executable: process.versions.electron ? process.execPath : discover(), home: process.argv[2] });
    if (process.argv.includes('--shell')) for (const [key, value] of Object.entries(result)) console.log('export ' + key + "='" + value.replaceAll("'", "'\\''") + "'");
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
DSH_OFFICIAL_DESKTOP_MODULE
  # Use the official desktop Electron runtime.
  desktop_runner=$desktop_executable
  DSH_DESKTOP_APP_EXECUTABLE="$desktop_executable" ELECTRON_RUN_AS_NODE=1 "$desktop_runner" --expose-internals "${TEMP_DIR}/official-desktop-runtime.cjs" "$DSH_ROOT" --shell >"${TEMP_DIR}/desktop-env.sh" || fail "桌面运行环境校验失败"
  . "${TEMP_DIR}/desktop-env.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js 22.19 或更高版本：https://nodejs.org/" >&2
  if command -v open >/dev/null 2>&1; then open https://nodejs.org/ >/dev/null 2>&1 || true; fi
  fail "未找到 Node.js。安装后重新运行本命令。"
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' >/dev/null 2>&1; then
  fail "Node.js 版本过低，需要 22.19 或更高版本（当前：$(node --version)）。"
fi

# Claim the installation before creating markers, logs, source cache or profiles.
# Shared module: bin/installation-state.cjs, embedded by bin/build-installer-scripts.mjs.
cat >"${TEMP_DIR}/installation-state.cjs" <<'DSH_INSTALLATION_STATE_MODULE'
'use strict'
// Dependency-free installation ownership, also embedded in standalone bootstraps.
// An abandoned lock is reclaimed only when every recorded writer (owner and
// registered stage processes) is gone, or after an idle period longer than any
// supervised stage may run. Otherwise a closed window locks the user out forever.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const LOCK_NAME = '.tavern-install.lock'
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
const lockPath = dshHome => path.join(path.resolve(dshHome), LOCK_NAME)
const uncertain = lockDir => ({ lockDir, state: 'uncertain', unsafeToRetry: true })
// Longer than the whole supervised update (30 minutes), which refreshes progress per stage.
const STALE_IDLE_MS = 60 * 60 * 1000
// A dead owner may have just spawned descendants that registered nothing yet.
const DEAD_OWNER_GRACE_MS = 60 * 1000

function readInstallation(dshHome) {
  const lockDir = lockPath(dshHome)
  try {
    if (!fs.lstatSync(lockDir).isDirectory()) return uncertain(lockDir)
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'))
    if (!owner || typeof owner.attemptId !== 'string' || !owner.attemptId || typeof owner.generation !== 'string') return uncertain(lockDir)
    return { ...owner, lockDir }
  } catch (error) {
    if (error.code === 'ENOENT') {
      try { fs.lstatSync(lockDir) } catch (missing) { if (missing.code === 'ENOENT') return null }
    }
    return uncertain(lockDir)
  }
}

function assertOwner(dshHome, attemptId, generation) {
  const owner = readInstallation(dshHome)
  if (!owner || owner.attemptId !== attemptId || (generation && owner.generation !== generation)) {
    throw failure('INSTALLATION_OWNERSHIP_LOST', '安装任务已失去所有权，已停止写入。', { owner })
  }
  return owner
}

// Serialize all metadata changes, cancellation, final file promotions and release.
// A crashed mutation also fails closed; there is no lease timeout/automatic eviction.
function withMutation(dshHome, attemptId, generation, callback) {
  const lockDir = lockPath(dshHome)
  const gate = path.join(lockDir, '.mutation')
  const deadline = Date.now() + 5000
  const gateToken = randomUUID()
  for (;;) {
    assertOwner(dshHome, attemptId, generation)
    try {
      fs.mkdirSync(gate)
    } catch (error) {
      // Windows can report a sharing/delete-pending violation while another
      // process removes this gate. Wait for mkdir to succeed; never remove a
      // competing gate or enter the callback without acquiring it ourselves.
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      if (Date.now() >= deadline) {
        // A permanent permissions failure must keep its original diagnostics.
        if (error.code !== 'EEXIST') throw error
        throw failure('INSTALLATION_STATE_BUSY', '安装状态正在写入或尚未安全结束，请勿并行重试。')
      }
      sleep(10)
      continue
    }
    // We own the directory now. A failed token write retains it conservatively
    // and must not be retried as if another process held the gate.
    fs.writeFileSync(path.join(gate, 'token'), gateToken, { flag: 'wx', mode: 0o600 })
    break
  }
  try {
    const result = callback(assertOwner(dshHome, attemptId, generation))
    if (result && typeof result.then === 'function') throw new TypeError('withOwnership callback must be synchronous')
    return result
  } finally {
    // release() renames the entire directory while holding this gate. Never touch
    // a gate belonging to an installation that appeared at the old path afterward.
    try {
      if (fs.readFileSync(path.join(gate, 'token'), 'utf8') === gateToken) {
        fs.unlinkSync(path.join(gate, 'token'))
        fs.rmdirSync(gate)
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function writeRecord(lockDir, basename, value) {
  const filename = path.join(lockDir, basename)
  const temporary = path.join(lockDir, `.owner-${randomUUID()}.tmp`)
  let fd
  try {
    fd = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`)
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    // Do not unlink the destination as an overwrite fallback: preserve the last
    // complete owner if antivirus/sharing violations prevent atomic replacement.
    for (let retry = 0; ; retry++) {
      try { fs.renameSync(temporary, filename); break } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || retry >= 5) throw error
        sleep(10 * (retry + 1))
      }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

const writeOwner = (lockDir, owner) => writeRecord(lockDir, 'owner.json', owner)

function releaseOwner(dshHome, attemptId, generation, pid) {
  return withMutation(dshHome, attemptId, generation, owner => {
    if (pid !== undefined && owner.pid !== pid) throw failure('INSTALLATION_OWNERSHIP_LOST', '仅安装任务的所有者可以释放安装锁。')
    if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '安装子进程尚未确认停止，已保留安装锁，禁止再次写入。', { owner, unsafeToRetry: true })
    const lockDir = lockPath(dshHome)
    const removed = `${lockDir}.released-${randomUUID()}`
    fs.renameSync(lockDir, removed)
    // This unique, just-renamed directory is ours. No user installation files or
    // a successor's lock can be removed by delayed cleanup.
    fs.rmSync(removed, { recursive: true, force: true })
    return true
  })
}

function makeHandle(dshHome, initialOwner, { created = false, adopted = false } = {}) {
  const { attemptId, generation } = initialOwner
  const mayRelease = created || adopted
  let released = false
  return {
    attemptId, lockDir: lockPath(dshHome), created, adopted, joined: !mayRelease,
    get owner() { return assertOwner(dshHome, attemptId, generation) },
    assertOwnership() { return assertOwner(dshHome, attemptId, generation) },
    withOwnership(callback) { return withMutation(dshHome, attemptId, generation, callback) },
    update(patch) {
      return withMutation(dshHome, attemptId, generation, owner => {
        // Only adoption can change PID/generation. A nested installer may mark the
        // shared task unsafe, but no later progress update can silently clear it.
        const next = { ...owner, ...patch, attemptId, generation, pid: owner.pid,
          dshHome: owner.dshHome, startedAt: owner.startedAt,
          unsafeToRetry: Boolean(owner.unsafeToRetry || patch.unsafeToRetry), updatedAt: Date.now() }
        if (owner.unsafeToRetry || next.unsafeToRetry) next.state = 'blocked'
        delete next.lockDir
        writeOwner(lockPath(dshHome), next)
        return { ...next, lockDir: lockPath(dshHome) }
      })
    },
    // ownerDone: the owner itself retains on its way out, so its PID (often the
    // user's interactive shell) no longer proves a writer is alive.
    retain(reason, { ownerDone = false } = {}) {
      return this.update({ state: 'blocked', unsafeToRetry: true, blockedReason: String(reason || 'Unverified process cleanup'), ...(ownerDone ? { ownerDone: true } : {}) })
    },
    release() {
      if (!mayRelease || released) return false
      const result = releaseOwner(dshHome, attemptId, generation, initialOwner.pid)
      released = true
      return result
    },
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

// Owner plus every PID recorded under processes/<stage>/ (registrations and supervisors).
function recordedPids(lockDir, owner) {
  const pids = new Set(!owner?.ownerDone && Number.isSafeInteger(owner?.pid) && owner.pid > 1 ? [owner.pid] : [])
  const base = path.join(lockDir, 'processes')
  let stages = []
  try { stages = fs.readdirSync(base) } catch (error) { if (error.code !== 'ENOENT') return null }
  for (const stage of stages) {
    let names
    try { names = fs.readdirSync(path.join(base, stage)) } catch { continue }
    for (const name of names.filter(name => /^(\d+|supervisor)\.json$/.test(name))) {
      try {
        const pid = JSON.parse(fs.readFileSync(path.join(base, stage, name), 'utf8')).pid
        if (Number.isSafeInteger(pid) && pid > 1) pids.add(pid)
      } catch (error) { if (error.code !== 'ENOENT') return null }
    }
  }
  return pids
}

function lastActivity(lockDir, owner) {
  let latest = Math.max(0, ...[owner?.updatedAt, owner?.progressAt, owner?.startedAt].filter(Number.isFinite))
  for (const name of ['.', 'owner.json']) {
    try { latest = Math.max(latest, fs.statSync(path.join(lockDir, name)).mtimeMs) } catch {}
  }
  return latest
}

function staleReason(lockDir, owner, now = Date.now()) {
  const idle = now - lastActivity(lockDir, owner)
  if (idle > STALE_IDLE_MS) return 'idle'
  if (owner?.state === 'uncertain') return ''
  // The launched updater adopts its reservation before writing anything. If that
  // process is gone and the reservation is still unadopted, nobody can be writing.
  if (owner?.state === 'reserved') return Number.isSafeInteger(owner.launcherPid) && owner.launcherPid > 1 && !alive(owner.launcherPid) ? 'launcher-exited' : ''
  // A finished owner spawns nothing more; its stage processes register before running.
  if (!owner?.ownerDone && idle < DEAD_OWNER_GRACE_MS) return ''
  const pids = recordedPids(lockDir, owner)
  return pids && (pids.size > 0 || owner?.ownerDone) && [...pids].every(pid => !alive(pid)) ? 'writers-exited' : ''
}

// Move a stale lock aside atomically, then confirm it was the one judged stale.
function reclaimStale(dshHome, owner) {
  const lockDir = lockPath(dshHome)
  const reason = staleReason(lockDir, owner)
  if (!reason) return false
  const removed = `${lockDir}.stale-${randomUUID()}`
  try { fs.renameSync(lockDir, removed) } catch (error) {
    if (error.code === 'ENOENT') return true
    return false
  }
  let moved = null
  try { moved = JSON.parse(fs.readFileSync(path.join(removed, 'owner.json'), 'utf8')) } catch {}
  if ((moved?.generation || '') !== (owner?.generation || '')) {
    // A successor took the path between our read and rename; give it back.
    try { fs.renameSync(removed, lockDir) } catch {}
    return false
  }
  try { fs.rmSync(removed, { recursive: true, force: true }) } catch {}
  process.stderr.write(`已清理残留的安装锁（${{ idle: '超过 1 小时无进展', 'launcher-exited': '更新进程未开始安装就已退出' }[reason] || '原安装进程均已退出'}）：${lockDir}\n`)
  return true
}

function busy(owner, lockDir) {
  const since = Number.isFinite(owner?.startedAt) ? `（开始于 ${new Date(owner.startedAt).toLocaleString()}）` : ''
  return failure('INSTALLATION_BUSY', `已有安装或更新任务占用此目录${since}，请等待其结束。若确认没有安装在运行，可删除 ${lockDir} 后重试；1 小时无进展也会自动解除。`, { owner, lockDir })
}

function acquireInstallation(options = {}) {
  const { dshHome, sourceRoot = '', statusFile = '', adopt = false, state = 'running' } = options
  if (typeof dshHome !== 'string' || !dshHome) throw new TypeError('dshHome is required')
  const explicitAttempt = typeof options.attemptId === 'string' && options.attemptId.length > 0
  const attemptId = explicitAttempt ? options.attemptId : randomUUID()
  const pid = options.pid === undefined ? (state === 'reserved' ? 0 : process.pid) : options.pid
  if (!Number.isSafeInteger(pid) || pid < 0) throw new TypeError('pid must be a non-negative integer')
  const lockDir = lockPath(dshHome)
  fs.mkdirSync(path.resolve(dshHome), { recursive: true })
  for (let reclaimed = false; ;) {
    try { fs.mkdirSync(lockDir); break } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = readInstallation(dshHome)
      if (!explicitAttempt || owner?.attemptId !== attemptId) {
        if (!reclaimed && reclaimStale(dshHome, owner)) { reclaimed = true; continue }
        throw busy(owner, lockDir)
      }
      if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '上次安装尚未安全结束，安装目录仍被锁定。', { owner, unsafeToRetry: true })
      if (!adopt) return makeHandle(dshHome, owner)
      const adoptedOwner = withMutation(dshHome, attemptId, owner.generation, current => {
        if (current.state !== 'reserved' || current.pid) throw failure('INSTALLATION_BUSY', '此安装任务已经开始，不能再次启动。', { owner: current })
        // Rotate fencing generation so the old reservation handle cannot release or
        // overwrite a running child, even if its delayed spawn callback fires.
        const next = { ...current, generation: randomUUID(), pid, state: 'running',
          sourceRoot: sourceRoot || current.sourceRoot, statusFile: statusFile || current.statusFile, updatedAt: Date.now() }
        delete next.lockDir
        writeOwner(lockDir, next)
        return next
      })
      return makeHandle(dshHome, adoptedOwner, { adopted: true })
    }
  }
  const owner = { attemptId, generation: randomUUID(), pid, startedAt: Date.now(),
    sourceRoot, statusFile, state, dshHome: path.resolve(dshHome) }
  // An initialization error retains the mkdir reservation conservatively. A
  // racing reader never treats an absent/partial owner file as an unlocked home.
  writeOwner(lockDir, owner)
  return makeHandle(dshHome, owner, { created: true })
}

function requestCancellation(dshHome, attemptId) {
  for (;;) {
    const owner = assertOwner(dshHome, attemptId)
    try {
      return withMutation(dshHome, attemptId, owner.generation, current => {
        const filename = path.join(lockPath(dshHome), 'cancel-request.json')
        const request = { attemptId, requestedAt: Date.now() }
        if (!fs.existsSync(filename)) writeRecord(lockPath(dshHome), 'cancel-request.json', request)
        return { ...request, owner: current }
      })
    } catch (error) {
      // Adoption rotates generation without changing this logical attempt. A
      // cancellation arriving at that exact boundary still belongs to the child.
      const current = readInstallation(dshHome)
      if (error.code === 'INSTALLATION_OWNERSHIP_LOST' && current?.attemptId === attemptId && current.generation !== owner.generation) continue
      throw error
    }
  }
}

function cancellationRequested(dshHome, attemptId) {
  const owner = readInstallation(dshHome)
  if (!owner || owner.attemptId !== attemptId) return false
  try {
    const request = JSON.parse(fs.readFileSync(path.join(lockPath(dshHome), 'cancel-request.json'), 'utf8'))
    return request.attemptId === attemptId && readInstallation(dshHome)?.generation === owner.generation
  } catch { return false }
}

// Explicit recovery only. The caller must first close and verify the complete
// durable process registry, including descendants; owner PID death is NOT proof.
function releaseStoppedInstallation({ dshHome, attemptId, generation, processesVerifiedStopped } = {}) {
  if (processesVerifiedStopped !== true || !generation) throw failure('INSTALLATION_UNSAFE', '释放安装锁前必须确认所有安装子进程均已停止。', { unsafeToRetry: true })
  return withMutation(dshHome, attemptId, generation, owner => {
    if (owner.pid) {
      try { process.kill(owner.pid, 0) } catch (error) {
        if (error.code === 'ESRCH') {
          const removed = `${lockPath(dshHome)}.released-${randomUUID()}`
          fs.renameSync(lockPath(dshHome), removed)
          fs.rmSync(removed, { recursive: true, force: true })
          return true
        }
        throw failure('INSTALLATION_UNSAFE', '无法确认安装所有者已经停止。', { unsafeToRetry: true })
      }
      throw failure('INSTALLATION_BUSY', '安装所有者仍在运行，不能释放安装锁。', { owner })
    }
    const removed = `${lockPath(dshHome)}.released-${randomUUID()}`
    fs.renameSync(lockPath(dshHome), removed)
    fs.rmSync(removed, { recursive: true, force: true })
    return true
  })
}

function main(argv) {
  const [command, ...args] = argv
  const flags = {}
  for (let index = 0; index < args.length; index += 2) flags[args[index].replace(/^--/, '')] = args[index + 1]
  const dshHome = flags.home
  if (command === 'acquire') {
    const handle = acquireInstallation({ dshHome, attemptId: flags.attempt, pid: Number(flags.pid), sourceRoot: flags.source || '', statusFile: flags.status || '' })
    const result = { attemptId: handle.attemptId, lockDir: handle.lockDir, created: handle.created, generation: handle.owner.generation }
    // Shells consume plain lines, not eval or executable text from user paths.
    if (flags.format === 'lines') console.log(`${result.attemptId}\n${result.lockDir}\n${result.created ? '1' : '0'}\n${result.generation}`)
    else console.log(JSON.stringify(result))
    return
  }
  if (command === 'release') {
    if (!flags.attempt || !flags.generation || !flags.pid) throw new TypeError('release requires attempt, generation and pid')
    return releaseOwner(dshHome, flags.attempt, flags.generation, Number(flags.pid))
  }
  if (command === 'check') {
    const owner = assertOwner(dshHome, flags.attempt)
    if (owner.unsafeToRetry || owner.state === 'blocked') throw failure('INSTALLATION_UNSAFE', '安装子进程尚未确认停止。', { unsafeToRetry: true })
    if (cancellationRequested(dshHome, flags.attempt)) throw failure('INSTALLATION_CANCELLED', '安装任务已请求中止。')
    return
  }
  if (command === 'retain') return acquireInstallation({ dshHome, attemptId: flags.attempt }).retain(flags.reason, { ownerDone: flags['owner-done'] === '1' })
  throw new Error(`Unknown installation-state command: ${command}`)
}

module.exports = { acquireInstallation, readInstallation, reclaimStaleInstallation: reclaimStale, requestCancellation, cancellationRequested, releaseStoppedInstallation, LOCK_NAME }
if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(`${error.code || 'INSTALLATION_ERROR'}: ${error.message}`); process.exitCode = 1 }
}
DSH_INSTALLATION_STATE_MODULE
node "${TEMP_DIR}/installation-state.cjs" acquire --home "$DSH_ROOT" --attempt "${DSH_TAVERN_INSTALL_ATTEMPT:-}" --pid "$$" --source "$APP_DIR" --format lines >"${TEMP_DIR}/installation-owner"
DSH_TAVERN_INSTALL_ATTEMPT=$(sed -n '1p' "${TEMP_DIR}/installation-owner")
DSH_TAVERN_INSTALL_LOCK=$(sed -n '2p' "${TEMP_DIR}/installation-owner")
INSTALL_LOCK_CREATED=$(sed -n '3p' "${TEMP_DIR}/installation-owner")
INSTALL_LOCK_GENERATION=$(sed -n '4p' "${TEMP_DIR}/installation-owner")
export DSH_TAVERN_INSTALL_ATTEMPT DSH_TAVERN_INSTALL_LOCK
# Resolve under the installation lease before any source/profile writes.
cat > "${TEMP_DIR}/installation-location.cjs" <<'DSH_INSTALLATION_LOCATION_MODULE'
// Dependency-free: embedded in standalone installers before downloaded code exists.
// A relocated installation keeps logical aliases for old shortcuts and profile links.
// Installers MUST write the physical app directory, never replace those aliases.
const fs = require('node:fs')
const path = require('node:path')
const fail = message => { throw Object.assign(new Error(`酒馆安装目录记录不安全，未修改安装：${message}`), { code: 'INSTALLATION_LOCATION_UNSAFE' }) }
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const inside = (child, root) => { const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? child.toLowerCase() : child); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }
const overlaps = (left, right) => same(left, right) || inside(left, right) || inside(right, left)
function ordinaryAncestors(directory) {
  let current = path.resolve(directory)
  for (;;) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`目录祖先不能是链接或文件：${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证目录祖先：${current} (${error.code || error.name})`)
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}
// Only the configured home's parent chain is trusted to contain user-profile
// redirects. Never realpath a managed child: that would hide a replaced .dsh,
// state directory, or installation alias before it can be validated.
function trustedHome(dshHome) {
  const logical = path.resolve(dshHome)
  let ancestor = path.dirname(logical)
  const missing = []
  for (;;) {
    try {
      const physicalParent = fs.realpathSync(ancestor)
      if (!fs.statSync(physicalParent).isDirectory()) fail('用户目录祖先不是目录')
      const logicalParent = path.dirname(logical)
      const canonicalParent = path.join(physicalParent, ...missing.reverse())
      const physical = path.join(canonicalParent, path.basename(logical))
      ordinaryAncestors(physical)
      return { logical, physical, map(value) {
        const resolved = path.resolve(value)
        return same(resolved, logicalParent) || inside(resolved, logicalParent) ? path.join(canonicalParent, path.relative(logicalParent, resolved)) : resolved
      } }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证用户目录祖先：${ancestor} (${error.code || 'UNKNOWN'})`)
      }
      // An existing dangling redirect is not a missing ordinary directory.
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) fail(`用户目录链接不可用：${ancestor}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) fail('无法解析用户目录')
      missing.push(path.basename(ancestor)); ancestor = parent
    }
  }
}
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/u.test(value) || !same(path.resolve(value), value)) fail('路径不是规范的绝对路径')
  return value
}
function resolveInstallationApp({ dshHome, appDir } = {}) {
  const trusted = trustedHome(dshHome), home = trusted.physical
  ordinaryAncestors(path.join(home, 'profile-bridge'))
  const requested = appDir ? path.resolve(appDir) : path.join(trusted.logical, 'apps', 'dsh-tavern')
  const journal = path.join(home, 'profile-bridge', 'installation-operation.json')
  try {
    if (fs.lstatSync(journal).isSymbolicLink()) fail('安装管理事务记录不能是链接')
    const operation = JSON.parse(fs.readFileSync(journal, 'utf8'))
    if (operation?.schemaVersion !== 1 || !['completed', 'rolled-back'].includes(operation.phase)) fail('上次安装管理尚未安全结束，请先恢复事务与备份')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`无法读取安装管理事务记录：${journal} (${error.code || error.name})`)
    }
  }
  const filename = path.join(home, 'profile-bridge', 'installation.json')
  let record
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail('安装记录不能是链接')
    record = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return requested
    if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
    fail(`无法读取 ${filename} (${error.code || error.name})`)
  }
  if (record?.schemaVersion !== 1 || record.phase !== 'completed' || !Array.isArray(record.entries)) fail('迁移尚未完成或记录格式不受支持')
  const destination = trusted.map(absolute(record.destination))
  const logicalApp = trusted.map(absolute(record.appDir))
  if (overlaps(destination, home) || overlaps(destination, logicalApp)) fail('迁移目标不能与共享 DSH 或原安装目录重叠')
  ordinaryAncestors(destination)
  const entries = record.entries
  if (entries.length !== 3 || new Set(entries.map(e => e?.kind)).size !== 3 || entries.some(e => !['app', 'profile', 'data'].includes(e?.kind))) fail('迁移目录清单不完整')
  const seen = new Set()
  for (const entry of entries) {
    const from = trusted.map(absolute(entry.from)), to = trusted.map(absolute(entry.to))
    if (overlaps(destination, from)) fail('迁移目标不能与原目录重叠')
    ordinaryAncestors(path.dirname(from))
    const expected = entry.kind === 'app' ? logicalApp : entry.kind === 'profile' ? path.join(home, 'profiles', 'tavern') : path.join(home, 'profile-data', 'tavern')
    if (!same(from, expected) || !inside(to, destination) || !same(to, path.join(destination, entry.kind)) || seen.has(to)) fail('迁移目录不匹配')
    seen.add(to)
    try {
      // No aliased destination ancestors: copied trees must remain on the chosen volume.
      if (!same(fs.realpathSync(destination), destination) || !same(fs.realpathSync(to), to) || !fs.lstatSync(to).isDirectory()) fail('迁移目标包含链接或不是目录')
      if (!fs.lstatSync(from).isSymbolicLink() || !same(trusted.map(path.resolve(path.dirname(from), fs.readlinkSync(from))), to) || !same(fs.realpathSync(from), to)) fail('原目录入口已被更改')
    } catch (error) {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`目录不可用：${from} → ${to}`)
    }
  }
  const physicalApp = trusted.map(entries.find(entry => entry.kind === 'app').to)
  if (appDir && !same(trusted.map(requested), logicalApp) && !same(trusted.map(requested), physicalApp)) fail('指定目录与已迁移的酒馆冲突')
  return physicalApp
}
module.exports = { resolveInstallationApp, trustedHome }
if (require.main === module) {
  try { console.log(resolveInstallationApp({ dshHome: process.argv[2], appDir: process.argv[3] || undefined })) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
DSH_INSTALLATION_LOCATION_MODULE
APP_DIR=$(node "${TEMP_DIR}/installation-location.cjs" "$DSH_ROOT" "${DSH_TAVERN_APP_DIR:-}")
export DSH_TAVERN_APP_DIR="$APP_DIR"
if [ "${INSTALL_HOST}" = "cli" ]; then
  printf 'cli-v1\n' > "$DSH_ROOT/.dsh-tavern-install-root"
fi

if [ "${INSTALL_HOST}" = "cli" ] && ! command -v npm >/dev/null 2>&1; then
  fail "未找到 npm，请重新安装 Node.js。"
fi

# UI updates start in a fresh process that may not inherit the install-time PATH.
# Only CLI may use Tavern-managed tools; Desktop must keep its host PATH.
if [ "${INSTALL_HOST}" = "cli" ]; then
  PATH=${RUNTIME_BIN}:${PATH}
  export PATH
fi

if [ "${INSTALL_HOST}" = "cli" ]; then
  DSH_TAVERN_BIN_DIR=${COMMAND_BIN}
  export DSH_TAVERN_BIN_DIR
fi

command -v tar >/dev/null 2>&1 || fail "未找到 tar。"

# Standalone bootstrap must log before the repository has been downloaded.
UPDATE_LOG_ROOT=${DSH_TAVERN_UPDATE_LOG_ROOT:-${DSH_ROOT}/profile-data/tavern/data}
DSH_TAVERN_UPDATE_ATTEMPT=${DSH_TAVERN_UPDATE_ATTEMPT:-${DSH_TAVERN_INSTALL_ATTEMPT:-install-$$-$(date +%s)}}
export DSH_TAVERN_UPDATE_ATTEMPT
cat > "${TEMP_DIR}/update-log.cjs" <<'UPDATE_LOG_JS'
const fs=require('node:fs'),path=require('node:path');
try {
 const [root,event,step,exitCode,startedAt,file]=process.argv.slice(2);
 const clean=value=>String(value||'').replace(/https?:\/\/[^\s<>"')]+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname}catch{return '[URL]'}}).replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/((?:authorization|token|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
 let output=file&&fs.existsSync(file)?clean(fs.readFileSync(file,'utf8')):'';
 const outputCharacters=output.length;
 if(output.length>6000)output=output.slice(0,3000)+'\n[中间输出省略]\n'+output.slice(-3000);
 const record={at:new Date().toISOString(),pid:process.ppid,attemptId:process.env.DSH_TAVERN_UPDATE_ATTEMPT,event,step,exitCode:exitCode===''?undefined:Number(exitCode),durationMs:startedAt?Date.now()-Number(startedAt):undefined,output,outputCharacters};
 fs.mkdirSync(root,{recursive:true});const target=path.join(root,'update-diagnostics.jsonl');
 try{if(fs.statSync(target).size>1048576){try{fs.unlinkSync(target+'.1')}catch{}fs.renameSync(target,target+'.1')}}catch{}
 fs.appendFileSync(target,JSON.stringify(record)+'\n');
}catch{}
UPDATE_LOG_JS
update_log() {
  node "${TEMP_DIR}/update-log.cjs" "$UPDATE_LOG_ROOT" "$@" >/dev/null 2>&1 || true
}
run_git() {
  git_step=$1
  shift
  git_started=$(node -p 'Date.now()')
  update_log installer.stage.started "$git_step" '' '' ''
  if git "$@" >"${TEMP_DIR}/git.stdout" 2>"${TEMP_DIR}/git.stderr"; then git_code=0; else git_code=$?; fi
  cat "${TEMP_DIR}/git.stdout"
  cat "${TEMP_DIR}/git.stderr" >&2
  cat "${TEMP_DIR}/git.stdout" "${TEMP_DIR}/git.stderr" >"${TEMP_DIR}/git.output"
  if [ "$git_code" -eq 0 ]; then git_event=installer.stage.succeeded; else git_event=installer.stage.failed; fi
  update_log "$git_event" "$git_step" "$git_code" "$git_started" "${TEMP_DIR}/git.output"
  if [ "$git_code" -ne 0 ]; then echo "Git 步骤失败：${git_step}（退出码 ${git_code}），正在尝试备用源。" >&2; fi
  return "$git_code"
}
update_log installer.started bootstrap '' '' ''
echo "更新诊断日志：${UPDATE_LOG_ROOT}/update-diagnostics.jsonl"

echo "正在增量同步 DSH Tavern……"
USED_GIT=0
USED_ARCHIVE=0
USED_CDN=0
if command -v git >/dev/null 2>&1; then
  echo "正在通过 Git 增量同步（不下载文档与图片）……"
  mkdir -p "$(dirname -- "${SOURCE_CACHE}")"
  if { [ -f "${SOURCE_CACHE}/HEAD" ] || run_git git.clone clone --bare --filter=blob:none --depth 1 --single-branch --branch main "${REPOSITORY_URL}" "${SOURCE_CACHE}"; } \
    && run_git git.remote --git-dir="${SOURCE_CACHE}" remote set-url origin "${REPOSITORY_URL}" \
    && run_git git.fetch --git-dir="${SOURCE_CACHE}" fetch --depth 1 origin main \
    && TARGET_COMMIT=$(run_git git.revision --git-dir="${SOURCE_CACHE}" rev-parse FETCH_HEAD) \
    && run_git git.archive -c core.autocrlf=false -c core.eol=lf --git-dir="${SOURCE_CACHE}" archive --format=tar --output="${TEMP_DIR}/app.tar" FETCH_HEAD -- ${RUNTIME_PATHS}; then
    USED_GIT=1
  else
    echo "Git 增量更新失败，正在尝试 jsDelivr 备用源。" >&2
  fi
else
  update_log installer.stage.failed git.unavailable 127 '' ''
  echo "未找到 Git，正在尝试备用源。" >&2
fi

if [ "${USED_GIT}" -eq 0 ]; then
  # 整包下载（GitHub 的 codeload）优先于 jsDelivr：CDN 的 @main 会滞后十几小时。
  if command -v curl >/dev/null 2>&1; then
    echo "正在下载精简运行压缩包（GitHub）……"
    update_log installer.stage.started source.github.archive '' '' ''
    if [ -z "${TARGET_COMMIT}" ]; then
      TARGET_COMMIT=$(curl -fsSL --connect-timeout 10 "${COMMIT_URL}" | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n 1 || true)
    fi
    # Fail only after 30 s without data; --max-time is a generous upper bound.
    if curl -fL --retry 3 --connect-timeout 15 --speed-limit 1 --speed-time 30 --max-time 900 "${ARCHIVE_URL}" -o "${TEMP_DIR}/app.tar.gz"; then
      USED_ARCHIVE=1
      update_log installer.stage.succeeded source.github.archive 0 '' ''
    else
      update_log installer.stage.failed source.github.archive 1 '' ''
      echo "GitHub 压缩包下载失败，改用 jsDelivr 备用源。" >&2
    fi
  else
    echo "未找到 curl，改用 jsDelivr 备用源。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ] && [ "${USED_ARCHIVE}" -eq 0 ]; then
  echo "正在通过 jsDelivr 备用源下载运行代码……"
  update_log installer.stage.started source.jsdelivr '' '' ''
  mkdir -p "${TEMP_DIR}/cdn-source"
  # Shared download module: bin/download.cjs, embedded by bin/build-installer-scripts.mjs.
  cat >"${TEMP_DIR}/download.cjs" <<'DSH_DOWNLOAD_MODULE'
'use strict'
// Shared network downloads for the installers and Windows Desktop package management.
// install.ps1 and install.sh embed this file verbatim because they run before any
// code is downloaded: edit it here, then run `node bin/build-installer-scripts.mjs`.
// Keep it dependency-free CommonJS for Node >= 22.19 (Desktop runs it under Electron).
//
// Timeouts follow one rule: a transfer fails when no bytes arrive for `stallMs`
// (slow but moving downloads keep going); `deadlineMs` is only a generous upper bound.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { inflateRawSync } = require('node:zlib')

const RUNTIME_PATH = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|android\/|bin\/|config\/|presets\/|patches\/|tavern-plugin\/)/
const EXCLUDED_PART = new Set(['.', '..', 'docs', 'tests', '__tests__', 'testsets'])

class DownloadError extends Error {
  constructor(message, { reason, attempts = [], cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DownloadError'
    this.reason = reason
    this.attempts = attempts
  }
}

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

const NETWORK_REASONS = [
  [/^(ENOTFOUND|EAI_AGAIN)$/, '域名解析失败'],
  [/^ECONNREFUSED$/, '连接被拒绝'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, '连接被中断'],
  [/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)$/, '连接超时'],
  [/^(ENETUNREACH|EHOSTUNREACH)$/, '网络不可达'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/, 'TLS 证书校验失败（可能被代理或安全软件拦截）'],
]

// One short Chinese reason per failure; the underlying error stays in `cause`.
function describeFailure(error) {
  if (!error) return '未知错误'
  if (error.code === 'STALLED' || error.code === 'DEADLINE' || error.code === 'HTTP' || error.code === 'CHECKSUM') return error.message
  if (error.name === 'TimeoutError') return '请求超时'
  if (error.name === 'AbortError') return '请求被中止'
  let current = error
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = String(current.code || '')
    for (const [pattern, reason] of NETWORK_REASONS) if (pattern.test(code)) return `${reason}（${code}）`
  }
  return String(error.cause?.code || error.cause?.message || error.message || error)
}

const duration = ms => ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} 分钟` : `${Number((ms / 1000).toFixed(1))} 秒`

function hostOf(url) {
  try { return new URL(url).hostname } catch { return String(url) }
}

// Fetch one URL into memory, aborting when no data arrives for `stallMs`.
async function fetchBytes(url, { stallMs = 30000, signal, headers, onData, fetch: request = fetch } = {}) {
  const controller = new AbortController()
  let stalled = false, timer
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort() }, stallMs) }
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  arm()
  try {
    const response = await request(url, { signal: combined, headers, redirect: 'follow' })
    if (!response.ok) {
      try { await response.body?.cancel() } catch {}
      throw failure('HTTP', `HTTP ${response.status}`, { status: response.status })
    }
    const total = Number(response.headers?.get?.('content-length')) || 0
    const chunks = []
    let received = 0
    if (response.body) for await (const chunk of response.body) {
      arm()
      const bytes = Buffer.from(chunk)
      chunks.push(bytes); received += bytes.length
      onData?.(received, total)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    if (stalled) throw failure('STALLED', `${duration(stallMs)}没有收到数据`, { cause: error })
    throw error
  } finally { clearTimeout(timer) }
}

// Try `urls` in turn (cycling) until one returns bytes matching `sha256`/`size`.
async function download(urls, options = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!list.length) throw new TypeError('download() needs at least one URL')
  const { sha256, size, label = path.posix.basename(new URL(list[0]).pathname) || list[0], stallMs = 30000, deadlineMs,
    attempts = Math.max(2, list.length), retryDelayMs = 1000, signal, headers, onProgress, onAttempt, onRetry } = options
  const deadline = deadlineMs ? AbortSignal.timeout(deadlineMs) : undefined
  const limit = [signal, deadline].filter(Boolean)
  const combined = limit.length > 1 ? AbortSignal.any(limit) : limit[0]
  const records = []
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const url = list[(attempt - 1) % list.length]
    onAttempt?.({ url, host: hostOf(url), attempt, attempts })
    try {
      const bytes = await fetchBytes(url, { stallMs, signal: combined, headers, fetch: options.fetch,
        onData: (received, total) => onProgress?.({ url, host: hostOf(url), received, total, attempt, attempts }) })
      if (size !== undefined && bytes.length !== size) throw failure('CHECKSUM', `文件大小不符（应为 ${size} 字节，实际 ${bytes.length}）`)
      if (sha256 && createHash('sha256').update(bytes).digest('hex') !== String(sha256).toLowerCase()) throw failure('CHECKSUM', 'SHA-256 校验不符')
      return { bytes, url }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (deadline?.aborted) {
        last = failure('DEADLINE', `超过总时长上限 ${duration(deadlineMs)}`, { cause: error })
        records.push({ url, reason: last.message })
        break
      }
      last = error
      const reason = describeFailure(error)
      records.push({ url, reason })
      const willRetry = attempt < attempts
      onRetry?.({ url, host: hostOf(url), attempt, attempts, reason, willRetry, error })
      if (willRetry) {
        try { await delay(retryDelayMs * attempt, undefined, combined ? { signal: combined } : undefined) }
        catch { if (signal?.aborted) throw signal.reason; break }
      }
    }
  }
  const reason = describeFailure(last)
  throw new DownloadError(`${label} 下载失败（已尝试 ${records.length} 次）：${reason}`, { reason, attempts: records, cause: last })
}

// Download to `destination`; only a verified, complete file is ever published there.
async function downloadFile(urls, destination, options = {}) {
  const result = await download(urls, options)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const partial = `${destination}.download-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(partial, result.bytes)
    await fs.rename(partial, destination)
  } finally { await fs.rm(partial, { force: true }) }
  return result
}

function runtimeFiles(metadata) {
  if (!/^[0-9a-f]{40}$/i.test(String(metadata?.revision || ''))) throw new Error('运行清单缺少有效提交号')
  const files = (Array.isArray(metadata.files) ? metadata.files : [])
    .map(file => ({ ...file, path: String(file?.path || '') }))
    .filter(file => RUNTIME_PATH.test(file.path) && !file.path.split('/').some(part => EXCLUDED_PART.has(part)))
  for (const file of files) {
    if (file.path.includes('\\') || file.path.includes(':') || file.path.split('/').some(part => !part) || !/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))) {
      throw new Error(`运行清单包含无效文件：${file.path}`)
    }
  }
  if (!files.length) throw new Error('运行清单没有可下载的运行文件')
  return files
}

// jsDelivr's nodes keep separate caches of the mutable @branch manifest, and a purge is often
// throttled after a release: ask all of them and keep the newest (CI's release sequence).
const JSDELIVR_NODES = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net']
function manifestCandidates(metadataUrl, exact) {
  const url = new URL(metadataUrl)
  if (exact || url.hostname !== JSDELIVR_NODES[0] || !/@[^/]+\/dsh-tavern-runtime\.json$/.test(url.pathname)) return [metadataUrl]
  return JSDELIVR_NODES.map(host => { const each = new URL(url); each.hostname = host; return each.href })
}
function compareVersions(left, right) {
  const parts = value => String(value || '').split(/[-+]/)[0].split('.').map(part => Number(part) || 0)
  const [a, b] = [parts(left), parts(right)]
  for (let index = 0; index < 3; index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  return 0
}
async function readManifest({ metadataUrl, exact, minVersion, stallMs, attempts, fetch: request, status = () => {} }) {
  const urls = manifestCandidates(metadataUrl, exact)
  const results = await Promise.allSettled(urls.map(async url => {
    const { bytes } = await download([url], { label: '运行清单', stallMs: Math.min(stallMs, 15000), attempts, fetch: request })
    const metadata = JSON.parse(bytes.toString('utf8'))
    runtimeFiles(metadata)
    return { url, metadata }
  }))
  const found = results.filter(result => result.status === 'fulfilled').map(result => result.value)
  if (!found.length) throw results[0].reason
  const sequence = item => Number(item.metadata.releaseSequence) || 0
  const best = found.reduce((newest, item) => sequence(item) > sequence(newest) ? item : newest)
  if (found.length > 1 && found.some(item => item.metadata.revision !== best.metadata.revision)) status(`下载源各节点版本不一，使用最新的 ${hostOf(best.url)}（v${best.metadata.version || '?'}）`)
  // Never install code older than this installer: a stale CDN would hand back a release built for another host.
  if (minVersion && compareVersions(best.metadata.version, minVersion) < 0) {
    throw Object.assign(new Error(`下载源（jsDelivr）还没更新到 v${minVersion}，当前只有 v${best.metadata.version || '未知'}。请过半小时左右重试；或安装 git 后重试（会直接从 GitHub 下载）。`), { code: 'DSH_TAVERN_CDN_STALE' })
  }
  return best.metadata
}

// The files of a zip (stored or deflated, no ZIP64): the runtime archive CI publishes holds well
// under 65535 entries and 4 GB.
function unzipEntries(buffer) {
  let end = -1
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break }
  if (end < 0) throw failure('ARCHIVE', '压缩包结构损坏（找不到目录）')
  const count = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16)
  const entries = new Map()
  let at = offset
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) throw failure('ARCHIVE', '压缩包目录损坏')
    const method = buffer.readUInt16LE(at + 10), compressed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24)
    const nameLength = buffer.readUInt16LE(at + 28), local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
    if (name.endsWith('/')) continue
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw failure('ARCHIVE', `压缩包内容损坏：${name}`)
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const data = buffer.subarray(start, start + compressed)
    const bytes = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
    if (!bytes || bytes.length !== size) throw failure('ARCHIVE', `压缩包内容损坏：${name}`)
    entries.set(name, bytes)
  }
  return entries
}

// CI publishes the manifest's files as one zip at a pinned commit; one request instead of hundreds.
function runtimeArchive(metadata) {
  const archive = metadata?.archive
  if (!archive || !/^[0-9a-f]{40}$/i.test(String(archive.commit || '')) || !/^[0-9a-f]{64}$/i.test(String(archive.sha256 || ''))
    || !/^[A-Za-z0-9._-]+\.zip$/.test(String(archive.path || '')) || !Number.isSafeInteger(archive.size) || archive.size <= 0) return null
  return archive
}

// Every jsDelivr node, starting with the one the installer named, for the immutable archive URL.
function archiveUrls(rootUrl, archive) {
  const first = new URL(`${rootUrl}@${archive.commit}/${archive.path}`)
  if (!JSDELIVR_NODES.includes(first.hostname)) return [first.href]
  return [first.hostname, ...JSDELIVR_NODES.filter(host => host !== first.hostname)].map(host => { const each = new URL(first); each.hostname = host; return each.href })
}

// Download the runtime files listed by a jsDelivr manifest into `destination`.
// Files whose bytes already match in `installed` are reused instead of downloaded.
async function downloadRuntime({ metadataUrl, rootUrl, destination, installed, concurrency = 16, stallMs = 30000,
  budgetMs = 300000, attempts = 2, status = () => {}, fetch: request, targetCommit = '', minVersion = '', exactManifest = false } = {}) {
  const source = hostOf(rootUrl)
  const metadata = await readManifest({ metadataUrl, exact: exactManifest, minVersion, stallMs, attempts, fetch: request, status })
  const files = runtimeFiles(metadata)
  // The @main manifest can lag (CDN cache, or CI not yet published). When the app
  // asked for a specific commit, refuse a different one rather than silently
  // installing an older build; the caller falls back to another source.
  const target = String(targetCommit || '').trim().toLowerCase()
  if (/^[0-9a-f]{40}$/.test(target) && String(metadata.revision).toLowerCase() !== target) {
    throw new Error(`jsDelivr 运行清单（${String(metadata.revision).slice(0, 12)}）与目标版本（${target.slice(0, 12)}）不一致，可能尚未同步`)
  }
  const controller = new AbortController()
  const budget = AbortSignal.timeout(budgetMs)
  const signal = AbortSignal.any([controller.signal, budget])
  const archive = runtimeArchive(metadata)
  if (archive) {
    try {
      await extractRuntimeArchive({ archive, files, rootUrl, destination, stallMs, signal, fetch: request, status })
      await fs.writeFile(path.join(destination, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
      return metadata
    } catch (error) {
      if (budget.aborted) throw new Error(`备用源下载超过 ${duration(budgetMs)}，将切换备用方案`, { cause: error })
      status(`代码压缩包不可用（${describeFailure(error)}），改为逐个文件下载…`)
    }
  }
  let next = 0, done = 0, reused = 0, received = 0, reportedAt = 0
  // A progress line every five seconds at most: the Windows installer appends each line to its log
  // and echoes it, and a pipe it reads slower than we write stalls this process (and the download).
  const report = (force = false) => {
    const now = Date.now()
    if (!force && now - reportedAt < 5000) return
    reportedAt = now
    status(`下载代码（${source}）：${done}/${files.length} 文件，复用 ${reused}，已下载 ${(received / 1048576).toFixed(1)} MB`)
  }
  report(true)
  const worker = async () => {
    while (next < files.length) {
      signal.throwIfAborted()
      const file = files[next++]
      const parts = file.path.split('/')
      let content
      if (installed) {
        try {
          const local = await fs.readFile(path.join(installed, ...parts))
          if (createHash('sha256').update(local).digest('hex') === file.sha256.toLowerCase()) { content = local; reused++ }
        } catch {}
      }
      if (!content) {
        const url = `${rootUrl}@${metadata.revision}/${parts.map(encodeURIComponent).join('/')}`
        content = (await download([url], { label: file.path, sha256: file.sha256, stallMs, attempts, signal, fetch: request,
          onRetry: ({ attempt, attempts: total, reason, willRetry }) => status(`下载失败（${source}）：${file.path}，${reason}；尝试 ${attempt}/${total}${willRetry ? '，正在重试' : '，将切换备用方案'}。`),
        })).bytes
        received += content.length
      }
      signal.throwIfAborted()
      const target = path.join(destination, ...parts)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      done++
      report()
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    report(true)
  } catch (error) {
    controller.abort()
    if (budget.aborted) throw new Error(`备用源下载超过 ${duration(budgetMs)}，将切换备用方案`, { cause: error })
    throw error
  }
  await fs.writeFile(path.join(destination, 'dsh-tavern-runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

// One zip, verified as a whole and then file by file against the manifest, before anything is written.
async function extractRuntimeArchive({ archive, files, rootUrl, destination, stallMs, signal, fetch: request, status }) {
  const urls = archiveUrls(rootUrl, archive)
  let reportedAt = 0
  const megabytes = bytes => (bytes / 1048576).toFixed(1)
  status(`下载代码压缩包（${hostOf(urls[0])}）：0/${megabytes(archive.size)} MB`)
  const { bytes, url } = await download(urls, { label: '代码压缩包', sha256: archive.sha256, size: archive.size, stallMs, signal, fetch: request,
    onProgress: ({ host, received }) => {
      const now = Date.now()
      if (now - reportedAt < 5000) return
      reportedAt = now
      status(`下载代码压缩包（${host}）：${megabytes(received)}/${megabytes(archive.size)} MB`)
    } })
  status(`下载代码压缩包（${hostOf(url)}）：${megabytes(archive.size)}/${megabytes(archive.size)} MB，正在解压 ${files.length} 个文件…`)
  const entries = unzipEntries(bytes)
  const verified = files.map(file => {
    const content = entries.get(file.path)
    if (!content || createHash('sha256').update(content).digest('hex') !== file.sha256.toLowerCase()) throw failure('ARCHIVE', `压缩包与运行清单不一致：${file.path}`)
    return { file, content }
  })
  for (const { file, content } of verified) {
    signal.throwIfAborted()
    const target = path.join(destination, ...file.path.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  status(`代码已就绪：${files.length} 个文件`)
}

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const envValue = (env, name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]

function readInternetSettings() {
  const output = require('node:child_process').execFileSync('reg', ['query', INTERNET_SETTINGS], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function proxyUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

// Windows "system proxy" (WinINET) is invisible to Node fetch, curl, git and pnpm,
// which only read HTTP(S)_PROXY. Translate it into those variables when none is set.
// Returns the variables to add plus a display summary without credentials.
function proxyEnvironment(env = process.env, { platform = process.platform, readSettings = readInternetSettings } = {}) {
  const added = {}
  const useEnvProxy = () => { if (envValue(env, 'NODE_USE_ENV_PROXY') === undefined) added.NODE_USE_ENV_PROXY = '1' }
  if (PROXY_KEYS.some(key => envValue(env, key))) {
    useEnvProxy()
    return { added, source: 'environment' }
  }
  if (platform !== 'win32') return { added, source: null }
  let settings
  try { settings = readSettings() } catch { return { added, source: null } }
  if (Number(settings.ProxyEnable) === 1 && settings.ProxyServer) {
    const entries = {}
    for (const part of settings.ProxyServer.split(';').map(item => item.trim()).filter(Boolean)) {
      const [scheme, address] = part.includes('=') ? part.split('=', 2) : ['*', part]
      entries[scheme.toLowerCase()] = address
    }
    const http = entries.http || entries['*']
    const https = entries.https || http
    if (http || https) {
      if (http) added.HTTP_PROXY = proxyUrl(http)
      if (https) added.HTTPS_PROXY = proxyUrl(https)
      if (envValue(env, 'NO_PROXY') === undefined) {
        const bypass = String(settings.ProxyOverride || '').split(';').map(item => item.trim())
          .filter(item => item && item !== '<local>' && !item.slice(1).includes('*'))
          .map(item => item.replace(/^\*/, ''))
        added.NO_PROXY = [...new Set(['localhost', '127.0.0.1', '::1', ...bypass])].join(',')
      }
      useEnvProxy()
      return { added, source: 'system', summary: new URL(added.HTTPS_PROXY || added.HTTP_PROXY).host }
    }
    if (entries.socks) return { added, source: 'unsupported', summary: '系统代理只提供 SOCKS，安装程序无法使用；请在代理软件中开启 HTTP 代理或 TUN 模式' }
  }
  if (settings.AutoConfigURL) return { added, source: 'pac', summary: '系统代理使用 PAC 自动配置脚本，安装程序无法读取；如下载失败，请在代理软件中开启 TUN 模式或设置 HTTPS_PROXY' }
  return { added, source: null }
}

// Apply proxyEnvironment() to `env` and, when env is this process's environment,
// to this process's own fetch (Node >= 24.5 can switch the global proxy at runtime).
function applyProxyEnvironment(env = process.env, options) {
  const result = proxyEnvironment(env, options)
  Object.assign(env, result.added)
  if (result.added.HTTPS_PROXY || result.added.HTTP_PROXY) {
    try { require('node:http').setGlobalProxyFromEnv?.(env) } catch {}
  }
  return result
}

function parseOptions(args) {
  const options = {}, rest = []
  for (let index = 0; index < args.length; index++) {
    const match = /^--([a-z0-9-]+)$/.exec(args[index])
    if (match) options[match[1]] = args[++index]
    else rest.push(args[index])
  }
  return { options, rest }
}

const seconds = (value, fallback) => (value === undefined ? fallback : Number(value) * 1000)

// CLI used by the installer scripts:
//   node download.cjs file <destination> [--sha256 H] [--stall S] [--deadline S] [--attempts N] <url>...
//   node download.cjs runtime <metadata-url> <root-url> <destination> [<installed-dir>] [--stall S] [--budget S] [--min-version V]
//     (DSH_TAVERN_CDN_METADATA_URL set: that manifest only, no other jsDelivr nodes)
//   node download.cjs proxy-env   prints KEY=VALUE lines to add (Windows system proxy)
async function main(argv) {
  const [command, ...args] = argv
  const { options, rest } = parseOptions(args)
  const status = message => console.log(`DSH_STATUS ${message}`)
  if (command === 'file') {
    const [destination, ...urls] = rest
    if (!destination || !urls.length) throw new Error('用法：download.cjs file <目标文件> <URL>...')
    await downloadFile(urls, destination, { sha256: options.sha256, stallMs: seconds(options.stall, 30000),
      deadlineMs: seconds(options.deadline, undefined), attempts: options.attempts ? Number(options.attempts) : undefined })
    return
  }
  if (command === 'runtime') {
    const [metadataUrl, rootUrl, destination, installed] = rest
    if (!metadataUrl || !rootUrl || !destination) throw new Error('用法：download.cjs runtime <清单 URL> <CDN 根 URL> <目标目录> [已安装目录]')
    const metadata = await downloadRuntime({ metadataUrl, rootUrl: rootUrl.replace(/\/+$/, ''), destination, installed,
      stallMs: seconds(options.stall, 30000), budgetMs: seconds(options.budget, 300000), status,
      targetCommit: process.env.DSH_TAVERN_TARGET_COMMIT, minVersion: options['min-version'] || '',
      exactManifest: Boolean(process.env.DSH_TAVERN_CDN_METADATA_URL) })
    status(`下载代码完成：${metadata.revision.slice(0, 12)}`)
    return
  }
  if (command === 'proxy-env') {
    const { added, summary } = proxyEnvironment(process.env)
    for (const [key, value] of Object.entries(added)) console.log(`${key}=${value}`)
    if (summary) status(added.HTTPS_PROXY || added.HTTP_PROXY ? `使用系统代理：${summary}` : summary)
    return
  }
  throw new Error(`未知命令：${command || '(空)'}`)
}

module.exports = { download, downloadFile, downloadRuntime, unzipEntries, readManifest, manifestCandidates, compareVersions, describeFailure, runtimeFiles, proxyEnvironment, applyProxyEnvironment, DownloadError, RUNTIME_PATH }

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
DSH_DOWNLOAD_MODULE
  if node "${TEMP_DIR}/download.cjs" runtime "${CDN_METADATA_URL}" "${CDN_ROOT_URL}" "${TEMP_DIR}/cdn-source" "${APP_DIR}" --min-version "${INSTALLER_VERSION}" 2>"${TEMP_DIR}/cdn.stderr"
  then
    update_log installer.stage.succeeded source.jsdelivr 0 '' ''
    USED_CDN=1
    TARGET_COMMIT=$(node -p 'require(process.argv[1]).revision' "${TEMP_DIR}/cdn-source/dsh-tavern-runtime.json")
  else
    update_log installer.stage.failed source.jsdelivr 1 '' "${TEMP_DIR}/cdn.stderr"
    cat "${TEMP_DIR}/cdn.stderr" >&2
    echo "jsDelivr 备用源不可用，将回退到精简运行压缩包。" >&2
  fi
fi

if [ "${USED_GIT}" -eq 0 ] && [ "${USED_ARCHIVE}" -eq 0 ] && [ "${USED_CDN}" -eq 0 ]; then
  fail "Git、GitHub 压缩包与 jsDelivr 均未能取到源码，请检查网络后重试。"
fi
mkdir -p "${TEMP_DIR}/extract"
if [ "${USED_CDN}" -eq 1 ]; then
  SOURCE_DIR=${TEMP_DIR}/cdn-source
elif [ "${USED_GIT}" -eq 1 ]; then
  tar -xf "${TEMP_DIR}/app.tar" -C "${TEMP_DIR}/extract"
  SOURCE_DIR=${TEMP_DIR}/extract
else
  tar -xzf "${TEMP_DIR}/app.tar.gz" -C "${TEMP_DIR}/extract" --exclude='*/docs' --exclude='*/docs/*'
  SOURCE_DIR=$(find "${TEMP_DIR}/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
fi
[ -n "${SOURCE_DIR}" ] || fail "下载内容不完整。"
[ -f "${SOURCE_DIR}/package.json" ] || fail "下载内容不完整。"

# The downloaded release supplies process-tree supervision. Older release
# archives remain usable; current releases bound every mutating package stage.
assert_installation_active() {
  node "${TEMP_DIR}/installation-state.cjs" check --home "$DSH_ROOT" --attempt "$DSH_TAVERN_INSTALL_ATTEMPT"
}
run_install() {
  install_step=$1
  install_timeout=$2
  shift 2
  install_supervisor=${SOURCE_DIR}/bin/installation-process.mjs
  if [ -f "$install_supervisor" ]; then
    node "$install_supervisor" --run "$install_step" "$install_timeout" "$@"
  else
    "$@"
  fi
}

# Read the downloaded release's version, not the bootstrap script's or npm's latest.
ADAPTED_DSH_VERSION=$(node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --version)
node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --notice "${INSTALL_HOST}"
if [ "${INSTALL_HOST}" = "cli" ]; then
  set --
  INSTALLED_PNPM_VERSION=$(run_install dependencies.version 30000 pnpm --version 2>/dev/null || true)
  assert_installation_active
  if [ "${INSTALLED_PNPM_VERSION}" != "${PNPM_VERSION}" ]; then
    set -- "$@" "pnpm@${PNPM_VERSION}"
  fi
  if [ "$#" -gt 0 ]; then
    echo "正在安装缺失依赖：$*……"
    mkdir -p "${RUNTIME_ROOT}"
    run_install tooling.install 600000 npm install --global --prefix "${RUNTIME_ROOT}" "$@"
  fi
fi
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm。Desktop 版请先安装官方 DeepSeek Harness，再重新运行安装命令。"
[ "${INSTALL_HOST}" = "cli" ] || command -v dsh >/dev/null 2>&1 || fail "未找到 DSH。Desktop 版请先安装官方 DeepSeek Harness，再重新运行安装命令。"

# Validate the downloaded release against the host before replacing any app files.
if [ "${INSTALL_HOST}" != "cli" ]; then
  CURRENT_DSH_VERSION=$(run_install host.version 30000 dsh --version) || fail "无法读取宿主 DSH 版本。"
  node "${SOURCE_DIR}/bin/dsh-compatibility.mjs" --check "${INSTALL_HOST}" "${CURRENT_DSH_VERSION}"
fi

STAGER=${SOURCE_DIR}/bin/staged-app-install.mjs
if [ "${INSTALL_HOST}" = "cli" ] && [ -f "${STAGER}" ]; then
  # Prepare beside the running app; only the final switch stops the service, and a
  # failure after it restores the previous directory (see bin/staged-app-install.mjs).
  echo "正在准备新版本（当前版本继续运行）……"
  STAGED_INSTALL=1
  node "${STAGER}" prepare --app "${APP_DIR}" --source "${SOURCE_DIR}" --commit "${TARGET_COMMIT}" >/dev/null

  echo "正在安装程序依赖……"
  run_install dependencies.install 600000 pnpm --dir "${APP_DIR}.staging" install --frozen-lockfile --config.minimum-release-age=0

  if [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
    PREVIOUS_APP=1
    DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
  fi
  APP_SWAPPED=1
  node "${STAGER}" swap --app "${APP_DIR}"
  # Re-link in place: Windows junctions and pnpm metadata record absolute paths.
  run_install dependencies.relink 300000 pnpm --dir "${APP_DIR}" install --frozen-lockfile --offline --config.minimum-release-age=0

  echo "正在配置 Tavern……"
  DSH_HOME=${DSH_ROOT} run_install profile.install 1200000 node "${APP_DIR}/bin/dsh-tavern.mjs" install --host "${INSTALL_HOST}"
  node "${STAGER}" commit --app "${APP_DIR}"
  APP_SWAPPED=0
else
  if [ "${INSTALL_HOST}" = "cli" ] && [ -f "${APP_DIR}/bin/dsh-tavern.mjs" ]; then
    DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" stop >/dev/null 2>&1 || true
  fi

  mkdir -p "${APP_DIR}"
  # 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data/ 用户数据会保留。
  # 新版本自带的清理脚本只删除上次安装放入、而新版本已不再包含的文件；失败不影响安装。
  if [ -f "${SOURCE_DIR}/bin/prune-installed-files.mjs" ]; then
    node "${SOURCE_DIR}/bin/prune-installed-files.mjs" "${SOURCE_DIR}" "${APP_DIR}" || echo "警告：旧版本遗留文件清理失败，继续安装。" >&2
  fi
  cp -R "${SOURCE_DIR}/." "${APP_DIR}/"
  if [ "${USED_CDN}" -eq 1 ]; then rm -f -- "${APP_DIR}/.dsh-tavern-release.json"; fi
  case ${TARGET_COMMIT} in
    *[!0-9a-fA-F]*|'') ;;
    ????????????????????????????????????????)
      printf '{"commit":"%s","installedAt":"%s"}\n' "${TARGET_COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${APP_DIR}/.dsh-tavern-release.json"
      ;;
  esac

  echo "正在安装程序依赖……"
  run_install dependencies.install 600000 pnpm --dir "${APP_DIR}" install --frozen-lockfile --config.minimum-release-age=0

  echo "正在配置 Tavern……"
  DSH_HOME=${DSH_ROOT} run_install profile.install 1200000 node "${APP_DIR}/bin/dsh-tavern.mjs" install --host "${INSTALL_HOST}"
fi

if [ "${INSTALL_HOST}" = "desktop" ]; then
  echo "DSH Tavern Desktop 版安装完成。"
  echo "请重启官方 DeepSeek Harness，酒馆已安装到独立 tavern 配置；原版 desktop 已备份，可在设置 → Profile 切换中切换。"
else
  if [ "${DSH_TAVERN_DEFER_SERVICE_START:-0}" != "1" ]; then
    DSH_HOME=${DSH_ROOT} node "${APP_DIR}/bin/dsh-tavern.mjs" start
  fi
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

INSTALL_COMPLETED=1
