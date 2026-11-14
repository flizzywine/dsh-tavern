import { createAssetPackService } from './service.js'
import { createAssetPackSettings } from './native-settings.js'
import { installAssetSettingsMigration } from './settings-config.js'
export { Config } from './settings-config.js'
import { createCatalogueSettings } from '../pack-catalogue/settings.js'
import { createAssetPackTransport, registerAssetPackTransport } from './transport.js'
import { decodeMedia } from './media.js'
import { check } from '../asset-packs/common.js'
import { PACK_BUDGET } from './budget.js'

export const name = 'dsh-asset-library'
// The sole installed asset owner. Seeds are explicit input, never a runtime catalogue.
export function apply(ctx, config = {}) {
  installAssetSettingsMigration(ctx)
  const runningAgents = new Set()
  ctx.on('agent/status', ({agent,status}) => {
    if (status === 'running') runningAgents.add(agent)
    else runningAgents.delete(agent)
  }, {global:true})
  const settings = createAssetPackSettings(ctx)
  const catalogueSettings = createCatalogueSettings(ctx, config.officialCatalogueUrl)
  // Every CardBundleAdapter method the service calls (service.d.ts); a missing one fails as an uncoded TypeError.
  const cards = Object.fromEntries(['snapshot','inspectRaw','remapRaw','bindRaw','exportRaw','withPrepared','withConfigPack','withBoundPack','withExistingBoundPack','unbindPack','recover'].map(method => [method, (...args) => {
    const adapter = ctx.get('tavernAssetCards')
    check(adapter?.apiVersion === 2 && typeof adapter[method] === 'function', '$.card', 'Card owner unavailable', 'RECOVERY_REQUIRED')
    return adapter[method](...args)
  }]))
  // Resolve lazily so host/plugin mount order cannot create a second media owner.
  const mediaStore = Object.fromEntries(['put','resolve','materialize'].map(method => [method, (...args) => {
    const owner = ctx.get('tavernMediaStore')
    check(owner, '$.mediaStore', 'Media owner unavailable', 'RECOVERY_REQUIRED')
    return owner[method](...args)
  }]))
  // figureImageExtras: a pack leaving the library (export, copy) takes its figures' 配图 外貌 from the host (figure-image-extras.js),
  // figureImageMedia: and the bytes of a 参考图 it names that the pack does not hold;
  // adoptFigureImageLooks: an update the user confirmed with 「用导入的外貌」 for some figures tells the host before it is written.
  const transport = createAssetPackTransport({...config, mediaStore, figureImageExtras:input => ctx.get('tavernFigureImageExtras')?.forFigures(input), figureImageMedia:input => ctx.get('tavernFigureImageExtras').media(input), adoptFigureImageLooks:input => ctx.get('tavernFigureImageExtras')?.adopt(input), normalizeSkinMods:async(mods,assets) => (await ctx.get('tavernSkinOptions')?.normalize(mods,assets)) || {}, thumbnails:{isBusy:() => runningAgents.size > 0,onError:error => ctx.logger.warn('[asset-thumbnails] ' + error.message)}, limits:PACK_BUDGET, decodeMedia:config.decodeMedia || decodeMedia, settings, catalogueSettings, cardTransactions:cards,
    // a card's voice source maps to a configured voice service of the same kind (card-material.js).
    voiceChannels:async () => ((await ctx.get('tts')?.listServices()) || []).map(service => service.kind)})
  ctx.provide('assetLibrary',transport.service)
  // Internal rollback snapshots are not public downloads; never expose this callback in the transport.
  ctx.provide('assetLibraryCardBackup', async (file, input, consume) => {
    const backup = createAssetPackService({...config, mediaStore, limits:PACK_BUDGET, cardTransactions:cards, privateExportFile:file, globalEnabledPackIds:() => settings.read().values.globalEnabledPackIds})
    try { return await backup.withCardExport(input, consume) } finally { await backup.dispose() }
  })
  ctx.provide('assetPackSettings',settings)
  registerAssetPackTransport(ctx,transport)
  ctx.effect(() => () => transport.service.dispose())
}
