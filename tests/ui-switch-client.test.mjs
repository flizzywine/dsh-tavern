import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'tavern-plugin/packages/dsh-tavern-ui-switch/lib/client.js')
const HOST_ID = 'dsh-tavern-ui-switch-host'

let JSDOM = null
try {
  ;({ JSDOM } = require('jsdom'))
} catch {
  // jsdom is a root devDependency; install the workspace to run this file.
}

const skip = JSDOM ? false : 'jsdom is not installed'

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

/** Load lib/client.js the way the DSH client loader does. */
function boot({ state, onSwitch, pending } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:3080/',
    pretendToBeVisual: true,
  })
  const calls = []
  const statePayload = state || {
    ok: true,
    mode: 'tavern',
    tavernInstalled: true,
    restart: { supported: true, host: 'desktop', hint: '切换后会自动重启 DeepSeek Harness。' },
  }
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url, 'http://127.0.0.1:3080').pathname
    calls.push({ pathname, method: init.method || 'GET', body: init.body })
    if (pending && pathname.endsWith('/state')) return new Promise(() => {})
    if (pathname.endsWith('/state')) return { ok: true, status: 200, json: async () => statePayload }
    if (pathname.endsWith('/switch')) {
      const mode = JSON.parse(init.body).mode
      return { ok: true, status: 200, json: async () => (onSwitch ? onSwitch(mode) : { ok: true, mode }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }

  const descriptors = []
  dom.window.__ModuleLoader__ = { load: (descriptor) => descriptors.push(descriptor) }
  const source = readFileSync(CLIENT, 'utf8')
  new Function(
    'window', 'document', 'fetch', 'console', 'MutationObserver', 'getComputedStyle', 'setTimeout', 'location',
    source,
  )(
    dom.window,
    dom.window.document,
    fetchImpl,
    console,
    dom.window.MutationObserver,
    dom.window.getComputedStyle,
    dom.window.setTimeout.bind(dom.window),
    dom.window.location,
  )

  assert.equal(descriptors.length, 1, 'the module registers itself exactly once')
  descriptors[0].factory(() => ({})).apply({})

  const host = dom.window.document.getElementById(HOST_ID)
  return { dom, host, shadow: host && host.shadowRoot, calls }
}

test('the overlay mounts once inside a shadow root', { skip }, () => {
  const { host, shadow } = boot()
  assert.ok(host)
  assert.ok(shadow)
  assert.equal(shadow.querySelectorAll('.pill').length, 1)
  assert.match(shadow.querySelector('.pill').textContent, /界面/)
})

test('the panel loads the current interface and offers the other one', { skip }, async () => {
  const { shadow, host } = boot({
    state: {
      ok: true,
      mode: 'tavern',
      tavernInstalled: true,
      anchor: 'top-left',
      restart: { supported: true, host: 'desktop', hint: '' },
    },
  })
  shadow.querySelector('.pill').click()
  await tick()
  const panel = shadow.querySelector('.panel')
  assert.equal(panel.getAttribute('data-open'), '1')
  assert.match(panel.textContent, /酒馆界面/)
  assert.match(panel.textContent, /切换到原版界面/)
  assert.equal(host.getAttribute('data-anchor'), 'top-left', 'the anchor from config is applied')
})

test('clicking the label or the arrow opens the confirmation step', { skip }, async () => {
  const { shadow } = boot()
  shadow.querySelector('.pill').click()
  await tick()

  shadow.querySelector('[data-act="switch"] span').click()
  assert.ok(shadow.querySelector('[data-act="confirm"]'))

  shadow.querySelector('[data-act="cancel"]').click()
  const arrow = shadow.querySelector('[data-act="switch"] .arrow')
  arrow.dispatchEvent(new (arrow.ownerDocument.defaultView.Event)('click', { bubbles: true }))
  assert.ok(shadow.querySelector('[data-act="confirm"]'))
})

test('confirming writes the other mode and asks for a restart', { skip }, async () => {
  const { shadow, calls, dom } = boot()
  shadow.querySelector('.pill').click()
  await tick()
  shadow.querySelector('[data-act="switch"]').click()
  shadow.querySelector('[data-act="confirm"]').click()
  await tick(30)

  const call = calls.find((entry) => entry.pathname.endsWith('/switch'))
  assert.equal(call.method, 'POST')
  assert.equal(JSON.parse(call.body).mode, 'official')
  assert.ok(calls.some((entry) => entry.pathname.endsWith('/restart')))
  dom.window.close()
})

test('the panel never claims Tavern is missing while the state is still loading', { skip }, async () => {
  const { shadow, dom } = boot({ pending: true })
  shadow.querySelector('.pill').click()
  await tick()
  const text = shadow.querySelector('.panel').textContent
  assert.match(text, /正在读取界面状态/)
  assert.doesNotMatch(text, /没有安装酒馆/)
  assert.equal(shadow.querySelector('[data-act="switch"]'), null)
  dom.window.close()
})

test('without Tavern the button is disabled and says why', { skip }, async () => {
  const { shadow } = boot({
    state: { ok: true, mode: 'official', tavernInstalled: false, restart: { supported: true, hint: '' } },
  })
  shadow.querySelector('.pill').click()
  await tick()
  assert.equal(shadow.querySelector('[data-act="switch"]').disabled, true)
  assert.match(shadow.querySelector('.panel').textContent, /没有安装酒馆/)
})

test('a failing state request surfaces an error without breaking the overlay', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3080/' })
  const descriptors = []
  dom.window.__ModuleLoader__ = { load: (descriptor) => descriptors.push(descriptor) }
  new Function(
    'window', 'document', 'fetch', 'console', 'MutationObserver', 'getComputedStyle', 'setTimeout', 'location',
    readFileSync(CLIENT, 'utf8'),
  )(
    dom.window,
    dom.window.document,
    async () => {
      throw new Error('boom')
    },
    console,
    dom.window.MutationObserver,
    dom.window.getComputedStyle,
    dom.window.setTimeout.bind(dom.window),
    dom.window.location,
  )
  descriptors[0].factory(() => ({})).apply({})
  const host = dom.window.document.getElementById(HOST_ID)
  host.shadowRoot.querySelector('.pill').click()
  await tick()
  assert.match(host.shadowRoot.querySelector('.panel').textContent, /无法读取切换状态/)
})
