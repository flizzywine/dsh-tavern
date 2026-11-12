import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'
import { createForegroundFrameBuilder, foregroundFrameText, frameUserInput } from '../tavern-plugin/lib/domain/agent-input-frame.js'
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
  assert.equal(first.frame.source.regenerationState.tavernScriptPrompts.length, 2)
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
  assert.deepEqual(first.frame.source.regenerationState.variables, { place: '少林' })
  assert.equal(first.frame.source.regenerationState.promptTemplateInput.source, '原始模板')
  assert.equal(first.frame.source.regenerationMaterials.card.name, run.card().name)
  assert.equal(run.chat().messages.length,2,'准备阶段已经创建一对占位消息，重试不重复追加')
  assert.equal(run.chat().messages[0].placeholder,true)
  assert.equal(run.chat().messages[1].placeholder,true)
  await run.orchestrator.finalize({...input,assistantText:'少林的僧人迎上前。'})
  assert.equal(run.chat().messages.length,2,'提交替换占位，不再追加另一对消息')
  assert.ok(run.chat().messages.every(message=>message.placeholder===undefined))
  assert.equal(run.chat().messages[0].text,'进入少林')
  assert.equal(run.chat().messages[0].variables[0].place,'少林')
  assert.equal(run.chat().promptTemplateInput,undefined)
})

test('升级前已缓存 Frame 但没有占位的回合仍按原路径追加提交', async () => {
  const run = harness('story')
  const input = { sessionId: 'session-1', turn: 2, userText: '继续旧存档' }
  const first = await run.orchestrator.prepare(input)
  const legacy = run.chat()
  legacy.messages = []
  for (const operation of Object.values(legacy.timeline.operations)) delete operation.placeholder
  run.replaceChat(legacy)
  const repeated = await run.orchestrator.prepare(input)
  assert.equal(repeated.frame.frameId, first.frame.frameId, '旧 Frame 直接复用，不要求迁移或重建占位')
  assert.equal(frameUserInput(repeated.frame).projectedText, '继续旧存档')
  assert.equal(run.chat().messages.length, 0)
  await run.orchestrator.finalize({ ...input, assistantText: '旧存档的正文。' })
  assert.deepEqual(run.chat().messages.map(message => [message.role, message.text]), [
    ['user', '继续旧存档'], ['assistant', '旧存档的正文。']
  ])
})

test('a speaker recalled after the frozen roster reaches only this turn\'s tail', async () => {
  const asked = []
  const addendum = async ({ userText }) => { asked.push(userText); return '<late_speakers>\nMira\n</late_speakers>' }
  const projectForegroundWorldbook = async () => ({ context: 'Frozen roster', activation: { refs: [] }, refs: [], reads: {} })
  const run = harness('story', { projectForegroundWorldbook, foregroundRosterAddendum: addendum })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: 'Mira, why are you here?' })
  assert.deepEqual(asked, ['Mira, why are you here?'])
  const late = prepared.frame.contributions.filter(item => item.source?.stage === 'speaker-roster-addendum')
  assert.deepEqual(late.map(item => [item.slot, item.text]), [['currentStateProjection', '<late_speakers>\nMira\n</late_speakers>']])
  assert.ok(prepared.frame.contributions.indexOf(late[0]) > prepared.frame.contributions.findIndex(item => item.slot === 'activeWorldbook'))

  // Without a foreground worldbook projection there is no frozen roster to extend.
  const plain = await harness('story', { foregroundRosterAddendum: addendum }).orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: 'again' })
  assert.equal(asked.length, 1)
  assert.equal(plain.frame.contributions.some(item => item.source?.stage === 'speaker-roster-addendum'), false)
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

test('玩家输入先落盘，失败保留并在同一索引重试提交', async () => {
  const run = harness('story')
  const input = { sessionId: 'session-1', requestId: 'rpc-saved', userText: '推开窗' }
  const saved = await run.orchestrator.appendUser(input)
  const duplicate = await run.orchestrator.appendUser(input)
  assert.deepEqual([saved.messageIndex, duplicate.messageIndex, duplicate.duplicate], [0, 0, true])
  assert.equal(run.chat().messages.length, 1)

  await run.orchestrator.prepare({ ...input, turn: 2 })
  assert.deepEqual(run.chat().messages.map(row => row.role), ['user', 'assistant'], '准备只追加正文，不重复玩家输入')
  assert.equal(run.chat().messages[0].source.rpcId, 'rpc-saved')
  await run.orchestrator.discard({ sessionId: 'session-1', turn: 2 })
  assert.deepEqual(run.chat().messages.map(row => row.role), ['user'], '生成失败只清理正文')
  assert.equal(run.chat().messages[0].text, '推开窗')
  assert.equal(run.chat().messages[0].placeholder, undefined)

  await run.orchestrator.prepare({ ...input, turn: 2 })
  await run.orchestrator.finalize({ ...input, turn: 2, assistantText: '雨水扑进房间。' })
  assert.equal(run.chat().messages.length, 2, '同一请求重试仍只有一对故事行')
  assert.equal(run.chat().messages[0].source.rpcId, 'rpc-saved')
  assert.equal(run.chat().messages[0].text, '推开窗')
  assert.equal(run.chat().messages[1].text, '雨水扑进房间。')
})


