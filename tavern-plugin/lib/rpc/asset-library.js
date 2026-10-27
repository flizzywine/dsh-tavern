import { readFile } from 'node:fs/promises'
import { enforceTriggers } from '../asset-library/asset-packs/trigger-lint.js'
import { BUILTIN_STAGE_SKINS } from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { validateStageSkinSelection } from '../domain/stage-skin-choice.js'

// The asset library's editor: 舞台素材 (every pack) and 舞台设置 › 素材包 (this card's packs).
// The store (asset-library/pack-v2) checks every write; these handlers only shape the requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createAssetLibraryHandlers(deps) {
  const { assetLibrary, cardSummaries, castAssets, fileResources, readTavernSettings, stageMaterial, stageMaterialChanged, stageSkinOf, str, updateTavernSettings, uploads } = deps
  const coded = (message, code) => Object.assign(new Error(message), { code })
  const packOf = async packId => {
    const pack = await assetLibrary.getPackSnapshot({ packId: str(packId) })
    if (!pack) throw coded('Pack missing', 'ASSET_UNAVAILABLE')
    return pack
  }
  // Uploaded files (the raw-body upload route) are read once and removed.
  async function takeFiles(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw coded('一次最多添加 100 个文件', 'INVALID_INPUT')
    const files = []
    for (const row of rows) {
      const upload = await uploads.take(row && row.uploadId)
      try { files.push({ name: str(row.name), bytes: await readFile(upload.file) }) } finally { await upload.remove() }
    }
    return files
  }
  // A card from before the library moves its material first (stage-material.js), so a binding never pre-empts that move.
  const boundOf = async path => {
    await stageMaterial.ready(path, (await cardSummaries.read(path).catch(() => null))?.name)
    const ids = (await castAssets.read(path)).boundPackIds
    return Array.isArray(ids) ? ids : []
  }
  // The skins a picker offers: the built-ins, then each listed pack's skins in pack order ({ value, label, document }).
  async function skinChoices(packIds) {
    const choices = Object.values(BUILTIN_STAGE_SKINS).map(document => ({ value: document.id, label: document.label, document }))
    for (const packId of packIds) {
      const pack = await assetLibrary.getPackSnapshot({ packId }).catch(() => null)
      for (const asset of pack?.manifest.assets || []) if (asset.kind === 'skins' && pack.skins?.[asset.id]) {
        choices.push({ value: { packId, kind: 'skins', assetId: asset.id }, label: asset.name, pack: pack.manifest.name, document: pack.skins[asset.id] })
      }
    }
    return choices
  }
  // A chosen skin is checked when it is chosen: a built-in, or a skin its pack holds now.
  async function chosenSkin(value) {
    try { validateStageSkinSelection(value) } catch { throw coded('Unknown skin', 'INVALID_INPUT') }
    if (typeof value === 'object' && !(await packOf(value.packId)).manifest.assets.some(asset => asset.kind === 'skins' && asset.id === value.assetId)) throw coded('Skin missing', 'ASSET_UNAVAILABLE')
    return value
  }
  async function unbind(path, packId) {
    const ids = await boundOf(path)
    if (ids.includes(packId)) await castAssets.setBoundPackIds(path, ids.filter(id => id !== packId))
  }
  return {
    async listAssetPacks() {
      return { packs: await assetLibrary.listPacks() }
    },
    async getAssetPack(args) {
      return { pack: await packOf(args && args.packId) }
    },
    async createAssetPack(args) {
      const name = str(args && args.name).trim()
      if (!name) throw coded('素材包名称不能为空', 'INVALID_INPUT')
      return { pack: (await assetLibrary.createPack({ name, expectedRevision: null })).snapshot }
    },
    // Author fields of the pack's entries (name, lamp, trigger words, notes, volume); media stays as stored.
    // Trigger words a player writes here are checked (trigger-lint.js) against the revision the edit starts from;
    // the store's compare-and-swap then refuses the edit if that revision is no longer current.
    async updateAssetPackEntries(args) {
      if (!Array.isArray(args && args.assets)) throw coded('Expected entries', 'INVALID_INPUT')
      const before = await packOf(args.packId)
      if (before.revision === args.expectedRevision) enforceTriggers(before, { manifest: { ...before.manifest, assets: args.assets } })
      const { snapshot } = await assetLibrary.patchPack({ packId: str(args.packId), expectedRevision: args.expectedRevision, patch: { assets: args.assets } })
      stageMaterialChanged()
      return { pack: snapshot }
    },
    async addAssetPackFiles(args) {
      const result = await stageMaterial.addFiles(str(args && args.packId), str(args && args.kind), await takeFiles(args && args.files))
      stageMaterialChanged()
      return result
    },
    async replaceAssetPackMedia(args) {
      const [file] = await takeFiles([{ uploadId: args && args.uploadId, name: '' }])
      const result = await stageMaterial.replaceMedia(str(args.packId), args.expectedRevision, str(args.kind), str(args.id), file.bytes)
      stageMaterialChanged()
      return result
    },
    // 入场演出: one dsh.entrance/1 JSON file.
    async addAssetPackEntrance(args) {
      const [file] = await takeFiles([{ uploadId: args && args.uploadId, name: str(args && args.name) }])
      const result = await stageMaterial.addEntrance(str(args.packId), file.name, file.bytes)
      stageMaterialChanged()
      return result
    },
    // 添加皮肤: a skin folder's skin.json and the files it declares, by their paths relative to it.
    async addAssetPackSkin(args) {
      const [document] = await takeFiles([{ uploadId: args && args.document, name: 'skin.json' }])
      const rows = Array.isArray(args.files) ? args.files : []
      const files = rows.length ? await takeFiles(rows.map(row => ({ uploadId: row && row.uploadId, name: row && row.path }))) : []
      const result = await stageMaterial.addSkin(str(args.packId), document.bytes, files.map(file => ({ path: file.name, bytes: file.bytes })))
      stageMaterialChanged()
      return result
    },
    // 设为本包默认: what a card that binds this pack draws when it has no skin of its own; null clears it.
    async setAssetPackStageSkin(args) {
      const skin = args && args.skin === null ? null : str(args && args.skin)
      const result = await stageMaterial.setPackSkin(str(args.packId), args.expectedRevision, skin)
      stageMaterialChanged()
      return result
    },
    // 舞台设置 › 默认皮肤 / 本卡皮肤: the stored choices, what this card draws now and the pickers' options (默认皮肤: the
    // global packs' skins; 本卡皮肤: the card's own packs').
    async getStageSkins(args) {
      const path = str(args && args.path), settings = await readTavernSettings()
      const card = path ? await stageSkinOf(path) : null
      return { global: settings.stageSkin, globalChoices: await skinChoices(settings.globalEnabledPackIds),
        ...(card ? { card: { choice: card.choice, cardDefault: card.cardDefault, skin: card.skin, fallback: card.fallback, choices: await skinChoices(await boundOf(path)) } } : {}) }
    },
    async setStageSkin(args) {
      await updateTavernSettings({ stageSkin: await chosenSkin(args && args.skin) })
      stageMaterialChanged()
      return { ok: true }
    },
    async setCardStageSkin(args) {
      const path = str(args && args.path)
      if (!path) throw coded('No card', 'INVALID_INPUT')
      await castAssets.setSkinChoice(path, args.skin === null ? null : await chosenSkin(args.skin))
      stageMaterialChanged(path)
      return { ok: true }
    },
    async removeAssetPackEntry(args) {
      const result = await stageMaterial.removeEntry(str(args && args.packId), args.expectedRevision, str(args.kind), str(args.id))
      stageMaterialChanged()
      return result
    },
    // Deleting a pack also takes it out of every card that binds it and out of the global packs, so no card
    // keeps pointing at it (a card's own pack included: its next import makes a new one).
    async removeAssetPack(args) {
      const packId = str(args && args.packId)
      const result = await assetLibrary.removePack({ packId, expectedRevision: args.expectedRevision })
      for (const path of await fileResources.list('card').catch(() => [])) await unbind(path, packId).catch(() => {})
      if ((await readTavernSettings()).globalEnabledPackIds.includes(packId)) await updateTavernSettings({ globalPack: { packId, enabled: false } })
      stageMaterialChanged()
      return result
    },
    // A card's view of the packs: its own (本卡, binding order) and the player's global ones (全局).
    async getCardAssetPacks(args) {
      const path = str(args && args.path)
      return { boundPackIds: path ? await boundOf(path) : [], globalEnabledPackIds: (await readTavernSettings()).globalEnabledPackIds }
    },
    // 全局 / 本卡 / 关闭 of one pack, seen from a card (without one: 全局 / 关闭). 本卡 adds it to the card's packs,
    // 全局 to every card's; 关闭 takes it out of both.
    async setAssetPackState(args) {
      const path = str(args && args.path), packId = str(args && args.packId), state = str(args && args.state)
      if (!['global', 'card', 'off'].includes(state) || state === 'card' && !path) throw coded('Unknown pack state', 'INVALID_INPUT')
      const global = (await readTavernSettings()).globalEnabledPackIds.includes(packId)
      if (state !== 'off') await packOf(packId)
      if (state === 'global' && !global) await updateTavernSettings({ globalPack: { packId, enabled: true } })
      if (state !== 'global' && global) await updateTavernSettings({ globalPack: { packId, enabled: false } })
      if (state === 'card' && !(await boundOf(path)).includes(packId)) await castAssets.setBoundPackIds(path, [...await boundOf(path), packId])
      if (state === 'off' && path) await unbind(path, packId)
      // A global change reaches every card's games; a card's own change only that card's.
      stageMaterialChanged(state === 'global' || global ? '' : path)
      return { boundPackIds: path ? await boundOf(path) : [], globalEnabledPackIds: (await readTavernSettings()).globalEnabledPackIds }
    },
    async previewAssetPackMedia(args) {
      const url = await stageMaterial.previewUrl(str(args && args.packId), str(args && args.hash))
      if (!url) throw coded('Media unavailable', 'ASSET_UNAVAILABLE')
      return { url }
    }
  }
}
