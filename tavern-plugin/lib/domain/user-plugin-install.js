import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readZipEntries } from './zip-entries.js'
import { DISABLED_FILE, RESTART_FILE, scanUserPlugins, STATUS_FILE, userPluginPaths } from './user-plugins.js'
import { pluginDataFile } from './plugin-data-store.js'
import { pluginManifestProblem } from './plugin-manifest.js'

// 应用内安装插件：粘贴 GitHub 地址或上传 zip，放进 <data>/plugins/<文件夹>；
// 之后的加载仍由 plugins/ 目录同步负责（宿主侧几秒内加载，浏览器侧刷新后出现）。
export const SOURCE_FILE = '.tavern-source.json'
const CARD_MARKER = '.dsh-card.json'
const SKIP = new Set(['.git', '.github', 'node_modules/.cache', '.tavern-disabled', '.tavern-status.json', '.tavern-restart.json'])
const RELEASE_TTL = 5 * 60 * 1000

const fail = message => { throw Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INSTALL' }) }

/** owner/repo、https://github.com/owner/repo(.git)、…/tree/<分支或标签> → { owner, repo, ref } */
export function parseGithubSource(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(raw)
  if (short) return { owner: short[1], repo: short[2], ref: null }
  let url
  try { url = new URL(raw) } catch { fail('请粘贴 GitHub 仓库地址，例如 https://github.com/作者/仓库') }
  if (url.protocol !== 'https:' || !/^(www\.)?github\.com$/i.test(url.hostname)) fail('只支持 https://github.com/ 上的仓库地址；其他来源请下载 zip 后上传')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) fail('地址里缺少作者或仓库名')
  const ref = parts[2] === 'tree' && parts.length > 3 ? decodeURIComponent(parts.slice(3).join('/')) : null
  return { owner: parts[0], repo: parts[1], ref }
}

