import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, imageJson, IMAGE_PNG } from './fixtures/image-plugin-runtime.mjs'
import { selectGenerationConfig } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/generation-selection.js'
import { cardSelection } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/card-app/generation.js'
import { normalizePromptPresets } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'

const template = (id, text, purpose = 'both') => ({ id, name: id, enabled: true, independent: true,
  structure: { format: 'natural', purpose, targets: [{ kind: 'workflow', id: 'same-workflow' }], blocks: [{ kind: 'positive', title: '画风', text }] } })

test('random templates may share a workflow, exclude edit-only templates from generation, and freeze one resolved choice', () => {
  const presets = normalizePromptPresets([template('watercolor', 'watercolor'), template('film', 'film'), template('edit', 'change clothes', 'edit')])
  assert.deepEqual(presets.map(item => item.structure.targets.length), [1, 1, 1])
  const config = { promptSystem: 'workbench', imageBackend: 'comfyui', defaultWorkflow: 'same-workflow', promptPresets: presets, promptDefault: null, randomPromptTemplates: true }
  const workflows = [{ id: 'same-workflow', enabled: true }]
  const a = selectGenerationConfig(config, workflows, { randomValue: () => 0 })
  const b = selectGenerationConfig(config, workflows, { randomValue: () => .99 })
  assert.equal(a.template.id, 'watercolor'); assert.equal(b.template.id, 'film')
  assert.equal(selectGenerationConfig(b.config, workflows).template.id, 'film')
  assert.equal(selectGenerationConfig({ ...config, promptSystem: 'worldbook' }, workflows).template, null)
})

test('worldbook mode actually injects saved legacy rules; switching to workbench uses template rules and preserves the book', async t => {
  const systems = []
  const fixture = await imagePluginFixture(t, { config: { promptSystem: 'worldbook', promptMode: 'structured', generationMode: 'text', promptDefault: null },
    llm: { async *stream(request) { systems.push(request.system); assert.ok(request.sessionId); yield { type: 'text-delta', text: '<images><image><regex>旅人站在门前。</regex><prompts>【画面】\n成年旅人站在门前。</prompts><negative_prompt>extra people, watermark</negative_prompt></image></images>' } } } })
  const runtime = await fixture.start()
  const imported = await runtime.request('worldbook-import', { format: 'structured', book: 'main', worldbook: { name: '旧规则', entries: [{ comment: '旧画风', content: 'LEGACY_RULE_REAL_PATH', enabled: true, activation: 'always' }] } })
  assert.equal(imported.status, 200)
  const legacy = await runtime.request('prompt-plan', { text: '旅人站在门前。', generationMode: 'text', forceFresh: true })
  assert.equal(legacy.status, 200, JSON.stringify(legacy.body)); assert.match(systems[0], /LEGACY_RULE_REAL_PATH/)
  await runtime.request('config', { config: { promptSystem: 'workbench' } })
  const modern = await runtime.request('prompt-plan', { text: '旅人站在门前。', generationMode: 'text', forceFresh: true,
    template: { id: 'modern', name: '模板', independent: true, structure: { format: 'structured', blocks: [{ kind: 'output', title: '生成方式', format: 'structured', text: 'MODULAR_RULE_REAL_PATH' }] } } })
  assert.equal(modern.status, 200, JSON.stringify(modern.body)); assert.match(systems[1], /MODULAR_RULE_REAL_PATH/); assert.doesNotMatch(systems[1], /LEGACY_RULE_REAL_PATH/)
  assert.equal(modern.body.plans[0].negative, 'extra people, watermark')
  const preview = await runtime.request('prompt-preview', { text: modern.body.plans[0].prompts, negative: modern.body.plans[0].negative, generationMode: 'text' })
  assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.match(preview.body.result.negative, /extra people, watermark/)
  const exported = await runtime.request('worldbook-export?format=structured&book=main')
  assert.match(exported.bytes.toString(), /LEGACY_RULE_REAL_PATH/)
})

test('an image-only ComfyUI graph can be imported for upscale and editing templates', async t => {
  const fixture = await imagePluginFixture(t)
  const runtime = await fixture.start()
  globalThis.fetch = async () => imageJson({})
  const result = await runtime.request('workflow-import', { name: 'Image-only edit', workflow: {
    '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
    '2': { class_type: 'ImageScale', inputs: { image: ['1', 0], upscale_method: 'lanczos', width: 1024, height: 1024, crop: 'disabled' } },
    '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'edit' } },
  } })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const state = await runtime.request('state')
  const imported = state.body.workflows.find(item => item.file === 'workflows/' + result.body.file)
  assert.ok(imported && !imported.error, JSON.stringify(imported)); assert.equal(imported.referenceCapacity, 1)
})

// A saved template is the execution plan even when a caller still sends an old workflow/channel ID.
test('card calls route a channel-bound template consistently on the first selection and repeated batch selection', () => {
 const preset={...template('cloud','watercolor'),structure:{...template('cloud','watercolor').structure,targets:[{kind:'channel',id:'b'}]}}
 const config={promptSystem:'workbench',imageBackend:'openai',activeImageChannel:'a',promptDefault:null,promptPresets:[preset],imageChannels:[{id:'a',name:'A',provider:'openai'},{id:'b',name:'B',provider:'openai'}]}
 for(const args of [{template:'cloud',channel:'a',workflow:'old'},{templateId:'cloud',channel:'a',workflow:'old'}]){
  const selected=cardSelection(config,[],args);assert.equal(selected.channelId,'b');assert.equal(selected.config.activeImageChannel,'b')
 }
 assert.equal(config.activeImageChannel,'a')
})


test('the single modular default persists its target and generation follows that target rather than the previous channel', async t => {
 const channels=['a','b'].map(id=>({id,provider:'openai',name:id,baseUrl:'https://'+id+'.example.test/v1',model:id,authMode:'none'}))
 const fixture=await imagePluginFixture(t,{config:{promptSystem:'workbench',imageBackend:'openai',activeImageChannel:'a',imageChannels:channels,promptPresets:[],promptDefault:null,lockWorkflow:true}})
 const runtime=await fixture.start(),requests=[]
 globalThis.fetch=async(url)=>{requests.push(String(url));return imageJson({data:[{b64_json:IMAGE_PNG.toString('base64')}]})}
 const saved=await runtime.request('config',{config:{promptDefault:{name:'模块化模板',independent:true,structure:{format:'natural',targets:[{kind:'channel',id:'b'}],blocks:[{kind:'scene',title:'画面',text:''}]}}}})
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 const state=await runtime.request('state');assert.deepEqual(state.body.config.promptDefault.structure.targets,[{kind:'channel',id:'b'}])
 const result=await runtime.request('jobs',{tag:'A quiet tea room, no people',generationMode:'text'})
 assert.equal(result.status,200,JSON.stringify(result.body))
 const job=await runtime.terminal(result.body.jobId||result.body.job?.id||result.body.id)
 assert.equal(job.state,'done',job.error);assert.equal(job.promptTemplate.id,'__default__')
 assert.ok(requests.some(url=>url.startsWith('https://b.example.test/')));assert.ok(!requests.some(url=>url.startsWith('https://a.example.test/')))
})
