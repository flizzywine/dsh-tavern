import test from 'node:test'
import assert from 'node:assert/strict'
import { mountWorldBookDetail } from './fixtures/worldbook-detail-vm.mjs'

const entries = [
  { ref: 'a', comment: '固定设定', title: '固定设定', content: '甲设定', enabled: true, constant: true, primaryKeys: [], secondaryKeys: [] },
  { ref: 'b', comment: '会切换', title: '会切换', content: '乙设定', enabled: true, constant: false, channel: 'tail', primaryKeys: [], secondaryKeys: [] }
]

test('编辑旧世界书时没有通道选项，改条目仍只写这一条', async () => {
  const page = mountWorldBookDetail({ displayName: '测试书', channel: 'prefix', entries })
  assert.doesNotMatch(page.text(page.tree), /注入通道|每轮尾部/)
  assert.equal(page.nodes().find(node => node.props.label === '注入通道'), undefined)
  const editor = page.nodes().find(node => node.tag === page.components.WorldBookEntryEditor && node.props.entry.ref === 'b')
  await editor.props.onPatch({ content: '修改后的设定' })
  const [method, args] = page.calls.at(-1)
  assert.equal(method, 'updateWorldBook')
  assert.equal(args.lean, true)
  assert.equal(args.update.channel, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(args.update.operations)), [{ op: 'update', ref: 'b', patch: { content: '修改后的设定' } }])
})