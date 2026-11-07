import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { helperClient as client } from './fixtures/helper-host-harness.mjs'

function conversation(count = 5, options = {}) {
  const dom = new JSDOM('<!doctype html><body><main id="root"></main></body>')
  const document = dom.window.document
  const root = document.getElementById('root')
  const rows = []
  for (let turn = 1; turn <= count; turn++) {
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-kind', 'turn-error')
    row.setAttribute('data-chat-turn', String(turn))
    row.textContent = '模型接口报错 ' + turn
    root.append(row)
    rows.push(row)
  }
  // The failure still owning the tail keeps its own row, so it never joins the pile.
  const tail = document.createElement('div')
  tail.setAttribute('data-chat-flow-kind', 'turn-error')
  tail.setAttribute('data-chat-turn', String(count + 1))
  tail.textContent = 'TOO_LONG_ERROR '.repeat(100)
  root.append(tail)
  const storage = new Map()
  const removed = []
  const controls = client.createTurnErrorControls(root, {
    sessionId: 'pile', storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    staleTurns: Array.from({ length: count }, (_, index) => index + 1), failedTailTurn: null,
    onRemoveStale: async function (turns) { removed.push(turns) },
    ...options
  })
  controls.apply()
  const panels = () => [...root.querySelectorAll('.dsh-tavern-error-controls')]
  const summary = () => root.querySelector('.dsh-tavern-error-summary')
  const visible = () => panels().filter(panel => !panel.hidden)
  return { dom, document, root, rows, tail, storage, removed, controls, panels, summary, visible }
}

test('查看错误展开全部过期失败，再点收起回到一行', () => {
  const { summary, visible } = conversation()
  const [toggle] = summary().querySelectorAll('button')
  toggle.click()
  assert.equal(summary().textContent, '共 5 轮失败已清除收起全部移除')
  assert.equal(visible().length, 6, '五条过期失败加当前失败都能看到')
  toggle.click()
  assert.equal(summary().textContent, '共 5 轮失败已清除，错误已收起查看错误全部移除')
  assert.equal(visible().length, 1)
})

test('全部移除只提交过期轮次，移除后整堆消失并记住选择', async () => {
  const { summary, visible, removed, storage } = conversation()
  const [, discard] = summary().querySelectorAll('button')
  await discard.click()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(removed.length, 1)
  assert.deepEqual([...removed[0]], [1, 2, 3, 4, 5], '当前失败所在的轮次不能被顺手隐藏')
  assert.equal(summary().hidden, true)
  assert.equal(visible().length, 1, '只剩当前失败那一行')
  assert.deepEqual(JSON.parse(storage.get('dsh-tavern-hidden-errors:pile')), ['1', '2', '3', '4', '5'])
  const reloaded = conversation(5, { hiddenTurns: [1, 2, 3, 4, 5] })
  assert.equal(reloaded.root.querySelector('.dsh-tavern-error-summary'), null, '重开对话也不会把移除掉的堆再画出来')
  assert.equal(reloaded.visible().length, 1)
})
