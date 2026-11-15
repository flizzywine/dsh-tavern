import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import {clientSourceUrl} from './helpers/client-source.mjs'
const read=name=>readFile(clientSourceUrl(name),'utf8')
const card=await read('asset-pack-card-ui.js'),widgets=await read('asset-pack-widgets.js'),voice=await read('asset-pack-voice-ui.js'),entry=await read('asset-pack-entry-ui.js')
const inline=await read('inline-field.js') // SwitchRow's switch is Switch
const slice=(source,from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);return source.slice(start,end)}

// the 配音 row is rendered for real (React + jsdom): 「配音 › …… ⚠ 去设置 [switch]」, the row and the 「›」 open the 配音
// page, the ⚠ lists one line per figure that cannot speak (cast order), 「去设置」 opens the first figure's 声音 page,
// and the ⚠ neither blinks across re-reads nor outlives the failure it reports.
async function mount(t) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>')
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:false})
  const React=(await import('react')).default,{createRoot}=await import('react-dom/client')
  const h=React.createElement
  const sandbox={React,h,setTimeout,clearTimeout,Help:()=>null,Glyph:({name})=>h('i',{'data-glyph':name}),voiceErrorText:e=>String(e?.message||e),
    Button:({children,...p})=>h('button',{type:'button',...p},children),stageSwitchTag:(ctx,key,name,disabled)=>h('button',{role:'switch','aria-label':name,disabled,'aria-checked':ctx.prefs.voice})}
  const figure=(id,name,extra={})=>({ref:{packId:'pack',figureId:id},pack:{revision:'r1',manifest:{}},figure:{name,enabled:true,voice:{voice:'v'},...extra}})
  // cast order: 豆包 before Claude 娘 (not alphabetical); 'off' and 'muted' are never read.
  const rows=[figure('doubao','豆包'),figure('off','Off',{enabled:false}),figure('claude','Claude 娘'),figure('muted','Muted',{voice:{voice:'v',source:null}}),figure('ok','Browser')]
  sandbox.stageFigureRows=()=>rows
  sandbox.narratorLayers=(ext,reading)=>({effective:{enabled:!!reading?.narrator?.enabled}})
  vm.runInNewContext([slice(entry,'const previewFailure=','function previewAudioError('),slice(voice,'function useVoiceLoad(','function voiceTts('),slice(voice,'function useVoiceRefresh(','function useVoiceModelStatus('),
    slice(inline,'function Switch(','function Segmented('),slice(widgets,'function SwitchRow(','// Small anchored menu'),slice(card,'const STAGE_VOICE_REASONS=','const stageNeedText'),slice(card,'const STAGE_POINTERS=','// 通用声音 / 旁白\'s one row'),slice(voice,'const READING_ROLES=','// ⋯ → 换成本包其他声音或模板…'),
    slice(card,'const pressRowJump=','// The voices that cannot speak')].join('\n')+
    ';this.StageVoiceRow=StageVoiceRow;this.StageVoiceProblems=StageVoiceProblems',sandbox)
  // state.reading: tts.reading (which figure 通用声音 / 旁白 point at); the figures they may point at are in the unlit pack 'voices'.
  const listeners=new Set(),calls=[],opened=[],state={issues:{},reading:{general:{figure:null},narrator:{enabled:false,figure:null}},hold:null,fail:false,opened:0}
  const voices={revision:'v1',manifest:{id:'voices'},figures:{tongyong:{name:'通用',enabled:true,voice:{voice:'v'}},pangbai:{name:'旁白人',enabled:true,voice:{voice:'v'}}}}
  const binding={tts:{subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},call:async method=>{assert.equal(method,'reading');return structuredClone(state.reading)}},
    service:{getPackSnapshot:async({packId})=>packId==='voices'?voices:Promise.reject(Object.assign(Error('gone'),{code:'ASSET_UNAVAILABLE'}))},
    rpc:async(method,ref)=>{calls.push(ref.figureId);if(state.hold)await state.hold;if(state.fail)throw Error('offline');return {issues:state.issues[ref.figureId]||[]}}}
  const ctx={binding,ttsState:'ok',engine:{revision:1},nav:{openTab:tab=>opened.push(['tab',tab]),openLibrary:at=>opened.push(['library',at.kind])},active:{dialogue:true},prefs:{dialogue:true,voice:true},ext:{},writer:{reading:null,pack:()=>undefined},
    onVoice:()=>{state.opened++},openPack:(...args)=>opened.push(args)}
  const root=createRoot(document.getElementById('root'))
  // No act() in this React build: let the scheduler and pending reads run.
  const settle=()=>new Promise(r=>setTimeout(r,30))
  const render=async(next,Component=sandbox.StageVoiceRow)=>{root.render(h(Component,{ctx:next||ctx}));await settle()}
  const emit=async(type='modelValidationChanged')=>{for(const fn of listeners)fn({type});await settle()}
  const mark=()=>document.querySelector('.ap-hint-line .ap-hint-mark')
  const chip=()=>document.querySelector('.ap-hint-chip')
  t.after(async()=>{root.unmount();await settle();dom.window.close()})
  return {sandbox,ctx,state,calls,opened,render,settle,emit,mark,chip,at:figureId=>({packId:'voices',figureId})}
}

