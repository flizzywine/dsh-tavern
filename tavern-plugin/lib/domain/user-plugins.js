import { existsSync, watch } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument, YAMLSeq } from 'yaml'
import { castManifestPath } from './cast-assets.js'
import { pluginManifestProblem } from './plugin-manifest.js'

// Entries Tavern writes for folders in <data>/plugins. Every other patch entry belongs to the user.
const ID_PREFIX = 'tavern-user-plugin-'
const IMAGE_PLUGIN_NAME = 'dsh-tavern-image'
const LEGACY_IMAGE_PLUGIN_NAME = 'dsh-tavern-comfy'
// Loaded in place of the plugin's own entry, beside its package.json so its browser half is still found.
export const GUARD_FILE = '.tavern-entry.mjs'
// The guard records whether the plugin loaded, so the settings list can say why one is missing.
export const STATUS_FILE = '.tavern-status.json'
// A folder carrying this marker is kept in place but left out of the patch, so DSH unloads it.
export const DISABLED_FILE = '.tavern-disabled'
// Written when a plugin folder is replaced: DSH keeps running the old module until it restarts.
export const RESTART_FILE = '.tavern-restart.json'

// Process-local identities recorded by guards, never inferred from the current patch.
export const runningUserPlugins = new Map()

export function registerRunningUserPlugin(name, identity) {
  runningUserPlugins.set(name, identity)
  return () => { if (runningUserPlugins.get(name) === identity) runningUserPlugins.delete(name) }
}

/** A failed import or apply stays isolated in the guard's child Cordis scope. */
export function guardSource({ folder, name, main, sha256 = '', bound = false, origin = 'global', cardIds = [] }) {
  const label = JSON.stringify('[Tavern 插件] plugins/' + folder)
  return `// Tavern 自动生成，请勿修改：插件加载或启动出错时只记日志，不影响 DSH 启动。
import { rmSync, writeFileSync } from 'node:fs'
import { registerRunningUserPlugin } from ${JSON.stringify(import.meta.url)}
const record = status => { try { writeFileSync(new URL(${JSON.stringify('./' + STATUS_FILE)}, import.meta.url), JSON.stringify({ ...status, at: new Date().toISOString() })) } catch {} }
const clearRestart = () => { try { rmSync(new URL(${JSON.stringify('./' + RESTART_FILE)}, import.meta.url), { force: true }) } catch {} }
const report = (stage, error) => {
  console.warn(${label} + ' ' + stage + '失败：' + (error && error.stack || error))
  record({ ok: false, stage, message: String(error && error.message || error).slice(0, 500) })
}
let plugin = null
try {
  const mod = await import(new URL(${JSON.stringify(main)}, import.meta.url).href)
  const value = typeof mod.apply === 'function' ? mod : mod.default
  plugin = typeof value === 'function' ? { apply: value } : value && typeof value.apply === 'function' ? value : null
  if (!plugin) report('加载', new Error('入口没有导出 apply 函数'))
} catch (error) { report('加载', error) }
export const name = plugin && typeof plugin.name === 'string' && plugin.name ? plugin.name : ${JSON.stringify(name)}
export const inject = plugin ? plugin.inject : undefined
export const Config = plugin ? plugin.Config : undefined
export async function apply(ctx, config) {
  if (!plugin) return
  let child
  try {
    // Cordis owns registrations/effects in this child scope and unwinds them
    // on failure. The guard remains alive so one broken plugin cannot stop DSH.
    const release = registerRunningUserPlugin(${JSON.stringify(name)}, { folder: ${JSON.stringify(folder)}, sha256: ${JSON.stringify(sha256)}, bound: ${JSON.stringify(bound)}, origin: ${JSON.stringify(origin)}, cardIds: ${JSON.stringify(cardIds)}, runtimeName: name })
    ctx.effect?.(() => release)
    child = ctx.plugin({ name, apply: childContext => plugin.apply(childContext, config) })
    await child.await()
    record({ ok: true })
    clearRestart()
  } catch (error) {
    if (child) await child.dispose()
    report('启动', error)
  }
}
`
}

