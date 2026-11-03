import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import vm from 'node:vm'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/card-password.js', import.meta.url), 'utf8')
function setup() {
  const dom = new JSDOM('<!doctype html><button id="opener">import</button>', { runScripts: 'outside-only', url: 'http://localhost' })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')) }
  vm.runInContext(source, dom.getInternalVMContext())
  return { dom, window: dom.window, ask: options => dom.window.askTavernCardPassword(options), retry: (...args) => dom.window.importTavernPasswordCard(...args) }
}

test('normal cards never show a password dialog; wrong password retries and cancellation cleans the same upload', async () => {
  const h = setup()
  assert.equal(await h.retry(async password => { assert.equal(password, undefined); return 'ok' }, 'plain'), 'ok')
  assert.equal(h.window.document.querySelector('dialog'), null)
  const seen = [], answers = ['wrong', 'right']
  const result = await h.retry(async password => { seen.push(password); if (password !== 'right') throw Object.assign(new Error('密码不正确'), { code: password ? 'TAVERN_CARD_PASSWORD_INVALID' : 'TAVERN_CARD_PASSWORD_REQUIRED' }); return 'imported' }, 'locked', null, async () => answers.shift())
  assert.equal(result, 'imported'); assert.deepEqual(seen, [undefined, 'wrong', 'right'])
  let cleaned = 0
  await assert.rejects(h.retry(async () => { throw Object.assign(new Error('locked'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' }) }, 'locked', async () => { cleaned++ }, async () => null), { code: 'TAVERN_CARD_IMPORT_CANCELLED' })
  assert.equal(cleaned, 1)
  h.dom.window.close()
})

test('password fields show plain text, are confirmed before encryption, emptied and removed when done', async () => {
  const h = setup(), promise = h.ask({ name: 'locked.dshcard', confirm: true })
  const form = h.window.document.querySelector('form'), fields = form.querySelectorAll('input')
  assert.equal(fields.length, 2); assert.ok([...fields].every(field => field.type === 'text'))
  fields[0].value = 'secret-test'; fields[1].value = 'different'
  form.dispatchEvent(new h.window.Event('submit', { cancelable: true }))
  assert.equal(form.querySelector('[role=alert]').textContent, '两次密码不一致')
  fields[1].value = 'secret-test'; form.dispatchEvent(new h.window.Event('submit', { cancelable: true }))
  assert.equal(await promise, 'secret-test')
  assert.equal(fields[0].value, ''); assert.equal(fields[1].value, '')
  assert.equal(h.window.document.querySelector('dialog'), null)
  h.dom.window.close()
})

test('Escape/page navigation cancel the dialog without keeping password text', async () => {
  const h = setup()
  const first = h.ask({ name: 'locked' }), field = h.window.document.querySelector('input')
  field.value = 'typed-secret'
  h.window.document.querySelector('dialog').dispatchEvent(new h.window.Event('cancel', { cancelable: true }))
  assert.equal(await first, null); assert.equal(field.value, '')
  const second = h.ask({ name: 'locked' })
  h.window.dispatchEvent(new h.window.Event('pagehide'))
  assert.equal(await second, null)
  assert.equal(h.window.document.querySelector('dialog'), null)
  h.dom.window.close()
})
