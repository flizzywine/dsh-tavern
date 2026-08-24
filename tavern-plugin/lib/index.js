import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner } from './background-agent-runner.js'
import { createApplicationUpdater } from './application-updater.js'
import { createCandidateGenerator } from './domain/candidate-generation.js'
import { waitForAgentSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { createCardPreparation } from './domain/card-preparation.js'
import { cardOpeningChoices, resolveCardOpening } from './domain/card-openings.js'
import { READABLE_CARD_FIELDS, readCardField } from './domain/card-reading.js'
import { createContextPlanner } from './domain/context-planner.js'
import { extractEpubText } from './domain/epub-text.js'
import { createFileResourceStore, normalizeResourcePath, resourceKind } from './domain/file-resources.js'
import { createForegroundHandoff } from './domain/foreground-handoff.js'
import { inspectPreset } from './domain/preset-reading.js'
import { createRuntimePresetModule } from './domain/runtime-presets.js'
import {
  preserveRuntimeSource,
  projectAgentContent,
  projectOpeningCommit,
  projectOpeningPreview,
  projectRuntimeReply,
  projectRuntimeReplyHistory
} from './domain/runtime-content-projection.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { filterSkillMessages } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { createTavernSkillModule } from './domain/tavern-skills.js'
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import { createTurnOrchestrator } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { createWorldBookRecall } from './domain/worldbook-recall.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore } from './profile-data-store.js'
import { prompt } from './prompt-catalog.js'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。
export async function apply(ctx) {
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  if (llm === undefined || agentRegistry === undefined) {
    console.error('dsh-tavern: 缺少 llm 或 agents 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')

  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  const dataRoot = resolveTavernDataRoot()
  const profileData = createProfileDataStore({ dataRoot })
  const applicationUpdater = createApplicationUpdater({ dataRoot, sourceRoot })
  const tavernSkills = createTavernSkillModule({
    directory: dataRoot + '/skills',
    builtInDirectory: sourceRoot + '/presets/tavern/skills'
  })

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
  const runtimeGeneration = uid('runtime')
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
    return await profileData.readJson(rel)
  }
  async function writeJson(rel, value) {
    await profileData.writeJson(rel, value)
  }
  async function rmFile(rel) {
    await profileData.remove(rel)
  }
  function groupOfMode(mode) {
    const m = mode || 'story'
    return m === 'story' || m === 'script' ? 'play' : 'card'
  }
  function renderCardText(text, card, macroState = {}) {
    const result = projectAgentContent(text, {
      charName: str(card && card.name),
      macroState
    })
    macroState.userName = result.macroState.userName
    macroState.local = result.macroState.local
    macroState.global = result.macroState.global
    return result.renderedText
  }

  const settlementJobs = new Map()
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
  const fileResources = createFileResourceStore({ dataRoot })
  const cardDeletion = createCardDeletion({ resources: fileResources })
  const cardTaskPrompts = Object.freeze({
    edit: 'card-task-edit',
    extract: 'card-task-extract',
    material: 'card-task-material'
  })
  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    return await fileResources.ensureCardWorkspace(normalized, function (working, payload) {
      return cardPreparation.migrate({ working, payload })
    })
  }
  async function readCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const workspace = await readCardWorkspace(normalized)
    const card = workspace === undefined ? undefined : cardPreparation.project(workspace)
    if (card !== undefined) card.path = normalized
    return card
  }
  async function readCardExtensions(cardPath) {
    const workspace = await readCardWorkspace(cardPath)
    return workspace === undefined ? undefined : cardPreparation.present({ card: workspace, as: 'card-extensions' })
  }
  async function readScript(scriptOrCardPath) {
    if (str(scriptOrCardPath) === '') return undefined
    let scriptPath = str(scriptOrCardPath)
    if (scriptPath.startsWith('cards/')) scriptPath = await fileResources.scriptForCard(scriptPath)
    if (!scriptPath) return undefined
    const kind = resourceKind(scriptPath)
    if (kind !== 'source' && kind !== 'script') throw new Error('剧本引用必须指向资料文件')
    const source = await fileResources.readText(normalizeResourcePath(scriptPath, kind))
    if (source === undefined) return undefined
    const chunks = splitNovelText(source, 500)
    return { path: scriptPath, title: scriptPath.split('/').pop(), sourceChars: source.length, chunkSize: 500, chunks }
  }
  function prepareTextImport(payload, emptyMessage) {
    const source = payload !== null && typeof payload === 'object' ? payload : {}
    const name = str(source.name).trim()
    const isEpub = /\.epub$/i.test(name) || str(source.type).toLowerCase() === 'application/epub+zip'
    let text
    let originalText
    if (isEpub) {
      const encoded = str(source.fileB64).replace(/\s+/g, '')
      if (encoded === '') throw new Error('EPUB 文件内容为空')
      if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) throw new Error('EPUB 文件编码无效')
      text = extractEpubText(Buffer.from(encoded, 'base64'))
    } else {
      originalText = str(source.text)
      text = originalText
    }
    text = text.replace(/\r\n?/g, '\n').trim()
    if (text === '') throw new Error(emptyMessage)
    return Object.assign({}, source, { name, text, ...(originalText === undefined ? {} : { originalText }) })
  }
  async function importScript(cardPath, payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const existing = (await listSources()).find(function (source) { return source.title === prepared.name })
    const materialPath = existing ? existing.path : await fileResources.importText('source', prepared)
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length, importedAt: Date.now() }
  }
  async function bindScript(cardPath, materialPath) {
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length }
  }
  async function deleteScript(cardPath) {
    await fileResources.unbindMaterial(cardPath)
    return { unbound: true }
  }
  // ---------- 通用资料（独立于人物卡的 txt/md/epub 库） ----------
  async function readSource(sourcePath) {
    const normalized = normalizeResourcePath(sourcePath, 'source')
    const source = await fileResources.readText(normalized)
    if (source === undefined) return undefined
    return { path: normalized, title: normalized.split('/').pop(), sourceChars: source.length, chunkSize: 500, chunks: splitNovelText(source, 500) }
  }
  async function listSources() {
    return await Promise.all((await fileResources.list('source')).map(async function (sourcePath) {
      const source = await readSource(sourcePath)
      return { path: sourcePath, title: source.title, sourceChars: source.sourceChars, chunkCount: source.chunks.length }
    }))
  }
  async function importSource(payload) {
    const prepared = prepareTextImport(payload, '资料文件为空')
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }
  async function readPreset(presetPath) {
    const normalized = normalizeResourcePath(presetPath, 'preset')
    const text = await fileResources.readText(normalized)
    if (text === undefined) return undefined
    return Object.assign({ path: normalized, previewPath: fileResources.absolute(normalized) }, inspectPreset(text, normalized))
  }
  const runtimePresets = createRuntimePresetModule({
    listPaths: async function () { return await fileResources.list('preset') },
    readPreset,
    readState: async function () { return await readJson('runtime-presets.json') },
    updateState: async function (updater) { return await profileData.updateJson('runtime-presets.json', updater) },
    now: Date.now
  })
  async function listPresets() {
    const result = []
    const inspectedPresets = []
    for (const presetPath of await fileResources.list('preset')) {
      const inspected = await readPreset(presetPath)
      if (inspected.valid && (inspected.recognized || inspected.regexCount > 0)) await runtimePresets.register(presetPath)
      inspectedPresets.push({ path: presetPath, inspected })
    }
    const runtimeState = await runtimePresets.state()
    const order = new Map(runtimeState.presetOrder.map(function (path, index) { return [path, index] }))
    inspectedPresets.sort(function (left, right) {
      const leftOrder = order.has(left.path) ? order.get(left.path) : Number.MAX_SAFE_INTEGER
      const rightOrder = order.has(right.path) ? order.get(right.path) : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
    })
    for (const record of inspectedPresets) {
      const presetPath = record.path
      const inspected = record.inspected
      const preset = inspected.valid && (inspected.recognized || inspected.regexCount > 0) ? await runtimePresets.view(presetPath) : inspected
      result.push({
        path: preset.path,
        previewPath: preset.previewPath,
        title: preset.title,
        valid: preset.valid,
        recognized: preset.recognized,
        promptCount: preset.promptCount,
        enabledCount: preset.enabledCount || 0,
        enabledCharacters: preset.enabledCharacters || 0,
        regexCount: preset.regexCount,
        enabledRegexCount: preset.enabledRegexCount || 0,
        warning: preset.warning,
        error: preset.error
      })
    }
    return result
  }
  async function importPreset(payload) {
    const prepared = prepareTextImport(payload, '预设文件为空')
    const inspected = inspectPreset(prepared.text, prepared.name)
    if (!inspected.valid) throw new Error(inspected.error)
    const presetPath = await fileResources.importText('preset', prepared)
    if (inspected.recognized || inspected.regexCount > 0) await runtimePresets.register(presetPath)
    return inspected.recognized || inspected.regexCount > 0 ? await runtimePresets.view(presetPath) : await readPreset(presetPath)
  }
  async function renameResource(resourcePath, name) {
    const oldPath = normalizeResourcePath(resourcePath)
    const kind = resourceKind(oldPath)
    const renamed = await fileResources.rename(oldPath, name)
    if (kind === 'preset') await runtimePresets.rename(renamed.oldPath, renamed.path)
    const replacements = new Map([[renamed.oldPath, renamed.path]])
    if (renamed.scriptOldPath && renamed.scriptPath) replacements.set(renamed.scriptOldPath, renamed.scriptPath)
    const idx = await readIndex()
    for (const row of idx.chats || []) {
      const chat = await readChat(row.id)
      if (chat === undefined) continue
      let changed = false
      if (replacements.has(chat.cardPath)) {
        chat.cardPath = replacements.get(chat.cardPath)
        row.cardPath = chat.cardPath
        changed = true
      }
      if (kind === 'preset') {
        if (chat.runtimePresetPath === renamed.oldPath) { chat.runtimePresetPath = renamed.path; changed = true }
        if (chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object') {
          const snapshot = chat.runtimePresetSnapshot
          if (snapshot.presetPath === renamed.oldPath) { snapshot.presetPath = renamed.path; changed = true }
          for (const source of (snapshot.sources || []).concat(snapshot.regexSources || [])) {
            if (source && source.path === renamed.oldPath) { source.path = renamed.path; changed = true }
          }
        }
      }
      if (chat.workspace && typeof chat.workspace === 'object') {
        const nextSources = (chat.workspace.sourcePaths || []).map(function (item) { return replacements.get(item) || item })
        if (JSON.stringify(nextSources) !== JSON.stringify(chat.workspace.sourcePaths || [])) { chat.workspace.sourcePaths = nextSources; changed = true }
        const nextMounted = (chat.workspace.mountedResources || []).map(function (item) {
          if (!item || !replacements.has(item.path)) return item
          const nextPath = replacements.get(item.path)
          const filename = nextPath.split('/').pop()
          return Object.assign({}, item, { path: nextPath, label: filename.replace(/\.[^.]+$/, '') })
        })
        if (JSON.stringify(nextMounted) !== JSON.stringify(chat.workspace.mountedResources || [])) { chat.workspace.mountedResources = nextMounted; changed = true }
      }
      if (changed) await writeChat(chat)
    }
    await writeIndex(idx)
    return { kind, path: renamed.path }
  }
  async function deleteLibraryResource(resourcePath, expectedKind) {
    const normalized = normalizeResourcePath(resourcePath, expectedKind)
    await fileResources.remove(normalized)
    const idx = await readIndex()
    for (const row of idx.chats || []) {
      const chat = await readChat(row.id)
      if (chat === undefined || !chat.workspace || typeof chat.workspace !== 'object') continue
      const nextSources = (chat.workspace.sourcePaths || []).filter(function (item) { return item !== normalized })
      const nextMounted = (chat.workspace.mountedResources || []).filter(function (item) { return !item || item.path !== normalized })
      if (JSON.stringify(nextSources) === JSON.stringify(chat.workspace.sourcePaths || []) && JSON.stringify(nextMounted) === JSON.stringify(chat.workspace.mountedResources || [])) continue
      chat.workspace.sourcePaths = nextSources
      chat.workspace.mountedResources = nextMounted
      await writeChat(chat)
    }
    return { removed: normalized }
  }
  async function deleteResource(resourcePath) { return await deleteLibraryResource(resourcePath, 'source') }
  async function deletePreset(resourcePath) {
    const normalized = normalizeResourcePath(resourcePath, 'preset')
    const result = await deleteLibraryResource(normalized, 'preset')
    await runtimePresets.remove(normalized)
    return result
  }
  const worldBooks = createWorldBookLibrary({
    normalizePath: normalizeResourcePath,
    resources: {
      list: async function (kind) { return await fileResources.list(kind) },
      readText: async function (path) { return await fileResources.readText(path) },
      import: async function (prepared, working) { return await fileResources.importWorldBook(prepared, working) },
      write: async function (path, text) { return await fileResources.writeWorking(path, text) },
      bindingForCard: async function (cardPath) { return await fileResources.worldBookBindingForCard(cardPath) },
      bind: async function (cardPath, path) { return await fileResources.bindWorldBook(cardPath, path) },
      unbind: async function (cardPath) { return await fileResources.unbindWorldBook(cardPath) }
    },
    cards: {
      listPaths: async function () { return await fileResources.list('card') },
      read: readCard,
      update: async function (cardPath, patch) { return await updateCard(cardPath, patch) }
    },
    removeStandalone: async function (path) { return await deleteLibraryResource(path, 'worldbook') }
  })
  function emptyCardWorkspace() {
    return { mountedResources: [], sourcePaths: [], cursor: 0, prepared: null, done: false, player: '', draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', creator_notes: '', tags: [], alternate_greetings: [] } }
  }
  function normalizeChat(chat) {
    if (chat === undefined || chat === null || typeof chat !== 'object') return chat
    if (chat.mode === 'revision' || chat.mode === 'extract') chat.mode = 'card'
    if (typeof chat.cardPath !== 'string') chat.cardPath = ''
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: '你', local: {}, global: {} }
    if (typeof chat.macroState.userName !== 'string' || chat.macroState.userName === '' || chat.macroState.userName === 'User') chat.macroState.userName = '你'
    if (chat.macroState.local === null || typeof chat.macroState.local !== 'object') chat.macroState.local = {}
    if (chat.macroState.global === null || typeof chat.macroState.global !== 'object') chat.macroState.global = {}
    if (chat.mode === 'card') {
      if (chat.workspace === null || typeof chat.workspace !== 'object') chat.workspace = chat.extract !== null && typeof chat.extract === 'object' ? chat.extract : emptyCardWorkspace()
      if (!Array.isArray(chat.workspace.mountedResources)) chat.workspace.mountedResources = []
      delete chat.extract
      if (chat.cardName === '抽取中') chat.cardName = str(chat.workspace.draft && chat.workspace.draft.name) || '卡片工作台'
    }
    return chat
  }
  async function readChat(chatId) { return normalizeChat(await readJson('chats/' + chatId + '.json')) }
  async function writeChat(chat) {
    chat.updatedAt = Date.now()
    await writeJson('chats/' + chat.id + '.json', chat)
  }
  const conversationRegistry = createTavernConversationRegistry({
    store: {
      readLinks: async function () { return await readJson('sessions.json') },
      updateLinks: async function (updater) { return await profileData.updateJson('sessions.json', updater) },
      readIndex,
      writeIndex,
      readChat,
      writeChat,
      removeChat: async function (chatId) { await rmFile('chats/' + chatId + '.json') }
    }
  })
  async function readSessionMap() { return await conversationRegistry.links() }
  async function chatForSession(sessionId) { return await conversationRegistry.resolve(sessionId) }
  async function readChatCard(chat) {
    const card = await readCard(chat.cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + chat.cardPath)
    return card
  }
  async function importCard(payload) {
    const workspace = cardPreparation.create({ kind: 'import', payload: payload })
    const cardPath = await fileResources.importCard(payload, workspace)
    const card = cardPreparation.project(workspace)
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags }
  }
  async function listCards() {
    return await Promise.all((await fileResources.list('card')).map(async function (cardPath) {
      const card = await readCard(cardPath)
      const script = await readScript(cardPath)
      return { path: cardPath, name: card.name, script: script === undefined ? null : { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkCount: script.chunks.length } }
    }))
  }
  async function getCardOpenings(cardPath, userName) {
    const card = await readCard(cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    return cardOpeningChoices(card).map(function (opening) {
      const preview = projectOpeningPreview(opening.text, {
        charName: str(card.name),
        macroState: { userName: str(userName).trim() || '你', local: {}, global: {} }
      })
      return {
        id: opening.id,
        text: preview.renderedText,
        usesUser: /\{\{\s*user\s*\}\}/i.test(opening.text),
        presentationOnly: preview.presentationOnly
      }
    })
  }
  async function listTavernResources() {
    const cards = await listCards()
    const sources = await listSources()
    return {
      resources: sources.map(function (source) {
        const boundCards = cards.filter(function (card) { return card.script !== null && card.script.path === source.path }).map(function (card) { return { path: card.path, name: card.name } })
        return { path: source.path, previewPath: fileResources.absolute(source.path), title: source.title, sourceChars: Number(source.sourceChars) || 0, chunkCount: Number(source.chunkCount) || 0, boundCards }
      })
    }
  }
  async function updateCard(cardPath, patch, revision, worldBookOperations, rawOperations) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const change = cardPreparation.update({ kind: 'card', card: workspace, patch: patch, revision: revision, worldBookOperations: worldBookOperations, rawOperations: rawOperations })
    const savedWorkspace = change.card
    if (!change.changed) {
      const unchangedCard = change.view
      unchangedCard.path = cardPath
      unchangedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
      return Object.assign({}, change, { card: unchangedCard })
    }
    await fileResources.writeWorking(normalizeResourcePath(cardPath, 'card'), JSON.stringify(savedWorkspace, null, 2))
    const savedCard = change.view
    savedCard.path = cardPath
    savedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
    await syncCardName(cardPath, savedCard.name)
    return Object.assign({}, change, { card: savedCard })
  }
  async function syncCardName(cardPath, cardName) {
    const idx = await readIndex()
    idx.chats = (idx.chats || []).map(function (item) { return item.cardPath === cardPath ? Object.assign({}, item, { cardName: cardName }) : item })
    await writeIndex(idx)
    for (const item of (idx.chats || []).filter(function (entry) { return entry.cardPath === cardPath })) {
      const linked = await readChat(item.id)
      if (linked !== undefined && linked.cardName !== cardName) {
        linked.cardName = cardName
        await writeJson('chats/' + linked.id + '.json', linked)
      }
    }
  }
  async function restoreCurrentCard(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') !== 'card') throw new Error('原版恢复只能在卡片模式中使用')
    const cardPath = str(chat.cardPath)
    if (cardPath === '') throw new Error('空白工作台没有可恢复的正式人物卡')
    const restored = await fileResources.restoreCard(cardPath, function (payload) {
      return cardPreparation.create({ kind: 'import', payload: payload })
    })
    const restoredCard = cardPreparation.project(restored.card)
    await syncCardName(cardPath, restoredCard.name)
    return {
      path: cardPath,
      name: restoredCard.name,
      originalPath: restored.originalPath,
      backupPath: restored.backupPath
    }
  }
  async function deleteCard(cardPath) {
    return await cardDeletion.remove(cardPath)
  }
  async function deleteChat(chatId) {
    return await conversationRegistry.remove(chatId)
  }

  // ---------- 聊天 ----------
  function newChat(card, mode) {
    const chatMode = mode === 'card' ? 'card' : (mode === 'script' ? 'script' : 'story')
    const hasCard = card !== null && card !== undefined && str(card.path) !== ''
    return {
      id: uid('chat'),
      cardPath: hasCard ? card.path : '',
      cardName: hasCard ? card.name : '卡片工作台',
      mode: chatMode,
      scriptState: chatMode === 'script' ? { cursor: 0, recalledChunkIds: [], prepared: null, lastReference: null, totalChunks: 0, title: '', scriptVersion: 0 } : null,
      workspace: chatMode === 'card' ? emptyCardWorkspace() : null,
      messages: [],
      posture: '',
      sessionId: '',
      guides: [],
      runtimePresetSnapshot: null,
      macroState: { userName: '你', local: {}, global: {} },
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      preparedWorldBookContext: '',
      preparedWorldBook: null,
      nativeCommits: {},
      pendingCardChanges: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
  function cardViewOf(card, chat) {
    if (card === null || card === undefined) {
      const draft = chat.workspace && chat.workspace.draft ? chat.workspace.draft : {}
      return {
        path: '',
        name: str(draft.name) || '卡片工作台',
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
    return Object.assign(cardPreparation.present({ card: card, as: 'view' }), { path: str(card.path || chat.cardPath) })
  }
  async function view(chat, card) {
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await readScript(chat.cardPath)
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    let replyDisplay = { projections: replyProjectionsOf(chat), presentation: null, latestSourceBacked: false }
    if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
      const extensions = await readCardExtensions(chat.cardPath)
      replyDisplay = projectRuntimeReplyHistory(chat.messages, {
        regexScripts: Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : [],
        placement: 2,
        isMarkdown: true,
        isEdit: false,
        depth: 0
      })
    }
    const storedPresentation = presentationViewOf(chat)
    const livePresentation = replyDisplay.presentation !== null
      ? replyDisplay.presentation
      : (replyDisplay.latestSourceBacked && storedPresentation && storedPresentation.source === 'reply' ? null : storedPresentation)
    const activity = backgroundTasks.activity(chat)
    return {
      chatId: chat.id,
      mode: chat.mode || 'story',
      playerName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      card: cardViewOf(card, chat),
      posture: chat.posture || '',
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      presentation: livePresentation,
      replyProjections: replyDisplay.projections,
      presentationWarnings: Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : [],
      worldBookError: chat.worldBookError || null,
      lastWorldBookRecall: chat.lastWorldBookRecall || null,
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      scriptProgress: scriptProgress,
      updatedAt: chat.updatedAt || 0
    }
  }
  function replyProjectionsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const projectedIndexes = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (message && message.role === 'assistant' && message.sourceText !== undefined && str(message.sourceText) !== str(message.text)) projectedIndexes.push(index)
    }
    const latestProjectedIndex = projectedIndexes.length > 0 ? projectedIndexes[projectedIndexes.length - 1] : -1
    const legacyTurn = chat && chat.presentation && chat.presentation.source === 'reply' ? Number(chat.presentation.turn) : 0
    return projectedIndexes.map(function (index) {
      const message = messages[index]
      const turn = Number(message.turn) || (index === latestProjectedIndex ? legacyTurn : 0)
      return { turn: turn, text: str(message.text) }
    }).filter(function (projection) { return projection.turn > 0 })
  }
  function presentationViewOf(chat) {
    if (chat && chat.presentation && typeof chat.presentation === 'object' && str(chat.presentation.html) !== '') return chat.presentation
    const legacy = projectRuntimeReply(chat && chat.openingText)
    if (legacy.presentationHtml === '') return null
    return { html: legacy.presentationHtml, source: 'opening', turn: 1, warnings: legacy.warnings, updatedAt: Number(chat && chat.createdAt) || 0 }
  }
  async function startChat(cardPath, sessionId, mode, openingId, userName) {
    const requestedMode = mode === 'card' || mode === 'revision' || mode === 'extract' ? 'card' : (mode === 'script' ? 'script' : (mode === 'story' ? 'story' : null))
    const card = str(cardPath) === '' && requestedMode === 'card' ? null : await readCard(cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    // 游玩模式内部仍是 story/script 两类：人物卡已绑定剧本时必须走剧本（script）。
    const script = card === null ? undefined : await readScript(cardPath)
    const hasScript = script !== undefined && Array.isArray(script.chunks) && script.chunks.length > 0
    let chatMode = requestedMode
    if (chatMode === null || mode === 'play') chatMode = hasScript ? 'script' : 'story'
    if (chatMode === 'script' && !hasScript) throw new Error('该人物卡尚未绑定剧本文件，请先在卡片模式绑定剧本')
    if (chatMode === 'story' && hasScript) chatMode = 'script'
    if (typeof sessionId === 'string' && sessionId !== '') {
      const current = await chatForSession(sessionId)
      // 同一大模式（游玩/卡片）内复用当前会话；旧的自由故事会话不会被强行切换成剧本。
      if (current !== undefined && current.cardPath === str(cardPath) && groupOfMode(current.mode) === groupOfMode(chatMode)) {
        await appendNativeOpening(sessionId, current, card)
        const currentView = await view(current, card)
        if (chatMode === 'card') currentView.workspace = workspaceViewOf(current)
        return currentView
      }
    }
    const macroState = { userName: str(userName).trim().slice(0, 80) || '你', local: {}, global: {} }
    const openingProjection = chatMode === 'card'
      ? { agentText: prompt('card-mode-greeting'), presentationHtml: '', presentationOnly: false, warnings: [], macroState }
      : projectOpeningCommit(resolveCardOpening(card, openingId), {
          charName: str(card.name),
          macroState
        })
    macroState.userName = openingProjection.macroState.userName
    macroState.local = openingProjection.macroState.local
    macroState.global = openingProjection.macroState.global
    // 纯 HTML 开场仍是有效开场。用不换行空格维持原生 Session 的开场
    // 消息结构，展示 HTML 则继续留在独立的酒馆状态侧栏。
    const greeting = openingProjection.presentationOnly ? '\u00a0' : openingProjection.agentText
    // connectWorkspace 返回时，Agent 注册偶尔仍在异步完成。先等到原生会话可写，
    // 再落盘 Tavern 对话，避免失败时留下只有映射、没有原生开场白的半初始化记录。
    const openingAgent = typeof sessionId === 'string' && sessionId !== '' && greeting !== '' ? await waitForAgentSession({ registry: agentRegistry, sessionId: sessionId, sleep: sleep }) : undefined
    const chat = newChat(card, chatMode || 'story')
    chat.runtimePresetSnapshot = null
    chat.runtimePresetPath = ''
    chat.macroState = macroState
    chat.openingText = greeting
    chat.presentationWarnings = openingProjection.warnings
    if (openingProjection.presentationHtml !== '') {
      chat.presentation = { html: openingProjection.presentationHtml, source: 'opening', turn: 1, warnings: openingProjection.warnings, updatedAt: Date.now() }
    }
    if (chat.mode === 'script') {
      chat.scriptState = scriptContinuity.startAligned(script, greeting, card.script_start)
    }
    if (typeof sessionId === 'string') chat.sessionId = sessionId
    if (greeting !== '') chat.messages.push({ role: 'assistant', text: greeting, ts: Date.now(), greeting: true })
    const hasSession = typeof sessionId === 'string' && sessionId !== ''
    await conversationRegistry.publish(chat)
    if (hasSession) await appendNativeOpening(sessionId, chat, card, openingAgent)
    const result = await view(chat, card)
    if (chatMode === 'card') result.workspace = workspaceViewOf(chat)
    return result
  }

  async function appendNativeOpening(sessionId, chat, card, readyAgent) {
    if (chat.nativeOpeningAppended === true) return
    const mode = chat.mode || 'story'
    let text
    if (mode === 'card') {
      text = prompt('card-mode-greeting')
    } else if (typeof chat.openingText === 'string') {
      text = chat.openingText
    } else {
      const storedGreeting = Array.isArray(chat.messages) ? chat.messages.find(function (message) {
        return message !== null && typeof message === 'object' && message.greeting === true && typeof message.text === 'string'
      }) : undefined
      text = storedGreeting === undefined ? renderCardText(card.first_mes, card, chat.macroState) : storedGreeting.text
    }
    if (mode !== 'card') {
      const projection = projectRuntimeReply(text)
      text = projection.bodyText
      if (projection.presentationHtml !== '' && (!chat.presentation || str(chat.presentation.html) === '')) {
        chat.presentation = { html: projection.presentationHtml, source: 'opening', turn: 1, warnings: projection.warnings, updatedAt: Date.now() }
      }
    }
    if (text === '') return
    const agent = readyAgent || await waitForAgentSession({ registry: agentRegistry, sessionId: sessionId, sleep: sleep })
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
    const script = await readScript(chat.cardPath)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  async function sessionActivity(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const activity = backgroundTasks.activity(chat)
    return {
      chatId: chat.id,
      phase: activity.phase,
      busy: activity.busy,
      role: activity.role,
      operationId: activity.operationId,
      basedOn: activity.basedOn,
      updatedAt: activity.updatedAt || chat.updatedAt || 0
    }
  }
  async function sessionView(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const isCard = (chat.mode || 'story') === 'card'
    const card = isCard && str(chat.cardPath) === '' ? null : await readChatCard(chat)
    const result = await view(chat, card)
    if (isCard) result.workspace = workspaceViewOf(chat)
    if ((chat.mode || 'story') === 'script') result.scriptPreview = await scriptPreviewOf(chat)
    return result
  }
  async function ensureNativeOpening(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const isCard = (chat.mode || 'story') === 'card'
    const card = isCard && str(chat.cardPath) === '' ? null : await readChatCard(chat)
    await appendNativeOpening(sessionId, chat, card)
    const result = await view(chat, card)
    if (isCard) result.workspace = workspaceViewOf(chat)
    return result
  }
  const contextPlanner = createContextPlanner({ prompt: prompt, callModel: callModel, now: Date.now, logger: console })
  const backgroundAgentRunner = createBackgroundAgentRunner({
    agents: agentRegistry,
    flushSession: async function (session) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) throw new Error('dsh-tavern: 缺少 sessions 服务')
      await sessions.flush(session)
    },
    resolveRuntimePresetSnapshot: async function () { return null }
  })
  const backgroundTasks = createBackgroundTaskCoordinator({
    store: { readChat, writeChat },
    timeline: storyTimeline
  })
  const worldBookRecall = createWorldBookRecall({
    store: { readChat, writeChat },
    timeline: storyTimeline,
    tasks: backgroundTasks,
    model: {
      selection: modelSelection,
      run: backgroundAgentRunner.run
    },
    prompt,
    now: Date.now,
    logger: console
  })
  function presetPathForChat(chat) {
    if (!chat || typeof chat !== 'object') return ''
    const snapshot = chat.runtimePresetSnapshot
    const direct = str(chat.runtimePresetPath) || str(snapshot && snapshot.presetPath)
    if (direct !== '') return direct
    for (const source of (snapshot && snapshot.sources || []).concat(snapshot && snapshot.regexSources || [])) {
      const path = str(source && source.path)
      if (path !== '') return path
    }
    return ''
  }
  let backgroundHistoryProjection = Promise.resolve()
  function reprojectBackgroundHistories(presetPath) {
    const path = str(presetPath)
    const run = backgroundHistoryProjection.catch(function () {}).then(async function () {
      const sessionMap = await readSessionMap()
      const chatIds = Array.from(new Set(Object.values(sessionMap).map(str).filter(Boolean)))
      let changed = 0
      for (const chatId of chatIds) {
        const chat = await readChat(chatId)
        if (!chat || presetPathForChat(chat) !== path) continue
        const participant = chat.timeline && chat.timeline.participants && chat.timeline.participants.background
        const backgroundSessionId = str(participant && participant.sessionId) || str(chat.candidateAgent && chat.candidateAgent.sessionId)
        if (backgroundSessionId === '') continue
        try {
          const result = await backgroundAgentRunner.reproject({ sessionId: backgroundSessionId, regexScripts: [] })
          changed += Number(result.changed) || 0
        } catch (error) {
          console.warn('dsh-tavern: 后台历史正则投影失败，已跳过 ' + backgroundSessionId + ':', str(error && error.message || error))
        }
      }
      return changed
    })
    backgroundHistoryProjection = run
    return run
  }
  const candidateGenerator = createCandidateGenerator({
    store: {
      chatForSession: chatForSession,
      readChat: readChat,
      readCard: readCard,
      readCardExtensions: readCardExtensions,
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
    tasks: backgroundTasks,
    waitUntilSettled: async function (chat) {
      let current = await readChat(chat.id)
      if (current === undefined) return
      if (isOpeningAwaitingSettlement(current)) {
        current.settleStatus = 'running'
        current.settleError = null
        await writeChat(current)
      }
      if ((current.settleStatus || 'idle') === 'running') await queueSettlement(current.id)
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
  async function setPlayerName(sessionId, userName) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不使用玩家称呼')
    const name = str(userName).trim().slice(0, 80) || '你'
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: name, local: {}, global: {} }
    else chat.macroState.userName = name
    await writeChat(chat)
    return name
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
      lines.push((m.role === 'assistant' ? '正文' : '玩家') + ': ' + (str(m.sourceText) || str(m.text)))
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
  function settlementTurn(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message && message.role === 'assistant' && Number.isFinite(Number(message.turn))) return Number(message.turn)
    }
    return 0
  }
  async function prepareNextWorldBookContext(snapshot) {
    let chat = snapshot
    let context = ''
    let mode = 'skip'
    let totalChars = 0
    let error = null
    try {
      const card = await readChatCard(chat)
      const worldBook = await worldBooks.bound(chat.cardPath, card)
      const recalled = await worldBookRecall.recall({
        sessionId: chat.sessionId,
        turn: settlementTurn(chat),
        chat,
        card,
        worldBook
      })
      chat = recalled.chat
      context = str(recalled.context).trim()
      mode = str(recalled.mode) || 'skip'
      totalChars = Number(recalled.totalChars) || 0
      error = str(recalled.error).trim() || null
    } catch (caught) {
      error = str(caught && caught.message || caught)
      mode = 'error'
    }
    const latest = await readChat(chat.id)
    if (latest === undefined) return null
    latest.preparedWorldBookContext = error === null ? context : ''
    latest.preparedWorldBook = {
      ts: Date.now(),
      turn: settlementTurn(latest),
      mode,
      totalChars,
      contextChars: error === null ? Array.from(context).length : 0,
      empty: error !== null || context === '',
      failed: error !== null
    }
    if (mode !== 'agent') {
      latest.worldBookError = error
      latest.lastWorldBookRecall = Object.assign({}, latest.preparedWorldBook)
    }
    await writeChat(latest)
    if (mode === 'agent') return latest
    const skipped = await backgroundTasks.skip(latest, 'worldbook')
    return skipped.chat
  }
  async function runSettlement(chatId) {
    while (true) {
      let snapshot = await readChat(chatId)
      if (snapshot === undefined) return
      const pending = backgroundTasks.activity(snapshot)
      if (pending.phase !== 'pending' || pending.role === 'worldbook') {
        snapshot = await prepareNextWorldBookContext(snapshot)
        if (snapshot === null) return
      }
      const taskRun = await backgroundTasks.begin(snapshot, 'settlement')
      snapshot = taskRun.chat
      let backgroundSessionId = str(taskRun.participantRequest.sessionId)
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
              rewindTo: taskRun.participantRequest.rewindTo,
              selection,
              messages: [{
                id: 'settle-' + Date.now().toString(36),
                role: 'user',
                regexPlacement: 2,
                content: [{ type: 'text', text: settleUserText(snapshot) }],
                source: { kind: 'plugin', plugin: 'dsh-tavern' }
              }],
              system: prompt('posture-settlement'),
              turnContext: '',
              tools: [],
              temperature: 0.2,
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
        let stat = { postureUpdated: false }
        const completed = await taskRun.commit({
          stateChanged: true,
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary }),
          apply(draft) {
            stat = applySettlement(draft, result)
            draft.settleStatus = 'done'
            draft.settleError = null
            draft.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 200) }
          }
        })
        if (completed.status === 'missing') return
        if (completed.status === 'stale') {
          if (backgroundTasks.activity(completed.chat).busy) continue
          return
        }
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 200))
        return
      } catch (err) {
        const failed = await taskRun.commit({
          status: 'failed',
          stateChanged: false,
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary })
        })
        if (failed.status === 'missing') return
        if (failed.status === 'stale' && backgroundTasks.activity(failed.chat).busy) continue
        console.error('dsh-tavern: 结算失败', chatId, str(err && err.message || err))
        return
      }
    }
  }
  function queueSettlement(chatId) {
    const existing = settlementJobs.get(chatId)
    if (existing !== undefined) return existing
    const job = runSettlement(chatId).finally(function () { settlementJobs.delete(chatId) })
    settlementJobs.set(chatId, job)
    return job
  }
  // ---------- 卡片工作台：挂载资料与新卡创建 ----------
  async function sourceWindowOf(chat) {
    const out = []
    for (const sourcePath of (chat.workspace && chat.workspace.sourcePaths) || []) {
      const src = await readSource(sourcePath)
      if (src === undefined || !Array.isArray(src.chunks)) continue
      const title = str(src.title) || '资料'
      for (const chunk of src.chunks) {
        out.push({ chunkId: sourcePath + '/' + chunk.id, title: title, order: chunk.order, text: chunk.text })
      }
    }
    return out
  }
  async function prepareWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') throw new Error('卡片工作台状态不存在')
    if (state.prepared !== null && typeof state.prepared === 'object' && Number(state.prepared.nativeTurn) === Number(nativeTurn)) return state.prepared
    const all = await sourceWindowOf(chat)
    const cursor = Math.max(0, Number(state.cursor) || 0)
    const window = all.slice(cursor, cursor + 6)
    state.prepared = { nativeTurn: Number(nativeTurn) || 0, window: window, cursorBefore: cursor, total: all.length }
    return state.prepared
  }
  function commitWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') return
    const prepared = state.prepared
    if (prepared !== null && typeof prepared === 'object' && Number(prepared.nativeTurn) === Number(nativeTurn)) {
      state.cursor = Math.min(prepared.total, (Number(prepared.cursorBefore) || 0) + prepared.window.length)
      state.prepared = null
    }
  }
  function workspaceViewOf(chat) {
    const state = chat.workspace || {}
    return {
      mountedResources: Array.isArray(state.mountedResources) ? state.mountedResources : []
    }
  }
  async function createWorkspaceCard(chat, state) {
    const draft = state.draft !== null && typeof state.draft === 'object' ? state.draft : {}
    if (str(draft.name).trim() === '') throw new Error('新人物卡还没有角色名，请先在对话中确认')
    const player = str(state.player)
    if (player === '') throw new Error('玩家（{{user}}）身份还没有确认。请先在对话中告诉助手“玩家是XX”。')
    const workspace = cardPreparation.create({ kind: 'draft', draft: draft, player: player, sourcePaths: state.sourcePaths || state.sourceIds || [] })
    const card = cardPreparation.project(workspace)
    const cardPath = await fileResources.importCard({ name: card.name + '.json', text: JSON.stringify(workspace.raw, null, 2) }, workspace)
    card.path = cardPath
    const idx = await readIndex()
    for (const row of idx.chats || []) {
      if (row.id === chat.id) { row.cardPath = cardPath; row.cardName = card.name }
    }
    await writeIndex(idx)
    return { path: cardPath, card }
  }
  const turnOrchestrator = createTurnOrchestrator({
    store: {
      chatForSession,
      readCard,
      readCardExtensions,
      readScript,
      writeChat,
      updateCard,
      createCard: createWorkspaceCard
    },
    planner: contextPlanner,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    cards: cardPreparation,
    workspace: {
      prepare: prepareWorkspace,
      commit: commitWorkspace
    },
    renderMacros: function (text, chat) {
      return renderCardText(text, { name: chat.cardName }, chat.macroState)
    },
    projectReply: projectRuntimeReply,
    resolvePresetRegexScripts: async function (chat) {
      return []
    },
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    store: { chatForSession, readChat },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    logger: console
  })

  await fileResources.migrateLegacy(await readIndex(), readJson, writeIndex, readChat, writeChat)
  const recoveredIndex = await readIndex()
  await foregroundHandoff.recover((recoveredIndex.chats || []).map(function (row) { return row.id }))
  const startupPresetState = await runtimePresets.state()
  if (str(startupPresetState.activePreset) !== '') {
    void reprojectBackgroundHistories(startupPresetState.activePreset).catch(function (error) {
      console.warn('dsh-tavern: 启动时刷新后台历史失败:', str(error && error.message || error))
    })
  }

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
        candidates: null, settleStatus: 'idle', settleError: null, lastSettle: null,
        preparedWorldBookContext: str(before.preparedWorldBookContext),
        preparedWorldBook: before.preparedWorldBook || null,
        participants: {}
      }
      if ((chat.mode || 'story') === 'script') {
        const script = await readScript(chat.cardPath)
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
      const script = await readScript(chat.cardPath)
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
      case 'getUpdateStatus': return { status: await applicationUpdater.status() }
      case 'startUpdate': return { status: await applicationUpdater.start() }
      case 'getCardOpenings': return { openings: await getCardOpenings(args && args.path, args && args.userName) }
      case 'getCard': {
        const cardPath = normalizeResourcePath(args && args.path, 'card')
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
        return { card: Object.assign(cardPreparation.present({ card: workspace, as: 'detail' }), { path: cardPath }) }
      }
      case 'getCardTaskPrompt': {
        const task = str(args && args.task)
        const promptName = cardTaskPrompts[task]
        if (promptName === undefined) throw new Error('未知卡片任务: ' + task)
        return { task, text: prompt(promptName) }
      }
      case 'getResourceWorkspace': return { path: dataRoot + '/resources' }
      case 'listResources': return await listTavernResources()
      case 'listWorldBooks': return await worldBooks.catalog()
      case 'getWorldBook': return await worldBooks.get(args && args.source)
      case 'getWorldBookBinding': return { binding: await worldBooks.binding(args && args.cardPath) }
      case 'bindWorldBook': return { binding: await worldBooks.bind(args && args.cardPath, args && args.source) }
      case 'unbindWorldBook': return { binding: await worldBooks.unbind(args && args.cardPath) }
      case 'importWorldBook': return { worldBook: await worldBooks.import(args && args.payload) }
      case 'updateWorldBook': return await worldBooks.update(args && args.source, args && args.update)
      case 'exportWorldBook': return { worldBook: await worldBooks.export(args && args.source) }
      case 'deleteWorldBook': return await worldBooks.remove(args && args.path)
      case 'listPresets': {
        const presets = await listPresets()
        const runtimePresetState = await runtimePresets.state()
        const presetPlans = await runtimePresets.plans()
        const activePreset = presets.find(function (preset) { return preset.path === runtimePresetState.activePreset })
        return {
          presets,
          runtimePresetState,
          presetPlans,
          activePreset: runtimePresetState.activePreset || '',
          activePresetTitle: activePreset && activePreset.title || '',
          enabledCount: activePreset && activePreset.enabledCount || 0,
          enabledCharacters: activePreset && activePreset.enabledCharacters || 0,
          enabledRegexCount: activePreset && activePreset.enabledRegexCount || 0
        }
      }
      case 'getPreset': {
        const inspected = await readPreset(args && args.path)
        const preset = inspected && inspected.valid && (inspected.recognized || inspected.regexCount > 0) ? await runtimePresets.view(inspected.path) : inspected
        if (preset === undefined) throw new Error('预设不存在: ' + (args && args.path))
        return { preset }
      }
      case 'togglePresetEntry': {
        if (args && args.enabled === true) throw new Error('预设实验模块当前仅支持导入和查看，提示词注入已禁用')
        await runtimePresets.toggle({ path: args && args.path, entryKey: args && args.entryKey, enabled: args && args.enabled === true })
        return { preset: await runtimePresets.view(args && args.path) }
      }
      case 'selectPreset': {
        if (str(args && args.path) !== '') throw new Error('预设实验模块当前没有运行时效果，不能启用预设')
        await runtimePresets.select(args && args.path || '')
        return { selected: args && args.path || '' }
      }
      case 'togglePresetRegex': {
        if (args && args.enabled === true) throw new Error('预设实验模块当前仅支持导入和查看，预设正则匹配已禁用')
        await runtimePresets.toggleRegex({ path: args && args.path, regexKey: args && args.regexKey, enabled: args && args.enabled === true })
        const historicalChanges = await reprojectBackgroundHistories(args && args.path)
        return { preset: await runtimePresets.view(args && args.path), historicalChanges }
      }
      case 'disablePreset': {
        await runtimePresets.disablePreset(args && args.path)
        return { preset: await runtimePresets.view(args && args.path) }
      }
      case 'disableAllPresets': {
        await runtimePresets.disableAll()
        return { disabled: true }
      }
      case 'savePresetPlan': {
        return { plan: await runtimePresets.savePlan({ id: args && args.id, name: args && args.name }) }
      }
      case 'applyPresetPlan': {
        throw new Error('预设实验模块当前没有运行时效果，不能应用配置方案')
      }
      case 'renamePresetPlan': {
        return { plan: await runtimePresets.renamePlan(args && args.id, args && args.name) }
      }
      case 'deletePresetPlan': {
        await runtimePresets.removePlan(args && args.id)
        return { deleted: true }
      }
      case 'renameResource': return { resource: await renameResource(args && args.path, args && args.name) }
      case 'deleteResource': return await deleteResource(args && args.path)
      case 'deletePreset': return await deletePreset(args && args.path)
      case 'getScriptInfo': {
        const script = await readScript(args && args.path)
        const info = scriptContinuity.inspect({ script: script, state: null, request: { kind: 'info' } })
        return { script: script === undefined ? info : Object.assign({}, info, { path: script.path }) }
      }
      case 'importScript': return { script: await importScript(args && args.cardPath, args && args.payload) }
      case 'bindScript': return { script: await bindScript(args && args.cardPath, args && args.path) }
      case 'deleteScript': return await deleteScript(args && (args.cardPath || args.path))
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'importPreset': return { preset: await importPreset(args && args.payload) }
      case 'updateCard': {
        const change = await updateCard(args && args.path, args && args.patch)
        return { card: change.card, changed: change.changed }
      }
      case 'listSessions': return { sessions: await listTavernSessions() }
      case 'importCard': return { card: await importCard(args && args.payload) }
      case 'deleteCard': return await deleteCard(args && args.path)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'startChat': {
        try {
          return { view: await startChat(args && args.path, args && args.sessionId, args && args.mode, args && args.openingId, args && args.userName) }
        } catch (error) {
          console.error('dsh-tavern: 创建对话失败', {
            cardPath: str(args && args.path),
            sessionId: str(args && args.sessionId),
            mode: str(args && args.mode),
            openingId: str(args && args.openingId),
            error: str(error && error.message || error)
          })
          throw error
        }
      }
      case 'getSession': return { view: await sessionView(args && args.sessionId) }
      case 'getSessionActivity': return { activity: await sessionActivity(args && args.sessionId) }
      case 'getSessionConnection': {
        const agent = agentRegistry.get(str(args && args.sessionId))
        return { runtimeGeneration, liveSession: Boolean(agent && agent.session) }
      }
      case 'setPlayerName': return { playerName: await setPlayerName(args && args.sessionId, args && args.userName) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'getChoices': return { candidates: await candidateGenerator.find({ sessionId: args && args.sessionId, messageId: args && args.messageId }) }
      case 'generateChoices': {
        const candidates = await candidateGenerator.generate({ sessionId: args && args.sessionId, messageId: args && args.messageId, guidance: args && args.guidance })
        return { candidates: candidates }
      }
      case 'exportCard': {
        const workspace = await readCardWorkspace(args && args.path)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + (args && args.path))
        return { document: cardPreparation.present({ card: workspace, as: 'raw' }) }
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

  function assistantResultForTurn(session, turn) {
    const events = Array.isArray(session && session.events) ? session.events : []
    const start = turnStartIndex(session, turn)
    for (let index = events.length - 1; index > start; index--) {
      const event = events[index]
      if (!event || event.type !== 'assistant/message' || Number(event.data && event.data.turn) !== Number(turn)) continue
      const text = contentText(event.data && event.data.message)
      if (text !== '') return { index, event, text }
    }
    return null
  }

  function replaceTurnInput(messages, text) {
    const result = Array.isArray(messages) ? messages.slice() : []
    for (let index = result.length - 1; index >= 0; index--) {
      const message = result[index]
      if (!isTurnInput(message)) continue
      result[index] = Object.assign({}, message, {
        content: [{ type: 'text', text: str(text).trim() || '（玩家已更新酒馆运行状态）' }]
      })
      break
    }
    return result
  }

  function replaceAssistantReply(session, result, bodyText) {
    if (result === null || result.text === bodyText) return
    const previous = result.event && result.event.data && result.event.data.message
    if (previous === null || typeof previous !== 'object') return
    session.append('assistant/message', {
      turn: Number(result.event.data && result.event.data.turn) || 0,
      step: Number(result.event.data && result.event.data.step) || 1,
      message: Object.assign({}, previous, {
        id: crypto.randomUUID(),
        content: [{ type: 'text', text: bodyText }]
      })
    }, {
      surfaceOp: { op: 'replace', start: result.index, end: result.index },
      sourceEventSeqs: [result.index]
    })
  }

  // ---------- DSH 回合生命周期 ----------
  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (backgroundAgentRunner.owns(sessionId)) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const mode = await turnOrchestrator.modeFor(sessionId)
    const visibleMessages = filterSkillMessages(decision.messages, mode)
    const scopedDecision = visibleMessages === decision.messages ? decision : { ...decision, messages: visibleMessages }
    if (Number(payload.step) !== 1) return scopedDecision
    const userText = payload.messages.filter(isTurnInput).map(contentText).filter(Boolean).join('\n').trim()
    const prepared = await foregroundHandoff.prepare({ sessionId, turn: payload.turn, userText })
    const agentMessages = mode === 'story' || mode === 'script'
      ? replaceTurnInput(scopedDecision.messages, prepared.userText)
      : scopedDecision.messages
    const contextMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prepared.text }],
      source: {
        kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
        sections: [{ name: 'tavern:turn', text: prepared.text }]
      }
    }
    return { kind: 'enter', messages: agentMessages.concat([contextMessage]) }
  })

  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    if (backgroundAgentRunner.owns(sessionId)) return
    const userText = userTextForTurn(session, payload.turn)
    if (userText === '') return
    const assistant = assistantResultForTurn(session, payload.turn)
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      userText,
      assistantText: assistant === null ? '' : assistant.text
    })
    if (saved.reply && saved.reply.presentationHtml !== '') replaceAssistantReply(session, assistant, saved.reply.bodyText || '\u00a0')
  })

  ctx.on('session/event', function (session, event) {
    if (!event || event.type !== 'turn/end') return
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason })
  })

  const controlledToolNames = new Set(['bash', 'pwsh', 'str_replace_editor', 'skill', 'tavern_save_skill', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card', 'tavern_restore_card'])
  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const mode = await turnOrchestrator.modeFor(agent.session.id)
    const visible = new Set(await turnOrchestrator.visibleTools(agent.session.id))
    const sections = []
    sections.push({
      name: 'tavern:mode-persona',
      text: prompt(mode === 'card' ? 'card-mode' : 'play-mode')
    })
    if (mode === 'card') {
      const workspaceContext = resourceWorkspaceContext(agent.session.header && agent.session.header.cwd)
      if (workspaceContext !== '') sections.push({ name: 'tavern:resource-workspace', text: workspaceContext })
    }
    assembly.sections = sections
    assembly.tools = assembly.tools.filter(function (schema) { return !controlledToolNames.has(schema.name) || visible.has(schema.name) })
    return assembly
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    function mountedResource(chat, kind, resourcePath) {
      return Array.isArray(chat && chat.workspace && chat.workspace.mountedResources) && chat.workspace.mountedResources.some(function (item) {
        return item !== null && typeof item === 'object' && item.kind === kind && item.path === resourcePath
      })
    }

    tools.register(defineTool({
      name: 'tavern_save_skill',
      description: '仅当用户明确要求创建或修改 Tavern Skill 时，把结构化内容安全保存到用户 Skill 目录。不能覆盖内置 Skill；修改同名用户 Skill 必须明确 overwrite=true。',
      parameters: {
        name: { type: 'string', required: true, description: 'kebab-case Skill 名称' },
        description: { type: 'string', required: true, description: '用于 Skill 自动发现的一句话简介，说明做什么以及何时使用' },
        body: { type: 'string', required: true, description: '不含 YAML frontmatter 的完整 Markdown 指令正文' },
        modelInvocable: { type: 'boolean', description: '是否允许 Agent 自动发现，默认 true' },
        userInvocable: { type: 'boolean', description: '是否允许用户显式调用，默认 true' },
        overwrite: { type: 'boolean', description: '同名用户 Skill 已存在且用户明确要求修改时设为 true' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            chars: { type: 'integer', required: true },
            overwritten: { type: 'boolean', required: true },
            saved: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: 'Tavern Skill 已' + (value.overwritten ? '更新' : '创建') + '：' + value.name + ' · ' + value.chars + ' 字；已进入 Skill 目录，不会自动执行。' }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('Tavern Skill 只能在卡片工作台中创建或修改')
        const saved = await tavernSkills.write(args)
        return { name: saved.name, chars: saved.chars, overwritten: saved.overwritten, saved: true }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_card',
      description: '在卡片工作台中按字段、分段读取当前人物卡或尚未创建的新卡设定。默认上下文只有字段目录，先按任务选择字段，不要一次读取全部字段。',
      parameters: {
        path: { type: 'string', description: '可选的已挂载人物卡相对路径；省略时读取当前人物卡或尚未创建的新卡设定' },
        field: { type: 'string', required: true, enum: READABLE_CARD_FIELDS, description: '要读取的人物卡字段' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            field: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          if (value.totalChars === 0) return [{ type: 'text', text: '人物卡字段 ' + value.field + ' 为空。' }]
          return [{ type: 'text', text: '人物卡字段 ' + value.field + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) throw new Error('尚未选择人物卡。')
        if ((chat.mode || 'story') !== 'card') throw new Error('人物卡字段只能在卡片工作台中读取')
        const resourcePath = str(args.path).trim()
        if (resourcePath !== '' && resourcePath !== str(chat.cardPath) && !mountedResource(chat, 'card', resourcePath)) throw new Error('该人物卡尚未挂载到当前对话')
        const card = resourcePath !== ''
          ? await readCard(resourcePath)
          : (str(chat.cardPath) === '' ? ((chat.workspace && chat.workspace.draft) || {}) : await readChatCard(chat))
        if (card === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
        return readCardField(card, args)
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_card_raw',
      description: '在卡片工作台中按 JSON Pointer 分段读取完整工作 raw。只在标准字段工具无法覆盖正则、脚本、MVU 或未知扩展时使用；pointer 为空可查看根结构。',
      parameters: {
        path: { type: 'string', description: '可选的已挂载人物卡相对路径；省略时读取当前人物卡' },
        pointer: { type: 'string', description: 'JSON Pointer，例如 /data/extensions/regex_scripts；V1 卡可使用 /extensions。省略时读取根节点' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            pointer: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '人物卡 raw ' + (value.pointer || '/') + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('人物卡 raw 只能在卡片工作台中读取')
        const resourcePath = str(args.path).trim() || str(chat.cardPath)
        if (resourcePath === '') throw new Error('空白工作台还没有正式人物卡 raw')
        if (resourcePath !== str(chat.cardPath) && !mountedResource(chat, 'card', resourcePath)) throw new Error('该人物卡尚未挂载到当前对话')
        const workspace = await readCardWorkspace(resourcePath)
        if (workspace === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
        return cardPreparation.present({ card: workspace, as: 'raw-section', pointer: args.pointer, offset: args.offset, limit: args.limit })
      }
    }))

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
        path: { type: 'string', description: '卡片工作台中可指定已挂载剧本相对路径；游玩模式省略并读取当前人物卡绑定剧本' },
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
        if (mode !== 'script' && mode !== 'card') throw new Error('当前模式不能读取剧本')
        const requestedPath = str(args.path).trim()
        const resourcePath = mode === 'card' && requestedPath !== '' ? requestedPath : str(chat.cardPath)
        if (resourcePath === '') return { found: false, message: '当前工作台尚未挂载人物卡或剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        if (mode === 'card' && resourcePath !== str(chat.cardPath) && !mountedResource(chat, 'source', resourcePath) && !mountedResource(chat, 'script', resourcePath)) throw new Error('该资料尚未挂载到当前对话')
        const script = await readScript(resourcePath)
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
              chunks: windowResult.chunks.map(function (chunk) {
                const project = mode === 'card' ? preserveRuntimeSource : projectAgentContent
                const projected = project(chunk.text, { charName: str(chat.cardName), macroState: chat.macroState })
                return { id: str(chunk.id), number: Number(chunk.order) + 1, text: projected.agentText }
              })
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
        if ((chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中读取')
        if (str(chat.cardPath) === '') return { found: false, message: '当前工作台尚未挂载人物卡。', name: '', total: 0, entries: [] }
        const card = await readChatCard(chat)
        const windowResult = cardPreparation.present({ card, as: 'world-book-window', ref: args.ref, query: args.query, offset: args.offset, limit: args.limit })
        if (windowResult === null) return { found: false, message: '当前人物卡没有世界书。', name: '', total: 0, entries: [] }
        if (windowResult.entries.length === 0) return { found: false, message: '没有找到符合条件的世界书条目。', name: windowResult.name, total: windowResult.total, entries: [] }
        return { found: true, message: '', name: str(windowResult.name), total: windowResult.total, entries: windowResult.entries }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_card',
      description: '仅当用户明确要求或确认修改时，提交最小的人物卡变更；本轮最终回复完成后自动保存。空白工作台会直接创建并绑定正式人物卡文件，必须同时具备角色名和玩家身份。只讨论时不要调用。',
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
            player: { type: 'string', description: '新建人物卡时用于约束 {{user}} 视角的玩家身份' }
          }
        },
        worldBook: {
          type: 'array',
          description: '当前工作台已挂载正式人物卡时可用：世界书逐条操作',
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
        },
        rawOperations: {
          type: 'array',
          description: '仅用于标准字段和世界书工具无法覆盖的扩展字段；按 JSON Pointer 对完整工作 raw 做最小 set/delete 修改',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['set', 'delete'] },
              path: { type: 'string', required: true, description: 'JSON Pointer，例如 /data/extensions/regex_scripts/0/disabled' },
              value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            staged: { type: 'boolean', required: true },
            mode: { type: 'string', required: true, enum: ['card'] },
            changed: { type: 'boolean', required: true },
            createsCard: { type: 'boolean', required: true },
            changedFields: { type: 'array', required: true, items: { type: 'string' } }
          }
        },
        render: function (_args, value) {
          const detail = value.changedFields.length > 0 ? '：' + value.changedFields.join('、') : ''
          if (value.createsCard) return [{ type: 'text', text: '本轮回复完成后将创建并绑定正式人物卡' + detail }]
          if (!value.changed) return [{ type: 'text', text: '提交内容与当前设定相同，无需改动' }]
          return [{ type: 'text', text: '本轮回复完成后将保存人物卡变更' + detail }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        return await turnOrchestrator.stageChanges({
          sessionId,
          turn: activeTurnOf(exec),
          fields: args.fields,
          worldBook: args.worldBook,
          rawOperations: args.rawOperations
        })
      }
    }))

    tools.register(defineTool({
      name: 'tavern_restore_card',
      description: '灾难恢复工具：仅当用户明确要求将当前正式人物卡从 originals 原版整体恢复、已获知会覆盖全部工作版修改，并再次明确确认后使用。普通编辑、撤销、不确定或空白工作台严禁调用。恢复前会自动备份当前工作版。',
      parameters: {
        confirmation: {
          type: 'string',
          required: true,
          enum: ['确认从原版恢复'],
          description: '只能在用户已经明确确认整体覆盖后填写固定文本“确认从原版恢复”；不得由 Agent 代替用户确认'
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            name: { type: 'string', required: true },
            originalPath: { type: 'string', required: true },
            backupPath: { type: 'string', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '人物卡《' + value.name + '》已从原版恢复并立即生效。恢复前工作版已备份到 ' + value.backupPath }]
        }
      },
      async execute(args, exec) {
        if (str(args && args.confirmation) !== '确认从原版恢复') throw new Error('原版恢复缺少明确确认')
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const turn = activeTurnOf(exec)
        if (turn > 0) await turnOrchestrator.discard({ sessionId: sessionId, turn: turn })
        return await restoreCurrentCard(sessionId)
      }
    }))
  }
}
