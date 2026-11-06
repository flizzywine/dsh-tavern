import { taskStateFields } from './task-state-reader.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { projectAgentMessageText } from './runtime-content-projection.js'

// Candidate preparation does not need card scripts, images, old message bodies
// or checkpoint snapshots. Keep this projection separate from writable Chat.
export const candidateContextFields = Object.freeze([...taskStateFields,
  'macroState','guides','posture','backgroundTasks','backgroundModelSelection','backgroundModelRevision',
  'webSearchEnabled','scriptState','settleStatus','settleError','cardContextRevision',
  'variables','promptTemplateInput','promptTemplateInitialVariables','worldBookRandomState','openingWorldbookSnapshot',
  ...['name','description','personality','scenario','mes_example','system_prompt','post_history_instructions']
    .map(key=>'cardDefinitionSnapshot.'+key)
])

export function createCandidateContextReader({headerForSession,readWindow,readChat}) {
  async function read(id) {
    let window=await readWindow(id,{limit:32,fields:candidateContextFields})
    if (!window) return readChat(id)
    const chat=window.chat
    if (!chat.cardDefinitionSnapshot || chat.openingWorldbookSnapshot?.version !== 1 ||
      Object.values(chat.timeline?.operations || {}).some(op=>op?.kind==='body' && op.status==='foreground-completed')) return readChat(id)
    const messages=chat.messages
    let count=0
    const hasText=message=>message?.role==='assistant' && projectAgentMessageText(message,{
      charName:chat.cardDefinitionSnapshot.name,macroState:chat.macroState
    }).trim()!==''
    for (const message of messages) if(hasText(message)) count++
    // Read further only if the task actually needs older assistant text or its
    // last saved variable scope. Page against the same immutable revision.
    while(window.from>0 && (count<6 || !chat.promptTemplateInput?.message && lastTavernHelperVariables(messages)===undefined)) {
      window=await readWindow(id,{limit:32,before:window.from,revision:window.revision,fields:[]})
      for(const message of window.chat.messages) if(hasText(message))count++
      messages.unshift(...window.chat.messages)
    }
    return chat
  }
  return Object.freeze({read,async forSession(sessionId){
    const header=await headerForSession(sessionId,['id'])
    return header ? read(header.id) : undefined
  }})
}
