import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createGenerationStreamModeStore, installGenerationStreamModeHook } from '../tavern-plugin/lib/domain/generation-stream-mode.js'
import { generationStreamModeBootScript } from '../tavern-plugin/lib/domain/generation-stream-mode-boot-patch.js'
import { createGenerationStreamModeHandlers } from '../tavern-plugin/lib/rpc/generation-stream-mode.js'

function memoryProfile(initial) {
  let value = initial
  return {
    async readJson() { return value },
    async writeJson(_file, next) { value = structuredClone(next) },
    value: () => value,
  }
}

test('流式设置默认开启，保存后可重载，RPC 使用同一存储', async () => {
  const profile = memoryProfile(undefined)
  const store = createGenerationStreamModeStore(profile)
  assert.equal(await store.get(), true)
  const handlers = createGenerationStreamModeHandlers({ generationStreamModes: store })
  assert.deepEqual(await handlers.getGenerationStreamMode(), { stream: true })
  assert.deepEqual(await handlers.setGenerationStreamMode({ stream: false }), { stream: false })
  assert.deepEqual(profile.value(), { stream: false })
  assert.equal(await createGenerationStreamModeStore(profile).get(), false)
  await assert.rejects(handlers.setGenerationStreamMode({ stream: 'false' }), /布尔值/)
})

test('所有模型都按设置交付：流式立即返回，非流式完整响应后返回原事件序列', async () => {
  async function run(mode, provider, model) {
    let listener
    let finished = false
    const observed = []
    const chunks = [{ type: 'text-delta', text: 'A' }, { type: 'text-delta', text: 'B' }, { type: 'finish', reason: { kind: 'stop' } }]
    function source(request) {
      observed.push(request)
      return (async function * () {
        yield chunks[0]
        yield chunks[1]
        finished = true
        yield chunks[2]
      })()
    }
    const ctx = {
      on(name, callback) { assert.equal(name, 'llm/stream'); listener = callback; return () => {} },
      llm: { stream(request) { return listener(request, () => source(request)) } },
    }
    installGenerationStreamModeHook(ctx, async () => mode)
    const request = { provider, model, messages: [] }
    const iterator = listener(request, () => source(request))[Symbol.asyncIterator]()
    const first = await iterator.next()
    assert.deepEqual(first, { done: false, value: chunks[0] })
    assert.equal(finished, mode === false)
    const rest = []
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) rest.push(chunk)
    assert.deepEqual([first.value, ...rest], chunks)
    assert.equal(observed.length, 1)
    assert.equal(observed[0].provider, provider)
    assert.equal(observed[0].model, model)
    assert.equal(observed[0].stream, mode === false ? false : undefined)
  }
  for (const [provider, model] of [['deepseek', 'deepseek-chat'], ['pi-ai', 'claude-sonnet-4'], ['pi-ai', 'gpt-5']]) {
    await run(true, provider, model)
    await run(false, provider, model)
  }
})

async function settle(dom) {
  for (let index = 0; index < 4; index++) await new Promise(resolve => dom.window.setTimeout(resolve, 0))
}

test('原生模型根菜单加入所有模型的流式/非流式切换，默认流式且点击保存', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><div role="menu">
    <button role="menuitem" class="cell"><span class="hash_cellLabel">模型</span><span class="hash_cellValue">DeepSeek</span></button>
    <button role="menuitem" class="cell"><span class="hash_cellLabel">推理等级</span><span class="hash_cellValue">High</span></button>
  </div></body></html>`, { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true })
  const calls = []
  dom.window.fetch = async (url, options) => {
    const method = String(url).split('/').at(-1)
    const body = JSON.parse(options.body)
    calls.push({ method, body })
    return { json: async () => ({ ok: true, stream: method === 'setGenerationStreamMode' ? body.stream : true }) }
  }
  try {
    dom.window.eval(generationStreamModeBootScript())
    await settle(dom)
    const row = dom.window.document.querySelector('[data-dsh-tavern-stream-mode]')
    assert.ok(row)
    assert.match(row.title, /所有模型请求/)
    assert.equal(row.getAttribute('data-stream'), 'true')
    const options = row.querySelectorAll('[data-dsh-tavern-stream-option]')
    assert.deepEqual([...options].map(option => option.textContent), ['流式', '非流式'])
    assert.equal(options[0].getAttribute('aria-checked'), 'true')
    assert.equal(options[1].getAttribute('aria-checked'), 'false')
    options[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(dom)
    assert.ok(calls.some(call => call.method === 'setGenerationStreamMode' && call.body.stream === false))
    assert.equal(row.getAttribute('data-stream'), 'false')
    assert.equal(options[1].getAttribute('aria-checked'), 'true')
    assert.equal(dom.window.__dshTavernGenerationStreamMode.snapshot().stream, false)
    row.remove()
    await settle(dom)
    assert.equal(dom.window.document.querySelector('[data-dsh-tavern-stream-mode]')?.getAttribute('data-stream'), 'false')
    dom.window.document.querySelector('[role="menu"]').remove()
    const effort = dom.window.document.createElement('div')
    effort.setAttribute('role', 'menu')
    effort.innerHTML = '<button role="menuitemradio">High</button>'
    dom.window.document.body.appendChild(effort)
    await settle(dom)
    assert.equal(effort.querySelector('[data-dsh-tavern-stream-mode]'), null)
  } finally {
    dom.window.__dshTavernGenerationStreamMode?.dispose()
    dom.window.close()
  }
})
