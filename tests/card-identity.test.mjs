import test from 'node:test'
import assert from 'node:assert/strict'
import {createCardStorage} from '../tavern-plugin/lib/card-storage.js'
import {createCardScripts} from '../tavern-plugin/lib/card-scripts.js'
import {createCardHandlers} from '../tavern-plugin/lib/rpc/cards.js'

test('card script preferences retain their identity and storage without any stage service',async()=>{
  const values=new Map([['resources/cards/test.json',{meta:{id:'existing-card'}}]])
  const profileData={readJson:async key=>values.get(key),updateJson:async(key,update)=>{const next=update(values.get(key));values.set(key,next);return next}}
  const storage=createCardStorage({dataRoot:'/unused',profileData})
  const scripts=createCardScripts({profileData,cardIdFor:storage.resolve})
  const handlers=createCardHandlers({cardScripts:scripts,resolveCardId:storage.resolve,
    chatForSession:async()=>({cardPath:'cards/test.json',cardName:'Test'}),
    readCardExtensions:async()=>({helperScripts:[{id:'audio',type:'script',content:'new Audio()'}]}),str:String})
  const result=await handlers.setCardScriptMuted({sessionId:'game',id:'audio',muted:true},'setCardScriptMuted')
  assert.equal(result.cardId,'existing-card');assert.equal(result.scripts[0].muted,true)
  assert.deepEqual(values.get('card-scripts/existing-card.json'),{version:1,muted:['audio']})
})

test('card identity validates paths before storage access and never invents missing IDs',async()=>{
  let reads=0
  const storage=createCardStorage({dataRoot:'/unused',profileData:{readJson:async()=>{reads++;return {meta:{id:'invalid/id'}}}}})
  for(const path of ['cards/../secret','cards/a\\b','cards//a','other/a','cards/a:b']) await assert.rejects(storage.resolve(path),/Invalid card path/)
  assert.equal(reads,0)
  await assert.rejects(storage.resolve('cards/valid.json'),/Card has no identity/)
  assert.equal(reads,1)
})
