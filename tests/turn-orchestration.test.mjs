import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyPresentation } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'

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
  let cardWorkspace = cards.create({ kind: 'import', payload: { name: '阿芙拉', description: '旧描述' } })
  let card = cards.project(cardWorkspace)
  let chat = {
    id: 'chat-1', cardPath: options.draft ? '' : 'cards/阿芙拉.json', cardName: options.draft ? '卡片工作台' : card.name, mode,
    messages: [], posture: '站在窗边', guides: [], nativeCommits: {},
    runtimePresetSnapshot: clone(options.runtimePresetSnapshot || null),
    macroState: { userName: 'User', local: {}, global: {} },
    scriptState: mode === 'script' ? scripts.start(script(), 0) : null,
    workspace: mode === 'card' ? { mountedResources: [], sourceIds: options.draft ? ['src-1'] : [], draft: { name: '' }, player: '', cursor: 0, prepared: null } : null
  }
  const settlements = []
  const createdCards = []
  const plannerCalls = []
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 2000 })
  const store = {
    async chatForSession() { return clone(chat) },
    async readCard() { return options.draft && !chat.cardPath ? undefined : clone(card) },
    async readCardExtensions() { return clone(options.extensions || { regexScripts: [] }) },
    async readScript() { return mode === 'script' || (mode === 'card' && !options.draft) ? clone(script()) : undefined },
    async writeChat(value) { chat = clone(value) },
    async updateCard(_cardId, fields, revision, worldBook, rawOperations) {
      const change = cards.update({ kind: 'card', card: cardWorkspace, patch: fields, revision, worldBookOperations: worldBook, rawOperations })
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
        return { text: 'context:' + input.purpose }
      }
    },
    scripts,
    timeline,
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
    projectReply: projectReplyPresentation,
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
    timeline,
    replaceChat(next) { chat = clone(next) }
  }
}

test('游玩回合由生命周期自动准备与提交，不再要求模型回传正文', async () => {
  const run = harness('story')
  assert.equal(await run.orchestrator.modeFor('session-1'), 'story')
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  assert.equal(prepared.text, 'context:body')

  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '雨水扑进房间。' })
  assert.equal(saved.saved, true)
  assert.deepEqual(run.chat().messages.map((message) => [message.role, message.text]), [
    ['user', '推开窗'],
    ['assistant', '雨水扑进房间。']
  ])
  assert.deepEqual(run.settlements, ['chat-1'])

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '推开窗', assistantText: '重复文本' })
  assert.equal(run.chat().messages.length, 2)
})

test('游玩正文只保存纯文本并把 HTML 展示状态纳入剧情 checkpoint', async () => {
  const run = harness('story')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '推开窗' })
  await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '推开窗',
    assistantText: '雨水扑进房间。\n\n<details><summary>状态</summary></details>'
  })

  assert.equal(run.chat().messages.at(-1).text, '雨水扑进房间。')
  assert.equal(run.chat().presentation.html, '<details><summary>状态</summary></details>')

  const rolled = run.timeline.apply({ chat: run.chat(), intent: { kind: 'turn.rollback' } })
  assert.equal(rolled.chat.presentation, null)
})

test('人物卡展示正则把命中内容移出正文并保留内部源文本', async () => {
  const run = harness('story', {
    extensions: {
      regexScripts: [{
        id: 'status', name: '状态面板', findRegex: '\\[状态\\]([\\s\\S]*)', replaceString: '<aside>$1</aside>',
        placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: true
      }]
    }
  })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态', assistantText: '她继续向前走。\n\n[状态]体力 100'
  })

  assert.equal(saved.reply.bodyText, '她继续向前走。')
  assert.equal(run.chat().messages.at(-1).text, '她继续向前走。')
  assert.equal(run.chat().messages.at(-1).sourceText, '她继续向前走。\n\n[状态]体力 100')
  assert.equal(run.chat().messages.at(-1).turn, 2)
  assert.equal(run.chat().presentation.html, '<aside>体力 100</aside>')
})

