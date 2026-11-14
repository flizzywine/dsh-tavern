import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateGenerator, extractForegroundStoryChoices, foregroundCandidatePrompt } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const storyChoices = [
  { type: 'action', text: '走到窗边仔细观察街上的动静' },
  { type: 'action', text: '压低声音询问阿芙拉钟楼的线索' },
  { type: 'action', text: '检查桌上残留的泥水和脚印痕迹' },
  { type: 'action', text: '推开后门沿着雨中的马蹄印追踪' },
  { type: 'scene', text: '场景切换到午夜钟楼下的狭窄石巷' }
]

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-00001', order: 0, text: '旅店相遇。' },
      { id: 'chunk-00002', order: 1, text: '雨夜追踪。' },
      { id: 'chunk-00003', order: 2, text: '钟楼对峙。' }
    ]
  }
}

function harness({ mode = 'story', outputs, initialCandidates, initialCandidateAgent, initialSettleStatus, messages, initialScriptCursor = 0, initialScriptEnded = false, scriptData, cardData, macroState, waitUntilSettled, writeChatHook, modelSelection, planHook, worldBookContext }) {
  const continuity = createScriptContinuity()
  const activeScript = scriptData || script()
  let scriptState = mode === 'script' ? continuity.start(activeScript, initialScriptCursor) : null
  if (initialScriptEnded) scriptState = continuity.transition({ script: activeScript, state: scriptState, event: { kind: 'end' } }).state
  let chat = {
    id: 'chat-1', cardId: 'card-1', mode, messages: messages || [{ role: 'assistant', text: '雨水敲着窗。' }],
    scriptState,
    settleStatus: initialSettleStatus || 'idle',
    macroState: macroState || { userName: 'User', local: {}, global: {} }
  }
  if (initialCandidates !== undefined) chat.candidates = structuredClone(initialCandidates)
  if (initialCandidateAgent !== undefined) chat.candidateAgent = structuredClone(initialCandidateAgent)
  const card = cardData || { id: 'card-1', name: '阿芙拉', description: '银发佣兵', tags: [] }
  let modelCalls = 0
  const modelRequests = []
  function remember(options) {
    modelRequests.push({
      preparedWorldbook: options.preparedWorldbook,
      system: options.system,
      backgroundContext: options.backgroundContext,
      systemPromptText: options.systemPromptText,
      postHistoryText: options.postHistoryText,
      turnContext: options.turnContext,
      messages: structuredClone(options.messages),
      tools: structuredClone(options.tools || []),
      maxTokens: options.maxTokens,
      persistent: options.persistent,
      persistentSessionId: options.persistentSessionId,
      rewindTo: Number.isSafeInteger(options.rewindTo) ? options.rewindTo : null,
      webSearchEnabled: options.webSearchEnabled === true
    })
  }
  async function nextOutput(options) {
    remember(options)
    const call = ++modelCalls
    const output = outputs[Math.min(call - 1, outputs.length - 1)]
    const text = typeof output === 'function' ? await output(options) : output
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed.choices)) {
        await options.onToolCall({
          name: 'candidate_submit_choices',
          arguments: {
            actions: parsed.choices.filter(item => item && item.type === 'action').map(item => item.text),
            scene: parsed.choices.find(item => item && item.type === 'scene')?.text || ''
          }
        })
      }
    } catch (_error) {}
    return { text, traceSessionId: options.persistentSessionId || 'candidate-trace-' + call }
  }
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readChat() { return structuredClone(chat) },
    async readCard(_path, snapshot) { assert.equal(snapshot.id, chat.id, 'candidate preparation reuses the current chat resource snapshot'); return structuredClone(card) },
    async readScript() { return mode === 'script' ? structuredClone(activeScript) : undefined },
    async writeChat(next) {
      if (typeof writeChatHook === 'function') await writeChatHook(next, chat)
      chat = structuredClone(next)
    },
    async updateChat(_id, update) {
      const next = await update(structuredClone(chat))
      if (next !== undefined) {
        if (typeof writeChatHook === 'function') await writeChatHook(next, chat)
        chat = structuredClone(next)
      }
      return structuredClone(chat)
    }
  }
  const model = {
    selection(selectedChat) { return modelSelection ? modelSelection(selectedChat) : { provider: 'test', model: 'scripted' } },
    async runCandidate(options) { return await nextOutput(options) }
  }
  const plannerCalls = []
  const warnings = []
  const planner = {
    async plan(input) {
      plannerCalls.push(input)
      await planHook?.()
      return { text: '候选项上下文', stableText: '稳定候选上下文', taskText: '候选格式规则', systemPromptText: '本轮系统提示', postHistoryText: '本轮历史后指令', dynamicText: '本轮游标、Guide 与姿势', audit: { included: [], omitted: [], warnings: [], totalChars: 7 } }
    }
  }
  const candidates = createCandidateGenerator({
    store, model, planner, prompt, scripts: continuity, worldBookContext,
    characterDesign: { async execute() { return JSON.stringify({ ok: true }) } },
    async stableWorldBookContext(currentChat, currentCard) {
      assert.equal(currentChat.id, chat.id)
      assert.equal(currentCard.name, card.name)
      return '常驻世界设定'
    },
    timeline: createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 123456 }),
    waitUntilSettled: waitUntilSettled || (async () => {}), sleep: async () => {}, now: () => 123456,
    logger: { error() {}, warn(message) { warnings.push(String(message)) } }
  })
  return {
    candidates, continuity, plannerCalls, modelRequests, warnings, modelCalls: () => modelCalls,
    chat: () => structuredClone(chat),
    setMessages(next) {
      chat.messages = structuredClone(next)
      if (chat.timeline) chat.timeline.revision++
    },
    mutateChat(change) { change(chat) }
  }
}

