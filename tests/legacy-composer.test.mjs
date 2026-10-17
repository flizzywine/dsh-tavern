import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { helperClient } from './fixtures/helper-host-harness.mjs'

function mount(send, managed = false) {
  const nodes = []
  function element() {
    return { value: '', append(...items) { nodes.push(...items) }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn } }
  }
  const document = { body: element(), createElement: element, getElementById(id) { return nodes.find(n => n.id === id) } }
  const html = helperClient.buildTavernFrameDocument({ token: 'send', content: '<p>opening</p>', helperContext: { messages: [] } })
  const source = html.match(/<script data-dsh-tavern-legacy-composer>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source)
  vm.runInNewContext(source, { document, window: managed ? { submitTavernInput: send } : { triggerSlash: send }, console: { error() {} } })
  return { nodes, area: document.getElementById('send_textarea'), button: document.getElementById('send_but') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('failed legacy send retains payload, displays failure and permits retry', async () => {
  const { nodes, area, button } = mount(() => Promise.reject(new Error('发送失败')))
  area.value = '开始故事'; button.click(); await tick()
  assert.equal(area.value, '开始故事')
  assert.equal(button.disabled, false)
  assert.ok(nodes.some(n => /开局消息发送失败/.test(n.textContent)))
})

test('parent composer routes to the focused card, survives replacement and releases owners', async () => {
  const nodes = [], calls = [], errors = [];
  function element() { return { value: '', append(...items) { nodes.push(...items) }, remove() { this.removed = true }, addEventListener(name, fn) { this[name] = fn } } }
  const doc = { body: element(), createElement: element, getElementById: id => nodes.find(n => n.id === id) };
  const a = {}, b = {};
  let finish;
  const releaseA = helperClient.installFrameHostComposer(doc, n => n === a, text => { calls.push(['A', text]); return new Promise(r => { finish = r }) }, e => errors.push(e.message));
  const releaseB = helperClient.installFrameHostComposer(doc, n => n === b, text => { calls.push(['B', text]); throw new Error('失败可重试') }, e => errors.push(e.message));
  const area = doc.getElementById('send_textarea'), button = doc.getElementById('send_but');
  doc.activeElement = a; area.value = '开始\n姓名 | /trigger'; button.click(); button.click();
  doc.activeElement = b; await tick();
  assert.deepEqual(calls, [['A', '开始\n姓名 | /trigger']]);
  finish(); await tick();
  area.value = 'B 的开局'; button.click(); await tick();
  assert.deepEqual(errors, ['失败可重试']); assert.equal(area.value, 'B 的开局');
  button.click(); await tick(); assert.equal(calls.length, 3);
  releaseB(); assert.throws(() => button.click(), /无法确定/);
  doc.activeElement = a; area.value = '已经卸载'; button.click(); releaseA(); await tick();
  assert.equal(calls.length, 3); assert.ok(errors.includes('卡片已关闭，请重新打开'));
});
