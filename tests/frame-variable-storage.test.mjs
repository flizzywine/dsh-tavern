import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'
import { readFile } from 'node:fs/promises'
const lodash = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js', import.meta.url), 'utf8')
const source = await readFile(process.env.FRAME_TEST_CLIENT || new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function fixture() {
  let descriptor
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(d) { descriptor = d } } } })
  const client = descriptor.factory(() => ({}))
  const html = client.buildTavernFrameDocument({ token: 'frame', turn: 1, content: '', helperContext: {
    characterVariables: { unrelated: 1, start_presets: { presets: [] } }, globalVariables: { shared: 2 },
    scriptVariables: { a: {count:1}, b: {count:7} },
    messages: [{ message_id: 0, variables: { stat_data: { 主角: { 姓名: '旧' } } } }], turnMessageIds: { 1: 0 }
  } })
  const calls = [], listeners = []
  const parent = { postMessage(m) { calls.push(m) } }
  const w = { parent, structuredClone, console: { info() {}, warn() {}, error() {} }, addEventListener(name, fn) { if (name === 'message') listeners.push(fn) } }
  w.window = w
  const context = vm.createContext(w)
  vm.runInContext(lodash, context)
  let script = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  script = stubFrameDependencyImports(script)
  vm.runInContext(script, context)
  return { w, calls, reply(result = { updated: true }, ok = true) { for (const fn of listeners) fn({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 'frame', requestId: calls.at(-1).requestId, ok, result, error: '保存失败' } }) } }
}
test('状态栏 script 作用域读写隔离，失败回滚不污染消息或其他脚本', async () => {
  const h=fixture(), option={type:'script',script_id:'a'}, w=h.w
  assert.equal(w.getVariables(option).count,1)
  const message=JSON.stringify(w.getVariables({type:'message'}))
  const pending=w.insertOrAssignVariables({count:2},option)
  assert.equal(w.getVariables(option).count,2)
  assert.equal(w.getVariables({type:'script',script_id:'b'}).count,7)
  assert.equal(JSON.stringify(w.getVariables({type:'message'})),message)
  h.reply(); await pending
  const failed=w.replaceVariables({count:3},option)
  h.reply({},false)
  await assert.rejects(failed,/保存失败/)
  assert.equal(w.getVariables(option).count,2)
  assert.equal(JSON.stringify(w.getVariables({type:'message'})),message)
})
test('消息 iframe 导入角色预设后同步读到新列表，保存接口可等待且不污染消息变量', async () => {
  const h = fixture(), w = h.w
  assert.equal(w.getVariables({ type: 'global' }).shared, 2)
  const pending = w.insertOrAssignVariables({ start_presets: { presets: [{ name: '建档测试' }] } }, { type: 'character' })
  assert.equal(w.getVariables({ type: 'character' }).start_presets.presets[0].name, '建档测试')
  assert.equal(w.getVariables({ type: 'character' }).unrelated, 1)
  assert.equal(w.getVariables({ type: 'message' }).start_presets, undefined)
  h.reply(); await pending
})
test('自定义建档 MVU 写入 latest 并等待保存，失败回滚且不宣称成功', async () => {
  const h = fixture(), option = { type: 'message', message_id: 'latest' }
  const pending = h.w.Mvu.replaceMvuData({ stat_data: { 主角: { 姓名: '新' } } }, option)
  await new Promise(resolve => setImmediate(resolve))
  h.reply(); await pending
  assert.equal(h.w.Mvu.getMvuData(option).stat_data.主角.姓名, '新')
  const failed = h.w.Mvu.replaceMvuData({ stat_data: { 主角: { 姓名: '失败' } } }, option)
  await new Promise(resolve => setImmediate(resolve))
  h.reply({}, false)
  await assert.rejects(failed, /保存失败/)
  assert.equal(h.w.Mvu.getMvuData(option).stat_data.主角.姓名, '新')
})

import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
test('消息 iframe 的建档数据经正式宿主写入聊天记录并回读', async () => {
  const host = await createHelperWorldbookHost(true)
  try {
    host.chat.messages = [{ role: 'assistant', text: '自定义开局', turn: 1, variables: [{ stat_data: { 主角: { 姓名: '旧' } } }] }]
    const frame = fixture()
    const pending = frame.w.Mvu.replaceMvuData({ stat_data: { 主角: { 姓名: '建档回归', 等级: 3 } } }, { type: 'message', message_id: 'latest' })
    await new Promise(resolve => setImmediate(resolve))
    const { option, variables } = frame.calls.at(-1).args
    frame.reply(await host.adapter.updateVariables('audit', option, variables))
    await pending
    assert.equal(host.writes.at(-1).chat.messages[0].variables[0].stat_data.主角.姓名, '建档回归')
    assert.equal(frame.w.Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data.主角.等级, 3)
  } finally { await host.cleanup() }
})