async function fetchOk(fetchImpl, url, accept, signal) {
  let response
  try { response = await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': 'dsh-tavern' }, redirect: 'follow', ...(signal ? { signal } : {}) }) }
  catch (error) { fail('连不上 GitHub（' + (error?.cause?.code || error?.message || error) + '）。网络不通时，可以在仓库页面下载 ZIP 后上传') }
  return response
}

/**
 * Compare two plugin version strings ("0.2.2", "v0.2.2", "1.0.0-beta.1").
 * Returns 1 when left is newer, -1 when older, 0 when the same, null when either is not a version.
 */
export function comparePluginVersions(left, right) {
  const parse = value => {
    const text = String(value || '').trim().replace(/^v(?=\d)/i, '').split('+')[0]
    const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
    if (!match) return null
    return { core: match[1].split('.').map(Number), pre: match[2] ? match[2].split('.') : [] }
  }
  const a = parse(left), b = parse(right)
  if (!a || !b) return null
  const length = Math.max(a.core.length, b.core.length)
  for (let index = 0; index < length; index++) {
    const x = a.core[index] || 0, y = b.core[index] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  const prereleaseLength = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < prereleaseLength; index++) {
    const x = a.pre[index], y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numeric = /^\d+$/.test(x), otherNumeric = /^\d+$/.test(y)
    if (numeric && otherNumeric) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
    } else if (numeric !== otherNumeric) return numeric ? -1 : 1
    else if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 有 Release 用最新 Release，否则用默认分支；地址里写了分支或标签就用它。 */
export async function downloadGithubPlugin(source, { fetchImpl = fetch } = {}) {
  const base = `https://api.github.com/repos/${source.owner}/${source.repo}`
  let ref = source.ref, label = source.ref ? source.ref : '默认分支'
  if (!ref) {
    const latest = await fetchOk(fetchImpl, base + '/releases/latest', 'application/vnd.github+json')
    if (latest.ok) { const release = await latest.json(); ref = release.tag_name; label = 'Release ' + release.tag_name }
    else if (latest.status !== 404) fail('读取仓库发布信息失败（HTTP ' + latest.status + (latest.status === 403 ? '，可能是 GitHub 访问次数受限，稍后再试或上传 ZIP' : '') + '）')
  }
  const archive = await fetchOk(fetchImpl, base + '/zipball' + (ref ? '/' + encodeURIComponent(ref) : ''), 'application/vnd.github+json')
  if (archive.status === 404) fail('找不到仓库 ' + source.owner + '/' + source.repo + (source.ref ? ' 的 ' + source.ref : '') + '，请检查地址，或确认仓库是公开的')
  if (!archive.ok) fail('下载插件失败（HTTP ' + archive.status + '）')
  return { bytes: Buffer.from(await archive.arrayBuffer()), ref: ref || 'HEAD', label }
}

function hostEntryOf(pkg) {
  const exportsField = pkg.exports
  return typeof exportsField === 'string' ? exportsField
    : typeof exportsField?.['.'] === 'string' ? exportsField['.']
      : exportsField?.['.']?.import || exportsField?.['.']?.default || (typeof pkg.main === 'string' ? pkg.main : '')
}

/** zip 里找到插件根（最浅的 package.json），检查能不能当 Tavern 插件装。 */
export function readPluginArchive(bytes) {
  const entries = readZipEntries(bytes, { label: '插件 ZIP' })
  const manifests = [...entries.keys()].filter(name => /(^|\/)package\.json$/.test(name) && !name.includes('node_modules/'))
    .sort((left, right) => left.split('/').length - right.split('/').length)
  if (!manifests.length) fail('压缩包里没有 package.json，不是 Tavern 插件')
  const root = manifests[0].slice(0, -'package.json'.length)
  let pkg
  try { pkg = JSON.parse(entries.get(manifests[0]).toString('utf8')) } catch (error) { fail('package.json 无法解析：' + error.message) }
  const manifestProblem = pluginManifestProblem(pkg)
  if (manifestProblem) fail(manifestProblem)
  const files = new Map()
  for (const [name, data] of entries) {
    if (!name.startsWith(root) || name.endsWith('/')) continue
    const relative = name.slice(root.length)
    if (!relative || relative.split('/').some(part => part === '..' || part === '') || path.isAbsolute(relative)) continue
    if ([...SKIP].some(prefix => relative === prefix || relative.startsWith(prefix + '/'))) continue
    files.set(relative, data)
  }
  const main = hostEntryOf(pkg)
  if (!main) fail('package.json 没有写宿主入口（exports "." 或 main），不是 Tavern 插件')
  if (!files.has(path.posix.normalize(main.replace(/^\.\//, '')))) fail('找不到宿主入口 ' + main)
  const dependencies = Object.keys(pkg.dependencies || {})
  const bundled = [...files.keys()].some(name => name.startsWith('node_modules/'))
  if (dependencies.length && !bundled) fail('这个插件依赖 npm 包（' + dependencies.slice(0, 5).join('、') + (dependencies.length > 5 ? ' 等' : '') + '），暂不支持一键安装。请联系作者把依赖打包进插件，或按作者的说明手动安装')
  return { pkg, files }
}

function folderFor(pkg, fallback) {
  const name = String(pkg.name || fallback || '').replace(/^@[^/]+\//, '')
  const folder = name.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80)
  if (!folder) fail('插件没有可用的名字（package.json 的 name）')
  return folder
}

async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null } }

export function createUserPluginInstaller({ dataRoot, fetchImpl = fetch, now = () => new Date(), sync = async () => {} }) {
  const paths = userPluginPaths(dataRoot)
  const backups = path.join(path.resolve(dataRoot), 'plugin-backups')
  const installedPackage = name => existsSync(path.join(paths.profile, 'node_modules', ...name.split('/'), 'package.json'))
  let tail = Promise.resolve()
  const serial = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run }
  const stamp = () => now().toISOString().replace(/[:.]/g, '-')
  const time = () => { const value = now(); return value instanceof Date ? value.getTime() : Number(value) }
  // Settings asks on every open; one call per repository every few minutes is enough for GitHub's rate limit.
  const releases = new Map()

  async function latestRelease(source) {
    const key = source.owner + '/' + source.repo
    const cached = releases.get(key)
    if (cached && time() - cached.at < RELEASE_TTL) return cached.value
    const response = await fetchOk(fetchImpl, `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`, 'application/vnd.github+json', AbortSignal.timeout(5000))
    let value
    if (response.status === 404) value = { status: 'none' }
    else if (!response.ok) value = { status: 'error', reason: '读取发布信息失败（HTTP ' + response.status + '）' }
    else {
      const release = await response.json()
      value = { status: 'release', tag: String(release?.tag_name || '') }
    }
    if (value.status !== 'error') releases.set(key, { at: time(), value })
    return value
  }

  // Older installs did not record whether they replaced an existing folder. A backup holding a
  // successful load record proves these files replaced a plugin DSH was already running.
  async function replacedLoadedPlugin(folder) {
    let names = []
    try { names = await readdir(backups) } catch { return false }
    for (const name of names.filter(name => name.startsWith(folder + '-')).sort().reverse().slice(0, 3)) {
      const status = await readJson(path.join(backups, name, STATUS_FILE))
      if (status?.ok === true) return true
    }
    return false
  }

  function folderOf(folder) {
    const name = String(folder)
    if (!name || name !== path.basename(name) || name.startsWith('.') || !existsSync(path.join(paths.plugins, name))) fail('插件不存在：' + name)
    return name
  }

  async function backup(folder) {
    await mkdir(backups, { recursive: true })
    const base = path.join(backups, folder + '-' + stamp())
    let target = base
    for (let index = 2; existsSync(target); index++) target = base + '-' + index
    await rename(path.join(paths.plugins, folder), target)
    return target
  }

  async function place({ pkg, files }, source, fallbackName) {
    const folder = folderFor(pkg, fallbackName)
    if (pkg.name && installedPackage(String(pkg.name))) fail('插件名 ' + pkg.name + ' 与已安装的包重名，不能装进 plugins/')
    const target = path.join(paths.plugins, folder)
    if (existsSync(path.join(target, CARD_MARKER))) fail('plugins/' + folder + ' 是人物卡自带的插件，由人物卡库管理，不能覆盖')
    // Updating or reinstalling a disabled plugin must not switch it back on behind the user's back.
    const wasDisabled = existsSync(path.join(target, DISABLED_FILE))
    // DSH keeps the old module loaded until it restarts, so the new files are not running yet.
    const wasInstalled = existsSync(target)
    const previous = wasInstalled ? await readJson(path.join(target, 'package.json')) || {} : {}
    await mkdir(paths.plugins, { recursive: true })
    const staging = path.join(paths.plugins, '.installing-' + folder + '-' + process.pid)
    await rm(staging, { recursive: true, force: true })
    try {
      for (const [relative, data] of files) {
        const file = path.join(staging, ...relative.split('/'))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, data)
      }
      await writeFile(path.join(staging, SOURCE_FILE), JSON.stringify({ ...source, version: String(pkg.version || ''), replaced: wasInstalled, installedAt: now().toISOString() }, null, 2) + '\n')
      if (wasDisabled) await writeFile(path.join(staging, DISABLED_FILE), JSON.stringify({ disabledAt: now().toISOString(), keptAcrossUpdate: true }, null, 2) + '\n')
      if (wasInstalled) await writeFile(path.join(staging, RESTART_FILE), JSON.stringify({ updatedAt: now().toISOString(), previousVersion: String(previous.version || ''), version: String(pkg.version || '') }, null, 2) + '\n')
      const replaced = wasInstalled ? await backup(folder) : null
      await rename(staging, target)
      // The next settings visit should read the Release again, not a cached "available".
      releases.clear()
      await sync()
      return { folder, name: String(pkg.name || folder), version: String(pkg.version || ''), replaced: Boolean(replaced) }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  return {
    pluginsDir: paths.plugins,
    async list() {
      const { plugins, problems, disabled } = await scanUserPlugins(paths.plugins, { installed: installedPackage })
      let folders = []
      try { folders = (await readdir(paths.plugins, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() } catch {}
      return Promise.all(folders.map(async folder => {
        const dir = path.join(paths.plugins, folder)
        const pkg = await readJson(path.join(dir, 'package.json')) || {}
        const problem = problems.find(item => item.folder === folder)
        const status = problem || disabled.includes(folder) ? null : await readJson(path.join(dir, STATUS_FILE))
        const restart = problem || disabled.includes(folder) ? null : await readJson(path.join(dir, RESTART_FILE))
        const card = await readJson(path.join(dir, CARD_MARKER))
        const isDisabled = disabled.includes(folder)
        const source = pkg.name === 'dsh-tavern-image' ? { kind: 'builtin' } : card ? (card.managed === true ? { kind: 'managed', modId: card.modId, builtin: ['dsh.danmaku','dsh.dice','dsh.phone','dsh.textcard','dsh.timer'].includes(card.modId) } : { kind: 'card' }) : await readJson(path.join(dir, SOURCE_FILE)) || { kind: 'folder' }
        // Install sources from before the replaced flag: infer a past replacement from the backup's load record.
        const replacedBefore = !isDisabled && !problem && source.replaced === undefined && !status && !restart && (source.kind === 'github' || source.kind === 'zip')
          ? await replacedLoadedPlugin(folder)
          : false
        return {
          folder, name: String(pkg.name || folder), version: String(pkg.version || ''), description: String(pkg.description || ''),
          source,
          enabled: !isDisabled,
          // An update replaces the folder while DSH keeps the old module; only a restart loads the new files.
          state: isDisabled ? 'disabled' : problem ? 'skipped' : status?.ok === false ? 'failed' : restart || replacedBefore ? 'restart' : status?.ok === true ? 'loaded' : plugins.some(item => item.folder === folder) ? 'pending' : 'skipped',
          reason: isDisabled ? '' : problem ? problem.reason : status?.ok === false ? status.stage + '失败：' + status.message : '',
        }
      }))
    },
    /**
     * A GitHub plugin tracks a Release only when it was installed without an explicit ref.
     * Compare that Release with the installed package.json version so the settings list can
     * say "已是最新" instead of offering an update that changes nothing.
     */
    async checkUpdates({ fresh = false } = {}) {
      // 手动点「检查更新」时跳过缓存，确实去 GitHub 看一眼。
      if (fresh) releases.clear()
      let folders = []
      try { folders = (await readdir(paths.plugins, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() } catch {}
      const checked = await Promise.all(folders.map(async folder => {
        const dir = path.join(paths.plugins, folder)
        const source = await readJson(path.join(dir, SOURCE_FILE))
        if (source?.kind !== 'github' || !source.repo) return null
        const pkg = await readJson(path.join(dir, 'package.json')) || {}
        const current = String(pkg.version || '')
        if (source.ref) return { folder, current, status: 'ref' }
        let parsed
        try { parsed = parseGithubSource(source.repo) } catch { return { folder, current, status: 'error', reason: '来源地址无法识别' } }
        try {
          const release = await latestRelease(parsed)
          if (release.status === 'none') return { folder, current, status: 'branch' }
          if (release.status === 'error') return { folder, current, status: 'error', reason: release.reason }
          const latest = release.tag
          const relation = comparePluginVersions(latest, current)
          if (relation === null) return { folder, current, latest, status: 'unknown' }
          return { folder, current, latest, status: relation > 0 ? 'available' : 'latest' }
        } catch (error) {
          return { folder, current, status: 'error', reason: String(error?.message || error) }
        }
      }))
      return checked.filter(Boolean)
    },
    enable(folder) {
      return serial(async () => {
        const name = folderOf(folder)
        const manifestProblem = pluginManifestProblem(await readJson(path.join(paths.plugins, name, 'package.json')))
        if (manifestProblem) fail(manifestProblem)
        await rm(path.join(paths.plugins, name, DISABLED_FILE), { force: true })
        // Drop the old load record so the list shows "刷新后生效" until the host loads it again.
        await rm(path.join(paths.plugins, name, STATUS_FILE), { force: true })
        await sync()
        return { folder: name, enabled: true }
      })
    },
    disable(folder) {
      return serial(async () => {
        const name = folderOf(folder)
        if (existsSync(path.join(paths.plugins, name, CARD_MARKER))) fail('这是人物卡自带的插件，请在人物卡库里停用')
        await writeFile(path.join(paths.plugins, name, DISABLED_FILE), JSON.stringify({ disabledAt: now().toISOString() }, null, 2) + '\n')
        await rm(path.join(paths.plugins, name, STATUS_FILE), { force: true })
        await sync()
        return { folder: name, enabled: false }
      })
    },
    installFromGithub(input) {
      return serial(async () => {
        const source = parseGithubSource(input)
        const downloaded = await downloadGithubPlugin(source, { fetchImpl })
        return place(readPluginArchive(downloaded.bytes), { kind: 'github', repo: source.owner + '/' + source.repo, ref: source.ref, resolved: downloaded.label }, source.repo)
      })
    },
    installFromZip(bytes, fileName) {
      return serial(async () => place(readPluginArchive(bytes), { kind: 'zip', file: String(fileName || '') }, String(fileName || '').replace(/\.zip$/i, '')))
    },
    update(folder) {
      return serial(async () => {
        const source = await readJson(path.join(paths.plugins, String(folder), SOURCE_FILE))
        if (source?.kind !== 'github') fail('这个插件不是从 GitHub 地址装的，没法自动更新；请重新上传新版 ZIP')
        const parsed = parseGithubSource(source.repo)
        parsed.ref = source.ref || null
        const downloaded = await downloadGithubPlugin(parsed, { fetchImpl })
        return place(readPluginArchive(downloaded.bytes), { kind: 'github', repo: source.repo, ref: source.ref || null, resolved: downloaded.label }, parsed.repo)
      })
    },
    remove(folder) {
      return serial(async () => {
        const name = folderOf(folder)
        if (existsSync(path.join(paths.plugins, name, CARD_MARKER))) fail('这是人物卡自带的插件，请在人物卡库里停用')
        const pkg = await readJson(path.join(paths.plugins, name, 'package.json'))
        if (pkg?.name === 'dsh-tavern-image') fail('这是内置配图插件，随酒馆提供，不可删除')
        const kept = await backup(name)
        // The plugin's own data goes into the same backup, so reinstalling from there brings it back by hand.
        const data = pluginDataFile(dataRoot, String(pkg?.name || name))
        if (existsSync(data)) await rename(data, path.join(kept, '.plugin-data.json'))
        await sync()
        return { folder: name, backup: kept }
      })
    },
  }
}
