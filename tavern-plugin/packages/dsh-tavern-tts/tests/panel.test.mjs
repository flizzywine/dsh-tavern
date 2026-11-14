// 配音 panel task flow.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { voicePreset, hash } from '../src/core.js'
import { PROVIDER_KINDS } from '../src/providers/params.js'
import { qwenVoices, QWEN_MODELS } from '../src/providers/qwen.js'

const source = await readFile(new URL('../src/client.js',import.meta.url),'utf8')
const keyed = {azure:'DSH_AZ',qwen:'DSH_QW',volcengine:'DSH_VO'}
export function fixture({sidebar = true, configured: initial, external = true, returnIntent, focus, failNavigation = false, blockedStorage = false, readingsEditor, browserSpeech, deleteGuard, testResult, modelStatus = () => ({issues:[],modelInstructions:null})} = {}) {
  const services = new Map(), tabs = new Map(), slots = new Map(), effects = [], calls = [], opened = []
  // The panel remembers its basic/advanced mode in localStorage.
  const storage = new Map(), localStorage = {getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,String(value))}
  const session = new Map(returnIntent === undefined ? [] : [['dsh:settings-return',typeof returnIntent === 'string' ? returnIntent : JSON.stringify(returnIntent)]])
  // a figure voice page's 「去设置」 / 在线 TTS ＋ leaves this one-shot focus (asset-pack-voice-ui.js).
  if (focus) session.set('dsh-tts:focus-service',JSON.stringify({at:Date.now(),...focus}))
  // an EventTarget: the page also takes a focus request sent while it is mounted (the key's window event).
  const window = Object.assign(new EventTarget(),{sessionStorage:{getItem:key => {if (blockedStorage) throw Error('storage unavailable');return session.get(key) ?? null},setItem:(key,value) => session.set(key,value),removeItem:key => session.delete(key)}})
  let events, enabled = true, creator = false, bytes = 42, presets = [], cacheSettings = {cacheMaxGB:1,cacheMaxAgeDays:30}, reading = {narrator:{enabled:false},readAloud:{voice:null,auto:false}}
  const keys = new Set(['azure-main','qwen-main','volc-main','fish-local','fish'])
  let configured = initial ?? [{id:'azure-main',kind:'azure',label:'Test Azure',config:{region:'eastasia'}},{id:'qwen-main',kind:'qwen',label:'Test Qwen',config:{region:'cn'}},{id:'volc-main',kind:'volcengine',label:'Test Volcengine',config:{appId:'test',resourceId:'seed-tts-2.0'}}]
  const checks = new Map()
  const listed = () => configured.map(p => ({...p,revision:hash(p),selfHosted:p.kind === 'fish-audio' && p.config?.url !== 'https://api.fish.audio',...(checks.has(p.id) ? {check:checks.get(p.id)} : {}),secrets:{key:{configured:keys.has(p.id),writable:true}}}))
  const voicesOf = kind => kind === 'fish-audio' ? {status:'ok',source:'manual',voices:[],models:[]} : kind === 'openai-compatible' ? {status:'ok',source:'live',voices:[{id:'alloy',label:'Alloy',languages:['en']}],models:[{id:'tts-1',label:'TTS 1'}]} : kind === 'qwen' ? {status:'ok',source:'builtin',voices:qwenVoices(),models:structuredClone(QWEN_MODELS)} :
    kind === 'azure' ? {status:'ok',source:'live',models:[],voices:[{id:'en-US-AshleyNeural',label:'Ashley',languages:['en'],gender:'Female'},{id:'ja-JP-NanamiNeural',label:'七海',languages:['ja'],gender:'Female'}]} :
    {status:'ok',source:'builtin',models:[],voices:[{id:'zh_female_cancan_mars_bigtts',label:'灿灿',languages:['zh','en'],gender:'Female'}]}
  class EventSource { constructor() { events = this } close() {} }
  const fail = code => ({ok:false,json:async () => ({error:code})})
  const fetch = async (url, options) => {
    if (url.includes('/synthesis')) {
      calls.push({url,method:'synthesis',options})
      return {ok:true,json:async () => options.method === 'POST' ? {requestId:'preview'} : {state:'ready',result:{ticket:'offline-ticket'}}}
    }
    const {method,args} = JSON.parse(options.body); calls.push({url,method,args})
    let result
    if (method === 'services') result = {configured:listed(),running:[...configured.map(p => ({id:p.id,kind:p.kind,revision:'r',capabilities:{},status:{state:keys.has(p.id) ? 'configured' : 'credentials-required'}})),
      ...(external ? [{id:'local:default',label:'外部语音服务',kind:'fish-audio',revision:'r',capabilities:{},status:{state:'ready'}}] : [])]}
    else if (method === 'providerKinds') result = PROVIDER_KINDS.filter(k => k.kind !== 'reference')
    else if (method === 'probeService') result = args.secrets?.key || keys.has(args.id) ? {...voicesOf(args.kind),status:'connected'} : {...voicesOf(args.kind),status:'credentials-required'}
    else if (method === 'saveService') {
      const next = {id:args.id,kind:args.kind,label:args.label,config:args.config}
      configured = [...configured.filter(p => p.id !== args.id),next]; if (args.secrets?.key) keys.add(args.id); result = listed().find(p => p.id === args.id)
    }
    else if (method === 'testService') { const p = configured.find(p => p.id === args.id); checks.set(args.id,testResult?.(p) ?? {status:'connected',voiceCount:voicesOf(p.kind).voices.length}); result = {reachable:true} }
    // the route answers a code plus a sentence (routes.js); the panel must branch on the code.
    else if (method === 'deleteService' && deleteGuard && !args.force) return {ok:false,status:409,json:async () => ({error:deleteGuard,message:'服务器文案'})}
    else if (method === 'deleteService') {configured = configured.filter(p => p.id !== args.id); result = {deleted:true}}
    else if (method === 'serviceUsage') result = {count:2}
    else if (method === 'providerVoices') result = args.serviceId === 'local:default' ? {status:'ok',source:'live',models:[],voices:[{id:'cast/aoi',label:'葵',engine:'service-engine',revision:'v1',languages:['ja'],state:'ready'}]} : voicesOf(configured.find(p => p.id === args.serviceId).kind)
    else if (method === 'voiceModelStatus') result = modelStatus(args)
    else if (method === 'listOnlinePresetVoices') result = {provider:args.provider,...voicesOf(args.provider)}
    else if (method === 'reading') result = structuredClone(reading)
    else if (method === 'setReading') { reading = {...reading,narrator:{...reading.narrator,...args.narrator}}; result = structuredClone(reading) }
    else if (method === 'voicePresets') result = presets.map(preset => ({preset,revision:hash(preset)}))
    else if (method === 'saveVoicePreset') {
      try {
        const preset = voicePreset(JSON.parse(JSON.stringify(args.preset))), old = presets.find(v => v.id === preset.id)
        if (old ? args.expectedRevision !== hash(old) : args.expectedRevision != null) throw Object.assign(Error(),{code:'REVISION_CONFLICT'})
        presets = [...presets.filter(v => v.id !== preset.id),preset]; result = {preset,revision:hash(preset)}
      } catch(e) {return fail(e.code || e.message)}
    }
    else if (method === 'deleteVoicePreset') {presets = presets.filter(v => v.id !== args.id); result = {deleted:true}}
    else if (method === 'importVoicePresets') {const added = args.presets.filter(p => !presets.some(v => v.id === p.id)); presets.push(...added.map(voicePreset)); result = {added:added.map(p => p.id),unchanged:[],conflicts:[]}}
    else if (method === 'editReading') result = {id:args.id,revision:args.expectedRevision + 1,op:args.op,index:0,count:1}
    else if (method === 'cache') result = {bytes,count:bytes ? 1 : 0,maxBytes:cacheSettings.cacheMaxGB * 1024 ** 3,maxAgeDays:cacheSettings.cacheMaxAgeDays}
    else if (method === 'saveCacheSettings') {cacheSettings = args; result = {saved:true}}
    else if (method === 'clearCache') {bytes = 0; result = {cleared:true}}
    else if (method === 'setEnabled') {enabled = args.enabled; events.onmessage({data:JSON.stringify({enabled})}); result = {enabled}}
    else if (method === 'settings') result = {enabled,creator:{enabled:creator}}
    else if (method === 'setCreatorEnabled') {creator = args.enabled; result = {enabled:creator}}
    else result = {}
    return {ok:true,json:async () => result}
  }
  // the Tavern plugin provides the 读音词典 editor.
  if (readingsEditor) services.set('ttsReadingsEditor',readingsEditor)
  // the Tavern speaks browser speech, a provider row of 语音服务.
  if (browserSpeech) services.set('ttsBrowserSpeech',browserSpeech)
  if (sidebar) services.set('betterSidebar',{registerTab(tab) {assert.equal(tabs.has(tab.id),false);tabs.set(tab.id,tab);return () => tabs.delete(tab.id)},openTab(seed) {if (failNavigation) throw Error('navigation unavailable');opened.push(seed)}})
  const ctx = {
    provide(key,value) {assert.equal(services.has(key),false);services.set(key,value);return () => services.delete(key)},
    get:key => services.get(key), effect(fn) {const off = fn();effects.push(off);return off},
    inject(keys,fn) {if (keys.every(key => services.has(key))) fn(ctx)},
    slots:{inject(name,fn) {effects.push(fn())},register(descriptor,Panel) {assert.equal(slots.has(descriptor.id),false);slots.set(descriptor.id,Panel);return () => slots.delete(descriptor.id)}},
  }
  function load(source) {const exports = {}; vm.runInNewContext(source,{exports,require:() => React,fetch,EventSource,Set,Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,localStorage,window,URL,Blob,document:globalThis.document});exports.apply(ctx)}
  load(source); events.onmessage({data:JSON.stringify({enabled})})
  return {tabs,slots,calls,services,opened,storage,session,presets:() => presets,reading:() => reading,dispose:() => {for (const off of effects.reverse()) off?.()}}
}

