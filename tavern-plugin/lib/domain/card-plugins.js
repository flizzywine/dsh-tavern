import { readEnabledBindings, bindingVerdict, runningUserPlugins, DISABLED_FILE } from './user-plugins.js'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { createCardPluginManagedOwner } from './card-plugin-managed.js'
import { pluginManifestProblem } from './plugin-manifest.js'
import { readCardArchive } from './card-archive.js'
import { openZipFile } from './zip-file.js'
import { readPluginFiles, SOURCE_FILE } from './user-plugin-install.js'
import { bundledPluginRelease } from './bundled-plugin-release.js'

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

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_CARD_PLUGIN_INVALID' }) }

/** A rolled-back update is a failure: the plugin is still the old version and the reason says why. */
export function pluginUpdateRolledBack(outcome) {
  return Object.assign(new Error('插件更新已回滚，插件仍为旧版本 ' + outcome.previousVersion + '：' + outcome.reason), { code: 'TAVERN_CARD_PLUGIN_ROLLED_BACK', previousVersion: outcome.previousVersion, reason: outcome.reason })
}

async function readPluginManifest(dir, folder) {
  let pkg
  try { pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) }
  catch { throw invalid('插件 ' + folder + ' 缺少可读的 package.json') }
  const problem = pluginManifestProblem(pkg)
  if (problem) throw invalid('插件 ' + folder + ' 的 ' + problem)
  return pkg
}

