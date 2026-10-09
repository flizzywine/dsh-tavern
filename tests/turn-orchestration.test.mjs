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
    captureSceneWorldbook: options.captureSceneWorldbook,
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
    const run = harness(mode, { planner, cardData, preparedWorldBookContext: '本轮动态世界书' })
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

test('同一 DSH rpcId 即使被重放到新回合也不会再次推进酒馆状态', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, requestId: 'rpc-1', userText: '推开窗', assistantText: '雨水扑进房间。' })

  const duplicate = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, requestId: 'rpc-1', userText: '推开窗' })

  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.committedTurn, 2)
  assert.equal(run.chat().messages.length, 2)
  assert.equal(Object.values(run.timeline.inspect({ chat: run.chat() }).operations).some(function (item) {
    return Number(item.turn) === 3
  }), false)
})

test('预设中段渲染后进入真实 Frame，并保留存档中的原始宏', async () => {
  const raw = {
    front: { entries: [{ role: 'system', content: '{{setvar::style::温和}}' }] },
    middle: { entries: [{ role: 'system', content: '采用{{getvar::style}}笔调。' }] }
  }
  const run = harness('story', { runtimePresetSnapshot: structuredClone(raw) })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '继续' })
  assert.match(prepared.frame.context.writingRules, /采用温和笔调。/)
  assert.deepEqual(run.chat().runtimePresetSnapshot, raw)
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

test('游戏前台按快照启用联网搜索，卡片工作台始终启用', async () => {
  assert.deepEqual(await harness('story').orchestrator.visibleTools('session-1'), ['tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search'])
  assert.deepEqual(await harness('story', { webSearchEnabled: true }).orchestrator.visibleTools('session-1'), ['tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_recall_history', 'worldbook_search', 'web_search'])
  assert.deepEqual(await harness('script', { webSearchEnabled: true }).orchestrator.visibleTools('session-1'), ['tavern_read_variables', 'skill', 'tavern_read_skill_reference', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', 'web_search'])
  for (const webSearchEnabled of [false, true]) {
    assert.equal((await harness('card', { webSearchEnabled }).orchestrator.visibleTools('session-1')).includes('web_search'), true)
  }
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
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { description: '第二次修改' } })
  assert.equal(run.card().description, '第二次修改')
  assert.equal(run.createdCards.length, 1)
})

test('卡片工作台可按路径修改任意人物卡，无需挂载；不改变当前打开的卡', async () => {
  const run = harness('card')
  const bound = run.chat().cardPath
  const result = await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, path: 'cards/角色 v2.json', fields: { description: '第二版' } })
  assert.equal(result.path, 'cards/角色 v2.json')
  // The changed card gets the Tavern credit once, in a follow-up save.
  assert.deepEqual(run.updatedCardPaths, ['cards/角色 v2.json', 'cards/角色 v2.json'])
  assert.match(run.card().creator_notes, /(^|\n\n)Co-authored-by: DSH Tavern <https:\/\/github\.com\/flizzywine\/dsh-tavern>$/)
  assert.equal(run.chat().cardPath, bound)
  await run.orchestrator.saveChanges({ sessionId: 'session-1', turn: 1, fields: { description: '当前卡' } })
  assert.equal(run.updatedCardPaths.at(-1), bound)
  assert.equal(run.updatedCardPaths.length, 3, '已有署名不重复添加')
})