export async function withDom(fn) {
  const dom = new JSDOM('<div id="root"></div>'), previous = {window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})
  const root = createRoot(document.getElementById('root'))
  try { await fn(root) } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis,previous) }
}
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text)
const byLabel = label => document.querySelector('[aria-label="' + label + '"]')
// jsdom does not implement native text editing; invoke the rendered React handler.
const change = async (label,value) => { const input = typeof label === 'string' ? byLabel(label) : label; await act(async () => input[Object.keys(input).find(k => k.startsWith('__reactProps'))].onChange({target:{value}})) }
const click = async target => act(async () => (typeof target === 'string' ? button(target) : target).click())
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0)) })

// rows are click-to-edit, problems are ⚠ chips, actions are icons / ⋯, a dashed ＋ adds.
const radio = (group,text) => [...(document.querySelector('[role=radiogroup][aria-label="' + group + '"]')?.querySelectorAll('[role=radio]') || [])].find(b => b.textContent === text)
const checked = group => document.querySelector('[role=radiogroup][aria-label="' + group + '"] [aria-checked=true]')?.textContent
const row = title => [...document.querySelectorAll('.dtts-line-main')].find(b => b.querySelector('.dtts-line-title')?.textContent === title)
const menuItem = text => [...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === text)
const openFold = async () => { const t = document.querySelector('.dtts-fold-toggle'); if (t.getAttribute('aria-expanded') !== 'true') await click(t) }

