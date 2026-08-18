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

function worldBookOverviewText(overview) {
  if (overview === null || typeof overview !== 'object') return '【世界书目录】\n无'
  const entries = Array.isArray(overview.entries) ? overview.entries : []
  const lines = ['【世界书目录 · 《' + (str(overview.name) || '未命名') + '》· ' + (Number(overview.entryCount) || entries.length) + ' 条】']
  if (entries.length === 0) lines.push('无条目')
  for (const entry of entries) {
    const labels = []
    labels.push(entry.enabled === false ? '停用' : '启用')
    labels.push(entry.constant === true ? '常驻' : '按需')
    const identity = Array.isArray(entry.keys) && entry.keys.length > 0 ? entry.keys.join('、') : (str(entry.comment) || '无关键词')
    lines.push('[' + str(entry.ref) + '] ' + labels.join('、') + '｜' + identity + '｜' + (Number(entry.chars) || 0) + ' 字')
  }
  return lines.join('\n')
}

export function createContextPlanner(options = {}) {
  if (typeof options.prompt !== 'function') throw new Error('缺少提示词目录')
  const prompt = options.prompt
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
          system: prompt('worldbook-selector'),
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
    const guides = Array.isArray(input.chat.guides) ? input.chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    const guideSection = guides.length > 0 ? { kind: 'guide', required: true, text: '【用户指导 Guide · 优先遵循】\n' + guides.map(function (item, index) { return (index + 1) + '. ' + str(item.text).trim() }).join('\n') } : null
    const postureSection = str(input.chat.posture) !== '' ? { kind: 'posture', required: true, text: '【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + input.chat.posture } : null
    if (input.stableFirst === true) {
      if (guideSection !== null) sections.push(guideSection)
      if (postureSection !== null) sections.push(postureSection)
    } else {
      if (postureSection !== null) sections.push(postureSection)
      if (guideSection !== null) sections.push(guideSection)
    }
    if (input.includeName !== false) sections.push({ kind: 'card', required: true, text: '【故事设定 · 人物卡】\n名字: ' + str(input.card.name) })
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
        text: prompt('story')
      }]
      const hasStoryTurn = (input.chat.messages || []).some(function (message) { return message !== null && typeof message === 'object' && message.greeting !== true })
      sections.push.apply(sections, cardSections({ card: input.card, chat: input.chat, worldBookIds: selectedIds, includeName: false, includeDetails: !hasStoryTurn, includeInstructions: true }))
      if (input.scriptReference !== null && input.scriptReference !== undefined && str(input.scriptReference.text) !== '') {
        const order = Number(input.scriptReference.order)
        const position = Number.isInteger(order) && order >= 0 ? ' · 第 ' + (order + 1) + ' 块' : ''
        sections.push({ kind: 'script', required: true, text: '【本轮剧本参考' + position + '】\n' + input.scriptReference.text })
        sections.push({ kind: 'script', required: true, text: prompt('script-story') })
      }
      return resultOf(sections, warnings, hasStoryTurn ? [{ kind: 'card-details', reason: '仅首轮注入完整人物卡细节' }] : [])
    }

    if (input.purpose === 'candidate') {
      const sections = [{ kind: 'candidate-task', required: true, text: str(input.task) }]
      sections.push.apply(sections, cardSections({ card: input.card, chat: input.chat, worldBookIds: [], includeName: false, includeDetails: false, includeInstructions: false, stableFirst: true }))
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
        tags: card.tags || [], alternate_greetings: card.alternate_greetings || []
      }
      const scriptInfo = input.scriptInfo
      const scriptHint = scriptInfo === null || scriptInfo === undefined
        ? ''
        : '\n\n本卡已绑定剧本《' + scriptInfo.title + '》，共 ' + scriptInfo.chunkCount + ' 块；需要核对内容时可调用 tavern_read_script。'
      return resultOf([
        { kind: 'card-revision', required: true, text: prompt('card-editor') + '\n' + promptObjectText(editable) + scriptHint },
        { kind: 'world-book-overview', required: false, text: worldBookOverviewText(input.worldBookOverview) + '\n需要查看世界书正文时调用 tavern_read_worldbook。确认修改时调用 tavern_update_card，并在 worldBook 数组中提交逐条操作；不要在 fields 中重传整本世界书。支持 update、add、delete、rename。' }
      ], warnings)
    }

    if (input.purpose === 'extract') {
      const chat = input.chat || {}
      const prepared = input.extractPrepared
      const extract = chat.extract || {}
      const draft = extract.draft || {}
      const player = str(extract.player)
      const sections = []
      sections.push({ kind: 'extract-rules', required: true, text: prompt('card-extractor') })
      sections.push({ kind: 'extract-player', required: true, text: '【玩家身份（{{user}}）】\n' + (player !== '' ? player + '\n已确认。mes_example、scenario、first_mes 中的 {{user}} 一律指这个身份；玩家行动和正文中的“你”也指这个身份。若用户要求修改玩家，确认后调用 tavern_update_card，并在 fields 中提交 {"player":"新的身份"}。' : '尚未确认，这是当前最优先事项：先在对话中请用户确认准备提炼谁，以及谁是玩家（{{user}}）。得到确认后调用 tavern_update_card，并在 fields 中提交 {"player":"玩家身份"}。') })
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
