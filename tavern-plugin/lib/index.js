import { defineTool } from '@deepseek-ai/dsh-tools'
import { copyFileSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// 调试：注册 tavern_probe 模型工具
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

  // ---------- Tavern preset 运行时副本 ----------
  // DSH 启动器只发现 `<dshHome>/.agent-presets` 里的用户 preset，且会覆盖 profile
  // 自己声明的 roots；因此 profile 的 `presets/tavern/` 是唯一维护副本，插件启动时
  // 自动同步到运行时目录。用户不需要手动管理该目录，删掉后重启（或新建会话）即自愈。
  const dshHome = (() => {
    const env = process.env.DSH_HOME
    return typeof env === 'string' && env.trim() !== '' ? env.replace(/\/+$/, '') : join(homedir(), '.dsh')
  })()
  const presetSourceDir = join(dshHome, 'profiles', 'tavern', 'presets', 'tavern')
  const presetRuntimeDir = join(dshHome, '.agent-presets', 'tavern')
  async function ensureRuntimePreset() {
    await mkdir(presetRuntimeDir, { recursive: true })
    await copyFile(join(presetSourceDir, 'agent.cordis.yml'), join(presetRuntimeDir, 'agent.cordis.yml'))
    await copyFile(join(presetSourceDir, 'preset.yml'), join(presetRuntimeDir, 'preset.yml'))
  }
  try {
    mkdirSync(presetRuntimeDir, { recursive: true })
    copyFileSync(join(presetSourceDir, 'agent.cordis.yml'), join(presetRuntimeDir, 'agent.cordis.yml'))
    copyFileSync(join(presetSourceDir, 'preset.yml'), join(presetRuntimeDir, 'preset.yml'))
    console.log('dsh-tavern: tavern preset 运行时副本已同步')
  } catch (err) {
    console.error('dsh-tavern: tavern preset 运行时副本同步失败', err)
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
  let settings = { candidates: 3, temperature: 1.0, provider: '', model: '' }
  let settingsReady = null
  const settlementJobs = new Set()
  async function loadSettings() {
    const s = await readJson('settings.json')
    if (s !== undefined && typeof s === 'object') {
      settings.candidates = clampInt(s.candidates, 1, 6, settings.candidates)
      settings.temperature = typeof s.temperature === 'number' && isFinite(s.temperature) ? Math.min(1.5, Math.max(0, s.temperature)) : settings.temperature
      settings.provider = str(s.provider)
      settings.model = str(s.model)
    }
  }
  function ensureSettings() {
    if (settingsReady === null) settingsReady = loadSettings()
    return settingsReady
  }
  async function saveSettings() {
    await writeJson('settings.json', settings)
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
      extract: chatMode === 'extract' ? { sourceIds: [], cursor: 0, prepared: null, done: false, draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', tags: [] } } : null,
      messages: [],
      posture: '',
      sessionId: '',
      lore: [],
      pending: null,
      awaitingScene: false,
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
  async function findChat(cardId) {
    const idx = await readIndex()
    const hit = (idx.chats || []).filter(function (c) { return c.cardId === cardId })[0]
    if (hit === undefined) return undefined
    const chat = await readChat(hit.id)
    return chat === undefined ? undefined : chat
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
    try { await ensureRuntimePreset() } catch (err) { console.error('dsh-tavern: 新建会话前同步 preset 失败', err) }
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
      chat.scriptState.totalChunks = script.chunks.length
      chat.scriptState.title = script.title || card.name + '剧本'
      chat.scriptState.scriptVersion = Number(script.importedAt) || 0
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
  async function generateChoices(sessionId, messageId, guidance) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'revision' || (chat.mode || 'story') === 'extract') throw new Error('卡片模式不生成剧情候选项')
    const card = await readChatCard(chat)
    const sel = modelSelection(sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    const awaitingScene = chat.awaitingScene === true
    const guide = str(guidance).trim().slice(0, 600)
    const task = awaitingScene
      ? '你现在不是续写正文，而是为玩家生成下一场景的候选提要。只输出 JSON：{"choices":[{"type":"scene2","text":"选项内容"}]}。恰好三个选项，type 全部为 scene2；每项 10~80 字；每个选项都是一段【完全不同的新场景提要】——写明新时间、新地点、新人物组合（可增减出场人物）与开场画面，彼此之间差异要大，不要求与上一场景衔接；这些提要在玩家选中后会被正文完整展开演绎，所以只写场景本身，不要提前描述剧情发展。'
      : '你现在不是续写正文，而是为玩家生成下一步候选。只输出 JSON：{"choices":[{"type":"player|npc|scene","text":"选项内容"}]}。恰好五个选项，type 依次为 player、player、player、npc、scene；每项 10~80 字；player：玩家视角写玩家角色的行动或台词，三个玩家行动要各有侧重、彼此不重复；npc：写其他角色的行动或台词（角色必须带名字，正文会以该角色行动为主推进）；scene：写结束当前场景的收尾（收束当前场面：人物反应、情绪、环境收束或时间流逝，作为本场景的落幕）；不要提前描述行动结果。'
    const taskSystem = task + (guide !== '' ? '\n\n【用户对候选项的额外要求 · 必须遵循，但仍要保证恰好 ' + (awaitingScene ? '3' : '5') + ' 个候选且类型要求不变】\n' + guide : '')
    const baseRequest = awaitingScene ? '上一场景已经结束。构思三个完全不同的新场景提要。' : '根据当前剧情，生成五个下一步候选：三个玩家行动、一个其他角色行动、一个场景结束。'
    const system = buildSystem(card, chat) + '\n\n【额外任务】' + taskSystem
    const messages = buildMessages(chat, sel, 30).concat([{
      id: 'choices-' + Date.now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: baseRequest + (guide !== '' ? '\n用户对候选的额外要求：' + guide : '') }],
      source: { kind: 'plugin', plugin: 'dsh-tavern' }
    }])
    let lastError = null
    let lastRaw = ''
    const maxChoices = awaitingScene ? 3 : 5
    const temps = [0.8, 1.0, 1.1]
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await callModel({
          sessionId: sessionId,
          temperature: temps[(attempt - 1) % temps.length],
          maxTokens: 2400,
          system: system,
          messages: messages
        })
        lastRaw = text
        const parsed = parseJsonLenient(text)
        let source = Array.isArray(parsed.choices) ? parsed.choices : (Array.isArray(parsed.options) ? parsed.options : [])
        // 模型偶发输出被 maxTokens 截断成不完整 JSON：直接从原文里把每个 choice 对象抠出来。
        if (source.length === 0) source = parseChoiceObjects(text)
        const choices = []
        for (let i = 0; i < source.length && choices.length < maxChoices; i++) {
          const item = source[i]
          const raw = typeof item === 'string' ? item : (item !== null && typeof item === 'object' ? str(item.text) : '')
          const content = raw.trim().slice(0, 120)
          if (content === '') continue
          let type = 'player'
          if (item !== null && typeof item === 'object') {
            const t = str(item.type).trim().toLowerCase()
            if (t === 'npc' || t === 'character' || t === '角色') type = 'npc'
            else if (t === 'scene' || t === '场景') type = 'scene'
            else if (t === 'scene2' || t === 'newscene' || t === '新场景') type = 'scene2'
          }
          choices.push({ type: type, text: content })
        }
        if (choices.length === 0) throw new Error('模型没有返回有效候选项')
        chat.candidates = {
          messageId: str(messageId),
          choices: choices,
          generatedAt: Date.now()
        }
        await writeChat(chat)
        return chat.candidates
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
        const type = item.type === 'npc' || item.type === 'scene' || item.type === 'scene2' ? item.type : 'player'
        return { type: type, text: str(item.text).trim() }
      }
      return { type: 'player', text: str(item).trim() }
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
    parts.push('你是小说续写引擎。下面是一份【故事设定】（人物卡即故事的开头与隐藏设定）。你要以小说正文的形式续写这个故事。')
    parts.push('【叙事要求】\n1. 输出一段约 150 字的完整小说正文，不要输出任何解释、点评或元信息。\n2. 正文中可以把"你"（玩家角色）的行动与台词、主要人物的行动与心理、其他 NPC 的出现与行动、环境与时间的推移全部织入叙述，像小说一样自然推进；除"你"之外的所有角色都由你扮演与叙述。\n3. 把"用户"的最新消息理解为导演指令并按前缀标记理解：无标记或「玩家行动」=玩家角色"你"的行动或台词；「角色行动」=其他角色的行动或台词，正文以该角色行动为主推进，玩家角色也可继续出场；「场景结束」=结束当前场景，正文只做本场景的收尾（收束动作、情绪、环境，可带时间流逝的落幕感），不要开启新场景；「新场景」=用户给出一段压缩的场景提要，正文的任务不是从提要结束后接着写，而是把这段提要展开演绎成完整的小说正文：从提要的起点写起，把环境、人物动作、对话台词与情绪反应逐一写细，把被压缩掉的中间过程补回来；对话要原样演出。可以写到提要最后一个画面作为落点，也可以在其自然处收束，但绝不能把提要当作已经发生过的事实，也绝不能跳过提要直接写之后的情节。时间、地点、人物组合可以完全不同，不必与上一场景衔接。若本轮是「新场景」的展开，正文写 250~400 字，把提要完整演完。绝不评论或跳出故事。\n4. 除「新场景」外，用户消息只是"接下来要发生什么"的分镜指令，不是已经完成的事实。正文的任务是把这段指令完整复述、重新演绎成小说正文，而不是从指令之后接着写：先从当前【现场】自然承接（环境、人物反应），再把指令里的每个动作、台词、眼神、心理变化一一演出来，最后一句必须落在指令最后一个动作发生或完成的画面上，最多一笔收束。绝不允许把指令写成已发生的过去状态；绝不允许写指令里没有的新动作、新台词或新情节——例如指令只是"看着宝钗通红的耳根，伸手轻抚她散开的鬓发"，正文就不能接着写亲吻、说话或更进一步的动作，只能演完注视与抚发的瞬间。\n5. 文风与叙事节奏参照【文风示例】（为空则自行选择合适的小说文风，保持前后一致）。\n6. 若与【现场 · 主要人物状态】冲突，以【现场】为准。')
    const wb = worldBookLines(card, worldBookIds)
    if (wb.length > 0) parts.push('【世界设定】\n' + wb.join('\n'))
    if (str(chat.posture) !== '') parts.push('【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + chat.posture)
    parts.push('【故事设定 · 人物卡】\n名字: ' + str(card.name))
    if (str(card.description) !== '') parts.push('设定: ' + substChar(card.description, card, '你', '所有其他角色'))
    if (str(card.personality) !== '') parts.push('主要人物性格: ' + card.personality)
    if (str(card.scenario) !== '') parts.push('开场情境: ' + card.scenario)
    if (str(card.mes_example) !== '') parts.push('【文风示例】\n' + substChar(card.mes_example, card, '你', '所有其他角色'))
    if (str(card.post_history_instructions) !== '') parts.push('【附加要求】\n' + card.post_history_instructions)
    if (str(card.system_prompt) !== '') parts.push('【特殊指令】\n' + card.system_prompt)
    if (scriptReference !== null && scriptReference !== undefined && str(scriptReference.text) !== '') {
      parts.push('【本轮剧本参考 · 仅本轮召回一次】\n' + scriptReference.text)
      parts.push('【剧本模式要求】\n自然承接玩家当前行动，同时始终把剧情引向这段剧本所提供的人物、事件、场面与发展方向。参考原文的行文风格和叙事节奏，但不要解释你在参考剧本，也不要求在本轮约150字内完整演完。')
    }
    return parts.join('\n\n')
  }
  function normalizeScriptState(chat, script) {
    if (chat.scriptState === null || typeof chat.scriptState !== 'object') chat.scriptState = {}
    const state = chat.scriptState
    const version = Number(script.importedAt) || 0
    if ((Number(state.scriptVersion) || 0) !== version) {
      state.cursor = 0
      state.recalledChunkIds = []
      state.skippedChunkIds = []
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
    const windowChunks = script.chunks.slice(state.cursor, Math.min(script.chunks.length, state.cursor + 5))
    let selected = windowChunks[0]
    if (windowChunks.length > 1) {
      const recent = (chat.messages || []).slice(-6).map(function (message) { return (message.role === 'assistant' ? '正文' : '玩家') + ': ' + str(message.text) }).join('\n')
      try {
        const raw = await callModel({
          sessionId: sessionId || chat.sessionId,
          temperature: 0.1,
          maxTokens: 800,
          system: '你是线性小说剧本的分块选择器。每轮必须从游标附近候选中选择一个分块，让续写自然地朝原小说发展。优先选择顺序最早、与当前人物和场景能够自然衔接的分块；即使没有完全匹配，也必须选择一块，后续正文会负责自然铺垫。只输出 JSON：{"chunkId":"chunk-xxxxx"}。',
          messages: [{
            id: 'script-select-' + Date.now().toString(36),
            role: 'user',
            content: [{ type: 'text', text: '【最近剧情】\n' + (recent || '（只有开场白）') + '\n\n【玩家本轮输入】\n' + (request || '（无）') + '\n\n【当前姿势】\n' + (chat.posture || '（无）') + '\n\n【候选分块】\n' + windowChunks.map(function (chunk) { return '[' + chunk.id + ']\n' + chunk.text }).join('\n\n') }],
            source: { kind: 'plugin', plugin: 'dsh-tavern-script-selector' }
          }]
        })
        const parsed = parseJsonLenient(raw)
        const hit = windowChunks.find(function (chunk) { return chunk.id === str(parsed.chunkId).trim() })
        if (hit !== undefined) selected = hit
      } catch (err) {
        console.error('dsh-tavern: 剧本分块选择失败，回退到游标分块', err)
      }
    }
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
    if (prepared.ended !== true && str(prepared.chunkId) !== '') {
      if (!state.recalledChunkIds.includes(prepared.chunkId)) state.recalledChunkIds.push(prepared.chunkId)
      const before = Number(prepared.cursorBefore) || 0
      const order = Number(prepared.order) || 0
      for (let index = before; index < order; index++) {
        const skippedId = 'chunk-' + String(index + 1).padStart(5, '0')
        if (!state.skippedChunkIds.includes(skippedId)) state.skippedChunkIds.push(skippedId)
      }
      state.cursor = Math.max(Number(state.cursor) || 0, order + 1)
      state.lastReference = { chunkId: prepared.chunkId, order: order, text: prepared.text, userText: str(userText), recalledAt: Date.now() }
    }
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
  async function buildCandidates(chat, card, sel, sessionId) {
    const n = clampInt(settings.candidates, 1, 6, 3)
    const jobs = []
    for (let i = 0; i < n; i++) {
      const temp = Math.min(1.5, settings.temperature + i * 0.05)
      jobs.push(callModel({
        messages: buildMessages(chat, sel, 40),
        system: buildSystem(card, chat),
        temperature: temp,
        sessionId: sessionId
      }).then(
        function (t) { return { text: t, error: null } },
        function (err) { return { text: '', error: str(err && err.message || err) } }
      ))
    }
    return await Promise.all(jobs)
  }

  // ---------- 生成 / 选择 / 重掷 ----------
  async function generate(chatId, userText, sessionId) {
    await ensureSettings()
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    const text = str(userText).trim()
    if (text === '') throw new Error('消息为空')
    chat.messages.push({ role: 'user', text: text, ts: Date.now() })
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    const sel = modelSelection(chat.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    const results = await buildCandidates(chat, card, sel, chat.sessionId)
    chat.pending = { userText: text, candidates: results, ts: Date.now() }
    await writeChat(chat)
    return view(chat, card)
  }
  async function reroll(chatId, sessionId) {
    await ensureSettings()
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    const pending = chat.pending
    if (pending === null || pending === undefined) throw new Error('没有可重掷的待选回复')
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    const sel = modelSelection(chat.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    const results = await buildCandidates(chat, card, sel, chat.sessionId)
    chat.pending = { userText: pending.userText, candidates: results, ts: Date.now() }
    await writeChat(chat)
    return view(chat, card)
  }
  async function choose(chatId, index, sessionId) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    const pending = chat.pending
    if (pending === null || pending === undefined || !Array.isArray(pending.candidates)) throw new Error('当前没有待选择的候选回复')
    const i = clampInt(index, 0, pending.candidates.length - 1, -1)
    if (i < 0) throw new Error('候选序号无效')
    const chosen = pending.candidates[i]
    if (chosen === null || chosen === undefined || str(chosen.text) === '') throw new Error('该候选生成失败，请选择其他候选或重新生成')
    chat.messages.push({ role: 'assistant', text: str(chosen.text), ts: Date.now() })
    chat.pending = null
    chat.settleStatus = 'running'
    chat.settleError = null
    await writeChat(chat)
    queueSettlement(chat.id)
    return view(chat, card)
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
    const re = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
    let m
    while ((m = re.exec(text)) !== null) {
      const type = m[1].trim().toLowerCase()
      const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim()
      if (content !== '') out.push({ type: type, text: content })
    }
    return out
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
  function rememberNativeCommit(chat, turn, value) {
    if (!turn) return
    if (chat.nativeCommits === null || typeof chat.nativeCommits !== 'object') chat.nativeCommits = {}
    chat.nativeCommits[String(turn)] = Object.assign({ turn: turn, committedAt: Date.now() }, value)
    const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
    for (const oldTurn of keys.slice(40)) delete chat.nativeCommits[String(oldTurn)]
  }
  async function settleNow(chatId, sessionId) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    chat.settleStatus = 'running'
    chat.settleError = null
    await writeChat(chat)
    queueSettlement(chat.id)
    return view(chat, card)
  }

  // ---------- 记忆条目编辑 ----------
  async function updateLore(chatId, loreId, patch) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    const entry = (chat.lore || []).filter(function (e) { return e.id === loreId })[0]
    if (entry === undefined) throw new Error('记忆条目不存在')
    if (patch !== null && typeof patch === 'object') {
      if (typeof patch.content === 'string' && str(patch.content).trim() !== '') entry.content = str(patch.content).trim()
      if (typeof patch.type === 'string' && str(patch.type).trim() !== '') entry.type = str(patch.type).trim().slice(0, 12)
      entry.ts = Date.now()
    }
    await writeChat(chat)
    return view(chat, card)
  }
  async function deleteLore(chatId, loreId) {
    const chat = await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    chat.lore = (chat.lore || []).filter(function (e) { return e.id !== loreId })
    await writeChat(chat)
    return view(chat, card)
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
    const parts = []
    parts.push('你在酒馆的卡片模式（素材抽取）中：根据给定的剧本/小说素材，与用户讨论并提炼出一张新的人物卡。你不续写剧情、不进行角色扮演。')
    parts.push('【人物卡可提炼字段】name（角色名）、description（角色描述：身份、外貌、背景）、personality（性格）、scenario（开场情境）、first_mes（开场白，写第一幕）、mes_example（对话示例，<START> 分隔，用 {{char}}/{{user}} 模板）、system_prompt、post_history_instructions、tags（字符串数组）。')
    parts.push('【规则】\n1. 只依据素材与对话中已确认的信息写卡，素材不足时向用户提问或给多个方案。\n2. 用户可以指定角色（如“抽取王夫人”）或指定卡类型（单一角色/多角色卡）。\n3. 每轮可以讨论、提问或给出草稿片段；只有用户明确确认修改时，才在 commit 时输出最小 draftPatch（JSON 对象，只含要改的字段）；只讨论时 draftPatch 必须是 {}。\n4. 素材按游标分批注入，未读部分会在后续轮次继续注入，不要担心一次读不完。')
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
      draft: ext.draft || {}
    }
  }
  async function startExtract(sourceIds, sessionId) {
    try { await ensureRuntimePreset() } catch (err) { console.error('dsh-tavern: 新建抽取会话前同步 preset 失败', err) }
    const ids = (Array.isArray(sourceIds) ? sourceIds : []).filter(function (id) { return str(id) !== '' })
    if (ids.length === 0) throw new Error('请先选择抽取素材')
    const chat = newChat({ id: '', name: '抽取中' }, 'extract')
    chat.extract.sourceIds = ids
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    const titles = []
    const idx = await readIndex()
    for (const id of ids) {
      const item = (idx.sources || []).filter(function (s) { return s.id === id })[0]
      if (item !== undefined) titles.push(item.title)
    }
    const greeting = '卡片模式 · 素材抽取：素材《' + titles.join('》《') + '》。我会根据你的要求从中提炼人物卡。你可以指定角色（如“抽取王夫人”）或卡类型（单一角色/多角色卡），也可以直接说“开始抽取”，我先通读素材给出初稿。'
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
    const draft = chat.extract && chat.extract.draft ? chat.extract.draft : {}
    if (str(draft.name).trim() === '') throw new Error('草稿还没有角色名，请先在对话中确认')
    const card = normalizeCard(draft)
    card.creator_notes = str(card.creator_notes || '') + '\n[抽取生成] ' + ((chat.extract && chat.extract.sourceIds) || []).join(',')
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
    const sel = modelSelection(chat.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置')
    // 1) 生成新正文（以上一轮玩家输入为准，去掉旧正文，指导意见可选）
    const src = regenSourceMessages(chat)
    let hasUser = false
    const messages = []
    for (let i = 0; i < src.length; i++) {
      const m = src[i]
      if (m === null || typeof m !== 'object' || str(m.text) === '') continue
      if (m.role === 'user') hasUser = true
      messages.push({
        id: 'regen-' + i + '-' + Date.now().toString(36),
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: str(m.text) }],
        source: m.role === 'assistant' ? { kind: 'model', provider: sel.provider, model: sel.model } : { kind: 'plugin', plugin: 'dsh-tavern' }
      })
    }
    if (!hasUser) throw new Error('没有可重新生成的玩家输入')
    const guide = str(guidance).trim()
    let system = buildSystem(card, chat, null)
    if (guide !== '') system += '\n\n【正文生成指导 · 用户针对本次重新生成的指导意见，必须遵循，优先级高于默认叙事要求】\n' + guide
    const raw = await callModel({
      messages: messages,
      system: system,
      temperature: settings.temperature,
      maxTokens: 2048,
      sessionId: chat.sessionId
    })
    const body = str(raw).trim()
    if (body === '') throw new Error('重新生成失败：模型返回空文本')
    // 2) 插件 chat 数据：直接替换最后一条正文
    let replaced = false
    const msgs = chat.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] !== null && typeof msgs[i] === 'object' && msgs[i].role === 'assistant' && msgs[i].greeting !== true) {
        msgs[i].text = body
        msgs[i].ts = Date.now()
        replaced = true
        break
      }
    }
    if (!replaced) throw new Error('没有可替换的正文消息')
    // 3) 原生消息流：可见追加新正文 + 模型面替换旧正文（DSH 界面只显示 append 事件）
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(chat.sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
    let oldSeq = -1
    let oldTurn = 0
    for (let i = nodes.length - 1; i >= 0; i--) {
      const candidate = session.events[nodes[i]]
      if (candidate !== undefined && candidate.type === 'assistant/message') {
        oldSeq = nodes[i]
        oldTurn = Number(candidate.data.turn) || 0
        break
      }
    }
    if (oldSeq < 0) throw new Error('原生消息流中找不到可替换的正文消息')
    const newTurn = nextTurnOf(session)
    const step = 1
    session.append('turn/start', { turn: newTurn })
    session.append('step/start', { turn: newTurn, step: step })
    const visibleEvent = session.append('assistant/message', {
      turn: newTurn,
      step: step,
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: body }],
        source: { kind: 'model', provider: sel.provider, model: sel.model }
      }
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    session.append('step/end', { turn: newTurn, step: step })
    session.append('turn/end', { turn: newTurn, reason: { kind: 'completed' } })
    // 模型面：遮蔽旧正文与刚追加的可见正文，模型只看到一份新正文
    session.append('assistant/message', {
      turn: newTurn,
      step: step,
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: body }],
        source: { kind: 'model', provider: sel.provider, model: sel.model }
      }
    }, {
      surfaceOp: { op: 'replace', start: oldSeq, end: visibleEvent.seq },
      sourceEventSeqs: [oldSeq, visibleEvent.seq]
    })
    if (agent.phase !== undefined && agent.phase !== null && agent.phase.kind === 'idle') {
      agent.phase.lastTurn = Math.max(Number(agent.phase.lastTurn) || 0, newTurn)
    }
    chat.settleStatus = 'running'
    chat.settleError = null
    chat.updatedAt = Date.now()
    await writeChat(chat)
    queueSettlement(chat.id)
    const result = view(chat, card)
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, newTurn: newTurn }
    return result
  }

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args) {
    await ensureSettings()
    switch (method) {
      case 'listCards': return { cards: await listCards() }
      case 'getScriptInfo': return { script: compactScriptInfo(await readScript(args && args.cardId)) }
      case 'importScript': return { script: await importScript(args && args.cardId, args && args.payload) }
      case 'deleteScript': return await deleteScript(args && args.cardId)
      case 'listSources': return { sources: await listSources() }
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'deleteSource': return await deleteSource(args && args.sourceId)
      case 'startExtract': return { view: await startExtract(args && args.sourceIds, args && args.sessionId) }
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
      case 'getSettings': return { settings: settings }
      case 'setSettings': {
        if (args !== null && typeof args === 'object') {
          if (Number.isInteger(args.candidates)) settings.candidates = clampInt(args.candidates, 1, 6, settings.candidates)
          if (typeof args.temperature === 'number' && isFinite(args.temperature)) settings.temperature = Math.min(1.5, Math.max(0, args.temperature))
          if (typeof args.provider === 'string') settings.provider = args.provider
          if (typeof args.model === 'string') settings.model = args.model
        }
        await saveSettings()
        return { settings: settings }
      }
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
      case 'getChat': {
        const chat = await readChat(args && args.chatId)
        if (chat === undefined) throw new Error('聊天不存在: ' + (args && args.chatId))
        const card = await readChatCard(chat)
        return { view: view(chat, card) }
      }
      case 'generate': return { view: await generate(args && args.chatId, args && args.text, args && args.sessionId) }
      case 'reroll': return { view: await reroll(args && args.chatId, args && args.sessionId) }
      case 'choose': return { view: await choose(args && args.chatId, args && args.index, args && args.sessionId) }
      case 'settleNow': return { view: await settleNow(args && args.chatId, args && args.sessionId) }
      case 'updateLore': return { view: await updateLore(args && args.chatId, args && args.loreId, args && args.patch) }
      case 'deleteLore': return { view: await deleteLore(args && args.chatId, args && args.loreId) }
      case 'regenBody': return { view: await regenBody(args && args.chatId, args && args.guidance, args && args.sessionId) }
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
  const DEMO_CARD = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '阿芙拉',
      description: '边境小酒馆"金麦穗"的老板娘，三十出头，红发，绿眼睛，精明爽利，消息灵通，酒馆里人人都敬她三分。',
      personality: '爽朗热情，精明世故，爱开玩笑，看重朋友，讨厌闹事的人；酒馆是她的地盘，也是情报集散地。',
      scenario: '雨夜，你风尘仆仆地推开"金麦穗"酒馆的门。店内炉火正旺，客人不多。',
      first_mes: '哟，稀客！雨下这么大还赶路？快进来坐，先把外套晾晾。想喝点什么？今天有热麦酒，配刚出炉的黑面包。',
      mes_example: '<START>\n{{user}}: 来一杯麦酒。\n{{char}}: 好嘞！\n*阿芙拉麻利地倒满一大杯，麦酒泡沫漫到杯沿，她把杯子"咚"地搁在你面前。*\n第一杯算我的，看你淋成落汤鸡的份上。\n<START>\n{{user}}: 最近镇子上有什么新鲜事？\n{{char}}: *阿芙拉擦着酒杯，朝你倾了倾身子，压低声音。*\n新鲜事可多了。就昨儿，货郎老皮特的骡子丢了一只，结果在后巷和磨坊主的山羊卿卿我我呢。要听更值钱的，得看你能出什么价。',
      tags: ['奇幻', '酒馆', '老板娘'],
      system_prompt: '',
      post_history_instructions: ''
    }
  }
  function demoCard() {
    const card = normalizeCard(DEMO_CARD)
    card.id = 'card-demo'
    return card
  }
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    tools.register(defineTool({
      name: 'tavern_session',
      description: '读取当前会话的模式（游玩/卡片）与人物卡，并提交本轮结果。必须先 action=context；游玩模式的 context 同时传入本轮 userText，剧本类会话会召回一个游标附近分块。最终回复前 action=commit。',
      parameters: {
        action: { type: 'string', required: true, description: 'context 或 commit' },
        userText: { type: 'string', description: 'context 与 commit 时都填写用户本轮原始消息' },
        assistantText: { type: 'string', description: 'commit 时填写准备作为最终回复的完整文本' },
        cardPatch: { type: 'string', description: '仅卡片模式（设定对话/素材抽取）使用：确认落盘时填写人物卡字段 patch JSON；只讨论则填 {}' }
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function (_a, value) {
          if (value && value.ready === false) return [{ type: 'text', text: '尚未选择人物卡' }]
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
        if (action === 'context') {
          if (chat === undefined) return { ready: false, message: '尚未选择人物卡，请提示用户在输入框上方选择人物卡。' }
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
          return {
            ready: true,
            mode: mode,
            cardName: card.name,
            systemContext: mode === 'revision'
              ? '你正在卡片模式的人物卡设定对话中，与用户共同讨论和修正人物卡，不进行角色扮演，不续写剧情。可以分析、追问、提出多个方案。只有用户明确要求或确认修改时才生成最小 cardPatch；只讨论时 cardPatch 必须是 {}。可修改字段：' + CARD_TEXT_FIELDS.join(',') + ',tags,alternate_greetings,character_book。保留 {{char}}、{{user}} 模板变量。\n\n当前人物卡：\n' + JSON.stringify(editable)
              : buildSystem(card, chat, scriptReference, worldBookIds),
            opening: substChar(card.first_mes, card, '你', '所有其他角色'),
            posture: chat.posture || '',
            lore: chat.lore || []
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
            const draft = chat.extract && chat.extract.draft ? chat.extract.draft : {}
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
          const preparedReference = (chat.mode || 'story') === 'script' && chat.scriptState && chat.scriptState.prepared
            ? Object.assign({}, chat.scriptState.prepared)
            : null
          if ((chat.mode || 'story') === 'script') commitScriptReference(chat, userText, nativeTurn)
          if (userText.indexOf('【场景结束】') === 0) chat.awaitingScene = true
          else if (userText.indexOf('【新场景】') === 0) chat.awaitingScene = false
          if (userText !== '') chat.messages.push({ role: 'user', text: userText, ts: Date.now(), native: true })
          chat.messages.push({ role: 'assistant', text: assistantText, ts: Date.now(), native: true })
          chat.pending = null
          chat.settleStatus = 'running'
          chat.settleError = null
          rememberNativeCommit(chat, nativeTurn, { mode: chat.mode || 'story', userText: userText, scriptReference: preparedReference })
          await writeChat(chat)
          queueSettlement(chat.id)
          return { saved: true, chatId: chat.id, cardName: chat.cardName }
        }
        throw new Error('action 仅支持 context 或 commit')
      }
    }))

    tools.register(defineTool({
      name: 'tavern_probe',
      description: '调试 dsh-tavern：listCards / importDemo / import / importFile / startChat / generate / choose / reroll / settleNow / state / deleteChat / deleteCard / setSettings。参数: action 必填；cardId、chatId、text、index、payload(卡片JSON字符串)、path(importFile 文件路径)、settings(JSON字符串) 按需。',
      parameters: {
        action: { type: 'string', required: true, description: '要执行的操作' },
        cardId: { type: 'string', description: '卡片 ID' },
        chatId: { type: 'string', description: '聊天 ID' },
        text: { type: 'string', description: '用户消息文本' },
        index: { type: 'number', description: '候选序号' },
        payload: { type: 'string', description: 'import 时直接传卡片 JSON 字符串' },
        path: { type: 'string', description: 'importFile 时传 PNG/JSON 卡片文件绝对路径' },
        settings: { type: 'string', description: 'setSettings 时传 JSON 字符串' }
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: function (_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2).slice(0, 6000) }] }
      },
      async execute(args, exec) {
        await ensureSettings()
        const a = args || {}
        const sessionId = (exec !== undefined && exec !== null && exec.agent !== undefined && exec.agent !== null && exec.agent.session !== undefined && exec.agent.session !== null)
          ? exec.agent.session.id
          : undefined
        switch (a.action) {
          case 'listCards': return { cards: await listCards() }
          case 'importDemo': {
            const card = demoCard()
            await writeJson('cards/' + card.id + '.json', card)
            const idx = await readIndex()
            idx.cards = idx.cards || []
            if (!idx.cards.some(function (c) { return c.id === card.id })) {
              idx.cards.push({ id: card.id, name: card.name, description: card.description, tags: card.tags, importedAt: card.importedAt })
            }
            await writeIndex(idx)
            return { card: { id: card.id, name: card.name } }
          }
          case 'import': {
            if (typeof a.payload !== 'string') throw new Error('payload 需要卡片 JSON 字符串')
            return { card: await importCard({ kind: 'text', text: a.payload }) }
          }
          case 'importFile': {
            const p = str(a.path)
            if (p === '') throw new Error('path 必填（PNG 或 JSON 卡片的绝对路径）')
            const t = await fs.resolve(p)
            const info = await fs.stat(t)
            if (info === undefined) throw new Error('文件不存在: ' + p)
            const bytes = await fs.readBytes(t, undefined, 20 * 1024 * 1024)
            let payload = null
            if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
              let off = 8
              while (off + 8 <= bytes.length) {
                const len = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
                const typ = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
                if (typ === 'tEXt' && off + 8 + len <= bytes.length) {
                  const d = off + 8
                  let nul = -1
                  for (let i = 0; i < len; i++) {
                    if (bytes[d + i] === 0) { nul = i; break }
                  }
                  if (nul >= 0) {
                    let kw = ''
                    for (let i = 0; i < nul; i++) kw += String.fromCharCode(bytes[d + i])
                    if (kw === 'chara' || kw === 'ccv3') {
                      let val = ''
                      for (let i = nul + 1; i < len; i++) val += String.fromCharCode(bytes[d + i])
                      payload = { kind: 'png', b64: Buffer.from(val, 'binary').toString('base64') }
                      break
                    }
                  }
                }
                if (typ === 'IEND') break
                off += 12 + len
              }
            }
            if (payload === null) {
              // 不是 PNG，尝试按 JSON 文本读取
              payload = { kind: 'text', text: await fs.readText(t) }
            }
            return { card: await importCard(payload) }
          }
          case 'startChat': return { view: await startChat(a.cardId || 'card-demo', sessionId) }
          case 'generate': {
            if (str(a.chatId) === '') {
              const v = await startChat(a.cardId || 'card-demo', sessionId)
              const g = await generate(v.chatId, a.text || '你好', sessionId)
              return { view: g }
            }
            return { view: await generate(a.chatId, a.text || '你好', sessionId) }
          }
          case 'choose': return { view: await choose(a.chatId, Number.isInteger(a.index) ? a.index : 0, sessionId) }
          case 'reroll': return { view: await reroll(a.chatId, sessionId) }
          case 'settleNow': return { view: await settleNow(a.chatId, sessionId) }
          case 'modelInfo': return { sessionId: sessionId, model: modelSelection(sessionId) }
          case 'state': {
            const chat = await readChat(a.chatId)
            if (chat === undefined) throw new Error('聊天不存在: ' + a.chatId)
            return { view: view(chat, await readChatCard(chat)) }
          }
          case 'deleteChat': return { result: await deleteChat(a.chatId) }
          case 'deleteCard': return { result: await deleteCard(a.cardId) }
          case 'setSettings': {
            if (typeof a.settings === 'string') {
              const s = JSON.parse(a.settings)
              if (Number.isInteger(s.candidates)) settings.candidates = clampInt(s.candidates, 1, 6, settings.candidates)
              if (typeof s.temperature === 'number' && isFinite(s.temperature)) settings.temperature = Math.min(1.5, Math.max(0, s.temperature))
              if (typeof s.provider === 'string') settings.provider = s.provider
              if (typeof s.model === 'string') settings.model = s.model
              await saveSettings()
            }
            return { settings: settings, model: modelSelection(sessionId) }
          }
          default: return { hint: 'action: listCards|importDemo|import|importFile|startChat|generate|choose|reroll|settleNow|state|deleteChat|deleteCard|setSettings' }
        }
      }
    }))
  }
}
