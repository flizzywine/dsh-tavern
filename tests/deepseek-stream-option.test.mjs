import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deepSeekEventsFromResponse, patchDeepSeekStreamSource } from '../tavern-plugin/lib/domain/deepseek-stream-option.js'
import { patchDeepSeekStreamOption } from '../bin/deepseek-stream-option-patch.mjs'

const fixture = `function serialize(options) {
	return {
		model: options.model,
		stream: true,
		messages: []
	}
}
async function* request(options) {
	const response = await fetch('', { headers: {
		"accept": "text/event-stream",
	} })
	yield* translate(parseSse(response.body, activity), options.model);
}
/** Translate decoded SSE data into the Harness stream protocol. */
async function* translate(events, model) {}
`

test('DeepSeek 非流式 JSON 映射为现有翻译器使用的事件序列', () => {
  const usage = { input_tokens: 10, output_tokens: 4 }
  const events = deepSeekEventsFromResponse({
    content: [
      { type: 'thinking', thinking: '想', signature: 'sig' },
      { type: 'text', text: '正文' },
      { type: 'tool_use', id: 'call1', name: 'tool', input: { value: 1 } },
    ],
    stop_reason: 'tool_use', usage,
  })
  assert.deepEqual(events[0], { type: 'message_start', message: { usage } })
  assert.deepEqual(events[1], { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '想', signature: 'sig' } })
  assert.deepEqual(events[2], { type: 'content_block_stop', index: 0 })
  assert.equal(events.filter(event => event.type === 'content_block_start').length, 3)
  assert.deepEqual(events.at(-2), { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage })
  assert.deepEqual(events.at(-1), { type: 'message_stop' })
  assert.equal(deepSeekEventsFromResponse({ content: [{ type: 'tool_use', id: 'x', name: 't', input: {} }] }).at(-2).delta.stop_reason, 'tool_use')
  assert.throws(() => deepSeekEventsFromResponse(null), /non-object/)
})

test('DeepSeek 适配器补丁同时修改请求参数、Accept 和 JSON 响应分支，且幂等', () => {
  const result = patchDeepSeekStreamSource(fixture)
  assert.equal(result.status, 'applied')
  assert.match(result.text, /stream: options\.stream !== false/)
  assert.match(result.text, /"accept": options\.stream === false \? "application\/json" : "text\/event-stream"/)
  assert.match(result.text, /options\.stream === false \? deepSeekEventsFromResponse\(await response\.json\(\)\)/)
  new vm.Script(result.text)
  assert.equal(patchDeepSeekStreamSource(result.text).status, 'patched')
  assert.equal(patchDeepSeekStreamSource('function changed() {}').status, 'unmatched')
})

test('DeepSeek 安装补丁只在完整锚点上写入，漂移时保留原文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deepseek-stream-option-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'lib'))
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-deepseek' }))
  const file = path.join(directory, 'lib/index.js')
  await writeFile(file, fixture)
  assert.equal(patchDeepSeekStreamOption(directory), true)
  assert.equal(patchDeepSeekStreamOption(directory), false)
  await writeFile(file, fixture.replace('stream: true', 'stream: changed'))
  assert.equal(patchDeepSeekStreamOption(directory), null)
  assert.equal(await readFile(file, 'utf8'), fixture.replace('stream: true', 'stream: changed'))
})
