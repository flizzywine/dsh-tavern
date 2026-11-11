import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openAICompletionChunks } from '../tavern-plugin/lib/domain/pi-ai-nonstream.js'
import { patchPiAiNonStream } from '../bin/pi-ai-nonstream-patch.mjs'

const fixture = `function buildParams(model, context, options) {
    const params = {
        model: model.id,
        messages: [],
        stream: true,
        prompt_cache_key: undefined,
    };
    if (compat.supportsUsageInStreaming !== false) {
        params.stream_options = { include_usage: true };
    }
    return params;
}
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    (async () => {
        const { data: openaiStream, response } = await client.chat.completions.create(params, requestOptions).withResponse();
            for await (const chunk of openaiStream) {
                consume(chunk);
            }
    })();
    return stream;
};
export const streamSimple = (model, context, options) => {
    return stream(model, context, {
        ...base,
        reasoningEffort,
        thinkingBudgets: options?.thinkingBudgets,
    });
};
`

const adapterFixture = `const iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {
					...profileOptions(profile, reasoning, apiKey),
					...options.temperature === void 0 ? {} : { temperature: options.temperature },
					...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },
					...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },
					signal: watchdog.signal,
					headers: requestHeaders(profile.headers)
				}), model.contextWindow, options.signal, model.id)[Symbol.asyncIterator]();`

test('OpenAI 完整响应投影为现有流解析器消费的单个 chunk', () => {
  const chunks = openAICompletionChunks({
    id: 'chatcmpl-1',
    model: 'actual-model',
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: '正文',
        reasoning_content: '思考',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } },
          { id: 'call-2', type: 'function', function: { name: 'save', arguments: { value: 1 } } },
        ],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  }, 'fallback-model')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].id, 'chatcmpl-1')
  assert.equal(chunks[0].model, 'actual-model')
  assert.equal(chunks[0].usage.total_tokens, 14)
  assert.equal(chunks[0].choices[0].delta.content, '正文')
  assert.equal(chunks[0].choices[0].delta.reasoning_content, '思考')
  assert.equal(chunks[0].choices[0].finish_reason, 'tool_calls')
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].index, 0)
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].function.arguments, '{"q":"x"}')
  assert.equal(chunks[0].choices[0].delta.tool_calls[1].function.arguments, '{"value":1}')
  assert.deepEqual(openAICompletionChunks(null), [])
  assert.deepEqual(openAICompletionChunks({ choices: [] }), [])
})

test('pi-ai 安装补丁同时改写适配器与 SDK，漂移时两处都不写', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-ai-nonstream-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const adapterDirectory = path.join(root, 'dsh-llm-pi-ai')
  const sdkDirectory = path.join(root, 'pi-ai')
  await mkdir(path.join(adapterDirectory, 'lib'), { recursive: true })
  await mkdir(path.join(sdkDirectory, 'dist', 'api'), { recursive: true })
  await writeFile(path.join(adapterDirectory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai' }))
  await writeFile(path.join(sdkDirectory, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai' }))
  const adapterFile = path.join(adapterDirectory, 'lib', 'index.js')
  const apiFile = path.join(sdkDirectory, 'dist', 'api', 'openai-completions.js')
  await writeFile(adapterFile, adapterFixture)
  await writeFile(apiFile, fixture)
  assert.equal(patchPiAiNonStream({ adapterDirectory, sdkDirectory }), true)
  assert.equal(patchPiAiNonStream({ adapterDirectory, sdkDirectory }), false)
  assert.match(await readFile(adapterFile, 'utf8'), /typeof options\.stream === "boolean"/)
  assert.match(await readFile(apiFile, 'utf8'), /openAICompletionChunks/)
  await writeFile(adapterFile, adapterFixture)
  await writeFile(apiFile, fixture.replace('stream: true', 'stream: changed'))
  assert.equal(patchPiAiNonStream({ adapterDirectory, sdkDirectory }), null)
  assert.equal(await readFile(adapterFile, 'utf8'), adapterFixture)
  assert.equal(await readFile(apiFile, 'utf8'), fixture.replace('stream: true', 'stream: changed'))
})
