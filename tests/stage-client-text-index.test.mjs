import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageTextIndexModule}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/text-index.cjs')
const pages=require('../tavern-plugin/src/client/stage-page-index.cjs')
const module=createStageTextIndexModule({pageCards:pages.stagePageCards,character:()=>({alias:'a'})})
test('plugin index reconciles host history and retains canonical narration anchors and voice identity',()=>{
 const index=module.createIndex({paginate:pages.stageBlockPages,storyTurn:(_,turn)=>turn,superseded:()=>false,projectionForTurn:(view,turn)=>view.replyProjections.find(row=>row.turn===turn)})
 const body={paragraphs:[{kind:'line',paragraphId:'p1',para:1,text:'hello',segment:{alias:'a',text:'hello'}},{kind:'narration',paragraphId:'p2',para:2,text:'narration'}]}
 const view={replyProjections:[{turn:1,body}]}
 const first=index.reconcile({view,branchId:'a'}),row=first.get(1)
 assert.equal(row.text.pages.length,2);assert.deepEqual(row.text.pages[0].voice.lineIdentity,[1,0]);assert.deepEqual(row.text.pages[1].voice.lineIdentity,[1,1,0])
 assert.deepEqual(row.text.pages[1].anchor,{paragraphId:'p2',para:2,offset:0})
 assert.equal(index.reconcile({view,branchId:'a'}).get(1),row)
 assert.notEqual(index.reconcile({view,branchId:'b'}).get(1),row)
 index.clear();assert.equal(index.getSnapshot().size,0)
})
test('unloaded history becomes readable through the same index without creating a second cursor',()=>{
 const index=module.createIndex({paginate:pages.stageBlockPages,storyTurn:(_,turn)=>turn,superseded:()=>false,projectionForTurn:()=>null})
 index.reconcile({view:{replyProjections:[{turn:2}]},branchId:'a'})
 assert.equal(index.getSnapshot().get(2).unloaded,true)
 const row=index.ingest(2,{paragraphs:[{kind:'narration',para:1,paragraphId:'p',text:'loaded history'}]})
 assert.equal(row.unloaded,false);assert.equal(row.text.pages[0].text,'loaded history');assert.equal(index.getSnapshot().get(2),row)
})
