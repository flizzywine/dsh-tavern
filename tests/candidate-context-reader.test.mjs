import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCandidateContextReader} from '../tavern-plugin/lib/domain/candidate-context-reader.js'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'

test('native candidate projection leaves large card scripts and historic bodies unread',async t=>{
 const root=await mkdtemp(join(tmpdir(),'candidate-context-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const p=createChatPersistence({store:createChatJournalStore({dataRoot:root,newConversations:true})})
 await p.write({id:'c',sessionId:'s',mode:'story',backgroundConfigVersion:1,conversationFeaturesVersion:1,
  cardDefinitionSnapshot:{name:'Test',description:'setting',extensions:{script:'x'.repeat(4*1024*1024)}},
  openingWorldbookSnapshot:{version:1,document:null},
  messages:Array.from({length:150},(_,i)=>({role:'assistant',text:i<110?'old'.repeat(10000):'recent '+i,variables:[{hp:i}]}))})
 const windows=[]
 const reader=createCandidateContextReader({headerForSession:async()=>({id:'c'}),readChat:async()=>{throw Error('full Chat read')},readWindow:async(id,options)=>{windows.push(options);return p.readWindow(id,options)}})
 const chat=await reader.forSession('s')
 assert.equal(windows.length,1)
 assert.equal(chat.messages.length,32)
 assert.equal(chat.messages.at(-1).text,'recent 149')
 assert.deepEqual(chat.cardDefinitionSnapshot,{name:'Test',description:'setting'})
 chat.messages.at(-1).text='changed'
 assert.equal((await reader.read('c')).messages.at(-1).text,'recent 149')
 assert.equal((await p.read('c')).messages.length,150)
})

test('worldbook prewarm reads only the latest assistant identity even when the save has no variable snapshots', async t => {
 const root = await mkdtemp(join(tmpdir(), 'candidate-worldbook-context-'))
 t.after(() => rm(root, { recursive: true, force: true }))
 const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
 await persistence.write({
  id: 'game', sessionId: 's', mode: 'story', cardPath: 'cards/test.json',
  cardDefinitionSnapshot: { name: 'Test' }, openingWorldbookSnapshot: { version: 1, document: null },
  messages: Array.from({ length: 512 }, (_, turn) => ({ role: turn === 511 ? 'user' : 'assistant', turn, text: 'story ' + turn }))
 })
 const windows = []
 const reader = createCandidateContextReader({
  headerForSession: async () => ({ id: 'game' }),
  readChat: async () => assert.fail('worldbook prewarm should not read a whole Chat'),
  readWindow: (id, options) => { windows.push(options); return persistence.readWindow(id, options) }
 })
 const chat = await reader.worldbookForSession('s')
 assert.equal(windows.length, 1)
 assert.equal(windows[0].limit, 32)
 assert.deepEqual(windows[0].messageFields, ['role', 'turn'])
 assert.deepEqual(chat.messages, [{ role: 'assistant', turn: 510 }])
})
