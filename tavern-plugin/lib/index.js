import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner } from './background-agent-runner.js'
import { createCandidateGenerator } from './domain/candidate-generation.js'
import { createCardPreparation } from './domain/card-preparation.js'
import { cleanWorkspaceCardMacros } from './domain/card-macros.js'
import { resolveCardOpening } from './domain/card-openings.js'
import { createContextPlanner } from './domain/context-planner.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { createTurnOrchestrator } from './domain/turn-orchestration.js'
import { prompt } from './prompt-catalog.js'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。
export function apply(ctx) {
  const fs = ctx.get('fs')
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  if (fs === undefined || llm === undefined || agentRegistry === undefined) {
    console.error('dsh-tavern: 缺少 fs、llm 或 agents 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')

  // 项目根：源码位于 <project>/tavern-plugin/lib/，数据固定在 <project>/data/。
  const base = fileURLToPath(new URL('../../', import.meta.url))

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
    const t = await fs.resolve(base + '/data/' + rel)
    const info = await fs.stat(t)
    if (info === undefined) return undefined
    return JSON.parse(await fs.readText(t))
  }
  async function writeJson(rel, value) {
    const t = await fs.resolve(base + '/data/' + rel)
    await fs.writeText(t, JSON.stringify(value, null, 2))
  }
  async function rmFile(rel) {
    const shell = ctx.get('shell')
    if (shell === undefined) return
    try {
      const spec = shell.resolve({ command: 'rm -f ' + JSON.stringify(base + '/data/' + rel), timeoutMs: 10000 })
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
  function renderCardText(text, card) {
    return substChar(text, card, '你', str(card.name))
  }

  const settlementJobs = new Set()
  const scriptContinuity = createScriptContinuity()
  const storyTimeline = createStoryTimeline({ id: uid, now: Date.now })
  const cardPreparation = createCardPreparation({ id: function () { return uid('card') }, now: Date.now })

  // ---------- 模型调用 ----------
  function modelSelection(sessionId) {
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
    if (sel === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
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
    if (finish !== null && finish !== undefined && finish.kind === 'max-tokens') {
      throw new Error('模型输出达到 token 上限')
    }
    const out = text.trim()
    if (out === '') throw new Error('模型返回为空')
    return out
  }
  const contextPlanner = createContextPlanner({ prompt: prompt, callModel: callModel, now: Date.now, logger: console })
  const backgroundAgentRunner = createBackgroundAgentRunner({ agents: agentRegistry })

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
  async function readIndex() {
    const idx = await readJson('index.json')
    return (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
  }
  async function writeIndex(idx) { await writeJson('index.json', idx) }
  async function readCard(cardId) {
    const card = await readJson('cards/' + cardId + '.json')
    if (card === undefined) return undefined
    await ensureDataDir('originals/cards')
    const originalTarget = await fs.resolve(base + '/data/originals/cards/' + cardId + '.json')
    if (await fs.stat(originalTarget) === undefined) await writeJson('originals/cards/' + cardId + '.json', card)
    const cleaned = cleanWorkspaceCardMacros(card)
    if (JSON.stringify(cleaned) !== JSON.stringify(card)) await writeJson('cards/' + cardId + '.json', cleaned)
    return cleaned
  }
  async function readScript(cardId) { return await readJson('scripts/' + cardId + '.json') }
  async function ensureDataDir(name) {
    const target = await fs.resolve(base + '/data/' + name)
    const info = await fs.stat(target)
    if (info !== undefined) return
    const shell = ctx.get('shell')
    if (shell === undefined) throw new Error('无法创建数据目录: ' + name)
    const spec = shell.resolve({ command: 'mkdir -p ' + JSON.stringify(base + '/data/' + name), timeoutMs: 10000 })
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
  async function importCard(payload) {
    const card = cardPreparation.create({ kind: 'import', payload: payload })
    await ensureDataDir('originals/cards')
    await writeJson('originals/cards/' + card.id + '.json', card)
    const workingCard = cleanWorkspaceCardMacros(card)
    await writeJson('cards/' + card.id + '.json', workingCard)
    const idx = await readIndex()
    idx.cards = idx.cards || []
    idx.cards.push({ id: workingCard.id, name: workingCard.name, description: workingCard.description, tags: workingCard.tags, importedAt: workingCard.importedAt })
    await writeIndex(idx)
    return { id: workingCard.id, name: workingCard.name, description: workingCard.description, tags: workingCard.tags }
  }
  async function listCards() {
    const idx = await readIndex()
    return (idx.cards || []).map(function (item) { return { id: item.id, name: item.name, script: item.script || null } })
  }
  async function updateCard(cardId, patch, revision, worldBookOperations) {
    const card = await readCard(cardId)
    if (card === undefined) throw new Error('角色卡不存在: ' + cardId)
    const change = cardPreparation.update({ kind: 'card', card: card, patch: patch, revision: revision, worldBookOperations: worldBookOperations })
    const savedCard = change.card
    if (!change.changed) return change
    await writeJson('cards/' + savedCard.id + '.json', savedCard)
    const idx = await readIndex()
    idx.cards = (idx.cards || []).map(function (item) {
      return item.id === savedCard.id ? Object.assign({}, item, { name: savedCard.name, description: savedCard.description, tags: savedCard.tags, updatedAt: savedCard.updatedAt }) : item
    })
    idx.chats = (idx.chats || []).map(function (item) { return item.cardId === savedCard.id ? Object.assign({}, item, { cardName: savedCard.name }) : item })
    await writeIndex(idx)
    for (const item of (idx.chats || []).filter(function (entry) { return entry.cardId === savedCard.id })) {
      const linked = await readChat(item.id)
      if (linked !== undefined && linked.cardName !== savedCard.name) {
        linked.cardName = savedCard.name
        await writeJson('chats/' + linked.id + '.json', linked)
      }
    }
    return change
  }
  async function deleteCard(cardId) {
    const idx = await readIndex()
    const dead = (idx.chats || []).filter(function (c) { return c.cardId === cardId })
    idx.cards = (idx.cards || []).filter(function (c) { return c.id !== cardId })
    idx.chats = (idx.chats || []).filter(function (c) { return c.cardId !== cardId })
    await writeIndex(idx)
    for (let i = 0; i < dead.length; i++) await rmFile('chats/' + dead[i].id + '.json')
    await rmFile('cards/' + cardId + '.json')
    await rmFile('originals/cards/' + cardId + '.json')
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
      scriptState: chatMode === 'script' ? { cursor: 0, recalledChunkIds: [], prepared: null, lastReference: null, totalChunks: 0, title: '', scriptVersion: 0 } : null,
      extract: chatMode === 'extract' ? { sourceIds: [], cursor: 0, prepared: null, done: false, player: '', draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', tags: [] } } : null,
      messages: [],
      posture: '',
      sessionId: '',
      guides: [],
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      nativeCommits: {},
      pendingCardChanges: {},
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
        character_book: null
      }
    }
    return cardPreparation.present({ card: card, as: 'view' })
  }
  async function view(chat, card) {
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await readScript(chat.cardId)
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    return {
      chatId: chat.id,
      mode: chat.mode || 'story',
      card: cardViewOf(card, chat),
      posture: chat.posture || '',
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      settleStatus: chat.settleStatus || 'idle',
      scriptProgress: scriptProgress,
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
        return await view(current, card)
      }
    }
    const greeting = requestedMode === 'revision'
      ? revisionGreeting(card.name)
      : renderCardText(resolveCardOpening(card), card)
    const chat = newChat(card, requestedMode || 'story')
    chat.openingText = greeting
    if (chat.mode === 'script') {
      chat.scriptState = scriptContinuity.startAligned(script, greeting, card.script_start)
    }
    if (typeof sessionId === 'string') chat.sessionId = sessionId
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
    return await view(chat, card)
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
    } else if (typeof chat.openingText === 'string') {
      text = chat.openingText
    } else {
      const storedGreeting = Array.isArray(chat.messages) ? chat.messages.find(function (message) {
        return message !== null && typeof message === 'object' && message.greeting === true && typeof message.text === 'string'
      }) : undefined
      text = storedGreeting === undefined ? renderCardText(card.first_mes, card) : storedGreeting.text
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
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  async function sessionView(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const isExtract = (chat.mode || 'story') === 'extract'
    const card = isExtract ? null : await readChatCard(chat)
    const hasStory = Array.isArray(chat.messages) && chat.messages.some(function (message) {
      return message !== null && typeof message === 'object' && message.greeting !== true
    })
    const hasState = str(chat.posture) !== ''
    if ((chat.mode || 'story') === 'story' && hasStory && !hasState && (chat.settleStatus || 'idle') === 'idle' && !settlementJobs.has(chat.id)) {
      settlementJobs.add(chat.id)
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat)
      void runSettlement(chat.id).finally(function () { settlementJobs.delete(chat.id) })
    }
    const result = await view(chat, card)
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
    const result = await view(chat, card)
    if (isExtract) result.extract = await extractViewOf(chat)
    return result
  }
  const candidateGenerator = createCandidateGenerator({
    store: {
      chatForSession: chatForSession,
      readChat: readChat,
      readCard: readCard,
      readScript: readScript,
      writeChat: writeChat
    },
    model: {
      selection: modelSelection,
      runCandidate: backgroundAgentRunner.run
    },
    planner: contextPlanner,
    prompt: prompt,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    waitUntilSettled: async function (chat) {
      for (let index = 0; index < 40 && settlementJobs.has(chat.id); index++) await sleep(250)
    },
    sleep: sleep,
    now: Date.now,
    logger: console
  })
  async function listTavernSessions() {
    const map = await readSessionMap()
    const rows = []
    for (const sessionId of Object.keys(map)) {
      const chat = await readChat(map[sessionId])
      if (chat === undefined) continue
      rows.push({
        sessionId: sessionId,
        chatId: chat.id,
        title: str(chat.title),
        cardName: chat.cardName || '未命名角色',
        updatedAt: chat.updatedAt || chat.createdAt || 0,
        mode: chat.mode || 'story'
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

  // ---------- 后台结算 ----------
  function settleUserText(chat) {
    const msgs = (chat.messages || []).slice(-2)
    const lines = [
      '【上一轮结算姿势】',
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
      let snapshot = await readChat(chatId)
      if (snapshot === undefined) return
      const begun = storyTimeline.apply({ chat: snapshot, intent: { kind: 'agent.begin', role: 'settlement' } })
      snapshot = begun.chat
      await writeChat(snapshot)
      let backgroundSessionId = str(begun.value.participant && begun.value.participant.sessionId)
      let backgroundBoundary = null
      try {
        await readChatCard(snapshot)
        let text = ''
        let result = null
        let lastError = null
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const selection = modelSelection(snapshot.sessionId)
            if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
            const run = await backgroundAgentRunner.run({
              task: 'settlement',
              persistent: true,
              persistentSessionId: backgroundSessionId,
              rewindTo: begun.value.participant && begun.value.participant.rewindTo,
              selection,
              messages: [{
                id: 'settle-' + Date.now().toString(36),
                role: 'user',
                content: [{ type: 'text', text: settleUserText(snapshot) }],
                source: { kind: 'plugin', plugin: 'dsh-tavern' }
              }],
              system: prompt('posture-settlement'),
              turnContext: '',
              tools: [],
              temperature: 0.2,
              maxTokens: 3000,
              sessionId: snapshot.sessionId
            })
            text = run.text
            backgroundSessionId = str(run.traceSessionId)
            backgroundBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
            result = parseJsonLenient(text)
            if (str(result.posture).trim() === '') throw new Error('模型返回的姿势 JSON 无效')
            lastError = null
            break
          } catch (err) {
            if (backgroundSessionId === '') backgroundSessionId = str(err && err.traceSessionId)
            lastError = err
            if (attempt < 2) console.warn('dsh-tavern: 结算输出无效，自动重试', str(err && err.message || err))
          }
        }
        if (lastError !== null) throw lastError
        const latest = await readChat(chatId)
        if (latest === undefined) return
        let stat = { postureUpdated: false }
        const completed = storyTimeline.complete({
          chat: latest,
          operationId: begun.value.operationId,
          basedOn: begun.value.basedOn,
          outcome: {
            status: 'success',
            stateChanged: true,
            participant: { sessionId: backgroundSessionId, boundary: backgroundBoundary, lifetime: 'chat' }
          },
          apply(draft) {
            stat = applySettlement(draft, result)
            draft.settleStatus = 'done'
            draft.settleError = null
            draft.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 200) }
          }
        })
        await writeChat(completed.chat)
        if (completed.value.status === 'stale') {
          if ((completed.chat.settleStatus || 'idle') === 'running') continue
          return
        }
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 200))
        return
      } catch (err) {
        const latest = await readChat(chatId)
        if (latest === undefined) return
        const failed = storyTimeline.complete({
          chat: latest,
          operationId: begun.value.operationId,
          basedOn: begun.value.basedOn,
          outcome: {
            status: 'success',
            stateChanged: false,
            participant: backgroundSessionId === '' ? null : { sessionId: backgroundSessionId, boundary: backgroundBoundary, lifetime: 'chat' }
          },
          apply(draft) {
            draft.settleStatus = 'error'
            draft.settleError = str(err && err.message || err)
          }
        })
        await writeChat(failed.chat)
        if (failed.value.status === 'stale' && (failed.chat.settleStatus || 'idle') === 'running') continue
        console.error('dsh-tavern: 结算失败', chatId, str(err && err.message || err))
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
      : '请直接在对话中告诉我两件事：准备提炼谁（或制作哪类人物卡），以及谁是玩家（{{user}}）。例如：“提炼阿芙拉，玩家是受雇调查商队失踪事件的旅行者。先分析，不要立即生成卡片。”'
    const greeting = '卡片模式 · 素材抽取：已载入素材《' + titles.join('》《') + '》。我会根据你的要求从中提炼人物卡。' + playerNote
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
    const result = await view(chat, null)
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
    const card = cardPreparation.create({ kind: 'extract', draft: draft, player: player, sourceIds: ext.sourceIds || [], allowMissingPlayer: ext.done === true })
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
    const result = await view(chat, card)
    result.extract = await extractViewOf(chat)
    result.finalizedCard = { id: card.id, name: card.name, description: card.description, tags: card.tags }
    return result
  }

  const turnOrchestrator = createTurnOrchestrator({
    store: {
      chatForSession,
      readCard,
      readScript,
      writeChat,
      updateCard
    },
    planner: contextPlanner,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    cards: cardPreparation,
    extract: {
      prepare: prepareExtract,
      commit: commitExtract
    },
    queueSettlement,
    now: Date.now
  })

  // ---------- 重新生成正文（生成即替换，无确认） ----------
  async function regenBody(chatId, guidance, sessionId) {
    let chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const card = await readChatCard(chat)
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(chat.sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
    const eventStart = Array.isArray(session.events) ? session.events.length : 0
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
    const originalChat = structuredClone(chat)
    async function restoreFailedRegen() {
      const failedChat = await readChat(chat.id)
      const restored = storyTimeline.apply({ chat: failedChat || chat, intent: { kind: 'replacement.abort', restoreChat: originalChat } })
      await writeChat(restored.chat)
    }
    let legacyBefore = null
    if (storyTimeline.inspect({ chat }).checkpointCount === 0) {
      let rollbackCommit = null
      if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
        const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
        for (const key of keys) {
          const value = chat.nativeCommits[String(key)]
          if (value && str(value.userText).trim() === originalUserText) { rollbackCommit = value; break }
        }
      }
      const before = rollbackCommit && rollbackCommit.before && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : {}
      legacyBefore = {
        messages: msgs0.slice(0, oldAssistantIndex - 1), posture: str(before.posture), scriptState: chat.scriptState,
        candidates: null, settleStatus: 'idle', settleError: null, lastSettle: null, participants: {}
      }
      if ((chat.mode || 'story') === 'script') {
        const script = await readScript(chat.cardId)
        if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法重新生成正文')
        const revision = before.scriptRevision && typeof before.scriptRevision === 'object' ? before.scriptRevision : null
        const reference = rollbackCommit && rollbackCommit.scriptReference && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
        legacyBefore.scriptState = scriptContinuity.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision, reference } }).state
      }
    }
    const rolled = storyTimeline.apply({ chat, intent: { kind: 'turn.rollback', turn: oldTurn, legacyBefore } })
    chat = rolled.chat
    chat.regenInProgress = true
    await writeChat(chat)
    const guide = str(guidance).trim()
    const syntheticText = '【重新生成正文】\n原玩家输入：\n' + originalUserText + '\n\n指导意见：\n' + (guide !== '' ? guide : '（无）') + '\n\n请根据原玩家输入和指导意见重新生成小说正文。'
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    try {
      agent.followup({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: syntheticText }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-regen' }
      })
      await agent.whenIdle()
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    const syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
    const latest = await readChat(chat.id)
    if (latest === undefined) {
      await restoreFailedRegen()
      throw new Error('聊天不存在: ' + chat.id)
    }
    const latestMsgs = latest.messages || []
    if (latestMsgs.length < 2) {
      await restoreFailedRegen()
      throw new Error('重新生成流程未产生新的用户/助手回合')
    }
    const newAssistant = latestMsgs[latestMsgs.length - 1]
    if (newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant') {
      await restoreFailedRegen()
      throw new Error('重新生成流程未产生正文')
    }
    const body = str(newAssistant.text).trim()
    if (body === '') {
      await restoreFailedRegen()
      throw new Error('重新生成失败：模型返回空文本')
    }
    latestMsgs[latestMsgs.length - 2].text = originalUserText
    latestMsgs[latestMsgs.length - 2].regen = true
    if (latest.nativeCommits !== null && typeof latest.nativeCommits === 'object') delete latest.nativeCommits[String(syntheticTurn)]
    latest.updatedAt = Date.now()
    delete latest.regenInProgress
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
    const currentNodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const syntheticNodes = currentNodes.filter(function (seq) { return seq >= eventStart })
    let finalAssistantIndex = -1
    for (let index = syntheticNodes.length - 1; index >= 0; index--) {
      const event = session.events[syntheticNodes[index]]
      if (event && event.type === 'assistant/message') { finalAssistantIndex = index; break }
    }
    const syntheticPrefix = finalAssistantIndex > 0 ? syntheticNodes.slice(0, finalAssistantIndex) : []
    if (syntheticPrefix.length > 0) {
      session.append('assistant/message', {
        turn: syntheticTurn,
        step: 1,
        message: { id: crypto.randomUUID(), role: 'assistant', content: [], source: oldSource }
      }, {
        surfaceOp: { op: 'replace', start: syntheticPrefix[0], end: syntheticPrefix[syntheticPrefix.length - 1] },
        sourceEventSeqs: syntheticPrefix
      })
    }
    const result = await view(latest, card)
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn }
    return result
  }

  // ---------- 回退本轮（删除最近一次用户输入 + LLM 输出） ----------
  async function rollbackTurn(sessionId, chatId) {
    let chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agents = ctx.get('agents')
    const agent = agents !== undefined ? agents.get(chat.sessionId) : undefined
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const events = Array.isArray(session.events) ? session.events : []
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    let userSeq = -1
    for (let i = nodes.length - 1; i >= 0; i--) {
      const event = events[nodes[i]]
      if (event !== null && typeof event === 'object' && event.type === 'user/message' && event.surfaceOp === 'append') {
        userSeq = Number(event.seq)
        break
      }
    }
    if (userSeq < 0) throw new Error('原生消息流中找不到可回退的用户输入')
    let lastAssistant = null
    for (let i = nodes.length - 1; i >= 0; i--) {
      const event = events[nodes[i]]
      if (event !== null && typeof event === 'object' && event.type === 'assistant/message' && event.surfaceOp === 'append') {
        lastAssistant = event
        break
      }
    }
    if (lastAssistant === null) throw new Error('原生消息流中找不到可回退的正文输出')
    const hiddenTurn = Math.max(0, Number(lastAssistant.data && lastAssistant.data.turn) || 0)
    const startIndex = nodes.indexOf(userSeq)
    if (startIndex < 0) throw new Error('目标用户输入已不在模型面中，可能已经回退过')
    const shadowedSeqs = nodes.slice(startIndex)
    if (shadowedSeqs.length === 0) throw new Error('没有可遮蔽的消息区间')

    // 1) 定位要回退的最后一组 user + assistant
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
    // 2) 旧对话从 native commit 生成一次性迁移 checkpoint；新对话直接使用权威 checkpoint
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
    const legacyBefore = {
      messages: msgs.slice(0, assistantIndex - 1),
      posture: before !== null && typeof before.posture === 'string' ? before.posture : '',
      scriptState: chat.scriptState,
      candidates: null,
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      participants: {}
    }
    if (mode === 'script' && storyTimeline.inspect({ chat }).checkpointCount === 0) {
      const script = await readScript(chat.cardId)
      if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法回退剧本状态')
      const revision = before !== null && before.scriptRevision !== null && typeof before.scriptRevision === 'object'
        ? before.scriptRevision
        : (before !== null && before.scriptState !== null && typeof before.scriptState === 'object' ? before.scriptState : null)
      const reference = rollbackCommit !== null && rollbackCommit.scriptReference !== null && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
      legacyBefore.scriptState = scriptContinuity.transition({ script: script, state: chat.scriptState, event: { kind: 'restore', revision: revision, reference: reference } }).state
    }
    const rolled = storyTimeline.apply({
      chat,
      intent: { kind: 'turn.rollback', turn: hiddenTurn, legacyBefore }
    })
    chat = rolled.chat
    if (rollbackCommitKey !== '') delete chat.nativeCommits[rollbackCommitKey]
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
    const result = await view(chat, card)
    result.rolledBack = { hiddenTurn: hiddenTurn, removedUserText: removedUserText, removedAssistantText: removedAssistantText }
    return result
  }

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args) {
    switch (method) {
      case 'listCards': return { cards: await listCards() }
      case 'getScriptInfo': {
        const script = await readScript(args && args.cardId)
        return { script: scriptContinuity.inspect({ script: script, state: null, request: { kind: 'info' } }) }
      }
      case 'importScript': return { script: await importScript(args && args.cardId, args && args.payload) }
      case 'deleteScript': return await deleteScript(args && args.cardId)
      case 'listSources': return { sources: await listSources() }
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'deleteSource': return await deleteSource(args && args.sourceId)
      case 'startExtract': return { view: await startExtract(args && args.sourceIds, args && args.sessionId, args && args.player) }
      case 'finalizeExtract': return { view: await finalizeExtract(args && args.chatId) }
      case 'updateCard': {
        const change = await updateCard(args && args.cardId, args && args.patch)
        return { card: change.card, changed: change.changed }
      }
      case 'listSessions': return { sessions: await listTavernSessions() }
      case 'importCard': return { card: await importCard(args && args.payload) }
      case 'deleteCard': return await deleteCard(args && args.cardId)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'startChat': return { view: await startChat(args && args.cardId, args && args.sessionId, args && args.mode) }
      case 'getSession': return { view: await sessionView(args && args.sessionId) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'getChoices': return { candidates: await candidateGenerator.find({ sessionId: args && args.sessionId, messageId: args && args.messageId }) }
      case 'generateChoices': {
        const candidates = await candidateGenerator.generate({ sessionId: args && args.sessionId, messageId: args && args.messageId, guidance: args && args.guidance })
        return { candidates: candidates }
      }
      case 'exportCard': {
        const card = await readCard(args && args.cardId)
        if (card === undefined) throw new Error('角色卡不存在: ' + (args && args.cardId))
        return { document: cardPreparation.present({ card: card, as: 'sillytavern-v3' }) }
      }
      case 'addGuide': return { guides: await addGuide(args && args.sessionId, args && args.text) }
      case 'deleteGuide': return { guides: await deleteGuide(args && args.sessionId, args && args.index) }
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

  function contentText(message) {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
    return message.content.map(function (block) { return block !== null && typeof block === 'object' && block.type === 'text' ? str(block.text) : '' }).filter(Boolean).join('\n').trim()
  }

  function isTurnInput(message) {
    const source = message && message.source
    return source && (source.kind === 'user' || (source.kind === 'plugin' && source.plugin === 'dsh-tavern-regen'))
  }

  function activeTurnOf(exec) {
    const phase = exec && exec.agent ? exec.agent.phase : null
    return phase && phase.kind === 'running' ? Math.max(0, Number(phase.turn) || 0) : 0
  }

  function turnStartIndex(session, turn) {
    const events = Array.isArray(session && session.events) ? session.events : []
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/start' && Number(event.data && event.data.turn) === Number(turn)) return index
    }
    return -1
  }

  function userTextForTurn(session, turn) {
    const events = Array.isArray(session && session.events) ? session.events : []
    const start = turnStartIndex(session, turn)
    if (start < 0) return ''
    for (let index = Math.max(0, start + 1); index < events.length; index++) {
      const event = events[index]
      if (!event || event.type !== 'user/message') continue
      if (isTurnInput(event.data)) return contentText(event.data)
    }
    return ''
  }

  function assistantTextForTurn(session, turn) {
    const events = Array.isArray(session && session.events) ? session.events : []
    const start = turnStartIndex(session, turn)
    for (let index = events.length - 1; index > start; index--) {
      const event = events[index]
      if (!event || event.type !== 'assistant/message' || Number(event.data && event.data.turn) !== Number(turn)) continue
      const text = contentText(event.data && event.data.message)
      if (text !== '') return text
    }
    return ''
  }

  // ---------- DSH 回合生命周期 ----------
  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (backgroundAgentRunner.owns(sessionId)) return next()
    const decision = await next()
    if (decision.kind === 'reject' || Number(payload.step) !== 1) return decision
    const userText = payload.messages.filter(isTurnInput).map(contentText).filter(Boolean).join('\n').trim()
    const prepared = await turnOrchestrator.prepare({ sessionId, turn: payload.turn, userText })
    const contextMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prepared.text }],
      source: {
        kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
        sections: [{ name: 'tavern:turn', text: prepared.text }]
      }
    }
    return { kind: 'enter', messages: decision.messages.concat([contextMessage]) }
  })

  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    if (backgroundAgentRunner.owns(sessionId)) return
    const userText = userTextForTurn(session, payload.turn)
    if (userText === '') return
    await turnOrchestrator.finalize({
      sessionId,
      turn: payload.turn,
      userText,
      assistantText: assistantTextForTurn(session, payload.turn)
    })
  })

  ctx.on('session/event', function (session, event) {
    if (!event || event.type !== 'turn/end') return
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    if (reason === 'completed' || reason === 'max-tokens') return
    void turnOrchestrator.discard({ sessionId: session.id, turn: event.data && event.data.turn })
  })

  const tavernToolNames = new Set(['tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card'])
  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const visible = new Set(await turnOrchestrator.visibleTools(agent.session.id))
    assembly.tools = assembly.tools.filter(function (schema) { return !tavernToolNames.has(schema.name) || visible.has(schema.name) })
    return assembly
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    const scriptOutput = {
      type: 'object', additionalProperties: false,
      properties: {
        found: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        title: { type: 'string', required: true },
        totalChunks: { type: 'integer', required: true },
        from: { type: 'integer', required: true },
        to: { type: 'integer', required: true },
        cursor: { type: 'integer', required: true },
        chunks: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              number: { type: 'integer', required: true },
              text: { type: 'string', required: true }
            }
          }
        }
      }
    }
    tools.register(defineTool({
      name: 'tavern_read_script',
      description: '按需读取已绑定剧本。剧本游玩中优先读取当前游标附近；卡片设定中可检索整本剧本。',
      parameters: {
        query: { type: 'string', description: '可选关键词；剧本游玩只检索当前游标前后 10 块' },
        offset: { type: 'integer', description: '可选的 1 起始块号' },
        limit: { type: 'integer', description: '连续读取块数；游玩最多 21，卡片设定最多 6' }
      },
      output: {
        schema: scriptOutput,
        render: function (_args, value) {
          if (!value.found) return [{ type: 'text', text: value.message }]
          const body = value.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + chunk.number + ' 块]\n' + chunk.text }).join('\n\n')
          return [{ type: 'text', text: '剧本《' + value.title + '》第 ' + value.from + '~' + value.to + ' 块 / 共 ' + value.totalChunks + ' 块\n\n' + body }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) return { found: false, message: '尚未选择人物卡。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        const mode = chat.mode || 'story'
        if (mode !== 'script' && mode !== 'revision') throw new Error('当前模式不能读取剧本')
        const script = await readScript(chat.cardId)
        if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) return { found: false, message: '当前人物卡没有绑定剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        const windowResult = scriptContinuity.inspect({
          script,
          state: chat.scriptState,
          request: { kind: mode === 'script' ? 'play' : 'read', query: args.query, offset: args.offset, limit: args.limit }
        })
        if (windowResult.notFound === true || windowResult.chunks.length === 0) {
          return {
            found: false,
            message: windowResult.notFound === true ? '没有找到包含该关键词的剧本分块。' : '剧本分块为空。',
            title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
            from: 0, to: 0, cursor: Number(windowResult.cursor) || 0, chunks: []
          }
        }
        return {
          found: true, message: '', title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
          from: Number(windowResult.from) || 0, to: Number(windowResult.to) || 0, cursor: Number(windowResult.cursor) || 0,
          chunks: windowResult.chunks.map(function (chunk) { return { id: str(chunk.id), number: Number(chunk.order) + 1, text: str(chunk.text) } })
        }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_worldbook',
      description: '在卡片设定对话中按编号、关键词或分页读取世界书正文。',
      parameters: {
        ref: { type: 'string', description: '目录中的条目编号，例如 wb-0' },
        query: { type: 'string', description: '可选关键词' },
        offset: { type: 'integer', description: '可选的 1 起始条目序号' },
        limit: { type: 'integer', description: '读取 1~10 条，默认 3' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            name: { type: 'string', required: true },
            total: { type: 'integer', required: true },
            entries: {
              type: 'array', required: true,
              items: {
                type: 'object', additionalProperties: false,
                properties: { ref: { type: 'string', required: true }, entry: { type: 'json', required: true } }
              }
            }
          }
        },
        render: function (_args, value) {
          if (!value.found) return [{ type: 'text', text: value.message }]
          const body = value.entries.map(function (item) { return '[' + item.ref + ']\n' + JSON.stringify(item.entry, null, 2) }).join('\n\n')
          return [{ type: 'text', text: '世界书《' + (value.name || '未命名') + '》· 共 ' + value.total + ' 条\n\n' + body }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) return { found: false, message: '尚未选择人物卡。', name: '', total: 0, entries: [] }
        if ((chat.mode || 'story') !== 'revision') throw new Error('世界书只能在卡片设定对话中读取')
        const card = await readChatCard(chat)
        const windowResult = cardPreparation.present({ card, as: 'world-book-window', ref: args.ref, query: args.query, offset: args.offset, limit: args.limit })
        if (windowResult === null) return { found: false, message: '当前人物卡没有世界书。', name: '', total: 0, entries: [] }
        if (windowResult.entries.length === 0) return { found: false, message: '没有找到符合条件的世界书条目。', name: windowResult.name, total: windowResult.total, entries: [] }
        return { found: true, message: '', name: windowResult.name, total: windowResult.total, entries: windowResult.entries }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_card',
      description: '仅当用户明确要求或确认修改时，暂存最小的人物卡变更；本轮最终回复完成后自动保存。只讨论时不要调用。',
      parameters: {
        fields: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            personality: { type: 'string' },
            scenario: { type: 'string' },
            first_mes: { type: 'string' },
            mes_example: { type: 'string' },
            system_prompt: { type: 'string' },
            post_history_instructions: { type: 'string' },
            creator_notes: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            alternate_greetings: { type: 'array', items: { type: 'string' } },
            player: { type: 'string', description: '仅素材抽取模式：{{user}} 的身份' }
          }
        },
        worldBook: {
          type: 'array',
          description: '仅人物卡设定模式：世界书逐条操作',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['update', 'add', 'delete', 'rename'] },
              ref: { type: 'string' },
              name: { type: 'string' },
              patch: { type: 'object', additionalProperties: true },
              entry: { type: 'object', additionalProperties: true }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            staged: { type: 'boolean', required: true },
            mode: { type: 'string', required: true, enum: ['revision', 'extract'] },
            changed: { type: 'boolean', required: true },
            changedFields: { type: 'array', required: true, items: { type: 'string' } }
          }
        },
        render: function (_args, value) {
          const detail = value.changedFields.length > 0 ? '：' + value.changedFields.join('、') : ''
          return [{ type: 'text', text: value.changed ? '变更已暂存，将随本轮回复保存' + detail : '提交内容与当前设定相同，无需改动' }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        return await turnOrchestrator.stageChanges({
          sessionId,
          turn: activeTurnOf(exec),
          fields: args.fields,
          worldBook: args.worldBook
        })
      }
    }))
  }
}