export function createCardPlugins({ dataRoot, pluginsDir, keyOf = null, cardPaths = async () => [], journalPath = null, updateCheckpoint = async () => {} }) {
  const stagingRoot = path.join(path.resolve(dataRoot), 'card-plugins')
  const installedFolder = plugin => 'card-' + String(plugin.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64) + '-' + plugin.sha256.slice(0, 12)
  let scopes = null, tail = Promise.resolve()
  // Markers are read, changed and written back; one change at a time.
  const serial = work => { const run = tail.catch(() => {}).then(work); tail = run; return run }

  /** Keep a card's plugins aside, unused: [{ folder, name, sha256, purpose, files, bytes }]. */
  function stage(zip, options) { return serial(() => stageNow(zip, options)) }
  async function stageNow(zip, { cardKey, plugins, verifiedFiles = null, targetDirectory = null }) {
    const staged = []
    for (const plugin of plugins) {
      const prefix = String(plugin.path || '').replace(/\/*$/, '/')
      const folder = prefix.split('/')[1] || ''
      if (!prefix.startsWith('plugins/') || prefix.split('/').length !== 3 || !FOLDER.test(folder)) throw invalid('插件路径应为 plugins/<文件夹>/（小写字母、数字、点、下划线、连字符）：' + plugin.path)
      const target = targetDirectory || path.join(stagingRoot, cardKey, folder)
      await rm(target, { recursive: true, force: true })
      const hash = createHash('sha256')
      let bytes = 0, files = 0
      const entries = [...zip.entries.values()].filter(entry => entry.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path))
      for (const entry of entries) {
        bytes += entry.size
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
  async function installed(bindings = null) {
    const map = new Map()
    bindings ??= await readEnabledBindings({ dataRoot, cardPaths })
    for (const folder of await readdir(pluginsDir).catch(() => [])) {
      if (folder.startsWith('.')) continue
      const directory = path.join(pluginsDir, folder)
      let name = ''
      try { name = String(JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).name || '') } catch { continue }
      if (!name) continue
      let marker = null
      try { marker = JSON.parse(await readFile(path.join(directory, MARKER), 'utf8')) } catch {}
      if (!marker && bundledPluginRelease(folder, name)?.defaultDisabled && await exists(path.join(directory, DISABLED_FILE))) {
        let source
        try { source = JSON.parse(await readFile(path.join(directory, SOURCE_FILE), 'utf8')) } catch {}
        if (source?.kind === 'builtin') continue
      }
      // Older installs named one card (`cardPath`); now a list.
      const sha256 = String(marker?.sha256 || '')
      const verdict = bindingVerdict({ name, sha256 }, bindings)
      if (verdict?.reason) continue
      const cards = verdict?.cards ?? (marker ? [...new Set((Array.isArray(marker.cards) ? marker.cards : [marker.cardPath]).filter(Boolean).map(String))] : null)
      map.set(name, { folder, cards, sha256, managed: marker?.managed === true })
    }
    return map
  }

  /** Card plugins in use: plugin name → { cards, folder }. */
  async function scope() {
    const bindings = await readEnabledBindings({ dataRoot, cardPaths })
    const holders = await installed(bindings)
    const result = new Map([...holders].filter(([, item]) => !item.managed && item.cards?.length).map(([name, item]) => [name, { cards: item.cards, folder: item.folder }]))
    // Running identities keep their card origin even after a binding is removed.
    const names = new Set([...bindings.keys(), ...[...runningUserPlugins].filter(([, identity]) => identity.origin === 'card').map(([name]) => name)])
    for (const name of names) {
      const holder = holders.get(name), running = runningUserPlugins.get(name)
      const verdict = bindingVerdict({ name, sha256: running?.sha256 }, bindings)
      const available = holder && running?.origin === 'card' && holder.folder === running.folder && verdict && !verdict.reason
      const scope = { cards: available ? verdict.cards.filter(card => running.cardIds.includes(card)) : [], folder: holder?.folder ?? null }
      result.set(name, scope)
      if (running?.runtimeName && running.runtimeName !== name) result.set(running.runtimeName, scope)
    }
    return result
  }

  const writeMarker = (folder, cards, sha256) => writeFile(path.join(pluginsDir, folder, MARKER), JSON.stringify({ cards, sha256 }, null, 2))

  /** Put a card's staged plugins in use, confined to that card; an identical copy already in use is shared. */
  function enable(input) { return serial(() => enableNow(input)) }
  async function enableNow({ cardKey, cardPath, plugins }) {
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

  // A card's plugin folders for its DSH card export: the archive entries (read from disk as the archive is written) and
  // the dsh.json plugin descriptors.
  async function exportEntries({ cardKey, plugins }) {
    const entries = [], descriptors = []
    for (const plugin of plugins) {
      if (!FOLDER.test(plugin.folder)) throw invalid('插件文件夹无效')
      const root = path.join(stagingRoot, cardKey, plugin.folder), prefix = 'plugins/' + plugin.folder + '/'
      const pkg = await readPluginManifest(root, plugin.folder)
      descriptors.push({ name: pkg.name, version: pkg.version, path: prefix, purpose: plugin.purpose || '' })
      async function walk(relative = '') {
        for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isSymbolicLink()) throw invalid('插件中包含符号链接，无法导出')
          const name = relative + entry.name
          if (entry.isDirectory()) await walk(name + '/')
          else if (entry.isFile()) entries.push({ path: prefix + name, file: path.join(root, name) })
        }
      }
      await walk()
    }
    return { entries, plugins: descriptors }
  }  let managedOwner
  function managed({distributions,cardRoots,retiredIds}) {
    return managedOwner ||= createCardPluginManagedOwner({stagingRoot,pluginsDir,serial,distributions,cardRoots,retiredIds,invalidate:()=>{scopes=null}})
  }
  const exists = file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
  async function saveJournal(journal, step) {
    journal.step = step
    await mkdir(path.dirname(journalPath), { recursive: true })
    await writeFile(journalPath + '.tmp', JSON.stringify(journal, null, 2) + '\n')
    await rename(journalPath + '.tmp', journalPath)
    await updateCheckpoint(step)
  }
  async function loadJournal() {
    if (!journalPath) return null
    let journal
    try { journal = JSON.parse(await readFile(journalPath, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (journal.dataRoot !== path.resolve(dataRoot)) throw invalid('Pending plugin update belongs to another profile')
    return journal
  }
  // Returns the first file that is missing or not the recorded size, or null when the tree is complete.
  async function firstIncompleteFile(directory, files) {
    for (const file of files) {
      try {
        const info = await stat(path.join(directory, file.path))
        if (!info.isFile() || info.size !== file.bytes) return file.path
      } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return file.path; throw error }
    }
    return null
  }
  async function cleanupUpdate(journal) {
    for (const [index, swap] of journal.swaps.entries()) {
      await rm(swap.backup, { recursive: true, force: true })
      await rm(swap.temporary, { recursive: true, force: true })
      await saveJournal(journal, 'cleaned-' + index)
    }
    await rm(journalPath, { force: true })
    scopes = null
  }
  async function rollbackUpdate(journal, restoreBinding, reason = null) {
    if (reason) journal.rollbackReason = reason
    journal.rollback = true
    await saveJournal(journal, 'rollback')
    await restoreBinding(journal)
    for (const [index, swap] of [...journal.swaps.entries()].reverse()) {
      if (await exists(swap.backup)) {
        await rm(swap.target, { recursive: true, force: true })
        await rename(swap.backup, swap.old)
      } else if (!swap.hadOld) await rm(swap.target, { recursive: true, force: true })
      await rm(swap.temporary, { recursive: true, force: true })
      await saveJournal(journal, 'restored-' + index)
    }
    await rm(journalPath, { force: true })
    scopes = null
    return { recovered: true, action: 'rolled-back', cardPath: journal.cardPath, previousVersion: journal.previousVersion, reason: journal.rollbackReason }
  }
  async function finishUpdate(journal, { readBinding, commit, restoreBinding }) {
    if (journal.rollback) return rollbackUpdate(journal, restoreBinding)
    if (!journal.verified) {
      if (!journal.next) return rollbackUpdate(journal, restoreBinding, '更新未完成准备')
      // Directory presence also covers a process exit between rename and its journal write.
      for (const swap of journal.swaps) {
        const staged = await exists(swap.temporary)
        if (!staged && swap.hadOld && !await exists(swap.backup)) return rollbackUpdate(journal, restoreBinding, '原插件副本缺失')
        const source = staged ? swap.temporary : swap.target
        const missing = await firstIncompleteFile(source, swap.files || journal.files)
        if (missing) return rollbackUpdate(journal, restoreBinding, '暂存文件 ' + missing + ' 缺失或大小不符')
      }
      const current = await readBinding(journal)
      const next = { ...journal.expected, ...journal.next, enabled: journal.expected.enabled }
      if (JSON.stringify(current) !== JSON.stringify(journal.expected) && JSON.stringify(current) !== JSON.stringify(next)) {
        throw invalid('Plugin binding changed during recovery; pending update retained')
      }
      for (const [index, swap] of journal.swaps.entries()) {
        if (await exists(swap.temporary)) {
          if (swap.hadOld && !await exists(swap.backup)) {
            await rename(swap.old, swap.backup)
            await updateCheckpoint('renamed-old-' + index)
            await saveJournal(journal, 'old-moved-' + index)
          }
          await rename(swap.temporary, swap.target)
          await updateCheckpoint('renamed-new-' + index)
          await saveJournal(journal, 'new-moved-' + index)
        }
      }
      if (JSON.stringify(current) !== JSON.stringify(next)) await commit(journal)
      await updateCheckpoint('binding-written')
      await saveJournal(journal, 'bound')
      if (JSON.stringify(await readBinding(journal)) !== JSON.stringify(next)) throw invalid('Plugin binding read-back failed')
      for (const swap of journal.swaps) {
        const pkg = await readPluginManifest(swap.target, journal.expected.folder)
        if (pkg.name !== journal.expected.name || pkg.version !== journal.version) throw invalid('Plugin read-back failed')
      }
      journal.verified = true
      await saveJournal(journal, 'verified')
    }
    await cleanupUpdate(journal)
    return { recovered: true, action: 'completed', cardPath: journal.cardPath }
  }
  function recoverBoundPlugin(callbacks) {
    return serial(async () => {
      const journal = await loadJournal()
      return journal ? finishUpdate(journal, callbacks) : { recovered: false }
    })
  }
  function updateBoundPlugin({ cardKey, cardPath, expected, zip, descriptor, readBinding, checkUnchanged, backup, commit, restoreBinding, contentUnchanged = false }) {
    return serial(async () => {
      if (!journalPath) throw invalid('Plugin update journal is not configured')
      if (await loadJournal()) throw invalid('Recover the pending plugin update first')
      const current = await readBinding({cardPath, expected})
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw invalid('插件绑定已变化，请重新预览')
      await checkUnchanged(current)
      const holder = (await installed()).get(expected.name)
      const sharedUnchanged = holder?.cards && holder.sha256 === expected.sha256 && contentUnchanged && !holder.managed
      if (holder?.managed || holder && !sharedUnchanged && (!holder.cards || holder.cards.some(card => card !== cardPath))) {
        throw invalid('同名插件由其他人物卡或托管安装占用，不能独立更新')
      }
      const oldStage = path.join(stagingRoot, cardKey, expected.folder)
      const previousVersion = (await readPluginManifest(oldStage, expected.folder)).version
      const backupPath = await backup(), id = randomUUID()
      const stageSwap = {old:oldStage, target:oldStage, temporary:path.join(path.dirname(oldStage), '.update-stage-' + id),
        backup:path.join(path.dirname(oldStage), '.update-backup-' + id), hadOld:true}
      const swaps = [stageSwap]
      if (expected.enabled && !sharedUnchanged) {
        const old = holder ? path.join(pluginsDir, holder.folder) : path.join(pluginsDir, installedFolder(expected))
        swaps.unshift({old, target:old, temporary:path.join(pluginsDir, '.update-stage-' + id),
          backup:path.join(pluginsDir, '.update-backup-' + id), hadOld:!!holder})
      }
      const journal = {dataRoot:path.resolve(dataRoot), cardPath, expected, backupPath, swaps, previousVersion}
      const callbacks = {readBinding, commit, restoreBinding}
      await saveJournal(journal, 'preparing')
      let outcome
      try {
        const prefix = descriptor.path.replace(/\/*$/, '/')
        const targetPrefix = 'plugins/' + expected.folder + '/'
        const entries = new Map([...zip.entries.values()].filter(entry => entry.path.startsWith(prefix)).map(entry => {
          const name = targetPrefix + entry.path.slice(prefix.length)
          return [name, { ...entry, path: name, source: entry }]
        }))
        const selected = { entries, stream: entry => zip.stream(entry.source) }
        const [next] = await stageNow(selected, {cardKey, plugins:[{...descriptor, path:targetPrefix}], targetDirectory:swaps[0].temporary})
        if (next.name !== expected.name) throw invalid('Source plugin name does not match binding')
        if (swaps.length === 2) {
          // A different path is required for Node to import the new entry and its relative dependencies.
          const installed = path.join(pluginsDir, installedFolder(next))
          if (installed !== swaps[0].old && await exists(installed)) throw invalid('更新目标的插件目录已存在')
          swaps[0].target = installed
          await cp(swaps[0].temporary, stageSwap.temporary, {recursive:true})
          const marker = JSON.stringify({cards:[cardPath], sha256:next.sha256}, null, 2)
          await writeFile(path.join(swaps[0].temporary, MARKER), marker)
          // A source's own marker is overwritten by the generated one: count the generated bytes only.
          swaps[0].files = [...entries.values()].map(entry => ({path:entry.path.slice(targetPrefix.length), bytes:entry.size})).filter(file => file.path !== MARKER)
          swaps[0].files.push({path:MARKER, bytes:Buffer.byteLength(marker)})
        }
        journal.next = next
        journal.version = (await readPluginManifest(stageSwap.temporary, expected.folder)).version
        journal.files = [...entries.values()].map(entry => ({path:entry.path.slice(targetPrefix.length), bytes:entry.size}))
        await saveJournal(journal, 'prepared')
        outcome = await finishUpdate(journal, callbacks)
      } catch (error) {
        // Fault injection models abrupt process exit: leave disk state for a fresh service.
        if (error.simulatedExit || journal.verified) throw error
        let rolled
        try { rolled = await rollbackUpdate(journal, restoreBinding, error.message) }
        catch (restoreError) { throw new AggregateError([error, restoreError], '插件更新回滚未完成，请用 --recover 继续：' + error.message + '；' + restoreError.message) }
        throw pluginUpdateRolledBack(rolled)
      } finally { scopes = null }
      if (outcome.action === 'rolled-back') throw pluginUpdateRolledBack(outcome)
      return {plugin:{...expected, ...journal.next, enabled:expected.enabled}, backupPath,
        restartRequired:expected.enabled === true && expected.sha256 !== journal.next.sha256}
    })
  }
  return Object.freeze({ stage, enable, disable, remove, movePath, scope, managed, exportEntries, updateBoundPlugin, recoverBoundPlugin })
}

/** Short-lived, one-use consent for replacing an existing card plugin only. */
export function createCardPluginUpdates({ cardPlugins, castAssets, backup, now = Date.now, maxAgeMs = 10 * 60 * 1000 }) {
  const tickets = new Map()
  async function binding(cardPath, name) {
    const matches = ((await castAssets.read(cardPath)).plugins || []).filter(plugin => plugin.name === name)
    if (matches.length !== 1) throw invalid('Plugin binding missing or ambiguous')
    return matches[0]
  }
  const recoveryCallbacks = {
    readBinding: journal => binding(journal.cardPath, journal.expected.name),
    commit: journal => castAssets.updatePlugin(journal.cardPath, journal.expected, journal.next),
    restoreBinding: journal => castAssets.restorePlugin(journal.cardPath, journal.expected, journal.next)
  }
  async function recover() {
    const outcome = await cardPlugins.recoverBoundPlugin(recoveryCallbacks)
    if (outcome.action === 'rolled-back') throw pluginUpdateRolledBack(outcome)
    return outcome
  }
  async function storedFiles(cardPath, plugin) {
    const exported = await cardPlugins.exportEntries({cardKey:castAssets.keyOf(cardPath), plugins:[plugin]})
    return new Map(await Promise.all(exported.entries.map(async entry => [entry.path.split('/').slice(2).join('/'), await readFile(entry.file)])))
  }
  function sameFiles(a, b) { return a.size === b.size && [...a].every(([name, bytes]) => b.get(name)?.equals(bytes)) }
  function view(files) {
    return {version:JSON.parse(files.get('package.json')).version, files:[...files].map(([path, bytes]) => ({path, bytes:bytes.length}))}
  }
  async function preview({ cardPath, file, pluginName }) {
    for (const [id, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(id)
    const zip = await openZipFile(file)
    try {
      const bound = (await castAssets.read(cardPath)).plugins || []
      // The source is the plugin's own ZIP (as its author publishes it) or a .dshcard carrying it.
      const card = zip.entries.has('dsh.json')
      let expandedBytes = 0
      async function read(entries) {
        const result = []
        for (const entry of entries) {
          expandedBytes += entry.size
          if (expandedBytes > 1024 * 1024 * 1024) throw invalid('插件内容超过 1 GB')
          result.push([entry.path, await zip.readBuffer(entry, 1024 * 1024 * 1024)])
        }
        return result
      }
      let descriptor, files
      if (card) {
        const archive = await readCardArchive(zip)
        const candidates = archive.plugins.filter(plugin => (!pluginName || plugin.name === pluginName) && bound.some(row => row.name === plugin.name))
        if (candidates.length !== 1) throw invalid('人物卡里要正好有一个这张卡已绑定的插件；有多个时请指定插件名')
        descriptor = candidates[0]
        const prefix = descriptor.path.replace(/\/*$/, '/')
        files = new Map((await read([...zip.entries.values()].filter(entry => entry.path.startsWith(prefix)))).map(([name, bytes]) => [name.slice(prefix.length), bytes]))
      } else {
        const plugin = readPluginFiles(await read(zip.entries.values()))
        const row = bound.find(item => item.name === plugin.pkg.name)
        if (!row || pluginName && pluginName !== row.name) throw invalid('这张卡没有绑定插件 ' + plugin.pkg.name)
        descriptor = {name:row.name, path:'plugin/', purpose:row.purpose || ''}
        files = plugin.files
      }
      const expected = await binding(cardPath, descriptor.name)
      const pkg = JSON.parse(files.get('package.json'))
      if (pkg.name !== expected.name) throw invalid('Source package name does not match the binding')
      const beforeFiles = await storedFiles(cardPath, expected)
      const inspectionId = randomUUID(), expiresAt = now() + maxAgeMs
      const result = {inspectionId, expiresAt, path:cardPath, pluginName:expected.name, enabled:expected.enabled,
        before:view(beforeFiles), after:view(files), changes:[...new Set([...beforeFiles.keys(), ...files.keys()])].flatMap(path => {
          if (!beforeFiles.has(path)) return [{path, kind:'added'}]
          if (!files.has(path)) return [{path, kind:'removed'}]
          return beforeFiles.get(path).equals(files.get(path)) ? [] : [{path, kind:'modified'}]
        })}
      tickets.set(inspectionId, {cardPath, expected, descriptor, files, beforeFiles, expiresAt, result})
      return result
    } finally { await zip.close() }
  }
  async function confirm({ cardPath, inspectionId, acceptPluginRisk }) {
    const ticket = tickets.get(inspectionId)
    if (!ticket || ticket.expiresAt <= now() || ticket.cardPath !== cardPath || acceptPluginRisk !== true) throw invalid('Missing, expired or mismatched plugin consent')
    tickets.delete(inspectionId)
    const {expected, descriptor, files, beforeFiles, result} = ticket
    const prefix = descriptor.path.replace(/\/*$/, '/')
    const entries = new Map([...files].map(([name, bytes]) => [prefix + name, {path:prefix + name, size:bytes.length, bytes}]))
    const updated = await cardPlugins.updateBoundPlugin({cardKey:castAssets.keyOf(cardPath), cardPath, expected, descriptor,
      zip:{entries, stream:entry => Readable.from([entry.bytes])}, contentUnchanged:sameFiles(files, beforeFiles),
      ...recoveryCallbacks,
      checkUnchanged:async current => {
        if (!sameFiles(beforeFiles, await storedFiles(cardPath, current))) throw invalid('Target plugin files changed; preview again')
      },
      backup:() => backup(cardPath)})
    return {path:cardPath, pluginName:expected.name, enabled:expected.enabled, beforeVersion:result.before.version,
      afterVersion:result.after.version, backupPath:updated.backupPath, restartRequired:updated.restartRequired,
      ...(updated.reloaded ? {reloaded:true} : {})}
  }
  return Object.freeze({preview, confirm, recover})
}
