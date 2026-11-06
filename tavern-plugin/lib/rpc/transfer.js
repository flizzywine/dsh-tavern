import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildTransferManifest, packTransferBundle, readTransferBundle, safeTransferFileName, TRANSFER_EXTENSION } from '../domain/transfer-bundle.js'
import { createTransferAssets } from '../domain/transfer-assets.js'
import { createTransferCatalog } from '../domain/transfer-catalog.js'
import { createTransferChats } from '../domain/transfer-chats.js'
import { createTransferFonts } from '../domain/transfer-fonts.js'
import { createTransferImport } from '../domain/transfer-import.js'
import { createTransferLogs } from '../domain/transfer-logs.js'
import { createTransferMaterials } from '../domain/transfer-materials.js'
import { createTransferMemory } from '../domain/transfer-memory.js'
import { createTransferPluginData } from '../domain/transfer-plugin-data.js'
import { createTransferSkills } from '../domain/transfer-skills.js'
import { createTransferUndo } from '../domain/transfer-undo.js'
import { createTransferPlugins } from '../domain/transfer-plugins.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// A package waiting to be applied lives in memory for a quarter of an hour; a reload asks again.
const TOKEN_TTL_MS = 15 * 60 * 1000
// P0 bundles carry text only; anything far larger is probably not one of ours.
const MAX_IMPORT_BYTES = 128 * 1024 * 1024
// A 16 MB ZIP is already awkward as base64 inside one JSON reply.
const STREAM_THRESHOLD_BYTES = 16 * 1024 * 1024

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
}

