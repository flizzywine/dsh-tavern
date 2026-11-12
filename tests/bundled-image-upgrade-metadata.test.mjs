import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {imagePluginFixture,IMAGE_PNG,imageJson} from './fixtures/image-plugin-runtime.mjs'
import {createImageGenerator} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'

const usage={input_tokens:60,output_tokens:80,total_tokens:140,input_tokens_details:{text_tokens:20,image_tokens:40}}
const channel={id:'official',provider:'openai',name:'OpenAI',baseUrl:'https://api.openai.com/v1',model:'gpt-image-2',authMode:'none',options:{quality:'high',moderation:'low'}}
test('template stage generation and editing retain usage and transparent PNG with global JPEG enabled',async t=>{
 let provider
 const fixture=await imagePluginFixture(t,{config:{imageBackend:'openai',activeImageChannel:channel.id,imageChannels:[channel],jpegOutput:true},tavern:{apiVersion:5,attach(){},promptSection(){},onTurnSettled(){},list:async()=>[],imageProvider(value){provider=value;return()=>{}}}})
 const runtime=await fixture.start();await runtime.request('state')
 for(let i=0;i<100&&!provider;i++)await new Promise(r=>setTimeout(r,10))
 assert.equal(provider.status().transparent,true)
 const requests=[]
 globalThis.fetch=async(url,init)=>{requests.push({url,body:init.body});return imageJson({data:[{b64_json:IMAGE_PNG.toString('base64')}],usage})}
 for(const references of [[],[{data:IMAGE_PNG,mediaType:'image/png'}]]){
  const result=await provider.generate({prompt:'A quiet tea room',references,background:'transparent',quality:'low',
   subjects:[{characterId:'external'}],definitions:{characters:[{id:'external',name:'Caller character',traits:{face:'short silver hair'}}]}})
  assert.equal(result.mediaType,'image/png');assert.deepEqual(Buffer.from(result.data),IMAGE_PNG);assert.deepEqual(result.usage,usage)
 }
 const first=JSON.parse(requests[0].body);assert.equal(first.background,'transparent');assert.equal(first.output_format,'png');assert.equal(first.quality,'low');assert.equal(first.moderation,'low');assert.match(first.prompt,/short silver hair/)
 assert.equal(requests[1].body.get('background'),'transparent');assert.equal(requests[1].body.get('quality'),'low');assert.equal(requests[1].body.get('moderation'),'low');assert.match(requests[1].body.get('prompt'),/short silver hair/)
 const state=(await runtime.request('state')).body
 assert.equal(state.config.jpegOutput,true);assert.ok(!state.definitions.characters.some(item=>item.id==='external'));assert.equal(state.jobs.length,2);assert.ok(state.jobs.every(job=>job.mediaType==='image/png'&&job.usage.total_tokens===140))
})
test('transparency reports official capabilities and leaves proxy support unknown',()=>{
 for(const [changes,expected] of [[{},true],[{model:'dall-e-3'},false],[{baseUrl:'https://proxy.example/v1',model:'gpt-image-2'},undefined],[{baseUrl:'https://proxy.example/v1',model:'other'},undefined]]){
  const selected={...channel,...changes};const adapter=createImageGenerator(()=>({imageBackend:'openai',activeImageChannel:channel.id,imageChannels:[selected]}))
  assert.equal(adapter.status().transparent,expected)
 }
})
test('legacy upgrade inherits worldbook mode, libraries, custom templates, channels and reference files',async t=>{
 const legacy={imageBackend:'openai',activeImageChannel:'user',imageChannels:[{...channel,id:'user',model:'user-model',apiKey:'UPGRADE_TEST_ONLY_SECRET',options:{quality:'high',customOption:'keep'}}],promptMode:'tags',plannerEnabled:false,lockWorkflow:true,promptPresets:[{id:'user-template',name:'用户模板',structure:{format:'natural',blocks:[{kind:'scene',title:'画面',text:''}],targets:[]}}]}
 const worldbook={name:'用户生图规则',customMetadata:{keep:true},entries:[{uid:7,comment:'用户词条',content:'USER_RULE_TO_KEEP',enabled:false,activation:'keywords',keywords:['茶室']}]}
 const referenceImage={id:createHash('sha256').update(IMAGE_PNG).digest('hex'),mediaType:'image/png',name:'旧角色参考.png',byteLength:IMAGE_PNG.length}
 const definitions={characters:[{id:'person',name:'林月',referenceImage,traits:{face:'short black hair'},outfits:[{id:'outfit',name:'红外套',upper:'red coat',characterOutfitImage:referenceImage}]}],outfits:[{id:'shared',name:'共用制服',body:'uniform',referenceImage}],scenes:[],props:[]}
 const fixture=await imagePluginFixture(t,{config:legacy,definitions,files:{'config.json':legacy,'worldbook.json':worldbook,'card-enabled.json':{enabled:false},'card-worldbook.json':{version:3,buckets:[]}}})
 await mkdir(join(fixture.pluginRoot,'reference-images'),{recursive:true})
 await writeFile(join(fixture.pluginRoot,'reference-images',referenceImage.id),IMAGE_PNG)
 const file=join(fixture.pluginRoot,'worldbook.json'),before=await readFile(file)
 const runtime=await fixture.start(),state=(await runtime.request('state')).body
 assert.equal(state.config.promptSystem,'worldbook');assert.equal(state.config.plannerEnabled,false);assert.equal(state.config.lockWorkflow,true)
 assert.equal(state.config.promptPresets[0].name,'用户模板');assert.equal(state.config.imageChannels[0].model,'user-model');assert.equal(state.config.imageChannels[0].hasApiKey,true)
 assert.equal(state.definitions.characters[0].name,'林月');assert.equal(state.definitions.characters[0].outfits[0].name,'红外套');assert.equal(state.outfits[0].name,'共用制服')
 assert.deepEqual(await readFile(file),before)
 assert.deepEqual(state.definitions.characters[0].referenceImage,referenceImage)
 assert.deepEqual(state.definitions.characters[0].outfits[0].characterOutfitImage,referenceImage)
 assert.deepEqual(state.outfits[0].referenceImage,referenceImage)
 assert.deepEqual((await runtime.request('reference-image?id='+referenceImage.id)).bytes,IMAGE_PNG)
 await runtime.request('config',{config:{promptSystem:'workbench'}})
 await runtime.request('config',{config:{promptSystem:'worldbook'}})
 const stored=await fixture.read('config.json');assert.equal(stored.imageChannels[0].apiKey,legacy.imageChannels[0].apiKey);assert.equal(stored.imageChannels[0].options.customOption,'keep');assert.equal(stored.promptPresets[0].id,'user-template')
 const exported=await runtime.request('worldbook-export?format=tags&book=main');assert.match(exported.bytes.toString(),/USER_RULE_TO_KEEP/)
 assert.deepEqual(await readFile(file),before)
 assert.deepEqual((await runtime.request('reference-image?id='+referenceImage.id)).bytes,IMAGE_PNG)
})


