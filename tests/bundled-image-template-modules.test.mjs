import test from 'node:test'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {registerTemplateModule,materializeTemplateModules,materializeTemplateModulesAsync,applyModuleWorkflowValues} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
import {normalizePromptStructure} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-structure.js'
import {composePluginImagePrompt,composePluginImagePromptAsync,createImageGenerator} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import {imagePluginFixture,IMAGE_PNG,imageJson} from './fixtures/image-plugin-runtime.mjs'
const template=blocks=>({name:'自制模板',independent:true,structure:{format:'natural',targets:[],blocks:[{kind:'scene',title:'场景',text:''},...blocks]}})
const block={kind:'extension',title:'自己的光线模块',moduleId:'core.custom',values:{positive:'soft light in {{city}}',negative:'watermark',rules:'保持当前动作',keywords:'tea',parameters:'{"steps":18,"cfg":6}'}}

test('a player module uses declared variables and conditions, combines positive/negative/rules, and round-trips opaque plugin settings',()=>{
 const structure=normalizePromptStructure({...template([block]).structure,inputs:[{key:'city',label:'城市',default:'南京'}]})
 assert.deepEqual(structure.blocks[1].values,block.values)
 const resolved=materializeTemplateModules(structure,{scene:'tea room',inputs:{city:'Nanjing'}})
 assert.match(resolved.structure.blocks.map(b=>b.text).join('\n'),/soft light in Nanjing/)
 assert.deepEqual(resolved.parameters,{steps:18,cfg:6})
 assert.equal(materializeTemplateModules(structure,{scene:'mountain'}).structure.blocks.length,1)
 const unknown=normalizePromptStructure(template([{...block,moduleId:'another.plugin',enabled:false}]).structure)
 assert.equal(unknown.blocks[1].moduleId,'another.plugin');assert.deepEqual(unknown.blocks[1].values,block.values)
 assert.doesNotThrow(()=>materializeTemplateModules(unknown))
})
test('independent sync/async APIs resolve plugin modules without mutating saved templates or leaking configuration',async()=>{
 const remove=registerTemplateModule({id:'test.palette',name:'配色模块',fields:[{key:'color',label:'颜色',type:'text',default:'blue'}],async resolve(context){await Promise.resolve();assert.equal('apiKey' in context,false);return{positive:context.values.color+' light',negative:'watermark',parameters:{steps:12}}}})
 try{
  const config={imageBackend:'openai',promptDefault:template([{kind:'extension',title:'配色',moduleId:'test.palette',values:{color:'amber'}}]),promptPresets:[],imageChannels:[],activePromptPreset:''}
  const before=JSON.stringify(config)
  assert.throws(()=>composePluginImagePrompt(config,{prompt:'tea room'}),/异步/)
  const result=await composePluginImagePromptAsync(config,{prompt:'tea room'})
  assert.match(result.positive,/amber light/);assert.match(result.negative,/watermark/);assert.equal(result.parameters.steps,12)
  assert.equal(JSON.stringify(config),before)
  const stopped=new AbortController();stopped.abort(new Error('user stopped'))
  await assert.rejects(materializeTemplateModulesAsync(config.promptDefault.structure,{signal:stopped.signal}),/user stopped/)
 }finally{remove()}
})
test('literal workflow inputs are patched per request while the saved graph and connections stay intact',()=>{
 const workflow={prompt:{'1':{class_type:'CustomCaption',inputs:{caption:'old',options:{enabled:false}}},'2':{class_type:'Consumer',inputs:{text:['1',0]}}}}
 const changed=applyModuleWorkflowValues(workflow,[{node:'1',input:'caption',value:'new'},{node:'1',input:'options',value:{enabled:true}}])
 assert.equal(workflow.prompt['1'].inputs.caption,'old');assert.equal(changed.prompt['1'].inputs.caption,'new')
 assert.deepEqual(changed.prompt['2'].inputs.text,['1',0])
})
test('runtime jobs and planner use a registered asynchronous module, with explicit request seed taking precedence',async t=>{
 const saved=template([{kind:'extension',title:'插件能力',moduleId:'test.runtime',values:{tone:'amber'}}])
 const fixture=await imagePluginFixture(t,{config:{promptSystem:'workbench',imageBackend:'sdwebui',activeImageChannel:'sd',imageChannels:[{id:'sd',provider:'sdwebui',name:'SD',baseUrl:'https://sd.example.test',authMode:'none',options:{}}],promptDefault:saved,promptPresets:[]},llm:{async *stream(input){assert.match(input.system,/RUNTIME_MODULE_RULE/);yield{type:'text-delta',text:'<image><regex>A tea room.</regex><prompts>A tea room</prompts></image>'}}}})
 const api=await import(pathToFileURL(join(fixture.pluginRoot,'lib/template-modules.js')).href)
 const remove=api.registerTemplateModule({id:'test.runtime',name:'测试模块',fields:[{key:'tone',label:'色调',type:'text'}],async resolve({values}){return{positive:values.tone+' light',negative:'watermark',rules:'RUNTIME_MODULE_RULE',parameters:{seed:44,steps:18,cfg:6,width:640,height:384}}}});t.after(remove)
 const runtime=await fixture.start(),calls=[]
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return imageJson({images:[IMAGE_PNG.toString('base64')]})}
 const state=(await runtime.request('state')).body
 const definition=state.config.promptModuleTypes.find(item=>item.id==='test.runtime');assert.equal(definition.name,'测试模块');assert.equal('resolve' in definition,false)
 const started=await runtime.request('jobs',{tag:'A tea room',seed:55,generationMode:'text'})
 assert.equal(started.status,200,JSON.stringify(started.body));const job=await runtime.terminal(started.body.id||started.body.jobId)
 assert.equal(job.state,'done',job.error)
 assert.match(calls[0].prompt,/amber light/);assert.match(calls[0].negative_prompt,/watermark/)
 assert.equal(calls[0].seed,55);assert.equal(calls[0].steps,18);assert.equal(calls[0].cfg_scale,6);assert.equal(calls[0].width,640);assert.equal(calls[0].height,384)
 const plan=await runtime.request('prompt-plan',{text:'A tea room.',count:1,generationMode:'text',forceFresh:true})
 assert.equal(plan.status,200,JSON.stringify(plan.body))
 assert.equal((await runtime.request('state')).body.config.promptDefault.structure.blocks[1].kind,'extension')
})