// one page — no 基础 / 高级; every service row has a state word; a service another
// plugin registered is a plain row named by its label; cache fields save when left.
test('one page: service rows with state words, ⚠ only for problems, a registered service as a row; cache saves on edit',async () => {
  const f = fixture()
  await withDom(async root => {
    assert.equal(f.tabs.size,1)
    const tab = f.tabs.get('dsh-tts:voice'); assert.equal(tab.title,'语音后端'); assert.equal(tab.single,true)
    assert.equal(tab.component,f.slots.get('tts'))
    await act(async () => {root.render(React.createElement(tab.component))}); await settle()
    const text = () => document.body.textContent
    assert.equal(byLabel('启用配音').checked,true)
    assert.ok(row('Test Azure')); assert.doesNotMatch(text(),/密钥已保存|尚未测试|configured|不计费|Azure 语音/)
    assert.equal(document.querySelectorAll('.dtts-list .dtts-warn').length,0,'nothing is wrong, so no chip')
    assert.equal(button('基础'),undefined); assert.equal(button('高级'),undefined)
    const word = title => row(title).closest('.dtts-line').querySelector('.dtts-state, .dtts-warn')?.textContent
    // Opening the page checks the services whose check is free (a list request) once: 可用; a check that would synthesize waits for 测试.
    assert.deepEqual(f.calls.filter(c => c.method === 'testService').map(c => c.args.id).sort(),['azure-main','qwen-main'])
    assert.equal(word('Test Azure'),'可用'); assert.equal(word('Test Volcengine'),'未测试'); assert.equal(word('Fish Audio'),'未设置','a common provider is listed before it is set up')
    // A service another plugin registered reads as its label, never its raw id; it has no controls here.
    assert.equal(word('外部语音服务'),'可用'); assert.doesNotMatch(text(),/local:default/)
    assert.ok(button('停止') === undefined)
    // No text buttons on rows: ⋯ only (删除… inside it, UI standard R13); dashed ＋ without a label.
    for (const word of ['测试连接','编辑','复制','删除','添加服务','新建预设','指定给角色 ›','保存缓存设置']) assert.ok(button(word) === undefined, word)
    assert.ok(byLabel('Test Azure 更多操作')); assert.ok(byLabel('删除服务 Test Azure') === null, 'no resident delete'); assert.equal(byLabel('添加其他语音服务').textContent,''); assert.equal(byLabel('新建声音预设'),null)
    assert.ok(document.querySelector('select,details') === null, 'no native select / disclosure')
    assert.equal(document.querySelectorAll('.dtts-hint, .dtts-head p, .dtts-toggle-text small, .dtts-item-meta').length,0)
    assert.ok([...document.querySelectorAll('[role=tooltip]')].some(t => /设一次，所有卡通用/.test(t.textContent)))
    assert.equal(byLabel('声音预设 更多操作'),null)
    assert.equal(f.calls.some(c => c.method === 'voicePresets'),false)
    assert.match(byLabel('缓存用量').textContent,/42 B · 1 条/)
    const maxGB = document.querySelector('input[name="cacheMaxGB"]'), maxAge = document.querySelector('input[name="cacheMaxAgeDays"]')
    assert.equal(maxGB.value,'1'); assert.equal(maxAge.value,'30')
    const leave = async (input,value) => { await change(input,value); await act(async () => input[Object.keys(input).find(k => k.startsWith('__reactProps'))].onBlur({target:{value}})); await settle() }
    await leave(maxGB,'0.5'); await leave(maxAge,'7')
    assert.deepEqual(f.calls.filter(call => call.method === 'saveCacheSettings').map(c => c.args),[{cacheMaxGB:0.5,cacheMaxAgeDays:30},{cacheMaxGB:0.5,cacheMaxAgeDays:7}])
    assert.equal(f.calls.some(call => ['start','stop','restart','probeService'].includes(call.method)),false)
    assert.equal(f.calls.filter(call => call.method === 'testService').length,2,'checked once, not on every reload')
    const master = byLabel('启用配音')
    await click(master); assert.equal(master.checked,false); assert.equal(f.services.has('ttsClient'),false)
    await click(master); assert.equal(f.services.get('ttsClient').available(),true)
    await click('清空…'); await click('清空'); await settle(); assert.match(byLabel('缓存用量').textContent,/0 B · 0 条/)
    assert.equal(f.calls.some(call => call.method === 'synthesis'),false)
  })
  f.dispose(); assert.equal(f.tabs.size,0); assert.equal(f.slots.size,0)
})

