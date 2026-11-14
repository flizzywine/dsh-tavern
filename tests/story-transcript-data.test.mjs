import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')

// 纯投影函数不依赖 React 运行时；@include 片段按脚本语义执行，函数声明落在全局。
const context = vm.createContext({ console })
vm.runInContext(dataSource, context)
vm.runInContext('globalThis.__storyData = { rows: tavernStoryTranscriptRows, streamRows: tavernStoryTranscriptStreamRows, pendingRows: tavernStoryTranscriptPendingRows }', context)
const data = context.__storyData

const story = (messages, revision = 3) => projectStoryTranscript({
	chat: { messages }, from: 0, to: messages.length - 1, messageCount: messages.length, revision
})

// 两条同 turn 的 assistant 行 + 一条后续 turn 行：重生成目标必须只按 UID 命中。
const MESSAGES = [
	{ role: 'user', turn: 1, text: '第一句行动' },
	{ role: 'assistant', turn: 1, text: '第一楼旧正文', messageUid: 'uid-1' },
	{ role: 'user', turn: 2, text: '第二句行动' },
	{ role: 'assistant', turn: 2, text: '目标旧正文', messageUid: 'uid-target' },
	{ role: 'assistant', turn: 2, text: '同轮旧正文', messageUid: 'uid-sibling' },
	{ role: 'user', turn: 3, text: '第三句行动' },
	{ role: 'assistant', turn: 3, text: '后续旧正文', messageUid: 'uid-next' }
]
const partial = { turn: 0, blocks: [{ kind: 'reasoning', text: '思考' }, { kind: 'text', text: '流式新正文' }] }

const baseRows = () => data.rows(story(MESSAGES))

test('UID 找不到对应行时不回退到 turn 匹配', () => {
	const rows = baseRows()
	assert.deepEqual(data.streamRows(rows, partial, [], 3, true, 'uid-missing'), rows)
})


test('宿主提交回声只补尚未落盘的 requestId', () => {
	const transcript = story([
		{ role: 'user', text: '已经落盘', source: { kind: 'user', rpcId: 'rpc-saved' } },
		{ role: 'assistant', turn: 1, text: '正文' }
	])
	const base = data.rows(transcript)
	assert.equal(base[0].requestId, 'rpc-saved')
	const rows = data.pendingRows(base, [
		{ requestId: 'rpc-saved', text: '已经落盘' },
		{ requestId: 'rpc-new', text: '尚未落盘' }
	])
	assert.equal(rows.length, 3)
	assert.equal(rows[2].key, 'pending:rpc-new')
	assert.equal(rows[2].requestId, 'rpc-new')
	assert.equal(rows[2].absoluteIndex, null)
	assert.equal(data.pendingRows(base, []), base, '没有回声时不复制行数组')
})

test('同一请求号的玩家输入在视图里只画一条', () => {
	const transcript = story([
		{ role: 'assistant', turn: 1, text: '开场' },
		{ role: 'user', text: '同样的输入', source: { kind: 'user', rpcId: 'rpc-1' } },
		{ role: 'user', text: '同样的输入', source: { kind: 'user', rpcId: 'rpc-1' } },
		{ role: 'assistant', turn: 2, text: '正文' }
	])
	const rows = data.rows(transcript)
	assert.equal(rows.map(row => row.role).join(','), 'assistant,user,assistant')
	assert.equal(rows[1].text, '同样的输入')
	// 不同请求号、同样的文字仍是两次真实输入。
	const twice = data.rows(story([
		{ role: 'user', text: '再来一次', source: { kind: 'user', rpcId: 'rpc-a' } },
		{ role: 'user', text: '再来一次', source: { kind: 'user', rpcId: 'rpc-b' } }
	]))
	assert.equal(twice.map(row => row.requestId).join(','), 'rpc-a,rpc-b')
})

test('流式与直落正文行自动隐藏变量与控制协议标签块，保留代码块示例', () => {
	const committed = data.rows(story([
		{ role: 'user', turn: 1, text: '行动' },
		{ role: 'assistant', turn: 1, displayText: '正文第一段。\n<UpdateVariable>{"hp":1}</UpdateVariable>\n<Variables>{"gold":2}</Variables>\n<story_choices>{"actors":[{"name":"我","actions":["a"]}]}</story_choices>\n<ta_hub>{"version":1}</ta_hub>\n```xml\n<UpdateVariable>example</UpdateVariable>\n```' }
	]))
	assert.equal(committed[1].text, '正文第一段。\n\n\n\n\n```xml\n<UpdateVariable>example</UpdateVariable>\n```')

	const placeholderTranscript = story([
		{ role: 'user', turn: 1, text: '继续' },
		{ role: 'assistant', turn: 2, placeholder: true, text: '' }
	])
	const streamingRows = data.streamRows(data.rows(placeholderTranscript), {
		turn: 2,
		blocks: [{ kind: 'text', text: '流式正文。\n<ta_hub>{"version":1,"source":"preset fallback"' }]
	}, [], 2, true)
	assert.equal(streamingRows[1].text, '流式正文。\n')
	assert.equal(streamingRows[1].projection.text, '流式正文。\n')

	const choicesStreamingRows = data.streamRows(data.rows(placeholderTranscript), {
		turn: 2,
		blocks: [{ kind: 'text', text: '流式正文。\n<story_choices>{"actions":["a"]' }]
	}, [], 2, true)
	assert.equal(choicesStreamingRows[1].text, '流式正文。\n')
})
