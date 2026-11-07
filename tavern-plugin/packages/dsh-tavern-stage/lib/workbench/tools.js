import {defineTool,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {featureFailure,featureProjection} from './projections.js'
import {WORKBENCH_ACTIONS} from './schema.js'

// Tool definitions for the workbench envelopes: a compact wire schema (shared owner/CAS
// fields factored out), validation, and a minimal corrected example on invalid input.

const object = fields => ({type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k.replace(/\?$/,''),v])),required:Object.keys(fields).filter(k=>!k.endsWith('?'))})
const bytes = value => Buffer.byteLength(JSON.stringify(value))
// Factor repeated owner/CAS fields without losing any action's required arguments.
function factor(rows) {
  if (rows.length === 1) return rows[0]
  let best
  for (const row of rows) for (const key of Object.keys(row.properties).filter(k=>!['action','operation'].includes(k))) {
    const same=(r,k)=>JSON.stringify(r.properties[k])===JSON.stringify(row.properties[k]) && r.required.includes(k)===row.required.includes(k)
    const peers=rows.filter(r=>same(r,key))
    if (peers.length<2) continue
    const keys=Object.keys(row.properties).filter(k=>!['action','operation'].includes(k) && peers.every(r=>same(r,k)))
    const rest=peers.map(r=>({...r,properties:Object.fromEntries(Object.entries(r.properties).filter(([k])=>!keys.includes(k))),required:r.required.filter(k=>!keys.includes(k))}))
    const group=object({...Object.fromEntries(keys.map(k=>[k+(row.required.includes(k)?'':'?'),row.properties[k]])),operation:{oneOf:rest}})
    const saving=bytes(peers)-bytes([group])
    if(saving>0 && (!best || saving>best.saving)) best={peers,rest,group,saving}
  }
  if(!best) return {oneOf:rows}
  best.group.properties.operation=factor(best.rest)
  const others=rows.filter(r=>!best.peers.includes(r))
  return others.length ? factor([...others,best.group]) : best.group
}
function author(schema) {
  if(schema.oneOf) return {oneOf:schema.oneOf.map(author)}
  if(!schema.type) return {type:'json'}
  const result={...schema}; delete result.required
  if(schema.properties) result.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,{...author(v),...(schema.required?.includes(k)?{required:true}:{})}]))
  if(schema.items) result.items=author(schema.items)
  return result
}
// Omit optional JSON Schema defaults on the wire; defineTool retains its closed
// compiled schema for execution validation. Required fields and enums stay intact.
function wire(value) {
  if(Array.isArray(value)) return value.map(wire)
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='additionalProperties').map(([k,v])=>[k,wire(v)]))
  return value
}
export function flattenFeatureRequest(request) {
  const {operation,...fields}=request
  return operation ? {...fields,...flattenFeatureRequest(operation)} : fields
}
export function featureRequestSchema(name) {
  return factor(WORKBENCH_ACTIONS[name].map(([actions,fields])=>object({action:{type:'string',enum:actions.split('|')},...fields})))
}
function suppliedAction(value) {
  return value?.action || (value?.operation ? suppliedAction(value.operation) : undefined)
}
function hasAction(schema,action) {
  return schema.properties?.action?.enum?.includes(action) || schema.oneOf?.some(s=>hasAction(s,action)) || (schema.properties?.operation && hasAction(schema.properties.operation,action))
}
// Diagnose one nearest branch, not every alternative in the factored wire union.
function nearest(schema,value,action) {
  if(schema.oneOf) return schema.oneOf.map(option=>nearest(option,value,action)).sort((a,b)=>
    Number(!!hasAction(b,action))-Number(!!hasAction(a,action)) || validateJsonSchemaValue(a,value).length-validateJsonSchemaValue(b,value).length)[0]
  if(schema.properties) return {...schema,properties:Object.fromEntries(Object.entries(schema.properties).map(([key,child])=>[key,nearest(child,value?.[key],action)]))}
  return schema
}
function skeleton(schema,input={},key='') {
  if(schema.const!==undefined)return schema.const
  if(schema.enum)return schema.enum.includes(input)?input:schema.enum[0]
  if(schema.type==='object') return Object.fromEntries((schema.required || []).map(k=>[k,skeleton(schema.properties[k],input?.[k],k)]))
  if(schema.type==='array')return []
  if(schema.type==='null')return null
  if(schema.type==='boolean')return false
  if(['integer','number'].includes(schema.type))return 0
  return key==='expectedRevision'?'<read revision>':'<'+(key || 'value')+'>'
}
export function featureExample(name,input) {
  const schema=nearest(featureRequestSchema(name),input,suppliedAction(input))
  const example=skeleton(schema,input)
  // Keep the requested action even when it was supplied at the wrong depth.
  const action=suppliedAction(input)
  const put=value=>{if(value.operation)put(value.operation);else if(Object.hasOwn(value,'action')&&hasAction(schema,action))value.action=action}
  put(example)
  return {request:example}
}
function fieldPath(request,key,path='$.request') {
  if(Object.hasOwn(request || {},key))return path+'.'+key
  return request?.operation ? fieldPath(request.operation,key,path+'.operation') : undefined
}
function explain(name,args,error) {
  const action=suppliedAction(args?.request),schema=nearest(featureRequestSchema(name),args?.request,action)
  const violations=validateJsonSchemaValue({type:'object',additionalProperties:false,properties:{request:schema},required:['request']},args,'$')
  const result=featureFailure(error)
  if(error.code==='INVALID_ARGS') {
    result.error.path=violations[0]?.match(/"([^"]+)"/)?.[1] || '$.request'
    result.error.message=violations.slice(0,3).join('; ')
    result.error.next='Use this minimal call; replace placeholders with values from the matching read.'
  }
  result.error.example=featureExample(name,args?.request || {})
  return result
}
export function registerWorkbenchTools({tools,host}) {
  for(const name of Object.keys(WORKBENCH_ACTIONS)) {
    const tool=defineTool({name:'tavern_'+name,description:name.replaceAll('_',' ')+'.',timeoutMs:540000,
      parameters:{request:{...author(featureRequestSchema(name)),required:true}},
      output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      isConcurrencySafe:()=>name.endsWith('_read'),
      execute:({request},exec)=>host.call(name,flattenFeatureRequest(request),exec)})
    tools.register({...tool,parameters:wire(tool.parameters),async execute(args,exec) {
      let result
      try {result=await tool.execute(args,exec)} catch(error) {
        if(error.code!=='INVALID_ARGS')throw error
        return explain(name,args,error)
      }
      if(result?.ok===false && ['INVALID_INPUT','UNKNOWN_FIELD','INVALID_ARGS'].includes(result.error.code)) {
        result.error.example=featureExample(name,args.request)
        const input=flattenFeatureRequest(args.request),path=result.error.path
        const ownerItem=path.match(/^\$\.assets\[\d+\](.*)$/)
        const field=path.match(/^\$\.([^.[/]+)(.*)$/)
        if(ownerItem && input.item)result.error.path=fieldPath(args.request,'item')+ownerItem[1]
        else if(field && fieldPath(args.request,field[1]))result.error.path=fieldPath(args.request,field[1])+field[2]
        if(input.item?.kind)result.error.next='Read tavern_assets_read schema for kind '+input.item.kind+'; use its author fields and example, then retry this envelope.'
      }
      return featureProjection(result)
    }})
  }
}
