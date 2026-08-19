const BASE_TIME = Date.UTC(2026, 7, 19, 12, 0, 0)

export const publicDemoIds = Object.freeze({
  workspace: 'dsh-tavern-public-demo',
  scriptSession: 'session-public-script',
  freeSession: 'session-public-free',
  revisionSession: 'session-public-revision',
  extractSession: 'session-public-extract',
})

function message(role, text, id, greeting = false) {
  return { role, text, id, ts: BASE_TIME, ...(greeting ? { greeting: true } : {}) }
}

function sessionLog({ id, cwd, title, messages, createdAt }) {
  const rows = [{ type: 'session', version: 0, id, createdAt, cwd, delegationDepth: 0, agentPreset: 'tavern' }]
  let seq = 0
  const push = (type, data, surfaceOp) => rows.push({
    type,
    seq: seq++,
    time: createdAt + seq,
    data,
    ...(surfaceOp ? { surfaceOp } : {}),
  })
  push('agent-preset/selected', { agentPreset: 'tavern' })
  push('session/title', { title, messageSeqs: [], source: { kind: 'fallback' } })
  let turn = 0
  for (let index = 0; index < messages.length;) {
    turn += 1
    push('turn/start', { turn })
    push('step/start', { turn, step: 1 })
    if (messages[index]?.role === 'user') {
      const item = messages[index++]
      push('user/message', {
        id: item.id,
        role: 'user',
        content: [{ type: 'text', text: item.text }],
        source: { kind: 'user', rpcId: `public-${item.id}`, clientTimeZone: 'Asia/Shanghai' },
      }, 'append')
    }
    if (messages[index]?.role === 'assistant') {
      const item = messages[index++]
      push('assistant/message', {
        turn,
        step: 1,
        message: {
          id: item.id,
          role: 'assistant',
          content: [{ type: 'text', text: item.text }],
          source: { kind: 'model', provider: 'dsh-tavern-preview', model: 'public-demo' },
        },
      }, 'append')
    }
    push('step/end', { turn, step: 1 })
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }
  push('session/end-seed', {})
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
}

