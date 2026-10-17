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
