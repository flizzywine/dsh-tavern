import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner, executeBackgroundCompaction } from './background-agent-runner.js'
import { createApplicationUpdater } from './application-updater.js'
import { createCandidateGenerator } from './domain/candidate-generation.js'
import { createSceneIllustrations, sceneTarget } from './domain/scene-illustration.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix } from './domain/session-stable-prefix.js'
import { waitForWritableSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { createCardPreparation } from './domain/card-preparation.js'
import { projectCardOpeningPreviews } from './domain/card-opening-previews.js'
import { READABLE_CARD_FIELDS, readCardField } from './domain/card-reading.js'
import { createConversationInitialization } from './domain/conversation-initialization.js'
import { createPlayCardSnapshots } from './domain/play-card-snapshots.js'
import { createContextPlanner } from './domain/context-planner.js'
import { createConversationTextExport } from './domain/conversation-text-export.js'
import { createCoordinationEventPublisher } from './domain/coordination-event-publisher.js'
import { createCandidateTasks } from './domain/candidate-tasks.js'
import { extractEpubText } from './domain/epub-text.js'
import { createFileResourceStore, normalizeResourcePath, resourceKind } from './domain/file-resources.js'
import { createForegroundHandoff } from './domain/foreground-handoff.js'
import { createForegroundFrameBuilder } from './domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from './domain/foreground-frame-session-adapter.js'
import { createModelRequestLog } from './domain/model-request-log.js'
import { createMvuSettlementModule } from './domain/mvu-background-settlement.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, sanitizeRuntimeDiagnostics } from './domain/mvu-diagnostics.js'
import { projectPersistentStatusView } from './domain/persistent-status-view.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from './domain/play-chat-debug.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { resolveRuntimePresetMacros } from './domain/runtime-presets.js'
import { compileSillyTavernRequest } from './domain/sillytavern-compatibility.js'
import { applySillyTavernStrictTools } from './domain/sillytavern-strict-tools.js'
import { createForegroundOrchestrationStrategies } from './domain/foreground-orchestration-strategies.js'
import { clearFailedTurnSurface, hasRollbackMessages, supersededRegenerationErrorTurns } from './domain/rollback-surface.js'
import { assistantResultForTurn } from './domain/session-turn-result.js'
import { createTavernRetryLimiter } from './domain/tavern-retry-limiter.js'
import { lastTavernHelperVariables, projectTavernHelperContext } from './domain/tavern-helper-context.js'
import { projectTavernHelperWorldbook } from './domain/tavern-helper-worldbook.js'
import { applyTavernHelperVariableMacros } from './domain/tavern-helper-variable-macros.js'
import { projectTavernHelperScripts, hasTavernScriptRuntime } from './domain/tavern-helper-scripts.js'
import { createTavernHelperEventGate } from './domain/tavern-helper-event-gate.js'
import { createTavernExtensionSettings } from './domain/tavern-extension-settings.js'
import { createTavernScriptHostAdapter } from './domain/tavern-script-host-adapter.js'
import { createTavernRemoteAssetPinStore } from './domain/tavern-remote-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from './domain/official-mvu-assets.js'
import { createTavernStaticResourceCache, projectCachedResourceBody } from './domain/tavern-static-resource-cache.js'
import { SILLYTAVERN_CSS_COMPAT_URLS } from './domain/sillytavern-css-compatibility.js'
import { createRoundHistory } from './domain/round-history.js'
import { TavernPromptTemplateRuntime } from './domain/tavern-prompt-template-runtime.js'
import {
  preserveRuntimeSource,
  projectAgentContent,
  projectRuntimeReply,
  projectRuntimeReplyHistory,
  resolveRuntimeMacroText,
  sanitizeAgentProjectionText
} from './domain/runtime-content-projection.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { filterSkillMessages } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { createStoryCompactionRequest, usesStoryCompaction } from './domain/story-compaction.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { createTavernSkillModule } from './domain/tavern-skills.js'
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import { applyTavernRegexText } from './domain/tavern-regex-display.js'
import { createTavernCompactionCoordinator } from './domain/tavern-compaction.js'
import { cordisToolNames, createTurnOrchestrator } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { mvuUpdateRulesFromWorldBook, prepareWorldBookRecall } from './domain/worldbook-recall.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore } from './profile-data-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import { createChatJournalStore } from './domain/chat-journal-store.js'
import { createResourceGraph } from './domain/resource-graph.js'
import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from './domain/tavern-settings.js'
import { prompt, SYSTEM_PROMPT_DEFINITIONS, SYSTEM_PROMPT_NAMES } from './prompt-catalog.js'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。
export async function apply(ctx) {
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  const sessionStore = ctx.get('sessions')
  if (llm === undefined || agentRegistry === undefined || sessionStore === undefined) {
    console.error('dsh-tavern: 缺少 llm、agents 或 sessions 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')
	const tavernHelperEventGate = createTavernHelperEventGate()
  let tavernPromptTemplateRuntime
  async function promptTemplateRuntime() {
    tavernPromptTemplateRuntime ??= TavernPromptTemplateRuntime.create()
    return await tavernPromptTemplateRuntime
  }
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  const dataRoot = resolveTavernDataRoot()
  const stablePrefixStorage = createSessionStablePrefixStorage(dataRoot + '/session-prefixes')
  const profileData = createProfileDataStore({ dataRoot })
  const tavernExtensionSettings = createTavernExtensionSettings(profileData)
  const mvuDiagnostics = createMvuDiagnosticStore(profileData)
  const tavernRemoteAssets = createTavernRemoteAssetPinStore({
    readJson: async function (path) { return await profileData.readJson(path) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
  const tavernStaticResources = createTavernStaticResourceCache({ rootDir: dataRoot + '/cache/static-assets' })
  void tavernStaticResources.warm([
    'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.12/dist/index.global.js',
    'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
    'https://cdn.jsdelivr.net/npm/jquery-ui@1.14.1/dist/jquery-ui.min.js',
    'https://cdn.jsdelivr.net/npm/jquery-ui@1.14.1/themes/base/theme.min.css',
    'https://cdn.jsdelivr.net/npm/jquery-ui-touch-punch@0.2.3/jquery.ui.touch-punch.min.js',
    'https://cdn.jsdelivr.net/npm/lodash@4.18.1/lodash.min.js',
    'https://cdn.jsdelivr.net/npm/vue@3.5.41/dist/vue.runtime.global.prod.js',
    'https://cdn.jsdelivr.net/npm/vue-router@5.2.0/dist/vue-router.global.prod.js',
    'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/css/all.min.css',
    'https://testingcf.jsdelivr.net/npm/zod@4.4.3/+esm',
    'https://testingcf.jsdelivr.net/npm/pinia/+esm'
  ].concat(SILLYTAVERN_CSS_COMPAT_URLS)).then(function (results) {
    const failures = results.filter(function (result) { return result.status === 'rejected' })
    if (failures.length > 0) console.warn('dsh-tavern: 部分静态运行库暂未缓存，将在使用时重试:', failures.map(function (result) { return str(result.reason && result.reason.message || result.reason) }).join('；'))
  })
  const settingsPath = 'tavern-settings.json'
  const promptTemplateVariablesPath = 'prompt-template-variables.json'
  async function readPromptTemplateGlobalVariables() {
    const saved = await profileData.readJson(promptTemplateVariablesPath)
    return saved && saved.global && typeof saved.global === 'object' && !Array.isArray(saved.global) ? saved.global : {}
  }
  async function writePromptTemplateGlobalVariables(variables) {
    await profileData.updateJson(promptTemplateVariablesPath, function (current) {
      const next = current && typeof current === 'object' ? Object.assign({}, current) : {}
      next.global = variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}
      next.updatedAt = Date.now()
      return next
    })
  }
  let tavernSettingsDocument = await profileData.readJson(settingsPath)
  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(function (name) { return [name, prompt(name)] }))
  }
  async function readTavernSettings() {
    tavernSettingsDocument = await profileData.readJson(settingsPath)
    return presentTavernSettings(tavernSettingsDocument, promptDefaults())
  }
  async function updateTavernSettings(patch) {
    tavernSettingsDocument = await profileData.updateJson(settingsPath, function (current) {
      return applyTavernSettingsPatch(current, patch)
    })
    return presentTavernSettings(tavernSettingsDocument, promptDefaults())
  }
  function runtimePrompt(name) {
    return resolveSystemPrompt(tavernSettingsDocument, name, prompt)
  }
  function presentSystemPrompts(settings) {
    const byName = Object.fromEntries((settings.systemPrompts || []).map(function (item) { return [item.name, item] }))
    return {
      spec: 'dsh-tavern.system-prompts',
      version: 1,
      prompts: SYSTEM_PROMPT_DEFINITIONS.map(function (definition) {
        return Object.assign({}, definition, byName[definition.name] || { text: prompt(definition.name), customized: false })
      })
    }
  }
  function importSystemPromptDocument(payload) {
    const prepared = prepareTextImport(payload, '系统提示词文件为空')
    let document
    try { document = JSON.parse(prepared.text) } catch (error) { throw new Error('系统提示词 JSON 无效: ' + str(error && error.message || error)) }
    if (!document || document.spec !== 'dsh-tavern.system-prompts') throw new Error('不是 DSH Tavern 系统提示词文件')
    if (Number(document.version) !== 1) throw new Error('不支持的系统提示词版本: ' + String(document.version))
    const source = document.prompts && typeof document.prompts === 'object' && !Array.isArray(document.prompts) ? document.prompts : {}
    const values = {}
    for (const name of SYSTEM_PROMPT_NAMES) {
      if (typeof source[name] !== 'string' || source[name].trim() === '') throw new Error('系统提示词文件缺少有效内容: ' + name)
      values[name] = source[name]
    }
    return values
  }
  const applicationUpdater = createApplicationUpdater({ dataRoot, sourceRoot })
  const modelRequestLog = createModelRequestLog({
    readJson: async function (path) { return await profileData.readJson(path) },
    writeJson: async function (path, value) { return await profileData.writeJson(path, value) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
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
  let coordinationEvents = null
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
  const CARD_PROJECTION_REVISIONS = 'card-projection-revisions.json'
  async function cardProjectionRevision(cardPath) {
    const state = await readJson(CARD_PROJECTION_REVISIONS)
    return Math.max(0, Number(state && state.cards && state.cards[str(cardPath)]) || 0)
  }
  async function bumpCardProjectionRevision(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const saved = await profileData.updateJson(CARD_PROJECTION_REVISIONS, function (value) {
      const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const cards = state.cards && typeof state.cards === 'object' && !Array.isArray(state.cards) ? state.cards : {}
      const version = Math.max(0, Number(state.version) || 0) + 1
      return { version, cards: Object.assign({}, cards, { [normalized]: version }) }
    })
    void coordinationEvents?.publishAll()
    return saved
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
    script: 'card-task-script',
    material: 'card-task-script',
    worldbook: 'card-task-worldbook',
    preset: 'card-task-preset',
    'debug-play': 'card-task-debug-play'
  })
  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    if (cardPreparation.isWorkspace(existing)) return existing
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
    if (kind !== 'source' && kind !== 'script') throw new Error('剧本引用必须指向剧本文件')
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
  // ---------- 剧本（可独立保存，也可与人物卡一对一绑定） ----------
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
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }
  const presetLibrary = createPresetLibrary({ resources: fileResources, state: profileData, prepareImport: prepareTextImport })
  const { read: readPreset, readDocument: readPresetDocument, preview: previewPreset,
    import: importPreset, editor: presetEditor, runtime: runtimePresets, plans: bypassPlans } = presetLibrary
  let resourceGraph
  async function renameResource(resourcePath, name) { return await resourceGraph.rename(resourcePath, name) }
  async function deleteLibraryResource(resourcePath, expectedKind) {
    const result = await resourceGraph.remove(resourcePath, expectedKind)
    return { removed: result.path }
  }
  async function deleteResource(resourcePath) { return await deleteLibraryResource(resourcePath, 'source') }
  async function deletePreset(resourcePath) {
    return await deleteLibraryResource(resourcePath, 'preset')
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
    if (chat.requestMode !== 'sillytavern') chat.requestMode = 'dsh'
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
  const chatJournalStore = createChatJournalStore({ dataRoot, legacyData: profileData, now: Date.now, logger: console })
  const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: normalizeChat, now: Date.now })
  async function readChat(chatId) { return await chatPersistence.read(chatId) }
  async function readChatRevision(chatId, revision) { return await chatPersistence.readRevision(chatId, revision) }
  async function rawWriteChat(chat, metadata) { return await chatPersistence.write(chat, metadata) }
  async function rawUpdateChat(chatId, mutation, metadata) { return await chatPersistence.update(chatId, mutation, metadata) }
  let conversationRegistry
  async function syncChatSummary(chat) {
    if (!conversationRegistry || chat === undefined) return
    try { await conversationRegistry.sync(chat) }
    catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', str(error && error.message || error)) }
  }
  async function writeChat(chat, metadata) {
    const saved = await rawWriteChat(chat, metadata)
    await syncChatSummary(saved)
    void coordinationEvents?.publish(saved.sessionId)
    return saved
  }
  async function updateChat(chatId, mutation, metadata) {
    const saved = await rawUpdateChat(chatId, mutation, metadata)
    await syncChatSummary(saved)
    if (saved !== undefined) void coordinationEvents?.publish(saved.sessionId)
    return saved
  }
  conversationRegistry = createTavernConversationRegistry({
    store: {
      readLinks: async function () { return await readJson('sessions.json') },
      updateLinks: async function (updater) { return await profileData.updateJson('sessions.json', updater) },
      readIndex,
      writeIndex,
      readChat,
      writeChat: rawWriteChat,
      removeChat: async function (chatId) { await chatPersistence.remove(chatId) }
    }
  })
  async function readSessionMap() { return await conversationRegistry.links() }
  async function chatForSession(sessionId) { return await conversationRegistry.resolve(sessionId) }
  resourceGraph = createResourceGraph({
    resources: fileResources,
    presets: runtimePresets,
    chats: { readIndex, writeIndex, readChat, writeChat },
    operations: {
      read: async function () { return await readJson('resource-graph-operation.json') },
      write: async function (operation) { await writeJson('resource-graph-operation.json', operation) },
      remove: async function () { await profileData.remove('resource-graph-operation.json') }
    }
  })
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
    const cardPaths = await fileResources.list('card')
    const scriptBindings = await fileResources.scriptBindingsForCards(cardPaths)
    return await Promise.all(cardPaths.map(async function (cardPath) {
      const card = await readCard(cardPath)
      const scriptPath = scriptBindings[cardPath]
      return { path: cardPath, name: card.name, script: scriptPath === undefined ? null : { path: scriptPath, title: scriptPath.split('/').pop() } }
    }))
  }
  async function getCardOpenings(cardPath, userName, requestMode) {
    const card = await readCard(cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const settings = await readTavernSettings()
    const extensions = await readCardExtensions(cardPath)
    const preset = settings.compatibilityMode && requestMode === 'sillytavern'
      ? await runtimePresets.fullSnapshot()
      : null
    const previews = await projectCardOpeningPreviews({
      card,
      extensions,
      userName,
      presetRegexScripts: Array.isArray(preset && preset.regexScripts) ? preset.regexScripts : []
    })
    return {
      openings: previews.openings,
      diagnostics: previews.diagnostics,
      trustedCardMode: settings.trustedCardMode
    }
  }
  async function listTavernResources() {
    const cards = await listCards()
    const sources = await listSources()
    return {
      cards,
      resources: sources.map(function (source) {
        const boundCards = cards.filter(function (card) { return card.script !== null && card.script.path === source.path }).map(function (card) { return { path: card.path, name: card.name } })
        return { path: source.path, previewPath: fileResources.absolute(source.path), title: source.title, sourceChars: Number(source.sourceChars) || 0, chunkCount: Number(source.chunkCount) || 0, boundCards }
      })
    }
  }
  async function updateCard(cardPath, patch, revision, rawOperations) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const change = cardPreparation.update({ kind: 'card', card: workspace, patch: patch, revision: revision, rawOperations: rawOperations })
    const savedWorkspace = change.card
    if (!change.changed) {
      const unchangedCard = change.view
      unchangedCard.path = cardPath
      unchangedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
      return Object.assign({}, change, { card: unchangedCard })
    }
    await fileResources.writeWorking(normalizeResourcePath(cardPath, 'card'), JSON.stringify(savedWorkspace, null, 2))
    await bumpCardProjectionRevision(cardPath)
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
        await writeChat(linked, { source: 'card-name.sync' })
      }
    }
  }
  async function restoreCurrentCard(sessionId) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') !== 'card') throw new Error('原版恢复只能在卡片模式中使用')
    const cardPath = str(chat.cardPath)
    if (cardPath === '') throw new Error('空白工作台没有可恢复的正式人物卡')
    const restored = await fileResources.restoreCard(cardPath, function (payload) {
      return cardPreparation.create({ kind: 'import', payload: payload })
    })
    const restoredCard = cardPreparation.project(restored.card)
    await bumpCardProjectionRevision(cardPath)
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
  async function exportConversation(chatId, sessionId, title) {
    const chat = str(chatId) === '' ? await chatForSession(str(sessionId)) : await readChat(str(chatId))
    if (chat === undefined) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const exported = createConversationTextExport(chat, { title: str(title) })
    if (exported.messageCount === 0) throw new Error('暂无可导出的对话')
    return exported
  }
  async function exportTavernLogs(sessionId) {
    const chat = await chatForSession(str(sessionId))
    if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const diagnostic = await mvuDiagnostics.read(sessionId)
    const backgroundSessionIds = [...new Set(diagnostic.records.map(record => record.traceSessionId).filter(Boolean))]
    const exported = await createMvuDiagnosticExport({ sessionId, backgroundSessionIds, store: mvuDiagnostics, sessions: sessionStore, persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery'), attachments: ctx.get('attachments'), environment: { mvu: OFFICIAL_MVU_VERSION } })
    return { filename: exported.filename, base64: exported.buffer.toString('base64') }
  }
  async function attachPlayChatDebug(targetSessionId, sourceSessionId, turn) {
    const editorChat = await chatForSession(str(targetSessionId))
    const sourceChat = await chatForSession(str(sourceSessionId))
    if (editorChat === undefined) throw new Error('卡片工作台对话不存在')
    if (sourceChat === undefined) throw new Error('游玩对话不存在')
    const reference = createPlayChatDebugReference(editorChat, sourceChat, turn)
    const mounted = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources) ? editorChat.workspace.mountedResources : []
    editorChat.workspace.mountedResources = mounted.filter(function (item) {
      return !item || item.kind !== 'play-chat' || item.path !== reference.path
    }).concat([reference])
    await writeChat(editorChat, { source: 'play-chat.attach' })
    return reference
  }

  function assistantMessageAtTurn(chat, requestedTurn) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    let inferred = 1
    for (const message of messages) {
      if (message && message.role === 'user') inferred += 1
      if (message && message.role === 'assistant' && Math.max(1, Number(message.turn) || (message.greeting === true ? 1 : inferred)) === requestedTurn) return message
    }
    return null
  }

  function cleanRuntimeUrl(value) {
    return str(value).split(/[?#]/)[0].replace(/\/\/[^/@\s]+@/, '//').slice(0, 1000)
  }

  function sanitizeDisplayRuntime(value) {
    const input = value && typeof value === 'object' ? value : {}
    function scalar(item, limit = 4000) {
      if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') return item
      if (typeof item === 'string') return item.slice(0, limit)
      try { return JSON.parse(JSON.stringify(item).slice(0, limit)) } catch { return str(item).slice(0, limit) }
    }
    return {
      capturedAt: Math.max(0, Number(input.capturedAt) || Date.now()),
      mvuViewUsed: input.mvuViewUsed === true,
      dom: str(input.dom).slice(0, 100000),
      console: (Array.isArray(input.console) ? input.console : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), level: ['log', 'info', 'warn', 'error'].includes(item && item.level) ? item.level : 'log', args: scalar(item && item.args, 12000) }
      }),
      network: (Array.isArray(input.network) ? input.network : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: item && item.kind === 'xhr' ? 'xhr' : 'fetch', method: str(item && item.method).slice(0, 16), url: cleanRuntimeUrl(item && item.url), status: Math.max(0, Number(item && item.status) || 0), durationMs: Math.max(0, Number(item && item.durationMs) || 0), failed: item && item.failed === true, error: str(item && item.error).slice(0, 1000) }
      }),
      errors: (Array.isArray(input.errors) ? input.errors : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: str(item && item.kind).slice(0, 32), message: str(item && item.message).slice(0, 4000), tag: str(item && item.tag).slice(0, 32), url: cleanRuntimeUrl(item && item.url || item && item.source), line: Math.max(0, Number(item && item.line) || 0), column: Math.max(0, Number(item && item.column) || 0) }
      })
    }
  }

  function comparableDisplayRuntime(value) {
    const runtime = value && typeof value === 'object' ? value : {}
    return {
      mvuViewUsed: runtime.mvuViewUsed === true,
      dom: str(runtime.dom),
      console: (Array.isArray(runtime.console) ? runtime.console : []).map(function (item) {
        return { level: item && item.level, args: item && item.args }
      }),
      network: (Array.isArray(runtime.network) ? runtime.network : []).map(function (item) {
        return { kind: item && item.kind, method: item && item.method, url: item && item.url, status: item && item.status, failed: item && item.failed, error: item && item.error }
      }),
      errors: (Array.isArray(runtime.errors) ? runtime.errors : []).map(function (item) {
        return { kind: item && item.kind, message: item && item.message, tag: item && item.tag, url: item && item.url, line: item && item.line, column: item && item.column }
      })
    }
  }

  function sameDisplayRuntimeCapture(left, right) {
    return JSON.stringify(comparableDisplayRuntime(left)) === JSON.stringify(comparableDisplayRuntime(right))
  }

  async function captureDisplayRuntime(sessionId, requestedTurn, partIndex, runtime) {
    const chat = await chatForSession(str(sessionId))
    if (chat === undefined || groupOfMode(chat.mode) !== 'play') throw new Error('当前 Session 没有绑定游玩对话')
    const turn = Math.max(1, Number(requestedTurn) || 0)
    const message = assistantMessageAtTurn(chat, turn)
    if (message === null) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
    const index = Math.max(0, Math.min(100, Number(partIndex) || 0))
    let capture = sanitizeDisplayRuntime(runtime)
    const existingRuntime = message.displayRuntime && typeof message.displayRuntime === 'object' ? message.displayRuntime : null
    const sourceActivityAt = Math.max(0, Number(existingRuntime && existingRuntime.sourceActivityAt) || Number(chat.updatedAt) || 0)
    const latestTurn = Math.max.apply(null, (chat.messages || []).filter(function (item) { return item && item.role === 'assistant' }).map(function (item) { return Math.max(1, Number(item.turn) || 1) }).concat([1]))
    capture.captureKind = turn === latestTurn && Date.now() - sourceActivityAt < 300000 ? 'live' : 'replay'
    const current = existingRuntime || { frames: [] }
    const currentFrames = Array.isArray(current.frames) ? current.frames : []
    const existingFrame = currentFrames.find(function (item) { return Number(item && item.partIndex) === index })
    if (existingFrame && existingFrame.mvuViewUsed === true) capture.mvuViewUsed = true
    if (existingFrame && capture.mvuViewUsed === true && capture.dom === '' && capture.console.length === 0 && capture.network.length === 0 && capture.errors.length === 0) {
      capture = Object.assign({}, existingFrame, {
        capturedAt: capture.capturedAt,
        captureKind: capture.captureKind,
        mvuViewUsed: true
      })
    }
    if (existingFrame && sameDisplayRuntimeCapture(existingFrame, capture)) return { captured: false, turn, partIndex: index, captureKind: capture.captureKind }
    const frames = currentFrames.filter(function (item) { return Number(item && item.partIndex) !== index })
    frames.push(Object.assign({ partIndex: index }, capture))
    message.displayRuntime = { version: 1, sourceActivityAt, frames: frames.sort(function (a, b) { return a.partIndex - b.partIndex }) }
    await writeChat(chat, { source: 'display.capture', touchUpdatedAt: false })
    return { captured: true, turn, partIndex: index, captureKind: capture.captureKind }
  }
  const tavernScriptHostAdapter = createTavernScriptHostAdapter({
    resolveChat: chatForSession,
    writeChat,
    readCard: readChatCard,
    worldBooks,
    eventGate: tavernHelperEventGate,
    extensionSettings: tavernExtensionSettings,
    diagnostics: mvuDiagnostics,
    hasScripts: async function (chat) { return hasTavernScriptRuntime(chat, (await readCardExtensions(chat.cardPath))?.helperScripts) },
    isPlayChat: function (chat) { return groupOfMode(chat.mode) === 'play' }
  })

  function sessionDebugEvidence(sessionId) {
    const id = str(sessionId)
    if (id === '') return { sessionId: '', loaded: false, events: [] }
    let session = null
    try {
      const sessions = ctx.get('sessions')
      session = sessions && typeof sessions.get === 'function' ? sessions.get(id) : null
    } catch {}
    if (!session) {
      try {
        const agent = agentRegistry.get(id)
        session = agent && agent.session
      } catch {}
    }
    return { sessionId: id, loaded: Boolean(session && Array.isArray(session.events)), events: session && Array.isArray(session.events) ? session.events : [] }
  }

  // ---------- 聊天 ----------
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
    const runtimeSettings = await readTavernSettings()
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await readScript(chat.cardPath)
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    const activePresetSnapshot = groupOfMode(chat.mode) === 'play' ? await runtimePresets.fullSnapshot() : null
    let replyDisplay = { projections: replyProjectionsOf(chat), presentation: null, latestSourceBacked: false }
    let cardExtensions = { regexScripts: [], helperScripts: [] }
    if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
      cardExtensions = await readCardExtensions(chat.cardPath) || cardExtensions
      const pinnedExtensions = await tavernRemoteAssets.pinExtensions(cardExtensions)
      cardExtensions = Object.assign({}, cardExtensions, {
        helperScripts: pinnedExtensions.helperScripts,
        regexScripts: pinnedExtensions.regexScripts,
        remoteAssetDiagnostics: pinnedExtensions.diagnostics,
        remoteAssetPins: pinnedExtensions.pins
      })
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      replyDisplay = projectRuntimeReplyHistory(chat.messages, {
        regexScripts: (Array.isArray(cardExtensions.regexScripts) ? cardExtensions.regexScripts : []).concat(presetRegexScripts),
        placement: 2,
        isMarkdown: true,
        isEdit: false,
        depth: 0
      })
      const persistentStatus = projectPersistentStatusView(chat.messages, replyDisplay.projections)
      replyDisplay.projections = persistentStatus.projections
      replyDisplay.statusView = persistentStatus.statusView
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
    }
    const activity = backgroundTasks.activity(chat)
    const debugTurns = []
    for (const message of Array.isArray(chat.messages) ? chat.messages : []) {
      if (!message || message.role !== 'assistant') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const source = (str(message.sourceText) || str(message.text)).replace(/\s+/g, ' ').trim()
      debugTurns.push({ turn, preview: source.slice(0, 90), chars: source.length })
    }
    const inputSources = {}
    const runtimeInputs = chat.runtimeInputs && typeof chat.runtimeInputs === 'object' ? chat.runtimeInputs : {}
    for (const turn of Object.keys(runtimeInputs)) {
      const input = runtimeInputs[turn]
      inputSources[turn] = str(input && input.source)
    }
    const helperEnabled = hasTavernScriptRuntime(chat, cardExtensions.helperScripts)
    const helperRuntime = helperEnabled
      ? projectTavernHelperScripts(cardExtensions.helperScripts, chat.tavernHelperScriptVariables)
      : { scripts: [], diagnostics: [] }
    helperRuntime.diagnostics.push(...(Array.isArray(cardExtensions.remoteAssetDiagnostics) ? cardExtensions.remoteAssetDiagnostics : []))
    let helperWorldbook = null
    if (helperEnabled && str(chat.cardPath) !== '') {
      try {
        const record = await worldBooks.bound(chat.cardPath, card)
        if (record !== null) helperWorldbook = projectTavernHelperWorldbook(record.view)
      } catch (error) {
        helperRuntime.diagnostics.push({ scriptId: '', name: '世界书', status: 'unavailable', message: str(error && error.message || error) })
      }
    }
    return {
      chatId: chat.id,
      mode: chat.mode || 'story',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      playerName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      bypassPlan: null,
      runtimePreset: activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName },
      card: cardViewOf(card, chat),
      posture: chat.posture || '',
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      debugTurns: debugTurns.slice(-12).reverse(),
      inputSources,
      canRollback: hasRollbackMessages(chat.messages),
      presentation: null,
      replyProjections: replyDisplay.projections,
      tavernStatusView: replyDisplay.statusView || null,
      mvuReceipts: mvuReceiptsOf(chat),
      tavernHelper: helperEnabled ? { ...projectTavernHelperContext(chat), extensionSettings: await tavernExtensionSettings.read() } : null,
      tavernMvuRuntime: chat.mvu && chat.mvu.enabled === true ? {
        owner: chat.mvu.owner === 'official' ? 'official' : 'legacy',
        commit: OFFICIAL_MVU_VERSION.commit,
        assetUrl: OFFICIAL_MVU_VERSION.assetUrl
      } : null,
      tavernSwipes: (Array.isArray(chat.messages) ? chat.messages : []).map(function (message, messageId) {
        if (!message || message.role !== 'assistant') return null
        const count = Math.max(Array.isArray(message.swipes) ? message.swipes.length : 0, 1)
        return { messageId, turn: Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0)), swipeId: Math.max(0, Math.min(count - 1, Number(message.swipeId) || 0)), count }
      }).filter(function (item) { return item && item.turn > 0 }),
      suppressedDshTurns: Array.from(new Set((Array.isArray(chat.suppressedDshTurns) ? chat.suppressedDshTurns : [])
        .map(Number).filter(function (turn) { return Number.isSafeInteger(turn) && turn > 0 }))).sort(function (left, right) { return left - right }),
      suppressedDshErrorTurns: supersededRegenerationErrorTurns({
        events: sessionDebugEvidence(chat.sessionId).events,
        suppressedDshTurns: chat.suppressedDshTurns
      }),
      tavernHelperScripts: helperRuntime.scripts,
      tavernHelperScriptDiagnostics: helperRuntime.diagnostics,
      tavernRemoteAssetPins: Array.isArray(cardExtensions.remoteAssetPins) ? cardExtensions.remoteAssetPins : [],
      tavernHelperWorldbook: helperWorldbook,
      tavernRuntimePolicy: { trustedCardMode: runtimeSettings.trustedCardMode },
      presentationWarnings: Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : [],
      worldBookError: chat.worldBookError || null,
      foregroundError: chat.foregroundError || null,
      lastWorldBookRecall: chat.lastWorldBookRecall || null,
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      scriptProgress: scriptProgress,
      updatedAt: chat.updatedAt || 0
    }
  }
  function replyProjectionsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const projections = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant') continue
      const displayText = Object.prototype.hasOwnProperty.call(message, 'displayText') ? str(message.displayText) : str(message.text)
      const mode = str(message.displayMode) || 'markdown'
      if (displayText === str(message.text) && mode !== 'html' && mode !== 'rich') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      projections.push({
        version: Math.max(1, Number(message.projectionVersion) || 1),
        turn,
        text: displayText,
        mode,
        warnings: Array.isArray(message.projectionWarnings) ? message.projectionWarnings : []
      })
    }
    return projections
  }
  function mvuReceiptsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const receipts = []
    for (const message of messages) {
      if (!message || message.role !== 'assistant' || !message.mvu) continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const stored = message.mvu.receipt
      const diagnostics = Array.isArray(message.mvu.diagnostics) ? message.mvu.diagnostics : []
      const receipt = stored && typeof stored === 'object' ? structuredClone(stored) : {
        version: 1,
        status: message.mvu.pending === true ? 'pending' : (diagnostics.length > 0 ? 'error' : (message.mvu.modified === true ? 'updated' : 'unchanged')),
        summary: '',
        changes: [],
        failures: diagnostics.map(function (item) { return { command: str(item.command), message: str(item.message) } })
      }
      receipts.push({ turn, receipt })
    }
    return receipts
  }
  function withLegacyPresentationProjection(chat, projections) {
    const result = Array.isArray(projections) ? projections.slice() : []
    const legacy = chat && chat.presentation
    if (!legacy || typeof legacy !== 'object' || str(legacy.html) === '') return result
    const turn = Math.max(1, Number(legacy.turn) || (legacy.source === 'opening' ? 1 : 0))
    if (result.some(function (projection) { return Number(projection.turn) === turn })) return result
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant' || Object.prototype.hasOwnProperty.call(message, 'sourceText')) continue
      const messageTurn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (messageTurn === turn || (turn > 1 && target === null)) target = message
      if (messageTurn === turn) break
    }
    if (target === null) return result
    const projected = projectRuntimeReply(str(target.text) + '\n\n' + str(legacy.html))
    result.push({
      version: 2,
      turn,
      text: projected.displayText,
      mode: projected.displayMode,
      parts: projected.displayParts,
      warnings: ['旧会话兼容：正文与历史人物卡界面已在原消息位置合并显示。'].concat(projected.warnings)
    })
    return result.sort(function (left, right) { return Number(left.turn) - Number(right.turn) })
  }
  async function startChat(cardPath, sessionId, mode, openingId, userName, requestMode) {
    return await conversationInitialization.start({ cardPath, sessionId, mode, openingId, userName, requestMode })
  }

  async function scriptPreviewOf(chat) {
    if ((chat.mode || 'story') !== 'script') return null
    const script = await readScript(chat.cardPath)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  async function sessionActivity(sessionId) {
    let chat = await chatForSession(sessionId)
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
  async function sessionOperation(sessionId, operationId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) return null
    const operation = backgroundTasks.operation(chat, operationId)
    if (operation === null || operation.role !== 'candidate' || operation.successful !== true) return operation
    const candidates = await candidateGenerator.find({ sessionId, messageId: chat.candidates && chat.candidates.messageId })
    if (candidates === null || candidates.operationId !== operation.operationId || candidates.requestId !== operation.requestId) return operation
    return Object.assign({}, operation, { result: { candidates } })
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
    return await conversationInitialization.ensureOpening(sessionId)
  }
  const contextPlanner = createContextPlanner({ prompt: runtimePrompt, callModel: callModel, now: Date.now, logger: console })
  const playCardSnapshots = createPlayCardSnapshots({ worldBooks, planner: contextPlanner, readCard: readChatCard, writeChat })
  const ensurePlayCardSnapshot = playCardSnapshots.ensure
  const conversationInitialization = createConversationInitialization({
    cards: { read: readCard, readChat: readChatCard, script: readScript, extensions: readCardExtensions },
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, write: writeChat },
    snapshots: playCardSnapshots,
    presets: runtimePresets,
    settings: readTavernSettings,
    cardGreeting: function () { return runtimePrompt('card-mode-greeting') },
    emptyCardWorkspace,
    id: uid,
    native: {
      wait: function (sessionId) { return waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }) },
      ensurePrefix: function (session, text) { return ensureSessionStablePrefix(session, text, stablePrefixStorage) },
      flush: function (session) { return sessionStore.flush(session) },
      selection: modelSelection
    },
    present: async function (chat, card) {
      const result = await view(chat, card)
      if (chat.mode === 'card') result.workspace = workspaceViewOf(chat)
      return result
    }
  })
  const runtimePresetSnapshots = new Map()
  const backgroundAgentRunner = createBackgroundAgentRunner({
    stablePrefixStorage,
    agents: agentRegistry,
    agentPreset: 'tavern-background',
    resolveStablePrefix: async function (input) {
      if (input.task === 'image') return ''
      const chat = await chatForSession(input.sessionId)
      return chat ? await ensurePlayCardSnapshot(chat) : ''
    },
    setupAgent: async function (childCtx) {
      await agentPresets.mount(childCtx, 'tavern-background')
    },
    compactAgent: executeBackgroundCompaction,
    flushSession: async function (session) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) throw new Error('dsh-tavern: 缺少 sessions 服务')
      await sessions.flush(session)
    },
    resolveRuntimePresetSnapshot: async function (input) {
      // 外部 Tavern 预设只投影到前台正文请求。后台 Agent 有自己的结构化任务协议，
      // 继承整份预设可能破坏候选生成和状态结算的输出契约。
      return null
    },
    stageRuntimePresetSnapshot: function (input) {
      runtimePresetSnapshots.set(str(input.sessionId), {
        turn: Math.max(0, Number(input.turn) || 0),
        step: Math.max(1, Number(input.step) || 1),
        scope: 'background',
        snapshot: input.snapshot || null
      })
    }
  })
  const mvuSettlement = createMvuSettlementModule({
    model: backgroundAgentRunner,
    runtime: tavernScriptHostAdapter,
    diagnostics: mvuDiagnostics
  })
  ctx.effect(() => () => backgroundAgentRunner.dispose(), 'dsh-tavern: dispose resident background agents')
  const sceneIllustrations = createSceneIllustrations({
    store: profileData, chatForSession, selection: modelSelection,
    isRunning: sessionId => ctx.get('agents')?.get(sessionId)?.phase?.kind === 'running',
    stateAtTarget: async (chat, target) => {
      // The next turn's beforeRevision contains the settled state of this turn.
      const next = (chat.timeline?.checkpoints || []).find(item => Number(item.turn) > target.turn && Number.isSafeInteger(item.beforeRevision))
      if (!next) return undefined
      const historical = await readChatRevision(chat.id, next.beforeRevision)
      if (!historical) return undefined
      const last = [...(historical.messages || [])].reverse().find(item => item.role === 'assistant')
      const lastTurn = Number(last?.turn || (last?.greeting ? 1 : 0))
      if (lastTurn !== target.turn || historical.settleStatus !== 'done') return undefined
      const original = sceneTarget(historical, target.turn)
      return original.key === target.key ? historical : undefined
    },
    credentials: () => ctx.get('credentials'), attachments: () => ctx.get('attachments'),
    runAgent: input => backgroundAgentRunner.run(input),
    onStorageError: () => console.error('dsh-tavern: 生图状态保存失败，请检查数据目录权限')
  })
  ctx.effect(() => () => sceneIllustrations.dispose(), 'dsh-tavern: dispose scene image agents')
  let tavernCompaction = null
  const backgroundTasks = createBackgroundTaskCoordinator({
    store: { readChat, writeChat },
    timeline: storyTimeline,
    blocked: function (chat) { return tavernCompaction !== null && tavernCompaction.blocked(chat) }
  })
  tavernCompaction = createTavernCompactionCoordinator({
    store: { chatForSession, updateChat },
    activity: function (chat) { return backgroundTasks.activity(chat) },
    now: Date.now
  })
  async function compactBackground(sessionId, operationId) {
    const backgroundSessionId = await tavernCompaction.backgroundTarget(sessionId, operationId)
    if (backgroundSessionId === '') return { status: 'skipped', message: '没有后台 Session' }
    try {
      const result = await backgroundAgentRunner.compact({ sessionId: backgroundSessionId })
      if (result === null) return { status: 'succeeded', message: '没有可压缩的后台历史' }
      if (typeof result.message === 'string' && result.message !== '') {
        return { status: 'succeeded', message: result.message }
      }
      return {
        status: 'succeeded',
        message: 'Compacted ' + result.shadowedSeqs.length + ' history items (~' + result.shadowedTokenCount + ' tokens).'
      }
    } catch (error) {
      return { status: 'failed', message: str(error && error.message || error) || '后台压缩失败' }
    }
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
    stableWorldBookContext,
    prompt: runtimePrompt,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    tasks: backgroundTasks,
    waitUntilSettled: async function (chat) {
      let current = await readChat(chat.id)
      if (current === undefined) return
      let shouldRun = false
      if (isOpeningAwaitingSettlement(current)) {
        current.settleStatus = 'running'
        current.settleError = null
        await writeChat(current, { source: 'settlement.opening-prepare' })
        shouldRun = true
      }
      const activity = backgroundTasks.activity(current)
      if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
      if (shouldRun) await queueSettlement(current.id)
    },
    sleep: sleep,
    now: Date.now,
    logger: console
  })
  const candidateTasks = createCandidateTasks({
    chats: { read: readChat, write: writeChat, forSession: chatForSession },
    generator: candidateGenerator,
    backgroundTasks,
    sessions: {
      runtimeGeneration,
      isLive: function (sessionId) { return Boolean(agentRegistry.get(sessionId)?.session) },
      projectionRevision: cardProjectionRevision
    },
    prepareLegacy: pullBackgroundCycle
  })
  async function listTavernSessions() {
    return await conversationRegistry.list()
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
    await writeChat(chat, { source: 'guide.add' })
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
    await writeChat(chat, { source: 'guide.delete' })
    return chat.guides
  }
  async function setPlayerName(sessionId, userName) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不使用玩家称呼')
    const name = str(userName).trim().slice(0, 80) || '你'
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: name, local: {}, global: {} }
    else chat.macroState.userName = name
    await writeChat(chat, { source: 'player-name.set' })
    return name
  }
  async function setRequestMode(sessionId, requestMode) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不能切换请求模式')
    const settings = await readTavernSettings()
    if (requestMode === 'sillytavern' && !settings.compatibilityMode) throw new Error('请先在设置中启用兼容模式（实验性）')
    chat.requestMode = requestMode === 'sillytavern' ? 'sillytavern' : 'dsh'
    await writeChat(chat)
    return chat.requestMode
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
  function pendingMvuTarget(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
      const message = messages[messageId]
      if (!message || message.role !== 'assistant' || !message.mvu || message.mvu.pending !== true) continue
      const swipeId = Math.max(0, Number(message.swipeId) || 0)
      const variables = Array.isArray(message.variables) ? message.variables[swipeId] : undefined
      return {
        messageId,
        swipeId,
        message,
        variables: variables && typeof variables === 'object' ? structuredClone(variables) : {}
      }
    }
    return null
  }
  async function mvuUpdateRules(chat, card) {
    try {
      const worldBook = await worldBooks.bound(chat.cardPath, card)
      return mvuUpdateRulesFromWorldBook(worldBook)
    } catch (_error) {
      return []
    }
  }
  async function prepareNextWorldBookContext(snapshot) {
    const turn = settlementTurn(snapshot)
    const inspected = storyTimeline.inspect({ chat: snapshot })
    if (snapshot.preparedWorldBook && Number(snapshot.preparedWorldBook.revision) === Number(inspected.revision)) return snapshot
    let prepared = null
    let error = null
    try {
      const card = await readChatCard(snapshot)
      const worldBook = await worldBooks.bound(snapshot.cardPath, card)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card, worldBook })
    } catch (caught) {
      error = str(caught && caught.message || caught)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card: null, worldBook: null })
    }
    const latest = await readChat(snapshot.id)
    if (latest === undefined) return null
    const current = storyTimeline.inspect({ chat: latest })
    if (current.branchId !== inspected.branchId || Number(current.revision) !== Number(inspected.revision)) return latest
    const context = error === null ? str(prepared.context).trim() : ''
    latest.preparedWorldBookContext = context
    latest.preparedWorldBook = {
      ts: Date.now(),
      turn,
      branchId: current.branchId,
      revision: current.revision,
      mode: error === null ? str(prepared.kind) : 'error',
      refs: error === null ? prepared.refs : [],
      totalChars: Number(prepared.totalChars) || 0,
      contextChars: Array.from(context).length,
      empty: error !== null || context === '',
      failed: error !== null
    }
    if (error === null) latest.worldBookReads = prepared.recordReads(latest.worldBookReads)
    latest.worldBookError = error
    latest.lastWorldBookRecall = Object.assign({}, latest.preparedWorldBook)
    await writeChat(latest, { source: 'worldbook.projection' })
    return latest
  }
  async function runSettlement(chatId) {
    while (true) {
      let snapshot = await readChat(chatId)
      if (snapshot === undefined) return
      snapshot = await prepareNextWorldBookContext(snapshot)
      if (snapshot === null) return
      const taskRun = await backgroundTasks.begin(snapshot, 'settlement')
      snapshot = taskRun.chat
      let backgroundSessionId = str(taskRun.participantRequest.sessionId)
      let backgroundBoundary = null
      try {
        const card = await readChatCard(snapshot)
        const mvuTarget = snapshot.mvu && snapshot.mvu.enabled === true && snapshot.mvu.owner === 'official'
          ? pendingMvuTarget(snapshot)
          : null
        let text = ''
        let result = null
        let lastError = null
        let mvuResult = null
        const selection = modelSelection(snapshot.sessionId)
        if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
        if (mvuTarget !== null) {
          mvuResult = await mvuSettlement.settleVariables({
            operationId: taskRun.operationId,
            chatId: snapshot.id,
            branchId: taskRun.basedOn.branchId,
            basedOnRevision: taskRun.basedOn.revision,
            sessionId: snapshot.sessionId,
            turn: settlementTurn(snapshot),
            messageId: mvuTarget.messageId,
            swipeId: mvuTarget.swipeId,
            expectedLifecycleRevision: Math.max(0, Number(snapshot.tavernHelperLifecycleRevision) || 0),
            storyText: str(mvuTarget.message.sourceText || mvuTarget.message.projectionText || mvuTarget.message.text),
            currentVariables: mvuTarget.variables,
            variableSchema: mvuTarget.variables.schema,
            updateRules: await mvuUpdateRules(snapshot, card),
            system: runtimePrompt('posture-settlement'),
            selection,
            persistentSessionId: backgroundSessionId
          })
          text = mvuResult.text
          backgroundSessionId = str(mvuResult.traceSessionId)
          backgroundBoundary = Number.isSafeInteger(mvuResult.traceBoundary) ? mvuResult.traceBoundary : null
          result = parseJsonLenient(text)
        } else {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
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
                system: runtimePrompt('posture-settlement'),
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
        }
        let stat = { postureUpdated: false }
        const completed = await taskRun.commit({
          stateChanged: Boolean(mvuResult && mvuResult.receipt && mvuResult.receipt.status === 'updated') || str(result && result.posture).trim() !== '',
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary }),
          apply(draft) {
            stat = applySettlement(draft, result)
            if (mvuResult !== null) {
              const target = draft.messages[mvuTarget.messageId]
              if (target && target.role === 'assistant' && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
                const receipt = structuredClone(mvuResult.receipt)
                target.mvu = {
                  pending: false,
                  modified: receipt.status === 'updated',
                  diagnostics: receipt.status === 'stale' ? [{ message: receipt.summary }] : [],
                  events: receipt.status === 'stale' ? [] : ['MESSAGE_RECEIVED'],
                  receipt
                }
              }
            }
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
        if (backgroundSessionId === '') backgroundSessionId = str(err && err.traceSessionId)
        if (backgroundBoundary === null && Number.isSafeInteger(err && err.traceBoundary)) backgroundBoundary = err.traceBoundary
        const failed = await taskRun.commit({
          status: 'failed',
          stateChanged: false,
          participant: taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary })
        })
        if (failed.status === 'missing') return
        if (failed.status === 'stale' && backgroundTasks.activity(failed.chat).busy) continue
        const latest = await readChat(chatId)
        const target = pendingMvuTarget(latest)
        if (target !== null) {
          const message = str(err && err.message || err) || 'MVU 后台变量结算失败'
          target.message.mvu = {
            pending: false,
            modified: false,
            diagnostics: [{ message }],
            events: [],
            receipt: { version: 1, status: 'error', summary: '', changes: [], failures: [{ command: '', message }] }
          }
          latest.settleStatus = 'failed'
          latest.settleError = message
          await writeChat(latest, { source: 'settlement.mvu-failed' })
        }
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
  async function retryMvuSettlement(sessionId, turn) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if (!chat.mvu || chat.mvu.enabled !== true || chat.mvu.owner !== 'official') throw new Error('当前对话没有启用官方 MVU')
    const activity = backgroundTasks.activity(chat)
    if (activity.busy) throw new Error('后台 Agent 正在运行，请稍候')
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
      const message = messages[messageId]
      if (!message || message.role !== 'assistant' || !message.mvu) continue
      target = { messageId, message }
      break
    }
    if (target === null || Math.max(0, Number(target.message.turn) || 0) !== Math.max(0, Number(turn) || 0)) {
      throw new Error('只能重试当前最新正文的变量结算')
    }
    target.message.mvu = { pending: true, modified: false, diagnostics: [], events: [] }
    chat.settleStatus = 'pending'
    chat.settleError = null
    chat.updatedAt = Date.now()
    await writeChat(chat, { source: 'settlement.mvu-retry' })
    void queueSettlement(chat.id).catch(function (error) {
      console.error('dsh-tavern: 重试变量结算失败', str(error && error.message || error))
    })
    return await view(chat, await readChatCard(chat))
  }
  async function pullBackgroundCycle(sessionId) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    let shouldRun = false
    if (isOpeningAwaitingSettlement(chat)) {
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat, { source: 'settlement.opening-prepare' })
      shouldRun = true
    }
    const activity = backgroundTasks.activity(chat)
    if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
    if (!shouldRun) return true
    void queueSettlement(chat.id)
    return false
  }
  // ---------- 卡片工作台：挂载剧本与新卡创建 ----------
  async function sourceWindowOf(chat) {
    const out = []
    for (const sourcePath of (chat.workspace && chat.workspace.sourcePaths) || []) {
      const src = await readSource(sourcePath)
      if (src === undefined || !Array.isArray(src.chunks)) continue
      const title = str(src.title) || '剧本'
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
  const foregroundFrameBuilder = createForegroundFrameBuilder()
  const foregroundFrameSessionAdapter = createForegroundFrameSessionAdapter({ id: randomUUID })
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
    frameBuilder: foregroundFrameBuilder,
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
      if (!chat || groupOfMode(chat.mode) !== 'play') return []
      const snapshot = await runtimePresets.fullSnapshot()
      return Array.isArray(snapshot && snapshot.regexScripts) ? snapshot.regexScripts : []
    },
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    store: { chatForSession, readChat },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    cleanupFailedTurn: async function (input) {
      const mode = await turnOrchestrator.modeFor(input.sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      const liveAgent = agentRegistry.get(input.sessionId)
      const liveSession = sessionStore.get(input.sessionId) || (liveAgent && liveAgent.session)
      return clearFailedTurnSurface({ session: liveSession, turn: input.turn })
    },
    logger: console
  })

  let settleRuntimeReadiness
  const runtimeReadiness = new Promise(function (resolve) { settleRuntimeReadiness = resolve })
  async function initializeRuntimeState() {
    await fileResources.migrateLegacy(await readIndex(), readJson, writeIndex, readChat, writeChat)
    await presetLibrary.migrate()
    await resourceGraph.recover()
    return await readIndex()
  }
  async function recoverRuntimeHistory(recoveredIndex) {
    for (const row of recoveredIndex.chats || []) {
      const chat = await readChat(row.id)
      if (chat === undefined) continue
      try { if (await presetLibrary.migrateChat(chat)) await writeChat(chat) } catch (error) { console.warn('dsh-tavern: 旧对话预设条目配置迁移失败', chat.id, error) }
      await syncChatSummary(chat)
    }
    await foregroundHandoff.recover((recoveredIndex.chats || []).map(function (row) { return row.id }))
    await candidateTasks.recover((recoveredIndex.chats || []).map(function (row) { return row.id }))
  }
  // ---------- 重新生成正文（生成即替换，无确认） ----------
  const { regenerate: regenBody, rollback: rollbackTurn } = createRoundHistory({
    chats: { read: readChat, forSession: chatForSession, readCard: readChatCard,
      readRevision: readChatRevision, write: writeChat, update: updateChat },
    sessions: { get: function (sessionId) { return ctx.get('agents')?.get(sessionId) } },
    scripts: { read: readScript, continuity: scriptContinuity,
      dispatchEvent: function (event) { return tavernScriptHostAdapter.dispatchEvent(event) } },
    timeline: storyTimeline,
    queueSettlement,
    present: view
  })

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function dispatch(method, args) {
    switch (method) {
      case 'listCards': return { cards: await listCards() }
      case 'getUpdateStatus': return { status: await applicationUpdater.status() }
      case 'checkUpdate': return { status: await applicationUpdater.check() }
      case 'startUpdate': return { status: await applicationUpdater.start() }
      case 'getCardOpenings': return await getCardOpenings(args && args.path, args && args.userName, args && args.requestMode)
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
        return { task, text: runtimePrompt(promptName) }
      }
      case 'getResourceWorkspace': return { path: dataRoot + '/resources' }
      case 'listResources': return await listTavernResources()
      case 'getResource': {
        const resourcePath = normalizeResourcePath(args && args.path, 'source')
        const text = await fileResources.readText(resourcePath)
        if (text === undefined) throw new Error('剧本不存在: ' + resourcePath)
        return { path: resourcePath, text }
      }
      case 'listWorldBooks': return await worldBooks.catalog()
      case 'getWorldBook': return await worldBooks.get(args && args.source)
      case 'getWorldBookBinding': return { binding: await worldBooks.binding(args && args.cardPath) }
      case 'getWorldBookAssociations': return { associations: await worldBooks.associations(args && args.source) }
      case 'bindWorldBook': return { binding: await worldBooks.bind(args && args.cardPath, args && args.source) }
      case 'unbindWorldBook': return { binding: await worldBooks.unbind(args && args.cardPath) }
      case 'importWorldBook': return { worldBook: await worldBooks.import(args && args.payload) }
      case 'updateWorldBook': return await worldBooks.update(args && args.source, args && args.update)
      case 'exportWorldBook': return { worldBook: await worldBooks.export(args && args.source) }
      case 'deleteWorldBook': return await worldBooks.remove(args && args.path)
      case 'listPresets': return await presetLibrary.catalog()
      case 'selectPreset': return await presetLibrary.select(args && args.path)
      case 'getPreset': return { preset: await presetLibrary.detail(args && args.path) }
      case 'exportPreset': return await presetLibrary.export(args && args.path)
      case 'updatePresetEntry': return { preset: await presetLibrary.updateEntry(args && args.path, args && args.entryKey, args && args.patch) }
      case 'updatePresetRegex': return { preset: await presetLibrary.updateRegex(args && args.path, args && args.regexKey, args && args.patch !== undefined ? args.patch : args && args.enabled) }
      case 'previewPresetConversion': {
        const preview = await previewPreset(args && args.path, args && args.orderGroupIndex)
        if (preview === undefined) throw new Error('预设不存在: ' + (args && args.path))
        return { preview }
      }
      case 'extractBypassPlan': {
        return { plan: await bypassPlans.extract({
          id: args && args.id,
          name: args && args.name,
          sourcePresetPath: args && args.sourcePresetPath,
          entryKeys: args && args.entryKeys,
          regexKeys: args && args.regexKeys,
          compatibleModels: args && args.compatibleModels
        }) }
      }
      case 'activateBypassPlan': {
        await bypassPlans.activate(args && args.id || '')
        return { activePlanId: args && args.id || '' }
      }
      case 'getBypassPlan': return { plan: await bypassPlans.get(args && args.id) }
      case 'importBypassPlan': {
        const payload = args && args.payload && typeof args.payload === 'object' ? args.payload : {}
        const text = str(payload.text)
        if (text.trim() === '') throw new Error('旧版预设条目配置文件为空')
        let document
        try { document = JSON.parse(text) } catch { throw new Error('旧版预设条目配置文件不是有效的 JSON') }
        return { plan: await bypassPlans.importPackage(document) }
      }
      case 'exportBypassPlan': {
        const document = await bypassPlans.exportPlan(args && args.id)
        const safeName = str(document.plan && document.plan.name || '预设条目配置').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '预设条目配置'
        return { name: safeName + '.dsh-bypass-plan.json', text: JSON.stringify(document, null, 2) }
      }
      case 'toggleBypassPlanEntry': {
        await bypassPlans.toggleEntry({ id: args && args.id, entryKey: args && args.entryKey, enabled: args && args.enabled === true })
        return { plan: await bypassPlans.get(args && args.id) }
      }
      case 'toggleBypassPlanRegex': {
        await bypassPlans.toggleRegex({ id: args && args.id, regexKey: args && args.regexKey, enabled: args && args.enabled === true })
        return { plan: await bypassPlans.get(args && args.id) }
      }
      case 'setBypassPlanCompatibleModels': return { plan: await bypassPlans.setCompatibleModels({ id: args && args.id, compatibleModels: args && args.compatibleModels }) }
      case 'renameBypassPlan': return { plan: await bypassPlans.rename(args && args.id, args && args.name) }
      case 'copyBypassPlan': return { plan: await bypassPlans.copy(args && args.id, args && args.name) }
      case 'deleteBypassPlan': {
        await bypassPlans.remove(args && args.id)
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
      case 'getTavernSettings': return { settings: await readTavernSettings() }
      case 'getSceneImageSettings': return { settings: await sceneIllustrations.settings(args?.provider) }
      case 'saveSceneImageSettings': return { settings: await sceneIllustrations.configure(args) }
      case 'sceneImageStatus': return { illustration: await sceneIllustrations.status(args.sessionId, args.turn) }
      case 'generateSceneImage': return { illustration: await sceneIllustrations.start(args.sessionId, args.turn, args.key, args) }
      case 'retrySceneImageSave': return { illustration: await sceneIllustrations.retrySave(args.sessionId, args.turn, args.key, args.requestId) }
      case 'cancelSceneImage': return { illustration: await sceneIllustrations.cancel(args.sessionId, args.turn, args.key, args.requestId) }
      case 'removeSceneImage': return { illustration: await sceneIllustrations.removeImage(args.sessionId, args.turn, args.key, args.versionId) }
      case 'updateTavernSettings': return { settings: await updateTavernSettings(args && args.patch) }
      case 'getSystemPrompts': return { systemPrompts: presentSystemPrompts(await readTavernSettings()) }
      case 'updateSystemPrompt': {
        const name = str(args && args.name)
        if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
        return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompt: { name, text: args && args.text } })) }
      }
      case 'resetSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ resetSystemPrompts: SYSTEM_PROMPT_NAMES })) }
      case 'importSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompts: importSystemPromptDocument(args && args.payload) })) }
      case 'exportSystemPrompts': {
        const current = presentSystemPrompts(await readTavernSettings())
        const document = { spec: current.spec, version: current.version, prompts: Object.fromEntries(current.prompts.map(function (item) { return [item.name, item.text] })) }
        return { name: 'dsh-tavern-system-prompts.json', text: JSON.stringify(document, null, 2) + '\n' }
      }
      case 'listSessions': {
        const settings = await readTavernSettings()
        return { sessions: await listTavernSessions(), capabilities: { compatibilityMode: settings.compatibilityMode, trustedCardMode: settings.trustedCardMode } }
      }
      case 'importCard': return { card: await importCard(args && args.payload) }
      case 'deleteCard': return await deleteCard(args && args.path)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'exportConversation': return await exportConversation(args && args.chatId, args && args.sessionId, args && args.title)
      case 'exportTavernLogs': return await exportTavernLogs(args && args.sessionId)
      case 'recordMvuRuntimeDiagnostic': {
        const chat = await chatForSession(str(args && args.sessionId))
        if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
        const diagnostic = args && args.diagnostic || {}
        await mvuDiagnostics.record(chat.sessionId, { stage: 'script-runtime', diagnostic: { level: diagnostic.level === 'error' ? 'error' : 'warn', scriptId: str(diagnostic.scriptId).slice(0, 200), message: str(diagnostic.message).slice(0, 4000) } })
        return { recorded: true }
      }
      case 'getPlayChatDebugTarget': {
        const sourceChat = await chatForSession(args && args.sessionId)
        if (sourceChat === undefined || ((sourceChat.mode || 'story') !== 'story' && (sourceChat.mode || 'story') !== 'script')) throw new Error('当前对话不是游玩对话')
        const card = await readChatCard(sourceChat)
        return { card: { path: sourceChat.cardPath, name: card.name }, chatId: sourceChat.id }
      }
      case 'attachPlayChatDebug': return { reference: await attachPlayChatDebug(args && args.targetSessionId, args && args.sourceSessionId, args && args.turn) }
      case 'captureDisplayRuntime': return await captureDisplayRuntime(args && args.sessionId, args && args.turn, args && args.partIndex, args && args.runtime)
      case 'updateTavernHelperVariables': return await tavernScriptHostAdapter.updateVariables(args && args.sessionId, args && args.option, args && args.variables, args && args.expectedLifecycleRevision)
      case 'updateTavernHelperMessages': return await tavernScriptHostAdapter.updateMessages(args && args.sessionId, args && args.messages, args && args.expectedLifecycleRevision)
      case 'switchTavernSwipe': return await tavernScriptHostAdapter.switchSwipe(args && args.sessionId, args && args.messageId, args && args.swipeId)
      case 'saveTavernExtensionSettings': return await tavernScriptHostAdapter.saveExtensionSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
      case 'loadTavernWorldInfo': return await tavernScriptHostAdapter.loadWorldInfo(args && args.sessionId, args && args.name)
      case 'saveTavernWorldInfo': return await tavernScriptHostAdapter.saveWorldInfo(args && args.sessionId, args && args.name, args && args.worldInfo, args && args.expectedWorldInfo)
      case 'getTavernHelperWorldbook': return await tavernScriptHostAdapter.getWorldbook(args && args.sessionId, args && args.name)
      case 'replaceTavernHelperWorldbook': return await tavernScriptHostAdapter.replaceWorldbook(args && args.sessionId, args && args.name, args && args.entries, args && args.expectedEntries)
	  case 'pollTavernHelperEvent': return tavernScriptHostAdapter.pollEvent(args && args.sessionId, args && args.runtimeId, args && args.ready)
	  case 'completeTavernHelperEvent': return { completed: tavernScriptHostAdapter.completeEvent(args && args.sessionId, args && args.eventId, args && args.args, args && args.runtimeId, args && args.error, sanitizeRuntimeDiagnostics(args && args.diagnostics)) }
	  case 'releaseTavernHelperRuntime': return { released: tavernScriptHostAdapter.releaseRuntime(args && args.sessionId, args && args.runtimeId) }
      case 'startChat': {
        try {
          return { view: await startChat(args && args.path, args && args.sessionId, args && args.mode, args && args.openingId, args && args.userName, args && args.requestMode) }
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
      case 'prepareCompaction': return { plan: await tavernCompaction.prepare(args && args.sessionId) }
      case 'compactBackground': return { result: await compactBackground(args && args.sessionId, args && args.operationId) }
      case 'completeCompaction': return { result: await tavernCompaction.complete(args && args.sessionId, args) }
      case 'syncSession': return { sync: await candidateTasks.sync(args && args.sessionId, { requestId: args && args.requestId, kind: args && args.kind }) }
      case 'submitTask': {
        if (str(args && args.kind) !== 'candidate') throw new Error('暂不支持的持久任务类型: ' + str(args && args.kind))
        return { sync: await candidateTasks.submit(args) }
      }
      case 'getSessionActivity': {
        const agent = agentRegistry.get(str(args && args.sessionId))
        return { activity: await sessionActivity(args && args.sessionId), runtimeGeneration, liveSession: Boolean(agent && agent.session) }
      }
      case 'getBackgroundOperation': return { operation: await sessionOperation(args && args.sessionId, args && args.operationId) }
      case 'setPlayerName': return { playerName: await setPlayerName(args && args.sessionId, args && args.userName) }
      case 'setRequestMode': return { requestMode: await setRequestMode(args && args.sessionId, args && args.requestMode) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'getChoices': return { candidates: await candidateGenerator.find({ sessionId: args && args.sessionId, messageId: args && args.messageId }) }
      case 'startChoices': return await candidateTasks.startLegacy(args)
      case 'exportCard': {
        const cardPath = args && args.path
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + (args && args.path))
        const characterBook = await worldBooks.characterBookForCard(cardPath)
        return { document: cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook }) }
      }
      case 'addGuide': return { guides: await addGuide(args && args.sessionId, args && args.text) }
      case 'deleteGuide': return { guides: await deleteGuide(args && args.sessionId, args && args.index) }
      case 'regenBody': return { view: await regenBody(args && args.chatId, args && args.guidance, args && args.sessionId) }
      case 'rollbackTurn': return { view: await rollbackTurn(args && args.sessionId, args && args.chatId) }
      case 'retryMvuSettlement': return { view: await retryMvuSettlement(args && args.sessionId, args && args.turn) }
      default: throw new Error('未知方法: ' + method)
    }
  }

  async function coordinationVersion(sessionId) {
    const normalizedSessionId = str(sessionId)
    const links = await readSessionMap()
    const chatId = str(links && links[normalizedSessionId])
    const chatVersion = chatId === '' ? '' : await chatPersistence.version(chatId)
    const projectionVersion = await profileData.version('card-projection-revisions.json')
    return [runtimeGeneration, chatId, chatVersion, projectionVersion].join(':')
  }

  coordinationEvents = createCoordinationEventPublisher({
    readVersion: async function (sessionId) { return await coordinationVersion(sessionId) },
    load: async function (sessionId) { return await candidateTasks.sync(sessionId, { kind: 'candidate' }) },
    fallbackIntervalMs: 5000,
    onError(error) { console.warn('dsh-tavern: 协调文件读取失败，将继续重试:', str(error && error.message || error)) }
  })

  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern',
      handler: async (req, res) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const origin = req.headers.origin
        const sceneImageRoute = /^\/api\/dsh-tavern\/(?:scene-image|getSceneImageSettings|saveSceneImageSettings|sceneImageStatus|generateSceneImage|retrySceneImageSave|cancelSceneImage|removeSceneImage)$/.test(pathname)
        const sceneSameOrigin = sceneImageRoute && (origin === 'http://' + req.headers.host || origin === 'https://' + req.headers.host)
        if (sceneImageRoute && origin && !sceneSameOrigin) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        const readsCachedAsset = req.method === 'GET' && cachedAssetMatch
        const localOrOpaqueOrigin = origin === undefined || origin === '' || origin === 'null' || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
        if (readsStaticAsset && !localOrOpaqueOrigin) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (!readsCachedAsset && !readsStaticAsset && !readsOfficialMvu && !sceneSameOrigin && typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (req.method === 'GET' && pathname === '/api/dsh-tavern/runtime-generation') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0'
          })
          res.end(JSON.stringify({ ok: true, runtimeGeneration }))
          return
        }
        try {
          const readiness = await runtimeReadiness
          if (!readiness.ok) throw readiness.error
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readImage(query.get('sessionId'), Number(query.get('turn')), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (readsOfficialMvu) {
            const asset = await readOfficialMvuBundle()
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': asset.etag,
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-MVU-Commit': asset.commit
            })
            res.end(asset.body)
            return
          }
          if (readsCachedAsset) {
            const asset = await tavernRemoteAssets.readCached(cachedAssetMatch[1])
            if (!asset) {
              res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            const body = projectCachedResourceBody({ url: asset.url, mediaType: asset.mediaType, body: Buffer.from(asset.content, 'utf8') })
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType) + '; charset=utf-8',
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(body)
            return
          }
          if (readsStaticAsset) {
            const target = new URL(req.url ?? '/', 'http://x')
            const asset = await tavernStaticResources.get(target.searchParams.get('url'))
            const body = projectCachedResourceBody(asset)
            res.writeHead(200, {
              'Content-Type': str(asset.mediaType),
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-Cache': asset.cache
            })
            res.end(body)
            return
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/events') {
            const target = new URL(req.url ?? '/', 'http://x')
            const sessionId = str(target.searchParams.get('sessionId'))
            if (sessionId === '') {
              res.writeHead(400)
              res.end('missing sessionId')
              return
            }
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no'
            })
            res.write('retry: 1000\n\n')
            let closed = false
            const stop = coordinationEvents.subscribe(sessionId, function (snapshot, eventId) {
              if (closed) return
              try {
                res.write('id: ' + str(eventId).replace(/[\r\n]/g, '') + '\n')
                res.write('data: ' + JSON.stringify(snapshot) + '\n\n')
              } catch (_error) { close() }
            })
            const heartbeat = setInterval(function () {
              if (!closed) res.write(': heartbeat\n\n')
            }, 10000)
            if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref()
            function close() {
              if (closed) return
              closed = true
              clearInterval(heartbeat)
              stop()
              if (!res.writableEnded) res.end()
            }
            req.once('close', close)
            res.once('close', close)
            return
          }
          const method = pathname.slice('/api/dsh-tavern'.length + 1)
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          let body = ''
          for await (const chunk of req) {
            body += chunk
            if (sceneImageRoute && Buffer.byteLength(body) > 16384) throw new Error('生图请求过大')
          }
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
          res.end(JSON.stringify(Object.assign({ ok: true }, result, { runtimeGeneration })))
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

  function requestIdOf(message) {
    const source = message && message.source
    return source && source.kind === 'user' ? str(source.rpcId).trim() : ''
  }

  function requestIdForTurn(session, turn) {
    const events = Array.isArray(session && session.events) ? session.events : []
    const start = turnStartIndex(session, turn)
    if (start < 0) return ''
    for (let index = Math.max(0, start + 1); index < events.length; index++) {
      const event = events[index]
      if (!event || event.type !== 'user/message' || !isTurnInput(event.data)) continue
      return requestIdOf(event.data)
    }
    return ''
  }

  function requestIdForMessages(messages) {
    const list = Array.isArray(messages) ? messages : []
    for (let index = list.length - 1; index >= 0; index--) {
      if (isTurnInput(list[index])) return requestIdOf(list[index])
    }
    return ''
  }

  function replaceAssistantReply(session, result, bodyText) {
    if (result === null || result.text === bodyText) return
    const previous = result.event && result.event.data && result.event.data.message
    if (previous === null || typeof previous !== 'object') return
    session.append('assistant/message', {
      turn: Number(result.event.data && result.event.data.turn) || 0,
      step: Number(result.event.data && result.event.data.step) || 1,
      message: Object.assign({}, previous, {
        id: randomUUID(),
        content: [{ type: 'text', text: bodyText }]
      })
    }, {
      surfaceOp: { op: 'replace', start: result.index, end: result.index },
      sourceEventSeqs: [result.index]
    })
  }

  async function resolveChatRuntimePreset(chat) {
    if (!chat) return null
    const raw = groupOfMode(chat.mode) === 'play' ? await runtimePresets.fullSnapshot() : null
    const presetPath = str(raw && raw.presetPath)
    if (presetPath === '') {
      const needsClearing = chat.runtimePresetSnapshot !== null || str(chat.bypassPlanId) !== '' || str(chat.runtimePresetPath) !== ''
      chat.runtimePresetSnapshot = null
      chat.bypassPlanId = ''
      chat.runtimePresetPath = ''
      if (needsClearing) {
        await updateChat(chat.id, function (current) {
          if (!current || typeof current !== 'object') return current
          return Object.assign({}, current, {
            runtimePresetSnapshot: null,
            bypassPlanId: '',
            runtimePresetPath: '',
            updatedAt: Date.now()
          })
        }, { source: 'runtime-preset.clear' })
      }
      return null
    }
    chat.runtimePresetSnapshot = raw
    chat.bypassPlanId = ''
    chat.runtimePresetPath = presetPath
    await updateChat(chat.id, function (current) {
      if (!current || typeof current !== 'object') return current
      return Object.assign({}, current, {
        runtimePresetSnapshot: raw,
        bypassPlanId: '',
        runtimePresetPath: presetPath,
        updatedAt: Date.now()
      })
    }, { source: 'runtime-preset.resolve' })
    return raw
  }

  function compatibilityWorldBookMatch(entry, source) {
    if (entry.constant === true) return true
    const text = entry.caseSensitive === true ? source : source.toLocaleLowerCase()
    const keys = Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []
    return keys.some(function (value) {
      const key = str(value).trim()
      if (key === '') return false
      const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(key)
      if (match) {
        try { return new RegExp(match[1], match[2].replace(/[gy]/g, '')).test(source) } catch { return false }
      }
      return text.includes(entry.caseSensitive === true ? key : key.toLocaleLowerCase())
    })
  }

  async function compatibilityWorldInfo(chat, card, input) {
    let worldBook = null
    try { worldBook = await worldBooks.bound(chat.cardPath, card) } catch {}
    const entries = Array.isArray(worldBook && worldBook.view && worldBook.view.entries) ? worldBook.view.entries : []
    const scan = (chat.messages || []).map(function (item) { return str(item.sourceText || item.text) }).concat([str(input)]).join('\n')
    function promptTemplateSpecial(entry) {
      const comment = str(entry && entry.comment)
      const content = str(entry && entry.content)
      return comment.startsWith('[InitialVariables]') || /^(?:@@[^\r\n]*\r?\n)*@@initial_variables(?:\s|$)/m.test(content)
    }
    const enabled = entries.filter(function (entry) { return entry && entry.enabled !== false && str(entry.content).trim() !== '' })
    const active = enabled.filter(function (entry) {
      return !promptTemplateSpecial(entry) && compatibilityWorldBookMatch(entry, scan)
    }).sort(function (left, right) {
      return (Number(right.order) || 0) - (Number(left.order) || 0) || (Number(left.displayIndex) || 0) - (Number(right.displayIndex) || 0)
    })
    const before = []
    const after = []
    for (const entry of active) {
      const position = entry.position
      const target = position === 0 || position === 'before_char' || position === 'before' ? before : after
      target.push(str(entry.content).trim())
    }
    return {
      before: before.join('\n\n'),
      after: after.join('\n\n'),
      refs: active.map(function (entry) { return entry.ref }),
      entries: enabled.map(function (entry) {
        return {
          id: str(entry.sourceUid || entry.ref),
          name: str(entry.title),
          comment: str(entry.comment),
          content: str(entry.content),
          enabled: entry.enabled !== false,
          book: str(worldBook && worldBook.view && worldBook.view.displayName)
        }
      })
    }
  }

  async function compileCompatibilityTurn(chat, userText) {
    const snapshot = await resolveChatRuntimePreset(chat)
    const presetPath = str(snapshot && snapshot.presetPath)
    if (presetPath === '') throw new Error('请先在预设库中选择一份外部预设')
    const preset = await readPreset(presetPath)
    const presetDocument = await readPresetDocument(presetPath)
    if (!preset || preset.valid !== true || preset.recognized !== true || !presetDocument) throw new Error('当前预设不存在或无法读取：' + presetPath)
    const card = await readChatCard(chat)
    const extensions = await readCardExtensions(chat.cardPath)
    const regexScripts = (Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : []).concat(
      Array.isArray(snapshot.regexScripts) ? snapshot.regexScripts : []
    )
    const worldInfo = await compatibilityWorldInfo(chat, card, userText)
    const compiled = compileSillyTavernRequest({
      card,
      preset,
      presetPath,
      presetDocument,
      history: (chat.messages || []).map(function (item) { return { role: item.role, text: str(item.text), sourceText: str(item.sourceText) } }),
      input: userText,
      userName: str(chat.macroState && chat.macroState.userName),
      macroState: chat.macroState,
      worldInfoBefore: worldInfo.before,
      worldInfoAfter: worldInfo.after,
      resolveMacros: resolveRuntimeMacroText,
      projectPromptText: function (text, context) {
        return applyTavernRegexText(text, regexScripts, {
          placement: context.placement,
          isMarkdown: false,
          isEdit: false,
          depth: context.depth
        })
      }
    })
    compiled.trace.worldBookRefs = worldInfo.refs
    compiled.trace.presetPath = presetPath
    compiled.trace.presetTitle = preset.title
    compiled.trace.regexCount = regexScripts.length
    const helperMacros = applyTavernHelperVariableMacros(compiled.messages, {
      message: lastTavernHelperVariables(chat.messages),
      chat: chat.variables,
      character: extensions && extensions.variables,
      preset: snapshot && snapshot.variables,
      global: chat.macroState && chat.macroState.global
    })
    compiled.messages = helperMacros.messages
    compiled.trace.tavernHelperVariableMacroCount = helperMacros.replacements
    const promptTemplates = await promptTemplateRuntime()
    const transcript = (chat.messages || []).map(function (item) {
      return { role: item.role === 'user' ? 'user' : 'assistant', content: str(item.sourceText || item.text) }
    })
    const templateContext = {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName) || '你',
      runType: 'generate',
      transcript,
      worldBookEntries: worldInfo.entries,
      scopes: {
        global: await readPromptTemplateGlobalVariables(),
        initial: chat.promptTemplateInitialVariables,
        local: chat.variables,
        message: lastTavernHelperVariables(chat.messages)
      }
    }
    const initialized = promptTemplates.initializeVariables(worldInfo.entries, templateContext)
    const templated = promptTemplates.renderMessages(compiled.messages, Object.assign({}, templateContext, { scopes: initialized.scopes }))
    compiled.messages = templated.messages
    compiled.promptTemplateState = {
      scopes: templated.scopes,
      persist: initialized.evaluated + templated.evaluated > 0
    }
    compiled.diagnostics.push(...initialized.diagnostics, ...templated.diagnostics)
    compiled.trace.promptTemplateEvaluations = initialized.evaluated + templated.evaluated
    compiled.trace.promptTemplateDiagnostics = initialized.diagnostics.length + templated.diagnostics.length
    const sourceMessageCount = compiled.messages.length
    compiled.messages = applySillyTavernStrictTools(compiled.messages, {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName)
    })
    compiled.trace.postProcessing = 'strict_tools'
    compiled.trace.sourceMessageCount = sourceMessageCount
    compiled.trace.finalMessageCount = compiled.messages.length
    return compiled
  }

  // ---------- DSH 回合生命周期 ----------
  const requestCoordinates = new Map()
  const storyCompactionRequests = new WeakSet()
  const tavernRetryLimiter = createTavernRetryLimiter({
    owns: async function (agent) {
      const sessionId = agent && agent.session ? agent.session.id : ''
      if (sessionId === '') return false
      return backgroundAgentRunner.owns(sessionId) || await chatForSession(sessionId) !== undefined
    }
  })

  function clearRuntimePresetRequestState(agent) {
    const session = agent && agent.session
    if (session === undefined) return 0
    const sessionId = session.id
    requestCoordinates.delete(sessionId)
    foregroundStrategies.clearRequestState(sessionId)
  }

  function compatibilityMessages(compiled) {
    return compiled.messages.map(function (item, index) {
      const label = str(item.source && (item.source.identifier || item.source.kind)) || 'message-' + (index + 1)
      return {
        id: randomUUID(),
        role: item.role,
        content: [{ type: 'text', text: item.content }],
        source: {
          kind: 'plugin', plugin: 'dsh-tavern', form: 'sillytavern-compatibility',
          sections: [{ name: 'tavern:sillytavern:' + label, text: item.content }],
          trace: item.source
        }
      }
    })
  }

  const controlledToolNames = new Set(['bash', 'pwsh', 'str_replace_editor', 'skill', 'tavern_save_skill', ...cordisToolNames, 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_play_chat', 'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_update_card', 'tavern_restore_card'])
  const foregroundStrategies = createForegroundOrchestrationStrategies({
    compatibility: {
      beforeTurn: async function (input) {
        if (!hasTavernScriptRuntime(input.chat, (await readCardExtensions(input.chat.cardPath))?.helperScripts)) return
        const context = await tavernScriptHostAdapter.context(input.sessionId, input.chat, input.userText)
        const messageId = Math.max(0, context.messages.length - 1)
        await tavernScriptHostAdapter.dispatchEvent({ sessionId: input.sessionId, context, name: 'MESSAGE_SENT', args: [messageId] })
      },
      beginTurn: async function (input) { await turnOrchestrator.beginCompatibility(input) },
      chatForSession,
      compileTurn: compileCompatibilityTurn,
      persistCompiled: async function (input) {
        const compiled = input.compiled
        await updateChat(input.chat.id, function (current) {
          if (!current || typeof current !== 'object') return current
          current.macroState = compiled.macroState
          if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
            const scopes = compiled.promptTemplateState.scopes || {}
            current.promptTemplateInitialVariables = scopes.initial && typeof scopes.initial === 'object' ? scopes.initial : {}
            current.variables = scopes.local && typeof scopes.local === 'object' ? scopes.local : {}
            if (Array.isArray(current.messages) && current.messages.length > 0) {
              replaceTavernHelperVariables(current, {
                option: { type: 'message', message_id: 'latest' },
                variables: scopes.message
              })
            }
          }
          if (!current.compatibilityTraces || typeof current.compatibilityTraces !== 'object') current.compatibilityTraces = {}
          current.compatibilityTraces[String(input.turn)] = Object.assign({ createdAt: Date.now() }, compiled.trace, { diagnostics: compiled.diagnostics })
          return current
        }, { source: 'compatibility.compile' })
        if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
          await writePromptTemplateGlobalVariables(compiled.promptTemplateState.scopes.global)
        }
      },
      projectMessages: compatibilityMessages
    },
    nativePlay: {
      stagedRequests: runtimePresetSnapshots,
      modeFor: async function (sessionId) { return await turnOrchestrator.modeFor(sessionId) },
      filterMessages: filterSkillMessages,
      resolvePreset: resolveChatRuntimePreset,
      prepareTurn: async function (input) { return await foregroundHandoff.prepare(input) },
      appendFrame: function (input) { return foregroundFrameSessionAdapter.append(input) },
      recordFrame: function (sessionId, frame, receipt) {
        requestCoordinates.set(sessionId, Object.assign({}, requestCoordinates.get(sessionId), {
          frame: {
            frameId: frame.frameId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            source: frame.source,
            append: receipt
          }
        }))
      },
      visibleTools: async function (sessionId) { return await turnOrchestrator.visibleTools(sessionId) },
      modePrompt: function () { return runtimePrompt('card-mode') },
      workspaceContext: resourceWorkspaceContext,
      ensureSessionPrefix: async function (input) {
        const session = input.payload.agent.session
        if (readSessionStablePrefix(session)) return
        await ensureSessionStablePrefix(session, await ensurePlayCardSnapshot(input.chat), stablePrefixStorage)
        await sessionStore.flush(session)
      },
      sessionPrefix: function (sessionId) {
        const session = backgroundAgentRunner.requestSession(sessionId) || agentRegistry.get(sessionId)?.session || sessionStore.get(sessionId)
        return readSessionStablePrefix(session)
      },
      controlledToolNames
    }
  })

  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') requestCoordinates.set(sessionId, { turn: payload.turn, step: payload.step })
    return await next()
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })

  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (backgroundAgentRunner.owns(sessionId)) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    return await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
  })

  ctx.on('llm/stream', function (options, next) {
    const sessionId = str(options && options.sessionId)
    const coordinates = requestCoordinates.get(sessionId)
    if (coordinates !== undefined) {
      requestCoordinates.set(sessionId, Object.assign({}, coordinates, {
        source: { kind: 'model', provider: str(options.provider), model: str(options.model) }
      }))
    }
    if (options !== null && typeof options === 'object' && options.purpose === 'compaction' && !storyCompactionRequests.has(options)) {
      const fallback = next()
      return (async function * () {
        const chat = await chatForSession(sessionId)
        if (!usesStoryCompaction(chat)) {
          yield * fallback
          return
        }
        const request = createStoryCompactionRequest(options, runtimePrompt('story-compaction'))
        if (request === options) {
          yield * fallback
          return
        }
        storyCompactionRequests.add(request)
        yield * ctx.llm.stream(request)
      })()
    }
    const projectedRequest = foregroundStrategies.projectRequest(options, coordinates)
    if (projectedRequest !== null) return ctx.llm.stream(projectedRequest)
    const stream = next()
    const backgroundContext = backgroundAgentRunner.requestContext(sessionId)
    const ownerSessionId = backgroundContext ? backgroundContext.parentSessionId : sessionId
    return (async function * () {
      const chat = ownerSessionId === '' ? undefined : await chatForSession(ownerSessionId)
      let requestRecord = null
      if (options.purpose === undefined && chat !== undefined && (chat.mode === 'story' || chat.mode === 'script')) {
        const coordinates = requestCoordinates.get(sessionId) || {}
        requestRecord = await modelRequestLog.record({ chat, context: backgroundContext, coordinates, options })
      }
      let responseText = ''
      let finish = null
      let failure = null
      try {
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'text-delta') responseText += str(chunk.text)
          if (chunk && chunk.type === 'finish') finish = chunk.reason === undefined ? chunk : chunk.reason
          yield chunk
        }
      } catch (error) {
        failure = str(error && error.message || error)
        throw error
      } finally {
        const completed = finish && finish.kind !== 'error' && finish.kind !== 'aborted'
        foregroundStrategies.completeRequest(options, completed)
        if (chat && requestRecord) {
          try { await modelRequestLog.complete({ chatId: chat.id, id: requestRecord.id, text: responseText, finish, error: failure }) }
          catch (error) { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) }
        }
      }
    })()
  }, { global: true })

  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    clearRuntimePresetRequestState(payload.agent)
    if (backgroundAgentRunner.owns(sessionId)) return
    const userText = userTextForTurn(session, payload.turn)
    if (userText === '') return
    const requestId = requestIdForTurn(session, payload.turn)
    const assistant = assistantResultForTurn(session, payload.turn)
    if (assistant === null || assistant.text === '') {
      const reasoningOnly = assistant !== null && assistant.reasoningOnly === true
      const message = reasoningOnly
        ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
        : '模型本轮没有返回正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: reasoningOnly ? 'reasoning-only' : 'empty-response',
        message
      })
      throw new Error(message)
    }
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      assistantText: assistant === null ? '' : assistant.text
    })
    if (saved.reply) replaceAssistantReply(session, assistant, saved.reply.sessionText)
  })

  ctx.on('agent/error', function (payload) {
    clearRuntimePresetRequestState(payload.agent)
  })

  ctx.on('session/event', function (session, event) {
    if (!event || event.type !== 'turn/end') return
    foregroundStrategies.endTurn(session.id)
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason })
  })

  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const chat = await chatForSession(agent.session.id)
    return await foregroundStrategies.assembleSystemPrompt(assembly, {
      sessionId: agent.session.id,
      chat,
      cwd: agent.session.header && agent.session.header.cwd
    })
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
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
        path: { type: 'string', description: '可选的人物卡相对路径；省略时读取当前人物卡或尚未创建的新卡设定' },
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
        path: { type: 'string', description: '可选的人物卡相对路径；省略时读取当前人物卡' },
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
        const workspace = await readCardWorkspace(resourcePath)
        if (workspace === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
        return cardPreparation.present({ card: workspace, as: 'raw-section', pointer: args.pointer, offset: args.offset, limit: args.limit })
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_play_chat',
      description: '在卡片工作台中渐进读取已挂载的游玩诊断。默认从最新一轮的小型 overview 开始；需要时可列出轮次、读取任意轮次或整场对话，并按层、分页获取文本、状态、日志、真实模型请求、正则诊断和 iframe 证据。',
      parameters: {
        ref: { type: 'string', description: '已挂载游玩记录引用，例如 play-chat:chat-xxx；只有一个引用时可省略' },
        turn: { type: 'integer', description: '要读取的游玩轮次；省略时使用最新一轮' },
        layer: { type: 'string', enum: ['overview', 'turns', 'conversation', 'input', 'source', 'session', 'display', 'saved-display', 'diagnostics', 'tavern', 'foreground', 'background', 'request', 'iframe'], description: '读取层：小型概览、轮次目录、整场对话、本轮玩家输入、模型原文、Session 文本、当前实时展示、保存时展示快照、当前正则诊断、Tavern 状态、前台 Agent、后台 Agent、真实模型请求或 iframe 运行证据；默认 overview' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ref: { type: 'string', required: true },
            chatId: { type: 'string', required: true },
            turn: { type: 'integer', required: true },
            layer: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true },
            cardSnapshotVersion: { type: 'integer', required: true },
            cardSnapshotDigest: { type: 'string', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '游玩记录第 ' + value.turn + ' 轮 · ' + value.layer + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字 · 人物卡快照 v' + value.cardSnapshotVersion + ' (' + (value.cardSnapshotDigest || '无摘要') + ')\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const editorChat = await chatForSession(sessionId)
        if (editorChat === undefined || (editorChat.mode || 'story') !== 'card') throw new Error('游玩记录只能在卡片工作台中读取')
        const references = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources)
          ? editorChat.workspace.mountedResources.filter(function (item) { return item && item.kind === 'play-chat' })
          : []
        const requestedRef = str(args.ref).trim()
        const reference = requestedRef === ''
          ? (references.length === 1 ? references[0] : null)
          : references.find(function (item) { return item.path === requestedRef })
        if (reference === null || reference === undefined) throw new Error(references.length > 1 ? '请指定要读取的游玩记录 ref' : '当前卡片工作台没有挂载游玩记录')
        const sourceChat = await readChat(reference.chatId)
        if (sourceChat === undefined) throw new Error('游玩记录已不存在')
        let projector = null
        if (str(args.layer) === 'diagnostics' || str(args.layer) === 'display') {
          const extensions = await readCardExtensions(editorChat.cardPath)
          projector = function (message) {
            return projectRuntimeReply(str(message.sourceText) || str(message.text), {
              projectionText: Object.prototype.hasOwnProperty.call(message, 'projectionText') ? str(message.projectionText) : (str(message.sourceText) || str(message.text)),
              regexScripts: Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : [],
              placement: 2,
              isEdit: false,
              depth: 0
            })
          }
        }
        const foregroundId = str(sourceChat.sessionId)
        const backgroundId = str(sourceChat.timeline && sourceChat.timeline.participants && sourceChat.timeline.participants.background && sourceChat.timeline.participants.background.sessionId) || str(sourceChat.candidateAgent && sourceChat.candidateAgent.sessionId)
        return readPlayChatDebugTurn(editorChat, sourceChat, reference, args, projector, {
          foreground: sessionDebugEvidence(foregroundId),
          background: sessionDebugEvidence(backgroundId),
          requests: await modelRequestLog.evidence(sourceChat.id, args.turn || reference.turn)
        })
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
        path: { type: 'string', description: '卡片工作台中可指定剧本相对路径；游玩模式省略并读取当前人物卡绑定剧本' },
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
        if (resourcePath === '') return { found: false, message: '当前工作台尚未指定人物卡或剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
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
      description: '在卡片设定对话中按编号、关键词或分页读取世界书正文。省略 path 时读取当前人物卡绑定的世界书。',
      parameters: {
        path: { type: 'string', description: '世界书相对路径；独立世界书为 worldbooks/...，人物卡内置世界书为 cards/...' },
        ref: { type: 'string', description: '目录中的条目编号，例如 entry:0' },
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
        const requestedPath = str(args.path).trim()
        let record
        if (requestedPath !== '') {
          const normalized = normalizeResourcePath(requestedPath)
          const kind = resourceKind(normalized)
          if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
          record = await worldBooks.get(kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized })
        } else {
          if (str(chat.cardPath) === '') return { found: false, message: '当前工作台尚未引用世界书。', name: '', total: 0, entries: [] }
          record = await worldBooks.bound(chat.cardPath, await readChatCard(chat))
          if (record === null) return { found: false, message: '当前人物卡没有世界书。', name: '', total: 0, entries: [] }
        }
        const allEntries = Array.isArray(record.view.entries) ? record.view.entries : []
        const query = str(args.query).trim().toLowerCase()
        const ref = str(args.ref).trim()
        const filtered = allEntries.filter(function (entry) {
          if (ref !== '') return str(entry.ref) === ref
          if (query === '') return true
          return JSON.stringify(entry).toLowerCase().includes(query)
        })
        const offset = Math.max(1, Number(args.offset) || 1)
        const limit = Math.min(10, Math.max(1, Number(args.limit) || 3))
        const entries = filtered.slice(offset - 1, offset - 1 + limit).map(function (entry) { return { ref: str(entry.ref), entry } })
        if (entries.length === 0) return { found: false, message: '没有找到符合条件的世界书条目。', name: str(record.view.displayName), total: allEntries.length, entries: [] }
        return { found: true, message: '', name: str(record.view.displayName), total: allEntries.length, entries }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_worldbook',
      description: '仅在用户明确确认后，对世界书提交条目级最小修改。支持独立世界书和人物卡内置世界书；省略 path 时修改当前人物卡绑定的世界书。不要重写整本世界书。',
      parameters: {
        path: { type: 'string', description: '可选的世界书路径；省略时使用当前人物卡，或填写 worldbooks/...、cards/...' },
        name: { type: 'string', description: '可选的新世界书名称' },
        description: { type: 'string', description: '可选的新世界书说明' },
        operations: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['update', 'add', 'delete'] },
              ref: { type: 'string' },
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
            path: { type: 'string', required: true },
            name: { type: 'string', required: true },
            entryCount: { type: 'integer', required: true },
            saved: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '世界书《' + value.name + '》已修改并生效 · ' + value.entryCount + ' 条' }] }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中修改')
        const requestedPath = str(args.path).trim()
        if (requestedPath === '' && str(chat.cardPath) === '') throw new Error('当前工作台尚未绑定人物卡，无法修改世界书')
        const normalized = requestedPath === '' ? normalizeResourcePath(chat.cardPath, 'card') : normalizeResourcePath(requestedPath)
        const kind = resourceKind(normalized)
        if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
        const source = kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized }
        const request = { operations: args.operations }
        if (Object.prototype.hasOwnProperty.call(args, 'name')) request.name = args.name
        if (Object.prototype.hasOwnProperty.call(args, 'description')) request.description = args.description
        const result = await worldBooks.update(source, request)
        return { path: normalized, name: str(result.view.displayName), entryCount: Number(result.view.entryCount) || 0, saved: true }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_preset',
      description: '按 JSON Pointer 分段读取预设的原始工作 JSON。目标预设只用于编辑，不会应用到当前 Agent。',
      parameters: {
        path: { type: 'string', required: true, description: 'presets/... 相对路径' },
        pointer: { type: 'string', description: 'JSON Pointer，例如 /prompts/0；省略时读取根节点' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true }, pointer: { type: 'string', required: true }, text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true }, from: { type: 'integer', required: true }, to: { type: 'integer', required: true }, done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '预设 ' + value.path + ' · ' + (value.pointer || '/') + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }] }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中读取')
        const normalized = normalizeResourcePath(args.path, 'preset')
        return await presetEditor.read(normalized, args)
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_preset',
      description: '仅在用户明确确认后，按 JSON Pointer 修改预设的最小路径并重新校验。不会应用或运行目标预设。',
      parameters: {
        path: { type: 'string', required: true, description: 'presets/... 相对路径' },
        operations: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['set', 'delete'] },
              path: { type: 'string', required: true, description: 'JSON Pointer，例如 /prompts/0/content' },
              value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true }, changed: { type: 'array', required: true, items: { type: 'string' } },
            valid: { type: 'boolean', required: true }, recognized: { type: 'boolean', required: true }, promptCount: { type: 'integer', required: true },
            regexCount: { type: 'integer', required: true }, warning: { type: 'string', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '预设已修改并通过 JSON 校验；变更 ' + value.changed.length + ' 个路径。目标预设仍未应用。' + (value.warning ? '\n诊断：' + value.warning : '') }] }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中修改')
        const normalized = normalizeResourcePath(args.path, 'preset')
        return await presetEditor.update(normalized, args.operations)
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
        rawOperations: {
          type: 'array',
          description: '仅用于标准字段和专用资源工具无法覆盖的扩展字段；不能修改世界书。按 JSON Pointer 对完整工作 raw 做最小 set/delete 修改',
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

  try {
    const recoveredIndex = await initializeRuntimeState()
    settleRuntimeReadiness({ ok: true })
    setImmediate(function () {
      recoverRuntimeHistory(recoveredIndex).catch(function (error) {
        console.error('dsh-tavern: 后台恢复历史对话失败', error && error.message || error)
      })
    })
  } catch (error) {
    settleRuntimeReadiness({ ok: false, error })
    throw error
  }
}