function scriptChunks(scriptText) {
  const acts = scriptText.split(/(?=^## 第[一二三四五六七八九十]+幕)/mu).map((part) => part.trim()).filter(Boolean)
  const heading = acts.shift() || '# 失踪的银铃商队'
  return acts.map((text, order) => ({
    id: `chunk-${String(order + 1).padStart(5, '0')}`,
    order,
    text: order === 0 ? `${heading}\n\n${text}` : text,
  }))
}

export function createPublicDemo({ workspaceRoot, cardDocument, scriptText, characterSource, worldSource }) {
  const ids = publicDemoIds
  const chunks = scriptChunks(scriptText)
  const importedAt = BASE_TIME - 60_000
  const card = {
    id: 'card-demo',
    ...cardDocument.data,
    spec: cardDocument.spec || 'chara_card_v3',
    importedAt,
    updatedAt: BASE_TIME,
  }
  const script = {
    cardId: card.id,
    title: '失踪的银铃商队.md',
    sourceChars: Array.from(scriptText).length,
    chunkSize: 500,
    chunks,
    importedAt,
  }
  const sources = [
    { id: 'source-avra', title: '01-avra-character.md', text: characterSource },
    { id: 'source-town', title: '02-blackwheat-town.md', text: worldSource },
  ].map((source, index) => ({
    id: source.id,
    title: source.title,
    sourceChars: Array.from(source.text).length,
    chunkSize: 500,
    chunks: [{ id: 'chunk-00001', order: 0, text: source.text }],
    importedAt: importedAt + index,
  }))

  const freeMessages = [
    message('assistant', card.first_mes, 'public-free-opening', true),
    message('user', '再来一杯，顺便问问镇上最近有什么新鲜事。', 'public-free-user'),
    message('assistant', '阿芙拉把空杯接过去，却没有立刻倒酒。她朝壁炉边的黑斗篷客扫了一眼，才拧开木桶的铜栓。\n\n“新鲜事每天都有，值钱的却不多。”麦酒撞进杯底，泡沫沿着杯壁缓缓升起，“北门昨晚捡到一枚银铃，铃身上沾着蓝漆。守夜人说是孩子的玩具，可那孩子家里连一匹驮马都没有。”\n\n她把酒推回来，手指仍压着杯沿：“你若真想听下去，先告诉我——你是在找铃，还是在找挂铃的人？”', 'public-free-body'),
  ]
  const freeChat = {
    id: 'chat-public-free', title: '自由故事 · 金麦穗酒馆', cardId: card.id, cardName: card.name, mode: 'story', sessionId: ids.freeSession,
    messages: freeMessages, posture: '阿芙拉站在吧台后，一手压着刚倒满的麦酒杯，目光越过玩家观察壁炉边的黑斗篷客。',
    guides: [], lore: [], pending: null, awaitingScene: false, settleStatus: 'done', settleError: null,
    candidates: {
      messageId: 'public-free-body', generatedAt: BASE_TIME,
      choices: [
        { type: 'action', text: '把银币压在杯垫下，问阿芙拉那枚沾蓝漆的银铃如今在谁手里。' },
        { type: 'action', text: '顺着她的视线观察壁炉边的黑斗篷客，留意对方袖口和随身行李。' },
        { type: 'action', text: '拿出半截黑蜡封的旧信皮，试探阿芙拉是否认得独眼乌鸦印记。' },
        { type: 'action', text: '先不追问商队，改向守夜人敬酒，从他嘴里套出北门昨夜的巡逻记录。' },
        { type: 'scene', text: '转到酒馆后院：借查看马匹之名检查泥地，在马厩与废井之间寻找新鲜脚印。' },
      ],
    },
    createdAt: BASE_TIME - 40_000, updatedAt: BASE_TIME + 1_000, nativeOpeningAppended: true,
  }

  const scriptMessages = [
    message('assistant', card.first_mes, 'public-script-opening', true),
    message('user', '我从怀里取出一封带着独眼乌鸦印记的黑蜡信封，放在吧台上。', 'public-script-user'),
    message('assistant', '阿芙拉的手停在信封上方，没有碰。酒馆里的笑声、杯盘声和雨点敲窗的声音仿佛一下都远了。\n\n她先看门口，又望向壁炉阴影里的黑斗篷客，随后把最近的一盏油灯拨暗。\n\n“七天前，银铃商队过了北方石桥。”她声音很轻，“可三天前，有人在北门路沟里捡到一枚还沾着湿蓝漆的铃。车队到过这里，只是有人不想让它从路面上出现。”\n\n黑斗篷客端起酒杯，宽大的袖口滑落半寸，露出一截灰色羽毛。阿芙拉垂下眼，指尖在吧台上轻敲两下：“信收好。这里不适合继续谈。”', 'public-script-body'),
  ]
  const scriptChat = {
    id: 'chat-public-script', title: '剧本故事 · 失踪的银铃商队', cardId: card.id, cardName: card.name, mode: 'script', sessionId: ids.scriptSession,
    messages: scriptMessages,
    scriptState: {
      cursor: 1, initialCursor: 0, recalledChunkIds: [chunks[0].id], prepared: null,
      lastReference: { chunkId: chunks[0].id, order: 0, text: chunks[0].text, userText: scriptMessages[1].text, recalledAt: BASE_TIME },
      totalChunks: chunks.length, title: script.title, scriptVersion: importedAt,
    },
    posture: '阿芙拉站在吧台内侧，左手悬在黑蜡信封上方，右手拨暗油灯，余光警惕地盯着壁炉旁的黑斗篷客。',
    guides: [
      { id: 'guide-suspense', text: '保持悬疑气氛，不提前揭晓幕后人物。' },
      { id: 'guide-dialogue', text: '阿芙拉的对白不超过三句，多用观察和迟疑动作。' },
      { id: 'guide-agency', text: '玩家不是上帝，其他角色可以拒绝不合理要求。' },
    ],
    lore: [], pending: null, awaitingScene: false, settleStatus: 'done', settleError: null,
    candidates: {
      messageId: 'public-script-body', generatedAt: BASE_TIME + 2_000, script: { cursor: 1, ended: false },
      choices: [{ type: 'action', text: '顺着阿芙拉的暗示收起信封，故意把话题转回麦酒，同时观察黑斗篷客是否准备离席。' }],
    },
    createdAt: BASE_TIME - 30_000, updatedAt: BASE_TIME + 4_000, nativeOpeningAppended: true,
  }

  const revisionMessages = [
    message('assistant', '我们现在进入“阿芙拉”的人物卡设定对话（卡片模式）。可以先讨论、分析或比较方案；只有你明确确认修改时，我才会把变更写入人物卡。', 'public-revision-opening', true),
    message('user', '请分析这张人物卡最明显的两个问题，不要修改任何字段。', 'public-revision-user-1'),
    message('assistant', '最明显的两个问题是：\n\n1. system_prompt 缺少稳定叙事风格和行为边界的锚点。\n2. mes_example 只展示了热情接待，没有示范她精明、套话、镇场等真正能立住人设的侧面。\n\n本轮只做分析，没有修改任何字段。', 'public-revision-body-1'),
    message('user', '让阿芙拉更克制。只有看到黑蜡信封或其他可信凭证时，她才谈银铃商队。先给我两个方案，不要提交。', 'public-revision-user-2'),
    message('assistant', '**方案一｜写进人设底色**\n\n修改 description：行为最稳，但会让她整体显得更谨慎。\n\n**方案二｜触发式规则**\n\n写入 post_history_instructions：平时不改变她的爽朗性格，只在话题涉及银铃商队时收紧。\n\n两个方案都尚未写入。你确认后我再提交。', 'public-revision-body-2'),
    message('user', '采用第二个方案，确认修改。', 'public-revision-user-3'),
    message('assistant', '已采用第二个方案，只更新 post_history_instructions。现在阿芙拉只有看到黑蜡信封或其他可信凭证时，才会谈银铃商队；description、personality 等其他字段保持不变。', 'public-revision-body-3'),
  ]
  const revisionChat = {
    id: 'chat-public-revision', title: '设定对话 · 阿芙拉', cardId: card.id, cardName: card.name, mode: 'revision', sessionId: ids.revisionSession,
    messages: revisionMessages, posture: '', guides: [], lore: [], pending: null, awaitingScene: false,
    settleStatus: 'idle', settleError: null, createdAt: BASE_TIME - 20_000, updatedAt: BASE_TIME + 3_000, nativeOpeningAppended: true,
  }

  const extractDraft = {
    name: '阿芙拉', description: card.description, personality: card.personality, scenario: card.scenario,
    first_mes: card.first_mes, mes_example: card.mes_example, system_prompt: card.system_prompt,
    post_history_instructions: card.post_history_instructions, tags: card.tags, updatedAt: BASE_TIME,
  }
  const extractMessages = [
    message('assistant', '卡片模式 · 素材抽取：已载入人物素材与世界素材。请告诉我准备提炼谁，以及谁是玩家（{{user}}）。', 'public-extract-opening', true),
    message('user', '提炼阿芙拉。玩家是受雇调查银铃商队失踪事件的旅行者。先区分人物设定和世界背景。', 'public-extract-user'),
    message('assistant', '已区分完成：人物素材用于阿芙拉的身份、外貌、性格和行为规则；黑麦镇、银铃商队、灰鸦帮与旧水道归入世界背景。\n\n玩家身份已确认为“受雇调查银铃商队失踪事件的旅行者”。右侧草稿已经整理出角色描述、开场情境、对话示例和标签，可继续逐项修改后保存。', 'public-extract-body'),
  ]
  const extractChat = {
    id: 'chat-public-extract', title: '素材抽取 · 阿芙拉', cardId: '', cardName: '抽取中的阿芙拉', mode: 'extract', sessionId: ids.extractSession,
    messages: extractMessages,
    extract: { sourceIds: sources.map((source) => source.id), cursor: 2, prepared: null, done: false, player: '受雇调查银铃商队失踪事件的旅行者', draft: extractDraft },
    posture: '', guides: [], lore: [], pending: null, awaitingScene: false, settleStatus: 'idle', settleError: null,
    createdAt: BASE_TIME - 10_000, updatedAt: BASE_TIME + 2_000, nativeOpeningAppended: true,
  }

  const chats = [scriptChat, revisionChat, extractChat, freeChat]
  const sessionMap = Object.fromEntries(chats.map((chat) => [chat.sessionId, chat.id]))
  const sessionDefinitions = [
    { id: ids.scriptSession, title: '剧本故事 · 失踪的银铃商队', messages: scriptMessages, createdAt: BASE_TIME + 4_000 },
    { id: ids.revisionSession, title: '设定对话 · 阿芙拉', messages: revisionMessages, createdAt: BASE_TIME + 3_000 },
    { id: ids.extractSession, title: '素材抽取 · 阿芙拉', messages: extractMessages, createdAt: BASE_TIME + 2_000 },
    { id: ids.freeSession, title: '自由故事 · 金麦穗酒馆', messages: freeMessages, createdAt: BASE_TIME + 1_000 },
  ]
  return {
    card,
    script,
    sources,
    chats,
    sessionMap,
    workspace: {
      workspaceId: ids.workspace,
      path: workspaceRoot,
      title: 'dsh-tavern 公开案例',
      sessionIds: sessionDefinitions.map((session) => session.id),
      createdAt: new Date(BASE_TIME).toISOString(),
      updatedAt: new Date(BASE_TIME + 4_000).toISOString(),
    },
    sessionLogs: sessionDefinitions.map((session) => ({
      id: session.id,
      cwd: workspaceRoot,
      content: sessionLog({ ...session, cwd: workspaceRoot }),
    })),
  }
}
