import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { createCardPluginManagedOwner } from './card-plugin-managed.js'
import { pluginManifestProblem } from './plugin-manifest.js'

// Plugins a DSH card carries (Wiki「设计：dsh-card-format」). Import keeps their files aside,
// unused; the player turning them on copies them into <data>/plugins/, where the user-plugin
// loader picks them up like any plugin, with a marker naming the cards they belong to.
// Tavern then confines them to those cards' games (plugin-api.js `cardScope`).
//
// Stored like pnpm stores packages: one installed copy per name and content, shared by every
// card that carries exactly that plugin (a card imported twice, a copy being edited), and
// removed when the last of those cards lets go. The host loads plugins from one flat folder,
// so one name can only be in use with one content at a time; a different content under a
// name already in use is refused, naming the card that holds it.

const MARKER = '.dsh-card.json'
const FOLDER = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_PLUGIN_BYTES = 64 * 1024 * 1024

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_CARD_PLUGIN_INVALID' }) }

async function readPluginManifest(dir, folder) {
  let pkg
  try { pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) }
  catch { throw invalid('插件 ' + folder + ' 缺少可读的 package.json') }
  const problem = pluginManifestProblem(pkg)
  if (problem) throw invalid('插件 ' + folder + ' 的 ' + problem)
  return pkg
}

