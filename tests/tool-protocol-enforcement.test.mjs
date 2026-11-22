import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GEMINI_THOUGHT_SIGNATURE_SENTINEL,
  GEMINI_THOUGHT_SIGNATURE_SENTINEL_BASE64,
  TOOL_CALL_STREAM_IDLE_TIMEOUT_MS,
  createCapabilityQuirkStore,
  detectNativeThinkingEnabled,
  detectWireProtocol,
  enhanceToolProtocolPayload,
  getCapturedThoughtSignature,
  installToolCallIdleTimeoutPatch,
  installToolProtocolFetchPatch,
  runWithToolProtocolDirective,
} from '../tavern-plugin/lib/domain/tool-protocol-enforcement.js'

test('Gemini 原生：注入 mode=ANY、allowedFunctionNames、base64 哨兵/真签名与 propertyOrdering', () => {
  const realBase64 = Buffer.from('real-gemini-sig-bytes-12', 'utf8').toString('base64')
  const raw = {
    contents: [
      { role: 'user', parts: [{ text: '开始' }] },
      { role: 'model', parts: [{ functionCall: { id: 'call_real', name: 'submit_story', args: { content: '第一轮' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call_real', name: 'submit_story', response: { output: '已收到。' } } }] },
      { role: 'model', parts: [{ functionCall: { id: 'call_fake', name: 'submit_story', args: { content: '第二轮' } } }] },
    ],
    tools: [{
      functionDeclarations: [
        { name: 'submit_story', parametersJsonSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
        { name: 'read_story_context', parametersJsonSchema: { type: 'object', properties: { scope: { type: 'string' } } } },
      ]
    }]
  }

  const { body, changed } = enhanceToolProtocolPayload(raw, {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:streamGenerateContent',
    directive: {
      provider: 'google',
      model: 'gemini-3.1-pro',
      forceToolChoice: true,
      allowedToolNames: ['submit_story'],
      signaturesByCallId: { call_real: realBase64 },
      toolSchemas: {
        submit_story: {
          order: ['think', 'content'],
          required: ['think', 'content'],
          properties: {
            think: { type: 'string', description: '思考' },
            content: { type: 'string', description: '正文' },
          }
        }
      }
    }
  })

  assert.equal(changed, true)
  assert.deepEqual(body.toolConfig, {
    functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['submit_story'] }
  })
  assert.equal(body.contents[1].parts[0].thoughtSignature, realBase64)
  assert.equal(body.contents[3].parts[0].thoughtSignature, GEMINI_THOUGHT_SIGNATURE_SENTINEL_BASE64)
  const submitParams = body.tools[0].functionDeclarations[0].parametersJsonSchema
  assert.deepEqual(Object.keys(submitParams.properties), ['think', 'content'])
  assert.deepEqual(submitParams.propertyOrdering, ['think', 'content'])
})

test('OpenAI 兼容 Gemini：单工具走命名 tool_choice 锁死出口，注入 extra_content.google.thought_signature，pg- 模型自动回退', () => {
  const raw = {
    model: 'google/gemini-3-pro-preview',
    messages: [
      { role: 'user', content: '开始' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'tvh_1', type: 'function', function: { name: 'submit_story', arguments: '{"content":"旧文"}' } }]
      },
      { role: 'tool', tool_call_id: 'tvh_1', content: '已收到。' }
    ],
    tools: [
      { type: 'function', function: { name: 'submit_story', parameters: { type: 'object', properties: { content: { type: 'string' } } } } },
      { type: 'function', function: { name: 'read_story_context', parameters: { type: 'object', properties: { scope: { type: 'string' } } } } }
    ]
  }

  const quirks = createCapabilityQuirkStore()
  const { body } = enhanceToolProtocolPayload(raw, {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    quirks,
    directive: {
      provider: 'openrouter',
      model: 'google/gemini-3-pro-preview',
      forceToolChoice: true,
      allowedToolNames: ['submit_story']
    }
  })

  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'submit_story' } })
  assert.equal(body.messages[1].tool_calls[0].extra_content.google.thought_signature, GEMINI_THOUGHT_SIGNATURE_SENTINEL)

  // pg- 前缀模型不强塞 tool_choice
  const pgRes = enhanceToolProtocolPayload({ ...raw, model: 'pg-gemini-3-pro' }, {
    url: 'https://proxy/v1/chat/completions',
    quirks,
    directive: { provider: 'proxy', model: 'pg-gemini-3-pro', forceToolChoice: true, allowedToolNames: ['submit_story'] }
  })
  assert.equal(pgRes.body.tool_choice, undefined)
})

