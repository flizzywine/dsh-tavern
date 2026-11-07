import { execFile } from 'node:child_process'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { checkPluginCompatibility } from './plugin-compatibility.js'

const execFileAsync = promisify(execFile)
export const REPOSITORY_URL = 'https://github.com/weixinlll/dsh-tavern-image'
const LEGACY_REPOSITORY_URL = 'https://github.com/weixinlll/dsh-tavern-comfy'
const LEGACY_PLUGIN_DIRECTORY = 'dsh-tavern-comfy'
const PLUGIN_DIRECTORY = 'dsh-tavern-image'
const BRANCH = 'master'
const HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const PRIVATE_PATH = /^(?:card-worldbook\.json|card-enabled\.json|workflows-card(?:\/|$)|skills\/image-prompt\/references(?:\/|$)|config\.json|definitions\.json|worldbook(?:-outfits)?\.json|jobs-store\.json|plans-store\.json|backups(?:\/|$)|cache(?:\/|$)|reference-images(?:\/|$)|format-worldbooks(?:\/|$)|workflows\/.*\.json$)/i

async function runGit(root, args) {
  try {
    const result = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    })
    return result.stdout.trim()
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到 Git，请安装 Git 后重试。')
    if (error.killed || error.code === 'ETIMEDOUT') throw new Error('更新请求超时，请检查网络后重试。')
    // 不把命令输出返回浏览器，避免远端地址或本机路径泄露。
    throw new Error('Git 操作失败，请检查网络及插件目录后重试。')
  }
}

function ownRepository(remote) {
  return [
    REPOSITORY_URL, REPOSITORY_URL + '.git', 'git@github.com:weixinlll/dsh-tavern-image.git',
    LEGACY_REPOSITORY_URL, LEGACY_REPOSITORY_URL + '.git', 'git@github.com:weixinlll/dsh-tavern-comfy.git',
  ].includes(remote)
}

function renamedDirectory(root) {
  const current = resolve(root)
  return basename(current).toLowerCase() === LEGACY_PLUGIN_DIRECTORY
    ? join(dirname(current), PLUGIN_DIRECTORY)
    : ''
}

