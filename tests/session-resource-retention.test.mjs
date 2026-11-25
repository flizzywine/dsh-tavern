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

test('隐藏期间卡片把悬浮窗挂回 body 时不再抢回，页面不会卡死', async () => {
  const {JSDOM}=await import('jsdom')
  const dom=new JSDOM('<body><main id="app"></main></body>',{runScripts:'outside-only'})
  try {
    dom.window.eval(scopeSource+';window.makeScope=createTavernHostArtifactScope')
    const document=dom.window.document, artifacts=dom.window.makeScope({document})
    const panel=artifacts.trackNode(document.createElement('div'));panel.id='card-panel'
    document.body.append(panel)
    await new Promise(resolve=>setTimeout(resolve))
    // The card's own guard: whenever its panel leaves the document, put it back.
    let reattached=0
    new dom.window.MutationObserver(()=>{ if(!panel.isConnected&&reattached<50){reattached++;document.body.append(panel)} }).observe(document.body,{childList:true})
    artifacts.setVisible(false)
    await new Promise(resolve=>setTimeout(resolve,20))
    assert.equal(reattached,1)
    assert.equal(panel.parentNode,document.body)
    assert.equal(panel.hidden,true)
    artifacts.setVisible(true)
    assert.equal(panel.parentNode,document.body)
    assert.equal(panel.hidden,false)
    assert.equal(document.querySelectorAll('#card-panel').length,1)
  } finally {dom.window.close()}
})

test('重复把已挂载的卡片 iframe 加到 body 时保留文档和 DOM 顺序', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body><main></main><iframe></iframe></body>', { runScripts: 'outside-only' })
  try {
    const { window } = dom
    const { body } = window.document
    window.eval(scopeSource + ';window.makeScope=createTavernHostArtifactScope')
    const composer = readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js', import.meta.url), 'utf8')
    window.eval(composer + ';window.makeWindow=createTavernComposerWindow')
    const script = body.querySelector('iframe')
    const artifacts = window.makeScope({ document: window.document })
    script.__dshTavernHostArtifacts = artifacts
    window.eval(readFileSync(new URL('../tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js', import.meta.url), 'utf8'))
    script.contentWindow.jQuery = artifacts.bindJQuery(window.jQuery)
    const view = window.makeWindow(script.contentWindow, window).parent, host = view.document

    const phone = host.createElement('iframe')
    host.body.append(phone)
    const content = phone.contentDocument
    const observer = new window.MutationObserver(() => {})
    observer.observe(body, { childList: true })
    assert.notEqual(phone.parentElement, host.body)
    for (let i = 0; i < 5; i++) {
      if (phone.parentElement !== host.body) host.body.append(phone)
      assert.equal(host.body.appendChild(phone), phone)
      assert.equal(host.body.insertBefore(phone, null), phone)
      view.$('body').append(phone)
      view.$(phone).appendTo(host.body)
    }
    assert.equal(observer.takeRecords().length, 0, '现有 iframe 已在末尾，不触发重复挂载')
    assert.equal(phone.contentDocument, content)

    const unrelated = window.document.createElement('aside')
    body.append(unrelated)
    let moved = 0
    body.moveBefore = (node, before) => {
      assert.equal(node, phone)
      assert.equal(before, null)
      moved++
    }
    assert.equal(host.body.appendChild(phone), phone)
    assert.equal(moved, 1, '需要调整顺序时走保留 iframe 文档的移动入口')
    observer.disconnect()
    artifacts.dispose()
    assert.equal(phone.isConnected, false)
    assert.equal(unrelated.isConnected, true)
  } finally {
    dom.window.close()
  }
})

test('显式移除停放的悬浮窗后不再恢复，未挂载节点也可稍后登记', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body><main></main></body>', { runScripts: 'outside-only' })
  try {
    const { window } = dom, { document } = window
    window.eval(scopeSource + ';window.makeScope=createTavernHostArtifactScope')
    const scope = window.makeScope({ document })
    const removed = scope.trackNode(document.createElement('div'))
    const delayed = scope.trackNode(document.createElement('div'))
    document.body.append(removed)
    scope.setVisible(false)
    removed.remove()
    document.body.append(delayed)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(removed.hasAttribute('data-dsh-tavern-host-artifact'), false)
    assert.equal(delayed.isConnected, false)
    scope.setVisible(true)
    assert.equal(removed.isConnected, false)
    assert.equal(delayed.isConnected, true)
    scope.dispose()
    assert.equal(delayed.isConnected, false)
  } finally { dom.window.close() }
})