test('Anthropic：强制 tool_choice 自动剥离互斥 thinking 与 beta 头，并回调提升工具内 think 字段', () => {
  const raw = {
    model: 'claude-opus-4-6',
    thinking: { type: 'enabled', budget_tokens: 8192 },
    messages: [{ role: 'user', content: '继续' }],
    tools: [{ name: 'submit_story', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } }]
  }

  const { body, headers } = enhanceToolProtocolPayload(raw, {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'interleaved-thinking-2025-05-14,prompt-caching-2024-07-31' },
    directive: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      forceToolChoice: true,
      allowedToolNames: ['submit_story'],
      resolveToolSchema(name, ctx) {
        if (name !== 'submit_story' || !ctx.anthropicThinkingStripped) return null
        return {
          order: ['think', 'content'],
          required: ['think', 'content'],
          properties: { think: { type: 'string' }, content: { type: 'string' } }
        }
      }
    }
  })

  assert.equal(body.thinking, undefined)
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_story' })
  assert.equal(headers['anthropic-beta'], 'prompt-caching-2024-07-31')
  assert.deepEqual(body.tools[0].input_schema.required, ['think', 'content'])
  assert.equal(body.tools[0].input_schema.propertyOrdering, undefined)
})

test('fetch 拦截器：作用域隔离、HTTP 400 当场自动降级重发、SSE 捕获真实 thought_signature', async t => {
  const seenBodies = []
  const quirks = createCapabilityQuirkStore()
  const fakeTarget = {
    async fetch(_url, init) {
      const parsed = init?.body ? JSON.parse(init.body) : null
      seenBodies.push(parsed)
      if (parsed?.tool_choice && typeof parsed.tool_choice === 'object') {
        return new Response(JSON.stringify({ error: { message: 'named tool_choice function is not supported' } }), { status: 400 })
      }
      if (parsed?.messages?.[0]?.tool_calls?.[0]?.extra_content) {
        return new Response(JSON.stringify({ error: { message: 'Unknown field extra_content' } }), { status: 400 })
      }
      const sse = [
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_live_99","type":"function","function":{"name":"submit_story","arguments":"{\\"content\\":"},"extra_content":{"google":{"thought_signature":"LIVE_SERVER_SIG_XYZ"}}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"正文\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n'
      ].join('')
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
  }

  const dispose = installToolProtocolFetchPatch(fakeTarget, { quirks })
  t.after(dispose)

  // 作用域外不改任何请求
  await fakeTarget.fetch('https://example.com/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'gemini-3-pro', messages: [], tools: [{ type: 'function', function: { name: 'submit_story', parameters: {} } }] })
  })
  assert.equal(seenBodies.at(-1).tool_choice, undefined)
  seenBodies.length = 0

  // 作用域内：第 1 次因 named tool_choice 400 -> 降级为 'required'；第 2 次因 extra_content 400 -> 剥离 extra_content；第 3 次 200 并捕获 SSE 签名
  const response = await runWithToolProtocolDirective({
    provider: 'custom',
    model: 'gemini-3-pro',
    forceToolChoice: true,
    allowedToolNames: ['submit_story']
  }, () => fakeTarget.fetch('https://example.com/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gemini-3-pro',
      messages: [{ role: 'assistant', tool_calls: [{ id: 'old_1', type: 'function', function: { name: 'submit_story', arguments: '{}' } }] }],
      tools: [{ type: 'function', function: { name: 'submit_story', parameters: { type: 'object', properties: {} } } }]
    })
  }))

  assert.equal(response.status, 200)
  assert.equal(seenBodies.length, 3)
  assert.deepEqual(seenBodies[0].tool_choice, { type: 'function', function: { name: 'submit_story' } })
  assert.equal(seenBodies[1].tool_choice, 'required')
  assert.equal(seenBodies[2].tool_choice, 'required')
  assert.equal(seenBodies[2].messages[0].tool_calls[0].extra_content, undefined)

  const fullText = await response.text()
  assert.match(fullText, /submit_story/)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(getCapturedThoughtSignature('call_live_99'), 'LIVE_SERVER_SIG_XYZ')
})

