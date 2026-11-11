import test from 'node:test'
import assert from 'node:assert/strict'
import {assertSupportedJsonSchema} from '@deepseek-ai/dsh-tools'
import {workbenchFixture,requestFor} from './fixtures/workbench-features.mjs'
import {registerStageWorkbench} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/index.js'
import {WORKBENCH_SKILLS,WORKBENCH_TOOL_NAMES} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/schema.js'
import {createSkillGatedTools} from '../tavern-plugin/lib/domain/skill-gated-tools.js'

test('the stage registers its workbench tools for the card workbench only, each behind its Skills, and removes them with the stage',async ()=>{
  const registered=new Map(),modes=new Map(),skills=new Map(),owners=new Set()
  const services={tools:{register(tool){registered.set(tool.name,tool);return ()=>registered.delete(tool.name)}},
    // Like the Cordis service proxy: writes are refused, and a method called on the proxy gets the caller's ctx as this.
    tavern:new Proxy({toolModes({name,modes:value}){owners.add(this.ctx.fiber.name);modes.set(name,value);return ()=>modes.delete(name)},
      toolSkills({name,skills:value}){owners.add(this.ctx.fiber.name);skills.set(name,value);return ()=>skills.delete(name)}},{set:()=>false,
      get:(target,prop,receiver)=>new Proxy(target[prop],{apply:(method,self,args)=>Reflect.apply(method,self===receiver?{ctx:{fiber:{name:'dsh-tavern'}}}:self,args)})})}
  const dispose=registerStageWorkbench({ctx:{get:name=>services[name]},deps:{},call:async()=>{throw new Error('no request expected')}})
  assert.deepEqual([...owners],['dsh-tavern-stage'])
  const names=[...registered.keys()]
  assert.deepEqual(names.toSorted(),WORKBENCH_TOOL_NAMES.toSorted())
  for(const name of names) {assert.deepEqual(modes.get(name),['card']);assertSupportedJsonSchema(registered.get(name).parameters)}
  // Compiled schemas stay small: at most 10 KiB per Skill, 25 KiB together, nothing before a Skill loads.
  // stage-assets is the one 素材库 Skill (packs, figures, voice, generation, transfer): its tasks share one
  // entry and its references load on demand, so it carries all seven asset tools (about 15 KiB) under 16 KiB.
  const skillLimit=skill=>skill==='stage-assets'?16*1024:10*1024
  const size=name=>{const {description,parameters}=registered.get(name);return Buffer.byteLength(JSON.stringify({name,description,parameters}))+1}
  const visible=createSkillGatedTools({pluginSkills:name=>skills.get(name) || null})
  assert.deepEqual(visible(names,{id:'empty',events:[]}),[])
  for(const [skill,tools] of Object.entries(WORKBENCH_SKILLS)) {
    const bytes=tools.reduce((sum,name)=>sum+size(name),0)
    assert.ok(bytes<=skillLimit(skill),skill+': '+bytes)
    assert.deepEqual(visible(names,{id:skill,events:[{type:'tool/result',data:{content:'<skill_content name="'+skill+'">'}}]}).toSorted(),tools.toSorted())
  }
  const all=names.reduce((sum,name)=>sum+size(name),0)
  assert.ok(all<=25*1024,String(all))
  await dispose()
  assert.equal(registered.size+modes.size+skills.size,0)
})

test('mod config writes go to the stage mod owner: the card layer directly, the global layer only after approval',async t=>{
  const f=await workbenchFixture({rpc:async(method,args)=>method==='setModConfig'?{revision:'next',layer:args.layer}:undefined});t.after(()=>f.close())
  const input={action:'config',modId:'dsh.phone',expectedRevision:'current',key:'theme',value:{}}
  const card=await f.invoke('mods_patch',{...input,layer:'card'})
  assert.equal(card.ok,true,JSON.stringify(card))
  assert.deepEqual(f.calls.at(-1),{method:'setModConfig',args:{modId:'dsh.phone',expectedRevision:'current',key:'theme',layer:'card',value:{},cardId:'fixture'}})
  assert.equal(f.approvals.length,0)
  assert.equal((await f.invoke('mods_patch',{...input,layer:'global'})).error.code,'APPROVAL_REJECTED')
  assert.match(f.approvals[0].reason,/影响所有卡片/)
  assert.equal(f.calls.filter(c=>c.method==='setModConfig').length,1)
  const removed=await f.tools.get('tavern_mods_patch').execute({request:{action:'pack-scope',modId:'dsh.phone',packId:'demo',expectedRevision:'current',scope:'global'}},f.exec)
  assert.equal(removed.error.code,'INVALID_ARGS')
})

