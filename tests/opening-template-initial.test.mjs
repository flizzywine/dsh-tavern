import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningHandlers } from '../tavern-plugin/lib/rpc/opening.js'
import { hasInitialVariablesEntry } from '../tavern-plugin/lib/domain/worldbook-entry-classification.js'

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

test('世界书没有初始化变量条目时不启动模板子进程', async () => {
  const { api: instance, calls: counted, draft } = handlers({ needed: false })
  const result = await instance.initializeOpeningTemplate({ id: 'draft-1', compact: true })
  assert.equal(counted.forked, 0, '没有 [InitialVariables] 条目就不必 fork')
  assert.equal(counted.stage, 0, '不进入模板阶段计时')
  assert.equal(counted.cancelled, 0)
  assert.deepEqual(draft.variableSeed, {}, '跳过时写回与引擎一致的空集')
  assert.equal(draft.revisionBumped, 1, '变量写回照旧推进存档版本')
  assert.deepEqual(Object.keys(result), ['runtime', 'worldbook'], '回答仍沿用原有裁剪载荷形状')
})

test('世界书带初始化变量条目时照旧跑模板并写回变量', async () => {
  const { api, calls, draft } = handlers({ needed: true })
  const result = await api.initializeOpeningTemplate({ id: 'draft-1', compact: true })
  assert.equal(calls.forked, 1)
  assert.equal(calls.initialized, 1)
  assert.equal(calls.cancelled, 1, '用完仍然立刻回收进程')
  assert.deepEqual(draft.variableSeed, { gold: 3 })
  assert.deepEqual(Object.keys(result), ['runtime', 'worldbook'])
})

test('只认 [InitialVariables] 注释与 @@initial_variables 操作', () => {
  assert.equal(hasInitialVariablesEntry({ comment: '[InitialVariables] 初始值', content: 'gold: 1' }), true)
  assert.equal(hasInitialVariablesEntry({ comment: '规则', content: '@@initial_variables\ngold: 1' }), true)
  assert.equal(hasInitialVariablesEntry({ comment: '规则 @@initial_variables 行内写法', content: 'gold: 1' }), false, '标记在内容里时看内容')
  assert.equal(hasInitialVariablesEntry({ content: '说明\n@@initial_variables gold: 1' }), true, '不要求标记在行首，宁可多启动一次也不漏判')
  assert.equal(hasInitialVariablesEntry({ comment: '[initvar]初始值', content: 'gold: 0' }), false, 'MVU 的 initvar 由 MVU 管线处理，不靠模板进程')
  assert.equal(hasInitialVariablesEntry({ comment: '普通条目', content: '随便写点什么' }), false)
  assert.equal(hasInitialVariablesEntry({}), false)
})
