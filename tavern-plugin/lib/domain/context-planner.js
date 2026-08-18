function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function parseJsonLenient(text) {
  if (text === undefined || text === null || text === '') return {}
  let source = str(text).trim()
  if (source.startsWith('```')) {
    const newline = source.indexOf('\n')
    if (newline >= 0) source = source.slice(newline + 1)
    if (source.endsWith('```')) source = source.slice(0, -3)
    source = source.trim()
  }
  try {
    const value = JSON.parse(source)
    if (value !== null && typeof value === 'object') return value
  } catch (error) {}
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(source.slice(start, end + 1))
      if (value !== null && typeof value === 'object') return value
    } catch (error) {}
  }
  return {}
}

function renderCardText(text, card) {
  return str(text).split('{{char}}').join(str(card && card.name)).split('{{user}}').join('你')
}

function worldBookEntries(card) {
  const book = card && card.character_book
  if (book === null || book === undefined || !Array.isArray(book.entries)) return []
  const entries = []
  for (let index = 0; index < book.entries.length; index++) {
    const entry = book.entries[index]
    if (entry === null || typeof entry !== 'object' || entry.enabled === false) continue
    let text = ''
    if (Array.isArray(entry.content)) {
      text = entry.content.map(function (item) { return item !== null && typeof item === 'object' ? str(item.content) : str(item) }).filter(Boolean).join('\n')
    } else {
      text = str(entry.content)
    }
    if (text === '') continue
    const keys = Array.isArray(entry.keys) && entry.keys.length > 0 ? entry.keys.join(',') : '设定'
    entries.push({ id: 'wb-' + index, keys, text, constant: entry.constant === true })
  }
  return entries
}

function compactPromptObject(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const result = {}
  for (const key of Object.keys(source)) {
    const item = source[key]
    if (typeof item === 'string') {
      if (item.trim() !== '') result[key] = item
    } else if (Array.isArray(item)) {
      if (item.length > 0) result[key] = item
    } else if (item !== null && typeof item === 'object') {
      if (Object.keys(item).length > 0) result[key] = item
    } else if (item !== undefined && item !== null) {
      result[key] = item
    }
  }
  return result
}

function promptObjectText(value) {
  const compact = compactPromptObject(value)
  return Object.keys(compact).length > 0 ? JSON.stringify(compact, null, 1) : '暂无已确认内容（未列出的字段为空）'
}

