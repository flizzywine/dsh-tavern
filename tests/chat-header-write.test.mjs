import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'

const header = ({messages, ...head}) => structuredClone(head)
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'header-write-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const journal=createChatJournalStore({dataRoot:root})
  await journal.update('a',()=>({id:'a',sessionId:'s',_storageRevision:1,variables:{gold:1},messages:Array.from({length:20000},(_,i)=>({role:'assistant',turn:i+1,text:'history '+i,variables:[{gold:i}]}))}))
  const forbidden=()=>{throw Error('full-history read/write must not run')}
  return {journal,persistence:createChatPersistence({store:{...journal,read:forbidden,update:forbidden,readRevision:forbidden},now:()=>100})}
}

test('foreground header writes merge concurrent rows without copying or updating full history',async t=>{
  const {journal,persistence}=await fixture(t)
  const chat=await journal.read('a'),base=header(chat),first=chat.messages[0]
  chat.preparedWorldBookContext='new worldbook'
  await journal.patch('a',1,[{op:'set',path:['messages',19999,'variables',0,'gold'],value:900},{op:'set',path:['_storageRevision'],value:2}])
  const next=await persistence.writeHeader(chat,base,{source:'foreground.prepare'})
  assert.equal(chat.messages[0],first)
  assert.equal(chat.messages.length,20000)
  assert.equal(chat.messages[19999].variables[0].gold,900)
  assert.equal(next._storageRevision,3)
  assert.equal(chat._storageRevision,3)
  assert.equal(next.messages,undefined)
  const saved=await journal.readSlice('a',[19999])
  assert.equal(saved.chat.preparedWorldBookContext,'new worldbook')
  assert.equal(saved.chat.messages[0].variables[0].gold,900)
  chat.variables.gold=2
  await persistence.writeHeader(chat,next)
  assert.equal((await journal.readSlice('a',[])).chat.variables.gold,2)
})
