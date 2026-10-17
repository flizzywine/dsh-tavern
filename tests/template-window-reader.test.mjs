import test from 'node:test'
import assert from 'node:assert/strict'

import { createTemplateWindowReader } from '../tavern-plugin/lib/domain/template-window-reader.js'

const rows = count => Array.from({ length: count }, (_, i) => ({ role: 'assistant', text: 'r' + i }))
function store(messageCount) {
  const calls = []
  return { calls, readWindow: async (_id, { limit, before = messageCount, revision, requirePartial }) => {
    calls.push({ limit, before, revision })
    const from = Math.max(0, before - limit)
    if (requirePartial && from === 0) return null
    return { chat: { sessionId: 's', backgroundConfigVersion: 1, conversationFeaturesVersion: 1, promptTemplateInput: { message: {} }, messages: rows(messageCount).slice(from, before) },
      from, to: before - 1, messageCount, revision: 9 }
  } }
}

test('long history retains its bounded window and virtual input count',async()=>{
 let issued
 const h=store(250)
 const read=createTemplateWindowReader({links:async()=>({s:'chat'}),access:{issue:value=>(issued=value,{token:'lease'})},readWindow:h.readWindow})
 assert.deepEqual((await read('s')).historyWindow,{token:'lease',from:50,messageCount:251})
 assert.equal(issued.messageCount,250)
})
