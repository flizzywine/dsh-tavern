import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function SystemPromptSidebarTab()')
const body = source.slice(start, source.indexOf('\n\t\tfunction ', start + 20))
const flush = () => new Promise(resolve => setImmediate(resolve))
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  return (predicate(tree) ? [tree] : []).concat((tree.children || []).flatMap(node => find(node, predicate)))
}

for (const action of ['保存此项', '恢复默认']) test(action + '只清除目标项草稿，保留其他项未保存内容', async () => {
  let state, initial = true
  const effects = []
  const persisted = [{ name: 'a', label: 'A', text: 'old A', customized: true }, { name: 'b', label: 'B', text: 'old B' }]
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
    useState(init) { state ??= init; return [state, value => { state = typeof value === 'function' ? value(state) : value }] },
    useRef() { return {} },
    useEffect(fn) { if (initial) effects.push(fn) }
  }
  const Component = vm.runInNewContext(body + '\n; SystemPromptSidebarTab', {
    React, InlineField: 'inline-field', PanelLoading: 'panel-loading', useTavernConfirm: () => async () => true,
    rpc: async (method, args) => {
      if (method === 'updateSystemPrompt') persisted.find(row => row.name === args.name).text = args.text ?? 'default A'
      return { systemPrompts: { prompts: persisted.map(row => ({ ...row })) } }
    }
  })
  const render = () => { const tree = Component(); initial = false; return tree }
  const textareas = () => find(render(), node => node.type === 'textarea')
  render()
  await effects[0]()
  await flush()
  textareas()[0].props.onChange({ target: { value: 'NEW A' } })
  textareas()[1].props.onChange({ target: { value: 'NEW B' } })
  find(render(), node => node.type === 'button' && node.children[0] === action)[0].props.onClick()
  await flush()
  assert.equal(textareas()[1].props.value, 'NEW B')
  assert.equal(persisted[0].text, action === '保存此项' ? 'NEW A' : 'default A')
  assert.equal(persisted[1].text, 'old B')
  assert.equal(state.drafts.a, undefined)
  assert.equal(state.drafts.b, 'NEW B')
})
