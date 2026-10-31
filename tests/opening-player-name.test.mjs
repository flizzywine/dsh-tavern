import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const line = source.split('\n').find(line => line.includes('className: "dsh-tavern-player-name"'))
function input(state, update) {
  const tree = vm.runInNewContext(line.trim().replace(/,$/, ''), {
    h: (tag, props, ...children) => ({ tag, props, children }),
    openingPicker: state, busy: false, setOpeningPicker: update,
  })
  return tree.children.find(node => node?.tag === 'input').props
}

test('输入不覆盖同一期间返回的开场准备信息，也不恢复已关闭的面板', () => {
  let state = { userName: '你', preparationId: 'old' }
  const update = value => { state = typeof value === 'function' ? value(state) : value }
  const handler = input(state, update).onChange
  state = { ...state, preparationId: 'new' }
  handler({ target: { value: '玩家' } })
  assert.equal(state.preparationId, 'new')
  state = null
  handler({ target: { value: '玩家二' } })
  assert.equal(state, null)
})