test('stage voice row: the row and 「›」 open the 配音 page, ⚠ + 去设置 sit after the 「›」 for a current failure only',async t=>{
  const {ctx,state,calls,render,settle,emit,mark}=await mount(t)
  await render();await settle()
  assert.deepEqual(calls.sort(),['claude','doubao','ok'],'only enabled, voiced figures are read')
  assert.equal(mark(),null,'no failure: no ⚠')
  const jump=document.querySelector('button.ap-kind-jump')
  assert.ok(jump,'the 「›」 is always there');assert.equal(jump.getAttribute('aria-label'),'配音设置')
  assert.equal(document.querySelector('[role=switch]').getAttribute('aria-checked'),'true')
  jump.click();assert.equal(state.opened,1)
  document.querySelector('.ap-switch-name').click()
  assert.equal(state.opened,2,'the name opens the 配音 page')
  document.querySelector('.ap-switch-row').click()
  assert.equal(state.opened,3,'so does the row')
  state.issues={claude:[{code:'QWEN_MODEL_NOT_FOUND',field:'model'}]};await emit();await settle()
  assert.equal(mark()?.getAttribute('aria-label'),'Claude 娘：模型无法访问')
  // The ⚠ is the compact HintLine (CSS puts it right before the switch tag, like the 模组 rows), after the 「›」.
  const main=document.querySelector('.ap-switch-main'),kids=[...main.children]
  assert.ok(kids.indexOf(main.querySelector('.ap-hint-line'))>kids.indexOf(jump),'⚠ follows the 「›」')
  assert.equal(document.querySelector('.ap-switch-warn'),null,'no ⚠ glued to the name')

  // Synthesis events and engine/pack re-renders re-read in place: the ⚠ stays put while a read is pending.
  for(let i=0;i<5;i++){
    let release;state.hold=new Promise(r=>{release=r})
    await emit();assert.ok(mark(),'still shown while re-reading (event '+i+')')
    await render({...ctx,engine:{revision:2+i}});assert.ok(mark(),'still shown across a re-render (event '+i+')')
    release();state.hold=null;await settle();assert.ok(mark(),'still shown after the read (event '+i+')')
  }

  state.issues={};await emit();await settle()
  assert.equal(mark(),null,'a model restored to a working one clears the ⚠ on the next read')
  state.issues={claude:[{code:'SERVICE_OFFLINE'}]};await emit();await settle()
  assert.equal(mark(),null,'network/list failures are not model evidence')
  state.fail=true;await emit();await settle()
  assert.equal(mark(),null)
})

test('stage voice row: one line per broken figure in cast order, 去设置 opens the first figure on its 声音 page',async t=>{
  const {ctx,state,opened,render,settle,mark,chip}=await mount(t)
  state.issues={claude:[{code:'SERVICE_REQUIRED'}],doubao:[{code:'SERVICE_REQUIRED'}]}
  await render();await settle()
  assert.equal(mark().getAttribute('aria-label'),'豆包：音色用的服务还没配置\nClaude 娘：音色用的服务还没配置','cast order, short reasons, no codes')
  assert.equal(mark().getAttribute('title'),mark().getAttribute('aria-label'))
  assert.equal(chip().textContent,'去设置')
  chip().click()
  assert.deepEqual(opened,[['pack','figures','doubao','voice']],'the first problem figure, on its 声音 page')
  assert.equal(state.opened,0,'the chip does not open the 配音 page')
  // No cloud service at all: a browser-speech figure has no issue from the host, so nothing warns.
  state.issues={};await render({...ctx,engine:{revision:9}});await settle()
  assert.equal(mark(),null)
})