test('unloaded extension modules retain their nested settings through config saves and restart',async t=>{
 const values={palette:['amber','blue'],options:{disabled:false,weight:0,note:null},freeform:'用户插件专有字段'}
 const extension={kind:'extension',title:'暂未启用的插件',moduleId:'user.unloaded',values}
 const preset={id:'keep-module',name:'用户模块模板',independent:true,structure:{format:'natural',targets:[],blocks:[{kind:'scene',title:'画面',text:''},extension]}}
 const fixture=await imagePluginFixture(t,{config:{promptSystem:'workbench',promptPresets:[preset],promptDefault:{...preset,name:'默认模块模板'}}})
 const runtime=await fixture.start()
 const initial=(await runtime.request('state')).body.config
 assert.ok(!initial.promptModuleTypes.some(module=>module.id==='user.unloaded'))
 assert.deepEqual(initial.promptPresets[0].structure.blocks[1].values,values)
 const saved=await runtime.request('config',{config:{promptPresets:initial.promptPresets,promptDefault:initial.promptDefault}})
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 runtime.close()
 const restarted=await fixture.start(),config=(await restarted.request('state')).body.config
 for(const template of [config.promptPresets[0],config.promptDefault]){
  assert.equal(template.structure.blocks[1].moduleId,'user.unloaded')
  assert.deepEqual(template.structure.blocks[1].values,values)
 }
 const stored=await fixture.read('config.json')
 assert.deepEqual(stored.promptPresets[0].structure.blocks[1].values,values)
})

test('reference descriptors and immutable image bytes remain readable after config save and restart',async t=>{
 const fixture=await imagePluginFixture(t)
 const runtime=await fixture.start()
 const uploaded=await runtime.request('reference-image',{data:IMAGE_PNG.toString('base64'),mediaType:'image/png',name:'升级前参考.png'})
 assert.equal(uploaded.status,200,JSON.stringify(uploaded.body))
 const referenceImage=uploaded.body.referenceImage
 const definitions={characters:[{id:'person',name:'原角色',referenceImage,traits:{face:'black hair'},outfits:[{id:'coat',name:'红外套',upper:'red coat',characterOutfitImage:referenceImage}]}],outfits:[{id:'shared',name:'制服',body:'uniform',referenceImage}],scenes:[],props:[]}
 const saved=await runtime.request('definitions',{definitions})
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 await runtime.request('config',{config:{promptSystem:'workbench'}})
 runtime.close()
 const restarted=await fixture.start(),state=(await restarted.request('state')).body
 assert.deepEqual(state.definitions.characters[0].referenceImage,referenceImage)
 assert.deepEqual(state.definitions.characters[0].outfits[0].characterOutfitImage,referenceImage)
 assert.deepEqual(state.outfits[0].referenceImage,referenceImage)
 const image=await restarted.request('reference-image?id='+referenceImage.id)
 assert.equal(image.status,200);assert.deepEqual(image.bytes,IMAGE_PNG)
 assert.deepEqual(await readFile(join(fixture.pluginRoot,'reference-images',referenceImage.id)),IMAGE_PNG)
})