test('real tool handler reads, CAS patches a figure alias, and reads it back',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const packId=f.pack.manifest.id,figureId=f.figureId
  const before=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})
  assert.equal(before.ok,true);assert.equal(before.data.items[0].name,'Canonical figure')
  const patch={action:'patch-figure',packId,figureId,expectedRevision:before.data.revision,patch:{aliases:['distinct alias'],remark:'Owner source id\nTODO'}}
  const written=await f.invoke('assets_patch',patch)
  assert.equal(written.ok,true,JSON.stringify(written))
  const after=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})
  assert.deepEqual(after.data.items[0].aliases,['distinct alias'])
  assert.equal(after.data.items[0].remark,'Owner source id\nTODO')
  assert.notEqual(after.data.revision,before.data.revision)
  assert.equal((await f.invoke('assets_patch',patch)).error.code,'REVISION_CONFLICT')
  assert.equal((await f.invoke('stage_read',{action:'engine'})).data.revision,f.engine.read().revision)
})

test('tool syntax, card authority and secret boundaries fail before writes',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const tool=f.tools.get('tavern_stage_patch'),input=requestFor('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{music:false}}})
  input.request.unexpected=true
  const invalid=await tool.execute(input,f.exec)
  assert.equal(invalid.error.code,'INVALID_ARGS')
  assert.equal(invalid.error.path,'$.request.unexpected')
  assert.equal(invalid.error.example.request.operation.action,'engine')
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{apiKey:'secret-marker'}})).error.code,'CREDENTIALS_FORBIDDEN')
  f.chat.mode='story'
  assert.equal((await f.invoke('stage_read',{action:'engine'})).error.code,'CARD_MODE_REQUIRED')
  assert.equal(f.approvals.length,0)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
})

test('prepare uses the application generation owner without issuing a paid request',async t=>{
  // a ready 配图 channel that must not be called by prepare
  let generated=0
  const imageProvider=()=>({label:'fixture',status:async()=>({ready:true,model:'fixture-image',maxReferences:4}),generate:async()=>{generated++;throw new Error('No paid request permitted in fixture')}})
  const f=await workbenchFixture({imageProvider});t.after(()=>f.close())
  const result=await f.invoke('asset_generation',{action:'prepare',target:{packId:f.pack.manifest.id,kind:'background'},expectedRevision:f.pack.revision,userPrompt:'Quiet library',quality:'max',count:2})
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.imageCount,2)
  assert.equal(result.data.output.quality,'max')
  assert.ok(result.data.planId);assert.equal(f.paidCalls,0);assert.equal(generated,0);assert.equal(f.approvals.length,0)
  assert.ok(!JSON.stringify(result).includes('fixture-no-network'))
  assert.equal((await f.library.getPackSnapshot({packId:f.pack.manifest.id})).revision,f.pack.revision)
  assert.equal(f.tools.has('tavern_accept_asset'),false)
})

test('card asset tools expose and persist remarks on entries and outfits',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const packId=f.pack.manifest.id,figureId=f.figureId,remark='Owner-only source id\nTODO'
  const schema=await f.invoke('assets_read',{action:'schema',kind:'directions'})
  assert.ok(schema.data.fields.includes('remark'))
  const before=await f.invoke('assets_read',{action:'pack',packId})
  const item={...schema.data.example,remark}
  const saved=await f.invoke('assets_patch',{action:'item',packId,expectedRevision:before.data.revision,item})
  assert.equal(saved.ok,true,JSON.stringify(saved))
  const read=await f.invoke('assets_read',{action:'item',packId,kind:'directions',id:item.id})
  assert.equal(read.data.items[0].remark,remark)
  const figure=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})
  const outfits=[{key:'notes',label:'Notes',enabled:true,recall:{mode:'keyword',keywords:['私服']},remark}]
  const written=await f.invoke('assets_patch',{action:'patch-figure',packId,figureId,expectedRevision:figure.data.revision,patch:{outfits}})
  assert.equal(written.ok,true,JSON.stringify(written))
  assert.equal((await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figureId})).data.items[0].outfits[0].remark,remark)
})

test('global writes fail closed and approval never replaces owner CAS',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const before=f.engine.read(),input={action:'engine',expectedRevision:before.revision,patch:{stageToggles:{music:false}}}
  assert.equal((await f.invoke('stage_patch',input)).error.code,'APPROVAL_REJECTED')
  assert.equal(f.engine.read().revision,before.revision)
  assert.match(f.approvals[0].reason,/影响所有卡片/)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
  f.setApproval('allowed-once',async()=>f.engine.save({expectedRevision:before.revision,patch:{stageToggles:{voice:false}}}))
  assert.equal((await f.invoke('stage_patch',input)).error.code,'REVISION_CONFLICT')
  f.setApproval('allowed-once')
  const changed=await f.invoke('stage_patch',{...input,expectedRevision:f.engine.read().revision})
  assert.equal(changed.ok,true);assert.equal(f.engine.read().values.stageToggles.music,false)
  assert.equal(f.approvals.length,3)
})

