import {createStageHandlers} from './rpc.js'
import {MOD_MANAGEMENT_METHODS} from '../../../lib/mod-service.js'
import {MANAGED_MOD_METHODS} from '../../../lib/mod-system-production.js'
import {MOD_CONFIG_METHODS} from '../../../lib/mod-config.js'

const remoteReads = new Set(['getStageDirection', 'getStageModHistory', 'getDialogueBubbles'])
const widgetMethods = new Set(['readWidgetVariables', 'proposeWidgetVariables', 'widgetVariableStatus', 'invalidateWidgetVariables'])
const inputOf = args => {const {_performance, _traceId, ...input} = args || {};return input}
const unavailable = () => Object.assign(new Error('舞台模块已停用'), {code:'STAGE_UNAVAILABLE'})

// Private stage composition, not a public plugin interface. The host sees only
// method admission and dispatch; all stage aliases and mod routing live here.
export function createStageRequests(deps, modules = deps) {
  const handlers = Object.assign(Object.create(null), createStageHandlers(deps))
  handlers.getStageTimer = handlers.updateStageTimer
  for (const method of ['getJudgeConfig', 'saveJudgeConfig', 'getJudgeCredentialStatus', 'setJudgeKey']) handlers[method] = handlers.testJudgeConnection
  const delegated = new Map([
    ...MANAGED_MOD_METHODS.map(method => [method, (input, authority, serverTemplate) => modules.managedModManagement.call(method,input,authority,{serverTemplate})]),
    ...MOD_CONFIG_METHODS.map(method => [method, (input, authority) => modules.modConfigHost.call(method,input,authority)]),
    ...MOD_MANAGEMENT_METHODS.map(method => [method, (input, authority) => modules.modService.call(method,input,authority)])
  ])
  let active = true
  return Object.freeze({
    methods:Object.freeze([...new Set([...delegated.keys(),...Object.keys(handlers)])]),
    handles:method => delegated.has(method) || Object.hasOwn(handlers,method),
    remoteRead:method => remoteReads.has(method),
    async call(method, args, authority, serverTemplate = false) {
      if (!active) throw unavailable()
      let result
      if (delegated.has(method)) result = await delegated.get(method)(inputOf(args),authority,serverTemplate)
      else {
        if (!Object.hasOwn(handlers,method)) throw Object.assign(new Error('未知舞台方法: '+method), {code:'STAGE_METHOD_UNKNOWN'})
        result = await handlers[method](widgetMethods.has(method) ? inputOf(args) : args,method,serverTemplate,authority)
      }
      // Requests already admitted may complete their own work, but their results
      // must not be delivered as if the disposed stage were still available.
      if (!active) throw unavailable()
      return result
    },
    dispose() {active = false}
  })
}