test('魔搭 Chat Completions 兼容 developer 角色，保留提示词和其他端点的请求', async t => {
  const seen = []
  const target = { async fetch(_url, init) { seen.push(init); return new Response('{}') } }
  t.after(installToolProtocolFetchPatch(target, { quirks: createCapabilityQuirkStore() }))
  const body = {
    model: 'test-reasoning',
    messages: [
      { role: 'developer', content: '保留这条指令', name: 'rules' },
      { role: 'user', content: '开始' }
    ],
    tools: [{ type: 'function', function: { name: 'submit_story', parameters: {} } }]
  }
  const request = { method: 'POST', body: JSON.stringify(body) }
  const url = 'https://api-inference.modelscope.cn/v1/chat/completions'
  await target.fetch(new URL(url), request)
  const compatible = { ...body, messages: [{ ...body.messages[0], role: 'system' }, body.messages[1]] }
  assert.deepEqual(JSON.parse(seen.at(-1).body), compatible)

  await runWithToolProtocolDirective({ forceToolChoice: true, allowedToolNames: ['submit_story'] }, () => target.fetch(url, request))
  assert.deepEqual(JSON.parse(seen.at(-1).body), {
    ...compatible,
    tool_choice: { type: 'function', function: { name: 'submit_story' } }
  })

  for (const otherUrl of ['https://api.openai.com/v1/chat/completions', 'https://api-inference.modelscope.cn.example.com/v1/chat/completions',
    'https://api-inference.modelscope.cn/v1/responses']) {
    await target.fetch(otherUrl, request)
    assert.equal(seen.at(-1), request)
  }
})

