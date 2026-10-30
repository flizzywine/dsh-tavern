import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {assertModCurrent, assertModPermission, modBoundary} from './permissions.js'
const {modCheck:check, modShape:shape, modJson} = contract

export function createModJudge({engineJudge,manifest,context,current,timeoutMs=1500}) {
  return input=>modBoundary(async()=>{
    assertModCurrent(context,current)
    assertModPermission(manifest,'judge')
    modJson(input)
    shape(input,['purpose','material','questions'])
    check(typeof input.purpose==='string' && input.purpose.length<=160,'$.purpose')
    check(typeof input.material==='string' && Array.isArray(input.questions) && input.questions.length<=300,'$.questions')
    const ids=new Set()
    for (const question of input.questions) {
      shape(question,['id','text'])
      check(typeof question.id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(question.id) && !['__proto__','constructor','prototype'].includes(question.id) && !ids.has(question.id) && typeof question.text==='string' && question.text.length>0 && question.text.length<=2000,'$.questions')
      ids.add(question.id)
    }
    let timer,result
    try {
      // EngineJudge owns providers, batching and credentials. Purpose is host-owned, not model material.
      const request={sessionId:context.gameId,purpose:'mod:'+manifest.id+':'+input.purpose,material:input.material,questions:structuredClone(input.questions)}
      result=await Promise.race([Promise.resolve().then(()=>engineJudge.judge(request)).catch(()=>null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)})])
    } finally {clearTimeout(timer)}
    assertModCurrent(context,current)
    if (!(result instanceof Map) || result.size!==ids.size || [...ids].some(id=>!result.has(id) || typeof result.get(id)!=='number' || !Number.isFinite(result.get(id)) || result.get(id)<0 || result.get(id)>1)) return {probabilities:null}
    return {probabilities:Object.fromEntries(result)}
  })
}