export function createCardPlugins({ dataRoot, pluginsDir, keyOf = null }) {
  const stagingRoot = path.join(path.resolve(dataRoot), 'card-plugins')
  const installedFolder = plugin => 'card-' + String(plugin.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64) + '-' + plugin.sha256.slice(0, 12)
  let scopes = null, tail = Promise.resolve()
  // Markers are read, changed and written back; one change at a time.
  const serial = work => { const run = tail.catch(() => {}).then(work); tail = run; return run }

  /** Keep a card's plugins aside, unused: [{ folder, name, sha256, purpose, files, bytes }]. */
  async function stage(zip, { cardKey, plugins, verifiedFiles = null }) {
    const staged = []
    for (const plugin of plugins) {
      const prefix = String(plugin.path || '').replace(/\/*$/, '/')
      const folder = prefix.split('/')[1] || ''
      if (!prefix.startsWith('plugins/') || prefix.split('/').length !== 3 || !FOLDER.test(folder)) throw invalid('插件路径应为 plugins/<文件夹>/（小写字母、数字、点、下划线、连字符）：' + plugin.path)
      const target = path.join(stagingRoot, cardKey, folder)
      await rm(target, { recursive: true, force: true })
      const hash = createHash('sha256')
      let bytes = 0, files = 0
      const entries = [...zip.entries.values()].filter(entry => entry.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path))
      for (const entry of entries) {
        bytes += entry.size
        if (bytes > MAX_PLUGIN_BYTES) throw invalid('插件 ' + folder + ' 超过 64 MB')
        const relative = entry.path.slice(prefix.length)
        const file = path.join(target, ...relative.split('/'))
        await mkdir(path.dirname(file), { recursive: true })
        // Host-only verifiedFiles accompanies an immutable byte snapshot from consent preflight.
        const verified = verifiedFiles?.get(entry.path)
        const fileHash = verified ? null : createHash('sha256')
        const source = await zip.stream(entry)
        if (fileHash) source.on('data', chunk => fileHash.update(chunk))
        await pipeline(source, createWriteStream(file))
        hash.update(relative + '\u0000' + (verified?.sha256 || fileHash.digest('hex')) + '\n')
        files += 1
      }
      const { name } = await readPluginManifest(target, folder)
      staged.push({ folder, name, sha256: hash.digest('hex'), purpose: String(plugin.purpose || '').slice(0, 200), files, bytes })
    }
    return staged
  }

  /** Every installed plugin by package name: { folder, cards, sha256 } (cards null for the user's own). */
  async function installed() {
    const map = new Map()
    for (const folder of await readdir(pluginsDir).catch(() => [])) {
      let name = ''
      try { name = String(JSON.parse(await readFile(path.join(pluginsDir, folder, 'package.json'), 'utf8')).name || '') } catch { continue }
      if (!name) continue
      let marker = null
      try { marker = JSON.parse(await readFile(path.join(pluginsDir, folder, MARKER), 'utf8')) } catch {}
      // Older installs named one card (`cardPath`); now a list.
      const cards = marker ? [...new Set((Array.isArray(marker.cards) ? marker.cards : [marker.cardPath]).filter(Boolean).map(String))] : null
      map.set(name, { folder, cards, sha256: marker ? String(marker.sha256 || '') : '', managed: marker?.managed === true })
    }
    return map
  }

  /** Card plugins in use: plugin name → { cards, folder }. */
  async function scope() {
    if (!scopes) scopes = installed().then(map => new Map([...map].filter(([, item]) => !item.managed && item.cards?.length).map(([name, item]) => [name, { cards: item.cards, folder: item.folder }])))
    return await scopes
  }

  const writeMarker = (folder, cards, sha256) => writeFile(path.join(pluginsDir, folder, MARKER), JSON.stringify({ cards, sha256 }, null, 2))

  /** Put a card's staged plugins in use, confined to that card; an identical copy already in use is shared. */
  function enable({ cardKey, cardPath, plugins }) {
    return serial(async () => {
      const current = await installed()
      const plan = []
      for (const plugin of plugins) {
        const holder = current.get(plugin.name)
        if (!holder) { plan.push({ plugin, action: 'install' }); continue }
        if (holder.managed) throw invalid('This package is owned by the managed mod installation')
        if (holder.cards && holder.sha256 === plugin.sha256) {
          await readPluginManifest(path.join(pluginsDir, holder.folder), holder.folder)
          plan.push({ plugin, holder, action: 'share' }); continue
        }
        // This card's own older copy (the card was re-imported over itself) gives way.
        if (holder.cards && holder.cards.every(card => card === cardPath)) { plan.push({ plugin, holder, action: 'replace' }); continue }
        throw invalid('已经有同名插件 ' + plugin.name + ' 在用' + (holder.cards ? '（属于人物卡 ' + holder.cards.join('、') + '，内容不同）' : '（plugins/' + holder.folder + '）') + '，请先停用它')
      }
      // Old cards may already have been staged by a version without validation.
      // Validate the complete plan before removing or installing any plugin.
      for (const { plugin, action } of plan) {
        if (action === 'share') continue
        const pkg = await readPluginManifest(path.join(stagingRoot, cardKey, plugin.folder), plugin.folder)
        if (pkg.name !== plugin.name) throw invalid('插件 ' + plugin.folder + ' 的 package.json name 与导入记录不一致，请重新导入人物卡')
      }
      await mkdir(pluginsDir, { recursive: true })
      for (const { plugin, holder, action } of plan) {
        if (action === 'share') {
          if (!holder.cards.includes(cardPath)) await writeMarker(holder.folder, [...holder.cards, cardPath], holder.sha256)
          continue
        }
        if (holder) await rm(path.join(pluginsDir, holder.folder), { recursive: true, force: true })
        const target = path.join(pluginsDir, installedFolder(plugin))
        await rm(target, { recursive: true, force: true })
        await cp(path.join(stagingRoot, cardKey, plugin.folder), target, { recursive: true })
        await writeMarker(installedFolder(plugin), [cardPath], plugin.sha256)
      }
      scopes = null
    })
  }

  /** This card stops using its plugins; a plugin goes away when no card uses it any more. */
  function disable({ cardPath, plugins }) {
    return serial(async () => {
      const current = await installed()
      for (const plugin of plugins) {
        const holder = current.get(plugin.name)
        if (holder?.managed || !holder?.cards?.includes(cardPath)) continue
        const cards = holder.cards.filter(card => card !== cardPath)
        if (cards.length) await writeMarker(holder.folder, cards, holder.sha256)
        else await rm(path.join(pluginsDir, holder.folder), { recursive: true, force: true })
      }
      scopes = null
    })
  }

  /** A deleted card takes its plugins, used or not, with it. */
  async function remove({ cardKey, cardPath, plugins }) {
    await disable({ cardPath, plugins })
    await rm(path.join(stagingRoot, cardKey), { recursive: true, force: true })
  }

  /** A renamed card keeps its plugins: the markers and its staged copies follow the new path. */
  function movePath(from, to) {
    if (!from || !to || from === to) return Promise.resolve()
    return serial(async () => {
      for (const [, holder] of await installed()) {
        if (!holder.managed && holder.cards?.includes(from)) await writeMarker(holder.folder, [...new Set(holder.cards.map(card => card === from ? to : card))], holder.sha256)
      }
      if (keyOf) {
        const source = path.join(stagingRoot, keyOf(from)), target = path.join(stagingRoot, keyOf(to))
        await rm(target, { recursive: true, force: true })
        await cp(source, target, { recursive: true }).then(() => rm(source, { recursive: true, force: true }), error => { if (error?.code !== 'ENOENT') throw error })
      }
      scopes = null
    })
  }

  let managedOwner
  function managed({distributions,cardRoots,retiredIds}) {
    return managedOwner ||= createCardPluginManagedOwner({stagingRoot,pluginsDir,serial,distributions,cardRoots,retiredIds,invalidate:()=>{scopes=null}})
  }
  return Object.freeze({ stage, enable, disable, remove, movePath, scope, managed })
}
