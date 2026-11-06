import {isDeepStrictEqual} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {resolveVariable} from '../variable-bindings/index.js'
import {prepareWidgetVariableOperations,auditWidgetVariableResult} from '../widget-variables.js'
import {assertModCurrent,modBoundary} from './permissions.js'
const {modCheck:check,modShape:shape,modJson,modFreeze} = contract

// readTurn is revision-pinned. execute returns an isolated MVU effect without saving.
// commit MUST compare revision/source/full baseline and publish through Story Timeline atomically.
export function createModVariables({manifest,context,current,readTurn,execute,commit,receipt}) {
  const declarations=Object.fromEntries(['reads','writes'].map(mode=>[mode,Object.fromEntries((manifest.permissions.variables?.[mode] || []).map(({id,...row})=>[id,row.slot?context.variableBindings?.[id]:row]))]))
  const snapshots=new Map()
  const sourceCurrent=turn=>turn.textVersion===context.source.textVersion && isDeepStrictEqual(turn.source,context.source)
  const remember=(map,key,value,max)=>{map.set(key,value);while(map.size>max)map.delete(map.keys().next().value);return value}
  async function read(input) {
    modJson(input);shape(input,['turn'],[])
    check(input.turn===undefined || Number.isSafeInteger(input.turn) && input.turn>=1 && input.turn<=context.turn,'$.turn','Cannot read a future turn','MOD_PERMISSION_DENIED')
    assertModCurrent(context,current)
    const turn=await readTurn(context,input.turn)
    assertModCurrent(context,current)
    check(turn && typeof turn.revision==='string','$.turn','Turn snapshot unavailable','MOD_RESOURCE_UNAVAILABLE')
    const frozen=modFreeze(structuredClone(turn))
    remember(snapshots,turn.revision,frozen,20)
    const values=Object.fromEntries(Object.entries(declarations.reads).map(([readId,declaration])=>[readId,declaration?resolveVariable(declaration,turn.sources):{status:'unavailable'}]))
    return {turn:turn.turn,textVersion:turn.textVersion,revision:turn.revision,snapshotKind:turn.snapshotKind,state:turn.sources.mvu?.available?structuredClone(turn.sources.mvu.value):null,values}
  }
  async function apply(input) {
    const {operationId,baseRevision,textVersion}=input
    const before=snapshots.get(baseRevision)
    assertModCurrent(context,current)
    check(before && before.turn===context.turn && before.writable===true && sourceCurrent(before),'$.baseRevision','A current writable turn snapshot is required','MOD_SOURCE_STALE')
    check(textVersion===before.textVersion,'$.textVersion','Text has changed','MOD_SOURCE_STALE')
    const fresh=await readTurn(context,context.turn)
    assertModCurrent(context,current)
    check(fresh?.revision===baseRevision && fresh.turn===context.turn && fresh.writable===true && sourceCurrent(fresh),'$.baseRevision','Variable baseline changed','MOD_REVISION_CONFLICT')
    modJson(before.sources,1024*1024);modJson(fresh.sources,1024*1024)
    check(isDeepStrictEqual(fresh.sources,before.sources),'$.baseRevision','Variable baseline changed','MOD_REVISION_CONFLICT')
    let prepared,result
    try {
      prepared=prepareWidgetVariableOperations(declarations,before.sources.mvu.value,input.operations)
      result=await execute({context,before,declarations,operations:structuredClone(input.operations),normalized:prepared.operations,request:input})
      assertModCurrent(context,current)
      check(result && result.after && result.effect,'$.effect','MVU executor did not produce a complete effect','MOD_RUNTIME_FAILED')
      auditWidgetVariableResult(declarations,before.sources.mvu.value,result.after,prepared.expected)
    } catch(error) {
      if(error.code==='WIDGET_VARIABLE_REJECTED')check(false,'$.operations','Variable operation exceeds the granted write set','MOD_PERMISSION_DENIED')
      throw error
    }
    const saved=await commit({context,operationId,baseRevision,textVersion,before,effect:result.effect,after:result.after,request:input,assertCurrent:()=>assertModCurrent(context,current)})
    check(saved && typeof saved.revision==='string','$.baseRevision','Variable commit lost its baseline','MOD_REVISION_CONFLICT')
    return saved
  }
  function patch(input) {
    return modBoundary(async()=>{
      modJson(input,16384);shape(input,['operationId','baseRevision','textVersion','operations'])
      check(typeof input.operationId==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.operationId),'$.operationId')
      assertModCurrent(context,current)
      const request=modFreeze(structuredClone(input)),previous=await receipt({context,request})
      assertModCurrent(context,current)
      if(previous)return previous
      return apply(request)
    })
  }
  return Object.freeze({getTurn:input=>modBoundary(()=>read(input)),patch,
    setVariables:input=>modBoundary(async()=>{
      modJson(input,16384);shape(input,['operationId','baseRevision','textVersion','values'])
      shape(input.values,Object.keys(declarations.writes),[])
      const result=await patch({operationId:input.operationId,baseRevision:input.baseRevision,textVersion:input.textVersion,operations:Object.entries(input.values).map(([writeId,value])=>({writeId,op:'replace',value}))})
      if(!result.ok)throw Object.assign(new Error(result.error.message),result.error)
      return result.value
    })})
}
