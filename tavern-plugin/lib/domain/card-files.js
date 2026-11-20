import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StoredFile, writePackZip } from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import { exportDshCardSnapshot } from './dsh-card-export.js'
import { withoutPlayerChoices } from './card-export-settings.js'
import { readCardArchive } from './card-archive.js'
import { buildCharxContents, cardImport, cardImportFromCard, cardLibraryMaterial, pngCardTextChunk, pngWithTextChunks } from './card-assets.js'
import { cardAssetExtensionPointer, validateCardAssetExtension } from './card-asset-bindings.js'
import { rawData } from './card-preparation.js'
import { createCardImportIdentity } from './card-import-identity.js'
import { normalizeResourcePath } from './file-resources.js'
import { openCardZip } from './card-encryption.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}
const archiveLabel = name => /\.dshcard$/i.test(name) ? 'DSH 人物卡' : 'CHARX'
const COVER_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
// An installed pack the card carries another version of: the player chooses 完全替换 (update) or, where the asset
// library offers it, 增量更新 (merge). A pack with scripts is never installed from a card (the asset library asks).
const packConflict = preview => preview.choices.includes('update') && !(preview.scriptRisk || []).length

// Card files in and out of the card library. pluginApi is a getter: it is built after the library.
// backupPack(file, {packId, expectedRevision}) writes an installed pack, unchanged, to a private file (the asset
// library's assetLibraryPackBackup): an update keeps the versions it replaces so 撤回 can put them back.
export function createCardFiles({ cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset, readCardWorkspace, worldBooks, pluginApi, assetLibrary = () => null, prepareCardAssets, withCardBackup, backupPack, exportRoot = os.tmpdir(), syncBubbles = async () => {} }) {
  const cardImportIdentity = createCardImportIdentity({ cardPaths: () => fileResources.list('card'), castAssets, readCardText: cardPath => fileResources.readText(cardPath) })
  async function importCard(input, options = {}) {
    // A CHARX is stored as PNG or JSON; the material any card file carries goes to its character material.
    return await storeImportedCard(cardImport(input), options)
  }
  const packLibrary = () => { const library = assetLibrary(); return library && typeof library.inspectImportFile === 'function' ? library : null }
  // One pack of a card archive as the asset library previews it: its files re-rooted into a pack ZIP and inspected;
  // use(preview) applies or cancels that preview.
  async function inspectCardPack(library, zip, pack, use) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tavern-card-pack-'))
    try {
      const entries = []
      for (const entry of zip.entries.values()) {
        if (!entry.path.startsWith(pack.prefix) || entry.path.length === pack.prefix.length || entry.path.endsWith('/')) continue
        if (entry.size > 512 * 1024 ** 2) throw new Error('素材包文件超过 512 MiB：' + entry.path)
        entries.push({ path: entry.path.slice(pack.prefix.length), stream: () => zip.stream(entry) })
      }
      const archive = path.join(dir, 'pack.zip')
      await writePackZip(archive, entries)
      return await use(await library.inspectImportFile({ file: archive }))
    } finally { await rm(dir, { recursive: true, force: true }) }
  }
  // A CHARX, DSH card or card bundle read from disk: its packs first, so a failure leaves no card behind.
  // The stage reads packs from the asset library (dsh-asset-library), so a card's packs install there too:
  // a new pack is installed, an identical one is left as it is, a different installed version takes the player's
  // decision (packDecisions: pack id → update | merge; 完全替换 when there is none). A pack whose identity clashes or
  // one that carries scripts is not touched; it is reported, and the player decides in the asset library.
  // packBackups {dir, list}: each installed version an update or merge replaces is first written to dir and listed.
  async function installPacksInLibrary(zip, packs, { packDecisions = {}, packBackups } = {}) {
    if (!packs.length) return []
    const library = packLibrary()
    if (!library) return ['素材库不可用：这张卡的素材包没有装进素材库，舞台用不到它们']
    const notices = []
    for (const pack of packs) {
      const label = pack.title || pack.id
      try {
        await inspectCardPack(library, zip, pack, async preview => {
          const decision = preview.choices.includes('noop') ? 'noop'
            : (preview.scriptRisk || []).length ? ''
              : preview.choices.includes('install') ? 'install'
                : packConflict(preview) ? packDecisions[pack.id] || 'update' : ''
          if (!decision) {
            await library.applyImport({ inspectionId: preview.inspectionId, decision: 'cancel' }).catch(() => {})
            notices.push('素材包「' + label + '」' + ((preview.scriptRisk || []).length ? '带脚本' : '和素材库里已有的包冲突') + '，没有自动装入，请在素材库里处理')
            return
          }
          const kept = packBackups && packConflict(preview) ? { packId: pack.id, title: label, file: pack.id + '.zip' } : null
          if (kept) {
            await mkdir(packBackups.dir, { recursive: true })
            await backupPack(path.join(packBackups.dir, kept.file), { packId: pack.id, expectedRevision: preview.expectedRevision })
          }
          await library.applyImport({ inspectionId: preview.inspectionId, decision, expectedRevision: preview.expectedRevision })
          if (kept) packBackups.list.push(kept)
        })
      } catch (error) {
        notices.push('素材包「' + label + '」装进素材库失败：' + str(error?.message || error))
      }
    }
    return notices
  }
  // Before an archive is imported or a card updated from it: the card's name, version and cover, and the packs the
  // player decides about (packConflict) with the asset library's choices and what a 完全替换 would remove from them.
  async function previewCardArchiveFile(file, name, { password } = {}) {
    if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
    const zip = await openCardZip(file, { label: archiveLabel(name), password })
    try {
      const archive = await readCardArchive(zip)
      const data = archive.card.data || archive.card
      const icon = (Array.isArray(data.assets) ? data.assets : []).find(asset => asset?.type === 'icon' && asset.name === 'main')
      const coverType = icon && COVER_TYPES[str(icon.ext).toLowerCase()], coverBytes = coverType && archive.resolve(icon.uri)
      const packs = [], library = packLibrary()
      for (const pack of library ? archive.packs : []) {
        // Only an installed pack with other content can need a decision; the others are not unpacked twice.
        const installed = await library.getPackSnapshot({ packId: pack.id, readOnly: true })
        if (!installed || pack.contentHash && installed.manifest.contentHash === pack.contentHash) continue
        await inspectCardPack(library, zip, pack, async preview => {
          if (packConflict(preview)) packs.push({ packId: pack.id, title: pack.title || pack.id, choices: preview.choices, removed: preview.removed || [] })
          await library.applyImport({ inspectionId: preview.inspectionId, decision: 'cancel' })
        })
      }
      return { card: { name: str(data.name), version: str(data.character_version).trim(), ...(coverBytes ? { cover: 'data:' + coverType + ';base64,' + coverBytes.toString('base64') } : {}) }, packs }
    } finally { await zip.close() }
  }
  // Bound packs a .dshcard does not carry: the binding stays and works once the pack is in the asset library.
  async function dependencyNotices(dependencies) {
    const library = assetLibrary(), notices = []
    for (const dependency of dependencies) {
      if (library && await library.getPackSnapshot({ packId: dependency.id, readOnly: true })) continue
      notices.push('这张卡还需要素材包「' + (dependency.title || dependency.id) + '」：请先导入该包（素材库 → 导入），装好后绑定自动生效')
    }
    return notices
  }
  async function importCardArchiveFile(file, name, { password, replacePath, pluginChoices, packDecisions, packBackups } = {}) {
    if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
    const label = archiveLabel(name)
    // The very same file again: open the card already imported from it (if still unchanged), and make sure
    // its packs are in the asset library (cards imported before the library came carry none there).
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    const authenticated = await openCardZip(file, { label, password })
    if (existing && !replacePath) {
      const zip = authenticated
      let libraryNotices = []
      try {
        const archive = await readCardArchive(zip)
        libraryNotices = [...await installPacksInLibrary(zip, archive.packs, { packDecisions }), ...await dependencyNotices(archive.dependencies)]
      } finally { await zip.close() }
      return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true,
        ...(libraryNotices.length ? { libraryNotices } : {}) }
    }
    const zip = authenticated
    try {
      const archive = await readCardArchive(zip)
      const libraryNotices = [...await installPacksInLibrary(zip, archive.packs, { packDecisions, packBackups }), ...await dependencyNotices(archive.dependencies)]
      const packs = []
      for (const pack of archive.packs) {
        const { pack: stored, reused } = await assetPacks.importFromZip(zip, pack)
        packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: pack.prefix.split('/')[1], files: Object.keys(stored.files).length, reused })
      }
      const imported = await storeImportedCard(cardImportFromCard({ card: archive.card, resolve: archive.resolve, name }), { unique: true, library: !archive.packs.length, replacePath })
      if (packs.length) await castAssets.bindPacks(imported.path, packs)
      libraryNotices.push(...(imported.libraryNotices || []))
      // the 对话气泡 format entry is derived here, from this install's packs (an export never carries one).
      await syncBubbles(imported.path)
      await cardImportIdentity.remember(imported.path, archiveSha256)
      // The card's plugins come on with it, confined to this card; the card library can turn them off.
      const plugins = archive.plugins.length ? await cardPlugins.stage(archive.managed?.zipAdapter || zip, { cardKey: castAssets.keyOf(imported.path), plugins: archive.plugins, verifiedFiles: archive.managed?.expected }) : []
      let pluginError = ''
      const defaults = archive.defaults ? await storeStartDefaults(imported.path, archive.defaults) : null
      if (plugins.length) {
        if (replacePath) await castAssets.setPlugins(imported.path, plugins)
        try { await cardPlugins.enable({ cardKey: castAssets.keyOf(imported.path), cardPath: imported.path, plugins: plugins.filter(plugin => pluginChoices?.get(plugin.name) !== false) }) }
        catch (error) { if (replacePath) throw error; pluginError = str(error?.message || error) }
        await castAssets.setPlugins(imported.path, plugins.map(plugin => ({ ...plugin, enabled: !pluginError && pluginChoices?.get(plugin.name) !== false })))
      }
      return { ...imported, format: archive.kind, ...(archive.info ? { info: archive.info } : {}),
        ...(packs.length ? { packs: packs.map(({ id, contentHash, title, format, files, reused }) => ({ id, contentHash, title, format, files, reused })) } : {}),
        ...(plugins.length ? { plugins: plugins.map(({ name, purpose, files, bytes }) => ({ name, purpose, files, bytes, enabled: !pluginError && pluginChoices?.get(name) !== false })) } : {}),
        ...(pluginError ? { pluginError } : {}),
        ...(libraryNotices.length ? { libraryNotices } : {}),
        ...(defaults ? { startDefaults: { preset: defaults.presetPath ? defaults.presetPath.split('/').pop() : '', settings: defaults.settings || null } } : {}) }
    } finally { await zip.close() }
  }
  // A card file in a format a plugin imports (tavern.cardImporter): the plugin converts, Tavern stores it as any card.
  async function importPluginCardFile(file, name) {
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    if (existing) return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true }
    const converted = await pluginApi().convertCard(name, await readFile(file))
    const resolve = uri => {
      if (typeof uri !== 'string') return undefined
      if (uri.startsWith('embeded://')) return converted.files.get(uri.slice('embeded://'.length))
      const match = /^data:[^,]*;base64,(.*)$/s.exec(uri)
      return match ? Buffer.from(match[1], 'base64') : undefined
    }
    const packs = []
    for (const pack of converted.packs) {
      const { pack: stored, reused } = await assetPacks.importFiles(pack.files, { id: pack.id, format: pack.format, title: pack.title })
      packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: '', files: Object.keys(stored.files).length, reused })
    }
    const imported = await storeImportedCard(cardImportFromCard({ card: converted.card, resolve, name: str(name).replace(/\.[^.]+$/, '') }), { unique: true, library: !converted.packs.length })
    if (packs.length) await castAssets.bindPacks(imported.path, packs)
    await cardImportIdentity.remember(imported.path, archiveSha256)
    await pluginApi().cardImported(converted, imported.path)
    return { ...imported, format: 'plugin', importer: converted.label,
      ...(packs.length ? { packs: packs.map(({ id, contentHash, title, format, files, reused }) => ({ id, contentHash, title, format, files, reused })) } : {}) }
  }
  // A card's suggested preset goes into the preset library (a new name when one is taken by another file).
  async function storeStartDefaults(cardPath, defaults) {
    let presetPath = ''
    if (defaults.preset) {
      const base = defaults.preset.name.replace(/\.json$/i, '')
      const existing = new Map((await presetLibrary.catalog()).presets.map(preset => [preset.path, preset]))
      for (let index = 0; !presetPath; index++) {
        const name = (index ? base + ' (' + index + ')' : base) + '.json'
        const target = 'presets/' + name
        if (existing.has(target)) {
          if (await fileResources.readText(target).catch(() => undefined) === defaults.preset.text) presetPath = target
          continue
        }
        presetPath = (await importPreset({ name, text: defaults.preset.text })).path
      }
    }
    const stored = { ...(presetPath ? { presetPath } : {}), ...(defaults.settings ? { settings: defaults.settings } : {}) }
    await castAssets.setStartDefaults(cardPath, Object.keys(stored).length ? stored : null)
    return stored
  }
  // The asset library's pack becomes the card's own (本卡开启); the cast it came from is in the pack now. The card's stage
  // switch becomes 本卡开启 too (stage.enabled, as a .dshcard's defaults.stage declares it), so its figures show with the
  // global switch off.
  function bindLibraryPack(workspace, packId) {
    const data = rawData(workspace.raw), pointer = cardAssetExtensionPointer(workspace.raw)
    const { cast: _cast, ...own } = data.extensions?.dsh_tavern || {}
    const { dialogue: _dialogue, stage: _stage, ...stage } = own.stage || {}
    const next = { ...own, schemaVersion: own.schemaVersion ?? 1, assetBindings: { boundPackIds: [...new Set([...(own.assetBindings?.boundPackIds || []), packId])] }, stage: { ...stage, enabled: true } }
    validateCardAssetExtension(next)
    const rawOperations = data.extensions === undefined ? [{ op: 'set', path: pointer.slice(0, -'/dsh_tavern'.length), value: { dsh_tavern: next } }] : [{ op: 'set', path: pointer, value: next }]
    return cardPreparation.update({ kind: 'card', card: workspace, patch: {}, rawOperations }).card
  }
  // options.library: a card without packs of its own. With the asset library, the material it brings becomes one pack
  // of the library that the card binds; what the library has no place for stays the card's character material.
  async function storeImportedCard({ payload, collected }, options = {}) {
    let workspace = cardPreparation.create({ kind: 'import', payload: payload })
    const { library: toLibrary = true, ...importOptions } = options
    const library = assetLibrary()
    let material = collected, libraryPack = null, libraryNotices = [], installed
    if (collected && toLibrary && typeof library?.importCardMaterial === 'function') {
      const name = cardPreparation.project(workspace).name || '人物卡', split = cardLibraryMaterial(collected, name)
      if (split.material) {
        const stored = await library.importCardMaterial({ name, material: split.material })
        libraryNotices = stored.notices
        if (stored.packId) { material = split.rest; workspace = bindLibraryPack(workspace, stored.packId); libraryPack = { id: stored.packId, name, status: stored.status }; installed = stored.revision }
      }
    }
    let cardPath
    try { cardPath = await fileResources.importCard(payload, workspace, importOptions) }
    catch (error) {
      // a pack this import installed goes with the card it was made for
      if (installed !== undefined) await library.removePack({ packId: libraryPack.id, expectedRevision: installed })
      throw error
    }
    const card = cardPreparation.project(workspace)
    let assets = null
    if (material && (material.emotions.length || material.backgrounds.length || material.cover || material.extras.length || material.cast.length || material.skipped)) {
      try { assets = { ...await castAssets.importCardAssets({ cardPath, name: card.name || '主角', collected: material }), skipped: material.skipped } }
      catch (error) { if (options.replacePath) throw error; assets = { error: str(error?.message || error) } }
    }
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags, ...(assets ? { assets } : {}),
      ...(libraryPack ? { libraryPack } : {}), ...(libraryNotices.length ? { libraryNotices } : {}) }
  }
  async function presentCardText(cardPath) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw Object.assign(new Error('人物卡不存在: ' + cardPath), { code: 'TAVERN_NOT_FOUND' })
    const document = withoutPlayerChoices(cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook: await worldBooks.characterBookForCard(cardPath) }))
    return { document, text: JSON.stringify(document) }
  }
  // A standard card PNG: the cover's pixels carrying the current working card, as `chara`
  // (what older tools read) and `ccv3` (what SillyTavern reads first).
  async function exportCardPng(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    const { document, text } = await presentCardText(cardPath)
    const image = await fileResources.readCardImage(cardPath).catch(() => undefined)
    if (!image) throw Object.assign(new Error('人物卡还没有封面，请先用 tavern_set_card_cover 配封面'), { code: 'TAVERN_NOT_FOUND' })
    const name = str(document?.data?.name || '人物卡')
    return { name, bytes: pngWithTextChunks(image, [pngCardTextChunk('chara', text), pngCardTextChunk('ccv3', text)]) }
  }
  // The card as a DSH card (.dshcard, Wiki「设计：dsh-card-format」): card.json and dsh.json, the cover, the card's own
  // material, its plugins and start defaults, and the packs that go with it under assets/<pack id>/ — by default every pack
  // the card binds (and the packs it came with); `packIds` chooses. A bound pack left out stays bound and is listed in
  // dsh.json `dependencies`, so it works wherever that pack is installed. `excludeFigures` leaves figures of the packs out (e.g. the one the player plays) with the media only they
  // use. Private migration sets preserveBindings: unembedded packs stay external references at the destination.
  // Packs can be large, so the archive is written to a spool file under exportRoot and streamed.
  async function exportCardFile(input, { format = 'dshcard', packIds, dependencyPackIds, excludeFigures = [], preserveBindings = false } = {}) {
    if (format === 'dshcard') return writeCardFile(input, { packIds, dependencyPackIds, excludeFigures, preserveBindings })
    if (format !== 'json' && format !== 'png') throw Object.assign(new Error('不支持的人物卡导出格式'), { code: 'TAVERN_EXPORT_INVALID' })
    if (packIds !== undefined || dependencyPackIds !== undefined || !Array.isArray(excludeFigures) || excludeFigures.length) throw Object.assign(new Error('素材包与人物选择仅用于导出 .dshcard'), { code: 'TAVERN_EXPORT_INVALID' })

    if (format === 'png') return { ...await exportCardPng(input), extension: format, contentType: 'image/png' }
    const { document, text } = await presentCardText(normalizeResourcePath(input, 'card'))
    return { name: str(document.data.name) || '人物卡', extension: format, contentType: 'application/json; charset=utf-8', bytes: Buffer.from(text) }
  }
  async function writeCardFile(input, { excludeFigures = [], packIds, dependencyPackIds, preserveBindings = false } = {}, backup = false) {
    if (!Array.isArray(excludeFigures) || excludeFigures.some(id => typeof id !== 'string')
      || [packIds, dependencyPackIds].some(ids => ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')))) throw Object.assign(new Error('导出参数无效'), { code: 'TAVERN_EXPORT_INVALID' })
    let cardPath
    try { cardPath = normalizeResourcePath(input, 'card') }
    catch (error) { throw Object.assign(error, { code: 'TAVERN_EXPORT_INVALID' }) }
    const { document } = await presentCardText(cardPath)
    const material = await castAssets.read(cardPath)
    const pluginFiles = await cardPlugins.exportEntries({ cardKey: castAssets.keyOf(cardPath), plugins: material.plugins || [] })
    const boundIds = document.data?.extensions?.dsh_tavern?.assetBindings?.boundPackIds || []
    const chosen = packIds && new Set(packIds)
    if (chosen && packIds.some(id => !boundIds.includes(id) && !(material.packs || []).some(ref => ref.id === id))) throw Object.assign(new Error('只能选择这张卡用到的素材包'), { code: 'TAVERN_EXPORT_INVALID' })
    // The packs the card was imported with (card-assets packs) come from their store; the bound library packs from the library.
    const importedPacks = []
    for (const ref of (material.packs || []).filter(ref => !backup && (!chosen || chosen.has(ref.id)))) {
      const stored = await assetPacks.readPack(ref.id, ref.contentHash)
      if (!stored) throw Object.assign(new Error('绑定素材包不存在'), { code: 'TAVERN_NOT_FOUND' })
      const files = new Map()
      for (const [name, row] of Object.entries(stored.files)) files.set(name, new StoredFile(row.size, (await assetPacks.file(ref.id, ref.contentHash, name)).path))
      const member = files.get('manifest.json')
      const manifest = member ? JSON.parse(await readFile(member.file, 'utf8')) : { id: ref.id, format: ref.format, contentHash: ref.contentHash, name: ref.title }
      files.delete('manifest.json')
      importedPacks.push({ manifest, files, sourceName: ref.name })
    }
    // defaults.stage comes from the card's own stage declaration (dsh-card-export.js).
    const defaults = {}, entries = [...pluginFiles.entries]
    if (material.startDefaults?.settings) {
      const settings = material.startDefaults.settings
      defaults.settings = { statusBarPlacement: settings.statusBarPlacement, backgroundTasks: settings.backgroundTasks, webSearch: settings.webSearchEnabled }
    }
    if (material.startDefaults?.presetPath) {
      defaults.preset = { path: 'presets/default.json', title: material.startDefaults.presetPath.split('/').pop().replace(/\.json$/i, '') }
      entries.push({ path: defaults.preset.path, data: Buffer.from(await fileResources.readText(material.startDefaults.presetPath)) })
    }
    const cover = await fileResources.readCardImage(cardPath)
    await mkdir(exportRoot, { recursive: true })
    const directory = await mkdtemp(path.join(exportRoot, 'dshcard-'))
    try {
      const file = path.join(directory, 'card.dshcard')
      const write = async snapshot => {
        let raw = snapshot?.raw ? structuredClone(snapshot.raw) : document
        const data = raw.data || raw
        if (document.data?.character_book) data.character_book = document.data.character_book
        const packs = [...(snapshot?.packs || []), ...importedPacks].filter(pack => !preserveBindings || !chosen || chosen.has(pack.manifest.id)), extraEntries = [...entries]
        // The card's own material in its CCv3 places; a file a pack already holds is pointed at there, not copied.
        if ((material.characters || []).length || (material.backgrounds || []).length || (material.extras || []).length) {
          const reused = new Map()
          for (const pack of packs) for (const row of pack.manifest.files || []) if (row.sha256) reused.set(row.sha256.slice(0, 32) + path.posix.extname(row.path), 'embeded://assets/' + pack.manifest.id + '/' + row.path)
          const sources = new Map()
          for (const name of new Set([...(material.characters || []).flatMap(character => [character.avatar, ...Object.values(character.sprites || {})]), ...(material.backgrounds || []).map(row => row.file), ...(material.extras || []).map(row => row.file)].filter(Boolean))) {
            if (!reused.has(name)) sources.set(name, await castAssets.readFile(cardPath, name))
          }
          const contents = buildCharxContents({ document: raw.data ? raw : { data: raw }, manifest: material, characterName: data.name, readFile: name => sources.get(name), resolveFileUri: name => reused.get(name) })
          raw = contents.card
          extraEntries.push(...contents.files.map(({ path, content }) => ({ path, data: content })))
        }
        return exportDshCardSnapshot({ file, card: raw, packs, dependencies: snapshot?.dependencies, cover, excludeFigures, entries: extraEntries, plugins: pluginFiles.plugins, defaults: Object.keys(defaults).length ? defaults : undefined })
      }
      const imported = importedPacks.map(pack => pack.manifest.id)
      const ids = boundIds.filter(id => !imported.includes(id) && (!chosen || chosen.has(id)))
      // Only bound library packs need the card adapter supplied by the optional stage runtime.
      const library = backup || boundIds.length ? assetLibrary() : undefined
      if (!backup && (ids.length || chosen && boundIds.length) && !library) throw Object.assign(new Error('素材库尚未就绪'), { code: 'TAVERN_EXPORT_UNAVAILABLE' })
      if (library) await prepareCardAssets?.()
      // Replacement owns the card, not its installed packs: retain references without copying media.
      const selection = backup
        ? { path: cardPath, packIds: [], keepPackIds: [...boundIds, ...(material.packs || []).map(ref => ref.id), ...(document.data?.extensions?.dsh_tavern?.modConfigPackId ? [document.data.extensions.dsh_tavern.modConfigPackId] : [])] }
        : { path: cardPath, packIds: ids, keepPackIds: preserveBindings ? [...boundIds, ...imported] : imported, ...(dependencyPackIds ? { dependencyPackIds } : {}) }
      const result = library ? await (backup
        ? withCardBackup(file, selection, write)
        : library.withCardExport(selection, write)) : await write()
      return { name: result.card.data.name || '人物卡', extension: 'dshcard', contentType: 'application/zip', file, size: result.size,
        stream: () => createReadStream(file), dispose: () => rm(directory, { recursive: true, force: true }) }
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  }
  // Card updates run one at a time. Each keeps its own folder under recovery/card-updates:
  // card.dshcard (the card before, without media), packs/<id>.zip (installed pack versions it replaced) and update.json
  // (what else 撤回 restores). Only the latest update can be taken back: a new one drops the packs and update.json of the
  // earlier ones and leaves their card backups.
  let replacementTail = Promise.resolve()
  function serialized(work) {
    const operation = replacementTail.catch(() => {}).then(work)
    replacementTail = operation
    return operation
  }
  const updatesRoot = () => path.join(path.dirname(exportRoot), 'recovery', 'card-updates')
  // The card, and the packs an update replaced, as they were before it.
  async function restoreUpdate(record, dir) {
    const library = record.packs.length ? assetLibrary() : null
    for (const pack of record.packs) {
      const preview = await library.inspectImportFile({ file: path.join(dir, 'packs', pack.file) })
      await library.applyImport({ inspectionId: preview.inspectionId, decision: preview.choices.includes('noop') ? 'noop' : 'update', expectedRevision: preview.expectedRevision, acceptScriptRisk: true })
    }
    const target = record.cardPath, current = await castAssets.read(target)
    await cardPlugins.disable({ cardPath: target, plugins: current.plugins || [] })
    await importCardArchiveFile(path.join(dir, 'card.dshcard'), 'backup.dshcard', { replacePath: target, pluginChoices: new Map(record.pluginChoices) })
    if (record.original) await fileResources.importCard(record.original, record.workspace, { replacePath: target })
    else await fileResources.writeWorking(target, JSON.stringify(record.workspace, null, 2))
    await castAssets.replaceManifest(target, record.material)
  }
  // input: {file, name, password, packDecisions} (an archive) or {payload}.
  function replaceCard(cardPath, input) {
    return serialized(async () => {
      const target = normalizeResourcePath(cardPath, 'card')
      const workspace = await readCardWorkspace(target)
      if (!workspace) throw new Error('要更新的人物卡不存在')
      // Validate and authenticate before disabling anything or taking a backup.
      if (input.file) {
        const zip = await openCardZip(input.file, { label: '人物卡更新', password: input.password })
        try { await readCardArchive(zip) } finally { await zip.close() }
      } else cardPreparation.create({ kind: 'import', payload: cardImport(input.payload).payload })
      const material = await castAssets.read(target)
      const plugins = material.plugins || []
      const choices = new Map(plugins.map(p => [p.name, p.enabled !== false]))
      const record = { cardPath: target, original: await fileResources.originalCardPayload(target), workspace, material, pluginChoices: [...choices], packs: [] }
      const root = updatesRoot(), updateId = path.basename(target, '.json') + '-' + Date.now() + '-' + randomUUID().slice(0, 8), dir = path.join(root, updateId)
      for (const earlier of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!earlier.isDirectory()) continue
        await rm(path.join(root, earlier.name, 'update.json'), { force: true })
        await rm(path.join(root, earlier.name, 'packs'), { recursive: true, force: true })
      }
      await mkdir(dir, { recursive: true })
      const backupPath = path.join(dir, 'card.dshcard'), backup = await writeCardFile(target, {}, true)
      try { await copyFile(backup.file, backupPath) } finally { await backup.dispose() }
      try {
        await cardPlugins.disable({ cardPath: target, plugins })
        await castAssets.replaceManifest(target, null)
        const card = input.file
          ? await importCardArchiveFile(input.file, input.name, { password: input.password, replacePath: target, pluginChoices: choices, packDecisions: input.packDecisions, packBackups: { dir: path.join(dir, 'packs'), list: record.packs } })
          : await importCard(input.payload, { replacePath: target })
        // The card's own bubble settings maintain an entry of its world book (the archive import syncs it too).
        if (!input.file) await syncBubbles(target)
        await writeFile(path.join(dir, 'update.json'), JSON.stringify(record))
        return { ...card, updated: true, backupPath, updateId }
      } catch (error) {
        try { await restoreUpdate(record, dir) }
        catch (restoreError) {
          throw new Error('更新失败且自动恢复未完成。备份：' + dir + '；' + restoreError.message, { cause: error })
        }
        throw new Error('更新失败，已恢复原卡：' + error.message, { cause: error })
      }
    })
  }
  // 撤回: the card and the packs of the latest update back as they were before it.
  function revertCardUpdate(updateId) {
    return serialized(async () => {
      const id = str(updateId), dir = path.join(updatesRoot(), id)
      const text = /^[^\\/.][^\\/]*$/.test(id) ? await readFile(path.join(dir, 'update.json'), 'utf8').catch(() => null) : null
      if (text === null) throw Object.assign(new Error('这次更新已经不能撤回'), { code: 'TAVERN_NOT_FOUND' })
      const record = JSON.parse(text)
      await restoreUpdate(record, dir)
      await rm(path.join(dir, 'update.json'), { force: true })
      await rm(path.join(dir, 'packs'), { recursive: true, force: true })
      return { path: record.cardPath, reverted: true }
    })
  }
  return { replaceCard, revertCardUpdate, importCard, importCardArchiveFile, previewCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile }
}
