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
  'polishPrereview', 'storyInputToolCall', 'storyOutputToolCall', 'autoOpenStatusPanel',
  'contextCompaction', 'defaultPlaySettings'
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
  { kind: 'scripts', group: 'ext', label: '剧本与素材', unit: '个', supported: true, note: '导入的参考资料原样带走；同名导入会加序号' },
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
    const items = []
    for (const cardPath of await fileResources.list('card').catch(() => [])) {
      let title = stemOf(cardPath)
      const text = await fileResources.readText(cardPath).catch(() => undefined)
      if (text !== undefined) {
        try { const value = JSON.parse(text); title = str(value && value.name) || title } catch { /* keep the file name */ }
      }
      items.push({ key: cardPath, title, meta: cardPath, bytes: await sizeOf(cardPath) })
    }
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
    const parts = []
    for (const def of PART_DEFS) {
      // 依赖没接上（测试或裁剪过的宿主）时按「本机没有」处理，不去调用不存在的列表。
      if (!def.supported || typeof LISTS[def.kind] !== 'function') {
        parts.push(Object.assign({}, def, { items: [], bytes: 0 }))
        continue
      }
      let items = []
      try { items = await LISTS[def.kind]() } catch (error) { console.warn('dsh-tavern: 读取导出板块失败', def.kind, str(error && error.message || error)) }
      parts.push(Object.assign({}, def, { items, bytes: items.reduce(function (sum, item) { return sum + item.bytes }, 0) }))
    }
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
    function add(kind, label, item, fileName, content) {
      const entry = uniqueEntry(used, 'parts/' + kind + '/' + fileName)
      const stored = transferItem({ key: item.key, title: item.title, entry, content })
      let part = parts.get(kind)
      if (!part) { part = { kind, label, items: [] }; parts.set(kind, part) }
      part.items.push(stored)
      files.set(entry, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'))
    }

    if (selected(selection, 'cards').length) {
      for (const cardPath of await fileResources.list('card')) {
        if (!wanted(selection, 'cards', cardPath)) continue
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) continue
        const characterBook = await worldBooks.characterBookForCard(cardPath).catch(() => null)
        const document = cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook })
        const title = str(document.name) || stemOf(cardPath)
        add('cards', '人物卡', { key: cardPath, title }, safeTransferFileName(stemOf(cardPath), 'card') + '.json',
          JSON.stringify(document, null, 2) + '\n')
      }
    }

    if (selected(selection, 'worldbooks').length) {
      for (const row of (await worldBooks.catalog()).standalone) {
        if (!wanted(selection, 'worldbooks', row.path)) continue
        const book = await worldBooks.export({ kind: 'standalone', path: row.path })
        add('worldbooks', '世界书', { key: row.path, title: book.name || row.name }, safeTransferFileName(stemOf(row.path)) + '.json',
          JSON.stringify(book.document, null, 2) + '\n')
      }
    }

    if (selected(selection, 'presets').length) {
      for (const row of (await presetLibrary.catalog()).presets) {
        if (!wanted(selection, 'presets', row.path)) continue
        const preset = await presetLibrary.export(row.path)
        add('presets', '预设', { key: row.path, title: row.title || stemOf(row.path) },
          safeTransferFileName(str(preset.name).replace(/\.json$/i, '')) + '.json', preset.text)
      }
    }

    if (wanted(selection, 'prompts', 'current')) {
      const document = await promptDocument()
      add('prompts', '系统提示词', { key: 'current', title: document.name }, 'system-prompts.json', JSON.stringify(document, null, 2) + '\n')
    }

    if (selected(selection, 'profile').length) {
      const library = await userPreferenceProfile.read()
      const profiles = []
      for (const row of library.profiles || []) {
        if (!wanted(selection, 'profile', row.id)) continue
        const profile = await userPreferenceProfile.read(row.id)
        if (!profile.confirmed || !str(profile.confirmed.injectionText).trim()) continue
        profiles.push({ name: profile.name || row.name, summary: str(profile.confirmed.summary), injectionText: str(profile.confirmed.injectionText) })
      }
      if (profiles.length) add('profile', '长期偏好', { key: 'profiles', title: '长期偏好 ' + profiles.length + ' 份' }, 'user-profiles.json',
        JSON.stringify({ spec: 'dsh-tavern.transfer.user-profiles', version: 1, profiles }, null, 2) + '\n')
    }

    if (selected(selection, 'regex').length) {
      const state = await regexManager.read('')
      const scripts = (state.global || []).filter(function (entry) { return wanted(selection, 'regex', entry.id) })
        .map(function (entry) {
          return { id: entry.id, scriptName: entry.name, findRegex: entry.findRegex, replaceString: entry.replaceString,
            trimStrings: entry.trimStrings || [], placement: entry.placement || [], disabled: entry.enabled !== true,
            markdownOnly: entry.markdownOnly === true, promptOnly: entry.promptOnly === true, runOnEdit: entry.runOnEdit === true,
            minDepth: entry.minDepth === undefined ? null : entry.minDepth, maxDepth: entry.maxDepth === undefined ? null : entry.maxDepth }
        })
      if (scripts.length) add('regex', '正则库', { key: 'global', title: scripts.length + ' 条正则' }, 'regex-library.json',
        JSON.stringify(scripts, null, 2) + '\n')
    }

    if (chats && selected(selection, 'chats').length) {
      // 同一个包里已经带上世界书时，局里的开局世界书副本就是重复：每局各存一份整本 JSON，
      // 11 局能占掉几十兆。导入后这局跟随刚装回来的那本书（卡绑定的世界书）。
      const embedWorldbook = selected(selection, 'worldbooks').length === 0
      const embedPreset = selected(selection, 'presets').length === 0
      const exports = await chats.collect(selected(selection, 'chats'), { images: options.images !== false, embedWorldbook, embedPreset })
      for (const item of exports) add('chats', '对话与存档', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'game.dshsave'), item.content)
    }

    if (memory && selected(selection, 'memory').length) {
      const exports = await memory.collect(selected(selection, 'memory'))
      for (const item of exports) add('memory', '游玩记忆', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'recalls.json'), item.content)
    }

    if (fonts && selected(selection, 'fonts').length) {
      const exports = await fonts.collect(selected(selection, 'fonts'))
      for (const item of exports) add('fonts', '字体', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'font.zip'), item.content)
    }

    if (assets && selected(selection, 'assets').length) {
      const exports = await assets.collect(selected(selection, 'assets'))
      for (const item of exports) add('assets', '素材包与皮肤', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'asset-pack.zip'), item.content)
    }

    if (logs && selected(selection, 'logs').length) {
      const exports = await logs.collect(selected(selection, 'logs'))
      for (const item of exports) add('logs', '诊断日志', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'logs.zip'), item.content)
    }

    if (pluginData && selected(selection, 'plugin-data').length) {
      const exports = await pluginData.collect(selected(selection, 'plugin-data'))
      for (const item of exports) add('plugin-data', '插件数据', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'plugin-data.json'), item.content)
    }

    if (skills && selected(selection, 'skills').length) {
      const exports = await skills.collect(selected(selection, 'skills'))
      for (const item of exports) add('skills', '写作 Skill', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'skill.zip'), item.content)
    }

    if (materials && selected(selection, 'scripts').length) {
      const exports = await materials.collect(selected(selection, 'scripts'))
      for (const item of exports) add('scripts', '剧本与素材', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'material.txt'), item.content)
    }

    if (plugins && selected(selection, 'plugins').length) {
      const exports = await plugins.collect(selected(selection, 'plugins'))
      for (const item of exports) add('plugins', '插件', { key: item.key, title: item.title }, safeTransferFileName(item.fileName, 'plugin.zip'), item.content)
    }

    if (wanted(selection, 'settings', 'current')) {
      add('settings', '酒馆设置', { key: 'current', title: '酒馆设置' }, 'tavern-settings.json', JSON.stringify(await settingsDocument(), null, 2) + '\n')
    }

    return { parts: [...parts.values()], files }
  }

  return Object.freeze({ listParts, collect, settingsDocument })
}
