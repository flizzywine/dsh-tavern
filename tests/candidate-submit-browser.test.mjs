import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// Mount the shipped sidebar and dock. listSessions populates mode through the
// real sidebar, so this exercises the registered click handler and HTTP client.
async function mount(t, outcome) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = [], calls = [], unexpected = []
  page.on('pageerror', error => errors.push(error.message))
  let attempts = 0, task = null
  const sync = () => ({ activity: { busy: false, phase: 'idle' }, task, tasks: { candidate: task, background: null } })
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!route.request().url().includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: '<main id="sidebar"></main><div id="dock"></div>' })
    const args = route.request().postDataJSON() || {}
    calls.push({ method, args })
    let result
    if (method === 'submitTask') {
      attempts++
      if (outcome === 'timeout' && attempts === 1) return
      if (outcome === 'network' || outcome === 'recover' && attempts === 1) return route.abort('failed')
      if (outcome === 'reject') result = { ok: false, error: '候选输入已过期' }
      else {
        task = { taskId: 'candidate-1', kind: 'candidate', input: { messageId: 'reply-1' }, status: 'queued', busy: true }
        result = { ok: true, sync: sync() }
      }
    } else {
      const responses = {
        listCards: { cards: [] },
        getCardOrganization: { organization: { groups: [], assignments: {} } },
        listSessions: { sessions: [{ sessionId: 'game', chatId: 'chat', mode: 'story', cardName: '测试' }] },
        getUpdateStatus: { status: { phase: 'idle', host: 'cli' } },
        getHostCompatibility: {},
        confirmSessionPatch: {},
        syncSession: { sync: sync() },
        getSession: { view: { mode: 'story', latestAssistantTurn: 1, activity: { busy: false }, tavernHelper: { messages: [] } } },
        getActiveInterfaceSkin: { css: '' },
      }
      if (!(method in responses)) unexpected.push(method)
      result = { ok: true, ...responses[method] }
    }
    await route.fulfill({ json: result })
  })
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const slots = {}, noop = () => () => {}
    const sessionState = { current: '', byId: {} }
    const ctx = {
      inject() { return { dispose() {} } },
      get() {}, provide() {},
      effect(run, label) {
        if (['dsh-tavern: Tavern workspace browser', 'dsh-tavern: candidate dock actions'].includes(label)) return run()
        return () => {}
      },
      slots: { inject(_name, run) { return run() }, register(spec, component) { slots[spec.id || spec.name] = component; return () => {} } },
      sessions: { subagentAddress: () => null, refresh: async () => {}, list: { getSnapshot: () => sessionState }, binding: () => null },
      workspaces: {}, betterSidebar: {},
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true, useSessions: select => select(sessionState), useWorkspaces: select => select({ items: [] }), renderSlot: () => null,
    }))
    // A top-level play session shows its round actions in the composer (input.left).
    modules['react-dom/client'].createRoot(document.querySelector('#dock')).render(React.createElement(slots['dsh-tavern-candidate-actions'], {
      sessionId: 'game', useSession: select => select({ running: false }), useInput: select => select({ draft: '' }),
      useChat: select => select({ legacy: { nodes: [{ kind: 'assistant', messageId: 'reply-1' }] } }),
    }))
  })
  await page.getByRole('button', { name: '生成候选项', exact: true }).waitFor()
  return { page, calls, errors, unexpected }
}

for (const [outcome, contract] of [
  ['recover', '网络失败后复用请求标识并恢复提交'],
  ['timeout', '响应超时会取消请求并使用同一标识重试'],
  ['network', '持续网络失败只提交三次并解除忙碌状态'],
  ['reject', '业务拒绝不会重试'],
]) {
  test(`候选按钮：${contract}`, async t => {
    const { page, calls, errors, unexpected } = await mount(t, outcome)
    const succeeds = outcome === 'recover' || outcome === 'timeout'
    const submitted = succeeds ? page.waitForResponse(response => response.url().endsWith('/submitTask') && response.ok()) : null
    await page.getByRole('button', { name: '生成候选项', exact: true }).click()
    if (succeeds) {
      await submitted
      await page.getByRole('button', { name: '生成中…', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '生成中…', exact: true }).isDisabled(), true)
    } else {
      // The handler releases its busy state only after its retry/error path ends.
      await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '生成候选项' && !button.disabled))
    }
    const requests = calls.filter(call => call.method === 'submitTask')
    assert.equal(requests.length, succeeds ? 2 : outcome === 'network' ? 3 : 1)
    assert.ok(requests[0].args.requestId)
    assert.equal(new Set(requests.map(call => call.args.requestId)).size, 1, 'all transport retries must reuse the original request identity')
    for (const { args } of requests) {
      assert.equal(args.sessionId, 'game')
      assert.equal(args.messageId, 'reply-1')
      assert.equal(args.kind, 'candidate')
    }
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
  })
}
