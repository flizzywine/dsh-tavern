import { join } from 'node:path'
import { installSettingsSection, settingsSectionProvider } from './shared/native-settings.js'
import { installTtsSettingsMigration } from './settings-config.js'
export { Config } from './settings-config.js'
import { createReadingPresetStore } from './reading-presets.js'
import { createTts } from './service.js'
import { createCache } from './cache.js'
import { createSampleCache } from './sample-cache.js'
import { Settings, validateSettings, createServiceSettings, readingOf, patchReading } from './settings.js'
import { registerRoutes, registerEnabledRoute } from './routes.js'
import { fail, hash, id, canonical } from './core.js'
export const name = 'dsh-tavern-tts'
export function apply(ctx, config = {}) {
  const settingsReady = installTtsSettingsMigration(ctx)
  let ready = !ctx.get('settings') || typeof ctx.get('settings').installSection === 'function'
  const entry = Settings(config.settings || {})
  let source = () => entry, generation = 0
  // named reading presets, one active; synthesis reads the active one.
  const readings = createReadingPresetStore({file:config.dataDir ? join(config.dataDir,'readings.json') : undefined})
  const cacheLimits = value => ({maxBytes:value.cacheMaxGB * 1024 ** 3, maxAgeDays:value.cacheMaxAgeDays})
  const cache = createCache({dataDir:config.dataDir,...cacheLimits(entry),onBoot:row => ctx.logger.info('TAVERN_BOOT %s',JSON.stringify(row))})
  const tts = createTts({ profileId:config.profileId, dataDir:config.dataDir,
    cache, reading:() => readingOf(source()), globalReadings:() => readings.activeEntries() })
  // 'readingChanged' fires once per real change, whether written through setReading or edited in the settings document.
  let lastReading = canonical(readingOf(source()))
  function syncReading() {
    const next = canonical(readingOf(source()))
    if (next !== lastReading) { lastReading = next; tts.readingChanged() }
  }
  const samples = config.dataDir ? createSampleCache({dataDir:config.dataDir}) : undefined
  const services = createServiceSettings({ tts, samples, get:() => source(), credentials:() => ctx.get('credentials'), warn:message => ctx.logger.warn(message),
    replace: async value => { const settings = settingsSectionProvider(ctx, 'tts'); if (!settings) fail('SETTINGS_UNAVAILABLE'); await settings.replace('tts',validateSettings(value),settings.describe().find(row => row.ns === 'tts')?.revision) },
  })
  Object.assign(tts, { listRecommendedFishVoices:services.listRecommendedFishVoices, saveService:services.save, deleteService:services.delete, testService:services.test, importVoicePresets:services.importVoicePresets })
  // Status is stale-while-revalidate: concurrent panels share one bounded probe per provider.
  const statuses = new Map()
  tts.subscribe(event => {
    if (event.serviceId) { statuses.get(event.serviceId)?.abort?.abort(); statuses.delete(event.serviceId) }
    if (event.type === 'disposed') { for (const entry of statuses.values()) entry.abort?.abort(); statuses.clear() }
    if (event.type === 'synthesisFailed') ctx.logger.warn(`[tts synthesis] ${event.code}`)
  })
  function runningStatus(list) {
    return list.map(s => {
      let entry = statuses.get(s.id)
      if (!entry) { entry = {status:{state:'checking'},until:0,pending:false}; statuses.set(s.id,entry) }
      if (!entry.pending && entry.until <= Date.now()) {
        entry.pending = true
        const abort = new AbortController(); entry.abort = abort
        let timer
        const timeout = new Promise((_,reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('TIMEOUT')) },4000); timer.unref?.() })
        void Promise.race([tts.health({serviceId:s.id,signal:abort.signal}).then(r => r[0] || {}),timeout]).then(h => {
          const voices = Array.isArray(h.voices) ? h.voices : undefined
          entry.status = {state:typeof h.state === 'string' ? h.state.slice(0,40) : 'ready', ...(h.sleeping ? {sleeping:true} : {}), ...(voices ? {voiceCount:voices.filter(v => v?.state === 'ready').length,voiceTotal:voices.length} : {}),
            ...(/^[A-Z_]+$/.test(h.error || '') ? {error:h.error} : {})}
        },() => { entry.status = {state:'offline'} }).finally(() => { clearTimeout(timer); entry.pending = false; entry.until = Date.now() + 10000 })
      }
      return {...s,status:entry.status}
    })
  }
  async function providerVoices({serviceId} = {}) {
    if (source().providers.some(p => p.id === serviceId)) return services.voices({id:serviceId})
    const items = await tts.listProviderCatalog({serviceId:id(serviceId)})
    return {status:'ok', source:'live', models:[], voices:items.filter(v => !v.preset).map(v => ({id:v.id, label:v.label || v.id, languages:v.languages || [], engine:v.engine, revision:v.revision, state:v.state,
      ...(v.modelSetId ? {modelSetId:v.modelSetId} : {}), ...(v.modelVersion ? {modelVersion:v.modelVersion} : {}), ...(v.params ? {params:v.params} : {})}))}
  }
  const enabledListeners = new Set()
  let unprovide, removing = Promise.resolve(), disposed = false
  async function syncEnabled() {
    const enabled = ready && source().enabled
    tts.setEnabled(enabled)
    if (!enabled && unprovide) {
      const stop = unprovide; unprovide = undefined; removing = stop()
    }
    for (const fn of enabledListeners) fn(enabled)
    await removing
    if (!disposed && enabled && !unprovide) unprovide = ctx.provide('tts',tts)
  }
  async function changed() {
    const mine = ++generation, value = source(); validateSettings(value)
    await syncEnabled(); services.sync(); syncReading()
    await cache.configure(cacheLimits(value), {lazy:true})
  }
  // the separate 字母词 list (settings
  // tts.pronunciationDictionary) is gone — one 发音字典. Rows a user added there move once into the active reading preset
  // (language inferred like any new entry); an empty row has no reading to move. Then the key is dropped.
  let migrating = null
  async function migratePronunciations(settings) {
    await null // after installSection returns
    if (!Object.hasOwn(source(),'pronunciationDictionary')) return
    const rows = Array.isArray(source().pronunciationDictionary) ? source().pronunciationDictionary : []
    for (const row of rows) {
      const forms = typeof row?.term === 'string' ? row.term.trim() : '', reading = typeof row?.spoken === 'string' ? row.spoken.trim() : ''
      if (!forms || !reading) continue
      const preset = await readings.get({})
      try { await readings.edit({id:preset.id, expectedRevision:preset.revision, op:'add', entry:{forms, reading}}) }
      catch (error) { ctx.logger.warn('[tts] 字母词「' + forms + '」没有并入发音字典：' + (error.code || error.message)) }
    }
    const { pronunciationDictionary, ...rest } = source()
    await settings.replace('tts',validateSettings(rest),settings.describe().find(row => row.ns === 'tts')?.revision)
  }
  ctx.inject(['settings'], child => {
    const settings = settingsSectionProvider(ctx, 'tts')
    installSettingsSection(ctx,child.get('settings'),'tts',Settings,entry,{
      setSource:fn => { source = fn; void settingsReady.then(ok => { if (ok) migrating ??= migratePronunciations(settings).catch(error => ctx.logger.warn(error)) }) },
      onChange:() => { void changed().catch(error => ctx.logger.warn(error)) }, validate:validateSettings,
    })
  })
  services.sync()
  void syncEnabled()
  void settingsReady.then(async ok => { ready = ok; if (ok) await changed() }).catch(error => ctx.logger.warn(error))
  registerEnabledRoute(ctx, { get:() => ready && source().enabled, subscribe(fn) { enabledListeners.add(fn); return () => enabledListeners.delete(fn) } })
  const control=async (method,args = {}) => {
    switch (method) {
      case 'getEnabled': return {enabled:ready && source().enabled}
      case 'setEnabled': {
        if (typeof args.enabled !== 'boolean') fail('INVALID_INPUT')
        const settings = settingsSectionProvider(ctx, 'tts'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.replace('tts',validateSettings({...source(),enabled:args.enabled}),settings.describe().find(row => row.ns === 'tts')?.revision); await syncEnabled()
        return {enabled:source().enabled}
      }
      case 'reading': return readingOf(source())
      case 'setReading': {
        const next = patchReading(source().reading, args)
        const settings = settingsSectionProvider(ctx, 'tts'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.replace('tts',validateSettings({...source(),reading:next}),settings.describe().find(row => row.ns === 'tts')?.revision); syncReading()
        return readingOf(source())
      }
      case 'capabilities': return tts.capabilities()
      case 'settings': return { ...source(), providers:await services.list() }
      case 'services': return { configured:await services.list(), running:await runningStatus(await tts.listServices()) }
      case 'providerKinds': return services.kinds()
      case 'listRecommendedFishVoices': return services.listRecommendedFishVoices(args)
      case 'validateFishVoice': return services.validateFishVoice(args)
      case 'searchFishVoices': return services.searchFishVoices(args)
      case 'fishSample': return services.fishSample(args)
      case 'voiceModelStatus': return services.voiceModelStatus(args)
      case 'validateVoiceModel': return services.validateVoiceModel(args)
      case 'listOnlinePresetVoices': return services.listOnlinePresetVoices(args)
      case 'probeService': return services.probe(args)
      case 'providerVoices': return providerVoices(args)
      // discovery controls share the same unbilled, provider-owned listing.
      case 'listModels': { const result = await providerVoices(args); return {...result,voices:undefined} }
      case 'listVoices': { const result = await providerVoices(args); return {...result,models:undefined} }
      case 'saveService': return services.save(args)
      case 'deleteService': return services.delete(args)
      case 'testService': return services.test(args)
      case 'voicePresets': return services.listVoicePresets().map(preset => ({preset,revision:hash(preset)}))
      case 'saveVoicePreset': return services.saveVoicePreset(args)
      case 'deleteVoicePreset': return services.deleteVoicePreset(args)
      case 'importVoicePresets': return services.importVoicePresets(args)
      case 'voices': return tts.listServiceVoices()
      case 'catalog': return tts.listProviderCatalog(args)
      case 'health': return tts.health(args)
      case 'cache': return tts.cacheSnapshot()
      case 'clearCache': return tts.clearCache(args)
      case 'deleteCacheEntry': return tts.deleteCacheEntry(args)
      case 'saveCacheSettings': {
        const value = validateSettings({...source(),cacheMaxGB:args.cacheMaxGB,cacheMaxAgeDays:args.cacheMaxAgeDays})
        const settings = settingsSectionProvider(ctx, 'tts'); if (!settings) fail('SETTINGS_UNAVAILABLE')
        await settings.replace('tts',value,settings.describe().find(row => row.ns === 'tts')?.revision)
        await cache.configure(cacheLimits(source())); return tts.cacheStats()
      }
      case 'readingPresets': return readings.list()
      case 'readingPreset': return readings.get(args)
      case 'editReading': return readings.edit(args)
      case 'createReadingPreset': return readings.create(args)
      case 'renameReadingPreset': return readings.rename(args)
      case 'deleteReadingPreset': return readings.remove(args)
      case 'setActiveReadingPreset': return readings.setActive(args)
      case 'exportReadingPreset': return readings.exportPreset(args)
      case 'importReadingPreset': return readings.importPreset(args)

      default: fail('UNKNOWN_METHOD')
    }
  }
  ctx.provide('ttsControl',Object.freeze({call:control}))
  const root = '/api/dsh-tts/v1'
  // The browser address of an audio ticket; the HTTP root is the plugin's alone.
  tts.audioUrl = ticket => root + '/audio?ticket=' + encodeURIComponent(ticket)
  registerRoutes(ctx,root,control, ticket => tts.redeemAudioTicket(ticket), tts.jobs, samples)
  ctx.effect(() => async () => { disposed = true; generation++; enabledListeners.clear(); services.dispose(); await tts.dispose() })
}