test('no approval channel cannot authorize a global write',async t=>{
  const f=await workbenchFixture({noApproval:true});t.after(()=>f.close())
  assert.equal((await f.invoke('stage_patch',{action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{stage:false}}})).error.code,'APPROVAL_REQUIRED')
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
})

test('paid generation approval displays frozen count and cost risk, rejected calls do not generate',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const plan=(await f.invoke('asset_generation',{action:'prepare',target:{packId:f.pack.manifest.id,kind:'background'},expectedRevision:f.pack.revision,userPrompt:'Garden',count:3})).data
  const result=await f.invoke('asset_generation',{action:'generate',planId:plan.planId,consentToken:plan.consentToken})
  assert.equal(result.error.code,'APPROVAL_REJECTED')
  assert.match(f.approvals[0].reason,/3 张 = 3 个单图请求/);assert.match(f.approvals[0].reason,/不保证免费/)
  assert.equal(f.calls.filter(c=>c.method==='generateAssetCandidate').length,0)
  assert.equal(f.paidCalls,0)
  const other={...f.exec,agent:{session:{...f.exec.agent.session,id:'other'}}}
  assert.equal((await f.invoke('asset_generation',{action:'generate',planId:plan.planId,consentToken:plan.consentToken},other)).error.code,'EXPIRED')
})

test('real approval policy never auto-rejects without answerer; ask waits, rejects, then allows one write',async t=>{
  const {ApprovalService}=await import(new URL('../../dsh-user-approval/lib/index.js',import.meta.resolve('@deepseek-ai/dsh-tools')))
  let answer,asked,answererCalls=0
  const service=Object.create(ApprovalService.prototype)
  Object.defineProperty(service,'ctx',{value:{waterfall:async()=>{answererCalls++;asked();return new Promise(resolve=>{answer=resolve})}}})
  service.config={policy:'never'}
  const f=await workbenchFixture({approval:service});t.after(()=>f.close())
  const events=[{type:'turn/start',data:{}}],session=f.exec.agent.session
  Object.defineProperty(session,'seq',{get:()=>events.length})
  session.eventAt=index=>events[index]
  session.append=(type,data)=>events.push({type,data})
  const input={action:'engine',expectedRevision:f.engine.read().revision,patch:{stageToggles:{music:false}}}
  const policy=await f.invoke('stage_patch',input)
  assert.equal(policy.error.reason,'policy-rejected')
  assert.match(policy.error.message,/策略自动拒绝/)
  assert.equal(answererCalls,0)
  assert.equal(events.at(-1).data.outcome,'rejected')
  service.config.policy='ask'
  for(const outcome of ['rejected','allowed-once']) {
    const waiting=new Promise(resolve=>{asked=resolve})
    const pending=f.invoke('stage_patch',input)
    await waiting
    assert.match(events.at(-1).data.reason,/等待用户批准/)
    assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,0)
    answer(outcome)
    const result=await pending
    if(outcome==='rejected') {
      assert.equal(result.error.reason,'user-rejected')
      assert.equal(result.error.message,'用户拒绝，未更改。')
      assert.equal(f.engine.read().values.stageToggles.music,true)
    } else assert.equal(result.ok,true)
  }
  assert.equal(f.engine.read().values.stageToggles.music,false)
  assert.equal(f.calls.filter(c=>c.method==='saveAssetEngineSettings').length,1)
})
test('asset item, schema and removal accept canonical kinds, including props, not items',async t=>{
  const {ASSET_KINDS}=await import('../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js')
  const f=await workbenchFixture();t.after(()=>f.close())
  const packId=f.pack.manifest.id
  for(const kind of ASSET_KINDS) {
    assert.equal((await f.invoke('assets_read',{action:'schema',kind})).data.kind,kind)
    assert.equal((await f.invoke('assets_read',{action:'item',packId,kind})).ok,true)
    requestFor('assets_patch',{action:'remove-item',packId,expectedRevision:f.pack.revision,kind,id:'sample'})
  }
  assert.throws(()=>requestFor('assets_read',{action:'item',packId,kind:'items'}),/Cannot encode/)
  const item={kind:'props',id:'key',name:'Key',enabled:true,recall:{mode:'keyword',keywords:['brass key','lock teeth','key ring']},directorNote:'',media:null,pendingMedia:true}
  const added=await f.invoke('assets_patch',{action:'item',packId,expectedRevision:f.pack.revision,item})
  assert.equal(added.ok,true,JSON.stringify(added))
  const read=await f.invoke('assets_read',{action:'item',packId,kind:'props',id:'key'})
  assert.equal(read.data.items[0].name,'Key')
  f.setApproval('allowed-once')
  assert.equal((await f.invoke('assets_patch',{action:'remove-item',packId,expectedRevision:read.data.revision,kind:'props',id:'key'})).ok,true)
  assert.deepEqual((await f.invoke('assets_read',{action:'item',packId,kind:'props'})).data.items,[])
})
