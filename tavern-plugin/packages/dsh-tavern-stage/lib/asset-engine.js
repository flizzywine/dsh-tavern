import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from '../../../lib/native-settings.js'
import { ENGINE_SECTION, defaultAssetEngineSettings, validateAssetEngineSettings, patchAssetEngineSettings, engineSettingsRevision, parseEnginePreset, validateEnginePreset } from '../../../lib/domain/asset-engine-settings.js'
import { check, canonicalJson } from '../../dsh-presentation-protocol/src/asset-pack-json.js'
import { createHash } from 'node:crypto'

// DSH owns persistence; this module never writes a second settings file.
// owner: the profile entry context that holds the section (dsh-tavern's; native-settings.js installSettingsSection).
export function createAssetEngineSettings(ctx, owner = ctx) {
  const entry = defaultAssetEngineSettings()
  const schema = z.object(Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, z.any().default(value)])))
  let source = () => entry, active = true, chain = Promise.resolve()
  const listeners = new Set()
  const changed = () => { for (const listener of listeners) listener() }
  const read = () => {
    check(active, '$', 'Engine settings disposed', 'CONSUMER_UNAVAILABLE')
    // The settings source applies validateAssetEngineSettings once (installSettingsSection hooks.validate).
    // these `dimensions` (舞台引擎 › 可用演出) are the one director
    // command setting; a card's stored stage.dimensions is ignored (cardEngineSettings).
    const values = source()
    return { values, revision:engineSettingsRevision(values), writable:!!settingsSectionProvider(ctx, ENGINE_SECTION, owner) && settingsSectionProvider(ctx, ENGINE_SECTION, owner).writable !== false, live:true }
  }
  ctx.inject(['settings'], child => {
    installSettingsSection(ctx, child.get('settings'), ENGINE_SECTION, schema, entry, {
      setSource:fn => { source = fn }, onChange:changed, validate:validateAssetEngineSettings,
    }, owner)
  })
  ctx.effect(() => () => { active = false; changed(); listeners.clear() })
  function serial(task) { const pending = chain.then(task); chain = pending.catch(() => {}); return pending }
  async function replace(next, expectedRevision) {
    const current = read()
    check(typeof expectedRevision === 'string' && current.revision === expectedRevision, '$.expectedRevision', 'Engine settings changed', 'REVISION_CONFLICT')
    const provider = settingsSectionProvider(ctx, ENGINE_SECTION, owner)
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

// 自动选角's global layer: its switch and 激进程度, a native settings section of dsh-tavern's entry
// like the engine's. New installs start off. A card's layer is its stage.switches.autoCast / stage.autoCast
// (card-stage-settings.js effectiveAutoCast decides; its defaults and layer check come in as defaults / validateLayer).
export const AUTO_CAST_SECTION = 'tavern-auto-cast'
export const AUTO_CAST_METHODS = Object.freeze(['getAutoCastSettings', 'saveAutoCastSettings'])
const AUTO_CAST_KEYS = ['enabled', 'level']
export function createAutoCastSettings(ctx, owner, {defaults, validateLayer}) {
  const validate = value => ({...defaults, ...validateLayer(structuredClone(value), '$', AUTO_CAST_KEYS)})
  const revisionOf = values => createHash('sha256').update(canonicalJson(values)).digest('hex')
  const schema = z.object(Object.fromEntries(AUTO_CAST_KEYS.map(key => [key, z.any().default(defaults[key])])))
  let source = () => ({...defaults}), chain = Promise.resolve()
  const listeners = new Set()
  ctx.inject(['settings'], child => installSettingsSection(ctx, child.get('settings'), AUTO_CAST_SECTION, schema, {...defaults},
    {setSource:fn => { source = fn }, onChange:() => { for (const listener of listeners) listener() }, validate}, owner))
  const provider = () => settingsSectionProvider(ctx, AUTO_CAST_SECTION, owner)
  const read = () => {
    const values = source()
    return {values, revision:revisionOf(values), writable:!!provider() && provider().writable !== false}
  }
  return Object.freeze({
    read,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // patch: {enabled?, level?}; the write is checked against the revision the caller read.
    save({patch, expectedRevision}) {
      const pending = chain.then(async () => {
        const current = read(), settings = provider()
        check(current.revision === expectedRevision, '$.expectedRevision', 'Auto cast settings changed', 'REVISION_CONFLICT')
        check(!!settings && settings.writable !== false, '$', 'Native settings unavailable or read-only', 'SETTINGS_UNAVAILABLE')
        const next = validate({...current.values, ...validateLayer(structuredClone(patch || {}), '$.patch', AUTO_CAST_KEYS)})
        await settings.replace(AUTO_CAST_SECTION, next, settings.describe?.().find(section => section.ns === AUTO_CAST_SECTION)?.revision)
        return read()
      })
      chain = pending.catch(() => {})
      return pending
    },
  })
}