test('旧对话保留提示词快照，新回复使用实时预设正则', async () => {
  let liveRegexScripts = []
  const run = harness('story', {
    runtimePresetSnapshot: {
      text: '固定提示词',
      regexScripts: [{
        id: 'old-status', name: '旧快照正则', findRegex: '<old>([\\s\\S]*?)<\\/old>', replaceString: '<aside>$1</aside>',
        placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false
      }]
    },
    resolvePresetRegexScripts: async function () { return liveRegexScripts }
  })
  liveRegexScripts = [{
    id: 'preset-status', name: '实时预设状态面板', findRegex: '<status>([\\s\\S]*?)<\\/status>', replaceString: '<aside>$1</aside>',
    placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false
  }]
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态', assistantText: '她继续向前走。\n\n<status>体力 80</status>'
  })

  assert.equal(saved.reply.bodyText, '她继续向前走。')
  assert.equal(run.chat().presentation.html, '<aside>体力 80</aside>')
})

test('游玩回复先执行人物卡宏再拆分 HTML', async () => {
  const run = harness('story', { macros: true })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '查看状态' })
  const saved = await run.orchestrator.finalize({
    sessionId: 'session-1', turn: 2, userText: '查看状态',
    assistantText: '她抬起头。\n\n<style>.status{color:red}</style><div class="status">阶段 {{incvar::stage}}</div>'
  })

  assert.equal(run.chat().messages.at(-1).text, '她抬起头。')
  assert.equal(run.chat().presentation.html, '<style>.status{color:red}</style><div class="status">阶段 1</div>')
  assert.deepEqual(run.chat().macroState.local, { stage: 1 })
  assert.equal(saved.reply.bodyText, '她抬起头。')
})

test('真实玩家回合缺少 prepare 时仍报 operation 错误', async () => {
  const run = harness('story')

  await assert.rejects(
    run.orchestrator.finalize({ sessionId: 'session-1', turn: 1, userText: '向前走', assistantText: '正文' }),
    /找不到本轮正文 operation/
  )
})

test('玩家输入中的酒馆变量宏在正文回合准备时执行并持久化', async () => {
  const run = harness('story', { macros: true })
  const first = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '{{incvar::stage}}继续前进' })
  const retried = await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '{{incvar::stage}}继续前进' })

  assert.equal(first.userText, '1继续前进')
  assert.equal(retried.userText, '1继续前进')
  assert.deepEqual(run.chat().macroState.local, { stage: 1 })
})

test('剧本参考在准备时锁定，正文提交后游标前进一块，失败回合可清理', async () => {
  const run = harness('script')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 3, userText: '走进旅店' })
  assert.equal(run.chat().scriptState.prepared.nativeTurn, 3)
  assert.equal(run.chat().scriptState.recalledChunkIds.length, 0)

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 3, userText: '走进旅店', assistantText: '门轴发出低响。' })
  assert.equal(run.chat().scriptState.prepared, null)
  assert.deepEqual(run.chat().scriptState.recalledChunkIds, ['chunk-1'])
  assert.equal(run.chat().scriptState.cursor, 1)

  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 4, userText: '停下脚步' })
  assert.equal(run.chat().scriptState.prepared.chunkId, 'chunk-2')
  assert.equal(await run.orchestrator.discard({ sessionId: 'session-1', turn: 4 }), true)
  assert.equal(run.chat().scriptState.prepared, null)
})

test('正文替代先回到 checkpoint 再提交，剧本游标不会推进两次', async () => {
  const run = harness('script')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 1, userText: '走进旅店' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 1, userText: '走进旅店', assistantText: '第一版正文' })
  assert.equal(run.chat().scriptState.cursor, 1)

  const rolled = run.timeline.apply({ chat: run.chat(), intent: { kind: 'turn.rollback' } })
  run.replaceChat(rolled.chat)
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 2, userText: '【重新生成】走进旅店' })
  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 2, userText: '【重新生成】走进旅店', assistantText: '替代正文' })

  assert.equal(run.chat().scriptState.cursor, 1)
  assert.equal(run.chat().timeline.checkpoints.length, 1)
  assert.equal(run.chat().messages.at(-1).text, '替代正文')
})