test('自由故事只保存完整的 4 action + 1 scene', async () => {
  const run = harness({ outputs: [async function (options) {
    await options.onToolCall({
      name: 'candidate_submit_choices',
      arguments: { actions: storyChoices.slice(0, 4).map(item => item.text), scene: storyChoices[4].text }
    })
    return '<|DSML|tool_calls>不应被当作候选结果的普通文字'
  }] })
  let started = null

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-1', guidance: '多写动作', onStarted(operation) { started = operation } })
  assert.match(started.operationId, /^operation-/)
  assert.equal(started.basedOn.revision, 0)
  assert.deepEqual(result.basedOn, started.basedOn, 'durable task result must already match the committed candidate record')
  assert.equal(run.modelCalls(), 1)
  assert.equal(result.choices.length, 5)
  assert.equal(result.choices.filter((item) => item.type === 'action').length, 4)
  assert.equal(result.choices.filter((item) => item.type === 'scene').length, 1)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.equal(result.traceMode, 'continuable')
  assert.equal(run.modelRequests[0].persistent, true)
  assert.equal(run.modelRequests[0].maxTokens, undefined)
  assert.equal(run.plannerCalls[0].purpose, 'candidate')
  assert.match(run.plannerCalls[0].task, /You generate plot choices/)

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)  // Choices change no story: work fenced on the revision (this turn's stage director) stays valid.
  assert.equal(run.chat().timeline.revision, started.basedOn.revision)
})

test('单次输出无效时不覆盖旧候选，也不改变剧本游标', async () => {
  const invalid = '{"choices":[{"type":"unknown","text":"有文本但类型无效"}]}'
  const oldCandidates = { messageId: 'old', choices: [{ type: 'action', text: '保留这一份旧的有效候选内容' }], generatedAt: 1 }
  const stageThenFail = async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 2 } })
    return invalid
  }
  const run = harness({ mode: 'script', outputs: [stageThenFail], initialCandidates: oldCandidates })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-3' }), /有效候选项/)
  assert.equal(run.modelCalls(), 1)
  const after = run.chat()
  assert.deepEqual(after.candidates, oldCandidates)
  assert.equal(run.continuity.inspect({ script: script(), state: after.scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('first candidate interrupted before a result keeps its bound session for retry', async () => {
  const run = harness({ outputs: [async input => {
    await input.onPersistentSessionReady('background-bound-before-result');
    throw new Error('interrupted');
  }, JSON.stringify({ choices: storyChoices })] });
  await assert.rejects(run.candidates.generate({ sessionId: 'session-1', messageId: 'first' }));
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'first' });
  assert.equal(run.modelRequests[1].persistentSessionId, 'background-bound-before-result');
});

test('choices after unseen turns still carry the recent story and the player name', async () => {
  const opening = [{ role: 'assistant', turn: 1, text: '你在旅店醒来，阿芙拉坐在床边。' }]
  const run = harness({ messages: opening, macroState: { userName: '阿舟', local: {}, global: {} }, outputs: [JSON.stringify({ choices: storyChoices })] })
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'turn1' })
  const later = [...opening]
  for (let turn = 2; turn <= 20; turn++) later.push({ role: 'user', text: '继续' }, { role: 'assistant', turn,
    text: turn === 19 ? '旅店老板改口叫你阿舟，你们离开旅店前往钟楼。' : turn === 20 ? '午夜，阿舟向阿芙拉道晚安，她已经在卧室睡着。' : '第' + turn + '轮：调查继续。' })
  run.setMessages(later)
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'turn20' })
  const request = run.modelRequests[1]
  assert.equal(request.persistentSessionId, 'candidate-trace-1', 'second request resumes the persistent background session')
  const bodies = request.messages.filter(message => message.role === 'assistant').map(message => message.content[0].text)
  const task = request.messages.at(-1).content[0].text
  assert.equal(bodies.length, 3, 'the three newest story turns reach the background agent')
  assert.ok(bodies.some(text => text.includes('钟楼')))
  assert.match(task, /latest story turn 20/)
  assert.match(task, /Player.s name in this session: 阿舟/)
})

