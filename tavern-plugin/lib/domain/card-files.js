import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StoredFile, writePackZip } from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import { exportDshCardSnapshot } from './dsh-card-export.js'
import { withoutPlayerChoices } from './card-export-settings.js'
import { readCardArchive } from './card-archive.js'
import { buildCharxContents, cardImport, cardImportFromCard, cardLibraryMaterial, pngCardTextChunk, pngWithTextChunks } from './card-assets.js'
import { cardAssetExtensionPointer, validateCardAssetExtension } from './card-asset-bindings.js'
import { rebaseCardEdits } from './card-update-merge.js'
import { rawData } from './card-preparation.js'
import { createCardImportIdentity } from './card-import-identity.js'
import { normalizeResourcePath } from './file-resources.js'
import { openCardZip } from './card-encryption.js'
import { MAX_SHARED_PRESET_BYTES } from './preset-reading.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}
// The releases kept per card (发布记录): an update package is made on top of one of the latest.
const MAX_RELEASES = 20
const archiveLabel = name => /\.dshcard$/i.test(name) ? 'DSH 人物卡' : 'CHARX'
const COVER_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
// An installed pack the card carries another version of: the player chooses 完全替换 (update) or, where the asset
// library offers it, 增量更新 (merge). A pack with scripts is never installed from a card (the asset library asks).
const packConflict = preview => preview.choices.includes('update') && !(preview.scriptRisk || []).length
// What applies a preview without asking: an identical pack is left as it is, a new one installed; a pack with scripts
// is never applied, and one that clashes with an installed version takes onConflict ('' leaves it to the player).
const previewDecision = (preview, onConflict) => preview.choices.includes('noop') ? 'noop'
  : (preview.scriptRisk || []).length ? ''
    : preview.choices.includes('install') ? 'install'
      : packConflict(preview) ? onConflict : ''


