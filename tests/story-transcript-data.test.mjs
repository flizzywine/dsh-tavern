import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { withStyleReferenceProtocol } from './helpers/style-reference-source.mjs'
import vm from 'node:vm'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8').then(withStyleReferenceProtocol)

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

test('旧存档和流式正文隐藏文风工具标签，保留后续正文', () => {
	const text = '<style_reference_submit">她推开门。<style_reference_submit>范文</style_reference_submit>'
	const rows = data.rows(story([{ role: 'assistant', turn: 1, text, messageUid: 'uid' }]))
	assert.equal(rows[0].text, '她推开门。')
	const streamed = { ...partial, blocks: [{ kind: 'text', text }] }
	assert.equal(data.streamRows(rows, streamed, [], 3, true, 'uid')[0].text, '她推开门。')
})

test('UID 找不到对应行时不回退到 turn 匹配', () => {
	const rows = baseRows()
	assert.deepEqual(data.streamRows(rows, partial, [], 3, true, 'uid-missing'), rows)
})
