import {createStageHandlers} from './rpc.js'
import {MOD_MANAGEMENT_METHODS} from './mod-service.js'
import {MANAGED_MOD_METHODS} from './mod-system-production.js'
import {MOD_CONFIG_METHODS} from './mod-config.js'
import {CLIP_EXPORT_METHODS} from './clip/clip-export.js'
import {AUTO_CAST_METHODS} from './asset-engine.js'

const remoteReads = new Set(['getStageDirection', 'getStageModHistory', 'getDialogueBubbles'])
// The browser transport adds _performance, _traceId and _sessionPatchPage to every request; no stage method sees them (many check their fields strictly).
const inputOf = args => {const {_performance, _traceId, _sessionPatchPage, ...input} = args || {};return input}
const unavailable = () => Object.assign(new Error('舞台模块已停用'), {code:'STAGE_UNAVAILABLE'})

// Private stage composition, not a public plugin interface. The host sees only
// method admission and dispatch; all stage aliases and mod routing live here.
export function createStageRequests(deps, modules = deps) {
  const handlers = Object.assign(Object.create(null), createStageHandlers(deps))
  for (const method of ['getJudgeConfig', 'saveJudgeConfig', 'getJudgeCredentialStatus', 'setJudgeKey']) handlers[method] = handlers.testJudgeConnection
  const delegated = new Map([
    ...MANAGED_MOD_METHODS.map(method => [method, (input, authority, serverTemplate) => modules.managedModManagement.call(method,input,authority,{serverTemplate})]),
    ...MOD_CONFIG_METHODS.map(method => [method, (input, authority) => modules.modConfigHost.call(method,input,authority)]),
    ...MOD_MANAGEMENT_METHODS.map(method => [method, (input, authority) => modules.modService.call(method,input,authority)]),
    ...AUTO_CAST_METHODS.map(method => [method, input => method === 'getAutoCastSettings' ? modules.autoCastSettings.read()
      : method === 'getAutoCastStatus' ? modules.autoCastStatus(String(input?.path || '')) : modules.autoCastSettings.save(input)]),
    ...CLIP_EXPORT_METHODS.map(method => [method, (input, authority, serverTemplate) => {
      if (!authority?.origin || serverTemplate) throw new Error('片段导出需要已认证的应用界面')
      return modules.clipExport.call(method,input)
    }])
  ])
  let active = true
  return Object.freeze({
    methods:Object.freeze([...new Set([...delegated.keys(),...Object.keys(handlers)])]),
    handles:method => delegated.has(method) || Object.hasOwn(handlers,method),
    // getStageDirection reads only when asked readOnly; otherwise it may run and save the director, which is no mux read.
    remoteRead:(method,args) => remoteReads.has(method) && (method !== 'getStageDirection' || args?.readOnly === true),
    async call(method, args, authority, serverTemplate = false) {
      if (!active) throw unavailable()
      let result
      if (delegated.has(method)) result = await delegated.get(method)(inputOf(args),authority,serverTemplate)
      else {
        if (!Object.hasOwn(handlers,method)) throw Object.assign(new Error('未知舞台方法: '+method), {code:'STAGE_METHOD_UNKNOWN'})
        result = await handlers[method](inputOf(args),method,serverTemplate,authority)
      }
      // Requests already admitted may complete their own work, but their results
      // must not be delivered as if the disposed stage were still available.
      if (!active) throw unavailable()
      return result
    },
    dispose() {active = false}
  })
}
