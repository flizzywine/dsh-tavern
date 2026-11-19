import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'
import { createForegroundFrameBuilder, foregroundFrameText } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-1', order: 0, text: '两人在雨夜抵达旅店。' },
      { id: 'chunk-2', order: 1, text: '钟楼传来第三声铃响。' }
    ]
  }
}

function harness(mode, options = {}) {
  const cards = createCardPreparation({ id: () => 'card-1', now: () => 1000 })
  const scripts = createScriptContinuity()
  let cardWorkspace = cards.create({ kind: 'import', payload: options.cardData || { name: '阿芙拉', description: '旧描述' } })
  let card = cards.project(cardWorkspace)
  let chat = {
    id: 'chat-1', cardPath: options.draft ? '' : 'cards/阿芙拉.json', cardName: options.draft ? '卡片工作台' : card.name, mode,
    messages: [], posture: '站在窗边', guides: [], nativeCommits: {},
    ledger: options.ledger || null,
    preparedWorldBookContext: options.preparedWorldBookContext || '',
    webSearchEnabled: options.webSearchEnabled === true,
    runtimePresetSnapshot: clone(options.runtimePresetSnapshot || null),
    macroState: { userName: 'User', local: {}, global: {} },
    scriptState: mode === 'script' ? scripts.start(script(), 0) : null,
    workspace: mode === 'card' ? { mountedResources: [], sourceIds: options.draft ? ['src-1'] : [], draft: { name: '' }, player: '', cursor: 0, prepared: null } : null,
    _storageRevision: 1
  }
  Object.assign(chat, clone(options.chatFields || {}))
  const history = new Map([[1, clone(chat)]])
  const settlements = []
  const createdCards = []
  const updatedCardPaths = []
  const plannerCalls = []
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 2000 })
  const store = {
    async chatForSession() { return clone(chat) },
    async readCard() { if (options.brokenCard) throw new SyntaxError('invalid JSON'); return options.draft && !chat.cardPath ? undefined : clone(card) },
    async readCardExtensions() { return clone(options.extensions || { regexScripts: [] }) },
    async readScript() { return mode === 'script' || (mode === 'card' && !options.draft) ? clone(script()) : undefined },
    async readBoundWorldBook() { return clone(options.boundWorldBook || null) },
    async writeChat(value, metadata) {
      const revision = Math.max(0, Number(chat._storageRevision) || 0) + 1
      let next = clone(value)
      if (metadata && metadata.source === 'foreground.commit' && options.autoSettle !== false) {
        const settlement = timeline.apply({ chat: next, intent: { kind: 'agent.begin', role: 'settlement' } })
        next = timeline.complete({
          chat: settlement.chat,
          operationId: settlement.value.operationId,
          basedOn: settlement.value.basedOn,
          outcome: { status: 'success' }
        }).chat
      }
      chat = next
      chat._storageRevision = revision
      value._storageRevision = revision
      history.set(revision, clone(chat))
    },
    async updateChat(_id, mutation, metadata) {
      const next = await mutation(clone(chat))
      if (next !== undefined) await store.writeChat(next, metadata)
      return clone(chat)
    },
    async updateCard(cardId, fields, revision, rawOperations) {
      updatedCardPaths.push(cardId)
      const change = cards.update({ kind: 'card', card: cardWorkspace, patch: fields, revision, rawOperations })
      cardWorkspace = clone(change.card)
      card = clone(change.view)
      return { ...clone(change), card: clone(card) }
    },
    async createCard(_chat, state) {
      cardWorkspace = cards.create({ kind: 'draft', draft: state.draft, player: state.player, sourcePaths: state.sourceIds || state.sourcePaths || [] })
      card = cards.project(cardWorkspace)
      const path = 'cards/' + card.name + '.json'
      card.path = path
      createdCards.push({ path, card: clone(card) })
      return { path, card: clone(card) }
    },
    ...(options.storeExtras ? options.storeExtras({ getChat: () => chat, setChat: next => { chat = clone(next) } }) : {})
  }
  const orchestrator = createTurnOrchestrator({
    bodyGeneration: async () => options.bodyGeneration || { mode: 'host' },
    storyToolCall: async () => options.storyToolCall === true,
    modEnabled: async (modId, cardPath) => (options.enabledMods || []).includes(modId) && cardPath === 'cards/阿芙拉.json',
    modTools,
    storyInputToolCall: async () => options.storyInputToolCall === true,
    store,
    planner: {
      async plan(input) {
        plannerCalls.push(clone(input))
        if (options.planner) return options.planner.plan(input)
        return {
          text: 'context:' + input.purpose,
          sections: input.purpose === 'body' && Array.isArray(options.plannerSections) ? clone(options.plannerSections) : undefined
        }
      }
    },
    worldBookRecall: options.worldBookRecall,
    scripts,
    timeline,
    frameBuilder: createForegroundFrameBuilder(),
    cards,
    workspace: {
      async prepare(value, turn) {
        value.workspace.prepared = { nativeTurn: turn, cursorBefore: value.workspace.cursor, total: 1, window: [{ title: '素材', text: '拔剑。' }] }
        return value.workspace.prepared
      },
      commit(value, turn) {
        if (value.workspace.prepared && value.workspace.prepared.nativeTurn === turn) {
          value.workspace.cursor = 1
          value.workspace.prepared = null
        }
      }
    },
    queueSettlement: (chatId) => settlements.push(chatId),
    renderMacros: options.macros === true ? function (text, value) {
      const result = renderTavernMacros(text, {
        charName: value.cardName,
        userName: value.macroState.userName,
        localVariables: value.macroState.local,
        globalVariables: value.macroState.global
      })
      value.macroState.local = result.localVariables
      value.macroState.global = result.globalVariables
      return result.text
    } : undefined,
    resolvePresetRegexScripts: options.resolvePresetRegexScripts,
    projectUserTemplate: options.projectUserTemplate,
    pluginTurnContext: options.pluginTurnContext,
    activeDamperRuling: options.activeDamperRuling,
    projectReply: projectReplyLayers,
    projectWorldBookTemplates: options.projectWorldBookTemplates,
    projectForegroundWorldbook: options.projectForegroundWorldbook,
    resolvePreset: options.resolvePreset,
    foregroundRosterAddendum: options.foregroundRosterAddendum,
    recordWorldbookRecall: options.recordWorldbookRecall,
    projectScriptPromptWorldbook: options.projectScriptPromptWorldbook,
    shellToolName: options.shellToolName,
    now: () => 2000
  })
  return {
    orchestrator,
    store,
    chat: () => clone(chat),
    card: () => clone(card),
    cardWorkspace: () => clone(cardWorkspace),
    plannerCalls,
    settlements,
    createdCards,
    updatedCardPaths,
    timeline,
    rollback(value = chat) {
      const target = timeline.rollbackTarget({ chat: value })
      const beforeChat = target === null ? undefined : history.get(target.beforeRevision)
      const result = timeline.apply({ chat: clone(value), intent: { kind: 'turn.rollback', beforeChat: clone(beforeChat) } })
      result.chat._storageRevision = Math.max(0, Number(value._storageRevision) || 0) + 1
      return result
    },
    replaceChat(next) { chat = clone(next) }
  }
}

