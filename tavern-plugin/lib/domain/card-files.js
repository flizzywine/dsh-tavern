import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StoredFile } from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import { exportDshCardSnapshot } from './dsh-card-export.js'
import { readCardArchive } from './card-archive.js'
import { buildCharxContents, cardImport, cardImportFromCard, cardLibraryMaterial, pngCardTextChunk, pngWithTextChunks } from './card-assets.js'
import { cardAssetExtensionPointer, validateCardAssetExtension } from './card-asset-bindings.js'
import { rawData } from './card-preparation.js'
import { createCardImportIdentity } from './card-import-identity.js'
import { normalizeResourcePath } from './file-resources.js'
import { openCardZip } from './card-encryption.js'
import { writeZipEntries } from './zip-entries.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Card files in and out of the card library. pluginApi is a getter: it is built after the library.
export function createCardFiles({ cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset, readCardWorkspace, worldBooks, pluginApi, assetLibrary = () => null, withCardBackup, exportRoot = os.tmpdir() }) {
  const cardImportIdentity = createCardImportIdentity({ cardPaths: () => fileResources.list('card'), castAssets, readCardText: cardPath => fileResources.readText(cardPath) })
  async function importCard(input, options = {}) {
    // A CHARX is stored as PNG or JSON; the material any card file carries goes to its character material.
    return await storeImportedCard(cardImport(input), options)
  }
  // A CHARX, DSH card or card bundle read from disk: its packs first, so a failure leaves no card behind.
  // The stage reads packs from the asset library (dsh-asset-library), so a card's packs install there too:
  // a new pack is installed, an identical one is left as it is. A different installed version, a pack
  // whose identity clashes or one that carries scripts is not touched; it is reported, and the player decides
  // in the asset library.
  async function installPacksInLibrary(zip, packs) {
    // Explicit formats belong to their consumers. Older cards may omit the format,
    // so recognize a native pack by its own manifest in that case.
    const nativePacks = []
    for (const pack of packs) {
      if (pack.format === 'dsh-asset-pack') nativePacks.push(pack)
      else if (!pack.format) {
        const manifest = zip.entries.get(pack.prefix + 'manifest.json')
        if (manifest) {
          try {
            if (JSON.parse((await zip.readBuffer(manifest, 8 * 1024 * 1024)).toString('utf8')).format === 'dsh-asset-pack') nativePacks.push(pack)
          } catch {} // An unidentifiable opaque pack remains available to its plugin.
        }
      }
    }
    if (!nativePacks.length) return []
    const library = assetLibrary()
    if (!library || typeof library.inspectImportFile !== 'function') return ['素材库不可用：这张卡的素材包没有装进素材库，舞台用不到它们']
    const notices = []
    for (const pack of nativePacks) {
      const label = pack.title || pack.id
      const dir = await mkdtemp(path.join(os.tmpdir(), 'tavern-card-pack-'))
      try {
        const entries = []
        for (const entry of zip.entries.values()) {
          if (entry.path.startsWith(pack.prefix) && entry.path.length > pack.prefix.length && !entry.path.endsWith('/'))
            entries.push({ path: entry.path.slice(pack.prefix.length), content: await zip.readBuffer(entry, 512 * 1024 * 1024) })
        }
        const archive = path.join(dir, 'pack.zip')
        await writeFile(archive, writeZipEntries(entries))
        const preview = await library.inspectImportFile({ file: archive })
        const decision = preview.choices.includes('noop') ? 'noop'
          : preview.choices.includes('install') && !(preview.scriptRisk || []).length ? 'install' : ''
        if (!decision) {
          await library.applyImport({ inspectionId: preview.inspectionId, decision: 'cancel' }).catch(() => {})
          notices.push('素材包「' + label + '」' + ((preview.scriptRisk || []).length ? '带脚本' : '素材库里已有不同的版本') + '，没有自动装入，请在素材库里处理')
          continue
        }
        await library.applyImport({ inspectionId: preview.inspectionId, decision, expectedRevision: preview.expectedRevision })
      } catch (error) {
        notices.push('素材包「' + label + '」装进素材库失败：' + str(error?.message || error))
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
    return notices
  }
  async function importCardArchiveFile(file, name, { password, replacePath, pluginChoices } = {}) {
    if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
    const label = /\.dshcard$/i.test(name) ? 'DSH 人物卡' : 'CHARX'
    // The very same file again: open the card already imported from it (if still unchanged), and make sure
    // its packs are in the asset library (cards imported before the library came carry none there).
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    const authenticated = await openCardZip(file, { label, password })
    if (existing && !replacePath) {
      const zip = authenticated
      let libraryNotices = []
      try { libraryNotices = await installPacksInLibrary(zip, (await readCardArchive(zip)).packs) } finally { await zip.close() }
      return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true,
        ...(libraryNotices.length ? { libraryNotices } : {}) }
    }
    const zip = authenticated
    try {
      const archive = await readCardArchive(zip)
      const libraryNotices = await installPacksInLibrary(zip, archive.packs)
      const packs = []
      for (const pack of archive.packs) {
        const { pack: stored, reused } = await assetPacks.importFromZip(zip, pack)
        packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: pack.prefix.split('/')[1], files: Object.keys(stored.files).length, reused })
      }
      const imported = await storeImportedCard(cardImportFromCard({ card: archive.card, resolve: archive.resolve, name }), { unique: true, library: !archive.packs.length, replacePath })
      if (packs.length) await castAssets.bindPacks(imported.path, packs)
      libraryNotices.push(...(imported.libraryNotices || []))
      await cardImportIdentity.remember(imported.path, archiveSha256)
      // The card's plugins come on with it, confined to this card; the card library can turn them off.
      const plugins = archive.plugins.length ? await cardPlugins.stage(zip, { cardKey: castAssets.keyOf(imported.path), plugins: archive.plugins }) : []
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
    const document = cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook: await worldBooks.characterBookForCard(cardPath) })
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
  // the card binds (and the packs it came with); `packIds` chooses, and a pack left out also leaves the exported card's
  // bindings. `excludeFigures` leaves figures of the packs out (e.g. the one the player plays) with the media only they
  // use. Packs can be large, so the archive is written to a spool file under exportRoot and streamed.
  async function exportCardFile(input, options = {}) {
    return writeCardFile(input, options)
  }
  async function writeCardFile(input, { excludeFigures = [], packIds } = {}, backup = false) {
    if (!Array.isArray(excludeFigures) || excludeFigures.some(id => typeof id !== 'string')
      || packIds !== undefined && (!Array.isArray(packIds) || packIds.some(id => typeof id !== 'string'))) throw Object.assign(new Error('导出参数无效'), { code: 'TAVERN_EXPORT_INVALID' })
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
        const packs = [...(snapshot?.packs || []), ...importedPacks], extraEntries = [...entries]
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
        return exportDshCardSnapshot({ file, card: raw, packs, cover, excludeFigures, entries: extraEntries, plugins: pluginFiles.plugins, defaults: Object.keys(defaults).length ? defaults : undefined })
      }
      const imported = importedPacks.map(pack => pack.manifest.id)
      const ids = boundIds.filter(id => !imported.includes(id) && (!chosen || chosen.has(id)))
      const library = assetLibrary()
      if (!backup && (ids.length || chosen) && !library) throw Object.assign(new Error('素材库尚未就绪'), { code: 'TAVERN_EXPORT_UNAVAILABLE' })
      // Replacement owns the card, not its installed packs: retain references without copying media.
      const selection = backup
        ? { path: cardPath, packIds: [], keepPackIds: [...boundIds, ...(material.packs || []).map(ref => ref.id), ...(document.data?.extensions?.dsh_tavern?.modConfigPackId ? [document.data.extensions.dsh_tavern.modConfigPackId] : [])] }
        : { path: cardPath, packIds: ids, keepPackIds: imported }
      const result = library ? await (backup
        ? withCardBackup(file, selection, write)
        : library.withCardExport(selection, write)) : await write()
      return { name: result.card.data.name || '人物卡', extension: 'dshcard', contentType: 'application/zip', file, size: result.size,
        stream: () => createReadStream(file), dispose: () => rm(directory, { recursive: true, force: true }) }
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  }
  let replacementTail = Promise.resolve()
  function replaceCard(cardPath, input) {
    const operation = replacementTail.catch(() => {}).then(async () => {
      const target = normalizeResourcePath(cardPath, 'card')
      const workspace = await readCardWorkspace(target)
      if (!workspace) throw new Error('要更新的人物卡不存在')
      // Validate and authenticate before disabling anything or taking a backup.
      if (input.file) {
        const zip = await openCardZip(input.file, { label: '人物卡更新', password: input.password })
        try { await readCardArchive(zip) } finally { await zip.close() }
      } else cardPreparation.create({ kind: 'import', payload: cardImport(input.payload).payload })
      const original = await fileResources.originalCardPayload(target)
      const material = await castAssets.read(target)
      const plugins = material.plugins || []
      const choices = new Map(plugins.map(p => [p.name, p.enabled !== false]))
      const backup = await writeCardFile(target, {}, true)
      const recovery = path.join(path.dirname(exportRoot), 'recovery', 'card-updates')
      await mkdir(recovery, { recursive: true })
      const backupPath = path.join(recovery, path.basename(target, '.json') + '-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.dshcard')
      try { await copyFile(backup.file, backupPath) } finally { await backup.dispose() }
      try {
        await cardPlugins.disable({ cardPath: target, plugins })
        await castAssets.replaceManifest(target, null)
        const card = input.file
          ? await importCardArchiveFile(input.file, input.name, { password: input.password, replacePath: target, pluginChoices: choices })
          : await importCard(input.payload, { replacePath: target })
        return { ...card, updated: true, backupPath }
      } catch (error) {
        try {
          const current = await castAssets.read(target)
          await cardPlugins.disable({ cardPath: target, plugins: current.plugins || [] })
          await importCardArchiveFile(backupPath, 'backup.dshcard', { replacePath: target, pluginChoices: choices })
          if (original) await fileResources.importCard(original, workspace, { replacePath: target })
          else await fileResources.writeWorking(target, JSON.stringify(workspace, null, 2))
          await castAssets.replaceManifest(target, material)
        } catch (restoreError) {
          throw new Error('更新失败且自动恢复未完成。备份：' + backupPath + '；' + restoreError.message, { cause: error })
        }
        throw new Error('更新失败，已恢复原卡：' + error.message, { cause: error })
      }
    })
    replacementTail = operation
    return operation
  }
  return { replaceCard, importCard, importCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile }
}
