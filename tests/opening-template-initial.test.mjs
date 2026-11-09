import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningHandlers } from '../tavern-plugin/lib/rpc/opening.js'

function handlers({ needed }) {
  const calls = { forked: 0, cancelled: 0, initialized: 0, stage: 0 }
  const draft = { id: 'draft-1', runtime: null, worldbook: { name: '甲', entries: [] } }
  const api = createOpeningHandlers({
    chatForSession: async () => undefined,
    ensureNativeOpening: async () => undefined,
    fullTemplateRuntime: {
      forSession: () => { calls.forked++; return { initializeVariables: async () => { calls.initialized++; return { initial: { gold: 3 }, diagnostics: [] } } } },
      cancel: () => { calls.cancelled++ }
    },
    getCardOpenings: async () => undefined,
    openingPreparation: {
      needsTemplateInitial: () => needed,
      get: () => draft,
      applyTemplateInitial: (id, result) => { draft.variableSeed = result.initial; draft.revisionBumped = (draft.revisionBumped || 0) + 1; return draft },
      callRuntime: async () => undefined,
      select: async () => undefined,
      create: async () => undefined,
      retain: () => undefined,
      release: () => undefined,
      replaceWorldbook: async () => undefined
    },
    readChatCard: async () => undefined,
    requestPerformance: { stage: (name, run) => { calls.stage++; return run() } },
    runtimePresets: {},
    startChat: async () => undefined,
    str: value => value == null ? '' : String(value)
  })
  return { api, calls, draft }
}

test('世界书带初始化变量条目时照旧跑模板并写回变量', async () => {
  const { api, calls, draft } = handlers({ needed: true })
  const result = await api.initializeOpeningTemplate({ id: 'draft-1', compact: true })
  assert.equal(calls.forked, 1)
  assert.equal(calls.initialized, 1)
  assert.equal(calls.cancelled, 1, '用完仍然立刻回收进程')
  assert.deepEqual(draft.variableSeed, { gold: 3 })
  assert.deepEqual(Object.keys(result), ['runtime', 'worldbook'])
})
