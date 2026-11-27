import { copyJsonTree } from './copy-json-tree.js'

const versionFields = ['id', 'sessionId', 'mode', 'requestMode', '_storageRevision', 'settleStatus', 'regenInProgress',
  'cardDefinitionSnapshot.name', 'openingWorldbookSnapshot.version']

// Candidate commands do not change the template environment. Everything else
// invalidates conservatively; an unobserved storage revision always misses.
const commandOnly = source => /^candidate\.mailbox\.|^background\.candidate\.(begin|bind|commit)$/.test(source || '')
export function createCandidateWorldbookPreparation({
  readHeader, readCandidateChat, readCard, resourceVersion, projectPrefix, onError, capacity = 8, maxBytes = 16 * 1024 * 1024
}) {
  async function version(sessionId) {
    const [chat, globals, settings] = await Promise.all([
      readHeader(sessionId, versionFields),
      resourceVersion('prompt-template-variables.json'),
      resourceVersion('tavern-extension-settings.json')
    ])
    if (!chat || !['story', 'script'].includes(chat.mode) || chat.requestMode === 'sillytavern' || chat.regenInProgress ||
        ['pending', 'running'].includes(chat.settleStatus) || !chat.cardDefinitionSnapshot || chat.openingWorldbookSnapshot?.version !== 1) return null
    // Switching models does not change the prepared worldbook prefix.
    return { revision: chat._storageRevision, resources: JSON.stringify([globals, settings]) }
  }

  async function prepare(sessionId) {
    const chat = await readCandidateChat(sessionId)
    if (!chat) throw Error('当前会话没有绑定人物卡')
    const result = await projectPrefix(chat, await readCard(chat))
    // Keep a transient projection failure distinct from an empty worldbook.
    if (result.diagnostics?.some(item => ['worldbook-read-failed', 'projection-failed'].includes(item.code))) {
      throw Error('候选世界书准备失败，请查看模板诊断')
    }
    return result
  }

  const entries=new Map()
  let disposed=false,bytes=0
  function remove(id){const entry=entries.get(id);if(entry){bytes-=entry.bytes||0;entries.delete(id)}}
  async function load(id,warming=false){
    if(disposed)throw Error('候选上下文准备已停止')
    const current=await version(id)
    // Legacy/live-resource chats retain their existing fresh evaluation path.
    if(!current)return warming?undefined:prepare(id)
    let entry=entries.get(id)
    if(entry && (entry.revision!==current.revision || entry.resources!==current.resources)){remove(id);entry=null}
    if(!entry){
      entry={revision:current.revision,resources:current.resources,bytes:0}
      entries.set(id,entry)
      entry.promise=(async()=>{
        const result=await prepare(id)
        const after=await version(id)
        if(disposed || entries.get(id)!==entry || !after || after.revision!==entry.revision || after.resources!==entry.resources)
          throw Object.assign(Error('准备候选上下文期间游戏状态已变化，请重新生成'),{code:'CANDIDATE_CONTEXT_CHANGED'})
        const size=JSON.stringify(result).length*2
        if(size>maxBytes || result.diagnostics?.length)remove(id)
        else {
          entry.bytes=size;bytes+=size
          for(const key of entries.keys()){
            if(entries.size<=capacity && bytes<=maxBytes)break
            if(key!==id)remove(key)
          }
        }
        return copyJsonTree(result)
      })().catch(error=>{if(entries.get(id)===entry)remove(id);throw error})
    }else{entries.delete(id);entries.set(id,entry)}
    return copyJsonTree(await entry.promise)
  }
  return Object.freeze({
    get:id=>load(id),
    async warm(id){try{return await load(id,true)}catch(error){if(!disposed && error.code!=='CANDIDATE_CONTEXT_CHANGED')onError?.(error)}},
    changed(chat,metadata){
      const entry=entries.get(chat?.sessionId)
      if(!entry)return
      // Script UIs may repeatedly save identical variables. The journal's
      // unchanged revision proves that no template input was committed.
      if(chat._storageRevision===entry.revision)return
      if(commandOnly(metadata?.source) && chat._storageRevision===entry.revision+1)entry.revision=chat._storageRevision
      else remove(chat.sessionId)
    },
    dispose(){disposed=true;entries.clear();bytes=0}
  })
}
