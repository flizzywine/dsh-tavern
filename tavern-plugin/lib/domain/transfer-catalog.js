import path from 'node:path'
import { safeTransferFileName, transferItem } from './transfer-bundle.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function stemOf(value) {
  return path.posix.basename(str(value), path.posix.extname(str(value))) || '未命名'
}

function uniqueEntry(used, entry) {
  const parsed = path.posix.parse(entry)
  let candidate = entry, index = 2
  while (used.has(candidate)) {
    candidate = path.posix.join(parsed.dir, parsed.name + ' (' + index + ')' + parsed.ext)
    index += 1
  }
  used.add(candidate)
  return candidate
}

// Settings worth carrying to another machine. API keys, accounts and host configuration stay out:
// they belong to this install, and a copied key is the easiest way to leak one.
export const TRANSFER_SETTINGS_KEYS = Object.freeze([
  'headerItems', 'viewTabs', 'candidateDismissMode', 'candidateAutoGenerate',
  'polishPrereview', 'storyGenerationMode', 'storyGenerationProvider', 'storyPluginOutputRegex', 'storyInputToolCall', 'storyOutputToolCall', 'storyToolThinking', 'storyToolHistoryMode', 'autoOpenStatusPanel',
  'contextCompaction', 'defaultPlaySettings', 'retryOnFailure', 'recentReplyFirst'
])

const PART_DEFS = [
  { kind: 'cards', group: 'lore', label: '人物卡', unit: '张', supported: true,
    note: '按 SillyTavern 人物卡格式带走；立绘与素材包下一版随包' },
  { kind: 'worldbooks', group: 'lore', label: '世界书', unit: '本', supported: true,
    note: '独立世界书整本导出；人物卡绑定关系下一版随包' },
  { kind: 'presets', group: 'style', label: '预设', unit: '个', supported: true,
    note: '原始预设文本原样带走，不改写、不转换' },
  { kind: 'prompts', group: 'style', label: '系统提示词', unit: '套', supported: true,
    note: '带上当前生效的一套；导入后新增方案，不切换默认' },
  { kind: 'profile', group: 'style', label: '长期偏好', unit: '份', supported: true, privacy: '含个人设定',
    note: '只带已确认的画像正文' },
  { kind: 'regex', group: 'style', label: '正则库', unit: '条', supported: true,
    note: '全局正则；导入按规则合并，重复的自动换号' },
  { kind: 'settings', group: 'style', label: '酒馆设置', unit: '份', supported: true, privacy: '不含密钥',
    note: '显示偏好、候选策略、舞台开关等白名单字段；不含 API Key 与账号' },
  { kind: 'chats', group: 'story', label: '对话与存档', unit: '局', supported: true, privacy: '含剧情',
    note: '一局一个 .dshsave；导出时才生成，体积看剧情长度' },
  // 配图没有单独的存储入口：它们随 .dshsave 的 scene/files 与附件一起走，页面上由「含对话配图」控制。
  { kind: 'scene', group: 'story', label: '场景配图', unit: '张', supported: false,
    note: '配图随「对话与存档」一起打包，勾选下面的「含对话配图」即可，不单独成项' },
  { kind: 'memory', group: 'story', label: '游玩记忆', unit: '局', supported: true, privacy: '含私人剧情',
    note: '每局最近十轮的世界书召回记录；导入随同包的存档并进同一局，操作 id 相同的跳过。卡记忆暂不搬' },
  { kind: 'plugins', group: 'ext', label: '插件', unit: '个', supported: true, privacy: '可执行代码',
    note: '插件文件夹原样打包；导入只复制，不启用、不执行' },
  { kind: 'plugin-data', group: 'ext', label: '插件数据', unit: '个', supported: true, privacy: '可能含 token',
    note: '导出时剥离疑似凭据；导入会覆盖对应插件的数据' },
  { kind: 'assets', group: 'ext', label: '素材包与皮肤', unit: '包', supported: true,
    note: '整包带走背景、音乐、音效与皮肤；导入会发新包 id，卡上的绑定要在素材页重新指一次' },
  { kind: 'fonts', group: 'ext', label: '字体', unit: '族', supported: true, note: '只带走自装字体；插件内置字体不重复打包' },
  { kind: 'scripts', group: 'ext', label: '剧本', unit: '个', supported: true, note: '导入的参考资料原样带走；同名导入会加序号' },
  { kind: 'skills', group: 'ext', label: '写作 Skill', unit: '个', supported: true, note: '整目录打包；同名导入会加序号' },
  { kind: 'logs', group: 'ext', label: '诊断日志', unit: '局', supported: true, privacy: '含私人剧情', exportOnly: true,
    note: '只导出用于排查的 zip，不导入；内容含私人剧情，分享前请检查' }
]