test('a missing key or a failed test is a ⚠ chip on the row; the stylesheet has no accent bars',async () => {
  const f = fixture({external:false,configured:[{id:'azure-x',kind:'azure',label:'No Key',config:{region:'eastasia'}},{id:'qwen-main',kind:'qwen',label:'Test Qwen',config:{region:'cn'}}]})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    const chips = [...document.querySelectorAll('.dtts-list .dtts-warn')]
    assert.deepEqual(chips.map(c => c.textContent),['缺少 API Key'])
    assert.deepEqual(f.calls.filter(c => c.method === 'testService').map(c => c.args.id),['qwen-main'],'a service without its key is not checked')
    assert.ok(row('No Key').closest('.dtts-line').contains(chips[0]))
  })
  f.dispose()
  const css = await readFile(new URL('../src/client.css',import.meta.url),'utf8')
  assert.doesNotMatch(css,/h3::before|border-left: 2px solid var\(--dtts-accent\)/)
})

test('pronunciation dictionary: the page places the provided editor once (always shown) and preset edits invalidate voice clips',async () => {
  const props=[],f=fixture({readingsEditor:{render:p => {props.push(p);return React.createElement('section',{'aria-label':'发音字典'},'editor')}}}),events=[]
  try {
    await withDom(async root => {
      await act(async()=>root.render(React.createElement(f.tabs.get('dsh-tts:voice').component)));await settle()
      assert.equal(document.querySelectorAll('[aria-label="发音字典"]').length,1);assert.equal(typeof props.at(-1).call,'function')
      assert.ok(!document.querySelector('[aria-label="全局读音"], [aria-label="读音词典"]'),'no second dictionary')
      f.services.get('ttsClient').subscribe(event => events.push(event.type))
      await props.at(-1).call('editReading',{id:'default',expectedRevision:0,op:'add',entry:{forms:'名',reading:'な'}})
      assert.deepEqual(events,['readingsChanged'])
      assert.equal(f.calls.some(call=>call.method==='synthesis'),false)
    })
  } finally {f.dispose()}
})

test('browser speech is a free 语音服务 row: its system voices listed when opened, 试听 through the Tavern, absent without Tavern',async () => {
  const spoken = []
  let stops = 0
  const browserSpeech = {available:() => true,voices:async () => [{id:'Microsoft Xiaoxiao',label:'Microsoft Xiaoxiao',languages:['zh-CN']},{id:'Microsoft Nanami',label:'Microsoft Nanami',languages:['ja-JP']}],
    speak:line => { spoken.push(line); return new Promise(() => {}) },stop:() => { stops++ }}
  const f = fixture({browserSpeech})
  try {
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      const line = row('浏览器朗读')
      assert.ok(line,'listed with the other services')
      assert.equal(line.closest('.dtts-line').querySelector('.dtts-state').textContent,'可用')
      assert.equal(byLabel('系统声音'),null,'voices are read when the row opens')
      await click(line); await settle()
      assert.deepEqual([...byLabel('系统声音').querySelectorAll('.dtts-item-title')].map(n => n.textContent),['Microsoft Xiaoxiao','Microsoft Nanami'])
      await click(byLabel('试听「Microsoft Nanami」')); await settle()
      assert.deepEqual(JSON.parse(JSON.stringify(spoken)),[{voice:'Microsoft Nanami',language:'ja-JP',text:'こんにちは。ブラウザの読み上げの試聴です。'}])
      await click(byLabel('停止「Microsoft Nanami」')); assert.equal(stops,1)
      assert.equal(f.calls.some(call => ['synthesis','probeService','saveService'].includes(call.method)),false,'nothing to set up, no TTS job')
    })
  } finally {f.dispose()}
  const bare = fixture()
  try { await withDom(async root => { await act(async () => root.render(React.createElement(bare.tabs.get('dsh-tts:voice').component))); await settle()
    assert.equal(row('浏览器朗读'),undefined) }) } finally {bare.dispose()}
})