test('插件新正文按处理后的原文保存，不重复运行输出宏或正则；结算仍只排一次', async () => {
  const h = harness('story', { autoSettle: false, macros: true,
    bodyGeneration: { mode: 'plugin-tool-call', provider: 'p:body' },
    extensions: { regexScripts: [{ scriptName: 'double', findRegex: '/X/g', replaceString: 'XX', placement: [2] }] } })
  const prepared = await h.orchestrator.prepare({ sessionId: 'session', turn: 2, userText: '继续', requestId: 'request' })
  assert.equal(prepared.frame.source.bodyGeneration.provider, 'p:body')
  assert.ok((await h.orchestrator.visibleTools('session')).includes('tavern_generate_body'))
  const input = { sessionId: 'session', turn: 2, userText: '继续', requestId: 'request', assistantText: 'X {{setvar::output::bad}}', pluginBodyGeneration: true }
  await assert.rejects(h.orchestrator.finalize(input), /有效的插件正文/)
  const ready = h.chat()
  ready.timeline.operations[prepared.frame.operationId].bodyGeneration = { status: 'ready', receipt: { text: input.assistantText } }
  h.replaceChat(ready)
  const saved = await h.orchestrator.finalize(input)
  assert.equal(saved.reply.sessionText, input.assistantText)
  const row = h.chat().messages.at(-1)
  assert.equal(row.bodyRegenerationProcessed, true)
  assert.equal(row.projectionText, input.assistantText)
  assert.equal(h.chat().macroState.local.output, undefined)
  assert.equal(h.chat().settleStatus, 'pending')
  assert.equal((await h.orchestrator.finalize(input)).duplicate, true)
  assert.equal(h.chat().messages.filter(row => row.role === 'assistant').length, 1)
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

test('前台正文结尾包含 <story_choices> 时，落盘自动剥离标签并写入 chat.candidates', async () => {
  const h = harness('story', { autoSettle: false, macros: true })
  await h.orchestrator.prepare({ sessionId: 'session', turn: 2, userText: '继续', requestId: 'req-fg' })
  const assistantText = [
    '阿芙拉收起短剑，靠在窗边。',
    '<story_choices>',
    JSON.stringify({
      actions: [
        '{{user}}顺势贴近{{char}}，继续深入刚才的话题',
        '主动牵起{{char}}的手，改变现场僵持的节奏',
        '停下动作低声调侃{{char}}，观察她的细微神态',
        '伸手替{{char}}整理被雨水打湿的斗篷领口'
      ],
      scene: '雨停后离开旅店前往黎明的集市'
    }),
    '</story_choices>'
  ].join('\n')
  const saved = await h.orchestrator.finalize({
    sessionId: 'session',
    turn: 2,
    userText: '继续',
    requestId: 'req-fg',
    assistantText,
    replyMessageId: 'msg-projected-1'
  })
  assert.equal(saved.reply.sessionText, '阿芙拉收起短剑，靠在窗边。')
  const chat = h.chat()
  assert.equal(chat.messages.at(-1).text, '阿芙拉收起短剑，靠在窗边。')
  assert.equal(chat.messages.at(-1).sourceText, '阿芙拉收起短剑，靠在窗边。')
  assert.ok(chat.candidates)
  assert.equal(chat.candidates.messageId, 'msg-projected-1')
  assert.equal(chat.candidates.choices.length, 5)
  assert.equal(chat.candidates.choices[0].text, 'User顺势贴近阿芙拉，继续深入刚才的话题')
  assert.equal(chat.candidates.choices[4].type, 'scene')
  // 下一轮正文没有候选项：上一轮留下的选项不能继续挂在新正文下面。
  await h.orchestrator.prepare({ sessionId: 'session', turn: 3, userText: '继续', requestId: 'req-fg-2' })
  await h.orchestrator.finalize({ sessionId: 'session', turn: 3, userText: '继续', requestId: 'req-fg-2',
    assistantText: '窗外的雨停了。', replyMessageId: 'msg-projected-2' })
  assert.ok(h.chat().candidates == null, '这一轮没有候选项就清掉上一轮的那一份')
})
