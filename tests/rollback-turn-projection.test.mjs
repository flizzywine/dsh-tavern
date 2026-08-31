import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const projectionSource = source.slice(source.indexOf('function hideTurnTail(el)'), source.indexOf('async function submitBodyRegeneration('))

function row(kind, turn, alpha) {
  const attrs = { 'data-chat-flow-kind': kind }
  if (alpha) attrs['data-chat-turn'] = String(turn)
  return {
    style: { display: '' }, previousElementSibling: null,
    getAttribute(name) { return attrs[name] ?? null },
    querySelector(selector) {
      return kind === 'turn-tail' && selector === '[data-turn-tail]'
        ? { getAttribute() { return String(turn) } } : null
    }
  }
}

function harness(rows) {
  rows.forEach((row, index) => { row.previousElementSibling = rows[index - 1] ?? null })
  const document = { querySelectorAll(selector) {
    assert.equal(selector, '[data-chat-flow-kind="turn-tail"]')
    return rows.filter(row => row.getAttribute('data-chat-flow-kind') === 'turn-tail')
  } }
  return vm.runInNewContext(projectionSource + '\n({ applySuppressedDshTurns, hideTurnTailWithUser })', { document })
}

for (const alpha of [false, true]) {
  test(`${alpha ? 'alpha' : 'main'} 回退隐藏整轮，包含用户输入之前的系统提示词`, () => {
    const before = ['user', 'assistant-step', 'turn-tail'].map(kind => row(kind, 5, alpha))
    const removed = ['system-prompt', 'user', 'turn-process', 'context', 'assistant-step', 'turn-tail'].map(kind => row(kind, 6, alpha))
    const after = ['system-prompt', 'user', 'assistant-step', 'turn-tail'].map(kind => row(kind, 8, alpha))
    const projection = harness([...before, ...removed, ...after])
    projection.applySuppressedDshTurns([6])
    assert.ok(removed.every(row => row.style.display === 'none'), 'system prompt must disappear with the rolled-back turn')
    assert.ok([...before, ...after].every(row => row.style.display === ''), 'adjacent turns remain unchanged')
    projection.applySuppressedDshTurns([6])
    assert.ok(removed.every(row => row.style.display === 'none'), 'refresh/repeated projection remains stable')
  })

  test(`${alpha ? 'alpha' : 'main'} 首轮或无用户输入的重生成轮也能完整隐藏`, () => {
    const removed = ['system-prompt', 'context', 'assistant-step', 'turn-tail'].map(kind => row(kind, 1, alpha))
    harness(removed).applySuppressedDshTurns([1])
    assert.ok(removed.every(row => row.style.display === 'none'))
  })
}

test('alpha 上一轮尾部未挂载时，仍按明确轮次边界保留上一轮', () => {
  const before = row('assistant-step', 5, true)
  const removed = ['system-prompt', 'user', 'assistant-step', 'turn-tail'].map(kind => row(kind, 6, true))
  harness([before, ...removed]).applySuppressedDshTurns([6])
  assert.equal(before.style.display, '')
  assert.ok(removed.every(row => row.style.display === 'none'))
})