test('连续正文回合的实际 Frame 消息不重复基本信息和常驻世界书', async () => {
  const planner = createContextPlanner({ prompt: () => '正文写作规则' })
  const cardData = { name: '阿芙拉', description: '固定描述', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '逐轮系统指令', post_history_instructions: '逐轮历史后指令' }
  for (const mode of ['story', 'script']) {
    const run = harness(mode, { planner, cardData, preparedWorldBookContext: '旧后台召回缓存', projectWorldBookTemplates: async () => ({ context: '本轮动态世界书' }) })
    const prefix = await planner.plan({ purpose: 'play-card-snapshot', card: run.card(), chat: run.chat(), worldBookContext: '固定世界设定', worldBookLabel: '常驻世界书' })
    const adapter = createForegroundFrameSessionAdapter()
    let messages = []
    for (const turn of [2, 3]) {
      const input = { sessionId: 'session-1', turn, userText: '继续' }
      const prepared = await run.orchestrator.prepare(input)
      const text = foregroundFrameText(prepared.frame)
      assert.equal(prepared.frame.context.cardContext, '')
      assert.doesNotMatch(text, /逐轮系统指令/)
      assert.match(text, /逐轮历史后指令/)
      assert.match(text, /本轮动态世界书/)
      assert.doesNotMatch(text, /旧后台召回缓存/)
      // The production Session already owns the opening system snapshot.
      const session = { events: [{ type: 'user/message', data: { id: 'tavern-session-prefix:test', role: 'user', content: [],
        source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot', sections: [{ name: 'tavern:session-context', text: prefix.text }] } } }] }
      messages = adapter.append({ session, messages, frame: prepared.frame, step: 1 }).messages
      await run.orchestrator.finalize({ ...input, assistantText: '雨水敲着窗。' })
    }
    const historyText = messages.map(message => message.content[0].text).join('\n')
    const requestText = prefix.text + '\n' + historyText
    for (const fixed of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界设定']) {
      assert.equal(requestText.split(fixed).length - 1, 1)
      assert.ok(!historyText.includes(fixed))
    }
    assert.equal(requestText.split('逐轮系统指令').length - 1, 1)
    assert.doesNotMatch(historyText, /逐轮系统指令/)
    assert.equal(historyText.split('逐轮历史后指令').length - 1, 2)
  }
})

test('卡片 raw 扩展修改先暂存，最终回复后才写入工作 raw', async () => {
  const run = harness('card')
  await run.orchestrator.stageChanges({
    sessionId: 'session-1', turn: 9,
    rawOperations: [{ op: 'set', path: '/extensions/regex_scripts', value: [{ scriptName: '状态栏' }] }]
  })
  assert.equal(run.cardWorkspace().raw.extensions, undefined)

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 9, userText: '加入正则', assistantText: '已经加入。' })
  assert.deepEqual(run.cardWorkspace().raw.extensions.regex_scripts, [{ scriptName: '状态栏' }])
})

test('new card is created and bound before tool returns; next write updates the same file', async () => {
  const run = harness('card', { draft: true })
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { name: '新角色', player: '旅人' } })
  assert.equal(run.chat().cardPath, 'cards/新角色.json')
  assert.equal(run.createdCards.length, 1)
  assert.deepEqual(run.chat().lastCardSave, { turn: 1, path: 'cards/新角色.json', createsCard: true, changed: true })
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { description: '第二次修改' } })
  assert.equal(run.card().description, '第二次修改')
  assert.equal(run.createdCards.length, 1)
  assert.deepEqual(run.chat().lastCardSave, { turn: 1, path: 'cards/新角色.json', createsCard: false, changed: true })
})

