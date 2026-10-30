import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
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
    }
  }
  const orchestrator = createTurnOrchestrator({
    storyToolCall: async () => options.storyToolCall === true,
    modEnabled: async (modId, cardPath) => (options.enabledMods || []).includes(modId) && cardPath === 'cards/阿芙拉.json',
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
    projectReply: projectReplyLayers,
    projectWorldBookTemplates: options.projectWorldBookTemplates,
    projectForegroundWorldbook: options.projectForegroundWorldbook,
    recordWorldbookRecall: options.recordWorldbookRecall,
    projectScriptPromptWorldbook: options.projectScriptPromptWorldbook,
    shellToolName: options.shellToolName,
    now: () => 2000
  })
  return {
    orchestrator,
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

test('脚本提示实际走本轮准备、Frame 与一次性消费，重复准备不丢失', async () => {
  const run = harness('story', {
    planner: createContextPlanner({ prompt: () => '写作规则' }),
    projectScriptPromptWorldbook: async ({ chat }) => ({ context: chat.tavernScriptPrompts.some(p => p.content === '王都') ? '王都的城门设定' : '' })
  })
  const state = run.chat()
  state.tavernScriptPrompts = [
    { id: 'place', content: '王都', position: 'none', role: 'system', depth: 0, should_scan: true, once: true },
    { id: 'event', content: '本轮事件要求', position: 'in_chat', role: 'system', depth: 0, should_scan: false, once: true }
  ]
  run.replaceChat(state)
  const input = { sessionId: 'session-1', turn: 1, userText: '继续' }
  const first = await run.orchestrator.prepare(input)
  assert.match(foregroundFrameText(first.frame), /王都的城门设定/)
  assert.match(foregroundFrameText(first.frame), /本轮事件要求/)
  assert.deepEqual(run.chat().tavernScriptPrompts, [])
  const repeated = await run.orchestrator.prepare(input)
  assert.deepEqual(repeated.frame, first.frame)
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

test('玩家模板先于本轮召回，重试不重复执行；提交后只产生一条玩家消息', async () => {
  let calls=0
  const run=harness('story',{projectUserTemplate:async()=>{
    calls++
    return {message:{role:'user',text:'进入少林',variables:[{place:'少林'}],tavernPluginData:{is_ejs_processed:[true]}},scopes:{local:{place:'少林'},initial:{}}}
  },projectForegroundWorldbook:async({chat,userText})=>{
    assert.equal(chat.variables.place,'少林');assert.equal(userText,'进入少林')
    return {context:'少林名册',activation:{refs:[]},refs:[],reads:{}}
  }})
  const input={sessionId:'session-1',turn:2,userText:'原始模板'}
  const first=await run.orchestrator.prepare(input)
  await run.orchestrator.prepare(input)
  assert.equal(calls,1)
  assert.equal(first.userText,'进入少林')
  assert.equal(run.chat().messages.length,0)
  await run.orchestrator.finalize({...input,assistantText:'少林的僧人迎上前。'})
  assert.equal(run.chat().messages.length,2)
  assert.equal(run.chat().messages[0].text,'进入少林')
  assert.equal(run.chat().messages[0].variables[0].place,'少林')
  assert.equal(run.chat().promptTemplateInput,undefined)
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
  assert.equal(again.chat().messages.filter(message => message.role === 'user').length, 1)
})

test('插件的本轮上下文和世界书条目进入正文帧，插件层出错时本轮照常', async () => {
  const seen = []
  const run = harness('story', { pluginTurnContext: async context => { seen.push(context); return [
    { name: 'tavern-plugin:mem:state', owner: 'mem', text: '【当前状态】雨夜' },
    { name: 'tavern-plugin:mem:wb', owner: 'mem', worldbook: true, text: '[支线] 钟楼' },
    { name: 'tavern-plugin:mem:first', owner: 'mem', position: 'before', text: '【先读】前情' }] } })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推门' })
  assert.deepEqual(seen, [{ gameId: 'session-1', turn: 2, input: '推门' }])
  const plugin = prepared.frame.contributions.filter(item => item.source.stage === 'plugin')
  assert.deepEqual(plugin.map(item => [item.kind, item.text, item.source.plugin]), [
    ['foreground.current-state', '【先读】前情', 'mem'], ['foreground.current-state', '【当前状态】雨夜', 'mem'], ['foreground.active-worldbook', '[支线] 钟楼', 'mem']])
  const order = prepared.frame.contributions.map(item => item.source.stage === 'plugin' ? item.text : 'tavern')
  assert.equal(order[0], '【先读】前情', "'before' comes ahead of Tavern's own context")
  assert.equal(order.lastIndexOf('tavern') < order.indexOf('【当前状态】雨夜'), true, "'after' follows it")
  const broken = harness('story', { pluginTurnContext: async () => { throw new Error('插件层故障') } })
  const fine = await broken.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推门' })
  assert.equal(fine.ready, true)
  assert.equal(fine.frame.contributions.some(item => item.source.stage === 'plugin'), false)
})

for (const mode of ['story', 'script']) test(mode + ' 缺少人物卡绑定时明确拒绝开始回合', async () => {
  const run = harness(mode, { draft: true })
  await assert.rejects(run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续' }), /缺少人物卡绑定/)
  assert.equal(run.plannerCalls.length, 0)
})

test('漏写的一轮可以按它自己的请求号补记进存档（#196 自愈）', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗', assistantText: '雨水扑进房间。' })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, requestId: 'rpc-2', userText: '关上窗' })
  // The old bug: the turn read an earlier input's request id and was dropped as a duplicate.
  const dropped = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, requestId: 'rpc-1', userText: '推开窗', assistantText: '窗关上了。' })
  assert.equal(dropped.duplicate, true)
  assert.equal(run.chat().messages.length, 2)
  const adopted = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, requestId: 'rpc-2', userText: '关上窗', assistantText: '窗关上了。' })
  assert.notEqual(adopted.duplicate, true)
  assert.deepEqual(run.chat().messages.map(message => message.text), ['推开窗', '雨水扑进房间。', '关上窗', '窗关上了。'])
  assert.equal(Number(run.chat().messages.at(-1).turn), 3)
  assert.equal(run.chat().messages.at(-1).stagePageVersion, 2)
})