export function userPluginPaths(dataRoot, dshHome = path.resolve(dataRoot, '../../..'), host = process.env.DSH_TAVERN_RUNTIME_HOST || (process.versions.electron ? 'desktop' : 'cli')) {
  const profiles = path.join(path.resolve(dshHome), 'profiles')
  // Tavern runs from profiles/tavern; the desktop app reaches it through a profiles/desktop link.
  // When the desktop app is back on the original DSH (a real profiles/desktop) and Tavern runs on
  // its own, writing to desktop would load Tavern plugins into the original DSH instead. Only an
  // older desktop install with Tavern directly in profiles/desktop has no tavern profile.
  const tavern = path.join(profiles, 'tavern')
  const profile = host !== 'desktop' || existsSync(path.join(tavern, 'package.json')) ? tavern : path.join(profiles, 'desktop')
  return { plugins: path.join(path.resolve(dataRoot), 'plugins'), profile }
}

function hostEntry(pkg) {
  const main = typeof pkg.exports === 'string' ? pkg.exports
    : typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.']
      : typeof pkg.exports?.['.']?.import === 'string' ? pkg.exports['.'].import
        : typeof pkg.exports?.['.']?.default === 'string' ? pkg.exports['.'].default
        : typeof pkg.main === 'string' ? pkg.main : ''
  return main
}

