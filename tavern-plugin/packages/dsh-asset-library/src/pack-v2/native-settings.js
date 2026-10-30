import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from '../shared/native-settings.js'
import { createHash } from 'node:crypto'
import { check, canonicalJson, validateUuid } from '../asset-packs/common.js'

export const PACK_SETTINGS_SECTION = 'asset-library-packs'
export function validatePackSettings(value) {
  check(value && Object.keys(value).length === 1 && Array.isArray(value.globalEnabledPackIds), '$.settings')
  check(value.globalEnabledPackIds.length <= 1024 && new Set(value.globalEnabledPackIds).size === value.globalEnabledPackIds.length, '$.globalEnabledPackIds')
  value.globalEnabledPackIds.forEach(validateUuid)
  return structuredClone(value)
}
// Explicit installation by the asset plugin in P6; not another JSON persistence owner.
export function createAssetPackSettings(ctx) {
  const validate = validatePackSettings
  const defaults = {globalEnabledPackIds:[]}, schema = z.object({globalEnabledPackIds:z.any().default([])})
  let source = () => defaults, active = true, tail = Promise.resolve()
  const listeners = new Set()
  function read() {
    check(active, '$', 'Pack settings unavailable', 'ASSET_UNAVAILABLE')
    const values = validate(source()), provider = settingsSectionProvider(ctx, PACK_SETTINGS_SECTION)
    return {values, revision:createHash('sha256').update(canonicalJson(values)).digest('hex'), writable:!!provider && provider.writable !== false}
  }
  ctx.inject(['settings'], child => installSettingsSection(ctx, child.get('settings'), PACK_SETTINGS_SECTION, schema, defaults, {
    setSource:fn => {source=fn}, validate,
    onChange:() => {for (const fn of listeners) {try {fn(read())} catch { /* Settings observers cannot undo persistence. */ }}}
  }))
  ctx.effect(() => () => {active=false;listeners.clear()})
  return Object.freeze({
    read,
    save({expectedRevision, globalEnabledPackIds}) {
      const result = tail.then(async () => {
        const current=read(), next=validate({globalEnabledPackIds}), provider=settingsSectionProvider(ctx, PACK_SETTINGS_SECTION)
        check(current.revision === expectedRevision, '$.expectedRevision', 'Pack settings changed', 'REVISION_CONFLICT')
        check(current.writable, '$', 'Native settings unavailable or read-only', 'SETTINGS_UNAVAILABLE')
        const revision=provider.describe?.().find(s=>s.ns===PACK_SETTINGS_SECTION)?.revision
        await provider.replace(PACK_SETTINGS_SECTION,next,revision)
        return read()
      })
      tail=result.catch(()=>{});return result
    },
    subscribe(fn) {listeners.add(fn);return()=>listeners.delete(fn)}
  })
}