test('本局前台工具可逐项关闭，卡片模式不受影响', async () => {
  const all = harness('story', { storyToolCall: true, webSearchEnabled: true })
  const names = await all.orchestrator.visibleTools('session-1')
  assert.equal(names.includes('worldbook_search'), false)
  assert.equal(names.includes('submit_story'), true)

  const one = harness('story', { storyToolCall: true, webSearchEnabled: true, chatFields: { disabledForegroundTools: ['worldbook_search'] } })
  const oneNames = await one.orchestrator.visibleTools('session-1')
  assert.equal(oneNames.includes('worldbook_search'), false)
  assert.equal(oneNames.includes('submit_story'), true)

  // 仅输入回放时也要声明 submit_story，否则历史里回放的调用没有对应工具。
  const inputOnly = harness('story', { storyInputToolCall: true })
  assert.equal((await inputOnly.orchestrator.visibleTools('session-1')).includes('submit_story'), true)
  const off = harness('story')
  assert.equal((await off.orchestrator.visibleTools('session-1')).includes('submit_story'), false)

  const submitOff = harness('story', { storyToolCall: true, chatFields: { disabledForegroundTools: ['submit_story'] } })
  assert.equal((await submitOff.orchestrator.visibleTools('session-1')).includes('submit_story'), false)

  const disabled = ['read', 'worldbook_list', 'worldbook_grep', 'tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search', 'web_search', 'web_fetch', 'submit_story']
  const none = harness('story', { storyToolCall: true, webSearchEnabled: true, chatFields: { disabledForegroundTools: disabled } })
  assert.deepEqual(await none.orchestrator.visibleTools('session-1'), [])

  const script = harness('script', { storyToolCall: true, chatFields: { disabledForegroundTools: ['tavern_read_script'] } })
  const scriptNames = await script.orchestrator.visibleTools('session-1')
  assert.equal(scriptNames.includes('tavern_read_script'), false)
  assert.equal(scriptNames.includes('submit_story'), true)

  const card = harness('card', { chatFields: { disabledForegroundTools: disabled } })
  assert.ok((await card.orchestrator.visibleTools('session-1')).includes('tavern_update_card'))
})

test('骰子工具只在本卡开了骰子 mod 时提供给正文模型，仍可逐项关闭', async () => {
  assert.equal((await harness('story').orchestrator.visibleTools('session-1')).includes('tavern_roll'), false)
  assert.equal((await harness('story', { enabledMods: ['dsh.dice'] }).orchestrator.visibleTools('session-1')).includes('tavern_roll'), true)
  assert.equal((await harness('script', { enabledMods: ['dsh.dice'] }).orchestrator.visibleTools('session-1')).includes('tavern_roll'), true)
  const off = harness('story', { enabledMods: ['dsh.dice'], chatFields: { disabledForegroundTools: ['tavern_roll'] } })
  assert.equal((await off.orchestrator.visibleTools('session-1')).includes('tavern_roll'), false)
})