test('a synced background session still receives the latest story, renamed player and bedtime after twenty turns', async () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'assistant', turn: i + 1, text: i === 19 ? '阿舟在午夜向阿芙拉道晚安，她已经在卧室睡着。' : '阿舟继续处理当天的事情，第' + (i + 1) + '轮。' }))
  const run = harness({ messages, macroState: { userName: '阿舟', local: {}, global: {} }, outputs: [JSON.stringify({ choices: storyChoices })] })
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'turn20' })
  // The second task shares both the persistent participant and its synced revision.
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'turn20-again' })
  const request = run.modelRequests[1]
  assert.equal(request.persistentSessionId, 'candidate-trace-1')
  const bodies = request.messages.filter(message => message.role === 'assistant')
  assert.equal(bodies.length, 3)
  assert.equal(bodies.at(-1).content[0].text, messages.at(-1).text)
  assert.match(request.messages.at(-1).content[0].text, /latest story turn 20/)
  assert.match(request.messages.at(-1).content[0].text, /Player.s name in this session: 阿舟/)
})

test('前台生成候选项：提示词门控与正文尾部 <story_choices> 提取、宏替换与剥离', () => {
  assert.equal(foregroundCandidatePrompt({ mode: 'story', backgroundTasks: { foregroundCandidates: false } }), '')
  assert.equal(foregroundCandidatePrompt({ mode: 'script', backgroundTasks: { foregroundCandidates: true } }), '')
  assert.match(foregroundCandidatePrompt({ mode: 'story', backgroundTasks: { foregroundCandidates: true } }), /<foreground_story_candidates>/)

  const raw = [
    '雨夜的钟声回荡在走廊尽头。',
    '<story_choices>',
    JSON.stringify({
      actions: [
        '{{user}}顺势走近{{char}}，压低声音追问真相',
        '突然转变态度，夺过{{char}}手中的提灯掌控主动',
        '停下脚步盯着{{char}}的眼睛，用沉默与反问试探反应',
        '伸手触碰{{char}}微凉的指尖并检查桌上的旧信封'
      ],
      scene: '推开暗门转移到钟楼顶层的密室'
    }),
    '</story_choices>'
  ].join('\n')
  const extracted = extractForegroundStoryChoices(raw, {
    card: { name: '阿芙拉' },
    chat: { macroState: { userName: '旅人' } }
  })
  assert.equal(extracted.hadTag, true)
  assert.equal(extracted.proseText, '雨夜的钟声回荡在走廊尽头。')
  assert.equal(extracted.choices.length, 5)
  assert.equal(extracted.choices[0].type, 'action')
  assert.equal(extracted.choices[0].text, '旅人顺势走近阿芙拉，压低声音追问真相')
  assert.equal(extracted.choices[4].type, 'scene')
  assert.equal(extracted.choices[4].text, '推开暗门转移到钟楼顶层的密室')

  // 截断或无效的标签同样从正文中剥离，不污染显示正文
  const truncated = '正文内容。\n<story_choices>\n{"actions":["未写完'
  const broken = extractForegroundStoryChoices(truncated, {})
  assert.equal(broken.hadTag, true)
  assert.equal(broken.proseText, '正文内容。')
  assert.equal(broken.choices, null)

  // 正文里引用 `<story_choices>` 示例时只认末尾真块：切在引用处会把整轮正文切没
  const quoted = [
    '协议要求：正文末尾附上 `<story_choices>{"actions":["..."]}</story_choices>` 再收尾。',
    '<story_body>第一段正文。</story_body>',
    '<story_choices>',
    JSON.stringify({ actions: ['甲甲甲甲行动', '乙乙乙乙行动', '丙丙丙丙行动', '丁丁丁丁行动'], scene: '换场到走廊' }),
    '</story_choices>',
    '</story_after_format>',
    '</story_plot>'
  ].join('\n')
  const quotedOut = extractForegroundStoryChoices(quoted, {})
  assert.equal(quotedOut.hadTag, true)
  assert.match(quotedOut.proseText, /第一段正文/)
  assert.equal(quotedOut.choices.length, 5)

  // 闭合后若只跟卡协议闭合标签或自闭合标签（如 <story_done/>），仍正常提取并剥离
  const selfClosingTail = [
    '<story_body>雨停后的走廊。</story_body>',
    '<story_choices>',
    JSON.stringify({ actions: ['甲甲甲甲行动', '乙乙乙乙行动', '丙丙丙丙行动', '丁丁丁丁行动'], scene: '换场到阳台' }),
    '</story_choices>',
    '</story_body>',
    '<story_after_format>',
    '<story_done/>',
    '</story_after_format>',
    '</story_plot>'
  ].join('\n')
  const selfClosingOut = extractForegroundStoryChoices(selfClosingTail, {})
  assert.equal(selfClosingOut.hadTag, true)
  assert.equal(selfClosingOut.proseText, '<story_body>雨停后的走廊。</story_body>')
  assert.equal(selfClosingOut.choices.length, 5)

  // 只有引用、没有真块：正文原样保留，不按引用处切割
  const onlyQuote = '正文提到 `<story_choices>{"actions":[]}</story_choices>` 这个标签，然后继续写正文。'
  const quoteOut = extractForegroundStoryChoices(onlyQuote, {})
  assert.equal(quoteOut.hadTag, false)
  assert.equal(quoteOut.proseText, onlyQuote)

  // 多角色分组 + 全局事件/场景结构化提取（支持第三人称无“我”场景）
  const structuredRaw = [
    '大厅烛火摇曳。',
    '<story_choices>',
    JSON.stringify({
      actors: [
        { name: '{{char}}', actions: ['{{char}}突然按住剑柄逼近一步', '{{char}}冷笑一声踢翻脚边木椅'] },
        { name: '陆沉', actions: ['陆沉不动声色挡在苏晚身前', '陆沉举起酒杯缓和气氛', '陆沉暗中向门外卫兵打手势'] },
        { name: '苏晚', actions: ['苏晚合上账册反问{{char}}来意', '苏晚借整理披肩退向暗门'] }
      ],
      event: '钟楼方向突然传来急促的警钟声打破对峙',
      scene: '深夜众人散去后转入地下密室议事'
    }),
    '</story_choices>'
  ].join('\n')
  const structured = extractForegroundStoryChoices(structuredRaw, {
    card: { name: '阿芙拉' },
    chat: { macroState: { userName: '陆沉' } }
  })
  assert.equal(structured.proseText, '大厅烛火摇曳。')
  assert.equal(structured.choices.length, 9)
  assert.deepEqual(structured.choices[0], { type: 'action', actor: '阿芙拉', text: '阿芙拉突然按住剑柄逼近一步' })
  assert.deepEqual(structured.choices[2], { type: 'action', actor: '陆沉', text: '陆沉不动声色挡在苏晚身前' })
  assert.deepEqual(structured.choices[7], { type: 'event', text: '钟楼方向突然传来急促的警钟声打破对峙' })
  assert.deepEqual(structured.choices[8], { type: 'scene', text: '深夜众人散去后转入地下密室议事' })
})

