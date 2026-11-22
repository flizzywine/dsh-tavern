import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from './native-settings.js'
import { check, canonicalJson } from '../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { createHash } from 'node:crypto'

// 自动选角's global layer: its switch and 激进程度, a native settings section of dsh-tavern's entry
// like the engine's. New installs start off. A card's layer is its stage.switches.autoCast / stage.autoCast
// (card-stage-settings.js effectiveAutoCast decides; its defaults and layer check come in as defaults / validateLayer).
export const AUTO_CAST_SECTION = 'tavern-auto-cast'
export const AUTO_CAST_METHODS = Object.freeze(['getAutoCastSettings', 'saveAutoCastSettings', 'getAutoCastStatus'])
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
