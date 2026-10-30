import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from './native-settings.js'
import {isDeepStrictEqual as equal} from 'node:util'
import {rawData} from './domain/card-preparation.js'
import {warnDuplicateCard} from './domain/mod-system-choices.js'
import {validateModCardBindings} from './domain/mods/card-bindings.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modJson,modFreeze} = contract
export const MOD_SETTINGS_SECTION = 'tavern-mods'
export const defaultModSettings = () => ({global:{enabledModIds:[],mods:{}},grants:{}})

export function validateModSettings(value) {
  modJson(value, 1024 * 1024)
  shape(value, ['global','grants'])
  shape(value.global, ['enabledModIds','mods'])
  check(Array.isArray(value.global.enabledModIds) && value.global.enabledModIds.every(id => typeof id === 'string') && new Set(value.global.enabledModIds).size === value.global.enabledModIds.length, '$.global.enabledModIds')
  shape(value.global.mods,Object.keys(value.global.mods),[],'$.global.mods')
  shape(value.grants,Object.keys(value.grants),[],'$.grants')
  for (const row of Object.values(value.global.mods)) {
    shape(row, ['enabledPackIds','settings'],['enabledPackIds'])
    check(Array.isArray(row.enabledPackIds) && row.enabledPackIds.every(id => typeof id === 'string'), '$.global.mods.enabledPackIds')
    if(row.settings!==undefined)shape(row.settings,Object.keys(row.settings),[],'$.global.mods.settings')
  }
  check(Object.values(value.grants).every(revision => typeof revision === 'string'), '$.grants')
  return value
}

export function createModSettingsOwner(ctx) {
  const defaults = defaultModSettings()
  let source = () => defaults, active = true
  const listeners = new Set(), changed = () => { for (const listener of listeners) listener() }
  const validate = validateModSettings
  ctx.inject(['settings'], child => installSettingsSection(ctx, child.get('settings'), MOD_SETTINGS_SECTION,
    z.object({global:z.any().default(defaults.global),grants:z.any().default(defaults.grants)}), defaults,
    {setSource:fn => {source=fn},onChange:changed,validate}))
  ctx.effect(() => () => {active=false;changed();listeners.clear()})
  const read = () => {
    check(active, '$', 'Mod settings owner is disposed', 'MOD_RESOURCE_UNAVAILABLE')
    const provider = settingsSectionProvider(ctx, MOD_SETTINGS_SECTION)
    return modFreeze({revision:provider?.describe?.().find(section => section.ns === MOD_SETTINGS_SECTION)?.revision ?? '0',value:structuredClone(source())})
  }
  return Object.freeze({read,subscribe(fn) {listeners.add(fn);return () => listeners.delete(fn)},
    async compareAndSwap({expectedRevision,expectedValue,value}) {
      const provider = settingsSectionProvider(ctx, MOD_SETTINGS_SECTION), current = read()
      check(current.revision === expectedRevision && equal(current.value,expectedValue), '$.expectedRevision', 'Native mod settings changed', 'MOD_REVISION_CONFLICT')
      check(provider && provider.writable !== false, '$', 'Native settings are unavailable', 'MOD_RESOURCE_UNAVAILABLE')
      await provider.replace(MOD_SETTINGS_SECTION,value,expectedRevision)
      return read()
    },
  })
}

// The caller supplies existing Card Preparation and its shared card queue/writer, not a raw FS path.
export function createModCardOwner({cardPreparation,listPaths,readWorkspace,writeWorkspace,withCardLock}) {
  const paths = new Map()
  const value = workspace => rawData(workspace.raw).extensions?.dsh_tavern?.modBindings ?? null
  const revision = workspace => workspace.meta.id + ':' + String(workspace.meta.updatedAt ?? workspace.meta.importedAt)
  async function lookup(cardId) {
    const path = paths.get(cardId)
    const workspace = path && await readWorkspace(path)
    check(workspace?.meta.id === cardId, '$.cardId', 'Card is not available', 'MOD_RESOURCE_UNAVAILABLE')
    return {path,workspace}
  }
  return Object.freeze({
    async list() {
      const rows = []
      paths.clear()
      for (const path of await listPaths()) {
        const workspace = await readWorkspace(path)
        if (!workspace) continue
        // Copied card files can share an identity; the first keeps its mods, a copy is left out
        // (refusing the whole list would keep Tavern from starting).
        if (paths.has(workspace.meta.id)) { warnDuplicateCard(paths.get(workspace.meta.id), path); continue }
        paths.set(workspace.meta.id,path)
        rows.push({cardId:workspace.meta.id,revision:revision(workspace),value:value(workspace)})
      }
      return rows
    },
    async read({cardId}) {
      const {workspace} = await lookup(cardId)
      return {revision:revision(workspace),value:value(workspace)}
    },
    async compareAndSwap({cardId,expectedRevision,expectedValue,value:next}) {
      next=validateModCardBindings(next)
      return withCardLock(cardId,async () => {
        const {path,workspace} = await lookup(cardId)
        check(revision(workspace) === expectedRevision && equal(value(workspace),expectedValue), '$.expectedRevision', 'Card mod bindings changed', 'MOD_REVISION_CONFLICT')
        const prefix = rawData(workspace.raw) === workspace.raw ? '' : '/data'
        const change = cardPreparation.update({kind:'card',card:workspace,patch:{},rawOperations:[
          {op:next === null ? 'delete' : 'set',path:prefix + '/extensions/dsh_tavern/modBindings',...(next === null ? {} : {value:next})},
        ]})
        if (change.changed) {
          change.card.meta.updatedAt = Math.max(Date.now(),Number(workspace.meta.updatedAt || 0) + 1)
          await writeWorkspace(path,change.card)
        }
        return {revision:revision(change.card),value:value(change.card)}
      })
    },
  })
}
