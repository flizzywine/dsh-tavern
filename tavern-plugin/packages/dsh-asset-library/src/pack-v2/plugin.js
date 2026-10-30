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
  const cards = Object.fromEntries(['snapshot','inspectRaw','remapRaw','bindRaw','withPrepared','withConfigPack','withBoundPack','unbindPack','recover'].map(method => [method, (...args) => {
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
  const transport = createAssetPackTransport({...config, mediaStore, normalizeSkinMods:async(mods,assets) => (await ctx.get('tavernSkinOptions')?.normalize(mods,assets)) || {}, thumbnails:{isBusy:() => runningAgents.size > 0,onError:error => ctx.logger.warn('[asset-thumbnails] ' + error.message)}, limits:PACK_BUDGET, decodeMedia:config.decodeMedia || decodeMedia, settings, catalogueSettings, cardTransactions:cards})
  ctx.provide('assetLibrary',transport.service)
  ctx.provide('assetPackSettings',settings)
  registerAssetPackTransport(ctx,transport)
  ctx.effect(() => () => transport.service.dispose())
}