async function pathExists(path) {
  try { await stat(path); return true }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function ownGitMetadataExists(root) {
  try {
    await lstat(resolve(root, '.git'))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** Update an independent official Git checkout with fast-forward, or a bundled Release installation. */
export function createPluginUpdater({
  root,
  git = args => runGit(root, args),
  now = Date.now,
  getApiVersion = () => undefined,
  fetchImpl = globalThis.fetch,
}) {
  const gitMetadata = ownGitMetadataExists(root)
  const packageMetadata = readFile(resolve(root, 'package.json'), 'utf8')
    .then(source => JSON.parse(source))
    .catch(() => ({}))
  const version = packageMetadata.then(pkg => String(pkg.version || '未知'))
  let releaseUpdaterPromise
  let releaseCompatibility = null
  let checked = null
  let installed = null
  let busy = false
  let restartRequired = false

  async function releaseUpdater() {
    if (await gitMetadata) return null
    if (!releaseUpdaterPromise) {
      releaseUpdaterPromise = import('./release-updater.js').then(({ createReleaseUpdater }) => createReleaseUpdater({
        root,
        fetchImpl,
        now,
        checkCompatibility: async pkg => {
          releaseCompatibility = await checkPluginCompatibility(pkg, getApiVersion())
          return releaseCompatibility
        },
      }))
    }
    return releaseUpdaterPromise
  }

  async function inspect() {
    const currentVersion = await version
    const compatibility = await checkPluginCompatibility(await packageMetadata, getApiVersion())
    const directoryMigrationRequired = Boolean(renamedDirectory(root))
    const directoryMigrationMessage = directoryMigrationRequired
      ? '旧版安装仍在 dsh-tavern-comfy 目录。请先完全退出 DSH，再将该文件夹改名为 dsh-tavern-image，然后重新启动。'
      : ''
    const common = {
      ok: true, mode: 'git', compatibility, currentVersion, repositoryUrl: REPOSITORY_URL,
      restartRequired, directoryMigrationRequired, directoryMigrationMessage,
    }
    try {
      const top = await git(['rev-parse', '--show-toplevel'])
      const [actual, expected] = await Promise.all([realpath(top), realpath(root)])
      const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
      if (normalize(actual) !== normalize(expected)) return { ...common, supported: false, canUpdate: false, reason: '此目录不是独立的 Git 安装，请从项目页面下载更新。' }
      if (!ownRepository(await git(['remote', 'get-url', 'origin']))) return { ...common, supported: false, canUpdate: false, reason: '插件来源与官方项目不一致，请手动核对更新。' }
      if (await git(['branch', '--show-current']) !== BRANCH) return { ...common, supported: false, canUpdate: false, reason: '当前不在 master 分支，请手动更新。' }
      const targetDirectory = renamedDirectory(root)
      if (targetDirectory && await pathExists(targetDirectory)) return { ...common, supported: false, canUpdate: false, reason: '新插件目录已存在。请先合并或移走该目录，再更新旧安装。' }
      const head = await git(['rev-parse', 'HEAD'])
      if (!HASH.test(head)) throw new Error('无法确认本地代码版本。')
      const dirty = Boolean(await git(['status', '--porcelain', '--untracked-files=no']))
      const reason = !compatibility.compatible
        ? compatibility.reason
        : restartRequired
          ? '更新已安装，请完整重启 DSH。'
          : dirty
            ? '插件代码有本地改动，请先处理改动再更新。'
            : directoryMigrationMessage
      return {
        ...common,
        supported: true,
        canUpdate: !dirty && !restartRequired && compatibility.compatible,
        head,
        reason,
      }
    } catch (error) {
      return { ...common, supported: false, canUpdate: false, reason: error.message }
    }
  }

  async function exclusive(action) {
    if (busy) throw new Error('正在检查或更新，请稍后再试。')
    busy = true
    try { return await action() } finally { busy = false }
  }

  async function check() {
    const adapter = await releaseUpdater()
    if (adapter) {
      const result = await adapter.check()
      return { ...result, mode: 'release', compatibility: releaseCompatibility }
    }
    return exclusive(async () => {
      checked = null
      const local = await inspect()
      if (!local.supported || !local.canUpdate || restartRequired || !local.compatibility.compatible) {
        return { ...local, available: false, canUpdate: false, reason: local.compatibility.reason || local.reason }
      }
      await git(['fetch', '--no-tags', 'origin', BRANCH])
      const target = await git(['rev-parse', 'FETCH_HEAD'])
      if (!HASH.test(target)) throw new Error('无法确认远端代码版本。')
      const pkg = JSON.parse(await git(['show', target + ':package.json']))
      if (!['dsh-tavern-comfy', 'dsh-tavern-image'].includes(pkg.name) || typeof pkg.version !== 'string') throw new Error('远端不是有效的插件版本。')
      const compatibility = await checkPluginCompatibility(pkg, getApiVersion())
      const available = target !== local.head
      const result = { ...local, latestVersion: pkg.version, available, target, checkedAt: now(), compatibility }
      if (!compatibility.compatible) return { ...result, canUpdate: false, reason: compatibility.reason }
      if (!available) return { ...result, canUpdate: false, reason: local.reason || '当前代码已是最新版本。' }
      const base = await git(['merge-base', 'HEAD', target])
      if (base !== local.head) return { ...result, canUpdate: false, reason: '本地提交与远端不同，请手动合并后更新。' }
      // NUL paths avoid Git's quoted filenames bypassing the private-directory
      // check. Disabling rename detection includes both the deleted source and
      // added destination, so moving a private file cannot hide its old path.
      const paths = (await git(['diff', '--name-only', '--no-renames', '-z', local.head, target])).split('\0').filter(Boolean)
      if (paths.some(path => PRIVATE_PATH.test(path))) return { ...result, canUpdate: false, reason: '远端改动包含用户数据路径，已停止自动更新。' }
      checked = { ...result, canUpdate: local.canUpdate, base: local.head }
      return { ...result, canUpdate: local.canUpdate }
    })
  }

  async function apply(target) {
    const adapter = await releaseUpdater()
    if (adapter) {
      const result = await adapter.apply(target)
      return { ...result, mode: 'release', compatibility: releaseCompatibility }
    }
    return exclusive(async () => {
      // 安装响应丢失后的同版本重试只返回结果，不再次改动代码。
      if (installed && target === installed.target) return installed
      if (!checked || typeof target !== 'string' || target !== checked.target || !checked.available || !checked.canUpdate) {
        throw new Error('请先检查更新，再安装检查到的版本。')
      }
      const local = await inspect()
      if (!local.supported || !local.canUpdate) throw new Error(local.reason || '当前无法更新。')
      if (!local.compatibility.compatible) throw new Error(local.compatibility.reason)
      if (local.head !== checked.base) {
        checked = null
        throw new Error('本地代码已变化，请重新检查更新。')
      }

      // Re-read the immutable checked commit metadata and live host API immediately before merge.
      const remotePkg = JSON.parse(await git(['show', target + ':package.json']))
      const compatibility = await checkPluginCompatibility(remotePkg, getApiVersion())
      if (!compatibility.compatible) throw new Error(compatibility.reason)

      // 只允许 fast-forward；不会 reset/clean，也不会覆盖未跟踪的用户文件。
      await git(['merge', '--ff-only', '--no-edit', target])
      if (await git(['rev-parse', 'HEAD']) !== target) throw new Error('更新结果未能确认，请检查插件目录。')
      let migrationMessage = ''
      if (renamedDirectory(root)) {
        try { await git(['remote', 'set-url', 'origin', REPOSITORY_URL + '.git']) }
        catch { migrationMessage = '代码已更新，但远端地址仍是旧地址。' }
        migrationMessage += '请完整退出 DSH 后，将插件文件夹 dsh-tavern-comfy 改名为 dsh-tavern-image，再重新启动。不要在 DSH 运行时改目录。'
      }
      restartRequired = true
      const message = [migrationMessage, '更新已安装，请完整关闭并重启 DSH 后使用新版。'].filter(Boolean).join(' ')
      installed = { ...checked, available: false, canUpdate: false, restartRequired, message, reason: message }
      return installed
    })
  }

  async function status() {
    const adapter = await releaseUpdater()
    if (adapter) {
      const result = await adapter.status()
      return {
        ...result,
        mode: 'release',
        compatibility: await checkPluginCompatibility(await packageMetadata, getApiVersion()),
      }
    }
    return inspect()
  }

  return { status, check, apply }
}
