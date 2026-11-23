import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { readZipEntries } from './zip-entries.js'
import { openZipFile } from './zip-file.js'
import { DISABLED_FILE, RESTART_FILE, scanUserPlugins, STATUS_FILE, userPluginPaths } from './user-plugins.js'
import { pluginDataFile } from './plugin-data-store.js'
import { comparePluginVersions, pluginManifestProblem } from './plugin-manifest.js'
import { bundledPluginRelease, bundledPluginRuntimeFiles, bundledPluginVendorHashes, bundledReleaseCompatibilityProblem } from './bundled-plugin-release.js'
// The first-party mods (one per tavern-plugin/mods folder); their managed copies are listed as built in.
import { firstPartyManifestIds } from '../mod-system-distributions.js'

// 应用内安装插件：粘贴 GitHub 地址或上传 zip，放进 <data>/plugins/<文件夹>；
// 之后的加载仍由 plugins/ 目录同步负责（宿主侧几秒内加载，浏览器侧刷新后出现）。
export const SOURCE_FILE = '.tavern-source.json'
export { comparePluginVersions }
const CARD_MARKER = '.dsh-card.json'
const SKIP = new Set(['.git', '.github', 'node_modules/.cache', '.tavern-disabled', '.tavern-status.json', '.tavern-restart.json'])
const RELEASE_TTL = 5 * 60 * 1000
// codeload 下载不像 GitHub API 那样有超时保护：连不上或 body 一直不发数据时，
// 安装 RPC 会永远不返回，设置页的「处理中…」也就永久锁住。给整段下载一个有界的截止时间。
const ARCHIVE_TIMEOUT_MS = 120 * 1000
const DOWNLOAD_HINT = '网络不通时，可以在仓库页面下载 ZIP 后上传'
const ZIP_ACCEPT = 'application/zip, application/octet-stream'
export const PLUGIN_ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
})

// jsDelivr 不给整包 ZIP，只能「文件列表 + 逐个文件」地取，所以回退路径自己拼插件目录。
// 20 MB 是 CDN 的单文件上限；总量沿用 ZIP 解压后的上限，别让回退绕过体积限制。
const JSDELIVR_API = 'https://data.jsdelivr.com/v1/packages/gh'
const JSDELIVR_CDN = 'https://cdn.jsdelivr.net/gh'
const JSDELIVR_MAX_FILE = 20 * 1024 * 1024
const JSDELIVR_MAX_TOTAL = 150 * 1024 * 1024
const JSDELIVR_CONCURRENCY = 6
const JSDELIVR_FILE_TIMEOUT_MS = 20 * 1000

const fail = (message, extra) => { throw Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INSTALL' }, extra) }

async function withDeadline(work, milliseconds, message, extra) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INSTALL' }, extra))
        }, milliseconds)
      }),
    ])
  } finally { clearTimeout(timer) }
}

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

// 没给 accept 时不写这个请求头：Headers 会把 undefined 变成字面量 "undefined"，
// 有的代理遇到它会挂起或重置连接（#592）。
async function fetchOk(fetchImpl, url, accept, signal, host = 'GitHub') {
  const headers = { ...(accept ? { Accept: accept } : {}), 'User-Agent': 'dsh-tavern' }
  let response
  try { response = await fetchImpl(url, { headers, redirect: 'follow', ...(signal ? { signal } : {}) }) }
  catch (error) { fail('连不上 ' + host + '（' + (error?.cause?.code || error?.message || error) + '）', { network: true }) }
  return response
}

// 分支名里可能带 '/'，jsDelivr 把 @ 后面的整段当 ref，编码后仍指向同一个分支或标签。
const jsdelivrVersion = source => encodeURIComponent(source.ref ? String(source.ref) : 'HEAD')

// 单个文件的超时不能盖掉整段的截止时间：谁先到都算失败。
function fileSignal(signal) {
  return signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, AbortSignal.timeout(JSDELIVR_FILE_TIMEOUT_MS)])
    : signal
}

const skippedRelative = relative => [...SKIP].some(prefix => relative === prefix || relative.startsWith(prefix + '/'))