test('installToolCallIdleTimeoutPatch：开启「输出走工具调用」时将 pi-ai 与 DeepSeek 适配器静默超时下限上调到 600s', async (t) => {
  assert.equal(TOOL_CALL_STREAM_IDLE_TIMEOUT_MS, 600_000)

  const defaultProfile = { streamIdleTimeoutMs: 300_000, reasoning: 'medium' }
  const longerProfile = { streamIdleTimeoutMs: 900_000, reasoning: 'high' }
  const snapshot = {
    profiles: new Map([
      ['google-vertex', defaultProfile],
      ['custom-long', longerProfile],
    ])
  }
  const piAdapter = {
    profileOf(snap, provider) {
      return snap.profiles.get(provider)
    }
  }

  const seenDeepSeekTimeouts = []
  const deepSeekAdapter = {
    async *generate(_options, connection) {
      seenDeepSeekTimeouts.push(connection.streamIdleTimeoutMs)
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }

  const listeners = new Set()
  const adapters = new Map([
    ['google-vertex', { adapter: piAdapter }],
    ['reapi', { adapter: piAdapter }],
  ])
  const fakeCtx = {
    llm: { adapters },
    on(event, fn) {
      if (event === 'llm/adapters-updated') listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }

  const originalProfileOf = piAdapter.profileOf
  const originalGenerate = deepSeekAdapter.generate
  const dispose = installToolCallIdleTimeoutPatch(fakeCtx)
  t.after(dispose)

  // 未开启输出走工具调用或处于作用域外：保持原值 300s
  assert.equal(piAdapter.profileOf(snapshot, 'google-vertex').streamIdleTimeoutMs, 300_000)
  assert.equal(
    runWithToolProtocolDirective({ storyOutputToolCall: false }, () => piAdapter.profileOf(snapshot, 'google-vertex').streamIdleTimeoutMs),
    300_000
  )

  // 开启输出走工具调用：300s 上调到 600s，且不篡改原 profile 对象；已有 900s 不被拉低
  runWithToolProtocolDirective({ storyOutputToolCall: true }, () => {
    const raised = piAdapter.profileOf(snapshot, 'google-vertex')
    assert.equal(raised.streamIdleTimeoutMs, 600_000)
    assert.equal(raised.reasoning, 'medium')
    assert.equal(defaultProfile.streamIdleTimeoutMs, 300_000)

    const kept = piAdapter.profileOf(snapshot, 'custom-long')
    assert.equal(kept.streamIdleTimeoutMs, 900_000)
  })

  // 后续动态注册的 DeepSeek 适配器收到 llm/adapters-updated 后同样生效
  adapters.set('deepseek', { adapter: deepSeekAdapter })
  for (const fn of listeners) fn()

  const dsConnection = { streamIdleTimeoutMs: 300_000 }
  for await (const _ of deepSeekAdapter.generate({}, dsConnection)) {}
  await runWithToolProtocolDirective({ storyOutputToolCall: true }, async () => {
    for await (const _ of deepSeekAdapter.generate({}, dsConnection)) {}
  })
  assert.deepEqual(seenDeepSeekTimeouts, [300_000, 600_000])
  assert.equal(dsConnection.streamIdleTimeoutMs, 300_000)

  // 释放后完整还原适配器方法
  dispose()
  assert.equal(piAdapter.profileOf, originalProfileOf)
  assert.equal(deepSeekAdapter.generate, originalGenerate)
  assert.equal(listeners.size, 0)
})

test('detectNativeThinkingEnabled：准确识别 Gemini/OpenAI/Anthropic 原生思考并传递给 resolveToolSchema', () => {
  assert.equal(detectNativeThinkingEnabled({ generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'MEDIUM' } } }, 'gemini-native'), true)
  assert.equal(detectNativeThinkingEnabled({ generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }, 'gemini-native'), false)
  assert.equal(detectNativeThinkingEnabled({ generationConfig: {} }, 'gemini-native'), false)
  assert.equal(detectNativeThinkingEnabled({ reasoning_effort: 'medium' }, 'openai-completions'), true)
  assert.equal(detectNativeThinkingEnabled({ reasoning_effort: 'none' }, 'openai-completions'), false)
  assert.equal(detectNativeThinkingEnabled({ thinking: { type: 'enabled', budget_tokens: 4096 } }, 'anthropic-messages'), true)
  assert.equal(detectNativeThinkingEnabled({ thinking: { type: 'disabled' } }, 'anthropic-messages'), false)

  const seenCtx = []
  enhanceToolProtocolPayload({
    contents: [{ role: 'user', parts: [{ text: '继续' }] }],
    generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } },
    tools: [{ functionDeclarations: [{ name: 'submit_story', parametersJsonSchema: { type: 'object', properties: { content: { type: 'string' } } } }] }]
  }, {
    url: 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-4-carbon:streamGenerateContent',
    directive: {
      provider: 'google-vertex',
      model: 'gemini-4-carbon',
      forceToolChoice: true,
      allowedToolNames: ['submit_story'],
      resolveToolSchema(name, ctx) {
        seenCtx.push({ name, hasNativeThinking: ctx.hasNativeThinking, protocol: ctx.protocol })
        return { order: ['content'], required: ['content'], properties: { content: { type: 'string' } } }
      }
    }
  })
  assert.deepEqual(seenCtx, [{ name: 'submit_story', hasNativeThinking: true, protocol: 'gemini-native' }])
})