test('失败回合的玩家模板变量被撤销，遗留的别轮模板输入在下一轮开始前恢复（#193）', async () => {
  const projectUserTemplate = async ({ text }) => ({ message: { role: 'user', text: '渲染:' + text }, scopes: { local: { place: text }, initial: { seen: text } } })
  const run = harness('story', { projectUserTemplate })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '阳台浇花' })
  assert.equal(run.chat().variables.place, '阳台浇花')
  assert.equal(await run.orchestrator.discard({ sessionId: 'session-1', turn: 2 }), true)
  assert.equal(run.chat().promptTemplateInput, undefined)
  assert.equal(run.chat().variables, undefined, '失败回合写下的模板变量撤销')
  assert.equal(run.chat().promptTemplateInitialVariables, undefined)
  assert.equal(run.chat().messages.length,0,'失败清理同时移除未提交的占位楼层')

  const again = harness('story', { projectUserTemplate })
  await again.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '阳台浇花' })
  // The failed turn was never discarded; the next turn starts from the state before it.
  await again.orchestrator.prepare({ sessionId: 'session-1', turn: 3, userText: '教室写字' })
  const chat = again.chat()
  assert.equal(chat.promptTemplateInput.turn, 3)
  assert.equal(chat.promptTemplateInput.message.text, '渲染:教室写字')
  assert.equal(chat.promptTemplateInput.before.variables, null, '下一轮的撤销点是失败回合之前的状态')
  await again.orchestrator.finalize({ sessionId: 'session-1', turn: 3, userText: '教室写字', assistantText: '小明在教室写字。' })
  assert.equal(again.chat().promptTemplateInput, undefined)
  assert.equal(again.chat().messages.filter(message => message.role === 'user').length, 2, '未 discard 的失败占位仍保留；正式 handoff 会在下一轮前清理')
})

