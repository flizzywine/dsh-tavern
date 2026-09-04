import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))

function loader(scripts) {
  const html = client.buildTavernHelperScriptDocument({ token: 'test', scripts, context: {} })
  const encoded = html.match(/<script type="module" src="data:text\/javascript;base64,([^"]+)"/)[1]
  return Buffer.from(encoded, 'base64').toString()
}

test('脚本宿主的固定运行时依赖全部使用随包本地资源', () => {
  const html = client.buildTavernHelperScriptDocument({ token: 'test', scripts: [], context: {} })
  for (const path of [
    'vue/vue.runtime.global.prod.js', 'vue-router/vue-router.global.prod.js',
    'jquery/jquery.min.js', 'lodash/lodash.min.js', 'zod/index.mjs'
  ]) assert.ok(html.includes('/api/dsh-tavern/vendor/runtime-assets/' + path), path)
  assert.doesNotMatch(html, /(?:testingcf\.)?cdn\.jsdelivr\.net\/npm\/(?:zod|vue|vue-router|jquery|lodash)@/)
})

function harness(scripts, onAppend, ready = Promise.resolve()) {
  const listeners = new Set(), events = [], elements = []
  let context
  const window = {
    __dshTavernHelperReady: ready,
    __dshTavernHelperSetCurrentScript(id) { events.push(['start', id]) },
    __dshTavernHelperSubscriptionsReady(id) { events.push(['ready', id]) },
    __dshTavernHelperSubscriptionsFailed(id, error) { events.push(['failed', id, error.message]) },
    __dshTavernResolveCompanionScriptsReady() { events.push(['done']) },
    waitGlobalInitialized: async name => { events.push(['global', name]) },
    addEventListener(name, handler) { assert.equal(name, 'error'); listeners.add(handler) },
    removeEventListener(name, handler) { listeners.delete(handler) }
  }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'script')
      const element = { remove() { this.removed = true } }
      elements.push(element)
      return element
    },
    body: { appendChild(element) {
      assert.equal(element.type, 'module')
      assert.equal(element.src, undefined, 'Card module must inherit the document base, not data/blob URL')
      const footer = element.textContent.match(/\n(;window\["__dshTavernModuleComplete_[^"]+"\]\(\);)\n$/)[1]
      const complete = () => vm.runInContext(footer, context)
      onAppend({ element, complete, listeners, events })
    } }
  }
  context = vm.createContext({ window, document, console })
  return { window, events, elements, listeners,
    run: () => vm.runInContext('(async()=>{' + loader(scripts) + '})()', context) }
}

test('卡片 import 原文进入页面模块，支持具名、动态、重导出且不改字符串和注释', async () => {
  const source = `import value, { registerMvuSchema as register } from '/api/dsh-tavern/remote-assets/hash/mvu_zod.js';
import * as namespace from '/api/dsh-tavern/remote-assets/hash/mvu_zod.js';
export { x } from '/api/dsh-tavern/remote-assets/hash/child.js';
const path = '/api/dsh-tavern/remote-assets/hash/child.js'; await import(path);
const text = "import '/api/dsh-tavern/remote-assets/not-code.js'";
// import '/api/dsh-tavern/remote-assets/not-code.js'
// Unicode and markup must survive: 玩家 </script>`
  const run = harness([{ id: 'schema', content: source }], ({ element, complete }) => {
    assert(element.textContent.startsWith(source + '\n;window['))
    complete()
  })
  await run.run()
  assert.deepEqual(run.events, [['start', 'schema'], ['ready', 'schema'], ['done']])
  assert.equal(run.listeners.size, 0)
  assert(run.elements.every(element => element.removed))
  assert(!Object.keys(run.window).some(key => key.startsWith('__dshTavernModuleComplete_')))
})

test('模块等待 bootstrap 与前一个脚本完成，官方核心就绪后才开始配套脚本', async () => {
  let releaseReady, completeCore
  const ready = new Promise(resolve => { releaseReady = resolve })
  const run = harness([{ id: 'core', system: 'official-mvu', content: 'await core()' }, { id: 'schema', content: 'register()' }], ({ complete }) => {
    if (!completeCore) completeCore = complete
    else complete()
  }, ready)
  const pending = run.run()
  assert.equal(run.elements.length, 0)
  releaseReady()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(run.elements.length, 1)
  assert.deepEqual(run.events, [['start', 'core']])
  completeCore()
  await pending
  assert.deepEqual(run.events, [['start', 'core'], ['global', 'Mvu'], ['ready', 'core'], ['start', 'schema'], ['ready', 'schema'], ['done']])
})

test('官方核心执行失败停止配套脚本，不能部分初始化后继续写入', async () => {
  const run = harness([{ id: 'core', system: 'official-mvu', content: 'bad' }, { id: 'schema', content: 'write()' }], ({ element }) => {
    element.onerror({ message: 'partial execution' })
  })
  await run.run()
  assert.equal(run.elements.length, 1)
  assert.deepEqual(run.events, [['start', 'core'], ['failed', 'core', 'partial execution'], ['done']])
})

test('模块加载、执行和插入失败均清理监听并继续下一脚本', async () => {
  for (const kind of ['load', 'execute', 'append']) {
    let index = 0
    const run = harness([{ id: 'bad', content: 'bad' }, { id: 'good', content: 'good' }], ({ element, complete, listeners }) => {
      if (index++ > 0) return complete()
      if (kind === 'load') element.onerror({ message: 'missing dependency' })
      else if (kind === 'execute') for (const listener of listeners) listener({ error: new Error('bad script') })
      else throw new Error('append failed')
    })
    await run.run()
    assert.equal(run.events[1][0], 'failed')
    assert.deepEqual(run.events.slice(2), [['start', 'good'], ['ready', 'good'], ['done']])
    assert.equal(run.listeners.size, 0)
    assert(run.elements.every(element => element.removed))
    assert(!Object.keys(run.window).some(key => key.startsWith('__dshTavernModuleComplete_')))
  }
})