// Card files in and out of the card library. pluginApi is a getter: it is built after the library.
// backupPack(file, {packId, expectedRevision}) writes an installed pack, unchanged, to a private file (the asset
// library's assetLibraryPackBackup): an update keeps the versions it replaces so 撤回 can put them back.
// mediaStore: the shared store of pack files by content (media-store.js); an update package's left-out files come from it.
export function createCardFiles({ cardPreparation, fileResources, castAssets, assetPacks, cardPlugins, cardSummaries, presetLibrary, importPreset, readCardWorkspace, worldBooks, pluginApi, assetLibrary = () => null, prepareCardAssets, withCardBackup, backupPack, mediaStore, exportRoot = os.tmpdir(), syncBubbles = async () => {} }) {
  const cardImportIdentity = createCardImportIdentity({ cardPaths: () => fileResources.list('card'), castAssets, readCardText: cardPath => fileResources.readText(cardPath) })
  async function importCard(input, options = {}) {
    // A CHARX is stored as PNG or JSON; the material any card file carries goes to its character material.
    return await storeImportedCard(cardImport(input), options)
  }
  const packLibrary = () => { const library = assetLibrary(); return library && typeof library.inspectImportFile === 'function' ? library : null }
  async function inspectCardPack(library, zip, pack, archiveSha256) {
    const entries = []
    for (const entry of zip.entries.values()) {
      if (!entry.path.startsWith(pack.prefix) || entry.path.length === pack.prefix.length || entry.path.endsWith('/')) continue
      if (entry.size > 512 * 1024 ** 2) throw new Error('素材包文件超过 512 MiB：' + entry.path)
      entries.push({ path: entry.path.slice(pack.prefix.length), size: entry.size, stream: () => zip.stream(entry) })
    }
    if (typeof library.inspectImportEntries === 'function') {
      const uploadHash = createHash('sha256').update(archiveSha256 + '\0' + pack.prefix).digest('hex')
      return library.inspectImportEntries({ entries, uploadHash })
    }
    // Compatibility with an independently installed older asset library.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tavern-card-pack-'))
    try {
      const archive = path.join(dir, 'pack.zip')
      await writePackZip(archive, entries)
      return await library.inspectImportFile({ file: archive })
    } finally { await rm(dir, { recursive: true, force: true }) }
  }
  // An update package (dsh.json `base`) leaves out the pack files an earlier release already brought. Each pack's manifest
  // still lists every file by content, so the ones the archive lacks are read from the shared media store; the pack is
  // then checked file by file exactly like a complete one when it is read. A file found nowhere stops the import before
  // anything is written, saying which release it needs.
  async function completeUpdateArchive(zip, archive) {
    if (!archive.base) return zip
    const added = new Map(), missing = []
    for (const pack of archive.packs) {
      const entry = zip.entries.get(pack.prefix + 'manifest.json')
      if (!entry) throw new Error('更新包里的素材包「' + (pack.title || pack.id) + '」缺少 manifest.json，请向作者要完整包')
      let manifest
      try { manifest = JSON.parse((await zip.readBuffer(entry, 64 * 1024 ** 2)).toString('utf8')) }
      catch { throw new Error('更新包里的素材包「' + (pack.title || pack.id) + '」的 manifest.json 无法读取，请向作者要完整包') }
      let lacking = 0
      for (const file of Array.isArray(manifest?.files) ? manifest.files : []) {
        const name = pack.prefix + file?.path
        if (zip.entries.has(name) || added.has(name)) continue
        const found = mediaStore && await mediaStore.resolve({ sha256: file.sha256, size: file.size }).catch(() => undefined)
        if (found) added.set(name, { path: name, size: file.size, local: found.absolutePath })
        else lacking++
      }
      if (lacking) missing.push('「' + (pack.title || pack.id) + '」里的 ' + lacking + ' 个文件')
    }
    if (missing.length) {
      const base = archive.base.version ? ' ' + archive.base.version + ' ' : '上一版'
      throw Object.assign(new Error('这是相对' + base + '的更新包，你这里缺少它需要的素材：' + missing.join('、') + '。请先导入' + base + '的完整包，或向作者要完整包。这次什么都没有改。'), { code: 'TAVERN_CARD_UPDATE_BASE_MISSING' })
    }
    return Object.assign(Object.create(zip), {
      entries: new Map([...zip.entries, ...added]),
      stream: async entry => entry.local ? createReadStream(entry.local) : await zip.stream(entry),
      readBuffer: async (entry, limit) => entry.local ? await readFile(entry.local) : await zip.readBuffer(entry, limit),
      close: () => zip.close()
    })
  }
  const preparedPacks = new Map()
  const cancelPack = (library, preview) => library.applyImport({ inspectionId: preview.inspectionId, decision: 'cancel' }).catch(() => {})
  async function discardCardArchivePreview(file) {
    const stage = preparedPacks.get(file)
    if (!stage) return
    preparedPacks.delete(file)
    clearTimeout(stage.timer)
    await Promise.all(stage.ready.map(({ preview }) => cancelPack(stage.library, preview)))
  }
  const packFailure = (label, reason) => `素材包「${label}」未装入：${reason}`
  function packError(error) {
    if (error?.code === 'ENOSPC') return '磁盘空间不够，请腾出空间后重新导入'
    if (error?.code === 'REVISION_CONFLICT') return '素材包在导入期间变更，请重新导入'
    const file = error?.path?.startsWith('$.files.') ? `「${error.path.slice('$.files.'.length)}」` : ''
    const reason = error?.code === 'FILE_CLOSURE_MISMATCH' ? file + '文件缺失、多余或大小与清单不符'
      : error?.code === 'CONTENT_HASH_MISMATCH' && file ? file + '文件内容与清单不符' : str(error?.message || error)
    return reason + '。请重新获取卡包，或请作者检查素材包后重新导出'
  }
  async function inspectCardPacks(zip, packs, archiveSha256) {
    const library = packLibrary(), ready = [], notices = []
    for (const pack of packs) {
      const label = pack.title || pack.id
      if (!library) { notices.push(packFailure(label, '素材库不可用，请启用素材库后重新导入')); continue }
      try {
        const preview = await inspectCardPack(library, zip, pack, archiveSha256)
        if (previewDecision(preview, 'update')) ready.push({ pack, label, preview })
        else {
          await cancelPack(library, preview)
          notices.push(packFailure(label, (preview.scriptRisk || []).length ? '带脚本，请到素材库单独导入并确认脚本' : '与已有素材包冲突，请到素材库单独处理'))
        }
      } catch (error) { notices.push(packFailure(label, packError(error))) }
    }
    return { library, ready, notices }
  }
  async function installPacksInLibrary({ library, ready, notices }, { packDecisions = {}, packBackups } = {}) {
    for (const { pack, label, preview } of ready) {
      try {
        const decision = previewDecision(preview, packDecisions[pack.id] || 'update')
        const kept = packBackups && packConflict(preview) ? { packId: pack.id, title: label, file: pack.id + '.zip' } : null
        if (kept) {
          await mkdir(packBackups.dir, { recursive: true })
          await backupPack(path.join(packBackups.dir, kept.file), { packId: pack.id, expectedRevision: preview.expectedRevision })
          // listed before it is replaced: putting back a version that was never replaced leaves it as it is.
          packBackups.list.push(kept)
        }
        await library.applyImport({ inspectionId: preview.inspectionId, decision, expectedRevision: preview.expectedRevision })
      } catch (error) {
        await cancelPack(library, preview)
        notices.push(packFailure(label, packError(error)))
      }
    }
    return notices
  }
  async function previewCardArchiveFile(file, name, { password } = {}) {
    if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
    await discardCardArchivePreview(file)
    const hash = await cardImportIdentity.fileSha256(file)
    let zip = await openCardZip(file, { label: archiveLabel(name), password })
    try {
      const archive = await readCardArchive(zip, { assets: 'cover' })
      zip = await completeUpdateArchive(zip, archive)
      const data = archive.card.data || archive.card
      const icon = (Array.isArray(data.assets) ? data.assets : []).find(asset => asset?.type === 'icon' && asset.name === 'main')
      const coverType = icon && COVER_TYPES[str(icon.ext).toLowerCase()], coverBytes = coverType && archive.resolve(icon.uri)
      const stage = await inspectCardPacks(zip, archive.packs, hash)
      const packs = stage.ready.filter(({ preview }) => packConflict(preview)).map(({ pack, label, preview }) => ({ packId: pack.id, title: label, choices: preview.choices, removed: preview.removed || [] }))
      const timer = setTimeout(() => { void discardCardArchivePreview(file) }, 15 * 60000).unref()
      preparedPacks.set(file, { ...stage, hash, timer, authentication: zip.authentication })
      return { card: { name: str(data.name), version: str(data.character_version).trim(), ...(coverBytes ? { cover: 'data:' + coverType + ';base64,' + coverBytes.toString('base64') } : {}) }, packs,
        ...(archive.base ? { base: archive.base } : {}),
        ...(stage.notices.length ? { packNotices: stage.notices } : {}) }
    } finally { await zip.close() }
  }
  function cardLibraryResult(notices) {
    return notices.length ? { status: 'partial', libraryNotices: notices } : {}
  }

  // A pack ZIP (or 素材包合集) read from disk where it is, as the asset library's import does it (inspectImportFile: the media
  // stream to disk and a full disk undoes the whole pack). A new pack is installed and an identical one left as it is; a pack
  // with scripts, or that clashes with an installed version, is not applied: the player decides in the asset library.
  async function importPackArchiveFile(file) {
    const library = packLibrary()
    if (!library) throw new Error('素材库不可用，没法导入素材包')
    const installed = [], notices = []
    const preview = await library.inspectImportFile({ file }).catch(error => {
      // not a pack ZIP: a card ZIP, a plain ZIP or a damaged file (the same codes the asset library's own import page maps)
      if (!error?.code || ['INVALID_INPUT', 'INVALID_PATH', 'FILE_CLOSURE_MISMATCH'].includes(error.code)) throw new Error('这个文件不是素材包，或者已经损坏。卡 ZIP 请用「导入卡 ZIP」导入。')
      if (error?.code === 'ENOSPC') throw new Error('磁盘空间不够，没有导入这个素材包，也没有留下半个文件。腾出空间后再试一次。')
      throw error
    })
    // A pack collection is one preview per pack, applied one by one: a failure leaves the packs before it installed (said
    // below), and the ones after it are cancelled so their previews do not wait for the asset library to expire them.
    const previews = preview.kind === 'pack-set' ? preview.packs : [preview]
    for (const [index, one] of previews.entries()) {
      try { await applyPackPreview(library, one, installed, notices) }
      catch (error) {
        for (const rest of previews.slice(index)) await library.applyImport({ inspectionId: rest.inspectionId, decision: 'cancel' }).catch(() => {})
        const reason = error?.code === 'ENOSPC' ? '磁盘空间不够，腾出空间后再试一次' : str(error?.message || error)
        throw new Error('素材包「' + (one.incoming?.manifest?.name || one.packId) + '」没有装入：' + reason + '（没有留下半个包）'
          + (installed.length ? '。已装入：' + installed.map(pack => '「' + pack.title + '」').join('、') : '') + (previews.length > index + 1 ? '。其余 ' + (previews.length - index - 1) + ' 个包没有处理' : ''))
      }
    }
    return { packs: installed, ...(notices.length ? { notices } : {}) }
  }
  async function applyPackPreview(library, one, installed, notices) {
    const label = one.incoming?.manifest?.name || one.packId
    const decision = previewDecision(one, '')
    if (!decision) {
      await library.applyImport({ inspectionId: one.inspectionId, decision: 'cancel' }).catch(() => {})
      notices.push('素材包「' + label + '」' + ((one.scriptRisk || []).length ? '带脚本' : '和素材库里已有的包冲突') + '，没有装入，请在素材库里处理')
      return
    }
    await library.applyImport({ inspectionId: one.inspectionId, decision, expectedRevision: one.expectedRevision })
    installed.push({ id: one.packId, title: label, status: decision === 'noop' ? 'existing' : 'installed' })
  }
  // Bound packs a .dshcard does not carry: the binding stays and works once the pack is in the asset library.
  async function dependencyNotices(dependencies) {
    const library = assetLibrary(), notices = []
    for (const dependency of dependencies) {
      const installed = library && await library.getPackSnapshot({ packId: dependency.id, readOnly: true })
      const label = '「' + (dependency.title || dependency.id) + '」'
      if (!installed) notices.push('这张卡还需要素材包' + label + '：请先导入该包（素材库 → 导入），装好后绑定自动生效')
      else if (dependency.contentHash && installed.manifest?.contentHash !== dependency.contentHash) notices.push('素材库里的素材包' + label + '和作者导出这张卡时用的不是同一版，有些素材可能对不上；需要时向作者要这个包的新版')
    }
    return notices
  }
  async function importCardArchiveFile(file, name, { password, replacePath, pluginChoices, packDecisions, packBackups, keepEdits, acceptMissingPacks, previewed } = {}) {
    if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
    const label = archiveLabel(name)
    // The very same file again: open the card already imported from it (if still unchanged), and make sure
    // its packs are in the asset library (cards imported before the library came carry none there).
    const archiveSha256 = await cardImportIdentity.fileSha256(file)
    const existing = await cardImportIdentity.find(archiveSha256)
    const preview = preparedPacks.get(file)
    let zip = await openCardZip(file, { label, password, authentication: preview?.hash === archiveSha256 ? preview.authentication : undefined })
    try {
      const archive = await readCardArchive(zip)
      zip = await completeUpdateArchive(zip, archive)
      const stage = preparedPacks.get(file)
      if (previewed && !stage) throw new Error('卡包预览已过期，请重新选择文件')
      if (stage && stage.hash !== archiveSha256) {
        await discardCardArchivePreview(file)
        throw new Error('卡包在预览后变更，请重新选择文件')
      }
      if (stage?.notices.length && !acceptMissingPacks) throw new Error(stage.notices.join('；'))
      const duplicate = existing && !replacePath
      // Validate the card before publishing any of its packs.
      const prepared = duplicate ? null : prepareImportedCard(cardImportFromCard({ card: archive.card, resolve: archive.resolve, name }), keepEdits)
      if (stage) { preparedPacks.delete(file); clearTimeout(stage.timer) }
      const staged = stage || await inspectCardPacks(zip, archive.packs, archiveSha256)
      const libraryNotices = [...await installPacksInLibrary(staged, { packDecisions, packBackups }), ...await dependencyNotices(archive.dependencies)]
      if (duplicate) return { path: existing, name: (await cardSummaries.read(existing).catch(() => null))?.name || existing.split('/').pop(), duplicate: true, ...cardLibraryResult(libraryNotices) }
      const packs = []
      const sourceMedia = new Map(staged.ready.map(({ pack, preview }) => [pack.prefix, preview.sourceMedia]))
      for (const pack of archive.packs) {
        const { pack: stored, reused } = await assetPacks.importFromZip(zip, { ...pack, sourceMedia: sourceMedia.get(pack.prefix) })
        packs.push({ id: stored.id, contentHash: stored.contentHash, format: stored.format, title: stored.title, name: pack.prefix.split('/')[1], files: Object.keys(stored.files).length, reused })
      }
      const imported = await storePreparedCard(prepared, { unique: true, library: !archive.packs.length, replacePath })
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
        ...cardLibraryResult(libraryNotices),
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
  // options.keepEdits {base, local}: an update carries the player's changes onto the new file (rebaseCardEdits); the
  // file itself is still stored as the card's original, so the next update compares against it.
  function prepareImportedCard({ payload, collected }, keepEdits) {
    let workspace = cardPreparation.create({ kind: 'import', payload })
    if (keepEdits) workspace = cardPreparation.create({ kind: 'import', payload: { kind: 'text', name: 'card.json', text: JSON.stringify(rebaseCardEdits({ ...keepEdits, incoming: workspace.raw })) } })
    return { payload, collected, workspace }
  }
  async function storeImportedCard(input, { keepEdits, ...options } = {}) {
    return await storePreparedCard(prepareImportedCard(input, keepEdits), options)
  }
  async function storePreparedCard({ payload, collected, workspace }, { library: toLibrary = true, ...importOptions } = {}) {
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
      catch (error) { if (importOptions.replacePath) throw error; assets = { error: str(error?.message || error) } }
    }
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags, ...(assets ? { assets } : {}),
      ...(libraryPack ? { libraryPack } : {}), ...(libraryNotices.length ? { libraryNotices } : {}) }
  }
  async function exportWorkspace(cardPath) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw Object.assign(new Error('人物卡不存在: ' + cardPath), { code: 'TAVERN_NOT_FOUND' })
    return workspace
  }
  // One list for the export sheet and every DSH card writer. A catalogue failure must not turn into an unticked pack.
  function cardExportPacks(workspace, material) {
    const ext = rawData(workspace.raw).extensions?.dsh_tavern
    const boundIds = ext?.assetBindings?.boundPackIds || [], required = ext?.modConfigPackId
    const carried = new Map((material.packs || []).map(ref => [ref.id, ref]))
    const packs = [...new Set([...boundIds, ...carried.keys(), ...(required ? [required] : [])])].map(id => ({
      id, title: carried.get(id)?.title || '', required: id === required
    }))
    return { packs, boundIds, required, carried }
  }
  async function listCardExportPacks(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    return cardExportPacks(await exportWorkspace(cardPath), await castAssets.read(cardPath)).packs
  }
  // 发布记录: what each DSH card export of a card held, kept on this machine only (never in an archive), so a later
  // export can be an update package on top of it. A release is {id, version, exportedAt, compressed, size, source
  // ('export' | 'file'), packs: [{id, title, contentHash, files: [sha256]}], converted: {source sha256: compressed media}}.
  const releasesFile = cardPath => path.join(path.dirname(exportRoot), 'card-releases', castAssets.keyOf(cardPath) + '.json')
  async function readReleases(cardPath) {
    const text = await readFile(releasesFile(cardPath), 'utf8').catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
    return text === null ? [] : JSON.parse(text).releases
  }
  async function addRelease(cardPath, release) {
    const file = releasesFile(cardPath), temporary = file + '.' + randomUUID() + '.tmp'
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(temporary, JSON.stringify({ releases: [...await readReleases(cardPath), release].slice(-MAX_RELEASES) }))
    await rename(temporary, file)
    return release
  }
  const releaseView = ({ id, version, exportedAt, compressed, size, source }) => ({ id, version, exportedAt, compressed, size, source })
  // The export sheet's 更新包 choices: the card's current version and its releases, newest first.
  async function listCardReleases(input) {
    const cardPath = normalizeResourcePath(input, 'card')
    const workspace = await exportWorkspace(cardPath)
    return { version: str(rawData(workspace.raw).character_version).trim(), releases: (await readReleases(cardPath)).reverse().map(releaseView) }
  }
  // A release sent before releases were recorded: read (not imported) from the archive that was sent, its packs' file lists.
  async function addCardReleaseFromFile(input, file, name, { password } = {}) {
    const cardPath = normalizeResourcePath(input, 'card')
    await exportWorkspace(cardPath)
    if (!/\.dshcard$/i.test(str(name))) throw Object.assign(new Error('请选择以前导出的 .dshcard 文件'), { code: 'TAVERN_EXPORT_INVALID' })
    const zip = await openCardZip(file, { label: 'DSH 人物卡', password })
    try {
      const archive = await readCardArchive(zip, { assets: 'none' })
      if (!archive.packs.length) throw Object.assign(new Error('这个文件没有带素材包，不用作更新包的基础'), { code: 'TAVERN_EXPORT_INVALID' })
      const packs = []
      for (const pack of archive.packs) {
        const entry = zip.entries.get(pack.prefix + 'manifest.json')
        const manifest = entry ? JSON.parse((await zip.readBuffer(entry, 64 * 1024 ** 2)).toString('utf8')) : null
        if (!Array.isArray(manifest?.files)) throw Object.assign(new Error('素材包「' + (pack.title || pack.id) + '」没有文件清单，不能用作基础'), { code: 'TAVERN_EXPORT_INVALID' })
        packs.push({ id: pack.id, title: pack.title, contentHash: pack.contentHash || null, files: manifest.files.map(row => str(row?.sha256)) })
      }
      return releaseView(await addRelease(cardPath, { id: randomUUID(), version: archive.info?.version || '', exportedAt: Date.now(), compressed: null, size: zip.size ?? null, source: 'file', packs, converted: {} }))
    } finally { await zip.close() }
  }
  // About how many bytes an update package on top of `releaseId` carries for these packs: the files the release did not
  // have, at their installed size (压缩素材 makes media smaller still); the card itself (a few MB at most) comes on top.
  async function estimateCardUpdate(input, releaseId, packIds) {
    const cardPath = normalizeResourcePath(input, 'card')
    const base = (await readReleases(cardPath)).find(release => release.id === releaseId)
    if (!base) throw Object.assign(new Error('找不到作为基础的版本，请重新打开导出窗口'), { code: 'TAVERN_EXPORT_INVALID' })
    const had = new Set(base.packs.flatMap(pack => pack.files)), library = assetLibrary()
    let bytes = 0, files = 0
    for (const packId of Array.isArray(packIds) ? packIds : []) {
      const pack = library && await library.getPackSnapshot({ packId, readOnly: true })
      for (const file of pack?.manifest.files || []) {
        const sent = had.has(file.sha256) || had.has(base.converted?.[file.sha256]?.sha256)
        if (!sent || /^figures\/[^/]+\.json$/.test(file.path)) { bytes += file.size; files++ }
      }
    }
    return { bytes, files }
  }
  // `books` (an export's 世界书 ticks): the bound books the card carries; by default all of them.
  async function presentCardText(cardPath, books, workspace = undefined) {
    workspace ??= await exportWorkspace(cardPath)
    if (books !== undefined && (!Array.isArray(books) || books.some(book => !book || typeof book !== 'object'))) throw Object.assign(new Error('世界书选择无效'), { code: 'TAVERN_EXPORT_INVALID' })
    const document = withoutPlayerChoices(cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook: await worldBooks.characterBookForCard(cardPath, books) }))
    return { document, text: JSON.stringify(document) }
  }
  // A standard card PNG: the cover's pixels carrying the current working card, as `chara`
  // (what older tools read) and `ccv3` (what SillyTavern reads first).
  async function exportCardPng(input, books) {
    const cardPath = normalizeResourcePath(input, 'card')
    const { document, text } = await presentCardText(cardPath, books)
    const image = await fileResources.readCardImage(cardPath).catch(() => undefined)
    if (!image) throw Object.assign(new Error('人物卡还没有封面，请先用 tavern_set_card_cover 配封面'), { code: 'TAVERN_NOT_FOUND' })
    const name = str(document?.data?.name || '人物卡')
    return { name, bytes: pngWithTextChunks(image, [pngCardTextChunk('chara', text), pngCardTextChunk('ccv3', text)]) }
  }
  // The card as a DSH card (.dshcard, Wiki「设计：dsh-card-format」): card.json and dsh.json, the cover, the card's own
  // material, its plugins and start defaults, and the packs that go with it under assets/<pack id>/ — by default every pack
  // the card binds (and the packs it came with); `packIds` chooses, or `omitPackIds` unchecks packs in the sheet.
  // A pack omitted by the sheet loses its binding; an explicit packIds selection retains dependencies unless scoped.
  // `excludeFigures` leaves out figures and the media only they use.
  // Packs can be large, so the archive is written to a spool file under exportRoot and streamed; `onProgress` hears it
  // being written (dsh-card-export.js writeDshCard). `books` chooses the bound world books, in every format.
  // `compress` (.dshcard only): 压缩素材 — the packs go out with smaller media (dsh-card-export.js); the result's `compressed`
  // says the packs' bytes before and after.
  // `baseRelease` (.dshcard only): the id of an earlier release (listCardReleases): an update package on top of it, without
  // the pack files that release already brought; the result's `update` says {base: its version, omitted: files left out}.
  async function exportCardFile(input, { format = 'dshcard', packIds, omitPackIds, dependencyPackIds, excludeFigures = [], preserveBindings = false, books, compress = false, baseRelease, onProgress } = {}) {
    if (typeof compress !== 'boolean' || compress && format !== 'dshcard') throw Object.assign(new Error('压缩素材只用于导出 .dshcard'), { code: 'TAVERN_EXPORT_INVALID' })
    if (baseRelease !== undefined && (format !== 'dshcard' || typeof baseRelease !== 'string')) throw Object.assign(new Error('更新包只用于导出 .dshcard'), { code: 'TAVERN_EXPORT_INVALID' })
    if (format === 'dshcard') return writeCardFile(input, { packIds, omitPackIds, dependencyPackIds, excludeFigures, preserveBindings, books, compress, baseRelease, onProgress })
    if (format !== 'json' && format !== 'png') throw Object.assign(new Error('不支持的人物卡导出格式'), { code: 'TAVERN_EXPORT_INVALID' })
    if (packIds !== undefined || omitPackIds !== undefined || dependencyPackIds !== undefined || !Array.isArray(excludeFigures) || excludeFigures.length) throw Object.assign(new Error('素材包与人物选择仅用于导出 .dshcard'), { code: 'TAVERN_EXPORT_INVALID' })

    if (format === 'png') return { ...await exportCardPng(input, books), extension: format, contentType: 'image/png' }
    const { document, text } = await presentCardText(normalizeResourcePath(input, 'card'), books)
    return { name: str(document.data.name) || '人物卡', extension: format, contentType: 'application/json; charset=utf-8', bytes: Buffer.from(text) }
  }
  async function writeCardFile(input, { excludeFigures = [], packIds, omitPackIds, dependencyPackIds, preserveBindings = false, books, compress = false, baseRelease, onProgress } = {}, backup = false) {
    if (!Array.isArray(excludeFigures) || excludeFigures.some(id => typeof id !== 'string') || packIds !== undefined && omitPackIds !== undefined
      || [packIds, omitPackIds, dependencyPackIds].some(ids => ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')))) throw Object.assign(new Error('导出参数无效'), { code: 'TAVERN_EXPORT_INVALID' })
    let cardPath
    try { cardPath = normalizeResourcePath(input, 'card') }
    catch (error) { throw Object.assign(error, { code: 'TAVERN_EXPORT_INVALID' }) }
    const workspace = await exportWorkspace(cardPath)
    let update
    if (baseRelease !== undefined) {
      const base = (await readReleases(cardPath)).find(release => release.id === baseRelease)
      if (!base) throw Object.assign(new Error('找不到作为基础的版本，请重新打开导出窗口'), { code: 'TAVERN_EXPORT_INVALID' })
      update = { version: base.version, files: new Set(base.packs.flatMap(pack => pack.files)), converted: base.converted || {} }
    }
    const { document } = await presentCardText(cardPath, books, workspace)
    const material = await castAssets.read(cardPath)
    const { packs: candidates, boundIds, required, carried } = cardExportPacks(workspace, material)
    if ([...(packIds || []), ...(omitPackIds || [])].some(id => !candidates.some(pack => pack.id === id))) throw Object.assign(new Error('素材包选择已失效，请重新打开导出窗口'), { code: 'TAVERN_EXPORT_INVALID' })
    const chosen = backup ? [] : candidates.filter(({ id }) => (id === required && !preserveBindings) || (packIds ? packIds.includes(id) : !omitPackIds?.includes(id))).map(pack => pack.id)
    // The packs the card was imported with (card-assets packs) come from their store; the bound library packs from the library.
    const importedPacks = []
    for (const id of chosen.filter(id => carried.has(id))) {
      const ref = carried.get(id)
      const stored = await assetPacks.readPack(ref.id, ref.contentHash)
      if (!stored) throw Object.assign(new Error('找不到随卡素材包「' + (ref.title || id) + '」，请重新导入原卡后再试'), { code: 'TAVERN_EXPORT_MISSING_PACK' })
      const files = new Map()
      for (const [name, row] of Object.entries(stored.files)) files.set(name, new StoredFile(row.size, (await assetPacks.file(ref.id, ref.contentHash, name)).path))
      const member = files.get('manifest.json')
      const manifest = member ? JSON.parse(await readFile(member.file, 'utf8')) : { id: ref.id, format: ref.format, contentHash: ref.contentHash, name: ref.title }
      files.delete('manifest.json')
      importedPacks.push({ manifest, files, sourceName: ref.name })
    }
    const pluginFiles = await cardPlugins.exportEntries({ cardKey: castAssets.keyOf(cardPath), plugins: material.plugins || [] })
    // defaults.stage comes from the card's own stage declaration (dsh-card-export.js).
    const defaults = {}, entries = [...pluginFiles.entries]
    if (material.startDefaults?.settings) {
      const settings = material.startDefaults.settings
      defaults.settings = { statusBarPlacement: settings.statusBarPlacement, backgroundTasks: settings.backgroundTasks, webSearch: settings.webSearchEnabled }
    }
    if (material.startDefaults?.presetPath) {
      defaults.preset = { path: 'presets/default.json', title: material.startDefaults.presetPath.split('/').pop().replace(/\.json$/i, '') }
      const preset = Buffer.from(await fileResources.readText(material.startDefaults.presetPath))
      if (preset.length > MAX_SHARED_PRESET_BYTES) throw new Error('卡包内的默认预设超过 ' + MAX_SHARED_PRESET_BYTES / 1024 ** 2 + ' MiB')
      entries.push({ path: defaults.preset.path, data: preset })
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
        else if (books !== undefined) delete data.character_book
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
        return exportDshCardSnapshot({ file, card: raw, packs, dependencies: snapshot?.dependencies, cover, excludeFigures, onProgress, update, ...(compress ? { compress: { directory: path.join(directory, 'compressed') } } : {}), entries: extraEntries, plugins: pluginFiles.plugins, defaults: Object.keys(defaults).length ? defaults : undefined })
      }
      const imported = importedPacks.map(pack => pack.manifest.id)
      const ids = chosen.filter(id => !carried.has(id))
      // Only bound library packs need the card adapter supplied by the optional stage runtime.
      const library = backup || boundIds.length || ids.length ? assetLibrary() : undefined
      if (!backup && (ids.length || boundIds.some(id => !carried.has(id))) && !library) throw Object.assign(new Error('素材库尚未就绪，暂时无法导出素材包'), { code: 'TAVERN_EXPORT_UNAVAILABLE' })
      if (library) await prepareCardAssets?.()
      // Replacement owns the card, not its installed packs: retain references without copying media.
      const selection = backup
        ? { path: cardPath, packIds: [], keepPackIds: candidates.map(pack => pack.id) }
        : { path: cardPath, packIds: ids, keepPackIds: preserveBindings && required ? [...imported, required] : imported,
          ...(!preserveBindings && (omitPackIds || dependencyPackIds) ? { dependencyPackIds: dependencyPackIds || [] } : {}) }
      const result = library ? await (backup
        ? withCardBackup(file, selection, write)
        : library.withCardExport(selection, write)) : await write()
      if (!backup && result.release.packs.length) await addRelease(cardPath, { id: randomUUID(), version: str(result.card.data.character_version).trim(), exportedAt: Date.now(), compressed: compress, size: result.size, source: 'export', packs: result.release.packs, converted: result.release.converted })
      return { name: result.card.data.name || '人物卡', extension: 'dshcard', contentType: 'application/zip', file, size: result.size, ...(result.compressed ? { compressed: result.compressed } : {}),
        ...(update ? { update: { base: update.version, omitted: result.omitted } } : {}),
        stream: () => createReadStream(file), dispose: () => rm(directory, { recursive: true, force: true }) }
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  }
  // Card updates run one at a time. Each keeps its own folder under recovery/card-updates:
  // card.dshcard (the card before, without media), packs/<id>.zip (installed pack versions it replaced) and update.json
  // (what else 撤回 restores). Only the latest update can be taken back: a new one drops the packs and update.json of the
  // earlier ones and leaves their card backups. update.json is written with `state: 'running'` before anything changes;
  // one still running when the program stopped mid-update (killed, power lost) is put back as it was before
  // (recoverCardUpdates, at start and before the next update or 撤回).
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
      const decision = preview.choices.includes('noop') ? 'noop' : 'update'
      await library.applyImport({ inspectionId: preview.inspectionId, decision, expectedRevision: preview.expectedRevision, acceptScriptRisk: true, ...(decision === 'update' ? { restore: true } : {}) })
    }
    const target = record.cardPath, current = await castAssets.read(target)
    await cardPlugins.disable({ cardPath: target, plugins: current.plugins || [] })
    await importCardArchiveFile(path.join(dir, 'card.dshcard'), 'backup.dshcard', { replacePath: target, pluginChoices: new Map(record.pluginChoices) })
    if (record.original) await fileResources.importCard(record.original, record.workspace, { replacePath: target })
    else await fileResources.writeWorking(target, JSON.stringify(record.workspace, null, 2))
    await castAssets.replaceManifest(target, record.material)
  }
  // Every pack the interrupted update may have replaced has its backup in packs/ (taken before it was replaced).
  async function recoverPending() {
    const root = updatesRoot(), restored = []
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name), text = await readFile(path.join(dir, 'update.json'), 'utf8').catch(() => null)
      const record = text === null ? null : JSON.parse(text)
      if (record?.state !== 'running') continue
      record.packs = (await readdir(path.join(dir, 'packs')).catch(() => [])).filter(file => file.endsWith('.zip')).map(file => ({ packId: file.slice(0, -4), title: '', file }))
      if (record.packs.length) await prepareCardAssets?.()
      await restoreUpdate(record, dir)
      await rm(path.join(dir, 'update.json'), { force: true })
      await rm(path.join(dir, 'packs'), { recursive: true, force: true })
      restored.push(record.cardPath)
    }
    return restored
  }
  // The cards whose interrupted update was undone.
  const recoverCardUpdates = () => serialized(recoverPending)
  // input: {file, name, password, packDecisions} (an archive) or {payload}.
  function replaceCard(cardPath, input) {
    return serialized(async () => {
      await recoverPending()
      const target = normalizeResourcePath(cardPath, 'card')
      const workspace = await readCardWorkspace(target)
      if (!workspace) throw new Error('要更新的人物卡不存在')
      // Validate and authenticate before disabling anything or taking a backup.
      if (input.file) {
        const zip = await openCardZip(input.file, { label: '人物卡更新', password: input.password })
        try { await completeUpdateArchive(zip, await readCardArchive(zip, { assets: 'none' })) } finally { await zip.close() }
      } else cardPreparation.create({ kind: 'import', payload: cardImport(input.payload).payload })
      const material = await castAssets.read(target)
      const plugins = material.plugins || []
      const choices = new Map(plugins.map(p => [p.name, p.enabled !== false]))
      const record = { cardPath: target, original: await fileResources.originalCardPayload(target), workspace, material, pluginChoices: [...choices], packs: [] }
      // The card as the file it came from had it, and as it is now: what the player changed stays (rebaseCardEdits).
      const keepEdits = { base: record.original ? cardPreparation.create({ kind: 'import', payload: record.original }).raw : undefined, local: workspace.raw }
      const root = updatesRoot(), updateId = path.basename(target, '.json') + '-' + Date.now() + '-' + randomUUID().slice(0, 8), dir = path.join(root, updateId)
      for (const earlier of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!earlier.isDirectory()) continue
        await rm(path.join(root, earlier.name, 'update.json'), { force: true })
        await rm(path.join(root, earlier.name, 'packs'), { recursive: true, force: true })
      }
      await mkdir(dir, { recursive: true })
      const backupPath = path.join(dir, 'card.dshcard'), backup = await writeCardFile(target, {}, true)
      try { await copyFile(backup.file, backupPath) } finally { await backup.dispose() }
      await writeFile(path.join(dir, 'update.json'), JSON.stringify({ ...record, state: 'running' }))
      try {
        await cardPlugins.disable({ cardPath: target, plugins })
        await castAssets.replaceManifest(target, null)
        const card = input.file
          ? await importCardArchiveFile(input.file, input.name, { password: input.password, replacePath: target, pluginChoices: choices, packDecisions: input.packDecisions, acceptMissingPacks: input.acceptMissingPacks, previewed: input.previewed, packBackups: { dir: path.join(dir, 'packs'), list: record.packs }, keepEdits })
          : await importCard(input.payload, { replacePath: target, keepEdits })
        // The card's own bubble settings maintain an entry of its world book (the archive import syncs it too).
        if (!input.file) await syncBubbles(target)
        await writeFile(path.join(dir, 'update.json'), JSON.stringify(record))
        return { ...card, updated: true, backupPath, updateId }
      } catch (error) {
        try { await restoreUpdate(record, dir) }
        catch (restoreError) {
          throw new Error('更新失败且自动恢复未完成，下次启动时会再恢复一次。备份：' + dir + '；' + restoreError.message, { cause: error })
        }
        await rm(path.join(dir, 'update.json'), { force: true })
        throw new Error('更新失败，已恢复原卡：' + error.message, { cause: error })
      }
    })
  }
  // 撤回: the card and the packs of the latest update back as they were before it.
  function revertCardUpdate(updateId) {
    return serialized(async () => {
      await recoverPending()
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
  return { discardCardArchivePreview, replaceCard, revertCardUpdate, recoverCardUpdates, importCard, importCardArchiveFile, importPackArchiveFile, previewCardArchiveFile, importPluginCardFile, presentCardText, exportCardPng, exportCardFile, listCardExportPacks, listCardReleases, addCardReleaseFromFile, estimateCardUpdate }
}
