#!/usr/bin/env node
// 离线救援导出：不启动 DSH / cordis，直接按 dataRoot 读取酒馆数据并打成标准 .dshtransfer 包。
// 生成的包与酒馆内「导出」格式完全一致（不含 API Key 与账号），可直接用酒馆的「导入」恢复。
//
// 用法：
//   node tavern-plugin/lib/rescue-export.mjs --list [--dsh-home <dir>] [--data-root <dir>]
//   node tavern-plugin/lib/rescue-export.mjs --out <文件.dshtransfer> [--dsh-home <dir>] [--data-root <dir>] [--selection-file <json>] [--selection <json>] [--no-images]
// 输出协议（供 Android TavernService 解析，与 source-update.mjs 一致）：
//   DSH_STATUS <中文进度描述>
//   DSH_PROGRESS <0..100>
//   RESULT {"kind":"ok"|"list"|"error",...}
import { realpathSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCardPreparation } from './domain/card-preparation.js'
import { createChatJournalStore } from './domain/chat-journal-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import { createFileResourceStore, normalizeResourcePath } from './domain/file-resources.js'
import { createGameFootprint } from './domain/game-footprint.js'
import { createGameSaveExporter } from './domain/game-save-export.js'
import { assertGameSaveExportable, createGameSaveSnapshot } from './domain/game-save-snapshot.js'
import { createPluginDataStore } from './domain/plugin-data-store.js'
import { createPluginMedia } from './domain/plugin-media.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { createRegexLibrary } from './domain/regex-library.js'
import { createRegexManager } from './domain/regex-manager.js'
import { createTavernRegexSettings } from './domain/regex-settings.js'
import { createSceneWorldbooks } from './domain/scene-worldbook.js'
import { parseSessionLog } from './domain/session-log-codec.js'
import { findSessionDirectory } from './domain/session-log-repair.js'
import { createSystemPromptDocuments } from './domain/system-prompt-documents.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { createTavernExtensionSettings } from './domain/tavern-extension-settings.js'
import { presentTavernSettings } from './domain/tavern-settings.js'
import { createTavernSkillModule } from './domain/tavern-skills.js'
import { createTransferAssets } from './domain/transfer-assets.js'
import { buildTransferManifest, createTransferBundleWriter, packTransferBundle, safeTransferFileName, TRANSFER_EXTENSION } from './domain/transfer-bundle.js'
import { createTransferCatalog } from './domain/transfer-catalog.js'
import { createTransferChats } from './domain/transfer-chats.js'
import { createTransferFonts } from './domain/transfer-fonts.js'
import { createTransferMaterials } from './domain/transfer-materials.js'
import { createTransferMemory } from './domain/transfer-memory.js'
import { createTransferPluginData } from './domain/transfer-plugin-data.js'
import { createTransferPlugins } from './domain/transfer-plugins.js'
import { createTransferSkills } from './domain/transfer-skills.js'
import { createUserPluginInstaller } from './domain/user-plugin-install.js'
import { createUserPreferenceProfile } from './domain/user-preference-profile.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import { createProfileDataStore, TAVERN_SETTINGS_PATH } from './profile-data-store.js'
import { prompt as promptFile, SYSTEM_PROMPT_NAMES } from './prompt-catalog.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SOURCE_ROOT = path.resolve(HERE, '../..')

const SHA256_REF = /^sha256:([a-f0-9]{64})$/
const SESSION_LOG_FILE = /^session\.v(\d+)\.jsonl\.zstd$/

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
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
  return chat
}

async function readPackageVersion(sourceRoot) {
  for (const candidate of [path.join(sourceRoot, 'tavern-plugin', 'package.json'), path.join(sourceRoot, 'package.json')]) {
    try {
      const doc = JSON.parse(await readFile(candidate, 'utf8'))
      if (typeof doc?.version === 'string' && doc.version) return doc.version
    } catch { /* try next */ }
  }
  return ''
}

