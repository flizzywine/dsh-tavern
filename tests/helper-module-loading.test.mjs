import { helperLoaderSource, helperLoaderBootstrap } from './fixtures/helper-loader-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))

function loader(scripts) {
  const html = client.buildTavernHelperScriptDocument({ token: 'test', scripts, context: {} })
  return helperLoaderSource(html)
}

function harness(scripts, onAppend, ready = Promise.resolve()) {
  const listeners = new Set(), lifecycleListeners = new Map(), events = [], elements = []
  let context
  const window = {
    __dshTavernHelperReady: ready,
    // Use the production wait wrapper without arming diagnostic timers in this harness.
    __dshTavernInitializationTiming: client.createTavernInitializationTiming({ schedule: () => null, cancel: () => {} }),
    __dshTavernHelperSetCurrentScript(id) { events.push(['start', id]) },
    __dshTavernHelperSubscriptionsReady(id) { events.push(['ready', id]) },
    __dshTavernHelperSubscriptionsFailed(id, error) { events.push(['failed', id, error.message, ...(error.dshTavernModuleFailure ? [error.dshTavernModuleFailure] : [])]) },
    __dshTavernResolveCompanionScriptsReady() { events.push(['done']) },
    waitGlobalInitialized: async name => { events.push(['global', name]) },
    addEventListener(name, handler) {
      if (name === 'error') listeners.add(handler)
      else { assert.equal(name, 'pagehide'); lifecycleListeners.set(name, handler) }
    },
    removeEventListener(name, handler) {
      if (name === 'error') listeners.delete(handler)
      else lifecycleListeners.delete(name)
    }
  }
  const document = {
    // Composer controls are preinstalled; this harness exercises module loading.
    getElementById(id) { return ['send_textarea', 'send_but'].includes(id) ? {} : null },
    createElement(tag) {
      assert.equal(tag, 'script')
      const element = { remove() { this.removed = true } }
      elements.push(element)
      return element
    },
    body: { appendChild(element) {
      assert.equal(element.type, 'module')
      assert.equal(element.src, undefined, 'Card module must inherit the document base, not data/blob URL')
      const footer = element.textContent.split("\n").find(line => line.startsWith(";window["))
      const complete = () => vm.runInContext(footer, context)
      onAppend({ element, complete, listeners, events })
    } }
  }
  context = vm.createContext({ window, document, console, URL })
  return { window, events, elements, listeners, lifecycleListeners,
    run: () => vm.runInContext('(async()=>{' + loader(scripts) + '})()', context) }
}

test('前一个脚本的迟到异常不使正在加载的样式模块失败', async () => {
  const run = harness([{ id: 'style', content: 'await style()' }], ({ complete, listeners }) => {
    for (const listener of [...listeners]) listener({ filename: 'dsh-tavern-script:previous', error: new Error('previous callback') })
    assert.doesNotThrow(complete)
  })
  await run.run()
  assert.deepEqual(run.events, [['start', 'style'], ['ready', 'style'], ['done']])
})

test('不透明模块加载失败给出行动提示和脱敏详情，不冒充网络故障', async () => {
  const run = harness([{id:'schema',content:"import 'https://cdn.example/schema.js?token=PRIVATE';"}], ({element}) => element.onerror({}));
  await run.run();
  const failure=run.events.find(e=>e[0]==='failed');
  assert.match(failure[2], /检查网络|查看详情/);
  assert.equal(failure[3].reason, 'unknown');
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE/);
  assert.equal(run.elements.length, 1, '不得自动重跑模块');
});

test('浏览器可见的入口 HTTP 错误保留状态，过滤历史资源与秘密查询参数', async () => {
 const run=harness([{id:'schema',content:"import 'https://cdn.example/schema.js?token=PRIVATE';"}],({element})=>element.onerror({}));
 run.window.performance={now:()=>10,getEntriesByType:()=>[
  {name:'https://cdn.example/schema.js?token=PRIVATE',startTime:11,initiatorType:'script',responseStatus:503},
  {name:'https://cdn.example/old.js',startTime:1,initiatorType:'script',responseStatus:404}
 ]};
 await run.run();
 const failure=run.events.find(e=>e[0]==='failed')[3];
 assert.equal(failure.reason,'http');
 assert.equal(failure.resources.length,1);
 assert.equal(failure.resources[0].status,503);
 assert.equal(failure.references[0],'https://cdn.example/schema.js');
 assert.doesNotMatch(JSON.stringify(failure),/PRIVATE|old.js/);
});

test('动态 import 网络错误保留行动提示，原始地址查询参数不泄漏', async () => {
 const run=harness([{id:'schema',content:'await import(url)'}],({listeners})=>{
  for(const fn of listeners) fn({error:new TypeError('Failed to fetch dynamically imported module: https://cdn.example/a.js?token=PRIVATE')});
 });
 await run.run();
 const failure=run.events.find(e=>e[0]==='failed');
 assert.equal(failure[3].phase,'module-load');
 assert.match(failure[2],/查看详情/);
 assert.doesNotMatch(JSON.stringify(failure),/PRIVATE/);
});

test('large Unicode script loading stays within a bounded heap and preserves source', async () => {
  const {execFile} = await import('node:child_process')
  const {promisify} = await import('node:util')
  const result = await promisify(execFile)(process.execPath, ['--max-old-space-size=256', new URL('./fixtures/helper-large-script-loading.mjs', import.meta.url).pathname], {timeout:30000,maxBuffer:4096})
  assert.match(result.stdout,/PASS large Unicode script roundtrip/)
})

test('Blob loader releases its URL on success, failure and frame disposal', async () => {
  for (const outcome of ['success','failure','dispose']) {
    let settle, listener, blob, created=0, released=0
    const pending=new Promise((resolve,reject)=>{settle=()=>outcome==='failure'?reject(new Error('module failed')):resolve()})
    const html=client.buildTavernHelperScriptDocument({scripts:[],context:{}})
    const result=vm.runInNewContext(helperLoaderBootstrap(html).replace('import(url)', 'load(url)'), {
      Blob, URL:{createObjectURL(value){blob=value;created++;return 'blob:test'},revokeObjectURL(url){assert.equal(url,'blob:test');released++}},
      window:{addEventListener(type,fn){assert.equal(type,'pagehide');listener=fn},removeEventListener(type,fn){assert.equal(fn,listener)}},
      load(url){assert.equal(url,'blob:test');return pending}
    })
    assert.equal(created,1)
    assert.equal(await blob.text(),helperLoaderSource(html))
    assert.equal(released,0)
    if(outcome==='dispose')listener()
    settle()
    if(outcome==='failure')await assert.rejects(result,/module failed/)
    else await result
    assert.equal(released,1)
  }
})
