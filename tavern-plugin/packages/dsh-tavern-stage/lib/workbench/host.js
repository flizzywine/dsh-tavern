import {createWorkbenchFiles} from './files.js'
import {featureError,assertFeatureInput,featureProjection,featureFailure} from './projections.js'
import {runWorkbenchAction} from './actions.js'

// Runs one workbench tool call: card-workbench sessions only, secret-free input,
// user approval before any change that reaches beyond the current card.
const globalAssets=new Set(['global-packs','catalogue-settings'])
const localVoice=new Set(['assign-figure','binding','pack-voice','assign-template'])
export function createWorkbenchHost({chatForSession,getLibrary,getPackSettings,getTtsControl,rpc,approval,readChat,cardIdentity}) {
  const plans=new Map()
  const callRpc=async(method,args)=>{
    const value=await rpc(method,args)
    if(value?.ok===false) throw Object.assign(new Error(value.error?.code),value.error)
    return value?.ok===true?value.data:value
  }
  async function approve(exec,name,reason) {
    if(reason.length>16000) throw featureError('LIMIT_EXCEEDED','$','Review a smaller change before approval.')
    const signal=AbortSignal.any([...(exec.signal?[exec.signal]:[]),AbortSignal.timeout(120000)])
    const service=approval()
    const policy=service?.effectivePolicy?.(exec.agent.session)
    const approvalError=(code,message,reason)=>Object.assign(featureError(code,'$',policy==='never'?'会话审批策略为 never；请由用户切换为可询问审批的权限预设后重新发起。':'请在当前会话的审批界面处理请求；未获批准前不会写入。'),{message,reason})
    if(!service?.request) throw approvalError('APPROVAL_REQUIRED','等待用户批准：审批通道不可用，未更改。','approval-unavailable')
    const result=await service.request({agent:exec.agent,toolName:'tavern_'+name,callId:exec.callId,reason:'等待用户批准；批准前不会更改。\n'+reason,signal})
    if(result!=='allowed-once') throw result==='rejected'
      ? approvalError('APPROVAL_REJECTED',policy==='never'?'会话策略自动拒绝，未更改；没有弹出用户审批。':'用户拒绝，未更改。',policy==='never'?'policy-rejected':'user-rejected')
      : approvalError(result==='cancelled'?'APPROVAL_CANCELLED':'APPROVAL_REQUIRED',result==='cancelled'?'审批已取消或超时，未更改。':'等待用户批准：审批通道不可用，未更改。',result==='cancelled'?'cancelled':'approval-unavailable')
    signal.throwIfAborted()
  }
  async function shared(input,chat) {
    if(!input.packId) return false
    if(getPackSettings()?.read().values.globalEnabledPackIds?.includes(input.packId)) return true
    const dependencies=await callRpc('getAssetPackDependencies',{packId:input.packId})
    const cards=dependencies.cards || dependencies.references || []
    return dependencies.available===false || cards.some(c=>(c.path || c.cardPath)!==chat.cardPath) || (dependencies.count ?? cards.length)>1
  }
  async function scope(name,input,chat) {
    if(name==='stage_patch') return input.action==='card'?'card':input.action==='judge-test'?'paid':'global'
    if(name==='voice_patch') return input.action==='test-service'?'paid':localVoice.has(input.action)?(await shared(input,chat)?'shared':'card'):'global'
    if(name==='mods_patch') return ['config','clear-config'].includes(input.action)&&input.layer==='card'?'card':'global'
    if(name==='assets_patch') return globalAssets.has(input.action)?'global':input.action==='bind'?'card':await shared({...input,packId:input.packId || input.target?.packId},chat)?'shared':input.action.startsWith('remove-')?'delete':'card'
    if(name==='media_upload') return input.action==='mod-file'&&input.layer==='global'?'global':await shared(input,chat)?'shared':'card'
    if(name==='assets_transfer'&&input.action.startsWith('apply-')) return 'import'
    return 'read'
  }
  return {
    async call(name,request,exec) {
      try {
        const input=structuredClone(request)
        assertFeatureInput(input)
        const session=exec?.agent?.session,chat=session&&await chatForSession(session.id)
        if(chat?.mode!=='card') throw featureError('CARD_MODE_REQUIRED','$','Use a card workbench session.')
        exec.signal?.throwIfAborted()
        const library=getLibrary(),files=createWorkbenchFiles(session.header?.cwd)
        const context={input,chat,exec,library,files,plans,sessionId:session.id,rpc:callRpc,packSettings:getPackSettings(),tts:getTtsControl(),
          async path(value){
            const path=value || chat.cardPath
            if(!path) throw featureError('SOURCE_UNAVAILABLE','$.path','Supply path for the target card, or attach a card to this workbench first.')
            return path
          },
          async cardId(){return cardIdentity(chat.cardPath)},
          async play(ref){
            const item=chat.workspace?.mountedResources?.find(r=>r.kind==='play-chat' && (r.ref===ref || r.path===ref))
            if(!item) throw featureError('SOURCE_UNAVAILABLE','$.playRef','Attach this play chat to the workbench first.')
            const value=await readChat(item.chatId || ref.slice('play-chat:'.length))
            if(!value?.sessionId) throw featureError('SOURCE_UNAVAILABLE','$.playRef')
            return value.sessionId
          },
          async snapshot(packId=input.packId) {
            if(!library) throw featureError('ASSET_UNAVAILABLE','$.packId')
            const snapshot=await library.getPackSnapshot({packId})
            if(!snapshot || snapshot.privateConfig) throw featureError('ASSET_UNAVAILABLE','$.packId')
            return snapshot
          },
          async confirm(reason){await approve(exec,name,reason)}
        }
        const kind=await scope(name,input,chat)
        if(!['card','read'].includes(kind)) {
          const prefix={global:'这是全局设置，影响所有卡片，不只当前卡。',shared:'影响所有引用此共享素材的卡；全局启用包也会影响所有卡片。',paid:'一次测试请求，当前渠道可能收费；失败、超时或取消不保证免费。',delete:'将删除所选素材，已有引用可能不可用。',import:'将应用这次导入决策，可能影响所有引用共享素材的卡；脚本与声音回退风险须一并复核。'}[kind]
          await approve(exec,name,prefix+'\n'+JSON.stringify({tool:name,...featureProjection(input)}))
          context.approved=true
        }
        exec.signal?.throwIfAborted()
        const result=await runWorkbenchAction(name,context)
        return {ok:true,data:featureProjection(result)}
      } catch(error) {return featureFailure(error)}
    },
    dispose(){plans.clear()}
  }
}