/** 离线只读 DSH 附件目录（<dshHome>/attachments/v1），与 @deepseek-ai/dsh-attachment-local 布局一致。 */
function createOfflineAttachments(attachmentsRoot) {
  function hexOf(ref) {
    const match = SHA256_REF.exec(str(ref?.attachmentId))
    if (!match) throw new Error('无效的附件引用')
    return match[1]
  }
  return {
    async readImage(ref) {
      const hex = hexOf(ref)
      const data = await readFile(path.join(attachmentsRoot, 'objects', hex.slice(0, 2), hex))
      return { ref, data }
    },
    async *readFileStream(ref) {
      const hex = hexOf(ref)
      const canonical = path.join(attachmentsRoot, 'file-objects', hex.slice(0, 2), hex)
      try {
        yield await readFile(canonical)
        return
      } catch (error) {
        if (error?.code !== 'ENOENT' || !ref?.name) throw error
      }
      yield await readFile(path.join(attachmentsRoot, 'files', hex.slice(0, 2), hex, path.basename(str(ref.name))))
    }
  }
}

/** 离线只读舞台素材包目录（<profileRoot>/asset-packs/packs/<id>/manifest.json）。 */
function createOfflineAssetLibrary(assetRoot) {
  const packsDir = path.join(assetRoot, 'packs')
  async function readPack(id) {
    const manifestPath = path.join(packsDir, id, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!manifest || typeof manifest !== 'object') return null
    if (!manifest.id) manifest.id = id
    return { manifest }
  }
  return {
    async listPacks() {
      const entries = await readdir(packsDir, { withFileTypes: true }).catch(() => [])
      const rows = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const pack = await readPack(entry.name)
          if (pack) rows.push(pack)
        } catch { /* skip broken pack */ }
      }
      return rows
    },
    async getPackSnapshot({ packId }) {
      return await readPack(str(packId))
    }
  }
}

/** 离线读取原生 DSH 会话日志；缺失或损坏时回退为空会话并记一条告警，不挡住整局聊天导出。 */
async function readOfflineSession(sessionsRoot, sessionId, warnings) {
  const fallback = reason => {
    warnings.push(`会话 ${sessionId} 原生日志不可用（${reason}），已按空原生日志导出`)
    return { header: { id: sessionId, version: 1 }, inheritedEventCount: 0, events: [] }
  }
  const found = await findSessionDirectory(sessionsRoot, sessionId)
  if (!found.ok) return fallback(found.reason || '找不到目录')
  const entries = await readdir(found.path).catch(() => [])
  let best = null
  for (const name of entries) {
    const match = SESSION_LOG_FILE.exec(name)
    if (match) {
      const version = Number(match[1])
      if (!best || version > best.version) best = { version, file: path.join(found.path, name) }
    }
  }
  if (!best && entries.includes('session.jsonl')) best = { version: 0, file: path.join(found.path, 'session.jsonl') }
  if (!best) return fallback('目录里没有会话日志')
  try {
    const parsed = parseSessionLog(await readFile(best.file))
    return {
      header: parsed.header,
      inheritedEventCount: Number(parsed.header?.inheritedEventCount) || 0,
      events: parsed.events
    }
  } catch (error) {
    return fallback(str(error?.message || error))
  }
}

/**
 * 构建完全不依赖 cordis / ctx 的离线导出目录环境。
 * 绝不写回用户数据目录，只读并导出。
 */