test('ComfyUI module sampler parameters work without global overrides and ordinary node values apply after compilation',async()=>{
 const {normalizeWorkflow,compileJob}=await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
 const workflow={...normalizeWorkflow({name:'custom',prompt:{'1':{class_type:'CLIPTextEncode',inputs:{text:'old'}},'2':{class_type:'KSampler',inputs:{seed:1,steps:8,cfg:1,extra:'old'}},'3':{class_type:'EmptyLatentImage',inputs:{width:512,height:512,batch_size:1}},'4':{class_type:'SaveImage',inputs:{images:['2',0],filename_prefix:'module'}}}}),id:'custom'}
 const config={imageBackend:'comfyui',promptMode:'natural',promptDefault:null,promptPresets:[],overrideSteps:false,negativeMode:'plugin',weightMode:'native'}
 const params={tag:'A tea room',size:'640x384',seed:55,steps:18,cfg:6,moduleParameters:{steps:18,cfg:6},moduleWorkflowValues:[{node:'2',input:'extra',value:'new'}]}
 const result=compileJob({workflow,params,config,definitions:{}})
 assert.equal(result.prompt['2'].inputs.steps,18);assert.equal(result.prompt['2'].inputs.cfg,6);assert.equal(result.prompt['2'].inputs.seed,55);assert.equal(result.prompt['2'].inputs.extra,'new')
 assert.equal(workflow.prompt['2'].inputs.extra,'old')
 assert.throws(()=>compileJob({workflow,params:{...params,moduleWorkflowValues:[{node:'1',input:'text',value:'different scene'}]},config,definitions:{}}),/映射冲突/)
})

test('online jobs reject template node values before submitting to the provider', async t => {
  const promptDefault = template([{ ...block, values: { workflowValues: '[{"node":"1","input":"caption","value":"custom"}]' } }])
  const fixture = await imagePluginFixture(t, { config: { promptDefault, promptSystem: 'workbench' } })
  const runtime = await fixture.start()
  let submissions = 0
  globalThis.fetch = async () => { submissions++; throw new Error('unexpected provider request') }
  const result = await runtime.request('jobs', { tag: 'A quiet tea room', generationMode: 'text' })
  assert.equal(result.status, 400, JSON.stringify(result.body))
  assert.match(result.body.error, /节点参数需要 ComfyUI 工作流/)
  assert.equal(submissions, 0)
})