test('玩家模板先于本轮召回，重试不重复执行；提交后只产生一条玩家消息', async () => {
  for (const compatibility of [false,true]) {
    let calls=0
    const run=harness('story',{projectUserTemplate:async()=>{
      calls++
      return {message:{role:'user',text:'进入少林',variables:[{place:'少林'}],tavernPluginData:{is_ejs_processed:[true]}},scopes:{local:{place:'少林'},initial:{}}}
    },projectForegroundWorldbook:async({chat,userText})=>{
      assert.equal(chat.variables.place,'少林');assert.equal(userText,'进入少林')
      return {context:'少林名册',activation:{refs:[]},refs:[],reads:{}}
    }})
    const input={sessionId:'session-1',turn:2,userText:'原始模板'}
    const start=compatibility?'beginCompatibility':'prepare'
    const first=await run.orchestrator[start](input)
    await run.orchestrator[start](input)
    assert.equal(calls,1)
    assert.equal(first.userText,'进入少林')
    assert.equal(run.chat().messages.length,0)
    await run.orchestrator.finalize({...input,assistantText:'少林的僧人迎上前。'})
    assert.equal(run.chat().messages.length,2)
    assert.equal(run.chat().messages[0].text,'进入少林')
    assert.equal(run.chat().messages[0].variables[0].place,'少林')
    assert.equal(run.chat().promptTemplateInput,undefined)
  }
})

test('插件的本轮上下文和世界书条目进入正文帧，插件层出错时本轮照常', async () => {
  const seen = []
  const run = harness('story', { pluginTurnContext: async context => { seen.push(context); return [
    { name: 'tavern-plugin:mem:state', owner: 'mem', text: '【当前状态】雨夜' },
    { name: 'tavern-plugin:mem:wb', owner: 'mem', worldbook: true, text: '[支线] 钟楼' }] } })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推门' })
  assert.deepEqual(seen, [{ gameId: 'session-1', turn: 2, input: '推门' }])
  const plugin = prepared.frame.contributions.filter(item => item.source.stage === 'plugin')
  assert.deepEqual(plugin.map(item => [item.kind, item.text, item.source.plugin]), [
    ['foreground.current-state', '【当前状态】雨夜', 'mem'], ['foreground.active-worldbook', '[支线] 钟楼', 'mem']])
  const broken = harness('story', { pluginTurnContext: async () => { throw new Error('插件层故障') } })
  const fine = await broken.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推门' })
  assert.equal(fine.ready, true)
  assert.equal(fine.frame.contributions.some(item => item.source.stage === 'plugin'), false)
})

test('预设的「只发给模型」输入正则只进本轮请求，不写进保存的玩家消息；永久规则照常保存', async () => {
  const wrap = { id: 'peip', scriptName: 'peip', findRegex: '/^([\\s\\S]+)$/', replaceString: '<peip>$1</peip>{{user}}', placement: [1], promptOnly: true, markdownOnly: false, disabled: false }
  const fix = { id: 'fix', scriptName: 'fix', findRegex: '/推门/', replaceString: '推开门', placement: [1], promptOnly: false, markdownOnly: false, disabled: false }
  let templated = ''
  const run = harness('story', { macros: true, resolvePresetRegexScripts: async () => [fix, wrap],
    projectUserTemplate: async ({ text }) => { templated = text; return { message: { role: 'user', text, sourceText: text, swipeId: 0, swipes: [text] }, scopes: { local: {}, initial: {} } } } })
  const input = { sessionId: 'session-1', turn: 1, userText: '推门' }
  const prepared = await run.orchestrator.prepare(input)
  assert.equal(templated, '推开门', 'the template renders the stored input, without the prompt-only wrapper')
  assert.equal(prepared.userText, '<peip>推开门</peip>User', 'the model still receives the wrapper, with its macros substituted')
  await run.orchestrator.finalize({ ...input, assistantText: '门开了。' })
  const stored = run.chat().messages[0]
  assert.deepEqual([stored.text, stored.sourceText, stored.swipes], ['推开门', '推开门', ['推开门']])
  assert.doesNotMatch(JSON.stringify(stored), /peip/)
})

for (const mode of ['story', 'script']) test(mode + ' 缺少人物卡绑定时明确拒绝开始回合', async () => {
  const run = harness(mode, { draft: true })
  await assert.rejects(run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '继续' }), /缺少人物卡绑定/)
  assert.equal(run.plannerCalls.length, 0)
})