/** Export / import of `.dshtransfer` bundles (Wiki「设计：data-transfer」). */
export function createTransferHandlers(deps) {
  const { dataRoot, uploads, fileResources, worldBooks, presetLibrary, promptDocuments, userPreferenceProfile,
    regexManager, readTavernSettings, updateTavernSettings, importCard, importPreset, readCardWorkspace,
    cardPreparation, TAVERN_PACKAGE_VERSION, listTavernSessions, readChat, exportGameSave, importGameSave,
    userPluginInstaller, pluginDataStore, tavernSkills, transferExports, exportTavernLogs,
    deleteCard, deletePreset, deleteResource, readRawTavernSettings, updateChat, assetLibrary, profileData } = deps

  async function writeBackup(name, text) {
    const directory = path.join(dataRoot, '..', 'backups', 'transfer', stamp())
    await mkdir(directory, { recursive: true })
    const target = path.join(directory, safeTransferFileName(name, 'backup.json'))
    await writeFile(target, text)
    return path.relative(path.join(dataRoot, '..'), target).split(path.sep).join('/')
  }

  const chats = createTransferChats({ listSessions: listTavernSessions, readChat, exportSave: exportGameSave, importSave: importGameSave, updateChat })
  const plugins = createTransferPlugins({ pluginsDir: userPluginInstaller.pluginsDir, listPlugins: () => userPluginInstaller.list() })
  const materials = createTransferMaterials({ fileResources })
  const fonts = createTransferFonts({ fontsDir: path.join(dataRoot, 'fonts') })
  // Plugin data files are keyed by whatever id the plugin chose (often a hash), so the directory
  // itself is the list — not the installed plugin folders.
  async function pluginDataEntries() {
    const names = await readdir(path.join(dataRoot, 'plugin-data')).catch(() => [])
    return names.filter(name => name.endsWith('.json')).map(name => {
      const key = name.slice(0, -5)
      return { folder: key, name: key }
    })
  }
  const pluginData = createTransferPluginData({ pluginDataStore, listPlugins: pluginDataEntries })
  const logs = createTransferLogs({ listSessions: listTavernSessions, exportLogs: exportTavernLogs })
  const skills = createTransferSkills({ skillsDir: path.join(dataRoot, 'skills'), listSkills: () => tavernSkills.list() })
  // 召回记录和存档一样放在 profile 数据根下（worldbook-recalls/<chatId>/），由 profileData 读写。
  const memory = profileData ? createTransferMemory({ store: profileData, listSessions: listTavernSessions }) : null
  // 素材库的根在 tavern dataRoot 旁边（index.js 里建 assetLibrary 用的是同一个路径）。
  const assets = assetLibrary ? createTransferAssets({ root: path.join(path.dirname(dataRoot), 'asset-packs'), library: assetLibrary }) : null

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
    tavernVersion: TAVERN_PACKAGE_VERSION,
    fileSize: async relative => (await stat(fileResources.absolute(relative))).size,
    chats,
    plugins,
    materials,
    fonts,
    pluginData,
    skills,
    logs,
    assets,
    memory
  })

  const importer = createTransferImport({
    fileResources, worldBooks, presetLibrary, promptDocuments, userPreferenceProfile, regexManager,
    readTavernSettings, readSettingsDocument: readRawTavernSettings, updateTavernSettings, importCard, importPreset,
    backup: writeBackup, chats, plugins, materials, fonts, pluginData, skills, assets, memory, removeCreated
  })

  const tokens = new Map()
  const undoTokens = new Map()
  // A phone that loses the reply taps again with the same token; that must not import twice.
  // One apply per token at a time, and a finished token replays its result instead of re-running.
  const runningApplies = new Map()
  const finishedApplies = new Map()
  const applyProgress = new Map()
  function sweepTokens(now = Date.now()) {
    for (const [token, entry] of tokens) if (now - entry.at > TOKEN_TTL_MS) tokens.delete(token)
    for (const [token, entry] of undoTokens) if (now - entry.at > TOKEN_TTL_MS) undoTokens.delete(token)
    for (const [token, entry] of finishedApplies) if (now - entry.at > TOKEN_TTL_MS) finishedApplies.delete(token)
    for (const [token, entry] of applyProgress) if (now - entry.at > TOKEN_TTL_MS) applyProgress.delete(token)
  }

  const fileHash = async relative => {
    const absolute = fileResources.absolute(relative)
    try { return createHash('sha256').update(await readFile(absolute)).digest('hex') }
    catch (error) { if (error && error.code === 'ENOENT') return null; throw error }
  }

  async function removeCreated(kind, path) {
    if (kind === 'cards') return await deleteCard(path)
    if (kind === 'worldbooks') return await worldBooks.remove({ kind: 'standalone', path })
    if (kind === 'presets') return await deletePreset(path)
    if (kind === 'scripts') return await deleteResource(path)
    throw new Error('这类导入不支持撤销：' + kind)
  }

  const undo = createTransferUndo({ hashOf: (kind, path) => fileHash(path), remove: removeCreated })

  return {
    async getTransferCatalog() {
      return await catalog.listParts()
    },

    async createTransferExport(args) {
      const selection = args && typeof args.selection === 'object' && args.selection !== null ? args.selection : {}
      const collected = await catalog.collect(selection, { images: args && args.includeImages !== false })
      if (!collected.parts.length) throw new Error('请至少选择一个板块')
      const name = safeTransferFileName(str(args && args.name) || 'DSH酒馆备份-' + stamp(), 'DSH酒馆备份')
      const manifest = buildTransferManifest({
        name,
        source: { tavern: str(TAVERN_PACKAGE_VERSION), platform: process.platform },
        parts: collected.parts
      })
      const buffer = packTransferBundle({ manifest, files: collected.files })
      const filename = manifest.name + TRANSFER_EXTENSION
      const parts = manifest.parts.map(function (part) {
        return { kind: part.kind, label: part.label, items: part.items.length, bytes: part.bytes }
      })
      // Past this size the page downloads by URL instead of carrying base64 through JSON.
      // 文件名放进路径：Android 的 URLUtil.guessFileName 在 DownloadListener 拿不到
      // Content-Disposition 时会退回 URL 最后一段，只写 query 会得到 transfer-export.bin。
      if (transferExports && buffer.length > STREAM_THRESHOLD_BYTES) {
        const stored = await transferExports.put(buffer, filename)
        return { filename, name: manifest.name,
          downloadUrl: '/api/dsh-tavern/transfer-export/' + encodeURIComponent(filename) + '?token=' + stored.token,
          bytes: buffer.length, totals: manifest.totals, parts }
      }
      return {
        filename,
        name: manifest.name,
        base64: buffer.toString('base64'),
        bytes: buffer.length,
        totals: manifest.totals,
        parts
      }
    },

    async previewTransferBundle(args) {
      sweepTokens()
      const upload = await uploads.take(str(args && args.uploadId))
      try {
        const buffer = await readFile(upload.file)
        if (buffer.length > MAX_IMPORT_BYTES) throw new Error('导出包超过 ' + Math.round(MAX_IMPORT_BYTES / 1048576) + ' MB，暂不支持这么大的包')
        const bundle = readTransferBundle(buffer)
        const preview = await importer.preview(bundle.manifest, bundle.files)
        const token = randomUUID()
        tokens.set(token, { at: Date.now(), manifest: bundle.manifest, files: bundle.files })
        return {
          token,
          bundle: {
            name: bundle.manifest.name,
            createdAt: bundle.manifest.createdAt,
            source: bundle.manifest.source,
            bytes: buffer.length,
            totals: preview.totals,
            parts: preview.parts,
            canApply: preview.canApply,
            issues: bundle.issues
          }
        }
      } finally {
        await upload.remove()
      }
    },

    async applyTransferBundle(args) {
      sweepTokens()
      const token = str(args && args.token)
      // 同一个 token 只跑一次导入：手机端超时重发、连点、重新打开页面再点，都复用这一次。
      const inFlight = runningApplies.get(token)
      if (inFlight) return await inFlight
      const settled = finishedApplies.get(token)
      if (settled) return settled.result
      const entry = tokens.get(token)
      if (!entry) throw new Error('导入会话已过期，请重新选择导出包')
      const policies = args && args.policies && typeof args.policies === 'object' && !Array.isArray(args.policies) ? args.policies : {}
      const selection = args && args.selection && typeof args.selection === 'object' && !Array.isArray(args.selection) ? args.selection : null
      const startedAt = Date.now()
      const report = function (step) {
        applyProgress.set(token, Object.assign({ at: Date.now(), startedAt }, step))
      }
      report({ stage: 'start', kind: '', label: '准备中', items: 0, total: 0 })
      const run = (async () => {
        const result = await importer.apply({
          manifest: entry.manifest, files: entry.files, policies, selection,
          onProgress: step => report(step)
        })
        // Record what was created and its hash now, so undo can refuse files edited since.
        const records = []
        for (const row of result.results || []) {
          for (const created of row.created || []) {
            const sha256 = await fileHash(created.path).catch(() => null)
            if (sha256) records.push({ kind: created.kind, title: created.title, path: created.path, sha256 })
          }
        }
        let undoTx = ''
        if (records.length) {
          undoTx = randomUUID()
          undoTokens.set(undoTx, { at: Date.now(), records })
        }
        return Object.assign({}, result, undoTx ? { undoToken: undoTx } : {})
      })()
      runningApplies.set(token, run)
      try {
        const result = await run
        tokens.delete(token)
        finishedApplies.set(token, { at: Date.now(), result })
        return result
      } catch (error) {
        // Token 还在 tokens 里，用户可以原地再试一次；只有成功才把它回收。
        throw error
      } finally {
        runningApplies.delete(token)
        applyProgress.delete(token)
      }
    },

    async getTransferImportProgress(args) {
      sweepTokens()
      const token = str(args && args.token)
      const entry = applyProgress.get(token)
      if (entry) {
        return { running: true, kind: entry.kind, label: entry.label, items: entry.items, total: entry.total,
          elapsedMs: Math.max(0, Date.now() - entry.startedAt) }
      }
      return { running: runningApplies.has(token), kind: '', label: '', items: 0, total: 0, elapsedMs: 0 }
    },

    async undoTransferImport(args) {
      sweepTokens()
      const token = str(args && args.token)
      const entry = undoTokens.get(token)
      if (!entry) throw new Error('这次导入已不能撤销，或已经撤销过')
      const result = await undo.undo(entry.records)
      undoTokens.delete(token)
      return result
    }
  }
}