export async function createRescueTransferCatalog(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || DEFAULT_SOURCE_ROOT)
  const dshHome = options.dshHome ? path.resolve(options.dshHome)
    : (options.dataRoot ? path.resolve(options.dataRoot, '../../..') : path.resolve(resolveTavernDataRoot(), '../../..'))
  const dataRoot = path.resolve(options.dataRoot || resolveTavernDataRoot({ dshHome }))
  const profileRoot = path.dirname(dataRoot)
  const sessionsRoot = options.sessionsRoot ? path.resolve(options.sessionsRoot) : path.join(profileRoot, 'sessions')
  const attachmentsRoot = options.attachmentsRoot ? path.resolve(options.attachmentsRoot) : path.join(dshHome, 'attachments', 'v1')
  const warnings = Array.isArray(options.warnings) ? options.warnings : []

  const fileResources = createFileResourceStore({ dataRoot })
  const profileData = createProfileDataStore({ dataRoot })
  const cardPreparation = createCardPreparation({ id: () => 'card-rescue', now: Date.now })
  const tavernVersion = await readPackageVersion(sourceRoot)

  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    if (cardPreparation.isWorkspace(existing)) return existing
    // 救援模式只读不写回：在内存中临时迁移为 workspace 形态。
    const payload = await fileResources.originalCardPayload(normalized).catch(() => null)
    return cardPreparation.migrate({ working: existing, payload })
  }

  async function readCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const workspace = await readCardWorkspace(normalized)
    const card = workspace === undefined ? undefined : cardPreparation.project(workspace)
    if (card !== undefined) {
      card.path = normalized
      const raw = workspace.raw?.data || workspace.raw || {}
      card.extensions = structuredClone(raw.extensions || {})
    }
    return card
  }

  const worldBooks = createWorldBookLibrary({
    normalizePath: normalizeResourcePath,
    resources: {
      globalSources: async () => await fileResources.globalWorldBookSources(),
      setGlobal: async () => { throw new Error('只读') },
      list: async kind => await fileResources.list(kind),
      readText: async p => await fileResources.readText(p),
      metadata: async p => await fileResources.metadata(p),
      import: async () => { throw new Error('只读') },
      write: async () => { throw new Error('只读') },
      bindingForCard: async cardPath => await fileResources.worldBookBindingForCard(cardPath),
      bind: async () => { throw new Error('只读') },
      bindMany: async () => { throw new Error('只读') },
      unbind: async () => { throw new Error('只读') }
    },
    cards: {
      listPaths: async () => await fileResources.list('card'),
      read: readCard,
      metadata: async cardPath => await fileResources.metadata(cardPath),
      update: async () => { throw new Error('只读') }
    },
    removeStandalone: async () => { throw new Error('只读') }
  })

  const presetLibrary = createPresetLibrary({
    resources: fileResources,
    state: profileData,
    prepareImport: () => { throw new Error('只读') }
  })

  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(name => [name, promptFile(name)]))
  }
  async function readTavernSettings() {
    const raw = await profileData.readJson(TAVERN_SETTINGS_PATH).catch(() => undefined)
    return presentTavernSettings(raw, promptDefaults())
  }
  const promptDocuments = createSystemPromptDocuments()
  const userPreferenceProfile = createUserPreferenceProfile({ store: profileData })

  const tavernExtensionSettings = createTavernExtensionSettings(profileData)
  const regexManager = createRegexManager({
    regexSettings: createTavernRegexSettings({ extensionSettings: tavernExtensionSettings }),
    legacyLibrary: createRegexLibrary({ store: profileData }),
    chatForSession: async () => undefined,
    groupOfMode: () => 'story',
    readCardSources: async () => [],
    updateChat: async () => {}
  })

  const silentLogger = { warn() {}, error() {}, log() {} }
  const chatJournalStore = createChatJournalStore({
    dataRoot,
    legacyData: profileData,
    now: Date.now,
    logger: silentLogger,
    backgroundSnapshots: false,
    newConversations: false,
    migrateLegacy: false
  })
  const chatPersistence = createChatPersistence({ store: chatJournalStore, normalize: normalizeChat, now: Date.now })

  async function readChat(chatId) {
    return await chatPersistence.read(chatId)
  }
  async function readChatRevision(chatId, revision) {
    return await chatPersistence.readRevision(chatId, revision)
  }

  // 离线列出所有对局：合并 index.json、sessions.json 与 chats/ 目录里的实际存档，不因索引损坏漏掉存档。
  let cachedSessions = null
  async function listTavernSessions() {
    if (cachedSessions) return cachedSessions
    const byId = new Map()
    const index = await profileData.readJson('index.json').catch(() => null)
    for (const row of Array.isArray(index?.chats) ? index.chats : []) {
      const id = str(row?.id || row?.chatId)
      if (id) byId.set(id, { ...row, id })
    }
    const links = await profileData.readJson('sessions.json').catch(() => null)
    const sessionByChat = new Map()
    if (links && typeof links === 'object') {
      for (const [sessionId, chatId] of Object.entries(links)) {
        if (typeof chatId === 'string' && chatId) {
          sessionByChat.set(chatId, sessionId)
          if (!byId.has(chatId)) byId.set(chatId, { id: chatId, sessionId })
        }
      }
    }
    const stored = await profileData.list('chats').catch(() => [])
    for (const entry of stored) {
      const id = entry.directory ? entry.name : (entry.name.match(/^(chat-[^.]+)\.json$/) || [])[1]
      if (id && /^chat-[^.]+$/.test(id) && !byId.has(id)) byId.set(id, { id })
    }
    const rows = []
    for (const [chatId, base] of byId) {
      let header = null
      try {
        header = (await chatPersistence.readSlice(chatId, []))?.chat || null
      } catch {
        header = await readChat(chatId).catch(() => null)
      }
      if (!header && !base.sessionId) continue
      const sessionId = str(header?.sessionId || base.sessionId || sessionByChat.get(chatId) || chatId)
      rows.push({
        ...base,
        id: chatId,
        sessionId,
        title: str(header?.title || base.title),
        cardName: str(header?.cardName || base.cardName),
        cardPath: str(header?.cardPath || base.cardPath),
        mode: str(header?.mode || base.mode || 'story'),
        requestMode: str(header?.requestMode || base.requestMode || 'dsh')
      })
    }
    cachedSessions = rows
    return rows
  }

  async function chatForSession(sessionId) {
    const id = str(sessionId)
    const rows = await listTavernSessions()
    const match = rows.find(row => row.sessionId === id || row.id === id)
    if (!match) return undefined
    const chat = await readChat(match.id)
    if (chat && !chat.sessionId) chat.sessionId = match.sessionId
    return chat
  }

  const attachments = createOfflineAttachments(attachmentsRoot)
  const gameFootprint = createGameFootprint({ dataRoot, sessionsRoot })
  const sceneWorldbookArchive = createSceneWorldbooks({ store: profileData })
  const pluginDataStore = createPluginDataStore({ dataRoot })
  const pluginMedia = createPluginMedia({ store: profileData })

  const gameSaveSnapshot = createGameSaveSnapshot({
    readChat,
    readWorldSnapshot: chatPersistence.readWorldSnapshot,
    assertIdle: chat => assertGameSaveExportable(chat, { agentRunning: false, settlementRunning: false }),
    readSession: sessionId => readOfflineSession(sessionsRoot, sessionId, warnings)
  })

  const exportGameSave = createGameSaveExporter({
    chatForSession,
    gameSaveSnapshot,
    readChatRevision,
    fileResources,
    gameFootprint,
    sceneWorldbookArchive,
    getAttachments: () => attachments,
    exportPluginData: async chatId => {
      const [data, media] = await Promise.all([
        pluginDataStore.snapshot(chatId).catch(() => null),
        pluginMedia.snapshot(chatId).catch(() => null)
      ])
      return data || media ? { data, media } : null
    },
    hasBoundWorldbook: async cardPath => {
      if (str(cardPath) === '') return false
      try { return (await worldBooks.bound(cardPath)) !== null } catch { return false }
    },
    tavernVersion,
    warn: (...args) => warnings.push(args.map(str).join(' '))
  })

  const chats = createTransferChats({
    listSessions: listTavernSessions,
    readChat,
    readRecentSummaries: chatId => chatPersistence.readRecentSummaries(chatId, Number.MAX_SAFE_INTEGER),
    readChatHeader: async chatId => (await chatPersistence.readSlice(chatId, []))?.chat,
    exportSave: exportGameSave,
    fileResources
  })

  const userPluginInstaller = createUserPluginInstaller({
    dataRoot,
    cardPaths: () => fileResources.list('card')
  })
  const plugins = createTransferPlugins({
    pluginsDir: userPluginInstaller.pluginsDir,
    listPlugins: () => userPluginInstaller.list()
  })
  const materials = createTransferMaterials({ fileResources })
  const fonts = createTransferFonts({ fontsDir: path.join(dataRoot, 'fonts') })
  async function pluginDataEntries() {
    const names = await readdir(path.join(dataRoot, 'plugin-data')).catch(() => [])
    return names.filter(name => name.endsWith('.json')).map(name => {
      const key = name.slice(0, -5)
      return { folder: key, name: key }
    })
  }
  const pluginData = createTransferPluginData({ pluginDataStore, listPlugins: pluginDataEntries })
  const tavernSkills = createTavernSkillModule({
    directory: path.join(dataRoot, 'skills'),
    builtInDirectory: path.join(sourceRoot, 'presets/tavern/skills'),
    backgroundDirectory: path.join(sourceRoot, 'presets/tavern-background/skills')
  })
  const skills = createTransferSkills({
    skillsDir: path.join(dataRoot, 'skills'),
    listSkills: () => tavernSkills.list()
  })
  const memory = createTransferMemory({ store: profileData, listSessions: listTavernSessions })
  const assetRoot = path.join(profileRoot, 'asset-packs')
  const assets = createTransferAssets({ root: assetRoot, library: createOfflineAssetLibrary(assetRoot) })

  const catalog = createTransferCatalog({
    fileResources,
    cardPreparation,
    readCardWorkspace,
    worldBooks,
    presetLibrary,
    promptDocuments,
    userPreferenceProfile,
    regexManager,
    readTavernSettings,
    tavernVersion,
    fileSize: async relative => (await stat(fileResources.absolute(relative))).size,
    chats,
    plugins,
    materials,
    fonts,
    pluginData,
    skills,
    assets,
    memory
  })

  return { catalog, dataRoot, tavernVersion, warnings }
}

