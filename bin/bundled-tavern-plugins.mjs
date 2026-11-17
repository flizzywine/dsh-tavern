import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { comparePluginVersions } from './bundled-scene-image-plugin.mjs'

/**
 * 随酒馆发行、但身份是「酒馆插件」的内置插件（第一个是剧情罗盘）。
 *
 * 这类插件必须真的躺在 `<data>/plugins/<文件夹>`：Tavern 只把这个目录写成 profile 补丁条目，
 * 宿主据此加载，插件页也只会把这里的文件夹列成插件（可停用、随酒馆更新、不可删除）。
 * `tavern-plugin/packages/<包>` 只是发行副本，安装/更新时复制过去；插件自己的数据走
 * plugin-data 存储，不在这个目录里，所以整目录替换不会碰到用户数据。
 *
 * 失败不阻断酒馆安装：返回 `action: 'failed'`，由调用方决定要不要提示。
 */

export const BUNDLED_TAVERN_PLUGINS = Object.freeze([
  {
    folder: 'dsh-tavern-plot-compass',
    packageName: 'dsh-tavern-plot-compass',
    source: ['tavern-plugin', 'packages', 'dsh-tavern-plot-compass'],
  },
  {
    folder: 'dsh-tavern-narrative-damper',
    packageName: 'dsh-tavern-narrative-damper',
    source: ['tavern-plugin', 'packages', 'dsh-tavern-narrative-damper'],
  },
  {
    folder: 'dsh-tavern-audiobook',
    packageName: 'dsh-tavern-audiobook',
    source: ['tavern-plugin', 'packages', 'dsh-tavern-audiobook'],
  },
  {
    folder: 'dsh-tavern-fate-dice',
    packageName: 'dsh-tavern-fate-dice',
    source: ['tavern-plugin', 'packages', 'dsh-tavern-fate-dice'],
  },
])

/** 内置副本必须齐备的文件；缺一个就当这份发行版没内置插件，不去猜。 */
const REQUIRED = ['package.json', 'lib/index.js', 'client.js']
/** 与 image 插件一致：构建输入、测试、仓库元数据都不进插件目录。 */
const SKIP_NAMES = new Set(['node_modules', '.git', 'src', 'tests', 'build.mjs', '.github'])
/** 内置来源标记，插件页据此显示「内置插件」并拒绝删除。 */
export const SOURCE_FILE = '.tavern-source.json'

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function existsNoFollow(file) {
  try { lstatSync(file); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

function copyTree(from, to) {
  let captured = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isSymbolicLink()) throw new Error('内置插件副本包含不支持的符号链接：' + source)
    if (entry.isDirectory()) { mkdirSync(target, { recursive: true }); captured += copyTree(source, target); continue }
    if (!entry.isFile()) continue
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
    captured += 1
  }
  return captured
}

/** 内容摘要：酒馆更新时插件代码会变、版本号未必变，靠摘要决定要不要替换已装的副本。 */
function treeDigest(directory, list = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    const relative = path.relative(directory, full).split(path.sep).join('/')
    if (entry.isDirectory()) { treeDigest(full, list); continue }
    if (!entry.isFile()) continue
    list.push(relative + '\u0000' + createHash('sha256').update(readFileSync(full)).digest('hex'))
  }
  return createHash('sha256').update(list.sort().join('\n')).digest('hex')
}

/** 读发行副本并校验；不完整时返回 { ok: false, reason }。 */
export function readBundledTavernPlugin(sourceRoot, definition) {
  const directory = path.join(sourceRoot, ...definition.source)
  const pkg = readJson(path.join(directory, 'package.json'))
  const version = String(pkg?.version ?? '').trim()
  if (!pkg || pkg.name !== definition.packageName) return { ok: false, directory, reason: '内置插件副本的名称不是 ' + definition.packageName }
  if (!version) return { ok: false, directory, reason: '内置插件副本的 package.json 没有版本号' }
  for (const file of REQUIRED) {
    if (!existsSync(path.join(directory, file))) return { ok: false, directory, reason: '内置插件副本不完整，缺少 ' + file }
  }
  return { ok: true, directory, version, packageName: pkg.name, description: String(pkg.description ?? '') }
}

