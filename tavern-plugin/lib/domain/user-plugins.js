import { existsSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument, YAMLSeq } from 'yaml'

// Entries Tavern writes for folders in <data>/plugins. Every other patch entry belongs to the user.
const ID_PREFIX = 'tavern-user-plugin-'
// Loaded in place of the plugin's own entry, beside its package.json so its browser half is still found.
export const GUARD_FILE = '.tavern-entry.mjs'

/**
 * A plugin that fails to import or to apply must not stop DSH from starting:
 * the guard imports it, reports the failure in the log and loads nothing instead.
 */
export function guardSource({ folder, name, main }) {
  const label = JSON.stringify('[Tavern 插件] plugins/' + folder)
  return `// Tavern 自动生成，请勿修改：插件加载或启动出错时只记日志，不影响 DSH 启动。
const report = (stage, error) => console.warn(${label} + ' ' + stage + '失败：' + (error && error.stack || error))
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
export function apply(ctx, config) {
  if (!plugin) return
  try {
    const result = plugin.apply(ctx, config)
    return result && typeof result.then === 'function' ? result.catch(error => report('启动', error)) : result
  } catch (error) { report('启动', error) }
}
`
}

export function userPluginPaths(dataRoot, dshHome = path.resolve(dataRoot, '../../..')) {
  return {
    plugins: path.join(path.resolve(dataRoot), 'plugins'),
    profile: path.join(path.resolve(dshHome), 'profiles', 'tavern'),
  }
}

function hostEntry(pkg) {
  const main = typeof pkg.exports === 'string' ? pkg.exports
    : typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.']
      : typeof pkg.exports?.['.']?.import === 'string' ? pkg.exports['.'].import
        : typeof pkg.exports?.['.']?.default === 'string' ? pkg.exports['.'].default
        : typeof pkg.main === 'string' ? pkg.main : ''
  return main
}

/**
 * One folder per plugin: package.json names the host half (exports "." or main)
 * and, optionally, a browser half (dsh.client + exports "./client").
 * Folders that cannot be loaded are reported, never registered.
 */
export async function scanUserPlugins(pluginsDir, { installed = () => false } = {}) {
  let names
  try { names = (await readdir(pluginsDir, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() }
  catch (error) { if (error.code === 'ENOENT') return { plugins: [], problems: [] }; throw error }
  const plugins = [], problems = []
  for (const folder of names) {
    const dir = path.join(pluginsDir, folder)
    let pkg
    try { pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) }
    catch (error) { problems.push({ folder, reason: error.code === 'ENOENT' ? '缺少 package.json' : 'package.json 无法解析：' + error.message }); continue }
    const main = hostEntry(pkg)
    if (!main) { problems.push({ folder, reason: 'package.json 没有写 exports "." 或 main（宿主入口）' }); continue }
    const entry = path.resolve(dir, main)
    if (!existsSync(entry)) { problems.push({ folder, reason: '找不到宿主入口 ' + main }); continue }
    // A second source for an installed package breaks DSH's browser module composition.
    if (pkg.name && installed(String(pkg.name))) { problems.push({ folder, reason: '插件名 ' + pkg.name + ' 与已安装的包重名，请换一个名字' }); continue }
    const id = ID_PREFIX + String(pkg.name || folder).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (plugins.some(plugin => plugin.id === id)) { problems.push({ folder, reason: '插件名与其他插件重复' }); continue }
    const relative = './' + path.relative(dir, entry).split(path.sep).join('/')
    plugins.push({ id, folder, name: String(pkg.name || folder), entry: path.join(dir, GUARD_FILE), main: relative })
  }
  return { plugins, problems }
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

export async function syncUserPlugins({ dataRoot, dshHome, logger = console } = {}) {
  const paths = userPluginPaths(dataRoot, dshHome)
  await mkdir(paths.plugins, { recursive: true })
  if (!existsSync(path.join(paths.profile, 'package.json'))) {
    logger.warn?.('[Tavern 插件] 找不到 Tavern 的 DSH 配置目录 ' + paths.profile + '，plugins/ 里的插件不会加载')
    return { skipped: true, plugins: [], problems: [] }
  }
  const installed = name => existsSync(path.join(paths.profile, 'node_modules', ...name.split('/'), 'package.json'))
  const { plugins, problems } = await scanUserPlugins(paths.plugins, { installed })
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
  if (next !== null) await replaceFile(file, next)
  return { changed: next !== null, plugins, problems }
}

/** Keep the patch in step with the plugins folder; DSH reloads the patch live. */
export function watchUserPlugins({ dataRoot, dshHome, logger = console, delay = 500 }) {
  const { plugins } = userPluginPaths(dataRoot, dshHome)
  let timer = null, watcher = null, running = Promise.resolve()
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      running = running.then(() => syncUserPlugins({ dataRoot, dshHome, logger }))
        .catch(error => logger.warn?.('[Tavern 插件] 同步插件目录失败：' + (error?.message || error)))
    }, delay)
  }
  // Recursive, so a folder copied in before its package.json is complete still syncs once it is.
  try { watcher = watch(plugins, { recursive: true }, schedule); watcher.on('error', () => {}) }
  catch (error) { logger.warn?.('[Tavern 插件] 无法监听插件目录，新增插件需重启 DSH：' + (error?.message || error)) }
  return () => { clearTimeout(timer); watcher?.close() }
}