test('without optional sidebar only the settings fallback is registered',async () => {
  const f = fixture({sidebar:false})
  await Promise.resolve()
  assert.equal(f.tabs.size,0);assert.equal(f.slots.size,1);assert.ok(f.slots.has('tts'))
  assert.equal(f.services.get('ttsClient').apiVersion,1)
  f.dispose();assert.equal(f.slots.size,0)
})

test('add service: dashed ＋ → type → name / region / key; explicit test shows the result; save never tests; two instances of one type',async () => {
  const f = fixture({configured:[],external:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('添加其他语音服务'))
    assert.deepEqual([...document.querySelectorAll('.dtts-kind')].map(b => b.textContent),['自定义 Fish 协议','通义千问','Azure','Fish Audio','火山引擎','MiniMax','自定义语音服务'])
    await click(radio('协议类型','通义千问'))
    assert.equal(byLabel('显示名称').value,'通义千问'); assert.equal(checked('区域'),'中国内地')
    assert.ok(byLabel('服务 ID') === null) // ids are never shown
    const key = byLabel('API Key'); assert.equal(key.type,'password'); assert.equal(key.autocomplete,'new-password')
    // 测试 ends the API Key row (no 清除 before a key is stored).
    const keyRow = key.closest('.dtts-key-row'); assert.deepEqual([...keyRow.querySelectorAll('button')].map(b => b.textContent),['测试'])
    await click('测试'); await settle()
    assert.match(byLabel('测试结果').textContent,/缺少 API Key/)
    await change('API Key','sk-test'); await click('测试'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'probeService').at(-1).args,{id:'qwen',kind:'qwen',config:{region:'cn'},secrets:{key:'sk-test'}})
    assert.match(byLabel('测试结果').textContent,/可用 · \d+ 个音色/)
    await change('显示名称','我的千问'); await click('添加'); await settle()
    assert.deepEqual(f.calls.find(c => c.method === 'saveService').args,{id:'qwen',kind:'qwen',label:'我的千问',config:{region:'cn'},secrets:{key:'sk-test'}})
    assert.equal(f.calls.filter(c => c.method === 'probeService').length,2,'saving never makes a request to the provider')
    assert.ok(byLabel('API Key') === null); assert.ok(row('我的千问'))
    assert.equal(document.body.innerHTML.includes('sk-test'),false)
    // Click the row: the form opens right under it, key write-only.
    await click(row('我的千问'))
    assert.ok(row('我的千问').closest('li').querySelector('[aria-label="API Key"]') === byLabel('API Key'))
    // a saved service: × at the key field's end clears a stored key; no 测试 / 取消 / 保存 — each field saves when it is
    // left, and the row's state word is its 测试 (owner 11-08).
    assert.deepEqual([...byLabel('API Key').closest('.dtts-key-row').querySelectorAll('button')].map(b => b.getAttribute('aria-label')),['清除 API Key'])
    assert.equal(byLabel('API Key').value,''); assert.match(byLabel('API Key').placeholder,/已保存$/)
    const form = row('我的千问').closest('li').querySelector('.dtts-form')
    assert.deepEqual([...form.querySelectorAll('button')].map(b => b.textContent).filter(t => /取消|保存|测试/.test(t)),[])
    const saves = f.calls.filter(c => c.method === 'saveService').length
    await change('API Key','sk-new'); await settle()
    const resave = f.calls.filter(c => c.method === 'saveService').at(-1).args
    assert.equal(f.calls.filter(c => c.method === 'saveService').length,saves + 1,'leaving a field saves it')
    assert.deepEqual(resave.secrets,{key:'sk-new'}); assert.ok(resave.expectedRevision); assert.equal(resave.label,'我的千问')
    await click(byLabel('重新测试 我的千问')); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'testService').at(-1).args,{id:'qwen'},'the state word tests again')
    // A second 通义千问 gets its own id and credential.
    await click(byLabel('添加其他语音服务')); await click(radio('协议类型','通义千问'))
    assert.equal(byLabel('显示名称').value,'通义千问')
    await change('API Key','sk-two'); await click('添加'); await settle()
    assert.deepEqual(f.calls.filter(c => c.method === 'saveService').at(-1).args,{id:'qwen-2',kind:'qwen',label:'通义千问',config:{region:'cn'},secrets:{key:'sk-two'}})
    assert.ok(row('通义千问')); assert.ok(row('我的千问'))
    // ⋯ → 删除… → inline confirm → delete.
    await click(byLabel('我的千问 更多操作')); await click(menuItem('删除…')); assert.match(document.querySelector('.dtts-confirm').textContent,/删除「我的千问」？/)
    await click('删除'); await settle()
    assert.deepEqual(f.calls.find(c => c.method === 'deleteService').args.id,'qwen'); assert.ok(row('我的千问') === undefined)
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
  })
  f.dispose()
})

