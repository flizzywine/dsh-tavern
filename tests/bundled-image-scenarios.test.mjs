import test from 'node:test'
import assert from 'node:assert/strict'
import { composePluginImagePrompt } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-assembly.js'
import {normalizePromptEntries,matchPromptEntries} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-entries.js'
import {imagePluginFixture,IMAGE_PNG,imageJson} from './fixtures/image-plugin-runtime.mjs'
const settings={policy:'keywords',fallback:'normal',fixed:'normal',modes:[{id:'normal',name:'普通',description:'普通画面',keywords:[]},{id:'nsfw',name:'NSFW',description:'成人场景',keywords:['nsfw']}]}
const template={name:'模式模板',independent:true,structure:{format:'tags',scenarios:settings,blocks:[
 {kind:'scene',title:'场景',text:''},{kind:'positive',title:'普通光线',text:'soft daylight',modes:['normal']},
 {kind:'positive',title:'特殊光线',text:'dramatic shadows',modes:['nsfw']},{kind:'entries',title:'词条库',entryGroup:''},
 {kind:'extension',title:'未加载模块',moduleId:'missing.plugin',values:{},modes:['never']},
]}}
const config={imageBackend:'sdwebui',promptSystem:'workbench',promptDefault:template,promptPresets:[],promptEntries:[],activePromptPreset:'',weightMode:'keep'}
test('tag chains insert once into positive and negative prompts and entry capacity exceeds the old six',()=>{
 const entries=normalizePromptEntries(Array.from({length:50},(_,i)=>({id:'tag-'+i,title:'tag '+i,content:i===0?'cinematic lighting, rim light':'detail_'+i,format:'tags',injection:i===1?'negative':'positive',always:true})))
 const result=composePluginImagePrompt({...config,promptEntries:entries},{prompt:'A room'})
 assert.match(result.positive,/cinematic lighting, rim light/)
 assert.equal(result.positive.match(/cinematic lighting/g).length,1)
 assert.match(result.negative,/detail_1/)
 const trace=matchPromptEntries(entries,[{kind:'entries'}],'room',{explain:true})
 assert.equal(trace.matches.length,32)
 assert.equal(normalizePromptEntries(Array.from({length:1000},(_,i)=>({id:'e'+i,title:'Entry',content:'Text'}))).length,1000)
})
test('real runtime uses modes for actual provider payloads and model-based planning',async t=>{
 const requests=[],classifications=[]
 const saved={...template,structure:{...template.structure,scenarios:{...settings,policy:'model'}}}
 const fixture=await imagePluginFixture(t,{config:{...config,promptDefault:saved,imageChannels:[{id:'sd',provider:'sdwebui',baseUrl:'https://sd.mock.invalid',name:'SD',options:{}}],activeImageChannel:'sd'},llm:{async *stream(input){
  if(input.system.startsWith('判断本次画面')){classifications.push(input);yield{type:'text-delta',text:'{"mode":"nsfw"}'}}
  else {assert.doesNotMatch(input.system,/普通光线/);yield{type:'text-delta',text:'<image><regex>A room.</regex><prompts>A room</prompts></image>'}}
 }}})
 const runtime=await fixture.start()
 globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init.body));return imageJson({images:[IMAGE_PNG.toString('base64')]})}
 const started=await runtime.request('jobs',{tag:'A room',generationMode:'text'})
 assert.equal(started.status,200,JSON.stringify(started.body))
 assert.equal((await runtime.terminal(started.body.id||started.body.jobId)).state,'done')
 assert.match(requests[0].prompt,/dramatic shadows/);assert.doesNotMatch(requests[0].prompt,/soft daylight/)
 const planned=await runtime.request('prompt-plan',{text:'A room.',count:1,generationMode:'text',forceFresh:true})
 assert.equal(planned.status,200,JSON.stringify(planned.body));assert.equal(planned.body.assembly.scenario.id,'nsfw')
 assert.equal(classifications.length,2)
})
test('a fresh install defaults to worldbook mode and keeps templates available',async t=>{
 const fixture=await imagePluginFixture(t,{config:{promptSystem:undefined}})
 const runtime=await fixture.start()
 const state=(await runtime.request('state')).body
 assert.equal(state.config.promptSystem,'worldbook')
 assert.ok(state.config.promptDefault.structure.blocks.length)
})
