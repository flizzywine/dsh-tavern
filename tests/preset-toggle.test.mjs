import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function entryRow(entry)')
const rows = source.slice(start, source.indexOf('if (preset && preset.path === detailPath)', start))
function render(kind, enabled, busy = false, marker = false) {
  const calls = []
  const value = { name: '测试条目', content: '内容', role: 'system', entryKey: 'entry', regexKey: 'regex', enabled, marker, edit: { promptPath: '/prompts/0', enabledPaths: ['/enabled'] } }
  const sandbox = {
    h: (type, props, ...children) => ({ type, props, children }), busy,
    entryDraft: x => x, entryValue: x => x, regexDraft: x => x, regexValue: x => x,
    togglePresetEntry: x => calls.push(['entry', x]), togglePresetRegex: x => calls.push(['regex', x]),
  }
  vm.runInNewContext(rows + '; this.renderRow = ' + (kind === 'entry' ? 'entryRow' : 'regexRow'), sandbox)
  return { row: sandbox.renderRow(value), value, calls }
}
for (const kind of ['entry', 'regex']) {
  test(`${kind} 开关可访问、显示已保存状态，并阻止点击展开条目`, () => {
    for (const enabled of [true, false]) {
      const { row, value, calls } = render(kind, enabled)
      const button = row.children[0].children.at(-1)
      assert.equal(button.type, 'button')
      assert.equal(button.props.role, 'switch')
      assert.equal(button.props['aria-checked'], enabled)
      assert.equal(button.props['aria-label'], '测试条目启用状态')
      assert.equal(button.children.length, 0)
      assert.match(button.props.className, enabled ? / on$/ : / off$/)
      const events = []
      button.props.onClick({ preventDefault() { events.push('prevent') }, stopPropagation() { events.push('stop') } })
      assert.deepEqual(events, ['prevent', 'stop'])
      assert.deepEqual(calls, [[kind, value]])
      assert.equal(render(kind, enabled, true).row.children[0].children.at(-1).props.disabled, true)
    }
  })
}
test('预设摘要不显示角色前缀，编辑区保留角色，系统占位仍只读', () => {
  const { row } = render('entry', true)
  assert.equal(row.children[0].children.length, 2)
  assert.ok(!JSON.stringify(row.children[0]).includes('dsh-tavern-prompt-role'))
  assert.ok(JSON.stringify(row.children[1]).includes('角色'))
  const readOnly = render('entry', true, false, true).row.children[0].children.at(-1)
  assert.equal(readOnly.type, 'span')
  assert.equal(readOnly.props.role, undefined)
  assert.equal(readOnly.props.onClick, undefined)
})
