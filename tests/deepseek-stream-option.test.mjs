import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { deepSeekEventsFromResponse, patchDeepSeekStreamSource } from '../tavern-plugin/lib/domain/deepseek-stream-option.js'

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