test('delete: unknown or existing usage asks again and then deletes with force',async () => {
  for (const [deleteGuard,question] of [['USAGE_UNKNOWN','不确定有没有人物在用「Test Qwen」，仍要删除？'],['SERVICE_IN_USE','还有 2 个人物在用「Test Qwen」，仍要删除？']]) {
    const f = fixture({external:false,deleteGuard})
    await withDom(async root => {
      await act(async () => {root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))}); await settle()
      await click(byLabel('Test Qwen 更多操作')); await click(menuItem('删除…')); await click('删除'); await settle()
      assert.equal(document.querySelector('.dtts-confirm').textContent.startsWith(question),true,deleteGuard)
      await click('仍要删除'); await settle()
      assert.deepEqual(f.calls.filter(c => c.method === 'deleteService').map(c => c.args.force),[undefined,true]); assert.ok(row('Test Qwen') === undefined)
    })
    f.dispose()
  }
})

test('generic return intent keeps payload for destination and marks consumption only on click',async () => {
  const intent = {toTab:'example:characters',label:'返回舞台设置',payload:{characterId:'character-7'},createdAt:Date.now()}
  const f = fixture({returnIntent:intent})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    assert.ok(byLabel('返回舞台设置'))
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),intent)
    await click(byLabel('返回舞台设置'))
    assert.deepEqual(JSON.parse(JSON.stringify(f.opened)),[{type:'example:characters'}])
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),{...intent,consumedBy:'dsh-tavern-tts'})
    assert.ok(byLabel('返回舞台设置') === null)
  })
  f.dispose()
})

test('return intent rejects malformed, expired, future and consumed values; unmount does not consume',async () => {
  const fresh = {toTab:'example:characters',label:'Return',payload:{characterId:'c'},createdAt:Date.now()}
  for (const intent of ['invalid',{}, {...fresh,createdAt:Date.now()-600001},{...fresh,createdAt:Date.now()+600001},{...fresh,consumedBy:'dsh-tavern-tts'},{...fresh,toTab:'javascript:alert(1)'}]) {
    const f = fixture({returnIntent:intent})
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      assert.ok(byLabel('Return') === null)
    })
    assert.equal(f.opened.length,0); f.dispose()
  }
  const f = fixture({returnIntent:fresh})
  await withDom(async root => { await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle(); assert.ok(byLabel('Return')) })
  assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),fresh); f.dispose()
})

// failure paths remain recoverable and never consume a newer opener's intent.
test('return intent survives failed navigation, ignores replacement and tolerates unavailable storage',async () => {
  const intent = {toTab:'example:characters',label:'Return',payload:{characterId:'c'},createdAt:Date.now()}
  const f = fixture({returnIntent:intent,failNavigation:true})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('Return'))
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),intent)
    assert.ok(byLabel('Return'));assert.match(byLabel('配音状态').textContent,/暂时无法返回/)
    const replacement = {...intent,payload:{characterId:'other'}}
    f.session.set('dsh:settings-return',JSON.stringify(replacement));await click(byLabel('Return'))
    assert.ok(byLabel('Return') === null)
    assert.deepEqual(JSON.parse(f.session.get('dsh:settings-return')),replacement)
  })
  f.dispose()
  const blocked = fixture({returnIntent:intent,blockedStorage:true})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(blocked.tabs.get('dsh-tts:voice').component)));await settle()
    assert.ok(byLabel('Return') === null)
  })
  blocked.dispose()
})

// Fish setup never synthesizes until explicit preview, and the free default is visible.
test('Fish service is a connection only and saves without synthesis',async () => {
  const f = fixture({configured:[],external:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    // Fish Audio is listed before it is set up; its row opens the key form.
    await click(row('Fish Audio'))
    // a connection only: the model is each figure's choice (素材库 人物 › 声音).
    assert.equal(byLabel('模型'),null)
    await change('API Key','fake-fish-key'); await click('添加'); await settle()
    const service = f.calls.find(c => c.method === 'saveService').args
    assert.equal(service.kind,'fish-audio');assert.deepEqual(service.config,{url:'https://api.fish.audio'})
    assert.equal(f.calls.some(c => c.method === 'synthesis'),false)
    assert.equal(document.body.innerHTML.includes('fake-fish-key'),false)
  })
  f.dispose()
})

