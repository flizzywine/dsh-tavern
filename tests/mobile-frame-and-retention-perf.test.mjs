import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'
import { JSDOM } from 'jsdom'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

const assembled = await assembleTavernClient()
let descriptor
vm.runInNewContext(assembled, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))

const context = {
  characterName: '角色', playerName: '你', stateRevision: 4, mvuEnabled: true,
  messages: [{ message_id: 0, role: 'assistant', message: '开场', variables: { stat_data: { hp: 1 } } }],
  turnMessageIds: { 1: 0 }, chatVariables: { playerName: '你' }
}
const frame = (content, extra) => client.buildTavernFrameDocument(Object.assign({ token: 'perf', turn: 1, content, helperContext: context }, extra))
const dependencyUrls = doc => ['vue/vue.runtime.global.prod.js', 'jquery/jquery.min.js', 'lodash/lodash.min.js', 'marked/marked.umd.js']
  .filter(url => doc.includes('/api/dsh-tavern/vendor/runtime-assets/' + url))

test('P1-5 纯静态美化楼层不再注入 860KB Helper vendor 运行时', () => {
  const doc = frame('<div class="dsh-tavern-panel"><b>标题</b><i class="fas fa-star"></i></div>')
  assert.deepEqual(dependencyUrls(doc), [], '静态楼层不需要 Vue/jQuery/lodash/marked')
  assert.match(doc, /data-dsh-tavern-helper>/, 'Helper API 桥仍然注入，脚本能力不变')
  assert.match(doc, /data-dsh-tavern-icons/)
  assert.match(doc, /data-dsh-tavern-storage/)
})

test('P1-5 含 script / 内联事件 / Vue 模板 / Tailwind 的楼层完整保留依赖', () => {
  for (const content of [
    '<div><script>document.title = "x"<\/script></div>',
    '<button onclick="go()">走</button>',
    '<div v-if="open">面板</div>',
    '<div class="hd">{{ message }}</div>',
    '<div class="p-4 flex items-center gap-2">美化</div>'
  ]) assert.equal(dependencyUrls(frame(content)).length, 4, '保留完整依赖: ' + content.slice(0, 24))
})

test('P1-5 openingPreview/leanRuntime 语义不变', () => {
  assert.equal(dependencyUrls(frame('<div>预览</div>', { openingPreview: { text: '预览' } })).length, 4)
  assert.deepEqual(dependencyUrls(frame('<div>raw</div>', { leanRuntime: true })), [])
})

function contextUpdateFixture(helperContext = context) {
  const html = client.buildTavernFrameDocument({ token: 'perf', turn: 1, content: '<div>流式</div>', helperContext })
  const source = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  const calls = [], listeners = [], clones = []
  const parent = { postMessage(message) { calls.push(message) } }
  const fake = {
    parent,
    console: { info() {}, warn() {}, error() {} },
    addEventListener(name, handler) { if (name === 'message') listeners.push(handler) },
    structuredClone(value) { clones.push(value); return structuredClone(value) }
  }
  fake.window = fake
  const sandbox = vm.createContext(fake)
  vm.runInContext(stubFrameDependencyImports(source), sandbox)
  return {
    fake, clones, calls,
    send(update) { for (const listener of listeners) listener({ source: parent, data: { token: 'perf', type: 'dsh-tavern-helper-context-update', update } }) }
  }
}

const bigState = Array.from({ length: 47 }, (_, index) => ({ message_id: index, role: 'assistant', message: '楼 ' + index, variables: index === 46 ? { stat_data: { hp: 2 } } : {} }))
const bigContext = Object.assign({}, context, { messages: bigState, stateRevision: 4, turnMessageIds: { 1: 46 } })
const update = {
  version: 1, kind: 'snapshot', stateRevision: 5, turn: 1, events: ['mag_variable_update_ended'],
  context: Object.assign({}, context, { stateRevision: 5, turnMessageIds: { 1: 46 }, messages: bigState.concat([{ message_id: 47, role: 'assistant', message: '流式新楼', variables: {} }]) })
}

test('P1-6 无 mag_variable_update_ended 监听时不再深拷贝整份 state', async () => {
  const fixture = contextUpdateFixture(bigContext)
  fixture.send(update)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(fixture.fake.Mvu && fixture.fake.Mvu.events.VARIABLE_UPDATE_ENDED, 'Mvu 事件分支仍然走通')
  const fullCopies = fixture.clones.filter(value => value && Array.isArray(value.messages) && value.messages.length === 47)
  assert.equal(fullCopies.length, 0, '没有监听器时不允许 structuredClone 整份历史')
})