// 这几个板块多项会合并写进同一个 JSON 文件（且本身很小），按整板块收集；
// 其余板块（对话、人物卡、素材包、插件、世界书、预设等）逐项收集并立即流式落盘，避免大库 OOM。
const WHOLE_PART_KINDS = new Set(['profile', 'regex', 'prompts', 'settings'])

/**
 * 离线扫描所有可救援导出的板块与条目（只读，不打包）。
 * 供启动页弹出与酒馆「导出」一致的分组/逐项勾选界面。
 */
export async function listRescueParts(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
  const warnings = []
  onStatus('正在扫描可导出的存档与资源')
  const { catalog, dataRoot, tavernVersion } = await createRescueTransferCatalog({ ...options, warnings })
  const listed = await catalog.listParts()
  const parts = listed.parts
    .filter(part => part.supported && !part.exportOnly)
    .map(part => ({
      kind: part.kind,
      group: part.group,
      label: part.label,
      unit: part.unit || '项',
      note: part.note || '',
      privacy: part.privacy || '',
      bytes: Number(part.bytes) || 0,
      items: (Array.isArray(part.items) ? part.items : []).map(item => ({
        key: str(item.key),
        title: str(item.title || item.key),
        meta: str(item.meta),
        bytes: Number(item.bytes) || 0
      }))
    }))
  return {
    groups: listed.groups || [],
    parts,
    tavernVersion,
    dataRoot,
    warnings
  }
}

