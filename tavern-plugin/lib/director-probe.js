import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from './native-settings.js'
import {check, shape, text} from '../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const DIRECTOR_PROBE_SECTION = 'tavern-director-probes'
export const directorProbeKey = ({provider, model}) => JSON.stringify([provider, model])
const noTools = '\u5bfc\u6f14\u6a21\u578b\u6ca1\u6709\u8c03\u7528\u5de5\u5177\uff0c\u8bf7\u6362\u4e00\u4e2a\u652f\u6301\u5de5\u5177\u8c03\u7528\u7684\u6a21\u578b'

// Separate from engine presets: observations belong to this host's model catalogue.
export function validateDirectorProbeSettings(value) {
  shape(value, ['models'], ['models'])
  check(value.models && typeof value.models === 'object' && !Array.isArray(value.models), '$.models')
  for (const result of Object.values(value.models)) check(typeof result === 'boolean', '$.models')
  return structuredClone(value)
}

export function createDirectorProbeStore(ctx) {
  let source = () => ({models:{}}), chain = Promise.resolve()
  const validate = validateDirectorProbeSettings
  ctx.inject(['settings'], child => installSettingsSection(ctx, child.get('settings'), DIRECTOR_PROBE_SECTION,
    z.object({models:z.any().default({})}), {models:{}}, {setSource:fn => {source = fn}, onChange:() => {}, validate}))
  return {
    read:() => structuredClone(source().models),
    writable:() => !!settingsSectionProvider(ctx, DIRECTOR_PROBE_SECTION) && settingsSectionProvider(ctx, DIRECTOR_PROBE_SECTION).writable !== false,
    save(selection, supported) {
      const pending = chain.then(async () => {
        const settings = settingsSectionProvider(ctx, DIRECTOR_PROBE_SECTION)
        check(settings && settings.writable !== false, '$', 'Native settings unavailable or read-only', 'SETTINGS_UNAVAILABLE')
        const revision = settings.describe?.().find(section => section.ns === DIRECTOR_PROBE_SECTION)?.revision
        await settings.replace(DIRECTOR_PROBE_SECTION, {models:{...source().models,[directorProbeKey(selection)]:supported}}, revision)
      })
      chain = pending.catch(() => {})
      return pending
    },
  }
}

// Exactly one native stream, no agent turn, tool execution, history, or retry.
export function createDirectorProbeRpc({store, resolveSelection, stream}) {
  const inflight = new Map()
  return {
    getDirectorToolSupport() { return {models:store.read()} },
    async testDirectorConnection(args = {}) {
      shape(args, ['selection','sessionId'], [])
      if (args.sessionId !== undefined) text(args.sessionId, '$.sessionId', 256)
      if (args.selection != null && args.selection !== 'foreground') {
        shape(args.selection, ['provider','model'], ['provider','model'])
        text(args.selection.provider, '$.selection.provider', 160)
        text(args.selection.model, '$.selection.model', 256)
      }
      check(store.writable(), '$', 'Native settings unavailable or read-only', 'SETTINGS_UNAVAILABLE')
      const selection = await resolveSelection(args)
      check(selection?.provider && selection?.model, '$.selection', 'No director model selected', 'MODEL_NOT_SELECTED')
      const key = directorProbeKey(selection)
      if (inflight.has(key)) return inflight.get(key)
      const pending = (async () => {
        const start = Date.now()
        let supported = false
        try {
          for await (const event of stream({provider:selection.provider, model:selection.model,
            messages:[{role:'user',content:[{type:'text',text:'Call director_connection_probe once. Do not reply with text.'}]}],
            tools:[{name:'director_connection_probe',description:'Confirm native tool calling.',parameters:{type:'object',properties:{},additionalProperties:false}}],
            maxTokens:128, signal:AbortSignal.timeout(30000)})) {
            if (event.type === 'block-end' && event.block?.type === 'tool-call' && event.block.name === 'director_connection_probe') supported = true
            if (event.type === 'error') throw new Error('Model stream failed')
          }
        } catch {
          // Transport/provider failures say nothing about tool support; keep the previous observation.
          return {ok:false,selection:{provider:selection.provider,model:selection.model},latencyMs:Date.now()-start,error:{code:'DIRECTOR_CONNECTION_ERROR',message:'\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6a21\u578b\u914d\u7f6e\u540e\u91cd\u8bd5'}}
        }
        await store.save(selection, supported)
        return {ok:supported,supported,selection:{provider:selection.provider,model:selection.model},latencyMs:Date.now()-start,
          ...(!supported ? {error:{code:'DIRECTOR_NO_TOOL_CALL',message:noTools}} : {})}
      })()
      inflight.set(key,pending)
      try {return await pending} finally {inflight.delete(key)}
    },
  }
}