function installOne({ sourceRoot, dataRoot, profileDir, profileDependencies, definition }) {
  const bundled = readBundledTavernPlugin(sourceRoot, definition)
  if (!bundled.ok) return { action: 'unavailable', reason: bundled.reason, version: null, target: null, installedVersion: null, packageName: definition.packageName }

  const pluginsDir = path.join(dataRoot, 'plugins')
  const target = path.join(pluginsDir, definition.folder)
  const installed = readJson(path.join(target, 'package.json'))
  const installedVersion = String(installed?.version ?? '').trim() || null

  // profile 侧还登记着同名包：让它做唯一来源，别放一份永远不会加载的副本（同一包两个来源会被跳过）。
  // 优先看这次算出来的 profile 清单；没有清单时才退回磁盘上的 node_modules。
  const registered = profileDependencies && typeof profileDependencies === 'object'
    ? Object.prototype.hasOwnProperty.call(profileDependencies, definition.packageName)
    : Boolean(profileDir && existsSync(path.join(profileDir, 'node_modules', definition.packageName, 'package.json')))
  if (registered) {
    return { action: 'skipped', reason: 'profile 仍登记着同名插件包，保持单一来源', version: bundled.version, installedVersion, target, packageName: definition.packageName }
  }

  if (existsNoFollow(target)) {
    const stat = lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { action: 'skipped', reason: '目标插件目录不是普通目录，保留现有内容', version: bundled.version, installedVersion, target, packageName: definition.packageName }
    if (existsNoFollow(path.join(target, '.git'))) return { action: 'skipped', reason: '目标插件是 Git 检出，保留现有内容', version: bundled.version, installedVersion, target, packageName: definition.packageName }
    if (installed?.name !== definition.packageName || !installedVersion) return { action: 'skipped', reason: '目标插件目录不是可识别的同名插件，保留现有内容', version: bundled.version, installedVersion, target, packageName: definition.packageName }
  }

  mkdirSync(pluginsDir, { recursive: true })
  const staging = mkdtempSync(path.join(pluginsDir, '.tavern-bundled-'))
  const replacing = existsNoFollow(target)
  const retired = replacing ? path.join(pluginsDir, '.tavern-bundled-old-' + process.pid) : ''
  try {
    const files = copyTree(bundled.directory, staging)
    const staged = readJson(path.join(staging, 'package.json'))
    if (staged?.name !== definition.packageName || String(staged?.version ?? '').trim() !== bundled.version) throw new Error('内置插件复制后的包名或版本校验失败')
    for (const file of REQUIRED) if (!existsSync(path.join(staging, file))) throw new Error('内置插件复制后缺少 ' + file)
    const digest = treeDigest(staging)
    const recorded = readJson(path.join(target, SOURCE_FILE))
    const unchanged = replacing
      && comparePluginVersions(bundled.version, installedVersion || '') === 0
      && String(recorded?.digest || '') === digest
    if (unchanged) {
      rmSync(staging, { recursive: true, force: true })
      return { action: 'skipped', reason: '已装的插件与内置副本相同，保留现有内容', version: bundled.version, installedVersion, target, packageName: definition.packageName }
    }
    writeFileSync(path.join(staging, SOURCE_FILE), JSON.stringify({ kind: 'builtin', bundled: true, version: bundled.version, digest, installedAt: new Date().toISOString() }, null, 2) + '\n')
    if (replacing) {
      rmSync(retired, { recursive: true, force: true })
      renameSync(target, retired)
      try { renameSync(staging, target) } catch (error) {
        renameSync(retired, target)
        throw error
      }
      rmSync(retired, { recursive: true, force: true })
    } else renameSync(staging, target)
    return {
      action: replacing ? 'upgraded' : 'installed', reason: replacing ? '版本比已装的旧' : '首次安装',
      version: bundled.version, installedVersion, target, packageName: definition.packageName, files,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function installBundledTavernPlugins({ sourceRoot, dataRoot, profileDir, profileDependencies, logger = console } = {}) {
  const results = []
  for (const definition of BUNDLED_TAVERN_PLUGINS) {
    try {
      results.push(installOne({ sourceRoot, dataRoot, profileDir, profileDependencies, definition }))
    } catch (error) {
      logger.warn?.('[Tavern 插件] 内置插件 ' + definition.packageName + ' 安装失败（不影响 Tavern 使用）：' + (error?.message || error))
      results.push({ action: 'failed', reason: String(error?.message || error), version: null, target: null, installedVersion: null, packageName: definition.packageName })
    }
  }
  return results
}