export const TRANSFER_GROUPS = Object.freeze([
  { id: 'story', title: '故事与记录' },
  { id: 'lore', title: '角色与设定' },
  { id: 'style', title: '写法与偏好' },
  { id: 'ext', title: '扩展与诊断' }
])

/**
 * Everything the transfer page can offer, read from this install. Selection keys are the storage
 * paths (or ids) the libraries already use, so collect() never has to guess what a key means.
 */
export function createTransferCatalog(deps) {
  const { fileResources, cardPreparation, readCardWorkspace, worldBooks, presetLibrary, promptDocuments,
    userPreferenceProfile, regexManager, readTavernSettings, fileSize, tavernVersion, chats, plugins, materials, fonts, pluginData, skills, logs, assets, memory } = deps

  async function sizeOf(relative) {
    try { return await fileSize(relative) } catch { return 0 }
  }

  async function listCards() {
    const paths = await fileResources.list('card').catch(() => [])
    const items = new Array(paths.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(8, paths.length) }, async () => {
      while (cursor < paths.length) {
        const index = cursor++
        const cardPath = paths[index]
        let title = stemOf(cardPath)
        const [text, bytes] = await Promise.all([
          fileResources.readText(cardPath).catch(() => undefined),
          sizeOf(cardPath)
        ])
        if (text !== undefined) {
          try { const value = JSON.parse(text); title = str(value && value.name) || title } catch { /* keep the file name */ }
        }
        items[index] = { key: cardPath, title, meta: cardPath, bytes }
      }
    }))
    return items.sort(function (left, right) { return left.title.localeCompare(right.title, 'zh-CN') })
  }

  async function listWorldBooks() {
    const catalog = await worldBooks.catalog()
    const items = []
    for (const row of catalog.standalone) {
      items.push({ key: row.path, title: row.name || stemOf(row.path), meta: (row.entryCount || 0) + ' 条', bytes: await sizeOf(row.path) })
    }
    return items.sort(function (left, right) { return left.title.localeCompare(right.title, 'zh-CN') })
  }

  async function listPresets() {
    const catalog = await presetLibrary.catalog()
    const items = []
    for (const row of catalog.presets) {
      items.push({ key: row.path, title: row.title || stemOf(row.path), meta: row.valid === false ? '无法识别' : (row.promptCount || 0) + ' 项', bytes: await sizeOf(row.path) })
    }
    return items.sort(function (left, right) { return left.title.localeCompare(right.title, 'zh-CN') })
  }

  async function promptDocument() {
    return promptDocuments.export(await readTavernSettings())
  }

  async function listPrompts() {
    const document = await promptDocument()
    return [{ key: 'current', title: document.name, meta: Object.keys(document.prompts || {}).length + ' 段', bytes: Buffer.byteLength(JSON.stringify(document)) }]
  }

  async function listProfiles() {
    const library = await userPreferenceProfile.read()
    const items = []
    for (const row of library.profiles || []) {
      const profile = await userPreferenceProfile.read(row.id).catch(() => null)
      if (!profile || !profile.confirmed || !str(profile.confirmed.injectionText).trim()) continue
      items.push({ key: row.id, title: row.name, meta: str(profile.confirmed.injectionText).length + ' 字',
        bytes: Buffer.byteLength(JSON.stringify({ name: row.name, summary: str(profile.confirmed.summary), injectionText: str(profile.confirmed.injectionText) })) })
    }
    return items
  }

  async function listRegex() {
    const state = await regexManager.read('')
    return (state.global || []).map(function (script) {
      return { key: script.id, title: script.name, meta: script.enabled ? '启用' : '停用', bytes: Buffer.byteLength(JSON.stringify(script)) }
    })
  }

  async function settingsDocument() {
    const settings = await readTavernSettings()
    const picked = {}
    for (const key of TRANSFER_SETTINGS_KEYS) if (Object.hasOwn(settings, key)) picked[key] = settings[key]
    return picked
  }

  async function listSettings() {
    const document = await settingsDocument()
    return [{ key: 'current', title: '酒馆设置', meta: Object.keys(document).length + ' 个字段', bytes: Buffer.byteLength(JSON.stringify(document)) }]
  }

  const LISTS = { cards: listCards, worldbooks: listWorldBooks, presets: listPresets, prompts: listPrompts,
    profile: listProfiles, regex: listRegex, settings: listSettings }
  if (chats) LISTS.chats = () => chats.list()
  if (plugins) LISTS.plugins = () => plugins.list()
  if (materials) LISTS.scripts = () => materials.list()
  if (fonts) LISTS.fonts = () => fonts.list()
  if (pluginData) LISTS['plugin-data'] = () => pluginData.list()
  if (skills) LISTS.skills = () => skills.list()
  if (logs) LISTS.logs = () => logs.list()
  if (assets) LISTS.assets = () => assets.list()
  if (memory) LISTS.memory = () => memory.list()

  async function listParts() {
    const parts = await Promise.all(PART_DEFS.map(async def => {
      // 依赖没接上（测试或裁剪过的宿主）时按「本机没有」处理，不去调用不存在的列表。
      if (!def.supported || typeof LISTS[def.kind] !== 'function') {
        return Object.assign({}, def, { items: [], bytes: 0 })
      }
      let items = []
      try { items = await LISTS[def.kind]() } catch (error) { console.warn('dsh-tavern: 读取导出板块失败', def.kind, str(error && error.message || error)) }
      return Object.assign({}, def, { items, bytes: items.reduce(function (sum, item) { return sum + item.bytes }, 0) })
    }))
    return { parts, groups: TRANSFER_GROUPS, tavern: str(tavernVersion) }
  }

  function selected(selection, kind) {
    const list = selection && selection[kind]
    if (list === true) return ['*']
    if (!Array.isArray(list)) return []
    return list.map(str).filter(Boolean)
  }

  function wanted(selection, kind, key) {
    const list = selected(selection, kind)
    return list.includes('*') || list.includes(key)
  }

  /** Build the part files for one selection; keys are re-checked against this install. */
  async function collect(selection, options = {}) {
    const parts = new Map(), files = new Map(), used = new Set()
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null
    let finishedItems = 0
    let totalItems = 0
    for (const def of PART_DEFS) {
      if (!def.supported) continue
      const keys = selected(selection, def.kind)
      if (!keys.length) continue
      if (!keys.includes('*')) totalItems += new Set(keys).size
    }
    function report(kind, label, stage, itemTitle = '') {
      if (!onProgress) return
      try {
        onProgress({
          stage,
          kind,
          label,
          itemTitle: str(itemTitle),
          items: finishedItems,
          total: Math.max(totalItems, finishedItems)
        })
      } catch (_error) { /* 进度上报失败不影响导出本身 */ }
    }
    function ensureWildcardTotal(keys, count) {
      if (keys.includes('*') && count > 0) totalItems += count
    }
    async function collectSubItems(kind, label, keys, run) {
      report(kind, label, 'start')
      let reportedDone = 0
      const exports = await run(step => {
        if (step && step.phase === 'done') {
          reportedDone += 1
          finishedItems += 1
        }
        report(kind, label, 'item', step && step.title)
      })
      if (keys.includes('*')) totalItems += Math.max(reportedDone, exports.length)
      if (reportedDone === 0) {
        const stepCount = keys.includes('*') ? exports.length : new Set(keys).size
        finishedItems += stepCount
        report(kind, label, 'item', exports.length ? exports[exports.length - 1].title : '')
      } else if (!keys.includes('*')) {
        const expected = new Set(keys).size
        if (reportedDone < expected) finishedItems += expected - reportedDone
      }
      return exports
    }
    function add(kind, label, item, fileName, content) {
      const entry = uniqueEntry(used, 'parts/' + kind + '/' + fileName)
      const stored = transferItem({ key: item.key, title: item.title, entry, content })
      let part = parts.get(kind)
      if (!part) { part = { kind, label, items: [] }; parts.set(kind, part) }
      part.items.push(stored)
      files.set(entry, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'))
    }

    const cardKeys = selected(selection, 'cards')
    if (cardKeys.length) {
      report('cards', '人物卡', 'start')
      const matchedCards = (await fileResources.list('card')).filter(cardPath => wanted(selection, 'cards', cardPath))
      ensureWildcardTotal(cardKeys, matchedCards.length)
      for (const cardPath of matchedCards) {
        report('cards', '人物卡', 'item', stemOf(cardPath))
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) { finishedItems += 1; continue }
        const characterBook = await worldBooks.characterBookForCard(cardPath).catch(() => null)
        const document = cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook })
        const title = str(document.name) || stemOf(cardPath)
        add('cards', '人物卡', { key: cardPath, title }, safeTransferFileName(stemOf(cardPath), 'card') + '.json',
          JSON.stringify(document, null, 2) + '\n')
        finishedItems += 1
        report('cards', '人物卡', 'item', title)
      }
      if (!cardKeys.includes('*')) {
        const expected = new Set(cardKeys).size
        if (matchedCards.length < expected) finishedItems += expected - matchedCards.length
      }
    }

    const worldBookKeys = selected(selection, 'worldbooks')
    if (worldBookKeys.length) {
      report('worldbooks', '世界书', 'start')
      const matchedBooks = (await worldBooks.catalog()).standalone.filter(row => wanted(selection, 'worldbooks', row.path))
      ensureWildcardTotal(worldBookKeys, matchedBooks.length)
      for (const row of matchedBooks) {
        report('worldbooks', '世界书', 'item', row.name || stemOf(row.path))
        const book = await worldBooks.export({ kind: 'standalone', path: row.path })
        const title = book.name || row.name
        add('worldbooks', '世界书', { key: row.path, title }, safeTransferFileName(stemOf(row.path)) + '.json',
          JSON.stringify(book.document, null, 2) + '\n')
        finishedItems += 1
        report('worldbooks', '世界书', 'item', title)
      }
      if (!worldBookKeys.includes('*')) {
        const expected = new Set(worldBookKeys).size
        if (matchedBooks.length < expected) finishedItems += expected - matchedBooks.length
      }
    }

    const presetKeys = selected(selection, 'presets')
    if (presetKeys.length) {
      report('presets', '预设', 'start')
      const matchedPresets = (await presetLibrary.catalog()).presets.filter(row => wanted(selection, 'presets', row.path))
      ensureWildcardTotal(presetKeys, matchedPresets.length)
      for (const row of matchedPresets) {
        const title = row.title || stemOf(row.path)
        report('presets', '预设', 'item', title)
        const preset = await presetLibrary.export(row.path)
        add('presets', '预设', { key: row.path, title },
          safeTransferFileName(str(preset.name).replace(/\.json$/i, '')) + '.json', preset.text)
        finishedItems += 1
        report('presets', '预设', 'item', title)
      }
      if (!presetKeys.includes('*')) {
        const expected = new Set(presetKeys).size
        if (matchedPresets.length < expected) finishedItems += expected - matchedPresets.length
      }
    }

    if (wanted(selection, 'prompts', 'current')) {
      ensureWildcardTotal(selected(selection, 'prompts'), 1)
      report('prompts', '系统提示词', 'start')
      const document = await promptDocument()
      add('prompts', '系统提示词', { key: 'current', title: document.name }, 'system-prompts.json', JSON.stringify(document, null, 2) + '\n')
      finishedItems += 1
      report('prompts', '系统提示词', 'item', document.name)
    }

    const profileKeys = selected(selection, 'profile')
    if (profileKeys.length) {
      report('profile', '长期偏好', 'start')
      const library = await userPreferenceProfile.read()
      const matchedProfiles = (library.profiles || []).filter(row => wanted(selection, 'profile', row.id))
      ensureWildcardTotal(profileKeys, matchedProfiles.length)
      const profiles = []
      for (const row of matchedProfiles) {
        report('profile', '长期偏好', 'item', row.name)
        const profile = await userPreferenceProfile.read(row.id)
        finishedItems += 1
        if (!profile.confirmed || !str(profile.confirmed.injectionText).trim()) continue
        profiles.push({ name: profile.name || row.name, summary: str(profile.confirmed.summary), injectionText: str(profile.confirmed.injectionText) })
        report('profile', '长期偏好', 'item', profile.name || row.name)
      }
      if (profiles.length) add('profile', '长期偏好', { key: 'profiles', title: '长期偏好 ' + profiles.length + ' 份' }, 'user-profiles.json',
        JSON.stringify({ spec: 'dsh-tavern.transfer.user-profiles', version: 1, profiles }, null, 2) + '\n')
    }

    const regexKeys = selected(selection, 'regex')
    if (regexKeys.length) {
      report('regex', '正则库', 'start')
      const state = await regexManager.read('')
      const scripts = (state.global || []).filter(function (entry) { return wanted(selection, 'regex', entry.id) })
        .map(function (entry) {
          return { id: entry.id, scriptName: entry.name, findRegex: entry.findRegex, replaceString: entry.replaceString,
            trimStrings: entry.trimStrings || [], placement: entry.placement || [], disabled: entry.enabled !== true,
            markdownOnly: entry.markdownOnly === true, promptOnly: entry.promptOnly === true, runOnEdit: entry.runOnEdit === true,
            minDepth: entry.minDepth === undefined ? null : entry.minDepth, maxDepth: entry.maxDepth === undefined ? null : entry.maxDepth }
        })
      ensureWildcardTotal(regexKeys, scripts.length)
      if (scripts.length) add('regex', '正则库', { key: 'global', title: scripts.length + ' 条正则' }, 'regex-library.json',
        JSON.stringify(scripts, null, 2) + '\n')
      finishedItems += regexKeys.includes('*') ? scripts.length : new Set(regexKeys).size
      report('regex', '正则库', 'item', scripts.length ? scripts.length + ' 条正则' : '')
    }

    const chatKeys = selected(selection, 'chats')
    if (chats && chatKeys.length) {
      // 同一个包里已经带上世界书时，局里的开局世界书副本就是重复：每局各存一份整本 JSON，
      // 11 局能占掉几十兆。导入后这局跟随刚装回来的那本书（卡绑定的世界书）。
      const embedWorldbook = selected(selection, 'worldbooks').length === 0
      const embedPreset = selected(selection, 'presets').length === 0
      const exports = await collectSubItems('chats', '对话与存档', chatKeys, onItem =>
        chats.collect(chatKeys, { images: options.images !== false, embedWorldbook, embedPreset, ...(onProgress ? { onItem } : {}) })
      )
      for (const item of exports) add('chats', '对话与存档', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'game.dshsave'), item.content)
    }

    const memoryKeys = selected(selection, 'memory')
    if (memory && memoryKeys.length) {
      const exports = await collectSubItems('memory', '游玩记忆', memoryKeys, () => memory.collect(memoryKeys))
      for (const item of exports) add('memory', '游玩记忆', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'recalls.json'), item.content)
    }

    const fontKeys = selected(selection, 'fonts')
    if (fonts && fontKeys.length) {
      const exports = await collectSubItems('fonts', '字体', fontKeys, () => fonts.collect(fontKeys))
      for (const item of exports) add('fonts', '字体', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'font.zip'), item.content)
    }

    const assetKeys = selected(selection, 'assets')
    if (assets && assetKeys.length) {
      const exports = await collectSubItems('assets', '素材包与皮肤', assetKeys, onItem =>
        assets.collect(assetKeys, onProgress ? { onItem } : undefined)
      )
      for (const item of exports) add('assets', '素材包与皮肤', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'asset-pack.zip'), item.content)
    }

    const logKeys = selected(selection, 'logs')
    if (logs && logKeys.length) {
      const exports = await collectSubItems('logs', '诊断日志', logKeys, onItem =>
        logs.collect(logKeys, onProgress ? { onItem } : undefined)
      )
      for (const item of exports) add('logs', '诊断日志', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'logs.zip'), item.content)
    }

    const pluginDataKeys = selected(selection, 'plugin-data')
    if (pluginData && pluginDataKeys.length) {
      const exports = await collectSubItems('plugin-data', '插件数据', pluginDataKeys, () => pluginData.collect(pluginDataKeys))
      for (const item of exports) add('plugin-data', '插件数据', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'plugin-data.json'), item.content)
    }

    const skillKeys = selected(selection, 'skills')
    if (skills && skillKeys.length) {
      const exports = await collectSubItems('skills', '写作 Skill', skillKeys, () => skills.collect(skillKeys))
      for (const item of exports) add('skills', '写作 Skill', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'skill.zip'), item.content)
    }

    const scriptKeys = selected(selection, 'scripts')
    if (materials && scriptKeys.length) {
      const exports = await collectSubItems('scripts', '剧本', scriptKeys, () => materials.collect(scriptKeys))
      for (const item of exports) add('scripts', '剧本', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'material.txt'), item.content)
    }

    const pluginKeys = selected(selection, 'plugins')
    if (plugins && pluginKeys.length) {
      const exports = await collectSubItems('plugins', '插件', pluginKeys, () => plugins.collect(pluginKeys))
      for (const item of exports) add('plugins', '插件', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'plugin.zip'), item.content)
    }

    if (wanted(selection, 'settings', 'current')) {
      ensureWildcardTotal(selected(selection, 'settings'), 1)
      report('settings', '酒馆设置', 'start')
      add('settings', '酒馆设置', { key: 'current', title: '酒馆设置' }, 'tavern-settings.json', JSON.stringify(await settingsDocument(), null, 2) + '\n')
      finishedItems += 1
      report('settings', '酒馆设置', 'item', '酒馆设置')
    }

    return { parts: [...parts.values()], files }
  }

  return Object.freeze({ listParts, collect, settingsDocument })
}
