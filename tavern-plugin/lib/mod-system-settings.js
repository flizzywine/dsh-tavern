import z from '@deepseek-ai/schemastery'
import {installSettingsSection,settingsSectionProvider} from './native-settings.js'
import {isDeepStrictEqual as equal} from 'node:util'
import {emptyGlobalMods,validateModSystem,modError} from './domain/mod-system-contract.js'

export const MANAGED_MOD_SETTINGS_SECTION='tavern-mod-system'

// Preferences and portable global defaults share the native settings owner, never the card archive.
export function createManagedModSettingsOwner(ctx) {
  const defaults=emptyGlobalMods(),listeners=new Set()
  let source=()=>defaults,active=true
  const changed=()=>{for(const listener of listeners)listener()}
  ctx.inject(['settings'],child=>installSettingsSection(ctx,child.get('settings'),MANAGED_MOD_SETTINGS_SECTION,
    z.object({version:z.number().default(defaults.version),mods:z.any().default(defaults.mods),packs:z.any().default(defaults.packs),config:z.any().default(defaults.config),preferences:z.any().default(defaults.preferences)}),defaults,
    {setSource:fn=>{source=fn},onChange:changed,validate:value=>{validateModSystem('global',value);return value}}))
  ctx.effect(()=>()=>{active=false;changed();listeners.clear()})
  const read=()=>{
    if(!active)throw modError('MOD_DISABLED','Managed settings owner is disposed')
    const provider=settingsSectionProvider(ctx,MANAGED_MOD_SETTINGS_SECTION)
    return {revision:provider?.describe().find(section=>section.ns===MANAGED_MOD_SETTINGS_SECTION)?.revision ?? '0',value:structuredClone(source())}
  }
  return Object.freeze({read,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},
    async compareAndSwap({expectedRevision,expectedValue,value}) {
      validateModSystem('global',value)
      const provider=settingsSectionProvider(ctx,MANAGED_MOD_SETTINGS_SECTION),current=read(),next=structuredClone(value)
      if(current.revision!==expectedRevision || !equal(current.value,expectedValue))throw modError('MOD_REVISION_CONFLICT','Global mod choices changed; refresh before saving')
      if(!provider || provider.writable===false)throw modError('MOD_DISABLED','Native settings are unavailable')
      await provider.replace(MANAGED_MOD_SETTINGS_SECTION,next,expectedRevision)
      return read()
    },
  })
}
