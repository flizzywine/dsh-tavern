import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createWorkbenchHost} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/host.js'
import {registerWorkbenchTools} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/tools.js'
import {WORKBENCH_SKILLS} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/schema.js'
import {createScriptContinuity} from '../tavern-plugin/lib/domain/script-continuity.js'
import {createCardScripts} from '../tavern-plugin/lib/card-scripts.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {requestFor} from './fixtures/workbench-features.mjs'

// tavern_script_manage is a stage workbench tool, unlocked by script-play; it goes to the core's script owners (deps).
test('the stage script tool reads, imports, binds and mutes through the core script owners, approving play changes', async t => {
  const root=await mkdtemp(join(tmpdir(),'dsh-script-manage-')),workspace=join(root,'workspace')
  t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(workspace)
  await writeFile(join(workspace,'novel.txt'),'第一章')
  assert.deepEqual(WORKBENCH_SKILLS['script-play'],['tavern_script_manage'])
  const script={path:'resources/materials/novel.txt',title:'小说',chunkSize:500,sourceChars:30,chunks:['开端','雨夜','重逢','离别'].map((text,order)=>({id:'c'+order,order,text}))}
  const calls=[],approvals=[]
  const cardScripts=createCardScripts({profileData:createProfileDataStore({dataRoot:join(root,'data')}),cardIdFor:async()=>'card-1'})
  const core={scriptContinuity:createScriptContinuity(),cardScripts,resolveCardId:async()=>'card-1',
    readScript:async path=>path==='cards/a.json'?script:undefined,
    importScript:async(...args)=>{calls.push(['import',...args]);return {path:'resources/materials/novel.txt'}},
    bindScript:async(...args)=>{calls.push(['bind',...args]);return {path:args[1]}},
    deleteScript:async(...args)=>{calls.push(['unbind',...args]);return {ok:true}},
    readCardExtensions:async()=>({helperScripts:[{id:'bgm',name:'BGM',type:'script',content:'new Audio("a.mp3")'}]}),
    scriptNavigation:{browse:async(...args)=>{calls.push(['browse',...args]);return {cursor:0}},point:async(...args)=>{calls.push(['point',...args]);return {cursor:2}}}}
  const chat={id:'editor',mode:'card',cardPath:'cards/a.json',cardName:'A',workspace:{mountedResources:[{kind:'play-chat',ref:'play-chat:p1',chatId:'p1'}]}}
  const host=createWorkbenchHost({chatForSession:async()=>chat,readChat:async()=>({sessionId:'play-session'}),getLibrary:()=>null,getPackSettings:()=>null,getTtsControl:()=>null,
    rpc:async method=>{throw new Error('no stage request expected: '+method)},cardIdentity:async()=>'card-1',core,
    approval:()=>({effectivePolicy:()=>'ask',async request(input){approvals.push(input);return 'allowed-once'}})})
  const tools=new Map();registerWorkbenchTools({tools:{register:tool=>tools.set(tool.name,tool)},host})
  const exec={callId:'c',agent:{session:{id:'editor-session',header:{cwd:workspace}}}}
  const call=async input=>{const result=await tools.get('tavern_script_manage').execute(requestFor('script_manage',input),exec);assert.equal(result.ok,true,JSON.stringify(result));return result.data}

  assert.deepEqual(await call({action:'info'}),{script:{title:'小说',sourceChars:30,chunkSize:500,chunkCount:4,importedAt:0,path:'resources/materials/novel.txt'}})
  assert.deepEqual(await call({action:'info',path:'cards/b.json'}),{script:null})
  const read=await call({action:'read',query:'重逢',limit:1})
  assert.deepEqual(read,{title:'小说',total:4,from:3,to:3,chunks:[{id:'c2',number:3,text:'重逢'}]})
  await call({action:'import',file:'novel.txt',title:'小说'})
  assert.deepEqual(calls.at(-1),['import','cards/a.json',{name:'小说',text:'第一章'}])
  await call({action:'bind',path:'resources/materials/novel.txt'})
  assert.deepEqual(calls.at(-1),['bind','cards/a.json','resources/materials/novel.txt'])
  assert.equal(approvals.length,0)

  const helpers=await call({action:'helpers'})
  assert.deepEqual(helpers.scripts.map(row=>[row.id,row.muted,row.audio]),[['bgm',false,true]])
  assert.deepEqual((await call({action:'mute',id:'bgm',muted:true})).scripts.map(row=>row.muted),[true])
  const unknown=await tools.get('tavern_script_manage').execute(requestFor('script_manage',{action:'mute',id:'nope',muted:true}),exec)
  assert.equal(unknown.error.path,'$.request.id')

  await call({action:'browse',playRef:'play-chat:p1',position:2})
  assert.deepEqual(calls.at(-1),['browse','play-session',2])
  assert.equal(approvals.length,0)
  await call({action:'point',playRef:'play-chat:p1',position:3,revision:'r1',cardPath:'cards/a.json',scriptVersion:'v1'})
  assert.deepEqual(calls.at(-1),['point','play-session',{position:3,revision:'r1',cardPath:'cards/a.json',scriptVersion:'v1',sessionId:'play-session'}])
  await call({action:'unbind'})
  assert.deepEqual(calls.at(-1),['unbind','cards/a.json'])
  assert.equal(approvals.length,2)
  assert.match(approvals[0].reason,/剧本定位/)
  host.dispose()
})
