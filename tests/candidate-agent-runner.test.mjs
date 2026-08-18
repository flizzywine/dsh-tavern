import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateAgentRunner } from '../tavern-plugin/lib/candidate-agent-runner.js'

test('候选 Runner 使用独立 DSH Agent 会话并在其作用域注册研究工具', async () => {
  const parent = {
    id: 'parent-session',
    session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } }
  }
  const events = []
  const registered = []
  const sections = []
  const restrictions = []
  const listeners = []
  const appended = []
  let disposed = false
  let work = Promise.resolve()
  let runner
  const child = {
    session: {
      events,
      append(type, data) { appended.push({ type, data }) }
    },
    followup(message) {
      work = (async function () {
        assert.equal(runner.owns('candidate-session-1'), true)
        assert.match(message.content[0].text, /最近剧情/)
        assert.match(message.content[0].text, /雨水敲窗/)
        const preStep = listeners.find(function (entry) { return entry.name === 'agent/pre-step' })
        assert.ok(preStep)
        await preStep.listener({ agent: child }, async function () { return { kind: 'enter' } })
        await registered[0].execute({ position: 2 }, { signal: new AbortController().signal, concludeTurn() {} })
        events.push({
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: '{"choices":[{"type":"action","text":"沿着脚印继续向钟楼谨慎追去"}]}' }] } }
        })
      })()
    },
    async whenIdle() { await work }
  }
  const createCalls = []
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      createCalls.push(options)
      await options.setup({
        systemPrompt: {
          section(value) { sections.push(value) },
          suppressRuntimeContext() {}
        },
        tools: {
          restrict(value) { restrictions.push(value) },
          register(value) { registered.push(value) }
        },
        on(name, listener) { listeners.push({ name, listener }) }
      })
      return { agent: child, async dispose() { disposed = true } }
    }
  }
  const calls = []
  runner = createCandidateAgentRunner({ agents, id: () => 'candidate-session-1' })
  const result = await runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选系统提示',
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: '雨水敲窗。' }] },
      { role: 'user', content: [{ type: 'text', text: '生成候选项。' }] }
    ],
    tools: [{ name: 'tavern_read_script', description: '读取剧本', parameters: { type: 'object' } }],
    async onToolCall(call) { calls.push(call); return '{"position":2}' },
    maxToolCalls: 8,
    temperature: 0.8,
    maxTokens: 4000
  })

  assert.equal(result.traceSessionId, 'candidate-session-1')
  assert.match(result.text, /沿着脚印/)
  assert.equal(createCalls[0].meta.parentSession, parent.id)
  assert.equal(createCalls[0].meta.origin, 'subagent')
  assert.equal(createCalls[0].agentOptions.maxTokens, 4000)
  assert.equal(sections[0].complete, true)
  assert.deepEqual(restrictions, [{ allow: [] }])
  assert.equal(registered[0].name, 'tavern_read_script')
  const requestListener = listeners.find(function (entry) { return entry.name === 'agent/request' })
  assert.ok(requestListener)
  assert.deepEqual(await requestListener.listener({}, async function () { return { provider: 'test', model: 'scripted' } }), { provider: 'test', model: 'scripted', temperature: 0.8 })
  assert.deepEqual(appended, [{
    type: 'subagent/descriptor',
    data: { version: 2, mode: 'one-shot', provider: 'dsh-tavern-candidate', label: '候选研究' }
  }])
  assert.deepEqual(calls, [{ name: 'tavern_read_script', arguments: { position: 2 } }])
  assert.equal(disposed, true)
  assert.equal(runner.owns('candidate-session-1'), false)
})
