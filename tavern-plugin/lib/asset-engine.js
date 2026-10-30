import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from './native-settings.js'
import { ENGINE_SECTION, defaultAssetEngineSettings, validateAssetEngineSettings, patchAssetEngineSettings, engineSettingsRevision, parseEnginePreset, validateEnginePreset } from './domain/asset-engine-settings.js'
import { check, canonicalJson } from '../packages/dsh-presentation-protocol/src/asset-pack-json.js'

// DSH owns persistence; this module never writes a second settings file.
export function createAssetEngineSettings(ctx) {
  const entry = defaultAssetEngineSettings()
  const schema = z.object(Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, z.any().default(value)])))
  let source = () => entry, active = true, chain = Promise.resolve()
  const listeners = new Set()
  const changed = () => { for (const listener of listeners) listener() }
  const read = () => {
    check(active, '$', 'Engine settings disposed', 'CONSUMER_UNAVAILABLE')
    const {catalogueCaps:_retired, ...stored} = source()
    // initialize the new CG switch without rewriting native settings on read.
    // these `dimensions` (舞台引擎 › 可用演出) are the one director
    // command setting; a card's stored stage.dimensions is ignored (cardEngineSettings).
    const values = validateAssetEngineSettings({...stored, dimensions:{cg:entry.dimensions.cg,...stored.dimensions}})
    return { values, revision:engineSettingsRevision(values), writable:!!settingsSectionProvider(ctx, ENGINE_SECTION) && settingsSectionProvider(ctx, ENGINE_SECTION).writable !== false, live:true }
  }
  ctx.inject(['settings'], child => {
    installSettingsSection(ctx, child.get('settings'), ENGINE_SECTION, schema, entry, {
      setSource:fn => { source = fn }, onChange:changed, validate:validateAssetEngineSettings,
    })
  })
  ctx.effect(() => () => { active = false; changed(); listeners.clear() })
  function serial(task) { const pending = chain.then(task); chain = pending.catch(() => {}); return pending }
  async function replace(next, expectedRevision) {
    const current = read()
    check(typeof expectedRevision === 'string' && current.revision === expectedRevision, '$.expectedRevision', 'Engine settings changed', 'REVISION_CONFLICT')
    const provider = settingsSectionProvider(ctx, ENGINE_SECTION)
    check(!!provider && provider.writable !== false, '$', 'Native settings unavailable or read-only', 'SETTINGS_UNAVAILABLE')
    const nativeRevision = provider.describe?.().find(section => section.ns === ENGINE_SECTION)?.revision
    await provider.replace(ENGINE_SECTION, next, nativeRevision)
    return read()
  }
  return Object.freeze({
    read,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    save:({patch, expectedRevision}) => serial(() => replace(patchAssetEngineSettings(read().values, patch), expectedRevision)),
    importPreset:({document, expectedRevision, replaceExisting = false}) => serial(async () => {
      const preset = typeof document === 'string' ? parseEnginePreset(document) : validateEnginePreset(document)
      const current = read().values, key = 'dialogueThemes'
      check(replaceExisting === true || !current[key].some(item => item.id === preset.id), '$.id', 'Preset already exists', 'PRESET_EXISTS')
      const next = patchAssetEngineSettings(current, {[key]:current[key].filter(item => item.id !== preset.id).concat(preset)})
      return replace(next, expectedRevision)
    }),
    exportPreset({format, id}) {
      check(format === 'dsh-dialogue-theme', '$.format', 'Only dialogue themes can be exported', 'UNKNOWN_FIELD')
      const key = 'dialogueThemes'
      const preset = read().values[key].find(item => item.id === id)
      check(!!preset, '$.id', 'Custom preset not found', 'NOT_FOUND')
      return {document:canonicalJson(preset)}
    },
  })
}