async function* pluginZipChunks(response, expectedSize) {
  const maximum = expectedSize ?? PLUGIN_ZIP_LIMITS.maxArchiveBytes
  let size = 0
  const mismatch = () => fail(expectedSize === undefined
    ? '插件 ZIP 超过 ' + maximum / 1024 ** 2 + ' MiB'
    : '插件发布包大小与 GitHub 发布记录不符')
  if (Number(response.headers?.get?.('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {})
    mismatch()
  }
  for await (const bytes of response.body ?? [Buffer.from(await response.arrayBuffer())]) {
    size += bytes.length
    if (size > maximum) mismatch()
    yield Buffer.from(bytes)
  }
  if (expectedSize !== undefined && size !== expectedSize) mismatch()
}

// 有 Release 用最新 Release，否则用默认分支；地址里写了分支或标签就用它。
// 下载走 codeload.github.com：它不占 GitHub API 的每小时配额，本体 install.sh 也用它。
// api.github.com 只用来问「最新 Release 是哪个」，问答失败只是退回默认分支，不中断安装。
async function githubArchive(source, { fetchImpl, timeoutMs, file }) {
  const api = `https://api.github.com/repos/${source.owner}/${source.repo}`
  const archive = `https://codeload.github.com/${source.owner}/${source.repo}/zip`
  let ref = source.ref, label = source.ref ? source.ref : '默认分支', warning = ''
  if (!ref) {
    try {
      const latest = await fetchOk(fetchImpl, api + '/releases/latest', 'application/vnd.github+json', AbortSignal.timeout(5000))
      if (latest.ok) { const release = await latest.json(); ref = release.tag_name; label = 'Release ' + release.tag_name }
      // 404 是正常的无 Release；其他失败都说明降级原因。
      else if (latest.status !== 404) {
        const reason = latest.status === 403 ? 'GitHub 访问次数受限' : 'HTTP ' + latest.status
        warning = 'Release 信息暂不可用（' + reason + '），已改用默认分支'
      }
    } catch (error) {
      warning = 'Release 信息暂不可用（' + error.message + '），已改用默认分支'
    }
  }
  // ref 可能是标签也可能是分支（地址里写的是 …/tree/<名>），codeload 的裸 ref 两种都能解析；
  // 写成 refs/tags/ 会把分支名判死（/zip/refs/tags/main → 404）。
  const archiveUrl = archive + (ref ? '/' + encodeURIComponent(ref) : '/HEAD')
  // signal 同时覆盖「连不上」和「连上了但压缩包 body 一直不发数据」两种情况；
  // 超时后 abort 底层请求，避免连接一直挂着。
  try {
    const bytes = await withDeadline(async signal => {
      const response = await fetchOk(fetchImpl, archiveUrl, ZIP_ACCEPT, signal)
      if (response.status === 404) {
        // 不带 ref 时 /HEAD 已是默认分支，404 只能说明仓库不存在或不是公开的。
        if (!ref) fail('找不到仓库 ' + source.owner + '/' + source.repo + '，请检查地址，或确认仓库是公开的')
        fail('找不到仓库 ' + source.owner + '/' + source.repo + ' 的 ' + ref + '，请检查地址，或确认仓库是公开的')
      }
      if (!response.ok) fail('下载插件失败（HTTP ' + response.status + '）')
      if (file) return await pipeline(pluginZipChunks(response), createWriteStream(file, { flags: 'wx' }), { signal })
      const chunks = []
      for await (const chunk of pluginZipChunks(response)) chunks.push(chunk)
      return Buffer.concat(chunks)
    }, timeoutMs, '下载插件超时（仓库压缩包一直没下载完）', { timeout: true })
    const content = file ? { archive: await openPluginArchive(file) } : { files: readZipEntries(bytes, { label: '插件 ZIP', fail, ...PLUGIN_ZIP_LIMITS }) }
    return { ...content, ref: ref || 'HEAD', label, warning }
  } catch (error) {
    // 换线路时也要把「为什么没装成 Release」带上，不然回退成功后解释就没了。
    if (warning) error.warning = warning
    throw error
  }
}

/**
 * 备用线路：GitHub 连不上（国内网络常见只封 github.com）时改从 jsDelivr 拉同一份代码。
 * 版本用 @HEAD（jsDelivr 会解析成默认分支的最新提交）或地址里写死的分支/标签。
 */
async function jsdelivrArchive(source, { fetchImpl, timeoutMs }) {
  const version = jsdelivrVersion(source)
  const specifier = source.ref ? String(source.ref) : 'HEAD'
  const prefix = `${JSDELIVR_CDN}/${source.owner}/${source.repo}@${version}`
  return withDeadline(async signal => {
    const listing = await fetchOk(fetchImpl, `${JSDELIVR_API}/${source.owner}/${source.repo}@${version}?structure=flat`, 'application/json', signal, 'jsDelivr')
    if (listing.status === 404) fail('jsDelivr 上找不到 ' + source.owner + '/' + source.repo + '@' + specifier + '，可能仓库不存在或是私有的')
    if (!listing.ok) fail('读取 jsDelivr 文件列表失败（HTTP ' + listing.status + '）')
    let payload
    try { payload = await listing.json() } catch (error) { fail('jsDelivr 文件列表无法解析（' + error.message + '）') }
    const wanted = (Array.isArray(payload?.files) ? payload.files : [])
      .map(item => ({ path: String(item?.name || ''), size: Number(item?.size) || 0 }))
      // 列表里是仓库根目录的绝对路径（/lib/x.js），和 ZIP 内条目一个写法。
      .filter(item => item.path.startsWith('/') && !skippedRelative(item.path.slice(1)))
    if (!wanted.length) fail('jsDelivr 上没有可下载的文件')
    let total = 0
    for (const item of wanted) {
      if (item.size > JSDELIVR_MAX_FILE) fail(item.path.slice(1) + ' 超过 jsDelivr 单文件上限（20 MB），请下载 ZIP 后上传')
      total += item.size
    }
    if (total > JSDELIVR_MAX_TOTAL) fail('插件超过 150 MB，jsDelivr 下载不合适，请下载 ZIP 后上传')
    const files = new Map()
    let next = 0
    const worker = async () => {
      while (next < wanted.length) {
        const item = wanted[next++]
        const response = await fetchOk(fetchImpl, prefix + item.path, 'application/octet-stream', fileSignal(signal), 'jsDelivr')
        if (response.status === 404) fail('jsDelivr 上缺少 ' + item.path.slice(1) + '，可能版本刚更新，稍后再试')
        if (!response.ok) fail('从 jsDelivr 下载 ' + item.path.slice(1) + ' 失败（HTTP ' + response.status + '）')
        files.set(item.path, Buffer.from(await response.arrayBuffer()))
      }
    }
    await Promise.all(Array.from({ length: Math.min(JSDELIVR_CONCURRENCY, wanted.length) }, worker))
    return { files, ref: specifier, label: 'jsDelivr ' + specifier }
  }, timeoutMs, '从 jsDelivr 下载插件超时（文件一直没下载完）', { timeout: true })
}

/**
 * 下载 GitHub 上的插件源码，返回 { files, ref, label, warning }（files 是 路径 → 字节）。
 * 优先 GitHub 官方通道；只有连不上 / 超时这种「线路不通」才换 jsDelivr，
 * 仓库不存在之类的 404 原样报错，换线路也救不回来。
 */
export async function downloadGithubPlugin(source, { fetchImpl = fetch, timeoutMs = ARCHIVE_TIMEOUT_MS, file } = {}) {
  let primary
  try {
    return await githubArchive(source, { fetchImpl, timeoutMs, file })
  } catch (error) {
    if (!error?.network && !error?.timeout) throw error
    primary = error
  }
  let fallback
  try {
    // 备用线路要逐文件下载（几十到几百个请求），给 GitHub 那条 ZIP 通道四倍的预算。
    fallback = await jsdelivrArchive(source, { fetchImpl, timeoutMs: timeoutMs * 4 })
  } catch (error) {
    const reason = String(error?.message || error)
    fail(primary.message + '；备用线路 jsDelivr 也没成功（' + reason + '）。' + DOWNLOAD_HINT)
  }
  // GitHub 那边「连不上」的说明和这里的「已改用 jsDelivr」是同一件事，别在一句话里说两遍。
  const earlier = primary.warning && primary.warning.includes('连不上 GitHub') ? '' : primary.warning
  const notes = [earlier, '连不上 GitHub，已改用 jsDelivr（' + fallback.ref + '）'].filter(Boolean)
  return { ...fallback, warning: notes.join('；') }
}

function hostEntryOf(pkg) {
  const exportsField = pkg.exports
  return typeof exportsField === 'string' ? exportsField
    : typeof exportsField?.['.'] === 'string' ? exportsField['.']
      : exportsField?.['.']?.import || exportsField?.['.']?.default || (typeof pkg.main === 'string' ? pkg.main : '')
}

/**
 * 从「路径 → 字节」里找到插件根（最浅的 package.json），检查能不能当 Tavern 插件装。
 * ZIP 内的条目带一层仓库前缀（repo-ref/lib/x.js），jsDelivr 的列表是仓库根绝对路径（/lib/x.js），
 * 两种都先归一成不带前导斜杠的相对路径，再按最浅清单剥掉前缀，插件放在子目录里也能认。
 */
function locatePluginFiles(entries) {
  const normalized = new Map()
  for (const [name, data] of entries) {
    const relative = String(name).replace(/^\.\//, '').replace(/^\/+/, '')
    if (relative) normalized.set(relative, data)
  }
  const manifests = [...normalized.keys()].filter(name => /(^|\/)package\.json$/.test(name) && !name.includes('node_modules/'))
    .sort((left, right) => left.split('/').length - right.split('/').length)
  if (!manifests.length) fail('压缩包里没有 package.json，不是 Tavern 插件')
  return { normalized, manifest: manifests[0] }
}

function readPluginManifest({ normalized, manifest }, manifestBytes) {
  const root = manifest.slice(0, -'package.json'.length)
  let pkg
  try { pkg = JSON.parse(manifestBytes.toString('utf8')) } catch (error) { fail('package.json 无法解析：' + error.message) }
  const manifestProblem = pluginManifestProblem(pkg)
  if (manifestProblem) fail(manifestProblem)
  const files = new Map()
  for (const [name, data] of normalized) {
    if (!name.startsWith(root) || name.endsWith('/')) continue
    const relative = name.slice(root.length)
    if (!relative || relative.split('/').some(part => part === '..' || part === '')) continue
    if (skippedRelative(relative)) continue
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

export function readPluginFiles(entries) {
  const plugin = locatePluginFiles(entries)
  return readPluginManifest(plugin, plugin.normalized.get(plugin.manifest))
}

/** 上传的 ZIP：先解包再按同一套规则认插件根。 */
export function readPluginArchive(bytes) {
  return readPluginFiles(readZipEntries(bytes, { label: '插件 ZIP', fail, ...PLUGIN_ZIP_LIMITS }))
}

async function openPluginArchive(file) {
  const zip = await openZipFile(file, { label: '插件 ZIP', ...PLUGIN_ZIP_LIMITS })
  try {
    const plugin = locatePluginFiles([...zip.entries].map(([name, entry]) => [name, () => zip.stream(entry)]))
    const manifest = await zip.readBuffer(zip.entries.get(plugin.manifest))
    const root = plugin.manifest.slice(0, -'package.json'.length)
    return {
      ...readPluginManifest(plugin, manifest),
      readFile: (name, limit) => zip.readBuffer(zip.entries.get(root + name), limit),
      close: zip.close,
    }
  } catch (error) { await zip.close(); throw error }
}

function folderFor(pkg, fallback) {
  const name = String(pkg.name || fallback || '').replace(/^@[^/]+\//, '')
  const folder = name.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80)
  if (!folder) fail('插件没有可用的名字（package.json 的 name）')
  return folder
}

async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null } }

export function createUserPluginInstaller({ dataRoot, fetchImpl = fetch, now = () => new Date(), sync = async () => {}, archiveTimeoutMs = ARCHIVE_TIMEOUT_MS }) {
  const paths = userPluginPaths(dataRoot)
  const backups = path.join(path.resolve(dataRoot), 'plugin-backups')
  const installedPackage = name => existsSync(path.join(paths.profile, 'node_modules', ...name.split('/'), 'package.json'))
  let tail = Promise.resolve()
  const serial = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run }
  const stamp = () => now().toISOString().replace(/[:.]/g, '-')
  const time = () => { const value = now(); return value instanceof Date ? value.getTime() : Number(value) }
  // Settings asks on every open; one call per repository every few minutes is enough for GitHub's rate limit.
  const releases = new Map()
  const checkedReleasePackages = new WeakMap()

  async function latestRelease(source) {
    const key = source.owner + '/' + source.repo
    const cached = releases.get(key)
    if (cached && time() - cached.at < RELEASE_TTL) return cached.value
    const response = await fetchOk(fetchImpl, `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`, 'application/vnd.github+json', AbortSignal.timeout(5000))
    let value
    if (response.status === 404) value = { status: 'none' }
    else if (response.status === 403) value = { status: 'error', reason: 'GitHub 访问次数受限，暂时读不到新版本' }
    else if (!response.ok) value = { status: 'error', reason: '读取发布信息失败（HTTP ' + response.status + '）' }
    else {
      const release = await response.json()
      value = { status: 'release', tag: String(release?.tag_name || ''), assets: Array.isArray(release?.assets) ? release.assets : [] }
    }
    if (value.status !== 'error') releases.set(key, { at: time(), value })
    return value
  }

  async function temporaryArchive(use) {
    const directory = await mkdtemp(path.join(dataRoot, '.plugin-download-'))
    try { return await use(path.join(directory, 'archive.zip')) }
    finally { await rm(directory, { recursive: true, force: true }) }
  }

  async function useBundledReleasePackage(asset, folder, latest, use) {
    return temporaryArchive(async file => {
      const hash = createHash('sha256')
      await withDeadline(async signal => {
        const response = await fetchOk(fetchImpl, asset.url, ZIP_ACCEPT, signal)
        if (!response.ok) fail('下载插件发布包失败（HTTP ' + response.status + '）')
        await pipeline(pluginZipChunks(response, asset.size), async function* (source) {
          for await (const chunk of source) { hash.update(chunk); yield chunk }
        }, createWriteStream(file, { flags: 'wx' }), { signal })
      }, archiveTimeoutMs, '下载插件发布包超时')
      if ('sha256:' + hash.digest('hex') !== asset.digest) fail('插件发布包的 SHA-256 校验失败')
      const archive = await openPluginArchive(file)
      try {
        if (archive.pkg.name !== folder || comparePluginVersions(archive.pkg.version, latest) !== 0) fail('插件发布包的包名或版本与 Release 不符')
        for (const name of bundledPluginRuntimeFiles(folder)) if (!archive.files.has(name)) fail('插件发布包缺少 ' + name)
        const manifest = bundledPluginRelease(folder, archive.pkg.name)?.vendorManifest
        if (manifest) {
          for (const [name, expected] of bundledPluginVendorHashes(await archive.readFile(manifest, 64 * 1024))) {
            const open = archive.files.get(name)
            if (!open) fail('插件发布包缺少 ' + name)
            const hash = createHash('sha256')
            for await (const chunk of await open()) hash.update(chunk)
            if (hash.digest('hex') !== expected) fail('插件运行文件 SHA-256 校验失败：' + name)
          }
        }
        archive.files.delete(CARD_MARKER)
        return await use(archive)
      } finally { await archive.close() }
    })
  }

  async function bundledUpdate(source, folder, current) {
    const release = await latestRelease(source)
    if (release.status === 'none') return { status: 'none' }
    if (release.status === 'error') return { status: 'error', reason: release.reason }
    const latest = release.tag
    const version = /^v?(\d+(?:\.\d+){1,2})$/.exec(latest)?.[1]
    const relation = version ? comparePluginVersions(version, current) : null
    if (relation === null) return { status: 'error', reason: '无法比较插件发布版本', latest }
    if (relation <= 0) return { status: 'latest', latest }

    const fileName = source.assetName(version)
    const entry = release.assets.find(asset => asset?.name === fileName)
    const digest = String(entry?.digest || '').toLowerCase()
    if (!/^sha256:[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(entry?.size) || entry.size <= 0 || entry.size > PLUGIN_ZIP_LIMITS.maxArchiveBytes) {
      return { status: 'error', reason: 'Release 缺少带 SHA-256 校验的有效插件安装包', latest }
    }
    const asset = { url: `https://github.com/${source.owner}/${source.repo}/releases/download/${latest}/${fileName}`, digest, size: entry.size }
    let checked = checkedReleasePackages.get(release)
    if (!checked) {
      checked = useBundledReleasePackage(asset, folder, latest, ({ pkg }) => bundledReleaseCompatibilityProblem(pkg))
        .catch(error => { checkedReleasePackages.delete(release); throw error })
      checkedReleasePackages.set(release, checked)
    }
    const reason = await checked
    if (reason) return { status: 'blocked', reason, latest }
    return { status: 'available', latest, target: latest + ':' + digest, asset }
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
        if (typeof data === 'function') await pipeline(await data(), createWriteStream(file, { flags: 'wx' }))
        else await writeFile(file, data)
      }
      // 来源记录：warning 只是这一次安装的附注，没有内容就不落盘。
      const record = { ...source, version: String(pkg.version || ''), replaced: wasInstalled, installedAt: now().toISOString() }
      if (!record.warning) delete record.warning
      await writeFile(path.join(staging, SOURCE_FILE), JSON.stringify(record, null, 2) + '\n')
      if (wasDisabled) await writeFile(path.join(staging, DISABLED_FILE), JSON.stringify({ disabledAt: now().toISOString(), keptAcrossUpdate: true }, null, 2) + '\n')
      if (wasInstalled) await writeFile(path.join(staging, RESTART_FILE), JSON.stringify({ updatedAt: now().toISOString(), previousVersion: String(previous.version || ''), version: String(pkg.version || '') }, null, 2) + '\n')
      const replaced = wasInstalled ? await backup(folder) : null
      try {
        await rename(staging, target)
      } catch (error) {
        if (replaced) await rename(replaced, target)
        throw error
      }
      // The next settings visit should read the Release again, not a cached "available".
      releases.clear()
      await sync()
      // warning 只在「有话说」时出现（比如限流后退回默认分支），不污染正常返回值。
      return {
        folder, name: String(pkg.name || folder), version: String(pkg.version || ''), replaced: Boolean(replaced),
        ...(source.warning ? { warning: String(source.warning) } : {}),
      }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  async function installGithub(source) {
    return temporaryArchive(async file => {
      const downloaded = await downloadGithubPlugin(source, { fetchImpl, timeoutMs: archiveTimeoutMs, file })
      const archive = downloaded.archive || readPluginFiles(downloaded.files)
      try {
        return await place(archive, {
          kind: 'github', repo: source.owner + '/' + source.repo, ref: source.ref,
          resolved: downloaded.label, warning: downloaded.warning,
        }, source.repo)
      } finally { await archive.close?.() }
    })
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
        // Built-in status is preserved when a packaged plugin follows its own release.
        const recorded = await readJson(path.join(dir, SOURCE_FILE))
        const release = recorded?.kind === 'builtin' && bundledPluginRelease(folder, pkg.name)
        const source = recorded?.kind === 'builtin'
          ? { kind: 'builtin', bundled: true, version: String(recorded.version || ''), ...(release ? { releaseRepo: release.owner + '/' + release.repo } : {}) }
          : pkg.name === 'dsh-tavern-image' ? { kind: 'builtin' }
            : card ? (card.managed === true ? { kind: 'managed', modId: card.modId, builtin: firstPartyManifestIds.includes(card.modId) } : { kind: 'card' })
              : recorded || { kind: 'folder' }
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
     * Compare the installed version with the upstream Release. Pinned GitHub refs keep their
     * existing update action. Built-in packages also validate the release asset and compatibility.
     */
    async checkUpdates({ fresh = false } = {}) {
      // 手动点「检查更新」时跳过缓存，确实去 GitHub 看一眼。
      if (fresh) releases.clear()
      let folders = []
      try { folders = (await readdir(paths.plugins, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() } catch {}
      const checked = await Promise.all(folders.map(async folder => {
        const dir = path.join(paths.plugins, folder)
        const source = await readJson(path.join(dir, SOURCE_FILE))
        if (source?.kind !== 'github' && source?.kind !== 'builtin') return null
        const pkg = await readJson(path.join(dir, 'package.json')) || {}
        const current = String(pkg.version || '')
        if (source.kind === 'builtin') {
          const release = bundledPluginRelease(folder, pkg.name)
          if (!release) return null
          try {
            const { asset, ...update } = await bundledUpdate(release, folder, current)
            return { folder, current, ...update }
          } catch (error) {
            return { folder, current, status: 'error', reason: String(error?.message || error) }
          }
        }
        if (!source.repo) return null
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
          const reason = String(error?.message || error)
          // Release 查询走的是 api.github.com，线路不通时更新本身还能走 jsDelivr，先把话说清楚。
          const offline = error?.network || error?.timeout
          return { folder, current, status: 'error', reason: offline ? reason + '；更新时会改用 jsDelivr' : reason }
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
      return serial(() => installGithub(parseGithubSource(input)))
    },
    installFromZip(bytes, fileName) {
      return serial(async () => place(readPluginArchive(bytes), { kind: 'zip', file: String(fileName || '') }, String(fileName || '').replace(/\.zip$/i, '')))
    },
    installFromZipFile(file, fileName) {
      return serial(async () => {
        const archive = await openPluginArchive(file)
        const name = String(fileName || '')
        try { return await place(archive, { kind: 'zip', file: name }, name.replace(/\.zip$/i, '')) }
        finally { await archive.close() }
      })
    },
    update(folder, target) {
      return serial(async () => {
        const name = folderOf(folder)
        const dir = path.join(paths.plugins, name)
        const source = await readJson(path.join(dir, SOURCE_FILE))
        if (source?.kind === 'builtin') {
          const pkg = await readJson(path.join(dir, 'package.json'))
          const release = bundledPluginRelease(name, pkg?.name)
          if (!release) fail('此内置插件随酒馆更新')
          if (!target || !(await lstat(dir)).isDirectory()) fail('请先在插件列表检查更新')
          const candidate = await bundledUpdate(release, name, pkg.version)
          if (candidate.status !== 'available' || candidate.target !== target) fail(candidate.reason || '插件发布版本已变化，请重新检查更新')
          return useBundledReleasePackage(candidate.asset, name, candidate.latest,
            archive => place(archive, { kind: 'builtin', bundled: true, releaseRepo: release.owner + '/' + release.repo }, name))
        }
        if (source?.kind !== 'github') fail('这个插件不是从 GitHub 地址装的，没法自动更新；请重新上传新版 ZIP')
        const parsed = parseGithubSource(source.repo)
        parsed.ref = source.ref || null
        return installGithub(parsed)
      })
    },
    remove(folder) {
      return serial(async () => {
        const name = folderOf(folder)
        if (existsSync(path.join(paths.plugins, name, CARD_MARKER))) fail('这是人物卡自带的插件，请在人物卡库里停用')
        const pkg = await readJson(path.join(paths.plugins, name, 'package.json'))
        if (pkg?.name === 'dsh-tavern-image') fail('这是内置配图插件，随酒馆提供，不可删除')
        if ((await readJson(path.join(paths.plugins, name, SOURCE_FILE)))?.kind === 'builtin') fail('这是随酒馆提供的内置插件，不可删除；需要关掉时用「停用」')
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
