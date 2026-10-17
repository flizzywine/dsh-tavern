import test from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const scopeSource = source.slice(source.indexOf('function createTavernHostArtifactScope(options)'), source.indexOf('const TAVERN_CARD_PHONE_HOST'))

test('原生 insertAdjacentHTML 悬浮窗随对话隐藏，恢复同一节点与事件，后台插入也隔离', async () => {
  const {JSDOM}=await import('jsdom')
  const dom=new JSDOM('<body><main id="app"></main><iframe></iframe></body>',{runScripts:'outside-only'})
  try {
    dom.window.eval(scopeSource+';window.makeScope=createTavernHostArtifactScope')
    const composer=readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js',import.meta.url),'utf8')
    dom.window.eval(composer+';window.makeWindow=createTavernComposerWindow')
    const frame=dom.window.document.querySelector('iframe'), artifacts=dom.window.makeScope({document:dom.window.document})
    frame.__dshTavernHostArtifacts=artifacts
    const view=dom.window.makeWindow(frame.contentWindow,dom.window)
    // Exact mounting API used by the configuration assistant's pet launcher.
    view.parent.document.body.insertAdjacentHTML('beforeend','<button id="pet">pet</button>')
    const pet=dom.window.document.getElementById('pet');let clicks=0
    pet.addEventListener('click',()=>clicks++)
    artifacts.setVisible(false)
    assert.equal(dom.window.document.getElementById('pet'),null)
    view.top.document.body.insertAdjacentHTML('beforeend','<button id="late">late</button>')
    assert.equal(dom.window.document.getElementById('late'),null)
    assert.equal(view.parent.document.getElementById('pet'),pet)
    assert.equal(view.parent.getComputedStyle(view.parent.document.body).display,'block')
    assert.ok(view.parent.document.getElementById('late'))
    const unrelated=dom.window.document.createElement('aside');dom.window.document.body.append(unrelated)
    artifacts.setVisible(true)
    assert.equal(dom.window.document.getElementById('pet'),pet)
    pet.click();assert.equal(clicks,1)
    assert.ok(dom.window.document.getElementById('late'))
    artifacts.dispose();assert.equal(pet.isConnected,false);assert.equal(unrelated.isConnected,true)
    view.parent.document.body.insertAdjacentHTML('beforeend','<div id="retired-native"></div>')
    assert.equal(dom.window.document.getElementById('retired-native'),null)
  } finally {dom.window.close()}
})

test('浏览器原生 HTML 悬浮窗切换后不可见，切回可点击且不重复', async t => {
  const {chromium}=await import('playwright')
  const browser=await chromium.launch();t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent('<body><iframe></iframe></body>')
  const composer=readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js',import.meta.url),'utf8')
  await page.evaluate(({scopeSource,composer})=>{
    window.eval(scopeSource+';window.makeScope=createTavernHostArtifactScope')
    window.eval(composer+';window.makeWindow=createTavernComposerWindow')
    const frame=document.querySelector('iframe')
    window.artifacts=makeScope({document});frame.__dshTavernHostArtifacts=artifacts
    window.card=makeWindow(frame.contentWindow,window)
    card.parent.document.body.insertAdjacentHTML('beforeend','<button id="pet" style="position:fixed;right:10px;bottom:10px">悬浮窗</button>')
    window.clicks=0;document.querySelector('#pet').onclick=()=>clicks++
  },{scopeSource,composer})
  await page.getByRole('button',{name:'悬浮窗'}).click()
  await page.evaluate(()=>artifacts.setVisible(false))
  assert.equal(await page.locator('#pet').count(),0)
  await page.evaluate(()=>{
    card.parent.document.body.insertAdjacentHTML('beforeend','<div id="late">后台弹窗</div>')
    card.parent.document.getElementById('pet').dataset.saved='yes'
    artifacts.setVisible(true)
  })
  await page.getByRole('button',{name:'悬浮窗'}).click()
  assert.equal(await page.evaluate(()=>clicks),2)
  assert.equal(await page.locator('#pet').count(),1)
  assert.equal(await page.locator('#pet').getAttribute('data-saved'),'yes')
  await page.evaluate(()=>artifacts.dispose())
  assert.equal(await page.locator('#pet,#late').count(),0)
})

test('切走对话时关闭该对话的状态栏 iframe，消息卡片保留，切回后重新创建', async () => {
  const {JSDOM}=await import('jsdom')
  const dom=new JSDOM('<body><main id="home"></main></body>',{runScripts:'outside-only',pretendToBeVisual:true})
  try {
    const read=name=>readFileSync(new URL('../tavern-plugin/src/client/modules/'+name,import.meta.url),'utf8')
    dom.window.eval(read('session-resource-retention.js')+';window.makeRetention=createTavernSessionRetention')
    dom.window.eval('function clampTavernFrameHeight(v){return v}function tavernFrameHeightKey(){return "k"}function bindTavernFontZoom(){return function(){}}function expandTavernFrame(){}'+read('retained-message-frames.js')+';window.makeFrames=createRetainedTavernFrames')
    // JSDOM lacks moveBefore; the retained frames only need its move semantics here.
    dom.window.Element.prototype.moveBefore=function(node,child){this.insertBefore(node,child)}
    const retention=dom.window.makeRetention({window:dom.window,durationMs:60000})
    const lifecycle=()=>({snapshot:()=>({height:100,visibleDocument:null,pendingDocument:null}),start:()=>()=>{},update(){}})
    const frames=dom.window.makeFrames({window:dom.window,retention,createLifecycle:lifecycle})
    const home=dom.window.document.getElementById('home')
    retention.select('a')
    const status=frames.mount({sessionId:'a',persistent:true,panelId:'status',partIndex:0},home)
    const card=frames.mount({sessionId:'a',turn:3,partIndex:0,content:'<p>x</p>'},home)
    assert.equal(frames.has({sessionId:'a',persistent:true,panelId:'status',partIndex:0}),true)
    retention.select('b')
    assert.equal(frames.has({sessionId:'a',persistent:true,panelId:'status',partIndex:0}),false)
    assert.equal(frames.has({sessionId:'a',turn:3,partIndex:0}),true)
    status.detach();card.detach()
    retention.select('a')
    frames.mount({sessionId:'a',persistent:true,panelId:'status',partIndex:0},home)
    assert.equal(frames.has({sessionId:'a',persistent:true,panelId:'status',partIndex:0}),true)
  } finally {dom.window.close()}
})
