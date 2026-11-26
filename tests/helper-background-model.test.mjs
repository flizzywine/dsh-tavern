import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/helper-model.js', import.meta.url), 'utf8')
const install = vm.runInNewContext(source + '; installTavernBackgroundModel', { URL, Object, Promise, JSON, Proxy, WeakSet })

test('MVU settings expose the usable host proxy without persisting its adapter credential', async () => {
  const calls=[]
  const dom=new JSDOM('<body></body>',{url:'https://host.invalid'}), w=dom.window
  w.Response=Response;w.fetch=async()=>{throw Error('must not contact external API')}
  const bridge=install({window:w,request:async(...args)=>{calls.push(args);return {text:'ok'}}})
  try {
    const saved={更新方式:'额外模型解析',额外模型解析配置:{密钥:'private',api地址:'https://saved.invalid/v1',模型名称:'saved',模型来源:'与插头相同',温度:0.5}}
    const visible=bridge.projectMvuSettings(saved), config=visible.额外模型解析配置
    assert.equal(config.密钥,'host-managed')
    assert.equal(config.模型来源,'自定义')
    const response=await w.fetch(config.api地址+'/chat/completions',{method:'POST',body:JSON.stringify({model:config.模型名称,messages:[{role:'user',content:'neutral'}]})})
    assert.equal((await response.json()).choices[0].message.content,'ok')
    assert.equal(calls.length,1)
    assert.deepEqual(JSON.parse(JSON.stringify(visible)),saved)
    const parsed={...visible,额外模型解析配置:{...config,密钥:config.密钥,api地址:config.api地址,模型名称:config.模型名称,模型来源:config.模型来源,温度:0.7}}
    const restored=bridge.normalizeMvuSettings(parsed,saved)
    assert.equal(restored.额外模型解析配置.密钥,'private')
    assert.equal(restored.额外模型解析配置.温度,0.7)
  } finally {w.close()}
})

test('only the official MVU core sees the host settlement mode override', () => {
  const dom = new JSDOM('<body></body>')
  let context = { mvuSettlement: 'host' }
  const bridge = install({ window: dom.window, context: () => context })
  try {
    const saved = { 更新方式: '额外模型解析', 额外模型解析配置: { 温度: 0.5 } }
    const publicSettings = bridge.projectMvuSettings(saved)
    const officialSettings = bridge.projectMvuSettings(saved, true)
    assert.equal(publicSettings.更新方式, '额外模型解析')
    assert.equal(officialSettings.更新方式, '随AI输出')
    const updated = { ...saved, 更新方式: '随AI输出' }
    assert.equal(bridge.normalizeMvuSettings(updated, saved).更新方式, '随AI输出')
    assert.equal(bridge.normalizeMvuSettings(updated, saved, true).更新方式, '额外模型解析')
    context = { mvuSettlement: 'script' }
    assert.equal(officialSettings.更新方式, '额外模型解析')
  } finally { dom.window.close() }
})
