import { readFile } from 'node:fs/promises'
import { readCardArchive } from './card-archive.js'
import { buildCharx, cardImport, cardImportFromCard, pngCardTextChunk, pngWithTextChunks } from './card-assets.js'
import { createCardImportIdentity } from './card-import-identity.js'
import { normalizeResourcePath, stripPngTextChunks } from './file-resources.js'
import { openZipFile } from './zip-file.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Card files in and out of the card library. pluginApi is a getter: it is built after the library.
export function createCardFiles({ cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset, readCardWorkspace, worldBooks, pluginApi }) {
  const cardImportIdentity = createCardImportIdentity({ cardPaths: () => fileResources.list('card'), castAssets, readCardText: cardPath => fileResources.readText(cardPath) })
  async function importCard(input) {
    // A CHARX is stored as PNG or JSON; the material any card file carries goes to its character material.
    return await storeImportedCard(cardImport(input))
  }
  // A CHARX, DSH card or card bundle read from disk: its packs first, so a failure leaves no card behind.
  async function importCardArchiveFile(file, name) {
    const label = /\.dshcard$/i.test(name) ? 'DSH 人物卡' : 'CHARX'
    // The very same file again: open the card already imported from it (if still unchanged).
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    if (existing) return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true }
    const zip = await openZipFile(file, { label })
    try {
      const archive = await readCardArchive(zip)
      const packs = []
      for (const pack of archive.packs) {
        const { pack: stored, reused } = await assetPacks.importFromZip(zip, pack)
        packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: pack.prefix.split('/')[1], files: Object.keys(stored.files).length, reused })
      }
      const imported = await storeImportedCard(cardImportFromCard({ card: archive.card, resolve: archive.resolve, name }), { unique: true })
      if (packs.length) await castAssets.bindPacks(imported.path, packs)
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
    const imported = await storeImportedCard(cardImportFromCard({ card: converted.card, resolve, name: str(name).replace(/\.[^.]+$/, '') }), { unique: true })
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
    if (defaults.stage) await castAssets.setStage(cardPath, true)
    return stored
  }
  async function storeImportedCard({ payload, collected }, options = {}) {
    const workspace = cardPreparation.create({ kind: 'import', payload: payload })
    const cardPath = await fileResources.importCard(payload, workspace, options)
    const card = cardPreparation.project(workspace)
    let assets = null
    if (collected && (collected.emotions.length || collected.backgrounds.length || collected.cover || collected.extras.length || collected.cast.length || collected.skipped)) {
      try { assets = { ...await castAssets.importCardAssets({ cardPath, name: card.name || '主角', collected }), skipped: collected.skipped } }
      catch (error) { assets = { error: str(error?.message || error) } }
    }
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags, ...(assets ? { assets } : {}) }
  }
  // The card as CHARX: Character Card V3 with its character material (Wiki「设计：tavern-to-galgame」).
  async function exportCardCharx(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw Object.assign(new Error('人物卡不存在: ' + cardPath), { code: 'TAVERN_NOT_FOUND' })
    const document = cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook: await worldBooks.characterBookForCard(cardPath) })
    const image = await fileResources.readCardImage(cardPath).catch(() => undefined)
    const manifest = await castAssets.read(cardPath)
    const files = new Map()
    for (const file of new Set([...manifest.characters.flatMap(character => [character.avatar, ...Object.values(character.sprites || {})]), ...(manifest.backgrounds || []).map(item => item.file), ...(manifest.extras || []).map(item => item.file)].filter(Boolean))) {
      files.set(file, await castAssets.readFile(cardPath, file))
    }
    const name = str(document?.data?.name || cardPreparation.project(workspace).name || '人物卡')
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
  // a cover makes the standard PNG card, and a bare card stays SillyTavern JSON.
  async function exportCardFile(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    const manifest = await castAssets.read(cardPath)
    const hasMaterial = manifest.characters.some(character => character.avatar || Object.values(character.sprites || {}).some(Boolean))
      || (manifest.backgrounds || []).some(item => item.file) || (manifest.extras || []).some(item => item.file)
    if (hasMaterial) return { ...await exportCardCharx(cardPath), extension: 'charx', contentType: 'application/zip' }
    if (await fileResources.hasCardImage(cardPath)) return { ...await exportCardPng(cardPath), extension: 'png', contentType: 'image/png' }
    const { document } = await presentCardText(cardPath)
    return { name: str(document?.data?.name || '人物卡'), bytes: Buffer.from(JSON.stringify(document, null, 2)), extension: 'json', contentType: 'application/json; charset=utf-8' }
  }

  return { importCard, importCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile }
}