test('P1-6 有监听器时旧值参数与原先一致', async () => {
  const fixture = contextUpdateFixture(bigContext)
  const received = []
  fixture.fake.eventOn(fixture.fake.Mvu.events.VARIABLE_UPDATE_ENDED, function (next, previous) { received.push([next, previous]) })
  fixture.send(update)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(received.length, 1)
  const [next, previous] = received[0]
  assert.equal(previous.messages.length, 47, '旧值必须是更新前的完整快照')
  assert.equal(previous.stateRevision, 4)
  assert.equal(next.stat_data.hp, 2, '新值来自当前楼层变量')
  assert.ok(fixture.clones.some(value => value && value.messages && value.messages.length === 47))
})

test('P1-7b stylesheet.js 相同 features 不重复写 textContent', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' })
  const { window } = dom
  window.eval(readFileSync(new URL('../tavern-plugin/src/client/stylesheet.js', import.meta.url), 'utf8'))
  try {
    window.installTavernStylesheet(window.document, '.a{color:red}', ['.f1{}', '.f2{}'])
    const style = window.document.querySelector('[data-plugin-css="dsh-tavern-plugin/features.css"]')
    let holder = style, descriptor
    while (holder && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(holder, 'textContent'); if (!descriptor) holder = Object.getPrototypeOf(holder) }
    let writes = 0
    Object.defineProperty(style, 'textContent', {
      configurable: true,
      get() { return descriptor.get.call(style) },
      set(value) { writes += 1; descriptor.set.call(style, value) }
    })
    window.installTavernStylesheet(window.document, '.a{color:red}', ['.f1{}', '.f2{}'])
    assert.equal(writes, 0, '同内容重装不得重新解析 719KB CSS')
    window.installTavernStylesheet(window.document, '.a{color:red}', ['.f9{}', '.f2{}'])
    assert.equal(writes, 1, '真正变化时才重写')
    assert.equal(style.textContent, '.f9{}')
  } finally { dom.window.close() }
})

function retentionFixture(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
  dom.window.eval(readFileSync(new URL('../tavern-plugin/src/client/modules/session-resource-retention.js', import.meta.url), 'utf8'))
  let clock = 0, nextTimer = 1
  const timers = new Map()
  const host = {
    setTimeout(handler, delay) { const id = nextTimer++; timers.set(id, { handler, at: clock + Math.max(0, Number(delay) || 0) }); return id },
    clearTimeout(id) { timers.delete(id) }
  }
  const retention = dom.window.createTavernSessionRetention(Object.assign({ window: host, now: () => clock, durationMs: 10 * 60 * 1000 }, options))
  return { retention, advance(ms) { clock += ms; for (const [id, timer] of Array.from(timers)) if (timer.at <= clock) { timers.delete(id); timer.handler() } }, close() { dom.window.close() } }
}

test('P2-9a 后台会话资源保留上限按 LRU 驱逐，活跃会话绝不被释放', () => {
  const disposed = []
  const { retention, advance, close } = retentionFixture({ maxRetained: 2 })
  try {
    const hold = id => retention.hold(id, 'frame', () => disposed.push(id))
    retention.select('A'); hold('A')
    advance(10); retention.select('B'); hold('B')
    advance(10); retention.select('C'); hold('C')
    assert.deepEqual(disposed, [], '两个后台会话仍在保留上限内')
    advance(10); retention.select('D'); hold('D')
    assert.deepEqual(disposed, ['A'], '超出上限时释放最久未使用的后台会话')
    const rows = retention.inspect()
    assert.deepEqual(Array.from(rows, row => row.sessionId).sort(), ['B', 'C', 'D'])
    const active = rows.find(row => row.sessionId === 'D')
    assert.equal(active.active, true)
    assert.equal(active.resources, 1, '当前挂载会话的资源必须保留')
  } finally { close() }
})

test('P2-9a 默认上限为 4，超出后驱逐最旧的挂起会话', () => {
  const disposed = []
  const { retention, advance, close } = retentionFixture()
  try {
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
      advance(10)
      const unmount = retention.mount(id)
      unmount()
      retention.hold(id, 'frame', () => disposed.push(id))
    }
    assert.deepEqual(disposed, ['A', 'B'])
    assert.deepEqual(Array.from(retention.inspect(), row => row.sessionId).sort(), ['C', 'D', 'E', 'F'])
  } finally { close() }
})
