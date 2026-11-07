import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')

// 纯投影函数不依赖 React 运行时；@include 片段按脚本语义执行，函数声明落在全局。
const context = vm.createContext({ console })
vm.runInContext(dataSource, context)
vm.runInContext('globalThis.__storyData = { rows: tavernStoryTranscriptRows, streamRows: tavernStoryTranscriptStreamRows }', context)
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
const TARGET = 3
const SIBLING = 4
const NEXT = 6

const baseRows = () => data.rows(story(MESSAGES))

test('重生成只按 messageUid 覆盖目标行，同 turn 行与后续行（含 turn 提示指向的行）不动', () => {
	const rows = baseRows()
	assert.equal(rows.length, MESSAGES.length)
	assert.equal(rows[TARGET].messageUid, 'uid-target')
	assert.equal(rows[SIBLING].messageUid, 'uid-sibling')
	// 提示 turn 是 3（latestAssistantTurn）：不认 UID 就会落到这条后续行上。
	const streamed = data.streamRows(rows, partial, [], 3, true, 'uid-target')
	assert.notStrictEqual(streamed, rows)
	assert.equal(streamed[TARGET].text, '流式新正文', '目标 UID 行承载流式正文')
	assert.equal(streamed[TARGET].streaming, true)
	assert.equal(streamed[TARGET].messageUid, 'uid-target')
	assert.equal(streamed[SIBLING].text, '同轮旧正文', '同 turn 的兄弟行不得被覆盖')
	assert.equal(streamed[SIBLING].streaming, false)
	assert.equal(streamed[NEXT].text, '后续旧正文', 'turn 提示指向的行不得被覆盖')
	assert.equal(streamed[NEXT].streaming, false)
	assert.equal(streamed[1].text, '第一楼旧正文')
	assert.equal(streamed[0].text, '第一句行动')
	assert.equal(rows[TARGET].text, '目标旧正文', '原行数组不得被就地改写')
	assert.equal(rows[TARGET].streaming, false)
})

test('没有 UID 标记时保持按 turn 匹配的旧行为', () => {
	const rows = baseRows()
	const streamed = data.streamRows(rows, partial, [], 3, true)
	assert.equal(streamed[NEXT].text, '流式新正文')
	assert.equal(streamed[TARGET].text, '目标旧正文', '无 UID 时不得顺手覆盖同 turn 行')
	assert.equal(streamed[SIBLING].text, '同轮旧正文')
})

test('UID 找不到对应行时不回退到 turn 匹配', () => {
	const rows = baseRows()
	assert.deepEqual(data.streamRows(rows, partial, [], 3, true, 'uid-missing'), rows)
})

test('UID 命中已提交行需要 allowCommitted，命中占位行不需要', () => {
	const rows = baseRows()
	assert.deepEqual(data.streamRows(rows, partial, [], 2, false, 'uid-target'), rows, '已提交行默认不许被迟到 partial 覆盖')
	const pending = data.rows(story([
		{ role: 'user', turn: 1, text: '输入' },
		{ role: 'assistant', turn: 2, text: '', placeholder: true, messageUid: 'uid-pending' }
	]))
	assert.equal(pending[1].streaming, true)
	const streamed = data.streamRows(pending, partial, [], 2, false, 'uid-pending')
	assert.equal(streamed[1].text, '流式新正文', '占位行即使 allowCommitted=false 也要承载流式正文')
	assert.equal(streamed[1].streaming, true)
	assert.equal(streamed[1].messageUid, 'uid-pending')
})

test('UID 命中且 turn 提示缺失（非整数）时仍然只覆盖目标行', () => {
	const rows = baseRows()
	const streamed = data.streamRows(rows, partial, [], null, true, 'uid-target')
	assert.equal(streamed[TARGET].text, '流式新正文')
	assert.equal(streamed[NEXT].text, '后续旧正文')
	assert.equal(streamed[SIBLING].text, '同轮旧正文')
})
