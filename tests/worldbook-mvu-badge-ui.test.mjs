import test from 'node:test'
import assert from 'node:assert/strict'
import { mountWorldBookDetail } from './fixtures/worldbook-detail-vm.mjs'

test('世界书详情把 [mvu_update] 条目放进「仅后台变量更新」，灯只有启用 / 禁用', () => {
  const entries = [
    { ref: 'a', comment: '世界观', content: '常驻设定', constant: true },
    { ref: 'b', comment: '[mvu_update] 变量更新规则', content: '规则', constant: true },
    { ref: 'c', comment: '钟楼', content: '触发设定', constant: false, primaryKeys: ['钟楼'] }
  ]
  const page = mountWorldBookDetail({ displayName: '书', entries }, { open: false })
  const groups = page.nodes().filter(node => node.tag === page.ui.StageSection && node.props.className === 'dsh-wbd-group')
  const refs = title => groups.find(node => node.props.title === title)
  const rows = title => { const group = refs(title); return group ? group.children.flatMap(function walk(node) { return !node || typeof node !== 'object' ? [] : node.tag === page.components.WorldBookEntryRow ? [node.props.entry.ref] : node.children.flatMap(walk) }) : [] }

  assert.deepEqual(groups.map(node => node.props.title), ['常驻', '非常驻', '仅后台变量更新'])
  assert.deepEqual(rows('常驻'), ['a'])
  assert.deepEqual(rows('非常驻'), ['c'])
  assert.deepEqual(rows('仅后台变量更新'), ['b'])
  assert.match(refs('仅后台变量更新').props.help, /只交给后台变量更新任务，不发给正文模型/)
  const lamp = ref => page.nodes().find(node => node.tag === page.ui.LampMenu && node.props.label === '「' + entries.find(e => e.ref === ref).comment + '」的状态')
  assert.equal(lamp('b').props.onOff, true)
  assert.equal(lamp('b').props.mode, 'on')
  assert.equal(lamp('a').props.mode, 'constant')
  assert.equal(lamp('c').props.mode, 'keyword')
  assert.equal(lamp('c').props.words.keyword, '非常驻')
})