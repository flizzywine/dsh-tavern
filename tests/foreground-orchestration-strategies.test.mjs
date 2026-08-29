import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function strategies(overrides = {}) {
  const calls = []
  const chats = new Map([['native', { id: 'native', requestMode: 'dsh', mode: 'story' }], ['compat', { id: 'compat', requestMode: 'sillytavern', mode: 'story' }]])
  const value = createForegroundOrchestrationStrategies({
    compatibility: {
      async beforeTurn(input) { calls.push(['compat.before', input.userText]) },
      async beginTurn(input) { calls.push(['compat.begin', input.turn, input.requestId]) },
      async chatForSession(sessionId) { return chats.get(sessionId) },
      async compileTurn(_chat, userText) { calls.push(['compat.compile', userText]); return { messages: [{ role: 'system', content: 'compat' }] } },
      async persistCompiled(input) { calls.push(['compat.persist', input.turn]) },
      projectMessages(compiled) { return compiled.messages.map(function (message) { return { role: message.role, content: [{ type: 'text', text: message.content }] } }) }
    },
    nativePlay: {
      async modeFor() { return 'story' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return { front: { text: 'preset' } } },
      async prepareTurn(input) {
        calls.push(['native.prepare', input.userText, input.requestId])
        return { frame: { frameId: 'frame-1', branchId: 'b', basedOnRevision: 1, source: {}, userInput: { projectedText: 'projected' } } }
      },
      appendFrame(input) { return { messages: input.messages.concat([{ role: 'user', content: [{ type: 'text', text: 'frame' }] }]), receipt: { appended: true } } },
      recordFrame(_sessionId, frame) { calls.push(['native.frame', frame.frameId]) },
      async visibleTools() { return [] },
      modePrompt() { return 'play' },
      workspaceContext() { return '' },
      async ensureCardSnapshot() { return 'card' },
      controlledToolNames: new Set(['bash'])
    },
    ...overrides
  })
  return { value, calls, chats }
}

test('普通游玩与兼容模式只在策略选择点分叉', async () => {
  const run = strategies()
  const nativePayload = { turn: 2, step: 1, messages: [userMessage('继续')] }
  const native = await run.value.prepareStep({ sessionId: 'native', payload: nativePayload, decision: { kind: 'enter', messages: nativePayload.messages }, chat: run.chats.get('native'), requestId: 'rpc-native' })
  assert.deepEqual(native.messages.map(function (message) { return message.content[0].text }), ['projected', 'frame'])

  const compatPayload = { turn: 3, step: 1, messages: [userMessage('向前走')] }
  const compat = await run.value.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat'), requestId: 'rpc-compat' })
  assert.equal(compat.messages, compatPayload.messages)
  assert.deepEqual(run.calls, [
    ['native.prepare', '继续', 'rpc-native'],
    ['native.frame', 'frame-1'],
    ['compat.before', '向前走'],
    ['compat.begin', 3, 'rpc-compat'],
    ['compat.compile', '向前走'],
    ['compat.persist', 3]
  ])
})

test('两种策略分别投影模型请求且不改写 DSH 原请求', async () => {
  const run = strategies()
  const nativePayload = { turn: 2, step: 1, messages: [userMessage('继续')] }
  await run.value.prepareStep({ sessionId: 'native', payload: nativePayload, decision: { kind: 'enter', messages: nativePayload.messages }, chat: run.chats.get('native') })
  const nativeOptions = Object.freeze({ sessionId: 'native', messages: Object.freeze([]) })
  const nativeProjected = run.value.projectRequest(nativeOptions, { turn: 2, step: 1 })
  assert.notEqual(nativeProjected, nativeOptions)
  assert.equal(nativeOptions.messages.length, 0)

  const compatPayload = { turn: 3, step: 1, messages: [userMessage('向前走')] }
  await run.value.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat') })
  const compatOptions = Object.freeze({ sessionId: 'compat', messages: Object.freeze([]) })
  const compatProjected = run.value.projectRequest(compatOptions, { turn: 3, step: 1 })
  assert.notEqual(compatProjected, compatOptions)
  assert.equal(compatProjected.messages[0].content[0].text, 'compat')
})

test('兼容策略清空系统提示，普通策略保留原生人格和卡片投影', async () => {
  const run = strategies()
  const compatAssembly = await run.value.assembleSystemPrompt({ sections: [{}], contexts: [{}], tools: [{ name: 'bash' }] }, { sessionId: 'compat', chat: run.chats.get('compat') })
  assert.deepEqual(compatAssembly, { sections: [], contexts: [], tools: [] })

  const nativeAssembly = await run.value.assembleSystemPrompt({ sections: [], contexts: [], tools: [{ name: 'bash' }, { name: 'read' }] }, { sessionId: 'native', chat: run.chats.get('native') })
  assert.deepEqual(nativeAssembly.sections.map(function (section) { return section.name }), ['tavern:mode-persona', 'tavern:card-snapshot'])
  assert.deepEqual(nativeAssembly.tools.map(function (tool) { return tool.name }), ['read'])
})

test('卡片策略保留官方 Cordis 工具说明', async () => {
  const run = strategies({
    nativePlay: {
      async modeFor() { return 'card' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return null },
      async prepareTurn() { return { text: '' } },
      appendFrame(input) { return { messages: input.messages, receipt: {} } },
      recordFrame() {},
      async visibleTools() { return [] },
      modePrompt() { return 'card' },
      workspaceContext() { return '/resources' },
      async ensureCardSnapshot() { return '' },
      controlledToolNames: new Set()
    }
  })
  const assembly = await run.value.assembleSystemPrompt({
    sections: [{ name: 'tool:cordis', text: 'Cordis instructions' }],
    contexts: [],
    tools: []
  }, { sessionId: 'native', chat: run.chats.get('native'), cwd: '/workspace' })

  assert.deepEqual(assembly.sections.map(function (section) { return section.name }), [
    'tavern:mode-persona',
    'tool:cordis',
    'tavern:resource-workspace'
  ])
})