// pick a preset; only 服务地址 and API Key show, the request and response sit under 高级.
test('自定义语音服务 starts from a preset, keeps the request and response under 高级 and saves the whole connection',async () => {
  const f = fixture({configured:[],external:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('添加其他语音服务')); await click(radio('协议类型','自定义语音服务'))
    assert.equal(radio('预设','OpenAI 兼容').getAttribute('aria-checked'),'true')
    const more = document.querySelector('.dtts-form details')
    assert.equal(more.open,false); assert.ok(more.contains(byLabel('请求体模板'))); assert.equal(more.contains(byLabel('Base URL')),false)
    await click(radio('预设','火山方舟 Agent Plan'))
    assert.equal(byLabel('Base URL').value,'https://openspeech.bytedance.com')
    await change('API Key','mock-plan-key'); await click('添加'); await settle()
    const saved = f.calls.find(c=>c.method==='saveService').args
    assert.equal(saved.kind,'openai-compatible'); assert.equal(saved.config.preset,'volc-agent-plan')
    assert.equal(saved.config.speechPath,'/api/v3/plan/tts/unidirectional'); assert.match(saved.config.headers,/X-Api-Key: \{\{key\}\}/)
    assert.deepEqual(saved.secrets,{key:'mock-plan-key'}); assert.equal(JSON.stringify(saved.config).includes('mock-plan-key'),false)
  })
  f.dispose()
})

test('Volcengine service form uses one new-console API Key and no App ID',async () => {
  const f = fixture({configured:[],external:false})
  await withDom(async root => {
    await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
    await click(byLabel('添加其他语音服务')); await click(radio('协议类型','火山引擎'))
    assert.equal(byLabel('App ID'),null)
    assert.equal(byLabel('Access Key'),null)
    assert.equal(byLabel('API Key').type,'password')
    await change('API Key','mock-new-console-key'); await click('添加'); await settle()
    assert.deepEqual(f.calls.find(c=>c.method==='saveService').args,{id:'volc',kind:'volcengine',label:'火山引擎',config:{resourceId:'seed-tts-2.0'},secrets:{key:'mock-new-console-key'}})
    assert.equal(f.calls.some(c=>c.method==='probeService' || c.method==='testService'),false)
    assert.equal(document.body.innerHTML.includes('mock-new-console-key'),false)
  })
  f.dispose()
})

// the figure voice page's 在线 TTS list hands over once — its dashed ＋ opens
// 添加语音服务 with 自定义语音服务 chosen; a custom row's 去设置 opens that very service, not the first of its type.
test('focus hand-over: add opens 添加语音服务 with the type chosen; an id opens that saved service',async () => {
  const configured = [{id:'openai',kind:'openai-compatible',label:'服务 A',config:{url:'https://a.example',speechPath:'/v1/audio/speech'}},{id:'openai-2',kind:'openai-compatible',label:'服务 B',config:{url:'https://b.example',speechPath:'/v1/audio/speech'}}]
  for (const [focus,check] of [
    [{kind:'openai-compatible',add:true},() => { assert.equal(checked('协议类型'),'自定义语音服务'); assert.equal(byLabel('显示名称').value,'自定义语音服务') }],
    [{kind:'openai-compatible',id:'openai-2'},() => { assert.equal(byLabel('显示名称').value,'服务 B'); assert.ok(row('服务 B').closest('li').contains(byLabel('显示名称'))) }]]) {
    const f = fixture({configured,external:false,focus})
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      check(); assert.equal(f.session.has('dsh-tts:focus-service'),false,'read once')
      assert.equal(f.calls.some(c => ['probeService','testService','saveService','synthesis'].includes(c.method)),false)
    })
    f.dispose()
  }
})