test('卡片修改先校验暂存，只在最终回复完成后写入', async () => {
  const run = harness('card')
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 5, userText: '参考 @[人物设定](tavern-file:materials%2F%E4%BA%BA%E7%89%A9%E8%AE%BE%E5%AE%9A.md)，确认改成新描述' })
  assert.deepEqual(run.chat().workspace.mountedResources, [{ kind: 'source', path: 'materials/人物设定.md', label: '人物设定' }])
  assert.deepEqual(run.plannerCalls.at(-1).workspace.mountedResources, [{ kind: 'source', path: 'materials/人物设定.md', label: '人物设定' }])
  const staged = await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 5, fields: { description: '新描述' } })
  assert.equal(staged.changed, true)
  assert.equal(run.card().description, '旧描述')

  await run.orchestrator.finalize({ sessionId: 'session-1', turn: 5, userText: '确认改成新描述', assistantText: '已经改好了。' })
  assert.equal(run.card().description, '新描述')
  assert.equal(run.chat().nativeCommits['5'].changed, true)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), [
    'bash',
    'str_replace_editor',
    'skill',
    'tavern_save_skill',
    'tavern_read_card',
    'tavern_read_card_raw',
    'tavern_read_worldbook',
    'tavern_update_card',
    'tavern_restore_card',
  ])
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

test('Windows 卡片模式暴露 PowerShell 而不是 Bash', async () => {
  const run = harness('card', { shellToolName: 'pwsh' })
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), [
    'pwsh',
    'str_replace_editor',
    'skill',
    'tavern_save_skill',
    'tavern_read_card',
    'tavern_read_card_raw',
    'tavern_read_worldbook',
    'tavern_update_card',
    'tavern_restore_card',
  ])
})

test('空白卡片工作台确认完整设定后直接创建并绑定正式人物卡', async () => {
  const run = harness('card', { draft: true })
  await run.orchestrator.prepare({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家' })
  await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 6, fields: { name: '阿芙拉', player: '旅行者' } })
  assert.equal(run.chat().workspace.draft.name, '')

  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家', assistantText: '人物卡已创建。' })
  assert.equal(run.chat().workspace.draft.name, '阿芙拉')
  assert.equal(run.chat().workspace.player, '旅行者')
  assert.equal(run.chat().workspace.cursor, 1)
  assert.equal(run.chat().cardPath, 'cards/阿芙拉.json')
  assert.equal(run.chat().cardName, '阿芙拉')
  assert.deepEqual(run.createdCards.map((item) => item.path), ['cards/阿芙拉.json'])
  assert.deepEqual(saved.createdCard, { path: 'cards/阿芙拉.json', name: '阿芙拉' })
  const duplicate = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 6, userText: '确认角色和玩家', assistantText: '重复回调' })
  assert.equal(duplicate.duplicate, true)
  assert.equal(run.createdCards.length, 1)
  assert.deepEqual(await run.orchestrator.visibleTools('session-1'), ['bash', 'str_replace_editor', 'skill', 'tavern_save_skill', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_worldbook', 'tavern_update_card', 'tavern_restore_card'])
})

test('空白工作台缺少新卡必填信息时不接受确认提交', async () => {
  const run = harness('card', { draft: true })
  await assert.rejects(
    run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 7, fields: { name: '阿芙拉' } }),
    /玩家身份还没有确认/
  )
  assert.equal(run.createdCards.length, 0)
})

test('旧会话已有完整临时设定时，再次确认也会落成正式人物卡', async () => {
  const run = harness('card', { draft: true })
  const chat = run.chat()
  chat.workspace.draft = { name: '阿芙拉', description: '旧会话已整理的设定' }
  chat.workspace.player = '旅行者'
  run.replaceChat(chat)

  const staged = await run.orchestrator.stageChanges({ sessionId: 'session-1', turn: 8, fields: { name: '阿芙拉', description: '旧会话已整理的设定', player: '旅行者' } })
  assert.equal(staged.changed, false)
  assert.equal(staged.createsCard, true)
  const saved = await run.orchestrator.finalize({ sessionId: 'session-1', turn: 8, userText: '确认创建人物卡', assistantText: '人物卡已创建。' })

  assert.equal(saved.changed, true)
  assert.equal(run.chat().cardPath, 'cards/阿芙拉.json')
  assert.equal(run.createdCards.length, 1)
})
