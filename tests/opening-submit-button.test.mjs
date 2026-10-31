import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import {readFile} from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
test('opening button sends only on click, awaits acceptance, deduplicates and permits retry after failure', async () => {
  let descriptor, cursor = 0
  const values = []
  const React = {
    useRef(value) { const at=cursor++; return values[at] ||= {current:value} },
    useState(value) { const at=cursor++; if (!(at in values)) values[at]=value; return [values[at],next=>{values[at]=next}] },
    useLayoutEffect() {},
    createElement(type,props,...children) {return {type,props:props||{},children}}
  }
  const start=source.indexOf('function TavernPreparedScriptMessage(props) {')
  const end=source.indexOf('function TavernLegacyGreeting(props)',start)
  const component=vm.runInNewContext('('+source.slice(start,end).trim()+')',{React})
  const calls=[]; let resolve,reject
  function render() {
    cursor=0
    return component({pendingOpening:true,sessionId:'original',preparedText:'neutral exact prompt',executeSlash:(...args)=>{calls.push(args);return new Promise((yes,no)=>{resolve=yes;reject=no})}})
  }
  function button(node) {if(node?.type==='button')return node; for(const child of node?.children||[]){const found=button(child);if(found)return found}}
  let b=button(render())
  assert.equal(calls.length,0)
  const first=b.props.onClick(); await b.props.onClick()
  assert.equal(calls.length,1)
  assert.equal(calls[0][1],'original')
  assert.equal(calls[0][2].inputText,'neutral exact prompt')
  b=button(render()); assert.equal(b.children[0],'正在提交…'); assert.equal(b.props.disabled,true)
  reject(new Error('not admitted')); await first
  b=button(render()); assert.equal(b.children[0],'发送卡片消息'); assert.equal(b.props.disabled,false)
  const second=b.props.onClick(); resolve({submitted:true}); await second
  b=button(render()); assert.equal(b.children[0],'已提交'); assert.equal(b.props.disabled,true)
})