// 语音后端 — 语音合成 → (plugin sections: 语音识别) → 发音字典 → 合成缓存; 浏览器朗读 first and fixed. Who speaks with which voice
// (tts.reading) is chosen in 舞台设置 › 配音, so this page has no 朗读 section and no default engine.
test('语音后端 page: section order, 浏览器朗读 first and fixed, no 朗读 section or default engine',async () => {
  const browserSpeech = {available:() => true,voices:async () => [{id:'Microsoft Yunxi',label:'Microsoft Yunxi',languages:['zh-CN']}],speak:async () => {},stop:() => {}}
  const f = fixture({browserSpeech,readingsEditor:{render:() => React.createElement('div',null,React.createElement('h3',null,'发音字典'))}})
  try {
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      assert.equal(document.querySelector('.dtts-head h2').textContent,'语音后端')
      assert.ok(byLabel('语音后端 说明'))
      const headings = [...document.querySelectorAll('section h3')].map(h => h.querySelector('span')?.textContent || h.textContent)
      assert.deepEqual(headings,['语音合成','发音字典','合成缓存','创作者工具'])
      const first = document.querySelector('.dtts-list > li')
      assert.equal(first.querySelector('.dtts-line-title').textContent,'浏览器朗读')
      assert.equal(first.querySelector('.dtts-state').textContent,'可用')
      assert.equal(first.querySelector('[aria-haspopup=menu], .dtts-icon-button'),null,'no ⋯: it cannot be removed')
      assert.equal(document.querySelector('.dtts-reading'),null)
      for (const label of ['对白默认声音','旁白配音','旁白声音','默认语音引擎']) assert.equal(byLabel(label),null,label)
      assert.doesNotMatch(document.body.textContent,/对白默认声音|旁白声音|默认语音引擎|同类服务/)
      assert.equal(f.calls.some(c => ['reading','setReading','setDefaultService'].includes(c.method)),false)
    })
  } finally { f.dispose() }
})
// 创作者工具: one switch, off by default, writes only creator.enabled (the 启用配音 switch stays as it was).
test('创作者工具 switch: off by default, toggles only the creator setting', async () => {
  const f = fixture()
  try {
    await withDom(async root => {
      await act(async () => root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))); await settle()
      const toggle = byLabel('启用创作者工具')
      assert.equal(toggle.checked,false); assert.equal(toggle.getAttribute('role'),'switch')
      assert.ok(byLabel('创作者工具 说明'))
      await act(async () => toggle.click()); await settle()
      assert.equal(byLabel('启用创作者工具').checked,true)
      assert.deepEqual(f.calls.filter(c => c.method === 'setCreatorEnabled').map(c => c.args),[{enabled:true}])
      assert.equal(f.calls.some(c => c.method === 'setEnabled'),false)
      assert.equal(byLabel('启用配音').checked,true)
    })
  } finally { f.dispose() }
})
test('plugin sections mount, update and unregister without changing backend services', async () => {
  const f = fixture()
  try {
    await withDom(async root => {
      const registry = f.services.get('ttsPanelSections')
      const Panel = f.tabs.get('dsh-tts:voice').component
      await act(async () => root.render(React.createElement(Panel)))
      let off
      await act(async () => { off = registry.register('fixture', parts => {
        // the page's own parts, so a plugin's section (Tavern's 语音识别) looks like the page's
        for (const part of ['Section','Field','Line','Confirm','Help','Button','Menu','AddRow','StateWord','Status','Warn']) assert.equal(typeof parts[part], 'function', part)
        return React.createElement('div', { 'data-plugin-section': true }, 'Plugin section')
      }) })
      assert.equal(document.querySelector('[data-plugin-section]').textContent, 'Plugin section')
      assert.throws(() => registry.register('fixture', () => null), /Duplicate/)
      await act(async () => off())
      assert.equal(document.querySelector('[data-plugin-section]'), null)
    })
  } finally { f.dispose() }
})
// A self-hosted server row (a local worker) has no key to be wrong: nothing answering is 未启动, a refused token is 访问被拒绝, an answer is 可用;
// a cloud Fish row refused for its key still says API Key 无效.
test('a self-hosted Fish row reads 未启动 / 访问被拒绝 / 可用 and never an API Key problem; a cloud row keeps its key words',async () => {
  const rows = [{id:'fish-local',kind:'fish-audio',label:'本地 Drama3',config:{url:'http://127.0.0.1:9884'}},{id:'fish',kind:'fish-audio',label:'Fish Audio',config:{url:'https://api.fish.audio'}}]
  for (const [check,local,cloud] of [[{status:'offline',message:'没有连上服务，它可能还没有启动'},'未启动','连不上'],[{status:'rejected',message:'服务拒绝了这次访问'},'访问被拒绝','可用'],
    [{status:'connected',voiceCount:0},'可用','可用'],[{status:'invalid-key',message:'服务要求鉴权'},'API Key 无效','API Key 无效']]) {
    const f = fixture({configured:rows,external:false,testResult:p => p.id === 'fish-local' && check.status !== 'invalid-key' ? check : p.id === 'fish' && ['connected','invalid-key','offline'].includes(check.status) ? check : {status:'connected',voiceCount:0}})
    await withDom(async root => {
      await act(async () => {root.render(React.createElement(f.tabs.get('dsh-tts:voice').component))}); await settle()
      const word = title => row(title).closest('.dtts-line').querySelector('.dtts-state, .dtts-warn')?.textContent
      assert.equal(word('本地 Drama3'),check.status === 'invalid-key' ? '可用' : local)
      if (check.status !== 'connected') assert.doesNotMatch(row('本地 Drama3').closest('.dtts-line').textContent,/Key|密钥/)
      if (check.status === 'invalid-key') assert.equal(word('Fish Audio'),cloud)
    })
    f.dispose()
  }
})