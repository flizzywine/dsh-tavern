import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readCardArchive } from './card-archive.js'
import { buildCharx, cardImport, cardImportFromCard, cardLibraryMaterial, charxLibraryMaterial, pngCardTextChunk, pngWithTextChunks } from './card-assets.js'
import { cardAssetExtensionPointer, validateCardAssetExtension } from './card-asset-bindings.js'
import { rawData } from './card-preparation.js'
import { createCardImportIdentity } from './card-import-identity.js'
import { normalizeResourcePath, stripPngTextChunks } from './file-resources.js'
import { openZipFile } from './zip-file.js'
import { writeZipEntries } from './zip-entries.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Card files in and out of the card library. pluginApi is a getter: it is built after the library.
export function createCardFiles({ cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset, readCardWorkspace, worldBooks, pluginApi, assetLibrary = () => null }) {
  const cardImportIdentity = createCardImportIdentity({ cardPaths: () => fileResources.list('card'), castAssets, readCardText: cardPath => fileResources.readText(cardPath) })
  async function importCard(input) {
    // A CHARX is stored as PNG or JSON; the material any card file carries goes to its character material.
    return await storeImportedCard(cardImport(input))
  }
  // A CHARX, DSH card or card bundle read from disk: its packs first, so a failure leaves no card behind.
  // The stage reads packs from the asset library (dsh-asset-library), so a card's packs install there too:
  // a new pack is installed, an identical one is left as it is. A different installed version, a pack
  // whose identity clashes or one that carries scripts is not touched; it is reported, and the player decides
  // in the asset library.
  async function installPacksInLibrary(zip, packs) {
    if (!packs.length) return []
    const library = assetLibrary()
    if (!library || typeof library.inspectImportFile !== 'function') return ['素材库不可用：这张卡的素材包没有装进素材库，舞台用不到它们']
    const notices = []
    for (const pack of packs) {
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
  async function importCardArchiveFile(file, name) {
    const label = /\.dshcard(\.png)?$/i.test(name) ? 'DSH 人物卡' : 'CHARX'
    // The very same file again: open the card already imported from it (if still unchanged), and make sure
    // its packs are in the asset library (cards imported before the library came carry none there).
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    if (existing) {
      const zip = await openZipFile(file, { label })
      let libraryNotices = []
      try { libraryNotices = await installPacksInLibrary(zip, (await readCardArchive(zip)).packs) } finally { await zip.close() }
      return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true,
        ...(libraryNotices.length ? { libraryNotices } : {}) }
    }
    const zip = await openZipFile(file, { label })
    try {
      const archive = await readCardArchive(zip)
      const libraryNotices = await installPacksInLibrary(zip, archive.packs)
      const packs = []
      for (const pack of archive.packs) {
        const { pack: stored, reused } = await assetPacks.importFromZip(zip, pack)
        packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: pack.prefix.split('/')[1], files: Object.keys(stored.files).length, reused })
      }
      const imported = await storeImportedCard(cardImportFromCard({ card: archive.card, resolve: archive.resolve, name }), { unique: true, library: !archive.packs.length })
      if (packs.length) await castAssets.bindPacks(imported.path, packs)
      libraryNotices.push(...(imported.libraryNotices || []))
      await cardImportIdentity.remember(imported.path, archiveSha256)
      // The card's plugins come on with it, confined to this card; the card library can turn them off.
      const plugins = archive.plugins.length ? await cardPlugins.stage(zip, { cardKey: castAssets.keyOf(imported.path), plugins: archive.plugins }) : []
      let pluginError = ''
      const defaults = archive.defaults ? await storeStartDefaults(imported.path, archive.defaults) : null
      if (plugins.length) {
        try { await cardPlugins.enable({ cardKey: castAssets.keyOf(imported.path), cardPath: imported.path, plugins }) }
        catch (error) { pluginError = str(error?.message || error) }
        await castAssets.setPlugins(imported.path, plugins.map(plugin => ({ ...plugin, enabled: !pluginError })))
      }
      return { ...imported, format: archive.kind, ...(archive.info ? { info: archive.info } : {}),
        ...(packs.length ? { packs: packs.map(({ id, contentHash, title, format, files, reused }) => ({ id, contentHash, title, format, files, reused })) } : {}),
        ...(plugins.length ? { plugins: plugins.map(({ name, purpose, files, bytes }) => ({ name, purpose, files, bytes, enabled: !pluginError })) } : {}),
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
  // The asset library's pack becomes the card's own (本卡开启); the cast it came from is in the pack now.
  function bindLibraryPack(workspace, packId) {
    const data = rawData(workspace.raw), pointer = cardAssetExtensionPointer(workspace.raw)
    const { cast: _cast, ...own } = data.extensions?.dsh_tavern || {}
    const next = { ...own, schemaVersion: own.schemaVersion ?? 1, assetBindings: { boundPackIds: [...new Set([...(own.assetBindings?.boundPackIds || []), packId])] } }
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
    let material = collected, libraryPack = null, libraryNotices = []
    if (collected && toLibrary && typeof library?.importCardMaterial === 'function') {
      const name = cardPreparation.project(workspace).name || '人物卡', split = cardLibraryMaterial(collected, name)
      if (split.material) {
        const stored = await library.importCardMaterial({ name, material: split.material })
        libraryNotices = stored.notices
        material = split.rest
        if (stored.packId) { workspace = bindLibraryPack(workspace, stored.packId); libraryPack = { id: stored.packId, name, status: stored.status } }
      }
    }
    const cardPath = await fileResources.importCard(payload, workspace, importOptions)
    const card = cardPreparation.project(workspace)
    let assets = null
    if (material && (material.emotions.length || material.backgrounds.length || material.cover || material.extras.length || material.cast.length || material.skipped)) {
      try { assets = { ...await castAssets.importCardAssets({ cardPath, name: card.name || '主角', collected: material }), skipped: material.skipped } }
      catch (error) { assets = { error: str(error?.message || error) } }
    }
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags, ...(assets ? { assets } : {}),
      ...(libraryPack ? { libraryPack } : {}), ...(libraryNotices.length ? { libraryNotices } : {}) }
  }
  // A CHARX's character material: the card's own and, with the asset library, the figures and backgrounds of the packs
  // it binds (projectCardMaterial; a name both have is the library's).
  async function charxMaterial(cardPath, document) {
    const manifest = await castAssets.read(cardPath), files = new Map()
    for (const file of new Set([...manifest.characters.flatMap(character => [character.avatar, ...Object.values(character.sprites || {})]), ...(manifest.backgrounds || []).map(item => item.file), ...(manifest.extras || []).map(item => item.file)].filter(Boolean))) {
      files.set(file, await castAssets.readFile(cardPath, file))
    }
    const library = assetLibrary(), packIds = document?.data?.extensions?.dsh_tavern?.assetBindings?.boundPackIds || []
    if (!packIds.length || typeof library?.projectCardMaterial !== 'function') return { manifest, files }
    const projected = await library.projectCardMaterial({ packIds })
    const own = charxLibraryMaterial(projected, str(document?.data?.name), files.size)
    for (const file of new Set([...own.characters.flatMap(character => [character.avatar, ...Object.values(character.sprites), ...(character.voiceReferences || []).map(clip => clip.file)]), ...own.backgrounds.map(row => row.file)].filter(Boolean))) {
      files.set(file, await projected.read(file))
    }
    const names = new Set(own.characters.map(character => character.name))
    return { files, manifest: { ...manifest, characters: [...own.characters, ...manifest.characters.filter(character => !names.has(character.name))], backgrounds: [...own.backgrounds, ...(manifest.backgrounds || [])] } }
  }
  // The card as CHARX: Character Card V3 with its character material (Wiki「设计：tavern-to-galgame」).
  async function exportCardCharx(cardPath, document, { manifest, files }) {
    const image = await fileResources.readCardImage(cardPath).catch(() => undefined)
    const name = str(document?.data?.name || '人物卡')
    return { name, bytes: buildCharx({ document, cover: image ? stripPngTextChunks(image) : null, manifest, characterName: name, readFile: file => files.get(file) }) }
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
  // One export, format chosen by content: character material only travels in CHARX,
  // a cover makes the standard PNG card, and a bare card stays SillyTavern JSON. A CHARX with a cover goes
  // behind that PNG card (.charx.png): systems show the cover as its icon, other tavern apps read the PNG card,
  // and Tavern imports the whole CHARX.
  async function exportCardFile(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    const { document } = await presentCardText(cardPath)
    const material = await charxMaterial(cardPath, document), { manifest } = material
    const hasMaterial = manifest.characters.some(character => character.avatar || Object.values(character.sprites || {}).some(Boolean) || character.voiceReferences?.length)
      || (manifest.backgrounds || []).some(item => item.file) || (manifest.extras || []).some(item => item.file)
    if (hasMaterial) {
      const charx = await exportCardCharx(cardPath, document, material)
      if (!await fileResources.hasCardImage(cardPath)) return { ...charx, extension: 'charx', contentType: 'application/zip' }
      return { name: charx.name, bytes: Buffer.concat([(await exportCardPng(cardPath)).bytes, charx.bytes]), extension: 'charx.png', contentType: 'image/png' }
    }
    if (await fileResources.hasCardImage(cardPath)) return { ...await exportCardPng(cardPath), extension: 'png', contentType: 'image/png' }
    return { name: str(document?.data?.name || '人物卡'), bytes: Buffer.from(JSON.stringify(document, null, 2)), extension: 'json', contentType: 'application/json; charset=utf-8' }
  }

  return { importCard, importCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile }
}
