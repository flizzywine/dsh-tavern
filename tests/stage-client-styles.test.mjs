import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import {checkCssSyntax} from '../bin/lib/css-syntax-guard.mjs'

test('stage theme retains its cascade position and all stage styles leave on unload', async () => {
  const nodes = []
  const document = {
    head:{appendChild(node) {nodes.push(node)},insertBefore(node,anchor) {const at=nodes.indexOf(anchor); nodes.splice(at < 0 ? nodes.length : at,0,node)}},
    createElement:() => ({dataset:{},textContent:'',remove() {const at=nodes.indexOf(this); if(at >= 0) nodes.splice(at,1)}}),
    querySelector(selector) {const id=selector.match(/data-plugin-css="([^"]+)"/)?.[1];return nodes.find(node => node.dataset.pluginCss===id) || null},
    querySelectorAll(selector) {const node=this.querySelector(selector);return node ? [node] : []}
  }
  const install = vm.runInNewContext(await readFile(new URL('../tavern-plugin/src/client/stylesheet.js',import.meta.url),'utf8') + '\ninstallTavernStylesheet',{})
  install(document,'base',['before','after'])
  let plugin, stop
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js',import.meta.url),'utf8'), {
    document,window:{__ModuleLoader__:{load(value) {plugin=value.factory()}}}
  })
  plugin.apply({get:() => ({mount:() => () => {}}),effect:run => {stop=run()}})
  assert.deepEqual(nodes.map(node => node.dataset.pluginCss),[
    'dsh-tavern-plugin/tavern.css','dsh-tavern-plugin/features.css',
    'dsh-tavern-stage/themes.css','dsh-tavern-plugin/features-after-stage.css','dsh-tavern-stage/presentation.css'
  ])
  install(document,'base refreshed',['before refreshed','after refreshed'])
  assert.equal(nodes[2].dataset.pluginCss,'dsh-tavern-stage/themes.css','refreshing core CSS preserves the slot')
  stop()
  assert.deepEqual(nodes.map(node => node.textContent),['base refreshed','before refreshed','after refreshed'])
})

test('plugin style source blocks are structurally valid CSS', async () => {
  for (const name of ['themes.css','phone.css','textcard.css']) {
    const css=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name,import.meta.url),'utf8')
    assert.doesNotThrow(() => checkCssSyntax(css,name))
  }
})
