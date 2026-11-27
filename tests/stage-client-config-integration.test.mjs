import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const factory=name=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name+'.cjs')
const {createStageConfigFields}=factory('config-fields')
const {createStageConfigScreen}=factory('config-screen')
const {createStageConfigText}=factory('config-text')
const {createStageConfigAppearance}=factory('config-appearance')
const {createStageMixer}=factory('mixer')
const {createStageDevice}=factory('device')
// entry.js wires the scene's frame-rate rule (read before the test installs a window, which hides Node exports).
const {galFrameRate}=factory('scene-math').createStageSceneMath({colorMath:require('../tavern-plugin/shared/color-math.cjs'),figureScale:require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')})
function store(value){
  const listeners=new Set()
  return {get:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:patch=>{value=typeof patch==='object'?{...value,...patch}:patch;listeners.forEach(fn=>fn())},listeners}
}
test('real React config switches tabs, edits shared preferences and unmounts without subscriptions',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
  const oldWindow=globalThis.window,oldDocument=globalThis.document,oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const document=dom.window.document,h=React.createElement
  const reading=store({textSpeed:28,autoWait:700,autoSpeed:1.3,textScale:{},frameCap:60,reducedMotion:false,photosensitive:true})
  const audio=store({master:1,voice:1,music:1,sfx:1,ambience:1,ui:1,muted:{},duck:true})
  audio.getSnapshot=audio.get
  audio.setDucking=value=>audio.set({duck:value});audio.toggleMute=layer=>audio.set({muted:{...audio.get().muted,[layer]:!audio.get().muted[layer]}})
  audio.setVolume=(layer,value)=>audio.set({[layer]:value})
  // The 画质 setting store resolved by the device module, as entry.js wires it: a desktop (no coarse pointer) is high.
  const mediaLists=new Set(),matchMedia=query=>{const list={matches:false,addEventListener(){mediaLists.add(list)},removeEventListener(){mediaLists.delete(list)}};return list}
  const device=createStageDevice({React,matchMedia,window:{navigator:{maxTouchPoints:0,userAgent:'test'}}})
  const qualityStore=store('auto'),quality=device.quality(qualityStore),sounds={play(){}},Icon=()=>null,ResetButton=props=>h('button',{onClick:props.onClick},props.label)
  const Slider=props=>h('input',{type:'range','aria-label':props.label,value:props.value,min:props.min,max:props.max,onChange:event=>props.onChange?.(Number(event.target.value))})
  const Segmented=props=>h('div',{role:'group','aria-label':props.label},props.options.map(([value,label])=>h('button',{key:value,onClick:()=>props.onChange(value)},label)))
  const fields=createStageConfigFields({React,Slider,Segmented,ResetButton,HelpTip:()=>null,sounds})
  const mixer=createStageMixer({React,fields,audio,Slider,Icon,sounds})
  const text=createStageConfigText({React,fields,reading,limits:{textSpeed:[0,80,2],autoWait:[0,3000,100]},defaults:{textSpeed:28},scale:[70,130,5],scaleOf:(r,id)=>r.textScale[id]||100,themes:[['classic','经典']],Typewriter:()=>null})
  const appearance=createStageConfigAppearance({React,fields,reading,quality,themes:[['classic','经典']],window:dom.window,document,Icon,ResetButton,sounds,frameRate:galFrameRate,handheld:()=>false})
  const screen=createStageConfigScreen({React,window:dom.window,document,sections:{},rpc:async()=>({mods:[]}),useSounds(){},sounds,Icon,Sound:mixer.Sound,Text:text.Text,Appearance:appearance.Appearance,Looks:fields.Looks})
  const root=createRoot(document.getElementById('root'))
  const click=async label=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent===label||n.getAttribute('aria-label')===label);assert.ok(node,label);await act(async()=>node.click())}
  const choose=async(label,word)=>{const node=[...document.querySelectorAll('[aria-label="'+label+'"] button')].find(n=>n.textContent===word);assert.ok(node,label+word);await act(async()=>node.click())}
  try {
    await act(async()=>root.render(h(React.StrictMode,null,h(screen.Screen,{sessionId:'s',data:{config:{stage:{}}},onClose(){}}))))
    assert.ok(document.querySelector('[aria-label="各层音量"]'))
    // 自动混音 is a 关 | 开 choice (a toggle without a drawn look reads as the segmented choice)
    await choose('自动混音','关');assert.equal(audio.get().duck,false)
    await click('文字');assert.ok(document.querySelector('[aria-label="文字速度"]'))
    assert.equal(document.querySelector('[aria-label="各层音量"]'),null)
    await click('画面');await choose('减少动态','开');assert.equal(reading.get().reducedMotion,true)
    assert.equal(quality.get(),'high')
    await click('中');assert.equal(qualityStore.get(),'medium');assert.equal(quality.get(),'medium')
    await click('自动');assert.equal(qualityStore.get(),'auto');assert.equal(quality.get(),'high')
    appearance.dispose();mixer.dispose();text.dispose();screen.dispose();fields.dispose()
    await choose('减少动态','开');assert.equal(reading.get().reducedMotion,true)
  } finally {
    await act(async()=>root.unmount())
    appearance.dispose();mixer.dispose();text.dispose();screen.dispose();fields.dispose()
    dom.window.close();globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct
  }
  assert.equal(reading.listeners.size,0);assert.equal(audio.listeners.size,0);assert.equal(qualityStore.listeners.size,0);assert.equal(mediaLists.size,0)
})