test('stage voice row: more than five problems end with 「还有 N 个」; the 配音 page lists each with its own 去设置',async t=>{
  const {sandbox,ctx,state,opened,render,settle,mark}=await mount(t)
  const many=Array.from({length:7},(_,i)=>({ref:{packId:'pack',figureId:'f'+i},pack:{revision:'r1',manifest:{}},figure:{name:'人物'+i,enabled:true,voice:{voice:'v'}}}))
  sandbox.stageFigureRows=()=>many
  state.issues=Object.fromEntries(many.map(r=>[r.ref.figureId,[{code:'SERVICE_REQUIRED'}]]))
  await render();await settle()
  const lines=mark().getAttribute('aria-label').split('\n')
  assert.equal(lines.length,6);assert.equal(lines[5],'还有 2 个')
  await render(ctx,sandbox.StageVoiceProblems);await settle()
  const chips=[...document.querySelectorAll('.ap-voice-problems .ap-hint-chip')]
  assert.equal(chips.length,5)
  assert.match(document.querySelector('.ap-voice-problems').textContent,/人物2：音色用的服务还没配置.*还有 2 个/)
  chips[2].click()
  assert.deepEqual(opened.at(-1),['pack','figures','f2','voice'])
})

test('stage voice row: the figures 通用声音 / 旁白 point at warn after the cast under their names and open that figure; one gone opens the 素材库',async t=>{
  const {ctx,state,opened,render,settle,emit,mark,chip,at}=await mount(t)
  // both on one figure: one line, both names.
  state.reading={general:{figure:at('tongyong')},narrator:{enabled:true,figure:at('tongyong')}}
  state.issues={tongyong:[{code:'SERVICE_REQUIRED'}]}
  const writer={...ctx.writer,reading:{narrator:{enabled:true}}}
  await render({...ctx,writer});await settle()
  assert.equal(mark().getAttribute('aria-label'),'通用声音、旁白：音色用的服务还没配置')
  chip().click();assert.deepEqual(opened,[['voices','figures','tongyong','voice']],'that figure, on its 声音 page');assert.equal(state.opened,0)
  state.issues={claude:[{code:'SERVICE_REQUIRED'}],tongyong:[{code:'SERVICE_REQUIRED'}]};await render({...ctx,writer,engine:{revision:5}});await settle()
  assert.equal(mark().getAttribute('aria-label'),'Claude 娘：音色用的服务还没配置\n通用声音、旁白：音色用的服务还没配置','figures first')
  // 旁白 on a figure that is gone: its own line; 去设置 opens the 素材库's 人物.
  state.issues={};state.reading={general:{figure:null},narrator:{enabled:true,figure:{packId:'removed-pack',figureId:'x'}}};await emit('readingChanged');await render({...ctx,writer,engine:{revision:6}});await settle()
  assert.equal(mark().getAttribute('aria-label'),'旁白：找不到所选人物，重新选')
  opened.length=0;chip().click();assert.deepEqual(opened,[['library','figures']])
  // 旁白 off: its figure is not checked; none chosen and browser voices never warn.
  await render({...ctx,writer:{...writer,reading:{narrator:{enabled:false}}},engine:{revision:7}});await settle()
  assert.equal(mark(),null)
})

test('a finished synthesis is not a pack change (no stage reload → re-synthesis → event loop)',async()=>{
  const launcher=await read('asset-launcher.js'),body=slice(launcher,"get('ttsClient').subscribe(",'const offRate')
  assert.ok(body.indexOf("modelValidationChanged') return")>=0&&body.indexOf("modelValidationChanged') return")<body.indexOf('notifyPackChange(event)'))
})
test('stage voice row: the voice plugin off is the one card-wide ⚠; 去设置 opens 语音后端',async t=>{
  const {ctx,opened,render,settle,mark,chip}=await mount(t)
  await render({...ctx,ttsState:'off'});await settle()
  assert.equal(mark()?.getAttribute('aria-label'),'配音插件未启用')
  chip().click()
  assert.deepEqual(opened,[['tab','dsh-tts:voice']])
})