function resolveTargets(listedParts, selection) {
  const candidates = listedParts.filter(part => part.supported && !part.exportOnly && Array.isArray(part.items) && part.items.length > 0)
  if (selection === undefined || selection === null) return candidates
  if (typeof selection !== 'object' || Array.isArray(selection)) throw new Error('导出选区格式无效')
  const targets = []
  for (const part of candidates) {
    const picked = selection[part.kind]
    if (picked === true || (Array.isArray(picked) && picked.includes('*'))) {
      targets.push(part)
      continue
    }
    if (!Array.isArray(picked) || picked.length === 0) continue
    const wanted = new Set(picked.map(str).filter(Boolean))
    const items = part.items.filter(item => wanted.has(str(item.key)))
    if (items.length > 0) targets.push({ ...part, items })
  }
  return targets
}

/**
 * 离线导出 .dshtransfer 救援包。
 * - 支持 selection 局部选择（板块级或逐项 key）与 includeImages 开关，与酒馆「导出」页一致；
 * - 提供 outFile 时采用逐项收集 + 流式写盘，写完即释放条目 Buffer，避免大库 OOM；
 * - 遇到单个损坏项时记录告警并继续救出其余完好项，不因局部损坏让整次救援失败。
 */
export async function exportRescueBundle(options = {}) {
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const warnings = []

  onStatus('正在扫描存档与资源')
  const { catalog, tavernVersion } = await createRescueTransferCatalog({ ...options, warnings })
  const listed = await catalog.listParts()

  const hasSelection = options.selection !== undefined && options.selection !== null
  const targets = resolveTargets(listed.parts, options.selection)
  const totalItems = targets.reduce((sum, part) => sum + part.items.length, 0)
  if (totalItems === 0) {
    throw new Error(hasSelection ? '所选板块或条目没有可导出的内容' : '没有找到可导出的存档或资源')
  }

  // 与正常「导出」一致：同包已包含世界书/预设时，不在每局对话存档里重复嵌入整份副本，大幅减小体积与内存占用。
  const embedWorldbook = !targets.some(part => part.kind === 'worldbooks')
  const embedPreset = !targets.some(part => part.kind === 'presets')
  const includeImages = options.includeImages !== false

  const parts = []
  const usedEntries = new Set()
  const files = options.outFile ? null : new Map()
  const writer = options.outFile ? await createTransferBundleWriter(options.outFile) : null
  let doneItems = 0

  function report(label, itemTitle) {
    const pct = totalItems > 0 ? Math.min(95, Math.round(doneItems * 92 / totalItems)) : 0
    onProgress(pct)
    onStatus(`正在救援导出：${label}${itemTitle ? ' · ' + itemTitle : ''}（${doneItems}/${totalItems}）`)
  }

  // 把一次 collect 的产物直接流式写盘（或记录进内存 Map），避免条目路径重名。
  async function emitCollected(collected) {
    for (const part of collected.parts) {
      let existing = parts.find(row => row.kind === part.kind)
      if (!existing) {
        existing = { kind: part.kind, label: part.label, items: [] }
        parts.push(existing)
      }
      for (const item of part.items) {
        const content = collected.files.get(item.entry)
        if (content === undefined) continue
        let entry = item.entry
        if (usedEntries.has(entry)) {
          const parsed = path.posix.parse(entry)
          let n = 2
          while (usedEntries.has(path.posix.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`))) n += 1
          entry = path.posix.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
        }
        usedEntries.add(entry)
        if (writer) await writer.addEntry(entry, content)
        else files.set(entry, content)
        existing.items.push({ ...item, entry })
      }
    }
  }

  try {
    for (const part of targets) {
      const collectOpts = { images: includeImages, embedWorldbook, embedPreset }
      if (WHOLE_PART_KINDS.has(part.kind)) {
        const keys = part.items.map(item => item.key)
        report(part.label, '')
        let collected
        try {
          collected = await catalog.collect({ [part.kind]: keys }, collectOpts)
        } catch (partError) {
          warnings.push(`${part.label}导出失败（已跳过）：${str(partError?.message || partError)}`)
          doneItems += keys.length
          report(part.label, '')
          continue
        }
        await emitCollected(collected)
        doneItems += keys.length
        report(part.label, '')
        continue
      }

      for (const item of part.items) {
        const title = item.title || item.key
        report(part.label, title)
        let collected
        try {
          collected = await catalog.collect({ [part.kind]: [item.key] }, collectOpts)
        } catch (itemError) {
          warnings.push(`${part.label}「${title}」导出失败（已跳过）：${str(itemError?.message || itemError)}`)
          doneItems += 1
          report(part.label, title)
          continue
        }
        // writer.addEntry 抛出的超限/磁盘空间不足属于致命错误，不再静默跳过。
        await emitCollected(collected)
        doneItems += 1
        report(part.label, title)
      }
    }

    if (!parts.length) throw new Error('所有板块均导出失败：' + (warnings[0] || '未知错误'))

    onProgress(96)
    onStatus('正在写入清单并完成打包 .dshtransfer')
    const name = safeTransferFileName(str(options.name) || 'DSH酒馆救援备份-' + stamp(), 'DSH酒馆救援备份')
    const manifest = buildTransferManifest({
      name,
      source: { tavern: str(tavernVersion), platform: process.platform },
      parts
    })
    const filename = manifest.name + TRANSFER_EXTENSION

    let buffer
    let bytes = 0
    if (writer) {
      const written = await writer.finalize(manifest)
      bytes = written.bytes
    } else {
      buffer = packTransferBundle({ manifest, files })
      bytes = buffer.length
    }

    onProgress(100)
    return {
      ...(buffer ? { buffer } : {}),
      filename,
      name: manifest.name,
      bytes,
      totals: manifest.totals,
      parts: manifest.parts.map(p => ({ kind: p.kind, label: p.label, items: p.items.length, bytes: p.bytes })),
      warnings
    }
  } catch (error) {
    if (writer) await writer.abort()
    throw error
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--list') out.list = true
    else if (arg === '--no-images') out.includeImages = false
    else if (arg === '--images') out.includeImages = true
    else if (arg.startsWith('--') && i + 1 < argv.length) out[arg.slice(2)] = argv[++i]
  }
  return out
}

async function readSelectionArg(args) {
  if (args['selection-file']) {
    const text = await readFile(args['selection-file'], 'utf8')
    return JSON.parse(text)
  }
  if (args.selection) {
    return JSON.parse(args.selection)
  }
  return undefined
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.list) {
    try {
      const listed = await listRescueParts({
        dshHome: args['dsh-home'],
        dataRoot: args['data-root'],
        sourceRoot: args['source-root'],
        onStatus: msg => console.log('DSH_STATUS ' + msg)
      })
      console.log('RESULT ' + JSON.stringify({
        kind: 'list',
        groups: listed.groups,
        parts: listed.parts,
        tavernVersion: listed.tavernVersion,
        warnings: listed.warnings
      }))
    } catch (error) {
      console.log('RESULT ' + JSON.stringify({ kind: 'error', error: str(error?.message || error) }))
      process.exitCode = 1
    }
    return
  }
  if (!args.out) {
    console.log('RESULT ' + JSON.stringify({ kind: 'error', error: '缺少 --out 参数' }))
    process.exitCode = 1
    return
  }
  try {
    const selection = await readSelectionArg(args)
    const res = await exportRescueBundle({
      outFile: args.out,
      dshHome: args['dsh-home'],
      dataRoot: args['data-root'],
      sourceRoot: args['source-root'],
      name: args.name,
      selection,
      includeImages: args.includeImages !== false,
      onStatus: msg => console.log('DSH_STATUS ' + msg),
      onProgress: pct => console.log('DSH_PROGRESS ' + pct)
    })
    console.log('RESULT ' + JSON.stringify({
      kind: 'ok',
      out: path.resolve(args.out),
      filename: res.filename,
      name: res.name,
      bytes: res.bytes,
      totals: res.totals,
      parts: res.parts,
      warnings: res.warnings
    }))
  } catch (error) {
    console.log('RESULT ' + JSON.stringify({ kind: 'error', error: str(error?.message || error) }))
    process.exitCode = 1
  }
}

function isMainEntry() {
  if (!process.argv[1]) return false
  const self = fileURLToPath(import.meta.url)
  const argv = path.resolve(process.argv[1])
  if (argv === self) return true
  try { return realpathSync(argv) === realpathSync(self) } catch { return false }
}

if (isMainEntry()) {
  await main()
}
