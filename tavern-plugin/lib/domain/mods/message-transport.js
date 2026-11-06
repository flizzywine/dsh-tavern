import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modJson,modFreeze,modResultError}=contract

// The host supplies authorized methods and its source/authority lease, never identities from args.
export function createModMessageTransport({context,token,current,methods}) {
  modJson(context)
  shape(context,['modId','sessionId','branchId','revision','sourceKey','generation','textVersion','authorityEpoch','settledTurn','mode'])
  for(const key of ['modId','sessionId','branchId','revision','sourceKey','textVersion'])check(typeof context[key]==='string','$.context.'+key)
  for(const key of ['generation','authorityEpoch','settledTurn'])check(Number.isSafeInteger(context[key]) && context[key]>=0,'$.context.'+key)
  check(['live','history'].includes(context.mode),'$.context.mode')
  const bound=modFreeze(structuredClone(context))
  let live=true
  const isCurrent=()=>live && current(bound)
  const assertCurrent=()=>check(isCurrent(),'$.context','Mod authority or source is no longer current','MOD_SOURCE_STALE')
  return Object.freeze({
    async dispatch(request) {
      const requestId=typeof request?.requestId==='string'?request.requestId:''
      let result
      try {
        modJson(request)
        shape(request,['channel','version','token','requestId','method','args'])
        check(request.channel==='dsh-mod' && request.version===2,'$.version','Unsupported mod message')
        check(typeof request.requestId==='string' && request.requestId.length>0,'$.requestId','Request identity required')
        check(request.token===token,'$.token','Mod instance token is not authorized','MOD_PERMISSION_DENIED')
        shape(request.args,Object.keys(request.args || {}),[],'$.args')
        check(!['modId','sessionId','gameId','cardId','context','token'].some(key=>Object.hasOwn(request.args,key)),
          '$.args','Host identity cannot be supplied by the mod','MOD_PERMISSION_DENIED')
        check(typeof request.method==='string' && Object.hasOwn(methods,request.method) && typeof methods[request.method]==='function',
          '$.method','Mod capability is not granted','MOD_PERMISSION_DENIED')
        assertCurrent()
        const value=await methods[request.method](modFreeze(structuredClone(request.args)),{context:bound,isCurrent})
        assertCurrent()
        modJson(value ?? null)
        result={ok:true,value:structuredClone(value ?? null)}
      } catch(error) {result=modResultError(error)}
      return modFreeze({channel:'dsh-mod',version:2,requestId,result})
    },
    revoke(){live=false},
  })
}