export function createContextPlanner(options = {}) {
  const callModel = typeof options.callModel === 'function' ? options.callModel : async function () { return '{"ids":[]}' }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console
  const selectionCache = new Map()

  async function selectWorldBookEntries(input, warnings) {
    const entries = worldBookEntries(input.card).filter(function (entry) { return entry.constant !== true })
    if (entries.length === 0) return []
    const key = str(input.chat.id) + ':' + (Number(input.nativeTurn) || 0)
    if (selectionCache.has(key)) return selectionCache.get(key)
    let selectedIds = entries.length <= 3 ? entries.map(function (entry) { return entry.id }) : []
    const recent = (input.chat.messages || []).slice(-8).map(function (message) {
      return (message.role === 'assistant' ? '正文' : '玩家') + ': ' + str(message.text)
    }).join('\n')
    const recentText = recent + '\n' + str(input.userText).trim()
    if (entries.length > 3) {
      try {
        const raw = await callModel({
          sessionId: input.sessionId || input.chat.sessionId,
          temperature: 0.1,
          maxTokens: 400,
          system: '你是世界书条目检索器。根据最近几轮剧情，从可用条目中选出本轮正文生成最需要注入的条目。只输出 JSON：{"ids":["条目ID"]}。最多选 3 个；只选与最近剧情直接相关的人物或设定；不相关就输出空数组。',
          messages: [{
            id: 'worldbook-select-' + now().toString(36),
            role: 'user',
            content: [{ type: 'text', text: '【最近剧情】\n' + (recent || '（只有开场白）') + '\n\n【玩家本轮输入】\n' + (str(input.userText).trim() || '（无）') + '\n\n【当前姿势】\n' + (input.chat.posture || '（无）') + '\n\n【可用条目】\n' + entries.map(function (entry) { return '[' + entry.id + '] keys: ' + entry.keys + '\n' + str(entry.text).slice(0, 160) }).join('\n\n') }],
            source: { kind: 'plugin', plugin: 'dsh-tavern-worldbook' }
          }]
        })
        const parsed = parseJsonLenient(raw)
        const validIds = new Set(entries.map(function (entry) { return entry.id }))
        selectedIds = (Array.isArray(parsed.ids) ? parsed.ids : []).map(function (id) { return str(id).trim() }).filter(function (id) { return validIds.has(id) }).slice(0, 3)
      } catch (error) {
        warnings.push({ code: 'WORLD_BOOK_MODEL_FAILED', message: str(error && error.message || error) })
        if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 世界书条目检索失败，本轮使用确定性回退', str(error && error.message || error))
        selectedIds = []
      }
      if (selectedIds.length === 0) {
        const matched = []
        for (const entry of entries) {
          const keys = str(entry.keys).split(',')
          if (keys.some(function (keyText) { const key = keyText.trim(); return key !== '' && recentText.includes(key) })) matched.push(entry.id)
          if (matched.length >= 3) break
        }
        selectedIds = matched
      }
    }
    if (selectionCache.size > 200) selectionCache.delete(selectionCache.keys().next().value)
    selectionCache.set(key, selectedIds)
    return selectedIds
  }

  function cardSections(input) {
    const sections = []
    const entries = worldBookEntries(input.card)
    const selectedIds = Array.isArray(input.worldBookIds) ? input.worldBookIds : []
    const selected = entries.filter(function (entry) { return entry.constant === true || selectedIds.includes(entry.id) })
    if (selected.length > 0) {
      sections.push({ kind: 'world-book', required: false, text: '【世界设定】\n' + selected.map(function (entry) { return renderCardText('[' + entry.keys + '] ' + entry.text, input.card) }).join('\n') })
    }
    if (str(input.chat.posture) !== '') sections.push({ kind: 'posture', required: true, text: '【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + input.chat.posture })
    const guides = Array.isArray(input.chat.guides) ? input.chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    if (guides.length > 0) sections.push({ kind: 'guide', required: true, text: '【用户指导 Guide · 优先遵循】\n' + guides.map(function (item, index) { return (index + 1) + '. ' + str(item.text).trim() }).join('\n') })
    sections.push({ kind: 'card', required: true, text: '【故事设定 · 人物卡】\n名字: ' + str(input.card.name) })
    if (input.includeDetails === true) {
      if (str(input.card.description) !== '') sections.push({ kind: 'card', required: false, text: '设定: ' + renderCardText(input.card.description, input.card) })
      if (str(input.card.personality) !== '') sections.push({ kind: 'card', required: false, text: '主要人物性格: ' + renderCardText(input.card.personality, input.card) })
      if (str(input.card.scenario) !== '') sections.push({ kind: 'card', required: false, text: '开场情境: ' + renderCardText(input.card.scenario, input.card) })
      if (str(input.card.mes_example) !== '') sections.push({ kind: 'card', required: false, text: '【文风示例】\n' + renderCardText(input.card.mes_example, input.card) })
    }
    if (input.includeInstructions !== false) {
      if (str(input.card.post_history_instructions) !== '') sections.push({ kind: 'card-instruction', required: true, text: '【附加要求】\n' + renderCardText(input.card.post_history_instructions, input.card) })
      if (str(input.card.system_prompt) !== '') sections.push({ kind: 'card-instruction', required: true, text: '【特殊指令】\n' + renderCardText(input.card.system_prompt, input.card) })
    }
    return sections
  }

  function resultOf(sections, warnings, omitted = []) {
    const text = sections.map(function (section) { return section.text }).filter(Boolean).join('\n\n')
    return {
      text,
      audit: {
        included: sections.map(function (section) { return { kind: section.kind, chars: section.text.length, required: section.required === true } }),
        omitted,
        warnings,
        totalChars: text.length
      }
    }
  }

  async function plan(input) {
    const warnings = []
    if (input.purpose === 'body') {
      const selectedIds = await selectWorldBookEntries(input, warnings)
      const sections = [{
        kind: 'base', required: true,
        text: '你是小说续写引擎，只输出小说正文，不要解释、点评或元信息；长度由剧情自然决定。\n1. "你"是玩家角色；除玩家外，所有角色都由你叙述和扮演。\n2. 用户最新消息是导演指令：无标记=人物行为（动作、心理、对白）；「场景变化」=可以结束当前场景，也可以直接开启新场景；如果是新场景提要，要把它展开成完整场景，不能当成已发生，也不能跳过。玩家不是上帝：其他角色可以按人设拒绝、反对、打断玩家行动，不必百依百顺。\n3. 用户指令只是大致引导，不是要接续的原文，也不是已发生事实：先承接上一段和当前现场，让情节自然推进，在过程中完成指令要表达的意思；指令原文可以改写、拆散、融入叙述，不要整句直接复制。同一动作/台词只演一次，完成后可继续自然发展。\n4. 文风参照【文风示例】（若有）；与【现场】冲突时以【现场】为准。'
      }]
      const hasStoryTurn = (input.chat.messages || []).some(function (message) { return message !== null && typeof message === 'object' && message.greeting !== true })
      sections.push.apply(sections, cardSections({ card: input.card, chat: input.chat, worldBookIds: selectedIds, includeDetails: !hasStoryTurn, includeInstructions: true }))
      if (input.scriptReference !== null && input.scriptReference !== undefined && str(input.scriptReference.text) !== '') {
        sections.push({ kind: 'script', required: true, text: '【本轮剧本参考 · 仅本轮注入一次】\n' + input.scriptReference.text })
        sections.push({ kind: 'script', required: true, text: '【剧本模式 · 成稿要求】\n你正在写正文，直接写出成稿：内容与形式一次到位，删除重复、理顺叙述顺序、补足过渡、润色遣词造句，不要留下粗糙痕迹。剧本是本轮剧情主线：先分析本块内容，必要时用 tavern_session action=script 前瞻后续分块、了解剧情走向，然后尽量贴合剧本发展——把本块中的事件、对白、人物反应、转折尽量演出；允许照抄剧本原文，也允许自由发挥。玩家指令是承接方式：从上一段结尾和玩家本轮行动自然进入剧本剧情；指令与剧本冲突时以剧本走向为主，把玩家动作自然融入。优先保住剧本内容，不要为通顺牺牲剧本，也不要重复上一段已发生的情节。' })
      }
      return resultOf(sections, warnings, hasStoryTurn ? [{ kind: 'card-details', reason: '仅首轮注入完整人物卡细节' }] : [])
    }

    if (input.purpose === 'candidate') {
      const sections = [{ kind: 'candidate-task', required: true, text: str(input.task) }]
      sections.push.apply(sections, cardSections({ card: input.card, chat: input.chat, worldBookIds: [], includeDetails: true, includeInstructions: false }))
      if (input.scriptWindow !== null && input.scriptWindow !== undefined) {
        const window = input.scriptWindow
        sections.push({
          kind: 'script', required: true,
          text: '【剧本候选参考 · 游标 ' + Math.min(window.cursor + 1, window.total) + ' / ' + window.total + '】\n' + (window.ended
            ? '剧本已到结尾。按最近剧情自然收束，或给出一个新场景开头候选。'
            : window.chunks.map(function (chunk) { return '[' + chunk.id + ']\n' + chunk.text }).join('\n\n'))
        })
      }
      return resultOf(sections, warnings, [{ kind: 'card-instruction', reason: '候选项不需要正文特殊指令' }])
    }

    if (input.purpose === 'revision') {
      const card = input.card || {}
      const editable = {
        name: card.name || '', description: card.description || '', personality: card.personality || '', scenario: card.scenario || '', first_mes: card.first_mes || '',
        mes_example: card.mes_example || '', system_prompt: card.system_prompt || '', post_history_instructions: card.post_history_instructions || '', creator_notes: card.creator_notes || '',
        tags: card.tags || [], alternate_greetings: card.alternate_greetings || [], character_book: card.character_book || null
      }
      const scriptInfo = input.scriptInfo
      const scriptHint = scriptInfo === null || scriptInfo === undefined
        ? '\n\n本卡未绑定剧本。'
        : '\n\n本卡已绑定剧本《' + scriptInfo.title + '》，共 ' + scriptInfo.chunkCount + ' 块。如需查看剧本原文，调用 tavern_session action=script：scriptQuery 传关键词检索，或 scriptOffset 传 1 起始的块号，scriptLimit 控制每次读取 1~6 块；不要仅凭文件名猜测剧本内容。'
      return resultOf([{ kind: 'card-revision', required: true, text: '你正在卡片模式的人物卡设定对话中，与用户共同讨论和修正人物卡，不进行角色扮演，不续写剧情。可以分析、追问、提出多个方案。只有用户明确要求或确认修改时才生成最小 cardPatch；只讨论时 cardPatch 必须是 {}。可修改字段：name,description,personality,scenario,first_mes,mes_example,system_prompt,post_history_instructions,creator_notes,tags,alternate_greetings,character_book。保留 {{char}}、{{user}} 模板变量。\n\n当前人物卡（未列出的字段为空）：\n' + promptObjectText(editable) + scriptHint }], warnings)
    }

    if (input.purpose === 'extract') {
      const chat = input.chat || {}
      const prepared = input.extractPrepared
      const extract = chat.extract || {}
      const draft = extract.draft || {}
      const player = str(extract.player)
      const sections = []
      sections.push({ kind: 'extract-task', required: true, text: '你在酒馆的卡片模式（素材抽取）中：根据给定的剧本/小说素材，与用户讨论并提炼出一张新的人物卡。你不续写剧情、不进行角色扮演。' })
      sections.push({ kind: 'extract-schema', required: true, text: '【人物卡可提炼字段】name（角色名）、description（角色描述：身份、外貌、背景）、personality（性格）、scenario（开场情境）、first_mes（开场白，写第一幕）、mes_example（对话示例，<START> 分隔，用 {{char}}/{{user}} 模板）、system_prompt、post_history_instructions、tags（字符串数组）。' })
      sections.push({ kind: 'extract-player', required: true, text: '【玩家身份（{{user}}）】\n' + (player !== '' ? player + '\n已确认。mes_example、scenario、first_mes 中的 {{user}} 一律指这个身份；玩家行动和正文中的“你”也指这个身份。若用户要求修改玩家，确认后在 commit 的 cardPatch 中输出 {"player":"新的身份"}。' : '尚未确认，这是当前最优先事项：先在对话中请用户确认准备提炼谁，以及谁是玩家（{{user}}）。得到确认后，在 commit 的 cardPatch 中输出 {"player":"玩家身份"}。') })
      sections.push({ kind: 'extract-rules', required: true, text: '【规则】\n1. 只依据素材与对话中已确认的信息写卡，素材不足时向用户提问或给多个方案。\n2. 人物卡是 {{char}} 的卡：角色字段一律用第三人称，禁止写“你是{{char}}”；{{user}} 才是玩家。\n3. 每轮可以讨论、提问或给出草稿片段；只有用户明确确认修改时，才在 commit 时输出最小 cardPatch；只讨论时 cardPatch 必须是 {}。\n4. 素材按游标分批注入，未读部分会在后续轮次继续注入。' })
      sections.push({ kind: 'extract-draft', required: true, text: '【当前草稿】\n' + promptObjectText(draft) })
      if (prepared !== null && typeof prepared === 'object' && Array.isArray(prepared.window) && prepared.window.length > 0) {
        sections.push({ kind: 'extract-source', required: true, text: '【本轮素材 · 第 ' + (Number(prepared.cursorBefore) + 1) + '~' + (Number(prepared.cursorBefore) + prepared.window.length) + ' 块 / 共 ' + prepared.total + ' 块】\n' + prepared.window.map(function (chunk) { return '[' + chunk.title + '] ' + chunk.text }).join('\n\n') })
      } else {
        sections.push({ kind: 'extract-source', required: true, text: '【素材】全部素材已注入完毕（共 ' + (prepared !== null && typeof prepared === 'object' ? prepared.total : 0) + ' 块），可以定稿。' })
      }
      return resultOf(sections, warnings)
    }

    throw new Error('未知上下文用途: ' + str(input.purpose))
  }

  return Object.freeze({ plan })
}
