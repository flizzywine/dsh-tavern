import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// 模型工具：读取并提交 Tavern 会话状态
export function apply(ctx) {
  const fs = ctx.get('fs')
  const llm = ctx.get('llm')
  if (fs === undefined || llm === undefined) {
    console.error('dsh-tavern: 缺少 fs 或 llm 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const sandboxPolicy = ctx.get('sandboxPolicy')

  const base = (sandboxPolicy !== undefined && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot.length > 0)
    ? sandboxPolicy.workspaceRoot.replace(/\/+$/, '') + '/dsh-tavern'
    : 'dsh-tavern'

  // ---------- profile 私有 preset ----------
  // rc.6 启动器会固定系统 roots，因此在独立 Tavern 进程内追加 profile 自带目录。
  // 不写入全局 `.agent-presets`，避免 Tavern 出现在普通 Web profile 的模式列表。
  const agentPresetsProxy = ctx.get('agentPresets')
  if (agentPresetsProxy === undefined) throw new Error('dsh-tavern: 缺少 agentPresets 服务')
  const agentPresets = agentPresetsProxy[Symbol.for('cordis.original')] || agentPresetsProxy
  const presetSourceDir = fileURLToPath(new URL('../../presets/', import.meta.url))
  if (!agentPresets.resolvedRoots.some(function (root) { return root.path === presetSourceDir })) {
    agentPresets.resolvedRoots.unshift({ path: presetSourceDir, trust: 'user' })
  }

  // ---------- 基础工具 ----------
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
  function str(v) {
    return typeof v === 'string' ? v : (v === undefined || v === null ? '' : String(v))
  }
  function clampInt(v, min, max, def) {
    return Number.isInteger(v) && v >= min && v <= max ? v : def
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }
  async function readJson(rel) {
    const t = await fs.resolve(base + '/' + rel)
    const info = await fs.stat(t)
    if (info === undefined) return undefined
    return JSON.parse(await fs.readText(t))
  }
  async function writeJson(rel, value) {
    const t = await fs.resolve(base + '/' + rel)
    await fs.writeText(t, JSON.stringify(value, null, 2))
  }
  async function rmFile(rel) {
    const shell = ctx.get('shell')
    if (shell === undefined) return
    try {
      const spec = shell.resolve({ command: 'rm -f ' + JSON.stringify(base + '/' + rel), timeoutMs: 10000 })
      await shell.run(spec)
    } catch (err) {
      console.error('dsh-tavern: rm 失败', err)
    }
  }
  function groupOfMode(mode) {
    const m = mode || 'story'
    return m === 'story' || m === 'script' ? 'play' : 'card'
  }
  function substChar(text, card, userLabel, charLabel) {
    const u = userLabel === undefined ? '用户' : userLabel
    const c = charLabel === undefined ? str(card.name) : charLabel
    return str(text).split('{{char}}').join(c).split('{{user}}').join(u)
  }

  // ---------- 设置 ----------
  let settings = { temperature: 1.0, provider: '', model: '', polish: false, candidates: 3 }
  let settingsReady = null
  const settlementJobs = new Set()
  async function loadSettings() {
    const s = await readJson('settings.json')
    if (s !== undefined && typeof s === 'object') {
      settings.temperature = typeof s.temperature === 'number' && isFinite(s.temperature) ? Math.min(1.5, Math.max(0, s.temperature)) : settings.temperature
      settings.provider = str(s.provider)
      settings.model = str(s.model)
      settings.polish = s.polish === true
      settings.candidates = clampInt(Number(s.candidates), 1, 5, 3)
    }
  }
  function ensureSettings() {
    if (settingsReady === null) settingsReady = loadSettings()
    return settingsReady
  }

  // ---------- 模型调用 ----------
  function modelSelection(sessionId) {
    if (settings.provider !== '' && settings.model !== '') return { provider: settings.provider, model: settings.model }
    // 会话级选择优先：与官方 api-proxy 相同的读取路径
    if (typeof sessionId === 'string' && sessionId !== '') {
      try {
        const agents = ctx.get('agents')
        const agent = agents !== undefined ? agents.get(sessionId) : undefined
        if (agent !== undefined && agent.session !== undefined && typeof agent.session.requestHeader === 'function') {
          const cfg = agent.session.requestHeader()?.config
          if (cfg !== undefined && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
            return { provider: cfg.provider, model: cfg.model, ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }) }
          }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取会话模型失败', err)
      }
    }
    if (agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel !== null && typeof sel === 'object' && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          return { provider: sel.provider, model: sel.model }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取默认模型失败', err)
      }
    }
    return null
  }
  async function callModel(opts) {
    const sel = modelSelection(opts.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置（可在设置中指定 provider/model）')
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    // Codex Responses API 不接受 temperature；其他模型仍保留候选温度阶梯。
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    const prepared = await llm.prepareCall(cfg)
    const options = Object.assign({}, prepared.config, { messages: opts.messages, system: opts.system })
    let text = ''
    let finish = null
    try {
      for await (const chunk of prepared.stream(options)) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (err) {
      throw new Error('模型流失败: ' + (err && (err.message || err.code) || err))
    }
    if (finish !== null && finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
      const f = finish.failure
      throw new Error('模型调用失败: ' + (f !== undefined && f !== null ? (f.message || f.code) : finish.kind))
    }
    const out = text.trim()
    if (out === '') throw new Error('模型返回为空')
    return out
  }
  async function callModelWithTool(opts) {
    const sel = modelSelection(opts.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    let messages = opts.messages.slice()
    let lastText = ''
    for (let round = 0; round < 10; round++) {
      const prepared = await llm.prepareCall(cfg)
      const options = Object.assign({}, prepared.config, { messages: messages, system: opts.system, tools: opts.tools })
      let text = ''
      let finish = null
      const blocks = []
      try {
        for await (const chunk of prepared.stream(options)) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'block-end') blocks.push(chunk.block)
          else if (chunk.type === 'finish') finish = chunk.reason
        }
      } catch (err) {
        throw new Error('模型流失败: ' + (err && (err.message || err.code) || err))
      }
      if (finish !== null && finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
        const f = finish.failure
        throw new Error('模型调用失败: ' + (f !== undefined && f !== null ? (f.message || f.code) : finish.kind))
      }
      const calls = blocks.filter(function (block) { return block !== null && typeof block === 'object' && block.type === 'tool-call' })
      if (calls.length === 0) {
        const out = text.trim()
        if (out === '') throw new Error('模型返回为空')
        return out
      }
      lastText = text
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: calls.map(function (call) { return { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments } }),
        source: { kind: 'model', provider: sel.provider, model: sel.model }
      })
      for (const call of calls) {
        let resultText = ''
        try {
          resultText = str(await opts.onToolCall(call))
        } catch (err) {
          resultText = '工具执行失败: ' + str(err && err.message || err)
        }
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: call.id, content: [{ type: 'text', text: resultText }], isError: false }],
          source: { kind: 'tool', callId: call.id }
        })
      }
    }
    const fallback = lastText.trim()
    if (fallback !== '') return fallback
    throw new Error('工具调用轮次过多')
  }

  // ---------- 角色卡 ----------
  function splitNovelText(source, requestedSize) {
    const target = clampInt(requestedSize, 300, 800, 500)
    const minSize = Math.max(220, Math.floor(target * 0.7))
    const maxSize = Math.min(1000, Math.floor(target * 1.4))
    const text = str(source).replace(/\r\n?/g, '\n').trim()
    if (text === '') return []
    const units = []
    for (const paragraph of text.split(/\n+/).map(function (item) { return item.trim() }).filter(Boolean)) {
      if (paragraph.length <= maxSize) {
        units.push(paragraph)
        continue
      }
      let rest = paragraph
      while (rest.length > maxSize) {
        let cut = -1
        const lower = Math.max(minSize, target - 120)
        const upper = Math.min(rest.length, maxSize)
        for (let i = upper; i >= lower; i--) {
          if ('。！？；…!?;'.includes(rest[i - 1])) { cut = i; break }
        }
        if (cut < 0) cut = Math.min(target, rest.length)
        units.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest !== '') units.push(rest)
    }
    const packed = []
    let current = ''
    for (const unit of units) {
      if (current !== '' && current.length + 1 + unit.length > maxSize) {
        packed.push(current)
        current = ''
      }
      current = current === '' ? unit : current + '\n' + unit
      if (current.length >= target && current.length >= minSize) {
        packed.push(current)
        current = ''
      }
    }
    if (current !== '') {
      if (packed.length > 0 && current.length < Math.floor(minSize / 2) && packed[packed.length - 1].length + 1 + current.length <= maxSize) packed[packed.length - 1] += '\n' + current
      else packed.push(current)
    }
    return packed.map(function (text, index) { return { id: 'chunk-' + String(index + 1).padStart(5, '0'), order: index, text: text } })
  }
  function normalizeCard(raw) {
    const data = (raw !== null && typeof raw === 'object' && raw.data !== null && typeof raw.data === 'object') ? raw.data : raw
    const cb = (data !== null && typeof data === 'object' && data.character_book !== null && typeof data.character_book === 'object')
      ? data.character_book
      : (raw !== null && typeof raw === 'object' && raw.character_book !== null && typeof raw.character_book === 'object' ? raw.character_book : null)
    return {
      id: uid('card'),
      name: str(data.name) || '未命名角色',
      description: str(data.description),
      personality: str(data.personality),
      scenario: str(data.scenario),
      first_mes: str(data.first_mes),
      mes_example: str(data.mes_example),
      system_prompt: str(data.system_prompt),
      post_history_instructions: str(data.post_history_instructions),
      alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(str).filter(function (x) { return x !== '' }) : [],
      creator_notes: str(data.creator_notes),
      tags: Array.isArray(data.tags) ? data.tags.map(str).filter(function (x) { return x !== '' }) : [],
      character_book: cb,
      spec: str(raw !== null && typeof raw === 'object' ? raw.spec : ''),
      importedAt: Date.now()
    }
  }
  async function readIndex() {
    const idx = await readJson('index.json')
    return (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
  }
  async function writeIndex(idx) { await writeJson('index.json', idx) }
  async function readCard(cardId) { return await readJson('cards/' + cardId + '.json') }
  async function readScript(cardId) { return await readJson('scripts/' + cardId + '.json') }
  async function ensureDataDir(name) {
    const target = await fs.resolve(base + '/' + name)
    const info = await fs.stat(target)
    if (info !== undefined) return
    const shell = ctx.get('shell')
    if (shell === undefined) throw new Error('无法创建数据目录: ' + name)
    const spec = shell.resolve({ command: 'mkdir -p ' + JSON.stringify(base + '/' + name), timeoutMs: 10000 })
    await shell.run(spec)
  }
  async function writeScript(cardId, value) {
    await ensureDataDir('scripts')
    await writeJson('scripts/' + cardId + '.json', value)
  }
  async function importScript(cardId, payload) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    const source = str(payload && payload.text).replace(/\r\n?/g, '\n').trim()
    if (source === '') throw new Error('剧本文件为空')
    const chunkSize = clampInt(Number(payload && payload.chunkSize), 300, 800, 500)
    const chunks = splitNovelText(source, chunkSize)
    if (chunks.length === 0) throw new Error('剧本无法分块')
    const script = {
      cardId: cardId,
      title: str(payload && payload.name).trim() || card.name + '剧本',
      sourceChars: source.length,
      chunkSize: chunkSize,
      chunks: chunks,
      importedAt: Date.now()
    }
    await writeScript(cardId, script)
    const info = { cardId: cardId, title: script.title, sourceChars: script.sourceChars, chunkSize: chunkSize, chunkCount: chunks.length, importedAt: script.importedAt }
    const idx = await readIndex()
    idx.cards = (idx.cards || []).map(function (item) { return item.id === cardId ? Object.assign({}, item, { script: info }) : item })
    await writeIndex(idx)
    return info
  }
  async function deleteScript(cardId) {
    await rmFile('scripts/' + cardId + '.json')
    const idx = await readIndex()
    idx.cards = (idx.cards || []).map(function (item) {
      if (item.id !== cardId) return item
      const next = Object.assign({}, item)
      delete next.script
      return next
    })
    await writeIndex(idx)
    return { deleted: true }
  }
  function compactScriptInfo(script) {
    if (script === undefined) return null
    return {
      title: script.title || '未命名剧本',
      sourceChars: Number(script.sourceChars) || 0,
      chunkSize: Number(script.chunkSize) || 500,
      chunkCount: Array.isArray(script.chunks) ? script.chunks.length : 0,
      importedAt: Number(script.importedAt) || 0
    }
  }
  function scriptReadWindow(script, query, offset, limit) {
    const chunks = Array.isArray(script.chunks) ? script.chunks : []
    const total = chunks.length
    if (total === 0) return { title: str(script.title), total: total, from: 0, to: 0, chunks: [] }
    const maxLimit = clampInt(limit, 1, 6, 3)
    const keyword = str(query).trim()
    if (keyword !== '') {
      for (let i = 0; i < chunks.length; i++) {
        if (str(chunks[i].text).indexOf(keyword) >= 0) {
          const from = Math.max(0, i - Math.floor((maxLimit - 1) / 2))
          const to = Math.min(total - 1, from + maxLimit - 1)
          const selected = chunks.slice(from, to + 1)
          return { title: str(script.title), total: total, from: from + 1, to: to + 1, chunks: selected, matchOrder: chunks[i].order }
        }
      }
      return { title: str(script.title), total: total, from: 0, to: 0, chunks: [], notFound: true }
    }
    const start = Math.max(0, clampInt(offset, 1, Math.max(1, total), 1) - 1)
    const end = Math.min(total, start + maxLimit)
    return { title: str(script.title), total: total, from: start + 1, to: end, chunks: chunks.slice(start, end) }
  }
  function scriptPlayWindow(script, chat, query, offset, limit) {
    const chunks = Array.isArray(script.chunks) ? script.chunks : []
    const total = chunks.length
    const state = chat.scriptState !== null && typeof chat.scriptState === 'object' ? chat.scriptState : {}
    const cursor = Math.max(0, Math.min(Math.max(0, total - 1), Number(state.cursor) || 0))
    if (total === 0) return { title: str(script.title), total: total, from: 0, to: 0, chunks: [], cursor: 0 }
    const radius = 10
    const windowFrom = Math.max(0, cursor - radius)
    const windowTo = Math.min(total - 1, cursor + radius)
    const keyword = str(query).trim()
    if (keyword !== '') {
      for (let i = windowFrom; i <= windowTo; i++) {
        if (str(chunks[i].text).indexOf(keyword) >= 0) {
          const hitFrom = Math.max(windowFrom, i - 1)
          const hitTo = Math.min(windowTo, i + 1)
          return {
            title: str(script.title),
            total: total,
            from: hitFrom + 1,
            to: hitTo + 1,
            chunks: chunks.slice(hitFrom, hitTo + 1),
            cursor: cursor + 1,
            matchOrder: chunks[i].order,
            windowFrom: windowFrom + 1,
            windowTo: windowTo + 1
          }
        }
      }
      return { title: str(script.title), total: total, from: 0, to: 0, chunks: [], cursor: cursor + 1, windowFrom: windowFrom + 1, windowTo: windowTo + 1, notFound: true }
    }
    const start = Math.max(0, Math.min(total - 1, offset === undefined || offset === null ? cursor : clampInt(offset, 1, total, 1) - 1))
    const maxLimit = clampInt(limit, 1, 21, 1)
    const end = Math.min(total - 1, start + maxLimit - 1)
    return {
      title: str(script.title),
      total: total,
      from: start + 1,
      to: end + 1,
      chunks: chunks.slice(start, end + 1),
      cursor: cursor + 1,
      windowFrom: windowFrom + 1,
      windowTo: windowTo + 1
    }
  }
  // ---------- 抽取素材（独立于人物卡的 txt/md 小说库） ----------
  async function readSource(sourceId) { return await readJson('sources/' + sourceId + '.json') }
  async function writeSource(sourceId, value) {
    await ensureDataDir('sources')
    await writeJson('sources/' + sourceId + '.json', value)
  }
  async function listSources() {
    const idx = await readIndex()
    return (idx.sources || []).map(function (item) { return Object.assign({}, item) })
  }
  async function importSource(payload) {
    const source = str(payload && payload.text).replace(/\r\n?/g, '\n').trim()
    if (source === '') throw new Error('素材文件为空')
    const chunkSize = clampInt(Number(payload && payload.chunkSize), 300, 800, 500)
    const chunks = splitNovelText(source, chunkSize)
    if (chunks.length === 0) throw new Error('素材无法分块')
    const record = {
      id: uid('src'),
      title: str(payload && payload.name).trim() || '未命名素材',
      sourceChars: source.length,
      chunkSize: chunkSize,
      chunks: chunks,
      importedAt: Date.now()
    }
    await writeSource(record.id, record)
    const idx = await readIndex()
    idx.sources = idx.sources || []
    idx.sources.push({ id: record.id, title: record.title, sourceChars: record.sourceChars, chunkCount: chunks.length, importedAt: record.importedAt })
    await writeIndex(idx)
    return { id: record.id, title: record.title, sourceChars: record.sourceChars, chunkCount: chunks.length, importedAt: record.importedAt }
  }
  async function deleteSource(sourceId) {
    await rmFile('sources/' + sourceId + '.json')
    const idx = await readIndex()
    idx.sources = (idx.sources || []).filter(function (item) { return item.id !== sourceId })
    await writeIndex(idx)
    return { deleted: true }
  }
  async function readChat(chatId) { return await readJson('chats/' + chatId + '.json') }
  async function writeChat(chat) {
    chat.updatedAt = Date.now()
    await writeJson('chats/' + chat.id + '.json', chat)
  }
  async function readChatCard(chat) {
    const card = await readCard(chat.cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + chat.cardId)
    return card
  }
  function parseImported(payload) {
    let text
    if (payload !== null && typeof payload === 'object' && payload.kind === 'png') {
      text = Buffer.from(String(payload.b64 || ''), 'base64').toString('utf8')
    } else if (payload !== null && typeof payload === 'object' && typeof payload.text === 'string') {
      text = payload.text
    } else {
      throw new Error('无法识别的导入数据')
    }
    let raw
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new Error('角色卡 JSON 解析失败: ' + (err && err.message || err))
    }
    if (raw === null || typeof raw !== 'object') throw new Error('角色卡格式错误')
    return normalizeCard(raw)
  }
  async function importCard(payload) {
    const card = parseImported(payload)
    await writeJson('cards/' + card.id + '.json', card)
    const idx = await readIndex()
    idx.cards = idx.cards || []
    idx.cards.push({ id: card.id, name: card.name, description: card.description, tags: card.tags, importedAt: card.importedAt })
    await writeIndex(idx)
    return { id: card.id, name: card.name, description: card.description, tags: card.tags }
  }
  async function createCard(source) {
    const card = normalizeCard(source && typeof source === 'object' ? source : { name: '新人物' })
    await writeJson('cards/' + card.id + '.json', card)
    const idx = await readIndex()
    idx.cards = idx.cards || []
    idx.cards.push({ id: card.id, name: card.name, description: card.description, tags: card.tags, importedAt: card.importedAt })
    await writeIndex(idx)
    return card
  }
  async function duplicateCard(cardId) {
    const source = await readCard(cardId)
    if (source === undefined) throw new Error('角色卡不存在: ' + cardId)
    const copy = Object.assign({}, source, { id: uid('card'), name: str(source.name) + '（副本）', importedAt: Date.now(), updatedAt: Date.now(), revision_history: [] })
    await writeJson('cards/' + copy.id + '.json', copy)
    const idx = await readIndex()
    idx.cards = idx.cards || []
    idx.cards.push({ id: copy.id, name: copy.name, description: copy.description, tags: copy.tags || [], importedAt: copy.importedAt })
    await writeIndex(idx)
    return copy
  }
  async function listCards() {
    const idx = await readIndex()
    return (idx.cards || []).map(function (item) { return Object.assign({}, item, { script: item.script || null }) })
  }
  const CARD_TEXT_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes']
  async function updateCard(cardId, patch, revision) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    const source = patch !== null && typeof patch === 'object' ? patch : {}
    for (const field of CARD_TEXT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, field)) card[field] = str(source[field])
    }
    if (Array.isArray(source.tags)) card.tags = source.tags.map(str).map(function (x) { return x.trim() }).filter(function (x) { return x !== '' }).slice(0, 30)
    if (Array.isArray(source.alternate_greetings)) card.alternate_greetings = source.alternate_greetings.map(str).map(function (x) { return x.trim() }).filter(function (x) { return x !== '' }).slice(0, 20)
    if (source.character_book !== undefined && (source.character_book === null || typeof source.character_book === 'object')) card.character_book = source.character_book
    card.name = str(card.name).trim() || '未命名角色'
    card.updatedAt = Date.now()
    if (revision !== undefined && revision !== null) {
      card.revision_history = Array.isArray(card.revision_history) ? card.revision_history : []
      card.revision_history.push(revision)
      card.revision_history = card.revision_history.slice(-30)
    }
    await writeJson('cards/' + card.id + '.json', card)
    const idx = await readIndex()
    idx.cards = (idx.cards || []).map(function (item) {
      return item.id === card.id ? Object.assign({}, item, { name: card.name, description: card.description, tags: card.tags, updatedAt: card.updatedAt }) : item
    })
    idx.chats = (idx.chats || []).map(function (item) { return item.cardId === card.id ? Object.assign({}, item, { cardName: card.name }) : item })
    await writeIndex(idx)
    for (const item of (idx.chats || []).filter(function (entry) { return entry.cardId === card.id })) {
      const linked = await readChat(item.id)
      if (linked !== undefined && linked.cardName !== card.name) {
        linked.cardName = card.name
        await writeJson('chats/' + linked.id + '.json', linked)
      }
    }
    return card
  }
  async function reviseCard(cardId, instruction, sessionId) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    const request = str(instruction).trim()
    if (request === '') throw new Error('请输入想要调整的设定')
    const editable = {}
    for (const field of CARD_TEXT_FIELDS) editable[field] = card[field] || ''
    editable.tags = card.tags || []
    editable.alternate_greetings = card.alternate_greetings || []
    editable.character_book = card.character_book || null
    const history = (card.revision_chat || []).slice(-16)
    const messages = history.map(function (item, index) {
      return {
        id: 'card-revise-history-' + index,
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: str(item.text) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-card-studio' }
      }
    })
    messages.push({
      id: 'card-revise-' + Date.now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: request }],
      source: { kind: 'plugin', plugin: 'dsh-tavern-card-studio' }
    })
    const text = await callModel({
      sessionId: sessionId,
      temperature: 0.25,
      maxTokens: 10000,
      system: '你是与用户共同打磨人物卡的编辑助手，这是一场持续的多轮对话，不是角色扮演，也不推进任何剧情。当前人物卡：\n' + JSON.stringify(editable) + '\n\n你可以分析设定、追问意图、提出方案、比较取舍。只有当用户明确要求或确认具体修改时，才在 patch 中给出实际变更；如果仍在讨论，patch 必须为 {}。只输出 JSON：{"reply":"给用户的自然对话回复","summary":"本轮若有落盘修改则简述，否则为空","patch":{}}。patch 可用字段：name,description,personality,scenario,first_mes,mes_example,system_prompt,post_history_instructions,creator_notes,tags,alternate_greetings,character_book。保留 {{char}}、{{user}} 等模板变量，采用最小必要修改。',
      messages: messages
    })
    const result = parseJsonLenient(text)
    const cardPatch = result.patch !== null && typeof result.patch === 'object' ? result.patch : {}
    const changed = Object.keys(cardPatch).length > 0
    const summary = changed ? (str(result.summary).trim() || '已更新人物卡') : ''
    const reply = str(result.reply).trim() || (changed ? summary : '我们可以继续讨论这张人物卡的设定。')
    let saved = card
    if (changed) saved = await updateCard(cardId, cardPatch, { ts: Date.now(), instruction: request, summary: summary })
    saved = await readCard(cardId)
    saved.revision_chat = Array.isArray(saved.revision_chat) ? saved.revision_chat : []
    saved.revision_chat.push({ role: 'user', text: request, ts: Date.now() })
    saved.revision_chat.push({ role: 'assistant', text: reply, ts: Date.now(), changed: changed, summary: summary })
    saved.revision_chat = saved.revision_chat.slice(-60)
    saved.updatedAt = Date.now()
    await writeJson('cards/' + saved.id + '.json', saved)
    return { card: saved, reply: reply, changed: changed, summary: summary }
  }
  async function clearRevisionChat(cardId) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    card.revision_chat = []
    card.updatedAt = Date.now()
    await writeJson('cards/' + card.id + '.json', card)
    return card
  }
  async function deleteCard(cardId) {
    const idx = await readIndex()
    const dead = (idx.chats || []).filter(function (c) { return c.cardId === cardId })
    idx.cards = (idx.cards || []).filter(function (c) { return c.id !== cardId })
    idx.chats = (idx.chats || []).filter(function (c) { return c.cardId !== cardId })
    await writeIndex(idx)
    for (let i = 0; i < dead.length; i++) await rmFile('chats/' + dead[i].id + '.json')
    await rmFile('cards/' + cardId + '.json')
    await rmFile('scripts/' + cardId + '.json')
    return { deleted: true }
  }
  async function deleteChat(chatId) {
    const idx = await readIndex()
    idx.chats = (idx.chats || []).filter(function (c) { return c.id !== chatId })
    await writeIndex(idx)
    const map = await readSessionMap()
    let changed = false
    for (const key of Object.keys(map)) {
      if (map[key] === chatId) { delete map[key]; changed = true }
    }
    if (changed) await writeSessionMap(map)
    await rmFile('chats/' + chatId + '.json')
    return { deleted: true }
  }

  // ---------- 聊天 ----------
  function newChat(card, mode) {
    const chatMode = mode === 'revision' ? 'revision' : (mode === 'script' ? 'script' : (mode === 'extract' ? 'extract' : 'story'))
    return {
      id: uid('chat'),
      cardId: chatMode === 'extract' ? '' : card.id,
      cardName: chatMode === 'extract' ? '抽取中' : card.name,
      mode: chatMode,
      scriptState: chatMode === 'script' ? { cursor: 0, recalledChunkIds: [], skippedChunkIds: [], prepared: null, lastReference: null, totalChunks: 0, title: '', scriptVersion: 0 } : null,
      extract: chatMode === 'extract' ? { sourceIds: [], cursor: 0, prepared: null, done: false, player: '', draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', tags: [] } } : null,
      messages: [],
      posture: '',
      sessionId: '',
      lore: [],
      guides: [],
      pending: null,
      awaitingScene: false,
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
  async function readSessionMap() {
    const value = await readJson('sessions.json')
    return value !== undefined && value !== null && typeof value === 'object' ? value : {}
  }
  async function writeSessionMap(value) {
    await writeJson('sessions.json', value)
  }
  async function chatForSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const map = await readSessionMap()
    if (typeof map[sessionId] === 'string') {
      const mapped = await readChat(map[sessionId])
      if (mapped !== undefined) return mapped
      delete map[sessionId]
      await writeSessionMap(map)
    }
    const idx = await readIndex()
    for (const item of (idx.chats || [])) {
      const chat = await readChat(item.id)
      if (chat !== undefined && chat.sessionId === sessionId) {
        map[sessionId] = chat.id
        await writeSessionMap(map)
        return chat
      }
    }
    return undefined
  }
  function cardViewOf(card, chat) {
    if (card === null || card === undefined) {
      const draft = chat.extract && chat.extract.draft ? chat.extract.draft : {}
      return {
        id: '',
        name: str(draft.name) || '抽取中',
        description: str(draft.description),
        personality: str(draft.personality),
        scenario: str(draft.scenario),
        first_mes: str(draft.first_mes),
        mes_example: str(draft.mes_example),
        system_prompt: str(draft.system_prompt),
        post_history_instructions: str(draft.post_history_instructions),
        creator_notes: '',
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        alternate_greetings: [],
        character_book: null,
        opening: str(draft.first_mes),
        alternateGreetings: []
      }
    }
    return {
      id: card.id,
      name: card.name,
      description: card.description,
      personality: card.personality || '',
      scenario: card.scenario || '',
      first_mes: card.first_mes || '',
      mes_example: card.mes_example || '',
      system_prompt: card.system_prompt || '',
      post_history_instructions: card.post_history_instructions || '',
      creator_notes: card.creator_notes || '',
      tags: card.tags || [],
      alternate_greetings: card.alternate_greetings || [],
      character_book: card.character_book || null,
      opening: substChar(card.first_mes, card, '你', '所有其他角色'),
      alternateGreetings: (card.alternate_greetings || []).map(function (text) { return substChar(text, card, '你', '所有其他角色') })
    }
  }
  function view(chat, card) {
    const pendingView = (chat.pending !== null && chat.pending !== undefined)
      ? {
          userText: chat.pending.userText,
          candidates: (chat.pending.candidates || []).map(function (c, i) {
            return { index: i, text: c.text, error: c.error || null }
          })
        }
      : null
    return {
      chatId: chat.id,
      mode: chat.mode || 'story',
      group: groupOfMode(chat.mode),
      card: cardViewOf(card, chat),
      messages: chat.messages || [],
      posture: chat.posture || '',
      lore: chat.lore || [],
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      pending: pendingView,
      settleStatus: chat.settleStatus || 'idle',
      settleError: chat.settleError || null,
      lastSettle: chat.lastSettle || null,
      scriptProgress: chat.scriptState ? {
        cursor: Number(chat.scriptState.cursor) || 0,
        totalChunks: Number(chat.scriptState.totalChunks) || 0,
        recalledCount: Array.isArray(chat.scriptState.recalledChunkIds) ? chat.scriptState.recalledChunkIds.length : 0,
        skippedCount: Array.isArray(chat.scriptState.skippedChunkIds) ? chat.scriptState.skippedChunkIds.length : 0,
        title: str(chat.scriptState.title)
      } : null,
      updatedAt: chat.updatedAt || 0
    }
  }
  function revisionGreeting(cardName) {
    return '我们现在进入“' + cardName + '”的人物卡设定对话（卡片模式）。可以先讨论、分析或比较方案；只有你明确确认修改时，我才会把变更写入人物卡。你想先调整哪一部分？'
  }
  async function startChat(cardId, sessionId, mode) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    // 游玩模式内部仍是 story/script 两类：人物卡已绑定剧本时必须走剧本（script）。
    const script = await readScript(cardId)
    const hasScript = script !== undefined && Array.isArray(script.chunks) && script.chunks.length > 0
    let requestedMode = mode === 'revision' ? 'revision' : (mode === 'script' ? 'script' : (mode === 'story' ? 'story' : null))
    if (requestedMode === null || requestedMode === 'play') requestedMode = hasScript ? 'script' : 'story'
    if (requestedMode === 'script' && !hasScript) throw new Error('该人物卡尚未绑定剧本文件，请先在卡片模式绑定剧本')
    if (requestedMode === 'story' && hasScript) requestedMode = 'script'
    if (typeof sessionId === 'string' && sessionId !== '') {
      const current = await chatForSession(sessionId)
      // 同一大模式（游玩/卡片）内复用当前会话；旧的自由故事会话不会被强行切换成剧本。
      if (current !== undefined && current.cardId === cardId && groupOfMode(current.mode) === groupOfMode(requestedMode)) {
        await appendNativeOpening(sessionId, current, card)
        return view(current, card)
      }
    }
    const chat = newChat(card, requestedMode || 'story')
    if (chat.mode === 'script') {
      const scriptStart = Math.max(0, Math.min(script.chunks.length - 1, Number(card.script_start) || 0))
      chat.scriptState.totalChunks = script.chunks.length
      chat.scriptState.title = script.title || card.name + '剧本'
      chat.scriptState.scriptVersion = Number(script.importedAt) || 0
      chat.scriptState.initialCursor = scriptStart
      chat.scriptState.cursor = scriptStart
      for (let index = 0; index < scriptStart; index++) chat.scriptState.skippedChunkIds.push('chunk-' + String(index + 1).padStart(5, '0'))
    }
    if (typeof sessionId === 'string') chat.sessionId = sessionId
    const greeting = chat.mode === 'revision'
      ? revisionGreeting(card.name)
      : substChar(card.first_mes, card, '你', '所有其他角色')
    if (greeting !== '') chat.messages.push({ role: 'assistant', text: greeting, ts: Date.now(), greeting: true })
    await writeChat(chat)
    const idx = await readIndex()
    idx.chats = idx.chats || []
    idx.chats.push({ id: chat.id, cardId: card.id, cardName: card.name, updatedAt: chat.updatedAt })
    await writeIndex(idx)
    if (typeof sessionId === 'string' && sessionId !== '') {
      const map = await readSessionMap()
      map[sessionId] = chat.id
      await writeSessionMap(map)
      await appendNativeOpening(sessionId, chat, card)
    }
    return view(chat, card)
  }

  async function appendNativeOpening(sessionId, chat, card) {
    if (chat.nativeOpeningAppended === true) return
    const mode = chat.mode || 'story'
    let text
    if (mode === 'revision') {
      text = revisionGreeting(chat.cardName)
    } else if (mode === 'extract') {
      const first = Array.isArray(chat.messages) && chat.messages[0] ? chat.messages[0] : null
      text = first !== null && str(first.text) !== '' ? str(first.text) : '卡片模式 · 素材抽取：我会根据所选素材为你提炼人物卡。'
    } else {
      text = substChar(card.first_mes, card, '你', '所有其他角色')
    }
    if (text === '') return
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法写入 DSH 会话开场白: ' + sessionId)
    const selected = modelSelection(sessionId) || { provider: 'dsh-tavern', model: 'character-card' }
    const turn = 1
    const step = 1
    agent.session.append('turn/start', { turn: turn })
    agent.session.append('step/start', { turn: turn, step: step })
    const message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [{ type: 'text', text: text }],
      source: { kind: 'model', provider: selected.provider, model: selected.model }
    }
    agent.session.append('assistant/message', { turn: turn, step: step, message: message }, {
      surfaceOp: 'append',
      sourceEventSeqs: []
    })
    agent.session.append('step/end', { turn: turn, step: step })
    agent.session.append('turn/end', { turn: turn, reason: { kind: 'completed' } })
    // AgentLoop caches the last turn when it is constructed. Because this
    // greeting is appended externally, advance that idle cursor as well;
    // otherwise the first real prompt incorrectly opens another turn 1 and
    // the conversation fold overlays the reply on the greeting/user message.
    if (agent.phase !== undefined && agent.phase !== null && agent.phase.kind === 'idle') {
      agent.phase.lastTurn = Math.max(Number(agent.phase.lastTurn) || 0, turn)
    }
    chat.nativeOpeningAppended = true
    await writeChat(chat)
  }

  async function scriptPreviewOf(chat) {
    if ((chat.mode || 'story') !== 'script') return null
    const script = await readScript(chat.cardId)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    const state = chat.scriptState !== null && typeof chat.scriptState === 'object' ? chat.scriptState : {}
    const cursor = Math.max(0, Math.min(script.chunks.length, Number(state.cursor) || 0))
    const previous = state.lastReference !== null && typeof state.lastReference === 'object' && str(state.lastReference.text) !== ''
      ? { order: Number(state.lastReference.order) || 0, text: str(state.lastReference.text) }
      : null
    const upcoming = script.chunks.slice(cursor, cursor + 3).map(function (chunk) {
      return { order: Number(chunk.order) || 0, id: chunk.id, text: str(chunk.text) }
    })
    return {
      title: str(script.title),
      cursor: cursor,
      totalChunks: script.chunks.length,
      previous: previous,
      upcoming: upcoming
    }
  }
  async function sessionView(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const isExtract = (chat.mode || 'story') === 'extract'
    const card = isExtract ? null : await readChatCard(chat)
    const hasStory = Array.isArray(chat.messages) && chat.messages.length > 0
    const hasState = str(chat.posture) !== ''
    if ((chat.mode || 'story') === 'story' && hasStory && !hasState && (chat.settleStatus || 'idle') === 'idle' && !settlementJobs.has(chat.id)) {
      settlementJobs.add(chat.id)
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat)
      void runSettlement(chat.id).finally(function () { settlementJobs.delete(chat.id) })
    }
    const result = view(chat, card)
    if (isExtract) result.extract = await extractViewOf(chat)
    if ((chat.mode || 'story') === 'script') result.scriptPreview = await scriptPreviewOf(chat)
    return result
  }
  async function ensureNativeOpening(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const isExtract = (chat.mode || 'story') === 'extract'
    const card = isExtract ? null : await readChatCard(chat)
    await appendNativeOpening(sessionId, chat, card)
    const result = view(chat, card)
    if (isExtract) result.extract = await extractViewOf(chat)
    return result
  }
  async function chooseGreeting(chatId, index) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    const greetings = [card.first_mes].concat(card.alternate_greetings || []).map(function (text) {
      return substChar(text, card, '你', '所有其他角色')
    }).filter(function (text) { return text !== '' })
    const selected = greetings[clampInt(index, 0, greetings.length - 1, 0)]
    if (selected === undefined) throw new Error('人物卡没有可用开场白')
    const old = Array.isArray(chat.messages) ? chat.messages : []
    const rest = old.filter(function (message) { return message.greeting !== true })
    chat.messages = [{ role: 'assistant', text: selected, ts: Date.now(), greeting: true }].concat(rest)
    chat.updatedAt = Date.now()
    await writeChat(chat)
    return view(chat, card)
  }
  function scriptChoiceWindow(chat, script) {
    const state = chat.scriptState !== null && typeof chat.scriptState === 'object' ? chat.scriptState : {}
    const cursor = Math.max(0, Number(state.cursor) || 0)
    const chunks = Array.isArray(script.chunks) ? script.chunks : []
    const ended = cursor >= chunks.length
    return {
      cursor: cursor,
      total: chunks.length,
      ended: ended,
      title: str(script.title),
      chunks: ended ? [] : chunks.slice(cursor, Math.min(chunks.length, cursor + 2))
    }
  }
  function lastAssistantTail(chat, limit) {
    const msgs = chat.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        const text = str(m.text).trim()
        if (text !== '') return text.length > (limit || 180) ? text.slice(-(limit || 180)) : text
      }
    }
    return ''
  }
  async function generateChoices(sessionId, messageId, guidance) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'revision' || (chat.mode || 'story') === 'extract') throw new Error('卡片模式不生成剧情候选项')
    for (let i = 0; i < 40 && settlementJobs.has(chat.id); i++) await sleep(250)
    const card = await readChatCard(chat)
    const sel = modelSelection(sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    const scriptMode = (chat.mode || 'story') === 'script'
    let scriptWin = null
    let script = null
    if (scriptMode) {
      script = await readScript(chat.cardId)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      scriptWin = scriptChoiceWindow(chat, script)
    }
    const guide = str(guidance).trim().slice(0, 600)
    let task = ''
    let baseRequest = ''
    const latestTail = lastAssistantTail(chat, 180)
    if (scriptMode) {
      task = '你现在不是续写正文，而是为玩家生成唯一一个“剧本推荐”候选，并标记下一轮正文应重点参考的剧本位置。只输出 JSON：{"choices":[{"type":"action|scene","text":"选项内容"}],"scriptCursor":1}（scriptCursor 用实际块号）。必须恰好一个候选，不要输出多个。'
      task += 'type 二选一：action=人物行为（动作、心理、对白都可以）；scene=场景变化（可以结束当前场景，也可以直接开启新场景）。text 每项 10~80 字，不要提前描述行动结果。'
      task += '你已能看到上面的上下文：人物卡信息、现场姿势、世界设定与最近正文/玩家输入。先阅读给出的剧本分块，必要时用 tavern_script_peek 向前或向后查看剧本（最多调用 4 次，可用 scriptLimit 一次读多块），弄清接下来的剧情走向。'
      task += '这个候选是剧本路线的推荐：结合上下文与剧本，给出一个对剧情走向有意义的行动——它应推动剧情进入剧本中的下一处关键场面、冲突或转折，而不只是一个孤立动作；同时从【上一段正文结尾】自然接起，不重复已发生的动作。'
      task += 'scriptCursor 是游标：评估当前剧情实际进度，标记下一轮正文该重点看哪一块；保持当前游标、向前移动、向后移动都可以，给任意有效块号。'
      baseRequest = '根据当前剧情与剧本内容，给出唯一一个有剧情走向意义的剧本路线候选，并用 scriptCursor 标记下一轮正文应参考的剧本块。'
      if (latestTail !== '') baseRequest += '\n【上一段正文结尾】\n' + latestTail
    } else {
      task = '你现在不是续写正文，而是为玩家生成下一步候选。只输出 JSON：{"choices":[{"type":"action|scene","text":"选项内容"}]}。恰好五个选项：四个 type=action（人物行为，动作、心理、对白都可以，四个候选要各有侧重、彼此不重复），一个 type=scene（场景变化，可以结束当前场景，也可以直接开启新场景）。每项 10~80 字，不要提前描述行动结果。候选必须从上一段正文结尾自然接起，先补一小步承接，再进入候选内容，禁止直接跳到与上一段无关的新动作，也禁止重复上一段已经发生过的动作。'
      baseRequest = '根据当前剧情，生成五个下一步候选：四个人物行为，一个场景变化。'
      if (latestTail !== '') baseRequest += '\n【上一段正文结尾】\n' + latestTail
    }
    const requiredCount = scriptMode ? 1 : 5
    const taskSystem = task + (guide !== '' ? '\n\n【用户对候选项的额外要求 · 必须遵循，但仍要保证恰好 ' + requiredCount + ' 个候选且类型要求不变】\n' + guide : '')
    let system = buildSystem(card, chat)
    if (scriptMode) {
      system += '\n\n【剧本候选参考 · 游标 ' + Math.min(scriptWin.cursor + 1, scriptWin.total) + ' / ' + scriptWin.total + '】\n' + (scriptWin.ended
        ? '剧本已到结尾。按最近剧情自然收束，或给出一个新场景开头候选。'
        : scriptWin.chunks.map(function (chunk) { return '[' + chunk.id + ']\n' + chunk.text }).join('\n\n'))
    }
    system += '\n\n【额外任务】' + taskSystem
    const messages = buildMessages(chat, sel, 30).concat([{
      id: 'choices-' + Date.now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: baseRequest + (guide !== '' ? '\n用户对候选的额外要求：' + guide : '') }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' }
    }])
    let lastError = null
    let lastRaw = ''
    const maxChoices = requiredCount
    const temps = [0.8, 1.0, 1.1]
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise(function (resolve) { setTimeout(resolve, 800) })
      try {
        let peekCalls = 0
        const callOpts = {
          sessionId: sessionId,
          temperature: temps[(attempt - 1) % temps.length],
          maxTokens: 2400,
          system: system,
          messages: messages
        }
        const text = scriptMode
          ? await callModelWithTool(Object.assign({}, callOpts, {
              tools: [{
                name: 'tavern_script_peek',
                description: '只读查看剧本分块，可向前或向后看任意位置；默认读当前游标块，可用 scriptOffset 指定块号（1 起始）或 scriptQuery 检索关键词。最多调用 4 次，可用 scriptLimit 一次读多块。只返回文本，不推进游标。',
                parameters: {
                  type: 'object',
                  properties: {
                    scriptOffset: { type: 'number', description: '1 起始的块号，缺省当前游标' },
                    scriptLimit: { type: 'number', description: '连续读取 1~4 块，默认 1' },
                    scriptQuery: { type: 'string', description: '按关键词在剧本中检索' }
                  },
                  additionalProperties: false
                }
              }],
              onToolCall: async function (call) {
                peekCalls += 1
                if (peekCalls > 4) return 'peek 次数已用尽，请直接输出 JSON 结果，不要再调用工具。'
                const callArgs = parseJsonLenient(str(call.arguments))
                const limit = clampInt(Number(callArgs.scriptLimit), 1, 4, 1)
                const win = scriptReadWindow(script, callArgs.scriptQuery, callArgs.scriptOffset, limit)
                if (win.notFound === true) return '没有找到包含该关键词的剧本分块，可换关键词或用 scriptOffset 指定块号。'
                if (win.chunks.length === 0) return '没有可读的剧本分块。'
                return win.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + (Number(chunk.order) + 1) + ' 块]\n' + chunk.text }).join('\n\n')
              }
            }))
          : await callModel(callOpts)
        lastRaw = text
        const parsed = parseJsonLenient(text)
        let nextCursorRaw = Number(parsed !== null && typeof parsed === 'object' ? parsed.scriptCursor : NaN)
        if (!Number.isFinite(nextCursorRaw) || nextCursorRaw < 1) {
          const cursorMatch = /"scriptCursor"\s*:\s*(\d+)/.exec(text)
          if (cursorMatch !== null) nextCursorRaw = Number(cursorMatch[1])
        }
        let source = Array.isArray(parsed.choices) ? parsed.choices : (Array.isArray(parsed.options) ? parsed.options : [])
        if (source.length === 0) {
          const arrText = extractChoicesArray(text)
          if (arrText !== null) {
            try {
              const arr = JSON.parse(arrText)
              if (Array.isArray(arr)) source = arr
            } catch (err) {}
          }
        }
        // 模型偶发输出被 maxTokens 截断成不完整 JSON：直接从原文里把每个 choice 对象抠出来。
        if (source.length === 0) source = parseChoiceObjects(text)
        const choices = []
        for (let i = 0; i < source.length && choices.length < maxChoices; i++) {
          const item = source[i]
          const raw = typeof item === 'string' ? item : (item !== null && typeof item === 'object' ? str(item.text) : '')
          const content = raw.trim().slice(0, 120)
          if (content === '') continue
          let type = 'action'
          if (item !== null && typeof item === 'object') {
            const t = str(item.type).trim().toLowerCase()
            if (t === 'scene' || t === 'scene2' || t === 'newscene' || t === '场景' || t === '新场景' || t === '场景变化') type = 'scene'
          }
          choices.push({ type: type, text: content })
        }
        if (choices.length === 0) throw new Error('模型没有返回有效候选项')
        const latestChat = await readChat(chat.id)
        if (latestChat === undefined) throw new Error('聊天不存在: ' + chat.id)
        let adjustedCursor = scriptWin ? scriptWin.cursor : 0
        let adjustedEnded = scriptWin ? scriptWin.ended : false
        if (scriptMode && Number.isFinite(nextCursorRaw) && nextCursorRaw >= 1 && latestChat.scriptState !== null && typeof latestChat.scriptState === 'object') {
          const total = Math.max(1, Number(latestChat.scriptState.totalChunks) || Number(script.chunks.length) || 1)
          adjustedCursor = Math.max(0, Math.min(total - 1, Math.round(nextCursorRaw) - 1))
          adjustedEnded = adjustedCursor >= total
          latestChat.scriptState.cursor = adjustedCursor
        }
        latestChat.candidates = {
          messageId: str(messageId),
          choices: choices,
          generatedAt: Date.now(),
          script: scriptMode ? { cursor: adjustedCursor, ended: adjustedEnded } : undefined
        }
        await writeChat(latestChat)
        return latestChat.candidates
      } catch (err) {
        lastError = err
        console.error('dsh-tavern: 候选项生成第 ' + attempt + ' 次失败:', str(err && err.message || err))
        if (lastRaw !== '') console.error('dsh-tavern: 候选项原始输出:', lastRaw.slice(0, 1200))
      }
    }
    throw lastError || new Error('候选项生成失败')
  }
  async function getChoices(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined || chat.candidates === null || typeof chat.candidates !== 'object') return null
    const choices = Array.isArray(chat.candidates.choices) ? chat.candidates.choices.map(function (item) {
      if (item !== null && typeof item === 'object') {
        const type = item.type === 'scene' || item.type === 'scene2' ? 'scene' : 'action'
        return { type: type, text: str(item.text).trim() }
      }
      return { type: 'action', text: str(item).trim() }
    }).filter(function (item) { return item.text !== '' }).slice(0, 5) : []
    if (choices.length === 0) return null
    return {
      messageId: str(chat.candidates.messageId),
      choices: choices,
      generatedAt: Number(chat.candidates.generatedAt) || 0
    }
  }
  async function listTavernSessions() {
    const map = await readSessionMap()
    const rows = []
    for (const sessionId of Object.keys(map)) {
      const chat = await readChat(map[sessionId])
      if (chat === undefined) continue
      rows.push({
        sessionId: sessionId,
        chatId: chat.id,
        cardId: chat.cardId,
        cardName: chat.cardName || '未命名角色',
        updatedAt: chat.updatedAt || chat.createdAt || 0,
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
        mode: chat.mode || 'story',
        group: groupOfMode(chat.mode)
      })
    }
    rows.sort(function (a, b) { return b.updatedAt - a.updatedAt })
    return rows
  }
  async function addGuide(sessionId, text) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    const guide = str(text).trim().slice(0, 2000)
    if (guide === '') throw new Error('Guide 内容不能为空')
    if (!Array.isArray(chat.guides)) chat.guides = []
    if (chat.guides.length >= 20) throw new Error('Guide 数量已达上限（20 条）')
    chat.guides.push({ id: uid('guide'), text: guide, createdAt: Date.now() })
    chat.updatedAt = Date.now()
    await writeChat(chat)
    return chat.guides
  }
  async function deleteGuide(sessionId, index) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if (!Array.isArray(chat.guides)) chat.guides = []
    const idx = clampInt(index, 0, Math.max(0, chat.guides.length - 1), -1)
    if (idx < 0) throw new Error('Guide 序号无效')
    chat.guides.splice(idx, 1)
    chat.updatedAt = Date.now()
    await writeChat(chat)
    return chat.guides
  }

  // ---------- 提示词 ----------
  function worldBookEntries(card) {
    const out = []
    const book = card.character_book
    if (book === null || book === undefined || !Array.isArray(book.entries)) return out
    for (let i = 0; i < book.entries.length; i++) {
      const e = book.entries[i]
      if (e === null || typeof e !== 'object') continue
      if (e.enabled === false) continue
      let c = ''
      if (Array.isArray(e.content)) {
        c = e.content.map(function (x) { return x !== null && typeof x === 'object' ? str(x.content) : str(x) }).filter(function (x) { return x !== '' }).join('\n')
      } else {
        c = str(e.content)
      }
      if (c === '') continue
      const keys = Array.isArray(e.keys) && e.keys.length > 0 ? e.keys.join(',') : '设定'
      out.push({ id: 'wb-' + i, keys: keys, text: c, constant: e.constant === true })
    }
    return out
  }
  function worldBookLine(entry) {
    return '[' + str(entry.keys) + '] ' + str(entry.text)
  }
  function worldBookLines(card, selectedIds) {
    const out = []
    const wanted = Array.isArray(selectedIds) ? selectedIds : []
    for (const entry of worldBookEntries(card)) {
      if (entry.constant === true || wanted.indexOf(entry.id) >= 0) out.push(worldBookLine(entry))
    }
    return out
  }
  const worldBookSelectionCache = new Map()
  async function selectWorldBookEntries(chat, card, userText, sessionId, nativeTurn) {
    const entries = worldBookEntries(card).filter(function (entry) { return entry.constant !== true })
    if (entries.length === 0) return []
    const key = chat.id + ':' + nativeTurn
    if (worldBookSelectionCache.has(key)) return worldBookSelectionCache.get(key)
    // 非恒定条目很少时无需再调用模型，直接全部注入。
    let selectedIds = entries.length <= 3 ? entries.map(function (entry) { return entry.id }) : []
    const recent = (chat.messages || []).slice(-8).map(function (message) {
      return (message.role === 'assistant' ? '正文' : '玩家') + ': ' + str(message.text)
    }).join('\n')
    const recentText = recent + '\n' + str(userText).trim()
    if (entries.length > 3) {
      try {
        const raw = await callModel({
          sessionId: sessionId || chat.sessionId,
          temperature: 0.1,
          maxTokens: 400,
          system: '你是世界书条目检索器。根据最近几轮剧情，从可用条目中选出本轮正文生成最需要注入的条目。只输出 JSON：{"ids":["条目ID"]}。最多选 3 个；只选与最近剧情直接相关的人物或设定；不相关就输出空数组。',
          messages: [{
            id: 'worldbook-select-' + Date.now().toString(36),
            role: 'user',
            content: [{ type: 'text', text: '【最近剧情】\n' + (recent || '（只有开场白）') + '\n\n【玩家本轮输入】\n' + (str(userText).trim() || '（无）') + '\n\n【当前姿势】\n' + (chat.posture || '（无）') + '\n\n【可用条目】\n' + entries.map(function (entry) { return '[' + entry.id + '] keys: ' + entry.keys + '\n' + str(entry.text).slice(0, 160) }).join('\n\n') }],
            source: { kind: 'plugin', plugin: 'dsh-tavern-worldbook' }
          }]
        })
        const parsed = parseJsonLenient(raw)
        const ids = Array.isArray(parsed.ids) ? parsed.ids.map(function (id) { return str(id).trim() }) : []
        const valid = entries.map(function (entry) { return entry.id })
        selectedIds = ids.filter(function (id) { return valid.indexOf(id) >= 0 }).slice(0, 3)
      } catch (err) {
        console.error('dsh-tavern: 世界书条目检索失败，本轮仅注入常驻条目', str(err && err.message || err))
        selectedIds = []
      }
      // LLM 偶发空选择时，用条目 keys 对最近正文 + 本轮输入做一次确定性兜底匹配。
      if (selectedIds.length === 0) {
        const matched = []
        for (const entry of entries) {
          const keys = String(entry.keys || '').split(',')
          for (const key of keys) {
            const k = key.trim()
            if (k !== '' && recentText.indexOf(k) >= 0 && matched.indexOf(entry.id) < 0) {
              matched.push(entry.id)
              break
            }
          }
          if (matched.length >= 3) break
        }
        if (matched.length > 0) {
          console.log('dsh-tavern: 世界书检索回退为关键词匹配:', matched.join(','))
          selectedIds = matched
        }
      }
    }
    if (worldBookSelectionCache.size > 200) {
      const oldest = worldBookSelectionCache.keys().next().value
      if (oldest !== undefined) worldBookSelectionCache.delete(oldest)
    }
    worldBookSelectionCache.set(key, selectedIds)
    return selectedIds
  }
  function buildSystem(card, chat, scriptReference, worldBookIds) {
    const parts = []
    parts.push('你是小说续写引擎，只输出小说正文，不要解释、点评或元信息；长度由剧情自然决定。\n1. "你"是玩家角色；除玩家外，所有角色都由你叙述和扮演。\n2. 用户最新消息是导演指令：无标记=人物行为（动作、心理、对白）；「场景变化」=可以结束当前场景，也可以直接开启新场景；如果是新场景提要，要把它展开成完整场景，不能当成已发生，也不能跳过。玩家不是上帝：其他角色可以按人设拒绝、反对、打断玩家行动，不必百依百顺。\n3. 用户指令只是大致引导，不是要接续的原文，也不是已发生事实：先承接上一段和当前现场，让情节自然推进，在过程中完成指令要表达的意思；指令原文可以改写、拆散、融入叙述，不要整句直接复制。同一动作/台词只演一次，完成后可继续自然发展。\n4. 文风参照【文风示例】（若有）；与【现场】冲突时以【现场】为准。')
    const wb = worldBookLines(card, worldBookIds)
    if (wb.length > 0) parts.push('【世界设定】\n' + wb.join('\n'))
    if (str(chat.posture) !== '') parts.push('【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + chat.posture)
    const guides = Array.isArray(chat.guides) ? chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    if (guides.length > 0) parts.push('【用户指导 Guide · 优先遵循】\n' + guides.map(function (item, index) { return (index + 1) + '. ' + str(item.text).trim() }).join('\n'))
    const hasStoryTurn = (chat.messages || []).some(function (m) { return m !== null && typeof m === 'object' && m.greeting !== true })
    parts.push('【故事设定 · 人物卡】\n名字: ' + str(card.name))
    if (!hasStoryTurn) {
      if (str(card.description) !== '') parts.push('设定: ' + substChar(card.description, card, '你', '所有其他角色'))
      if (str(card.personality) !== '') parts.push('主要人物性格: ' + card.personality)
      if (str(card.scenario) !== '') parts.push('开场情境: ' + card.scenario)
      if (str(card.mes_example) !== '') parts.push('【文风示例】\n' + substChar(card.mes_example, card, '你', '所有其他角色'))
    }
    if (str(card.post_history_instructions) !== '') parts.push('【附加要求】\n' + card.post_history_instructions)
    if (str(card.system_prompt) !== '') parts.push('【特殊指令】\n' + card.system_prompt)
    if (scriptReference !== null && scriptReference !== undefined && str(scriptReference.text) !== '') {
      parts.push('【本轮剧本参考 · 仅本轮注入一次】\n' + scriptReference.text)
      parts.push('【剧本模式 · 初稿要求】\n你正在写正文，直接写出成稿：内容与形式一次到位，删除重复、理顺叙述顺序、补足过渡、润色遣词造句，不要留下粗糙痕迹。剧本是本轮剧情主线：先分析本块内容，必要时用 tavern_session action=script 前瞻后续分块、了解剧情走向，然后尽量贴合剧本发展——把本块中的事件、对白、人物反应、转折尽量演出；允许照抄剧本原文，也允许自由发挥。玩家指令是承接方式：从上一段结尾和玩家本轮行动自然进入剧本剧情；指令与剧本冲突时以剧本走向为主，把玩家动作自然融入。优先保住剧本内容，不要为通顺牺牲剧本，也不要重复上一段已发生的情节。')
    }
    return parts.join('\n\n')
  }
  async function polishBody(chat, draftText, sessionId, previousTail, scriptText, posture) {
    let system = '你是小说润色器。下面正文是直接写出的成稿，仍可能有重复、生硬、顺序不顺之处。你的任务是进一步整理成形：删除重复与冗余，调整叙述顺序让逻辑顺畅，补上必要的过渡衔接，润色用词、句式、比喻和感官细节；可以参照剧本适当新增、改写或删除内容，让文字更有质感。注意保持剧情主线连贯、不与上一段及已发生情节矛盾；不要解释，只输出润色后的正文。'
    if (str(previousTail) !== '') {
      system += '\n\n【上一段正文结尾】\n' + previousTail + '\n\n润色后正文必须与上一段结尾连续、自然，开头先承接上一段结尾。'
    }
    if (str(posture) !== '') {
      system += '\n\n【上一轮结束 · 人物姿势（每轮结算更新）】\n' + posture + '\n\n润色后正文中的人物位置、动作、姿态要从这段姿势自然承接、连贯发展，不要出现矛盾或跳跃。'
    }
    if (str(scriptText) !== '') {
      system += '\n\n【本轮对应剧本原文 · 文风基准】\n' + scriptText + '\n\n润色时模仿这段剧本的遣词造句与语言风格：用词、句式、语感、称呼习惯都向它靠拢。允许适当修改和自由发挥，不必照抄。'
    }
    const raw = await callModel({
      sessionId: sessionId,
      temperature: 0.6,
      maxTokens: 4096,
      system: system,
      messages: [{
        id: 'polish-' + Date.now().toString(36),
        role: 'user',
        content: [{ type: 'text', text: '【待润色正文】\n' + draftText }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-polish' }
      }]
    })
    const polished = str(raw).trim()
    if (polished === '') throw new Error('润色失败：模型返回空文本')
    return polished
  }
  function splitDiffSentences(text) {
    const out = []
    let buf = ''
    const src = String(text ?? '')
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]
      buf += ch
      if ('。！？!?…\n'.indexOf(ch) >= 0) {
        const part = buf.trim()
        if (part !== '') out.push(part)
        buf = ''
      }
    }
    const tail = buf.trim()
    if (tail !== '') out.push(tail)
    return out
  }
  function sentenceDiffOps(before, after) {
    const a = splitDiffSentences(before)
    const b = splitDiffSentences(after)
    const n = a.length
    const m = b.length
    const dp = []
    for (let i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0))
    }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
    const ops = []
    let i = n
    let j = m
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        ops.unshift({ type: 'same', text: a[i - 1] })
        i--
        j--
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        ops.unshift({ type: 'del', text: a[i - 1] })
        i--
      } else {
        ops.unshift({ type: 'add', text: b[j - 1] })
        j--
      }
    }
    while (i > 0) { ops.unshift({ type: 'del', text: a[i - 1] }); i-- }
    while (j > 0) { ops.unshift({ type: 'add', text: b[j - 1] }); j-- }
    return ops
  }
  function escapeDiffHtml(text) {
    return String(text).replace(/[&<>]/g, function (ch) {
      return ch === '&' ? '&amp;' : (ch === '<' ? '&lt;' : '&gt;')
    })
  }
  function renderPolishDiffHtml(cardName, draftText, polishedText, at) {
    const ops = sentenceDiffOps(draftText, polishedText)
    let body = ''
    for (const op of ops) {
      const escaped = escapeDiffHtml(op.text)
      if (op.type === 'del') body += '<del>' + escaped + '</del>'
      else if (op.type === 'add') body += '<ins>' + escaped + '</ins>'
      else body += escaped
    }
    return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>润色对比</title><style>body{margin:0;padding:24px;background:#16130f;color:#eee6da;font-family:ui-serif,Georgia,"Songti SC",serif;line-height:1.9}header{max-width:900px;margin:0 auto 18px;color:#b9a48d;font-size:13px}.diff{max-width:900px;margin:0 auto;white-space:pre-wrap;font-size:16px}del{background:rgba(220,80,60,.22);color:#ff9d8f;text-decoration:line-through;border-radius:3px;padding:0 1px}ins{background:rgba(90,170,90,.22);color:#b6e3b0;text-decoration:none;border-radius:3px;padding:0 1px}</style></head><body><header><b>润色对比</b> · ' + escapeDiffHtml(cardName || '未命名角色') + ' · ' + new Date(at || Date.now()).toLocaleString('zh-CN') + '<br>红色划线 = 润色前删除，绿色 = 润色后新增；无标记文字未变。</header><div class="diff">' + body + '</div></body></html>'
  }
  async function writePolishDiff(chatId, cardName, draftText, polishedText) {
    await ensureDataDir('diffs')
    const target = await fs.resolve(base + '/diffs/polish-' + chatId + '.html')
    await fs.writeText(target, renderPolishDiffHtml(cardName, draftText, polishedText, Date.now()))
  }
  function normalizeScriptState(chat, script) {
    if (chat.scriptState === null || typeof chat.scriptState !== 'object') chat.scriptState = {}
    const state = chat.scriptState
    const version = Number(script.importedAt) || 0
    if ((Number(state.scriptVersion) || 0) !== version) {
      const initialCursor = Math.max(0, Math.min(script.chunks.length - 1, Number(state.initialCursor) || 0))
      state.cursor = initialCursor
      state.recalledChunkIds = []
      state.skippedChunkIds = []
      for (let index = 0; index < initialCursor; index++) state.skippedChunkIds.push('chunk-' + String(index + 1).padStart(5, '0'))
      state.prepared = null
      state.lastReference = null
      state.scriptVersion = version
    }
    state.cursor = Math.max(0, Number(state.cursor) || 0)
    state.recalledChunkIds = Array.isArray(state.recalledChunkIds) ? state.recalledChunkIds : []
    state.skippedChunkIds = Array.isArray(state.skippedChunkIds) ? state.skippedChunkIds : []
    state.totalChunks = Array.isArray(script.chunks) ? script.chunks.length : 0
    state.title = script.title || state.title || chat.cardName + '剧本'
    return state
  }
  async function prepareScriptReference(chat, card, userText, sessionId, nativeTurn) {
    const script = await readScript(chat.cardId)
    if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
    const state = normalizeScriptState(chat, script)
    const request = str(userText).trim()
    if (state.prepared !== null && typeof state.prepared === 'object' && state.prepared.userText === request && Number(state.prepared.nativeTurn) === Number(nativeTurn)) return state.prepared
    if (state.cursor >= script.chunks.length) {
      state.prepared = { userText: request, nativeTurn: Number(nativeTurn) || 0, ended: true, chunkId: '', order: state.cursor, text: '' }
      await writeChat(chat)
      return state.prepared
    }
    // 游标由候选项模块调整，这里只按游标注入当前参考分块；正文需要更多范围时用 action=script peek 前后看。
    const selected = script.chunks[state.cursor]
    state.lookahead = []
    state.lookaheadTurn = Number(nativeTurn) || 0
    state.prepared = {
      userText: request,
      nativeTurn: Number(nativeTurn) || 0,
      ended: false,
      chunkId: selected.id,
      order: selected.order,
      text: selected.text,
      cursorBefore: state.cursor,
      preparedAt: Date.now()
    }
    await writeChat(chat)
    return state.prepared
  }
  function commitScriptReference(chat, userText, nativeTurn) {
    const state = chat.scriptState
    if (state === null || typeof state !== 'object') throw new Error('剧本状态不存在，请重新打开该会话')
    const prepared = state.prepared
    if (prepared === null || typeof prepared !== 'object') throw new Error('本轮尚未准备剧本分块，请先调用 context')
    if (str(prepared.userText).trim() !== str(userText).trim()) throw new Error('commit 的 userText 与本轮剧本准备不一致')
    if (Number(prepared.nativeTurn) !== Number(nativeTurn)) throw new Error('commit 与本轮原生 turn 不一致')
    if (prepared.ended === true || str(prepared.chunkId) === '') {
      state.prepared = null
      return
    }
    const order = Number(prepared.order) || 0
    if (!state.recalledChunkIds.includes(prepared.chunkId)) state.recalledChunkIds.push(prepared.chunkId)
    // 游标由候选项模块生成候选时调整（向前/向后/不变），commit 不推进游标。
    state.lastReference = { chunkId: prepared.chunkId, order: order, text: prepared.text, userText: str(userText), recalledAt: Date.now() }
    state.prepared = null
  }
  function buildMessages(chat, sel, limit) {
    const src = (chat.messages || []).slice(-(limit || 40))
    const out = []
    for (let i = 0; i < src.length; i++) {
      const m = src[i]
      if (m === null || typeof m !== 'object' || str(m.text) === '') continue
      out.push({
        id: 'm' + i + '-' + Date.now().toString(36),
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: str(m.text) }],
        source: m.role === 'assistant' ? { kind: 'model', provider: sel.provider, model: sel.model } : { kind: 'plugin', plugin: 'dsh-tavern' }
      })
    }
    return out
  }
  // ---------- 后台结算 ----------
  function settleSystemPrompt() {
    return '你是剧情结算器。阅读【当前姿势】与【最新一轮对话】，只输出一个 JSON 对象，不要输出其他任何内容。\n' +
      '格式: {"posture":"一句话"}\n' +
      '规则:\n' +
      '0. posture 必填：用第三人称一句话描述【最新一轮对话】结束时主要人物当前的姿势、动作、位置与衣着，例如"王夫人端坐佛龛前，一手搭在贾舍肩上，含笑细语"。每轮都会用最新描述覆盖旧值，只写"现在"的状态，绝不写历史。\n' +
      '示例: {"posture":"阿芙拉站在吧台后，擦着酒杯，朝你俯身低语"}'
  }
  function settleUserText(chat) {
    const msgs = (chat.messages || []).slice(-4)
    const lines = [
      '【当前姿势】',
      str(chat.posture) !== '' ? chat.posture : '（无）',
      '【最新一轮对话】'
    ]
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      if (m === null || typeof m !== 'object' || str(m.text) === '') continue
      lines.push((m.role === 'assistant' ? '正文' : '玩家') + ': ' + str(m.text))
    }
    return lines.join('\n')
  }
  function parseJsonLenient(text) {
    if (text === undefined || text === null || text === '') return {}
    let t = text.trim()
    if (t.startsWith('```')) {
      const nl = t.indexOf('\n')
      if (nl >= 0) t = t.slice(nl + 1)
      if (t.endsWith('```')) t = t.slice(0, -3)
      t = t.trim()
    }
    try {
      const v = JSON.parse(t)
      if (v !== null && typeof v === 'object') return v
    } catch (err) {}
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) {
      try {
        const v = JSON.parse(t.slice(s, e + 1))
        if (v !== null && typeof v === 'object') return v
      } catch (err) {}
    }
    return {}
  }
  function parseChoiceObjects(text) {
    const out = []
    if (text === undefined || text === null || text === '') return out
    const re = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[}\]]/g
    let m
    while ((m = re.exec(text)) !== null) {
      const type = m[1].trim().toLowerCase()
      const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim()
      if (content !== '') out.push({ type: type, text: content })
    }
    return out
  }
  function extractChoicesArray(text) {
    if (text === undefined || text === null || text === '') return null
    const keyAt = text.indexOf('"choices"')
    if (keyAt < 0) return null
    const start = text.indexOf('[', keyAt)
    if (start < 0) return null
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
    return null
  }
  function applySettlement(chat, result) {
    let postureUpdated = false
    const posture = str(result.posture).trim()
    if (posture !== '') {
      chat.posture = posture
      postureUpdated = true
    }
    // 只维护人物姿势。事件、人物、关系等长期信息（lore）不再整合、不再注入；
    // 旧数据保留在 chat 文件中，但不做任何更新。
    return { postureUpdated: postureUpdated }
  }
  async function runSettlement(chatId) {
    while (true) {
      const snapshot = await readChat(chatId)
      if (snapshot === undefined) return
      const snapshotMessageCount = Array.isArray(snapshot.messages) ? snapshot.messages.length : 0
      try {
        await readChatCard(snapshot)
        const text = await callModel({
          messages: [{
            id: 'settle-' + Date.now().toString(36),
            role: 'user',
            content: [{ type: 'text', text: settleUserText(snapshot) }],
            source: { kind: 'plugin', plugin: 'dsh-tavern' }
          }],
          system: settleSystemPrompt(),
          temperature: 0.2,
          maxTokens: 8000,
          sessionId: snapshot.sessionId
        })
        const result = parseJsonLenient(text)
        const latest = await readChat(chatId)
        if (latest === undefined) return
        const latestMessageCount = Array.isArray(latest.messages) ? latest.messages.length : 0
        const changedDuringSettlement = latestMessageCount !== snapshotMessageCount
        const stat = applySettlement(latest, result)
        latest.settleStatus = changedDuringSettlement ? 'running' : 'done'
        latest.settleError = null
        latest.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 800) }
        await writeChat(latest)
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新', changedDuringSettlement ? '（检测到新提交，继续结算）' : '')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 800))
        if (!changedDuringSettlement) return
      } catch (err) {
        const latest = await readChat(chatId)
        if (latest === undefined) return
        latest.settleStatus = 'error'
        latest.settleError = str(err && err.message || err)
        await writeChat(latest)
        console.error('dsh-tavern: 结算失败', chatId, latest.settleError)
        return
      }
    }
  }
  function queueSettlement(chatId) {
    if (settlementJobs.has(chatId)) return false
    settlementJobs.add(chatId)
    void runSettlement(chatId).finally(function () { settlementJobs.delete(chatId) })
    return true
  }
  function nativeTurnOf(exec) {
    const phase = exec && exec.agent ? exec.agent.phase : null
    return phase && phase.kind === 'running' ? Math.max(0, Number(phase.turn) || 0) : 0
  }
  function nativeCommitFor(chat, turn) {
    if (!turn || chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') return null
    const value = chat.nativeCommits[String(turn)]
    return value !== null && typeof value === 'object' ? value : null
  }
  function rememberNativeCommit(chat, turn, value, before) {
    if (!turn) return
    if (chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') chat.nativeCommits = {}
    const record = Object.assign({ turn: turn, committedAt: Date.now() }, value)
    if (before !== undefined && before !== null) record.before = before
    chat.nativeCommits[String(turn)] = record
    const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
    for (const oldTurn of keys.slice(40)) delete chat.nativeCommits[String(oldTurn)]
  }
  // ---------- 抽取模式：从素材提炼新人物卡 ----------
  async function extractWindowOf(chat) {
    const idx = await readIndex()
    const meta = {}
    for (const s of idx.sources || []) meta[s.id] = s
    const out = []
    for (const sourceId of (chat.extract && chat.extract.sourceIds) || []) {
      const src = await readSource(sourceId)
      if (src === undefined || !Array.isArray(src.chunks)) continue
      const title = str(meta[sourceId] && meta[sourceId].title) || str(src.title) || '素材'
      for (const chunk of src.chunks) {
        out.push({ chunkId: sourceId + '/' + chunk.id, title: title, order: chunk.order, text: chunk.text })
      }
    }
    return out
  }
  async function prepareExtract(chat, nativeTurn) {
    const ext = chat.extract
    if (ext === null || typeof ext !== 'object') throw new Error('抽取状态不存在')
    if (ext.prepared !== null && typeof ext.prepared === 'object' && Number(ext.prepared.nativeTurn) === Number(nativeTurn)) return ext.prepared
    const all = await extractWindowOf(chat)
    const cursor = Math.max(0, Number(ext.cursor) || 0)
    const window = all.slice(cursor, cursor + 6)
    ext.prepared = { nativeTurn: Number(nativeTurn) || 0, window: window, cursorBefore: cursor, total: all.length }
    await writeChat(chat)
    return ext.prepared
  }
  function commitExtract(chat, nativeTurn) {
    const ext = chat.extract
    if (ext === null || typeof ext !== 'object') return
    const prepared = ext.prepared
    if (prepared !== null && typeof prepared === 'object' && Number(prepared.nativeTurn) === Number(nativeTurn)) {
      ext.cursor = Math.min(prepared.total, (Number(prepared.cursorBefore) || 0) + prepared.window.length)
      ext.prepared = null
    }
  }
  function buildExtractSystem(chat, prepared) {
    const ext = chat.extract || {}
    const draft = ext.draft || {}
    const player = str(ext.player)
    const parts = []
    parts.push('你在酒馆的卡片模式（素材抽取）中：根据给定的剧本/小说素材，与用户讨论并提炼出一张新的人物卡。你不续写剧情、不进行角色扮演。')
    parts.push('【人物卡可提炼字段】name（角色名）、description（角色描述：身份、外貌、背景）、personality（性格）、scenario（开场情境）、first_mes（开场白，写第一幕）、mes_example（对话示例，<START> 分隔，用 {{char}}/{{user}} 模板）、system_prompt、post_history_instructions、tags（字符串数组）。')
    parts.push('【玩家身份（{{user}}）】\n' + (player !== ''
      ? player + '\n已确认。mes_example、scenario、first_mes 中的 {{user}} 一律指这个身份；玩家行动和正文中的“你”也指这个身份。若用户要求修改玩家，确认后在 commit 的 cardPatch 中输出 {"player":"新的身份"}。'
      : '尚未确认，这是当前最优先事项：先向用户明确提问“谁是玩家（{{user}}）？”，例如“玩家是段恩泽”“玩家是贾宝玉”“玩家是原创读者”。得到确认后，在 commit 的 cardPatch 中输出 {"player":"玩家身份"}；该字段只记录抽取会话的玩家身份，不写入人物卡字段。未确认前不要把玩家身份写死。'))
    parts.push('【规则】\n1. 只依据素材与对话中已确认的信息写卡，素材不足时向用户提问或给多个方案。\n2. 人物卡是 {{char}} 的卡：system_prompt、post_history_instructions、personality、description 一律用第三人称写角色（如“段莹莹是……她……”），禁止写“你是{{char}}”“你是段莹莹”这类第二人称；{{user}} 才是玩家，{{char}} 和其他出场人物都是角色。\n3. 用户可以指定角色（如“抽取王夫人”）或指定卡类型（单一角色/多角色卡），也可以随时修改玩家身份。\n4. 每轮可以讨论、提问或给出草稿片段；只有用户明确确认修改时，才在 commit 时输出最小 draftPatch（JSON 对象，只含要改的字段；player 可以单独输出）；只讨论时 draftPatch 必须是 {}。\n5. 素材按游标分批注入，未读部分会在后续轮次继续注入，不要担心一次读不完。')
    parts.push('【当前草稿】\n' + JSON.stringify(draft, null, 1))
    if (prepared !== null && typeof prepared === 'object' && Array.isArray(prepared.window) && prepared.window.length > 0) {
      parts.push('【本轮素材 · 第 ' + (Number(prepared.cursorBefore) + 1) + '~' + (Number(prepared.cursorBefore) + prepared.window.length) + ' 块 / 共 ' + prepared.total + ' 块】\n' + prepared.window.map(function (c) { return '[' + c.title + '] ' + c.text }).join('\n\n'))
    } else {
      parts.push('【素材】全部素材已注入完毕（共 ' + (prepared !== null && typeof prepared === 'object' ? prepared.total : 0) + ' 块），可以定稿。')
    }
    return parts.join('\n\n')
  }
  async function extractViewOf(chat) {
    const ext = chat.extract || {}
    const idx = await readIndex()
    const sources = ((ext.sourceIds || []).map(function (id) {
      const item = (idx.sources || []).filter(function (s) { return s.id === id })[0]
      return item === undefined ? null : { id: item.id, title: item.title, chunkCount: Number(item.chunkCount) || 0 }
    })).filter(Boolean)
    const totalChunks = sources.reduce(function (n, s) { return n + s.chunkCount }, 0)
    return {
      sourceIds: ext.sourceIds || [],
      sources: sources,
      cursor: Math.min(totalChunks, Math.max(0, Number(ext.cursor) || 0)),
      totalChunks: totalChunks,
      done: ext.done === true,
      player: str(ext.player),
      draft: ext.draft || {}
    }
  }
  async function startExtract(sourceIds, sessionId, player) {
    const ids = (Array.isArray(sourceIds) ? sourceIds : []).filter(function (id) { return str(id) !== '' })
    if (ids.length === 0) throw new Error('请先选择抽取素材')
    const chat = newChat({ id: '', name: '抽取中' }, 'extract')
    chat.extract.sourceIds = ids
    chat.extract.player = str(player).trim()
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    const titles = []
    const idx = await readIndex()
    for (const id of ids) {
      const item = (idx.sources || []).filter(function (s) { return s.id === id })[0]
      if (item !== undefined) titles.push(item.title)
    }
    const playerNote = chat.extract.player !== ''
      ? '已确认玩家（{{user}}）= ' + chat.extract.player + '。我会按这个身份处理对话示例与玩家视角；人物卡中的角色一律用第三人称，不会在 system_prompt 里写“你是角色”。你可以随时说“玩家改成……”。'
      : '在开始前，请先告诉我：这份素材里的玩家（{{user}}）是谁？例如“玩家是段恩泽”“玩家是贾宝玉”“玩家是原创读者”。确认玩家身份后，我才会把它用于人物卡。'
    const greeting = '卡片模式 · 素材抽取：素材《' + titles.join('》《') + '》。我会根据你的要求从中提炼人物卡。你可以指定角色（如“抽取王夫人”）或卡类型（单一角色/多角色卡）。' + playerNote
    chat.messages.push({ role: 'assistant', text: greeting, ts: Date.now(), greeting: true })
    await writeChat(chat)
    idx.chats = idx.chats || []
    idx.chats.push({ id: chat.id, cardId: '', cardName: '抽取中', updatedAt: chat.updatedAt })
    await writeIndex(idx)
    if (typeof sessionId === 'string' && sessionId !== '') {
      const map = await readSessionMap()
      map[sessionId] = chat.id
      await writeSessionMap(map)
      await appendNativeOpening(sessionId, chat, null)
    }
    const result = view(chat, null)
    result.extract = await extractViewOf(chat)
    return result
  }
  async function finalizeExtract(chatId) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    if ((chat.mode || 'story') !== 'extract') throw new Error('当前不是抽取会话')
    const ext = chat.extract !== null && typeof chat.extract === 'object' ? chat.extract : {}
    const draft = ext.draft !== null && typeof ext.draft === 'object' ? ext.draft : {}
    if (str(draft.name).trim() === '') throw new Error('草稿还没有角色名，请先在对话中确认')
    const player = str(ext.player)
    if (player === '' && ext.done !== true) throw new Error('玩家（{{user}}）身份还没有确认。请先在对话中告诉助手“玩家是XX”，确认后再保存。')
    const card = normalizeCard(draft)
    const sysPrompt = str(card.system_prompt).trim()
    if (sysPrompt !== '' && /^你是/.test(sysPrompt)) throw new Error('草稿的 system_prompt 把角色写成了“你是……”，会与玩家身份冲突；请让助手改成第三人称后再保存。')
    card.creator_notes = str(card.creator_notes || '') + '\n[抽取生成] ' + ((ext.sourceIds) || []).join(',') + '\n[玩家] ' + (player !== '' ? player : '未确认（旧会话）')
    await writeJson('cards/' + card.id + '.json', card)
    const idx = await readIndex()
    idx.cards = idx.cards || []
    idx.cards.push({ id: card.id, name: card.name, description: card.description, tags: card.tags, importedAt: card.importedAt })
    for (const row of idx.chats || []) {
      if (row.id === chat.id) { row.cardId = card.id; row.cardName = card.name }
    }
    await writeIndex(idx)
    chat.cardId = card.id
    chat.cardName = card.name
    chat.extract.done = true
    await writeChat(chat)
    const result = view(chat, card)
    result.extract = await extractViewOf(chat)
    result.finalizedCard = { id: card.id, name: card.name, description: card.description, tags: card.tags }
    return result
  }

  // ---------- 重新生成正文（生成即替换，无确认） ----------
  function regenSourceMessages(chat) {
    const src = (chat.messages || []).slice()
    for (let i = src.length - 1; i >= 0; i--) {
      const m = src[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        src.splice(i, 1)
        break
      }
    }
    return src
  }
  function nextTurnOf(session) {
    let maxTurn = 0
    for (const event of session.events) {
      if (event.type === 'turn/start' && Number.isSafeInteger(event.data.turn)) {
        maxTurn = Math.max(maxTurn, Number(event.data.turn))
      }
    }
    return maxTurn + 1
  }
  async function regenBody(chatId, guidance, sessionId) {
    await ensureSettings()
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(chat.sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
    let oldSeq = -1
    let oldTurn = 0
    let oldSource = null
    for (let i = nodes.length - 1; i >= 0; i--) {
      const candidate = session.events[nodes[i]]
      if (candidate !== undefined && candidate.type === 'assistant/message') {
        oldSeq = nodes[i]
        oldTurn = Number(candidate.data.turn) || 0
        oldSource = candidate.data && candidate.data.message ? candidate.data.message.source : null
        break
      }
    }
    if (oldSeq < 0) throw new Error('原生消息流中找不到可替换的正文消息')
    if (oldSource === null || typeof oldSource !== 'object' || oldSource.kind !== 'model') throw new Error('找不到旧正文的模型来源')
    const msgs0 = chat.messages || []
    let oldAssistantIndex = -1
    for (let i = msgs0.length - 1; i >= 0; i--) {
      const m = msgs0[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        oldAssistantIndex = i
        break
      }
    }
    if (oldAssistantIndex < 1 || msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' || msgs0[oldAssistantIndex - 1].role !== 'user') throw new Error('没有可重新生成的玩家输入与正文组合')
    const originalUserText = str(msgs0[oldAssistantIndex - 1].text).trim()
    const oldChatCount = msgs0.length
    const guide = str(guidance).trim()
    const syntheticText = '【重新生成正文】\n原玩家输入：\n' + originalUserText + '\n\n指导意见：\n' + (guide !== '' ? guide : '（无）') + '\n\n请按正常流程处理：先调用 tavern_session action=context，再根据原玩家输入和指导意见重新生成小说正文，最后调用 action=commit。'
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    agent.followup({
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: syntheticText }],
      source: { kind: 'plugin', plugin: 'dsh-tavern-regen' }
    })
    await agent.whenIdle()
    const syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
    const latest = await readChat(chat.id)
    if (latest === undefined) throw new Error('聊天不存在: ' + chat.id)
    const latestMsgs = latest.messages || []
    if (latestMsgs.length < oldChatCount + 2) throw new Error('重新生成流程未产生新的用户/助手回合')
    const newAssistant = latestMsgs[latestMsgs.length - 1]
    if (newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant') throw new Error('重新生成流程未产生正文')
    const body = str(newAssistant.text).trim()
    if (body === '') throw new Error('重新生成失败：模型返回空文本')
    latestMsgs[oldAssistantIndex].text = body
    latestMsgs[oldAssistantIndex].ts = Date.now()
    latestMsgs.splice(oldChatCount, latestMsgs.length - oldChatCount)
    if (latest.nativeCommits !== null && typeof latest.nativeCommits === 'object') delete latest.nativeCommits[String(syntheticTurn)]
    latest.updatedAt = Date.now()
    latest.settleStatus = 'running'
    latest.settleError = null
    await writeChat(latest)
    queueSettlement(latest.id)
    // 模型面遮蔽旧正文；新正文由正常 Agent 回合生成，UI 隐藏旧 turn tail 与合成的重新生成用户消息
    if (nodes.indexOf(oldSeq) >= 0) {
      session.append('assistant/message', {
        turn: oldTurn,
        step: 1,
        message: {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [],
          source: oldSource
        }
      }, {
        surfaceOp: { op: 'replace', start: oldSeq, end: oldSeq },
        sourceEventSeqs: [oldSeq]
      })
    }
    const result = view(latest, card)
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn }
    return result
  }

  // ---------- 回退本轮（删除最近一次用户输入 + LLM 输出） ----------
  function awaitingSceneFromMessages(messages) {
    let awaiting = false
    for (const m of messages || []) {
      if (m === null || typeof m !== 'object' || m.role !== 'user') continue
      const text = str(m.text).trim()
      if (text.indexOf('【场景结束】') === 0) awaiting = true
      else if (text.indexOf('【新场景】') === 0) awaiting = false
    }
    return awaiting
  }
  function restoreScriptStateFromReference(chat, ref) {
    const state = chat.scriptState
    if (state === null || typeof state !== 'object') return
    state.prepared = null
    if (ref === null || ref === undefined) return
    if (ref.ended === true) return
    const chunkId = str(ref.chunkId)
    if (chunkId === '') return
    const before = Math.max(0, Number(ref.cursorBefore) || 0)
    const order = Math.max(0, Number(ref.order) || 0)
    state.cursor = before
    state.recalledChunkIds = Array.isArray(state.recalledChunkIds) ? state.recalledChunkIds.filter(function (id) { return id !== chunkId }) : []
    const skippedBack = new Set()
    for (let index = before; index < order; index++) skippedBack.add('chunk-' + String(index + 1).padStart(5, '0'))
    state.skippedChunkIds = Array.isArray(state.skippedChunkIds) ? state.skippedChunkIds.filter(function (id) { return !skippedBack.has(id) }) : []
    state.lastReference = null
  }
  async function rollbackTurn(sessionId, chatId) {
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(chat.sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const events = Array.isArray(session.events) ? session.events : []
    let userSeq = -1
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event !== null && typeof event === 'object' && event.type === 'user/message' && event.surfaceOp === 'append') {
        userSeq = Number(event.seq) || 0
        break
      }
    }
    if (userSeq < 0) throw new Error('原生消息流中找不到可回退的用户输入')
    let lastAssistant = null
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event !== null && typeof event === 'object' && event.type === 'assistant/message' && event.surfaceOp === 'append') {
        lastAssistant = event
        break
      }
    }
    if (lastAssistant === null) throw new Error('原生消息流中找不到可回退的正文输出')
    const hiddenTurn = Math.max(0, Number(lastAssistant.data && lastAssistant.data.turn) || 0)
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const startIndex = nodes.indexOf(userSeq)
    if (startIndex < 0) throw new Error('目标用户输入已不在模型面中，可能已经回退过')
    const shadowedSeqs = nodes.slice(startIndex)
    if (shadowedSeqs.length === 0) throw new Error('没有可遮蔽的消息区间')

    // 1) 插件 chat：移除最后一组 user + assistant
    const msgs = chat.messages || []
    let assistantIndex = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        assistantIndex = i
        break
      }
    }
    if (assistantIndex < 0 || assistantIndex - 1 < 0) throw new Error('没有可回退的用户输入与正文组合')
    if (msgs[assistantIndex - 1] === null || typeof msgs[assistantIndex - 1] !== 'object' || msgs[assistantIndex - 1].role !== 'user') throw new Error('最后一组消息不是用户输入 + 正文')
    const removedUserText = str(msgs[assistantIndex - 1].text).trim()
    const removedAssistantText = str(msgs[assistantIndex].text).trim()
    msgs.splice(assistantIndex - 1, 2)

    // 2) 状态回滚
    let rollbackCommit = null
    let rollbackCommitKey = ''
    if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
      const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
      for (const key of keys) {
        const commit = chat.nativeCommits[String(key)]
        if (commit !== null && typeof commit === 'object' && str(commit.userText).trim() === removedUserText) {
          rollbackCommit = commit
          rollbackCommitKey = String(key)
          break
        }
      }
    }
    const before = rollbackCommit !== null && rollbackCommit.before !== null && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : null
    let postureFallback = false
    if (before !== null && typeof before.posture === 'string') chat.posture = before.posture
    else {
      chat.posture = ''
      postureFallback = true
    }
    if (before !== null && typeof before.awaitingScene === 'boolean') chat.awaitingScene = before.awaitingScene
    else chat.awaitingScene = awaitingSceneFromMessages(msgs)
    if (mode === 'script') {
      if (before !== null && before.scriptState !== null && typeof before.scriptState === 'object') {
        const state = chat.scriptState
        if (state !== null && typeof state === 'object') {
          state.cursor = Math.max(0, Number(before.scriptState.cursor) || 0)
          state.recalledChunkIds = Array.isArray(before.scriptState.recalledChunkIds) ? before.scriptState.recalledChunkIds.slice() : []
          state.skippedChunkIds = Array.isArray(before.scriptState.skippedChunkIds) ? before.scriptState.skippedChunkIds.slice() : []
          state.prepared = null
          state.lastReference = before.scriptState.lastReference !== null && typeof before.scriptState.lastReference === 'object' ? Object.assign({}, before.scriptState.lastReference) : null
        }
      } else {
        restoreScriptStateFromReference(chat, rollbackCommit !== null && rollbackCommit.scriptReference !== null && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null)
      }
    }
    if (rollbackCommitKey !== '') delete chat.nativeCommits[rollbackCommitKey]
    chat.candidates = null
    chat.pending = null
    chat.settleStatus = 'idle'
    chat.settleError = null
    chat.lastSettle = null
    chat.updatedAt = Date.now()
    await writeChat(chat)

    // 3) 原生消息面：用空消息替换最近一轮的所有 surface 节点（模型不再看到），UI 由客户端隐藏对应 turn tail
    const endSeq = shadowedSeqs[shadowedSeqs.length - 1]
    const hideTurn = Math.max(0, Number(lastAssistant.data && lastAssistant.data.turn) || 0)
    const hideStep = Math.max(1, Number(lastAssistant.data && lastAssistant.data.step) || 1)
    const rollbackSource = lastAssistant !== null && lastAssistant.data !== undefined && lastAssistant.data.message !== undefined && lastAssistant.data.message.source !== undefined && lastAssistant.data.message.source.kind === 'model'
      ? lastAssistant.data.message.source
      : null
    if (rollbackSource === null) throw new Error('找不到可用的模型来源，无法遮蔽本轮消息')
    session.append('assistant/message', {
      turn: hideTurn,
      step: hideStep,
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [],
        source: rollbackSource
      }
    }, {
      surfaceOp: { op: 'replace', start: userSeq, end: endSeq },
      sourceEventSeqs: shadowedSeqs
    })
    if (postureFallback) queueSettlement(chat.id)
    const result = view(chat, card)
    result.rolledBack = { hiddenTurn: hiddenTurn, removedUserText: removedUserText, removedAssistantText: removedAssistantText }
    return result
  }

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args) {
    await ensureSettings()
    switch (method) {
      case 'getSettings': return { settings: { polish: settings.polish === true, temperature: settings.temperature, provider: settings.provider, model: settings.model, candidates: settings.candidates } }
      case 'updateSettings': {
        const patch = args && args.patch
        if (patch !== null && typeof patch === 'object') {
          if (typeof patch.polish === 'boolean') settings.polish = patch.polish
          if (typeof patch.temperature === 'number') settings.temperature = Math.min(1.5, Math.max(0, patch.temperature))
          if (typeof patch.provider === 'string') settings.provider = str(patch.provider)
          if (typeof patch.model === 'string') settings.model = str(patch.model)
          if (typeof patch.candidates === 'number') settings.candidates = clampInt(Math.round(patch.candidates), 1, 5, settings.candidates)
        }
        await writeJson('settings.json', { candidates: settings.candidates, temperature: settings.temperature, provider: settings.provider, model: settings.model, polish: settings.polish === true })
        return { settings: { polish: settings.polish === true, temperature: settings.temperature, provider: settings.provider, model: settings.model, candidates: settings.candidates } }
      }
      case 'listCards': return { cards: await listCards() }
      case 'getScriptInfo': return { script: compactScriptInfo(await readScript(args && args.cardId)) }
      case 'importScript': return { script: await importScript(args && args.cardId, args && args.payload) }
      case 'deleteScript': return await deleteScript(args && args.cardId)
      case 'listSources': return { sources: await listSources() }
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'deleteSource': return await deleteSource(args && args.sourceId)
      case 'startExtract': return { view: await startExtract(args && args.sourceIds, args && args.sessionId, args && args.player) }
      case 'finalizeExtract': return { view: await finalizeExtract(args && args.chatId) }
      case 'createCard': return { card: await createCard(args && args.source) }
      case 'duplicateCard': return { card: await duplicateCard(args && args.cardId) }
      case 'getCard': {
        const card = await readCard(args && args.cardId)
        if (card === undefined) throw new Error('角色卡不存在: ' + (args && args.cardId))
        return { card: card }
      }
      case 'updateCard': return { card: await updateCard(args && args.cardId, args && args.patch) }
      case 'reviseCard': return await reviseCard(args && args.cardId, args && args.instruction, args && args.sessionId)
      case 'clearRevisionChat': return { card: await clearRevisionChat(args && args.cardId) }
      case 'listSessions': return { sessions: await listTavernSessions() }
      case 'importCard': return { card: await importCard(args && args.payload) }
      case 'deleteCard': return await deleteCard(args && args.cardId)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'startChat': return { view: await startChat(args && args.cardId, args && args.sessionId, args && args.mode) }
      case 'getSession': return { view: await sessionView(args && args.sessionId) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'chooseGreeting': return { view: await chooseGreeting(args && args.chatId, args && args.index) }
      case 'getChoices': return { candidates: await getChoices(args && args.sessionId) }
      case 'generateChoices': {
        const candidates = await generateChoices(args && args.sessionId, args && args.messageId, args && args.guidance)
        return { choices: candidates.choices, candidates: candidates }
      }
      case 'addGuide': return { guides: await addGuide(args && args.sessionId, args && args.text) }
      case 'deleteGuide': return { guides: await deleteGuide(args && args.sessionId, args && args.index) }
      case 'getChat': {
        const chat = await readChat(args && args.chatId)
        if (chat === undefined) throw new Error('聊天不存在: ' + (args && args.chatId))
        const card = await readChatCard(chat)
        return { view: view(chat, card) }
      }
      case 'regenBody': return { view: await regenBody(args && args.chatId, args && args.guidance, args && args.sessionId) }
      case 'rollbackTurn': return { view: await rollbackTurn(args && args.sessionId, args && args.chatId) }
      default: throw new Error('未知方法: ' + method)
    }
  }

  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern',
      handler: async (req, res) => {
        const origin = req.headers.origin
        if (typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        try {
          const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
          const method = pathname.slice('/api/dsh-tavern'.length + 1)
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          let body = ''
          for await (const chunk of req) body += chunk
          let args = {}
          try {
            args = body.trim() === '' ? {} : JSON.parse(body)
          } catch (err) {
            res.writeHead(400)
            res.end('bad json')
            return
          }
          const result = await dispatch(method, args)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(Object.assign({ ok: true }, result)))
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: str(err && err.message || err) }))
        }
      }
    }), 'dsh-tavern: web route')
  }

  // ---------- 调试探针（模型可调用） ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    tools.register(defineTool({
      name: 'tavern_session',
      description: '读取当前会话的模式（游玩/卡片）与人物卡，并提交本轮结果。必须先 action=context；游玩模式的 context 同时传入本轮 userText，剧本类会话按游标注入当前参考分块（游标由候选项生成时调整，commit 不推进）。剧本会话和卡片模式（设定对话）可以用 action=script 只读查看剧本任意分块，向前向后看都行。最终回复前 action=commit。',
      parameters: {
        action: { type: 'string', required: true, description: 'context、commit、script 或 polish（script 只读查看剧本；polish 润色 draftText 后用于 commit）' },
        userText: { type: 'string', description: 'context 与 commit 时都填写用户本轮原始消息' },
        assistantText: { type: 'string', description: 'commit 时填写准备作为最终回复的完整文本' },
        draftText: { type: 'string', description: 'action=polish 时填写待润色的正文初稿' },
        cardPatch: { type: 'string', description: '仅卡片模式（设定对话/素材抽取）使用：确认落盘时填写人物卡字段 patch JSON；只讨论则填 {}' },
        scriptQuery: { type: 'string', description: 'action=script 时可选：按关键词检索剧本分块；剧本会话仅在游标前后 10 块内检索，命中返回前后各 1 块' },
        scriptOffset: { type: 'number', description: 'action=script 时可选：按 1 起始的块号读取，可向前或向后查看任意分块；剧本会话中缺省为当前游标' },
        scriptLimit: { type: 'number', description: 'action=script 时可选：剧本会话连续读取 1~21 块（默认 1）；卡片模式设定对话读取 1~6 块（默认 3）' }
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function (_a, value) {
          if (value && value.ready === false) return [{ type: 'text', text: str(value.message) || '尚未选择人物卡' }]
          if (value && value.mode === 'polish') return [{ type: 'text', text: '润色结果\n\n' + (value.polishedText || '') }]
          if (value && value.mode === 'script-read') return [{ type: 'text', text: '剧本《' + (value.title || '未命名') + '》第 ' + value.from + '~' + value.to + ' 块 / 共 ' + value.totalChunks + ' 块\n\n' + (value.text || '') }]
          if (value && value.saved === true) return [{ type: 'text', text: value.mode === 'revision' ? ('卡片模式设定对话已保存' + (value.changed ? '，人物卡字段已更新' : '，人物卡未改动')) : '故事状态已更新' }]
          if (value && value.ready === true) return [{ type: 'text', text: 'mode=' + (value.mode || 'story') + '\n人物卡=' + (value.cardName || '未命名') + '\n\n' + (value.systemContext || '') }]
          return [{ type: 'text', text: '酒馆状态已载入' }]
        }
      },
      async execute(args, exec) {
        const sessionId = (exec && exec.agent && exec.agent.session) ? exec.agent.session.id : ''
        const nativeTurn = nativeTurnOf(exec)
        const action = str(args && args.action)
        const chat = await chatForSession(sessionId)
        if (action === 'script') {
          if (chat === undefined) return { ready: false, message: '尚未选择人物卡，无法读取剧本。' }
          const chatMode = chat.mode || 'story'
          if (chatMode !== 'revision' && chatMode !== 'script') throw new Error('action=script 仅在卡片模式（设定对话）或游玩模式（剧本会话）中用于读取已绑定剧本')
          const script = await readScript(chat.cardId)
          if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) return { ready: false, message: '当前人物卡没有绑定剧本，无法读取。' }
          if (chatMode === 'script') {
            const windowResult = scriptPlayWindow(script, chat, args && args.scriptQuery, args && args.scriptOffset, args && args.scriptLimit)
            if (windowResult.notFound === true) return { ready: false, message: '游标前后 10 块内没有找到包含“' + str(args && args.scriptQuery).trim() + '”的分块，请换一个关键词，或用 scriptOffset 直接按块号读取。' }
            if (windowResult.chunks.length === 0) return { ready: false, message: '剧本分块为空。' }
            const text = windowResult.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + (Number(chunk.order) + 1) + ' 块]\n' + chunk.text }).join('\n\n')
            if (chat.scriptState !== null && typeof chat.scriptState === 'object') {
              if (Number(chat.scriptState.lookaheadTurn) !== Number(nativeTurn)) {
                chat.scriptState.lookahead = []
                chat.scriptState.lookaheadTurn = Number(nativeTurn) || 0
              }
              const ids = new Set((chat.scriptState.lookahead || []).map(function (item) { return item && item.id }))
              for (const chunk of windowResult.chunks) {
                if (ids.has(chunk.id)) continue
                ids.add(chunk.id)
                chat.scriptState.lookahead.push({ id: chunk.id, order: Number(chunk.order) || 0, text: str(chunk.text) })
              }
              await writeChat(chat)
            }
            return {
              ready: true,
              mode: 'script-read',
              cardName: chat.cardName,
              title: windowResult.title,
              totalChunks: windowResult.total,
              from: windowResult.from,
              to: windowResult.to,
              cursor: windowResult.cursor,
              text: text,
              hint: '只读预览，不会推进游标。默认只返回当前游标 1 块；需要更多时用 scriptOffset 指定起始块号，scriptLimit 指定连续读取 1~21 块，scriptQuery 在游标前后 10 块内检索（命中返回前后各 1 块）。'
            }
          }
          const windowResult = scriptReadWindow(script, args && args.scriptQuery, args && args.scriptOffset, args && args.scriptLimit)
          if (windowResult.notFound === true) return { ready: false, message: '剧本中没有找到包含“' + str(args && args.scriptQuery).trim() + '”的分块，请换一个关键词，或用 scriptOffset 直接按块号读取。' }
          if (windowResult.chunks.length === 0) return { ready: false, message: '剧本分块为空。' }
          const text = windowResult.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + (Number(chunk.order) + 1) + ' 块]\n' + chunk.text }).join('\n\n')
          return {
            ready: true,
            mode: 'script-read',
            cardName: chat.cardName,
            title: windowResult.title,
            totalChunks: windowResult.total,
            from: windowResult.from,
            to: windowResult.to,
            text: text,
            hint: '可继续用 action=script 读取其他分块：scriptQuery 按关键词检索，或 scriptOffset 按 1 起始的块号读取，scriptLimit 控制每次返回 1~6 块。'
          }
        }
        if (action === 'polish') {
          if (chat === undefined) return { ready: false, message: '尚未选择人物卡，无法润色正文。' }
          if ((chat.mode || 'story') === 'revision' || (chat.mode || 'story') === 'extract') throw new Error('仅游玩模式支持润色正文')
          const draftText = str(args && args.draftText).trim()
          if (draftText === '') throw new Error('draftText 不能为空')
          const previousTail = lastAssistantTail(chat, 240)
          let scriptText = ''
          if ((chat.mode || 'story') === 'script' && chat.scriptState !== null && typeof chat.scriptState === 'object') {
            const scriptParts = []
            if (chat.scriptState.prepared !== null && typeof chat.scriptState.prepared === 'object' && str(chat.scriptState.prepared.text) !== '') scriptParts.push(chat.scriptState.prepared.text)
            for (const item of (chat.scriptState.lookahead || [])) {
              if (item !== null && typeof item === 'object' && str(item.text) !== '' && scriptParts.indexOf(str(item.text)) < 0) scriptParts.push(str(item.text))
            }
            scriptText = scriptParts.join('\n\n')
          }
          const polishedText = await polishBody(chat, draftText, sessionId, previousTail, scriptText, chat.posture || '')
          await writePolishDiff(chat.id, chat.cardName, draftText, polishedText)
          return { ready: true, mode: 'polish', cardName: chat.cardName, polishedText: polishedText }
        }
        if (action === 'context') {
          if (chat === undefined) return { ready: false, message: '尚未选择人物卡，请提示用户在输入框上方选择人物卡。' }
          await ensureSettings()
          const mode = chat.mode || 'story'
          if (mode === 'extract') {
            const prepared = await prepareExtract(chat, nativeTurn)
            return {
              ready: true,
              mode: 'extract',
              cardName: (chat.extract && chat.extract.draft ? str(chat.extract.draft.name) : '') || '未命名角色',
              systemContext: buildExtractSystem(chat, prepared),
              opening: '',
              posture: '',
              lore: []
            }
          }
          const card = await readChatCard(chat)
          const editable = {}
          for (const field of CARD_TEXT_FIELDS) editable[field] = card[field] || ''
          editable.tags = card.tags || []
          editable.alternate_greetings = card.alternate_greetings || []
          editable.character_book = card.character_book || null
          const priorCommit = nativeCommitFor(chat, nativeTurn)
          const scriptReference = mode === 'script'
            ? (priorCommit && priorCommit.scriptReference ? priorCommit.scriptReference : await prepareScriptReference(chat, card, args && args.userText, sessionId, nativeTurn))
            : null
          const worldBookIds = mode === 'revision'
            ? []
            : await selectWorldBookEntries(chat, card, args && args.userText, sessionId, nativeTurn)
          let revisionScriptHint = ''
          if (mode === 'revision') {
            const scriptInfo = compactScriptInfo(await readScript(chat.cardId))
            revisionScriptHint = scriptInfo === null
              ? '\n\n本卡未绑定剧本。'
              : '\n\n本卡已绑定剧本《' + scriptInfo.title + '》，共 ' + scriptInfo.chunkCount + ' 块。如需查看剧本原文，调用 tavern_session action=script：scriptQuery 传关键词检索，或 scriptOffset 传 1 起始的块号，scriptLimit 控制每次读取 1~6 块；不要仅凭文件名猜测剧本内容。'
          }
          const scriptLookHint = mode === 'script'
            ? '\n\n【剧本参考范围】游标是候选项阶段标记的“当前看哪里”位置，本轮注入游标处这一块；commit 不推进游标。写初稿前先分析本块内容；需要了解后续剧情走向时，用 tavern_session action=script 主动前瞻：scriptOffset 指定块号可向前或向后看，scriptLimit 可连续读多块。'
            : ''
          const polishHint = settings.polish === true
            ? '\n\n【精修模式】本轮开启精修：正文初稿写好后，先调用 tavern_session action=polish（draftText 填初稿全文），得到 polishedText 后再调用 action=commit，assistantText 填 polishedText。'
            : '\n\n【精修模式】本轮精修已关闭：正文写好后直接调用 action=commit 提交，不要调用 action=polish。'
          return {
            ready: true,
            mode: mode,
            cardName: card.name,
            systemContext: mode === 'revision'
              ? '你正在卡片模式的人物卡设定对话中，与用户共同讨论和修正人物卡，不进行角色扮演，不续写剧情。可以分析、追问、提出多个方案。只有用户明确要求或确认修改时才生成最小 cardPatch；只讨论时 cardPatch 必须是 {}。可修改字段：' + CARD_TEXT_FIELDS.join(',') + ',tags,alternate_greetings,character_book。保留 {{char}}、{{user}} 模板变量。\n\n当前人物卡：\n' + JSON.stringify(editable) + revisionScriptHint
              : buildSystem(card, chat, scriptReference, worldBookIds) + scriptLookHint + polishHint,
            opening: substChar(card.first_mes, card, '你', '所有其他角色'),
            posture: chat.posture || '',
            lore: chat.lore || [],
            scriptCursor: mode === 'script' && chat.scriptState !== null && typeof chat.scriptState === 'object' ? Math.min(Math.max(1, Number(chat.scriptState.totalChunks) || 1), (Number(chat.scriptState.cursor) || 0) + 1) : undefined,
            scriptTotalChunks: mode === 'script' && chat.scriptState !== null && typeof chat.scriptState === 'object' ? (Number(chat.scriptState.totalChunks) || 0) : undefined
          }
        }
        if (action === 'commit') {
          if (chat === undefined) return { ready: false, message: '尚未选择人物卡' }
          const userText = str(args && args.userText).trim()
          const assistantText = str(args && args.assistantText).trim()
          if (assistantText === '') throw new Error('assistantText 不能为空')
          const priorCommit = nativeCommitFor(chat, nativeTurn)
          if (priorCommit !== null) return { saved: true, duplicate: true, mode: chat.mode || 'story', changed: priorCommit.changed === true, chatId: chat.id, cardName: chat.cardName }
          if ((chat.mode || 'story') === 'extract') {
            let patch = {}
            const rawPatch = str(args && args.cardPatch).trim()
            if (rawPatch !== '') {
              try { patch = JSON.parse(rawPatch) } catch (err) { throw new Error('cardPatch 必须是 JSON 对象') }
            }
            const changed = patch !== null && typeof patch === 'object' && Object.keys(patch).length > 0
            const ext = chat.extract !== null && typeof chat.extract === 'object' ? chat.extract : {}
            const draft = ext.draft !== null && typeof ext.draft === 'object' ? ext.draft : {}
            if (patch !== null && typeof patch === 'object' && typeof patch.player === 'string') {
              const nextPlayer = str(patch.player).trim()
              if (nextPlayer !== '') ext.player = nextPlayer
            }
            if (changed) {
              for (const field of CARD_TEXT_FIELDS) {
                if (typeof patch[field] === 'string' && str(patch[field]).trim() !== '') draft[field] = str(patch[field]).trim()
              }
              if (Array.isArray(patch.tags)) draft.tags = patch.tags.map(str).filter(function (x) { return x !== '' })
              draft.updatedAt = Date.now()
            }
            commitExtract(chat, nativeTurn)
            if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: Date.now(), native: true })
            chat.messages.push({ role: 'assistant', text: assistantText, ts: Date.now(), native: true, changed: changed })
            chat.pending = null
            chat.cardName = str(draft.name) || '抽取中'
            rememberNativeCommit(chat, nativeTurn, { mode: 'extract', userText: userText, changed: changed })
            await writeChat(chat)
            return { saved: true, mode: 'extract', changed: changed, chatId: chat.id, cardName: chat.cardName }
          }
          if ((chat.mode || 'story') === 'revision') {
            let patch = {}
            const rawPatch = str(args && args.cardPatch).trim()
            if (rawPatch !== '') {
              try { patch = JSON.parse(rawPatch) } catch (err) { throw new Error('cardPatch 必须是 JSON 对象') }
            }
            const changed = patch !== null && typeof patch === 'object' && Object.keys(patch).length > 0
            let savedCard = await readChatCard(chat)
            if (changed) savedCard = await updateCard(chat.cardId, patch, { ts: Date.now(), instruction: userText, summary: '通过卡片模式设定对话更新人物卡' })
            if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: Date.now(), native: true })
            chat.messages.push({ role: 'assistant', text: assistantText, ts: Date.now(), native: true, changed: changed })
            chat.cardName = savedCard.name
            chat.pending = null
            rememberNativeCommit(chat, nativeTurn, { mode: 'revision', userText: userText, changed: changed })
            await writeChat(chat)
            return { saved: true, mode: 'revision', changed: changed, chatId: chat.id, cardName: savedCard.name }
          }
          const commitBefore = {
            posture: chat.posture || '',
            awaitingScene: chat.awaitingScene === true,
            scriptState: (chat.mode || 'story') === 'script' && chat.scriptState !== null && typeof chat.scriptState === 'object'
              ? {
                  cursor: Number(chat.scriptState.cursor) || 0,
                  recalledChunkIds: Array.isArray(chat.scriptState.recalledChunkIds) ? chat.scriptState.recalledChunkIds.slice() : [],
                  skippedChunkIds: Array.isArray(chat.scriptState.skippedChunkIds) ? chat.scriptState.skippedChunkIds.slice() : [],
                  lastReference: chat.scriptState.lastReference !== null && typeof chat.scriptState.lastReference === 'object' ? Object.assign({}, chat.scriptState.lastReference) : null
                }
              : undefined
          }
          const preparedReference = (chat.mode || 'story') === 'script' && chat.scriptState && chat.scriptState.prepared
            ? Object.assign({}, chat.scriptState.prepared)
            : null
          if ((chat.mode || 'story') === 'script') commitScriptReference(chat, userText, nativeTurn)
          if (userText.indexOf('【场景变化】') === 0) chat.awaitingScene = false
          if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: Date.now(), native: true })
          chat.messages.push({ role: 'assistant', text: assistantText, ts: Date.now(), native: true })
          chat.pending = null
          chat.settleStatus = 'running'
          chat.settleError = null
          rememberNativeCommit(chat, nativeTurn, { mode: chat.mode || 'story', userText: userText, scriptReference: preparedReference }, commitBefore)
          await writeChat(chat)
          queueSettlement(chat.id)
          return { saved: true, chatId: chat.id, cardName: chat.cardName }
        }
        throw new Error('action 仅支持 context 或 commit')
      }
    }))

  }
}
