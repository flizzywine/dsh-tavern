// widgets declare slots; the infrastructure knows no widget schema.
import contract from '../../src/client/widget-contracts.cjs'
import { resolveSlot } from './variable-bindings/index.js'
import { activeWidgetKeys, widgetIsActive } from './widget-availability.js'

const clockHints = {keywords:['时间','time','当前时间','currentTime','clock','日期','date','datetime'],preferredParents:['世界','世界状态','world','worldstate']}
export function widgetVariableSlots(ref,document,defaults={}) {
  return (document.settingsSchema?.fields || []).filter(field => field.bindable).map(field => ({
    target:{kind:'widgets',ref,slot:field.key},label:contract.stageWidgetSettingLabel(document,field.label),
    valueType:field.type === 'text' ? 'string' : field.type === 'toggle' ? 'boolean' : 'number',
    default:defaults[field.key] ?? field.default,
    guessHints:field.key === 'clockText' ? clockHints : {keywords:[field.key]},
    normalize(value) {
      const resolved = contract.stageWidgetResolveSettings(document,defaults,{bindings:{[field.key]:{source:'mvu',path:'/value'}}},{[field.key]:{status:'ready',value}})
      return {value:resolved.settings[field.key],status:resolved.diagnostics[field.key] || 'ready'}
    },
  }))
}
export const widgetVariableProvider = {
  id:'widgets',label:'模组',
  slots(context={}) {
    const {packs=[]} = context, active = activeWidgetKeys(context)
    return packs.flatMap(pack => pack.manifest.assets.filter(asset => asset.kind === 'widgets' && pack.widgets?.[asset.id] && (!context.modConfig || pack.widgets[asset.id].namespace !== 'phone')).flatMap(asset =>
      widgetVariableSlots({packId:pack.manifest.id,kind:'widgets',assetId:asset.id},pack.widgets[asset.id],asset.settingsDefaults).map(slot =>
        ({...slot,instanceLabel:asset.name,active:widgetIsActive(active,slot.target.ref)}))))
  },
}
export function widgetVariableProjection(variableBindings,ref,document,schema) {
  const bindings = {}, bindingSources = {}
  for (const slot of widgetVariableSlots(ref,document)) {
    const row = resolveSlot(slot,variableBindings,schema,{})
    if (row.variable) { bindings[slot.target.slot] = row.variable; bindingSources[slot.target.slot] = row.source }
  }
  return {bindings,bindingSources}
}