test('public module package export resolves independently and includes its type declaration in runtime files',async()=>{
 const root=new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/',import.meta.url)
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'))
 const entry=pkg.exports['./modules']
 assert.ok(pkg.files.includes('lib'))
 assert.match(await readFile(new URL(entry.types,root),'utf8'),/registerTemplateModule/)
 const script=`import {registerHooks} from 'node:module';
 registerHooks({resolve(id,context,next){if(id.startsWith('node:') || /(?:image-providers|index)\\.js$/.test(id))throw Error('unwanted dependency: '+id);return next(id,context)}});
 const api=await import('dsh-tavern-image/modules');
 const remove=api.registerTemplateModule({id:'example.release',name:'Release',resolve:()=>({positive:'amber'})});
 const result=await api.materializeTemplateModulesAsync({blocks:[{kind:'extension',title:'Release',moduleId:'example.release',values:{}}]});
 if(result.structure.blocks[0].text!=='amber')throw Error('module export did not resolve');remove();`
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:fileURLToPath(root),env:{...process.env,NODE_OPTIONS:''},windowsHide:true,timeout:15000})
})


test('legacy worldbook jobs retain custom and built-in visual presets while workbench modules stay inactive',async t=>{
 const modular={name:'工作台模块',structure:{format:'natural',targets:[{kind:'channel',id:channel.id}],blocks:[{kind:'extension',title:'工作台专用',moduleId:'not.loaded',values:{positive:'WORKBENCH_ONLY'}}]}}
 const legacy={imageBackend:'openai',activeImageChannel:channel.id,imageChannels:[channel],activePromptPreset:'my-legacy',promptMode:'natural',promptDefault:modular,
  promptPresets:[{id:'my-legacy',name:'旧视觉预设',positive:'LEGACY_VISUAL_STYLE',negative:'LEGACY_VISUAL_NEGATIVE'},{id:'modular',...modular}]}
 const fixture=await imagePluginFixture(t,{config:legacy,files:{'config.json':legacy}})
 const runtime=await fixture.start(),requests=[]
 globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init.body));return imageJson({data:[{b64_json:IMAGE_PNG.toString('base64')}]})}
 for(const selected of ['my-legacy','anime-character']){
  if(selected!=='my-legacy')assert.equal((await runtime.request('config',{config:{activePromptPreset:selected}})).status,200)
  const started=await runtime.request('jobs',{tag:'A quiet tea room',generationMode:'text'})
  assert.equal(started.status,200,JSON.stringify(started.body))
  const job=await runtime.terminal(started.body.jobId||started.body.id)
  assert.equal(job.state,'done',job.error)
 }
 assert.match(requests[0].prompt,/LEGACY_VISUAL_STYLE/);assert.match(requests[0].prompt,/LEGACY_VISUAL_NEGATIVE/)
 assert.match(requests[1].prompt,/polished hand-drawn anime illustration/i)
 assert.ok(requests.every(request=>!request.prompt.includes('WORKBENCH_ONLY')))
 const config=(await runtime.request('state')).body.config
 assert.equal(config.promptSystem,'worldbook')
 assert.equal(config.promptPresets[1].structure.blocks[0].moduleId,'not.loaded')
 assert.equal(config.promptDefault.structure.blocks[0].moduleId,'not.loaded')
})


test('legacy custom presets that share newly reserved built-in IDs retain their active selection after save and restart',async t=>{
 for(const id of ['cinematic-example','structured-template']){
  const legacy={activePromptPreset:id,promptPresets:[{id,name:'用户原模板 '+id,positive:'USER_POSITIVE_'+id,negative:'USER_NEGATIVE_'+id}],promptMode:'natural'}
  const fixture=await imagePluginFixture(t,{files:{'config.json':legacy}})
  const runtime=await fixture.start()
  const check=config=>{
   assert.equal(config.promptSystem,'worldbook')
   const selected=config.promptPresets.find(preset=>preset.id===config.activePromptPreset)
   assert.ok(selected,'active selection must still identify the saved user preset: '+id)
   assert.equal(selected.name,legacy.promptPresets[0].name)
   assert.equal(selected.positive,legacy.promptPresets[0].positive)
   assert.equal(selected.negative,legacy.promptPresets[0].negative)
  }
  check((await runtime.request('state')).body.config)
  assert.equal((await runtime.request('config',{config:{plannerEnabled:false}})).status,200)
  check(await fixture.read('config.json'))
  runtime.close()
  const restarted=await fixture.start()
  check((await restarted.request('state')).body.config)
 }
})