test('自由故事支持按焦点角色优先的多主体分组 + 全局突发事件与场景切换，并完整持久化', async () => {
  const errors = []
  const run = harness({
    outputs: [async function (options) {
      const bad = JSON.parse(await options.onToolCall({
        name: 'candidate_submit_choices',
        arguments: {
          actors: [{ name: '阿芙拉', actions: ['阿芙拉推开拉门看向走廊'] }],
          scene: '清晨集市'
        }
      }))
      errors.push(bad)
      await options.onToolCall({
        name: 'candidate_submit_choices',
        arguments: {
          actors: [
            { name: '{{char}}', actions: ['{{char}}察觉门外气息主动拉开拉门', '{{char}}故意压低嗓音引门外人现身', '{{char}}吹灭烛火退到屏风后戒备'] },
            { name: '我', actions: ['我推开拉门坦然迈进房间', '我屏住呼吸悄悄退回走廊拐角', '我轻叩门框出声试探{{char}}'] }
          ],
          event: '走廊尽头突然传来巡夜人的脚步声与灯笼光亮',
          scene: '时间来到次日清晨的旅店大堂'
        }
      })
      return ''
    }]
  })
  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-actors', guidance: '加强角色互动' })
  assert.equal(errors[0].ok, false)
  assert.equal(errors[0].retryable, true)
  assert.equal(result.choices.length, 8)
  assert.deepEqual(result.choices.slice(0, 3).map(c => c.actor), ['阿芙拉', '阿芙拉', '阿芙拉'])
  assert.deepEqual(result.choices.slice(3, 6).map(c => c.actor), ['我', '我', '我'])
  assert.equal(result.choices[6].type, 'event')
  assert.equal(result.choices[7].type, 'scene')

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-actors' })
  assert.deepEqual(saved, result)
})
