import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function TavernMvuReceipt(props)')
const end = source.indexOf('function htmlPartHasPresentation(', start)
assert.ok(start >= 0 && end > start)
const sandbox = vm.createContext({ React: {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(value) { return [value, () => {}] }
} })
vm.runInContext(source.slice(start, end), sandbox)

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  return typeof node === 'object' ? textOf(node.children) : String(node)
}

test('等待中的结算直接重新投递，不询问指导意见；实际运行时仍禁用', async () => {
  const findButton = node => {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button') return node
    return (Array.isArray(node) ? node : node.children || []).map(findButton).find(Boolean)
  }
  const props = { latest: true, sessionId: 's', turn: 2, receipt: { status: 'pending' } }
  const waiting = sandbox.TavernMvuReceipt(props)
  assert.match(textOf(waiting), /变量结算等待中/)
  assert.match(textOf(waiting), /重新投递结算/)
  assert.ok(!findButton(waiting).props.disabled)
  const running = sandbox.TavernMvuReceipt({ ...props, busy: true })
  assert.equal(findButton(running).props.disabled, true)
  assert.match(textOf(running), /变量结算中…/)
  sandbox.askTavernText = async () => { assert.fail('redelivery must reuse the saved plan') }
  let request, invalidated
  sandbox.rpc = async (...args) => { request = args }
  sandbox.liveTavernView = { invalidate(sessionId) { invalidated = sessionId } }
  await findButton(waiting).props.onClick()
  assert.equal(request[0], 'retrySettlement')
  assert.equal(request[1].turn, 2)
  assert.equal(Object.hasOwn(request[1], 'guidance'), false)
  assert.equal(request[2], 's')
  assert.equal(invalidated, 's')
})