for (const mode of ['story', 'script']) test(mode + ' 缺少人物卡绑定时明确拒绝开始回合', async () => {
  const run = harness(mode, { draft: true })
  await assert.rejects(run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续' }), /缺少人物卡绑定/)
  assert.equal(run.plannerCalls.length, 0)
})


test('plugin projection uses durable rules and freezes distinct prompt/display channels', async () => {
  const h = harness('story', { autoSettle: false,
    bodyGeneration: { mode: 'plugin-tool-call', provider: 'p:body' },
    extensions: { regexScripts: [{ findRegex: 'X', replaceString: 'HOST', placement: [2] }] } })
  const prepared = await h.orchestrator.prepare({ sessionId: 'session', turn: 2, userText: '继续', requestId: 'request' })
  const ready = h.chat()
  ready.timeline.operations[prepared.frame.operationId].bodyGeneration = { status: 'ready', receipt: { text: 'X' },
    regexScripts: [
      { findRegex: 'X', replaceString: 'context', placement: [2], promptOnly: true },
      { findRegex: 'X', replaceString: 'display', placement: [2], markdownOnly: true },
    ] }
  h.replaceChat(ready)
  await h.orchestrator.finalize({ sessionId: 'session', turn: 2, userText: '继续', requestId: 'request', assistantText: 'X', pluginBodyGeneration: true })
  const row = h.chat().messages.at(-1)
  assert.equal(row.sourceText, 'X')
  assert.equal(row.text, 'context')
  assert.equal(row.displayText, 'display')
  assert.equal(row.bodyPluginProjection, true)
})

test('故事准备首次落盘与重复 prepare 均把最新阻尼裁定写入占位助手行', async () => {
  const firstOutcome = { mode: 'balanced', judgeMode: 'author', rulingTier: 'partial_clamp', leverageScore: 0.7, clampedCount: 1, clampedKeys: [], evaluatedAt: 10 }
  const updatedOutcome = { mode: 'balanced', judgeMode: 'author', rulingTier: 'full_accept', leverageScore: 1.5, clampedCount: 0, clampedKeys: [], evaluatedAt: 20 }
  let active = firstOutcome
  const h = harness('story', {
    activeDamperRuling: () => ({ outcome: active })
  })

  await h.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开门', requestId: 'req-damper-1' })
  const placeholderAfterFirst = h.chat().messages.at(-1)
  assert.equal(placeholderAfterFirst.role, 'assistant')
  assert.equal(placeholderAfterFirst.placeholder, true)
  assert.deepEqual(placeholderAfterFirst.narrativeDamper, [firstOutcome])

  // 同轮重复 prepare 拿到最新决策裁定后，必须同步刷新现有 placeholder 上的 narrativeDamper
  active = updatedOutcome
  await h.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开门', requestId: 'req-damper-1' })
  const placeholderAfterRetry = h.chat().messages.at(-1)
  assert.equal(h.chat().messages.filter(m => m.role === 'assistant').length, 1)
  assert.equal(placeholderAfterRetry.placeholder, true)
  assert.deepEqual(placeholderAfterRetry.narrativeDamper, [updatedOutcome])

  // 若 store 提供 readChatSlice / patchChat，重复 prepare 走按路径局部 patch 同样生效
  const patchedCalls = []
  let active2 = firstOutcome
  const hPatch = harness('story', {
    activeDamperRuling: () => ({ outcome: active2 }),
    storeExtras: ({ getChat, setChat }) => ({
      async readChatSlice(_sessionId, indices) {
        const current = getChat()
        return {
          denseMessages: false,
          chat: {
            id: current.id,
            _storageRevision: current._storageRevision,
            messages: current.messages.map((m, i) => (indices.includes(i) ? clone(m) : undefined))
          }
        }
      },
      async patchChat(chatId, baseRevision, ops, metadata) {
        const current = getChat()
        assert.equal(chatId, current.id)
        assert.equal(baseRevision, current._storageRevision)
        patchedCalls.push({ ops: clone(ops), source: metadata?.source })
        for (const op of ops) {
          if (op.op === 'set' && op.path[0] === 'messages') {
            current.messages[op.path[1]][op.path[2]] = clone(op.value)
          }
        }
        current._storageRevision += 1
        setChat(current)
        return true
      }
    })
  })
  await hPatch.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '再试', requestId: 'req-damper-2' })
  active2 = updatedOutcome
  await hPatch.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '再试', requestId: 'req-damper-2' })
  assert.equal(patchedCalls.length, 1)
  assert.equal(patchedCalls[0].source, 'foreground.prepare-damper')
  assert.deepEqual(hPatch.chat().messages.at(-1).narrativeDamper, [updatedOutcome])
})