// Card storage, not installed-folder markers, defines the binding set.
export async function readEnabledBindings({ dataRoot, cardPaths }) {
  const bindings = new Map()
  for (const cardPath of await cardPaths()) {
    let manifest
    try { manifest = JSON.parse(await readFile(castManifestPath(dataRoot, cardPath), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const plugin of manifest.plugins || []) {
      if (plugin.enabled !== true) continue
      if (!bindings.has(plugin.name)) bindings.set(plugin.name, new Map())
      const versions = bindings.get(plugin.name)
      if (!versions.has(plugin.sha256)) versions.set(plugin.sha256, new Set())
      versions.get(plugin.sha256).add(cardPath)
    }
  }
  return bindings
}

export function bindingVerdict({ name, sha256 }, bindings) {
  const versions = bindings.get(name)
  if (!versions) return null
  if (!sha256 || versions.size !== 1 || !versions.has(sha256)) {
    return { reason: '人物卡绑定了其他版本或绑定冲突，此目录不加载' }
  }
  return { cards: [...versions.get(sha256)] }
}

/**
 * One folder per plugin: package.json names the host half (exports "." or main)
 * and, optionally, a browser half (dsh.client + exports "./client").
 * Folders that cannot be loaded are reported, never registered.
 */
export async function scanUserPlugins(pluginsDir, { installed = () => false, bindings = new Map() } = {}) {
  let names
  try { names = (await readdir(pluginsDir, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() }
  catch (error) { if (error.code === 'ENOENT') names = []; else throw error }
  // A package migration can leave both names in profile dependencies and both copies
  // in data/plugins. Resolve this one known pair before the normal folder-name order.
  const candidates = await Promise.all(names.map(async folder => {
    try {
      const pkg = JSON.parse(await readFile(path.join(pluginsDir, folder, 'package.json'), 'utf8'))
      let marker = null
      try { marker = JSON.parse(await readFile(path.join(pluginsDir, folder, '.dsh-card.json'), 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      return { folder, name: pkg.name, canonicalImage: pkg.name === IMAGE_PLUGIN_NAME,
        sha256: String(marker?.sha256 || ''), origin: marker && !marker.managed ? 'card' : 'global',
        cardIds: marker ? (marker.cards || [marker.cardPath]).filter(Boolean) : [] }
    } catch { return { folder, canonicalImage: false } }
  }))
  candidates.sort((a, b) => Number(b.canonicalImage) - Number(a.canonicalImage))
  const plugins = [], problems = [], disabled = []
  for (const { folder, sha256, origin, cardIds } of candidates) {
    const dir = path.join(pluginsDir, folder)
    // A disabled plugin keeps its files and settings but is not registered, so DSH does not load it.
    if (existsSync(path.join(dir, DISABLED_FILE))) { disabled.push(folder); continue }
    let pkg
    try { pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) }
    catch (error) { problems.push({ folder, reason: error.code === 'ENOENT' ? '缺少 package.json' : 'package.json 无法解析：' + error.message }); continue }
    const manifestProblem = pluginManifestProblem(pkg)
    if (manifestProblem) { problems.push({ folder, reason: manifestProblem + '；请补全后重新启用插件' }); continue }
    const main = hostEntry(pkg)
    if (!main) { problems.push({ folder, reason: 'package.json 没有写 exports "." 或 main（宿主入口）' }); continue }
    const entry = path.resolve(dir, main)
    if (!existsSync(entry)) { problems.push({ folder, reason: '找不到宿主入口 ' + main }); continue }
    const packageName = String(pkg.name || folder)
    const verdict = bindingVerdict({ name: packageName, sha256 }, bindings)
    if (verdict?.reason) { problems.push({ folder, reason: verdict.reason }); continue }
    const isImagePlugin = packageName === IMAGE_PLUGIN_NAME || packageName === LEGACY_IMAGE_PLUGIN_NAME
    // A second source for an installed package breaks DSH's browser module composition.
    const installedNames = isImagePlugin ? [IMAGE_PLUGIN_NAME, LEGACY_IMAGE_PLUGIN_NAME] : pkg.name ? [packageName] : []
    const installedName = installedNames.find(name => installed(name))
    if (installedName) {
      const reason = isImagePlugin
        ? `插件 ${packageName} 与已登记的图片插件身份（${installedName}）相同，已跳过以避免重复加载；请在插件管理中检查重复登记`
        : '插件名 ' + packageName + ' 与已安装的包重名，请换一个名字'
      problems.push({ folder, reason }); continue
    }
    const identityName = packageName === LEGACY_IMAGE_PLUGIN_NAME ? IMAGE_PLUGIN_NAME : packageName
    const id = ID_PREFIX + identityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (plugins.some(plugin => plugin.id === id)) {
      const reason = isImagePlugin
        ? '同一生图插件存在多个副本，已保留一个并跳过重复项'
        : '插件名与其他插件重复'
      problems.push({ folder, reason }); continue
    }
    const relative = './' + path.relative(dir, entry).split(path.sep).join('/')
    plugins.push({ id, folder, name: String(pkg.name || folder), sha256, bound: Boolean(verdict), origin: verdict ? 'card' : origin, cardIds: verdict?.cards || cardIds, entry: path.join(dir, GUARD_FILE), main: relative })
  }
  for (const [name, versions] of bindings) {
    if (!plugins.some(plugin => plugin.name === name)) problems.push({ folder: name, reason: '人物卡绑定的版本 ' + [...versions.keys()].map(sha => sha.slice(0, 12)).join('、') + ' 没有可用对应目录，插件不加载' })
  }
  return { plugins, problems, disabled }
}

/** Rewrite only Tavern's own insert entries in the profile patch; returns whether the file changed. */
export function syncPatchText(text, plugins) {
  const doc = parseDocument(text && text.trim() ? text : '[]\n')
  if (doc.errors.length) throw new Error('cordis.patch.yml 无法解析：' + doc.errors[0].message)
  if (!(doc.contents instanceof YAMLSeq)) throw new Error('cordis.patch.yml 顶层不是列表')
  const ours = item => String(item?.get?.('id') ?? '').startsWith(ID_PREFIX)
  let removed = 0
  for (let index = doc.contents.items.length - 1; index >= 0; index--) {
    const op = doc.contents.items[index]
    const inserted = op?.get?.('insert', true)
    if (!(inserted instanceof YAMLSeq)) continue
    const kept = inserted.items.filter(item => !ours(item))
    removed += inserted.items.length - kept.length
    inserted.items = kept
    if (inserted.items.length === 0) doc.contents.items.splice(index, 1)
  }
  if (!removed && !plugins.length) return null
  if (plugins.length) {
    const op = doc.createNode({ insert: plugins.map(plugin => ({ id: plugin.id, name: plugin.entry })) })
    op.commentBefore = ' Tavern 按 profile-data/tavern/data/plugins 自动维护以下条目，请勿手改；增删插件请增删该目录下的文件夹。'
    doc.contents.items.push(op)
  }
  doc.contents.flow = false
  // lineWidth 0 keeps the user's long lines (absolute paths) as they wrote them.
  const next = doc.toString({ lineWidth: 0 })
  return next === (text ?? '') ? null : next
}

/** Tavern's own patch entries (id -> guard path) as the file holds them now; read before the first sync, it is what DSH started with. */
export async function readPatchedUserPlugins({ dataRoot, dshHome }) {
  let text = ''
  try { text = await readFile(path.join(userPluginPaths(dataRoot, dshHome).profile, 'cordis.patch.yml'), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const doc = parseDocument(text.trim() ? text : '[]\n'), entries = new Map()
  for (const op of doc.contents instanceof YAMLSeq ? doc.contents.items : []) {
    for (const item of op?.get?.('insert', true)?.items || []) {
      const id = String(item?.get?.('id') ?? '')
      if (id.startsWith(ID_PREFIX)) entries.set(id, String(item.get('name')))
    }
  }
  return entries
}

// Report each skipped folder once per reason, not on every file change while it is being copied.
const reported = new Map()

async function replaceFile(file, text) {
  const temporary = file + '.tavern-tmp'
  await writeFile(temporary, text)
  for (let attempt = 0; ; attempt++) {
    try { return await rename(temporary, file) }
    catch (error) {
      // Windows refuses to replace a file another process has open for a moment.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

// Earlier versions wrote these entries to profiles/desktop even when it was the original DSH
// (the desktop app switched back), loading Tavern plugins there. Take them out of that profile.
async function clearOriginalDesktop(profile) {
  if (path.basename(profile) !== 'tavern') return
  const desktop = path.join(path.dirname(profile), 'desktop')
  try { if ((await lstat(desktop)).isSymbolicLink() || (await realpath(desktop)) === (await realpath(profile))) return } catch { return }
  const file = path.join(desktop, 'cordis.patch.yml')
  let text
  try { text = await readFile(file, 'utf8') } catch { return }
  if (!text.includes(ID_PREFIX)) return
  const next = syncPatchText(text, [])
  if (next !== null) await replaceFile(file, next)
}

export async function syncUserPlugins({ dataRoot, dshHome, logger = console, pending = () => false, cardPaths = async () => [] } = {}) {
  const paths = userPluginPaths(dataRoot, dshHome)
  const transactionPending = () => existsSync(path.join(path.resolve(dataRoot), 'card-plugins', '.managed', 'journal.json'))
  if (pending() || transactionPending()) return { pending: true, plugins: [], problems: [] }
  await mkdir(paths.plugins, { recursive: true })
  if (!existsSync(path.join(paths.profile, 'package.json'))) {
    logger.warn?.('[Tavern 插件] 找不到 Tavern 的 DSH 配置目录 ' + paths.profile + '，plugins/ 里的插件不会加载')
    return { skipped: true, plugins: [], problems: [], disabled: [] }
  }
  const installed = name => existsSync(path.join(paths.profile, 'node_modules', ...name.split('/'), 'package.json'))
  const bindings = await readEnabledBindings({ dataRoot, cardPaths })
  const { plugins, problems, disabled } = await scanUserPlugins(paths.plugins, { installed, bindings })
  for (const problem of problems) {
    const key = paths.plugins + '\u0000' + problem.folder
    if (reported.get(key) === problem.reason) continue
    reported.set(key, problem.reason)
    logger.warn?.('[Tavern 插件] 跳过 plugins/' + problem.folder + '：' + problem.reason)
  }
  for (const key of reported.keys()) if (key.startsWith(paths.plugins + '\u0000') && !problems.some(problem => key.endsWith('\u0000' + problem.folder))) reported.delete(key)
  for (const plugin of plugins) {
    const guard = guardSource(plugin)
    let current = null
    try { current = await readFile(plugin.entry, 'utf8') } catch {}
    if (current !== guard) await replaceFile(plugin.entry, guard)
  }
  const file = path.join(paths.profile, 'cordis.patch.yml')
  let text = ''
  try { text = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const next = syncPatchText(text, plugins)
  if (pending() || transactionPending()) return { pending: true, plugins: [], problems: [] }
  if (next !== null) await replaceFile(file, next)
  await clearOriginalDesktop(paths.profile)
  return { changed: next !== null, plugins, problems, disabled }
}

/**
 * Which loader entry loaded `fiber`: 'tavern' when a Tavern guard entry (data/plugins, the only way a card plugin
 * loads) owns it, 'host' for an entry of the host or profile configuration, undefined when no entry owns it.
 */
export function loaderOrigin(loader, fiber) {
  const id = fiber && loader?.locate?.(fiber)
  if (id === undefined || id === null) return undefined
  return String(id).includes(ID_PREFIX) ? 'tavern' : 'host'
}

/**
 * Restart a running user plugin from a new guard through the Cordis loader: point its patch entry (a sibling of the
 * Tavern entry, same parent prefix) at the new file, then stop and start it so the new module is imported.
 */
export function loaderReload(loader, fiber) {
  if (!loader) return null
  const located = loader.locate(fiber) || '', prefix = located.slice(0, located.lastIndexOf(':') + 1)
  return async (id, entry) => {
    const row = loader.resolve(prefix + id)
    await row.update({ name: pathToFileURL(entry).href, disabled: true })
    await row.update({ disabled: null })
  }
}

/**
 * Keep the patch in step with the plugins folder. DSH's profile reload records a running plugin's new folder without
 * importing it (official runtime 0.2.1), so a plugin whose folder moved - a managed mod republished at startup, a
 * replaced user plugin - would keep running its old module beside the new folder's files. `loaded` (id -> guard path
 * DSH started, readPatchedUserPlugins) tells which entries moved; `reload(id, entry)` (loaderReload) restarts each from its new guard.
 */
export async function reconcileUserPluginsAtStartup({ result, loaded, reload }) {
  if (!reload) return
  for (const plugin of result.plugins) {
    if (!loaded.has(plugin.id)) continue
    let entry = plugin.entry
    if (loaded.get(plugin.id) === entry) {
      if (runningUserPlugins.has(plugin.name)) continue
      // The legacy guard may already be in Node's module cache. Import the
      // identity-aware guard from a fresh URL during startup only.
      entry = path.join(path.dirname(entry), '.tavern-entry.identity.mjs')
      await replaceFile(entry, guardSource(plugin))
    }
    await reload(plugin.id, entry)
    loaded.set(plugin.id, plugin.entry)
  }
}

export function watchUserPlugins({ dataRoot, dshHome, logger = console, delay = 500, loaded = new Map(), reload = null, pending = () => false, cardPaths = async () => [] }) {
  const { plugins } = userPluginPaths(dataRoot, dshHome)
  let timer = null, watcher = null, running = Promise.resolve()
  const restartMoved = async result => {
    for (const plugin of reload ? result.plugins : []) {
      // Card binding changes require a process restart, never a watcher-driven hot swap.
      if (plugin.bound || runningUserPlugins.get(plugin.name)?.bound) continue
      if (!loaded.has(plugin.id) || loaded.get(plugin.id) === plugin.entry) continue
      await reload(plugin.id, plugin.entry)
      loaded.set(plugin.id, plugin.entry)
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      running = running.then(() => syncUserPlugins({ dataRoot, dshHome, logger, pending, cardPaths })).then(restartMoved)
        .catch(error => logger.warn?.('[Tavern 插件] 同步插件目录失败：' + (error?.message || error)))
    }, delay)
  }
  // Recursive, so a folder copied in before its package.json is complete still syncs once it is.
  try { watcher = watch(plugins, { recursive: true }, schedule); watcher.on('error', () => {}) }
  catch (error) { logger.warn?.('[Tavern 插件] 无法监听插件目录，新增插件需重启 DSH：' + (error?.message || error)) }
  return () => { clearTimeout(timer); watcher?.close() }
}
