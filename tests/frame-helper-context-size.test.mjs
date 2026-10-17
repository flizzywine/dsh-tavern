import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/runtime/message-frame-lifecycle.js', import.meta.url), 'utf8')
// The frame-context helpers are self-contained; the rest of the module needs a host page.
const helpers = source.slice(source.indexOf('const TAVERN_FRAME_INLINE_FLOORS'), source.indexOf('function applyTavernHelperContextUpdate'))
const { tavernFrameHelperContext, createTavernHelperContextUpdate } = vm.runInNewContext(helpers + '; ({ tavernFrameHelperContext, createTavernHelperContextUpdate })')

const display = { source: '正文', formattingText: '<div>'.repeat(5000) }
function context(count, extra = {}) {
  return { version: 1, stateRevision: 1, turnMessageIds: { 3: 4 }, ...extra,
    messages: Array.from({ length: count }, (_, id) => ({ message_id: id, role: id % 2 ? 'assistant' : 'user', message: '第' + id + '楼', swipe_id: 0, swipes: ['第' + id + '楼'],
      swipes_data: [{ hp: id }], variables: { hp: id }, pluginData: { template_display: display, template_rendered: true, swipe_info: [{ id }] } })) }
}

test('未变化的楼层保持同一投影，增量更新只携带变化的楼层', () => {
  const access = { token: 'cap', revision: 1 }
  const before = context(60, { historyAccess: access })
  const changed = { ...before.messages[59], variables: { hp: 999 } }
  const after = { ...before, stateRevision: 2, messages: [...before.messages.slice(0, 59), changed] }
  const update = createTavernHelperContextUpdate(tavernFrameHelperContext(before, 3), tavernFrameHelperContext(after, 3), 3, 3)
  assert.equal(update.kind, 'patch')
  assert.equal(JSON.stringify(update.operations.map(item => item.op + ':' + item.index)), '["message.replace:59"]')
  assert.equal(JSON.stringify(update.events), '["MESSAGE_UPDATED","mag_variable_update_ended"]')
})
