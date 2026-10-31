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

test('只有最新正文提供重算入口，忙碌时禁用，指导意见随请求提交', async () => {
  const receipt = { status: 'updated', changes: [] }
  const historical = sandbox.TavernMvuReceipt({ receipt, latest: false })
  assert.doesNotMatch(textOf(historical), /重新结算变量/)
  const findButton = node => {
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button') return node
    for (const child of (Array.isArray(node) ? node : node.children || [])) {
      const found = findButton(child)
      if (found) return found
    }
    return null
  }
  const current = sandbox.TavernMvuReceipt({ receipt, latest: true, sessionId: 's', turn: 2 })
  assert.equal(current.type, 'details')
  assert.match(textOf(current), /重新结算变量/)
  const busy = sandbox.TavernMvuReceipt({ receipt, latest: true, busy: true })
  assert.equal(findButton(busy).props.disabled, true)
  let request
  sandbox.askTavernText = async options => {
    assert.equal(options.allowEmpty, true)
    await options.onSubmit('不要扣库存')
  }
  sandbox.rpc = async (...args) => { request = args }
  sandbox.liveTavernView = { invalidate() {} }
  sandbox.tavernErrorHub = { report(_label, error) { throw error } }
  await findButton(current).props.onClick()
  assert.equal(request[0], 'retrySettlement')
  assert.equal(request[1].turn, 2)
  assert.equal(request[1].guidance, '不要扣库存')
  assert.equal(request[2], 's')
})

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
