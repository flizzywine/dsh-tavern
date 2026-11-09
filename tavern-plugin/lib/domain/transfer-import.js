import { createHash } from 'node:crypto'
import path from 'node:path'
import { cardNameFromText, inspectSillyTavernChatItem, isSillyTavernChatItem } from './transfer-chats.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function stemOf(value) {
  return path.posix.basename(str(value), path.posix.extname(str(value))) || '未命名'
}

const IMPORTABLE = Object.freeze(['cards', 'worldbooks', 'presets', 'prompts', 'profile', 'regex', 'settings', 'chats', 'plugins', 'scripts', 'fonts', 'plugin-data', 'skills', 'assets', 'memory'])
// Only these kinds can be compared by content after import; prompts/regex have no local twin.
const DEDUPE_KINDS = Object.freeze(['cards', 'worldbooks', 'presets', 'scripts'])
const SETTINGS_PART = 'settings'

/** A name that does not collide: 名字, 名字 (2), 名字 (3), … */
function uniqueName(taken, base, limit = 60) {
  const key = value => String(value).toLowerCase()
  if (!taken.has(key(base))) return base
  for (let index = 2; index < limit; index += 1) {
    const candidate = base + ' (' + index + ')'
    if (!taken.has(key(candidate))) return candidate
  }
  return base + ' (' + Date.now() + ')'
}

function errorText(error) {
  return str(error && (error.message || error)).slice(0, 300) || '未知错误'
}

/**
 * Import a `.dshtransfer` bundle: preview shows what would happen, apply writes it.
 * Defaults are additive — a same-named card/world book/preset/profile is added as a copy, never
 * overwritten. The one singleton, settings, merges whitelisted fields after a backup.
 */
export function createTransferImport(deps) {
  const { fileResources, worldBooks, presetLibrary, promptDocuments, userPreferenceProfile, regexManager,
    readTavernSettings, updateTavernSettings, importCard, importPreset, backup, chats, plugins, materials, fonts, pluginData, skills,
    removeCreated, readSettingsDocument, assets, memory } = deps

  async function cardIndex() {
    const names = new Set(), stems = new Set(), byName = new Map(), byStem = new Map()
    for (const cardPath of await fileResources.list('card').catch(() => [])) {
      const stem = stemOf(cardPath)
      stems.add(stem)
      if (!byStem.has(stem.toLowerCase())) byStem.set(stem.toLowerCase(), cardPath)
      const text = await fileResources.readText(cardPath).catch(() => undefined)
      if (text === undefined) continue
      const name = cardNameFromText(text)
      if (name) {
        names.add(name)
        if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), cardPath)
      }
    }
    return { names, stems, byName, byStem }
  }

  // Cards carry per-import ids and timestamps in meta/raw; compare only what a reader would call
  // the card's content, so re-importing the same card is recognised as the same card.
  const CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags', 'creator', 'character_version']
  function cardFingerprint(text) {
    const document = JSON.parse(text)
    const data = document && (document.data || (document.raw && document.raw.data) || document)
    const picked = {}
    for (const field of CARD_FIELDS) {
      const value = data && data[field]
      // An absent field and an empty one mean the same thing to a reader.
      if (value === undefined || value === null || value === '') continue
      picked[field] = value
    }
    return JSON.stringify(picked)
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().filter(function (key) { return value[key] !== undefined }).map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key])
      }).join(',') + '}'
    }
    return JSON.stringify(value === undefined ? null : value)
  }

  function fingerprintOf(value) {
    return createHash('sha256').update(stableStringify(value)).digest('hex')
  }

  const trimmedOverrides = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .filter(function (entry) { return typeof entry[1] === 'string' && entry[1].trim() !== '' })
    .map(function (entry) { return [entry[0], entry[1].trim()] }))

  const regexBody = entry => ({
    findRegex: str(entry && entry.findRegex), replaceString: str(entry && entry.replaceString),
    trimStrings: Array.isArray(entry && entry.trimStrings) ? entry.trimStrings : [],
    placement: Array.isArray(entry && entry.placement) ? entry.placement : [],
    markdownOnly: entry && entry.markdownOnly === true, promptOnly: entry && entry.promptOnly === true,
    runOnEdit: entry && entry.runOnEdit === true,
    minDepth: entry && entry.minDepth === undefined ? null : entry.minDepth,
    maxDepth: entry && entry.maxDepth === undefined ? null : entry.maxDepth
  })

  function contentHashOf(kind, text) {
    if (kind === 'cards') {
      try { return createHash('sha256').update(cardFingerprint(text)).digest('hex') } catch { return createHash('sha256').update(text).digest('hex') }
    }
    return createHash('sha256').update(text).digest('hex')
  }

  // What is already here, by content: importing the same package twice must not double the library.
  async function contentIndex() {
    const kinds = { cards: 'card', worldbooks: 'worldbook', presets: 'preset', scripts: 'source' }
    const index = new Map()
    for (const [kind, listKind] of Object.entries(kinds)) {
      const hashes = new Set()
      for (const path of await fileResources.list(listKind).catch(() => [])) {
        const text = await fileResources.readText(path).catch(() => undefined)
        if (typeof text === 'string') hashes.add(contentHashOf(kind, text))
      }
      index.set(kind, hashes)
    }

    const promptHashes = new Set()
    if (readSettingsDocument) {
      const raw = await readSettingsDocument().catch(() => null)
      const sets = raw && Array.isArray(raw.promptSets) && raw.promptSets.length ? raw.promptSets : [{ id: 'default' }]
      const activeId = raw && typeof raw.activePromptSetId === 'string' && sets.some(set => set.id === raw.activePromptSetId) ? raw.activePromptSetId : sets[0].id
      for (const set of sets) {
        const active = set.id === activeId
        promptHashes.add(fingerprintOf({
          overrides: trimmedOverrides(active ? (raw && raw.promptOverrides) : set.promptOverrides),
          append: active ? Boolean(raw && raw.systemAppendEnabled !== false) : set.systemAppendEnabled !== false
        }))
      }
    }
    index.set('prompts', promptHashes)

    const profileHashes = new Set()
    const library = await userPreferenceProfile.read().catch(() => ({ profiles: [] }))
    for (const row of library.profiles || []) {
      const profile = await userPreferenceProfile.read(row.id).catch(() => null)
      if (profile && profile.confirmed) {
        profileHashes.add(fingerprintOf({ summary: str(profile.confirmed.summary), injectionText: str(profile.confirmed.injectionText) }))
      }
    }
    index.set('profile', profileHashes)

    const chatHashes = new Set()
    if (chats && typeof chats.importedHashes === 'function') {
      for (const hash of await chats.importedHashes().catch(() => new Set())) chatHashes.add(hash)
    }
    index.set('chats', chatHashes)

    const regexHashes = new Set()
    const regexState = await regexManager.read('').catch(() => ({ global: [] }))
    for (const row of regexState.global || []) regexHashes.add(fingerprintOf(regexBody(row)))
    index.set('regex', regexHashes)

    return index
  }

  async function existingIndex() {
    const [cards, worlds, presets, profiles] = await Promise.all([
      cardIndex(),
      worldBooks.catalog().then(catalog => catalog.standalone).catch(() => []),
      presetLibrary.catalog().then(catalog => catalog.presets).catch(() => []),
      userPreferenceProfile.read().then(library => library.profiles || []).catch(() => [])
    ])
    const regex = await regexManager.read('').catch(() => ({ global: [] }))
    const pluginFolders = plugins ? new Set((await plugins.list().catch(() => [])).map(row => str(row.key).toLowerCase())) : new Set()
    const settings = readTavernSettings()
    const materialNames = new Set()
    if (materials) for (const row of await materials.list().catch(() => [])) materialNames.add(str(row.title).toLowerCase())
    const fontIds = new Set()
    if (fonts) for (const row of await fonts.list().catch(() => [])) fontIds.add(str(row.key).toLowerCase())
    const pluginDataNames = new Set()
    if (pluginData) for (const row of await pluginData.list().catch(() => [])) pluginDataNames.add(str(row.key).toLowerCase())
    const skillNames = new Set()
    if (skills) for (const row of await skills.list().catch(() => [])) skillNames.add(str(row.key).toLowerCase())
    const assetNames = new Set()
    if (assets) for (const row of await assets.list().catch(() => [])) assetNames.add(str(row.title).toLowerCase())
    return {
      cardNames: new Set([...cards.names].map(value => value.toLowerCase())),
      cardStems: new Set([...cards.stems].map(value => value.toLowerCase())),
      cardPathsByName: new Map([...cards.byStem, ...cards.byName]),
      worldNames: new Set(worlds.map(row => str(row.name || stemOf(row.path)).toLowerCase())),
      worldStems: new Set(worlds.map(row => stemOf(row.path).toLowerCase())),
      presetNames: new Set(presets.map(row => str(row.title || stemOf(row.path)).toLowerCase())),
      presetStems: new Set(presets.map(row => stemOf(row.path).toLowerCase())),
      promptNames: new Set((((settings.promptSets || {}).sets) || []).map(row => str(row.name).toLowerCase())),
      profileNames: new Set(profiles.map(row => str(row.name).toLowerCase())),
      regexIds: new Set((regex.global || []).map(row => str(row.id))),
      pluginFolders,
      materialNames,
      fontIds,
      pluginDataNames,
      skillNames,
      assetNames
    }
  }

  function itemConflict(index, kind, item) {
    const title = str(item.title).toLowerCase()
    const stem = stemOf(item.entry).toLowerCase()
    if (kind === 'cards') return index.cardNames.has(title) || index.cardStems.has(stem) ? '本机已有同名人物卡，会加「导入」副本' : ''
    if (kind === 'worldbooks') return index.worldNames.has(title) || index.worldStems.has(stem) ? '本机已有同名世界书，会加「导入」副本' : ''
    if (kind === 'presets') return index.presetNames.has(title) || index.presetStems.has(stem) ? '本机已有同名预设，会加「导入」副本' : ''
    if (kind === 'prompts') return index.promptNames.has(title) ? '本机已有同名方案，会加新方案' : ''
    if (kind === 'profile') return index.profileNames.has(title) ? '本机已有同名长期偏好，会加新的一份' : ''
    if (kind === 'regex') return index.regexIds.has(str(item.key)) ? '同编号的正则已存在，会换新编号' : ''
    if (kind === 'chats') return ''
    if (kind === 'plugins') return index.pluginFolders.has(stemOf(item.entry).toLowerCase()) ? '同文件夹的插件已存在，会加序号' : ''
    if (kind === 'scripts') return index.materialNames.has(title) ? '同名素材已存在，会加序号' : ''
    if (kind === 'fonts') return index.fontIds.has(str(item.key).toLowerCase()) ? '同 id 的字体已存在，会加序号' : ''
    if (kind === 'plugin-data') return index.pluginDataNames.has(str(item.key).toLowerCase()) ? '同名插件数据会被覆盖（凭据字段已移除）' : ''
    if (kind === 'skills') return index.skillNames.has(title) ? '同名 Skill 已存在，会加序号' : ''
    if (kind === 'assets') return index.assetNames.has(title) ? '同名素材包已存在，会以新编号导入' : ''
    if (kind === 'settings') return '按白名单字段合并；写入前备份当前设置'
    return ''
  }

  async function preview(manifest, files = new Map()) {
    const index = await existingIndex()
    const contents = await contentIndex()
    const dedupeKinds = new Set(DEDUPE_KINDS)
    // 一局的召回记录没有地方可去，除非同一个包也带着那一局的存档。
    const chatKeys = new Set(manifest.parts.filter(function (part) { return part.kind === 'chats' })
      .flatMap(function (part) { return part.items.map(function (item) { return str(item.key) }) }))
    // 同包附带的人物卡名称集合，供 SillyTavern .jsonl 聊天记录在预览阶段配对角色。
    const bundleCardNames = new Set()
    for (const part of manifest.parts) {
      if (part.kind !== 'cards') continue
      for (const item of part.items || []) {
        const usable = item.usable !== false && (files.size === 0 || files.has(item.entry))
        if (!usable) continue
        if (str(item.title).trim()) bundleCardNames.add(str(item.title).trim().toLowerCase())
        bundleCardNames.add(stemOf(item.entry).toLowerCase())
        const packedCard = files.get(item.entry)
        if (packedCard) {
          const parsedName = cardNameFromText(packedCard.toString('utf8'))
          if (parsedName) bundleCardNames.add(parsedName.toLowerCase())
        }
      }
    }
    const parts = manifest.parts.map(function (part) {
      if (!IMPORTABLE.includes(part.kind)) {
        return { kind: part.kind, label: part.label, importable: false, conflicts: 0, selectable: 0,
          note: part.kind === 'logs' ? '诊断日志只导出，不导入' : '下一版支持，这次不会导入', items: part.items.map(function (item) {
            return { key: item.key, title: item.title, bytes: item.bytes, usable: false, conflict: false, duplicate: false, reason: '不导入' }
          }) }
      }
      const items = part.items.map(function (item) {
        const usable = item.usable !== false && (files.size === 0 || files.has(item.entry))
        if (!usable) return { key: item.key, title: item.title, bytes: item.bytes, usable: false, conflict: false, duplicate: false, reason: '包内文件损坏或缺失，已跳过' }
        if (part.kind === 'memory' && !chatKeys.has(str(item.key)))
          return { key: item.key, title: item.title, bytes: item.bytes, usable: false, conflict: false, duplicate: false, reason: '包里没有这一局的存档，导入无处可并' }
        const conflictReason = itemConflict(index, part.kind, item)
        let duplicate = false, reason = conflictReason
        const packed = files.get(item.entry)
        if (packed && part.kind === 'chats' && isSillyTavernChatItem(item.entry, packed)) {
          let inspected
          try {
            inspected = inspectSillyTavernChatItem(packed)
          } catch (error) {
            return { key: item.key, title: item.title, bytes: item.bytes, usable: false, conflict: false, duplicate: false, reason: '聊天记录无效：' + errorText(error) }
          }
          const charKey = str(inspected.characterName).toLowerCase()
          const hasCard = Boolean(charKey) && (index.cardNames.has(charKey) || index.cardStems.has(charKey) || bundleCardNames.has(charKey))
          if (!hasCard) {
            return {
              key: item.key,
              title: item.title,
              bytes: item.bytes,
              usable: false,
              conflict: false,
              duplicate: false,
              reason: '缺少人物卡「' + (inspected.characterName || '未知角色') + '」，请先导入人物卡或在迁移包中附带该人物卡'
            }
          }
          const hash = createHash('sha256').update(packed).digest('hex')
          if (contents && contents.get('chats') && (contents.get('chats').has(hash) || (inspected.digest && contents.get('chats').has(inspected.digest)))) {
            duplicate = true
            reason = '本机已有相同内容的对话记录，默认不导入'
          }
          return { key: item.key, title: item.title, bytes: item.bytes, usable: true, conflict: false, duplicate, reason }
        }
        if (contents && packed && part.kind === 'chats') {
          const hash = createHash('sha256').update(packed).digest('hex')
          if (contents.get('chats') && contents.get('chats').has(hash)) {
            duplicate = true
            reason = '本机已有相同内容的存档，默认不导入'
          }
        }
        if (contents && packed && dedupeKinds.has(part.kind)) {
          const text = packed.toString('utf8')
          if (contents.get(part.kind).has(contentHashOf(part.kind, text))) {
            duplicate = true
            reason = '本机已有相同内容，默认不导入'
          }
        }
        return { key: item.key, title: item.title, bytes: item.bytes, usable: true, conflict: conflictReason !== '', duplicate, reason }
      })
      return { kind: part.kind, label: part.label, importable: true,
        conflicts: items.filter(function (item) { return item.conflict }).length,
        selectable: items.filter(function (item) { return item.usable && !item.duplicate }).length,
        overwriteAllowed: part.kind === SETTINGS_PART || part.kind === 'plugin-data', items }
    })
    return {
      parts,
      canApply: parts.some(function (part) { return part.importable && part.selectable > 0 }),
      totals: { items: parts.reduce(function (sum, part) { return sum + part.items.length }, 0),
        selectable: parts.reduce(function (sum, part) { return sum + part.selectable }, 0),
        conflicts: parts.reduce(function (sum, part) { return sum + part.conflicts }, 0) }
    }
  }

  async function apply({ manifest, files, policies = {}, selection = null, onProgress = null }) {
    const index = await existingIndex()
    const contents = await contentIndex()
    const dedupe = new Set(DEDUPE_KINDS)
    // 这一趟已经处理过的内容，用来挡住同一个包里重复的条目。
    const handled = new Set()
    const cardPathsByCharacter = new Map(index.cardPathsByName || [])
    const used = {
      cardStems: new Set(index.cardStems), worldStems: new Set(index.worldStems), presetStems: new Set(index.presetStems),
      promptNames: new Set(index.promptNames), profileNames: new Set(index.profileNames),
      pluginFolders: new Set(index.pluginFolders), materialNames: new Set(index.materialNames), fontIds: new Set(index.fontIds),
      pluginDataNames: new Set(index.pluginDataNames), skillNames: new Set(index.skillNames),
      assetNames: new Set(index.assetNames)
    }
    async function dropDuplicate(kind, result, title, path) {
      if (typeof removeCreated !== 'function' || !contents.has(kind) || !path) return false
      const text = await fileResources.readText(path).catch(() => undefined)
      if (typeof text !== 'string') return false
      const hash = contentHashOf(kind, text)
      if (!contents.get(kind).has(hash)) return false
      await removeCreated(kind, path)
      result.added -= 1
      result.skipped += 1
      result.duplicates = (result.duplicates || []).concat(title)
      const row = (result.created || []).findIndex(entry => entry.path === path)
      if (row >= 0) result.created.splice(row, 1)
      return true
    }

    const results = []
    const resultByPart = new Map()
    for (const part of manifest.parts) {
      const result = { kind: part.kind, label: part.label, added: 0, skipped: 0, overwritten: 0, failed: [], created: [] }
      results.push(result)
      resultByPart.set(part, result)
    }
    // 人物卡、世界书与预设先落盘，以便同包的聊天记录（尤其是 SillyTavern .jsonl）能关联到人物卡；召回记忆在对话之后导入。
    const partPriority = function (kind) {
      if (kind === 'cards') return 1
      if (kind === 'worldbooks' || kind === 'presets') return 2
      if (kind === 'chats') return 4
      if (kind === 'memory') return 5
      return 3
    }
    const orderedParts = [...manifest.parts].sort(function (left, right) { return partPriority(left.kind) - partPriority(right.kind) })
    let backupPath = ''
    // 新局 id：召回记录要落进刚导入的那一局，源 chatId 只用来配对。
    const chatIdMap = new Map()

    // 进度只服务界面：慢在哪个板块、第几项，看得见就不会被当成卡死。
    const planned = (manifest.parts || []).filter(function (part) { return part && IMPORTABLE.includes(part.kind) })
    const totalItems = planned.reduce(function (sum, part) { return sum + (part.items || []).length }, 0)
    let finishedItems = 0
    const report = function (kind, label, stage) {
      if (typeof onProgress !== 'function') return
      try { onProgress({ kind, label, stage, items: finishedItems, total: totalItems }) }
      catch (_error) { /* 进度上报失败不该影响导入本身 */ }
    }

    for (const part of orderedParts) {
      const result = resultByPart.get(part)
      if (!IMPORTABLE.includes(part.kind)) { result.skipped = part.items.length; result.note = '下一版支持'; continue }
      const policy = policies[part.kind] === 'skip' ? 'skip' : 'apply'
      if (policy === 'skip') { result.skipped = part.items.length; finishedItems += part.items.length; continue }
      report(part.kind, part.label, 'start')

      const picked = selection && Array.isArray(selection[part.kind]) ? new Set(selection[part.kind]) : null
      for (const item of part.items) {
        finishedItems += 1
        report(part.kind, part.label, 'item')
        if (item.usable === false) { result.failed.push({ title: item.title, error: '包内文件损坏或缺失' }); continue }
        if (picked && !picked.has(item.key)) { result.skipped += 1; continue }
        const content = files.get(item.entry)
        if (content === undefined) { result.failed.push({ title: item.title, error: '包内缺少该文件' }); continue }
        const text = content.toString('utf8')
        // 包里的内容本机已经有了：写之前就跳过，别先落盘再删（中断在半路就会留下副本）。
        // 按内容去重只记「本机已有」，这一趟自己写出来的不算，否则 dropDuplicate 会把自己刚写的删掉。
        if (dedupe.has(part.kind) && contents.get(part.kind)) {
          const packedHash = contentHashOf(part.kind, text)
          const seenKey = part.kind + '\u0000' + packedHash
          if (contents.get(part.kind).has(packedHash) || handled.has(seenKey)) {
            result.skipped += 1
            result.duplicates = (result.duplicates || []).concat(item.title)
            continue
          }
          handled.add(seenKey)
        }
        try {
          if (part.kind === 'cards') {
            let document
            try { document = JSON.parse(text) } catch { throw new Error('人物卡不是有效的 JSON') }
            const base = stemOf(item.entry)
            const target = uniqueName(used.cardStems, base)
            const imported = await importCard({ name: target + '.json', text })
            used.cardStems.add(target.toLowerCase())
            result.added += 1
            if (imported && imported.path) {
              result.created.push({ kind: 'cards', title: item.title, path: imported.path })
              const dropped = await dropDuplicate('cards', result, item.title, imported.path)
              if (!dropped) {
                const parsedName = cardNameFromText(text)
                if (parsedName) cardPathsByCharacter.set(parsedName.toLowerCase(), imported.path)
                if (str(item.title).trim()) cardPathsByCharacter.set(str(item.title).trim().toLowerCase(), imported.path)
                cardPathsByCharacter.set(target.toLowerCase(), imported.path)
              }
            }
            continue
          }
          if (part.kind === 'worldbooks') {
            const base = stemOf(item.entry)
            const target = uniqueName(used.worldStems, base)
            const importedBook = await worldBooks.import({ name: target + '.json', text })
            used.worldStems.add(target.toLowerCase())
            result.added += 1
            if (importedBook && importedBook.path) {
              result.created.push({ kind: 'worldbooks', title: item.title, path: importedBook.path })
              await dropDuplicate('worldbooks', result, item.title, importedBook.path)
            }
            continue
          }
          if (part.kind === 'presets') {
            const base = stemOf(item.entry)
            const target = uniqueName(used.presetStems, base)
            const importedPreset = await importPreset({ name: target + '.json', text })
            used.presetStems.add(target.toLowerCase())
            result.added += 1
            if (importedPreset && importedPreset.path) {
              result.created.push({ kind: 'presets', title: item.title, path: importedPreset.path })
              await dropDuplicate('presets', result, item.title, importedPreset.path)
            }
            continue
          }
          if (part.kind === 'prompts') {
            let document
            try { document = JSON.parse(text) } catch { throw new Error('提示词文件不是有效的 JSON') }
            const patch = promptDocuments.import(document, item.title)
            const promptHash = fingerprintOf({ overrides: trimmedOverrides(patch.promptOverrides), append: patch.systemAppendEnabled !== false })
            if (contents.get('prompts').has(promptHash)) {
              result.skipped += 1
              result.duplicates = (result.duplicates || []).concat(item.title)
              continue
            }
            contents.get('prompts').add(promptHash)
            const name = uniqueName(used.promptNames, patch.name || item.title)
            patch.name = name
            await updateTavernSettings({ promptSet: patch })
            used.promptNames.add(name.toLowerCase())
            result.added += 1
            continue
          }
          if (part.kind === 'profile') {
            let document
            try { document = JSON.parse(text) } catch { throw new Error('长期偏好文件不是有效的 JSON') }
            const list = Array.isArray(document && document.profiles) ? document.profiles : []
            if (!list.length) throw new Error('包里没有可导入的长期偏好')
            for (const row of list) {
              const name = uniqueName(used.profileNames, str(row.name) || '导入的长期偏好')
              const content = str(row.injectionText).trim()
              if (!content) { result.failed.push({ title: name, error: '正文为空' }); continue }
              const profileHash = fingerprintOf({ summary: str(row.summary), injectionText: content })
              if (contents.get('profile').has(profileHash)) {
                result.skipped += 1
                result.duplicates = (result.duplicates || []).concat(name)
                continue
              }
              contents.get('profile').add(profileHash)
              await userPreferenceProfile.manage({ action: 'create', name, content, summary: str(row.summary) })
              used.profileNames.add(name.toLowerCase())
              result.added += 1
            }
            continue
          }
          if (part.kind === 'regex') {
            let scripts
            try { scripts = JSON.parse(text) } catch { throw new Error('正则文件不是有效的 JSON') }
            if (!Array.isArray(scripts) || !scripts.length) throw new Error('包里没有正则')
            const fresh = scripts.filter(function (script) {
              const hash = fingerprintOf(regexBody(script))
              if (contents.get('regex').has(hash)) {
                result.skipped += 1
                result.duplicates = (result.duplicates || []).concat(str(script && (script.scriptName || script.name)) || item.title)
                return false
              }
              contents.get('regex').add(hash)
              return true
            })
            if (!fresh.length) continue
            const imported = await regexManager.importGlobal({ text: JSON.stringify(fresh), fileName: item.title })
            result.added += Number(imported.imported) || 0
            continue
          }
          if (part.kind === 'plugin-data') {
            if (!pluginData) throw new Error('插件数据导入不可用')
            const imported = await pluginData.importOne({ key: item.key, title: item.title, content })
            used.pluginDataNames.add(str(imported.plugin).toLowerCase())
            result.overwritten += 1
            continue
          }
          if (part.kind === 'memory') {
            if (!memory) throw new Error('游玩记忆导入不可用')
            const target = chatIdMap.get(str(item.key))
            if (!target) { result.failed.push({ title: item.title, error: '同包这一局的存档没有导入，记忆无处可并' }); continue }
            const merged = await memory.importOne({ key: item.key, chatId: target.chatId, sessionId: target.sessionId, content })
            result.added += Number(merged.added) || 0
            result.skipped += Number(merged.skipped) || 0
            continue
          }
          if (part.kind === 'assets') {
            if (!assets) throw new Error('素材包导入不可用')
            const name = uniqueName(used.assetNames, str(item.title) || '导入的素材包')
            const imported = await assets.importOne({ key: item.key, name, content })
            used.assetNames.add(str(imported.name).toLowerCase())
            result.added += 1
            continue
          }
          if (part.kind === 'skills') {
            if (!skills) throw new Error('Skill 导入不可用')
            const imported = await skills.importOne({ key: item.key, content })
            used.skillNames.add(str(imported.name).toLowerCase())
            if (imported && imported.reused) { result.skipped += 1; result.duplicates = (result.duplicates || []).concat(item.title); continue }
            result.added += 1
            continue
          }
          if (part.kind === 'fonts') {
            if (!fonts) throw new Error('字体导入不可用')
            const imported = await fonts.importOne({ key: item.key, content })
            used.fontIds.add(str(imported.id).toLowerCase())
            if (imported && imported.reused) { result.skipped += 1; result.duplicates = (result.duplicates || []).concat(item.title); continue }
            result.added += 1
            continue
          }
          if (part.kind === 'scripts') {
            if (!materials) throw new Error('剧本导入不可用')
            const imported = await materials.importOne({ title: item.title, content })
            result.added += 1
            if (imported && imported.path) {
              result.created.push({ kind: 'scripts', title: item.title, path: imported.path })
              await dropDuplicate('scripts', result, item.title, imported.path)
            }
            continue
          }
          if (part.kind === 'chats') {
            if (!chats) throw new Error('对话导入不可用')
            // 「只导最新进度」：不写可回退的存档点，一局少写 7 份快照。
            const latestOnly = policies[part.kind] === 'latest'
            const saveHash = createHash('sha256').update(content).digest('hex')
            let stInspected = null
            if (isSillyTavernChatItem(item.entry, content)) {
              try { stInspected = inspectSillyTavernChatItem(content) } catch { /* importOne will report */ }
            }
            if (contents.get('chats').has(saveHash) || (stInspected && stInspected.digest && contents.get('chats').has(stInspected.digest))) {
              result.skipped += 1
              result.duplicates = (result.duplicates || []).concat(item.title)
              continue
            }
            const imported = await chats.importOne({
              title: item.title,
              entry: item.entry,
              content,
              sha256: saveHash,
              latestOnly,
              cardPathsByCharacter
            })
            contents.get('chats').add(saveHash)
            if (imported && imported.digest) contents.get('chats').add(imported.digest)
            else if (stInspected && stInspected.digest) contents.get('chats').add(stInspected.digest)
            result.added += 1
            result.chatIds = (result.chatIds || []).concat(imported.chatId ? [imported.chatId] : [])
            if (imported.chatId) chatIdMap.set(str(item.key), imported)
            continue
          }
          if (part.kind === 'plugins') {
            if (!plugins) throw new Error('插件导入不可用')
            const imported = await plugins.importOne({ key: item.key, title: item.title, content })
            used.pluginFolders.add(str(imported.folder).toLowerCase())
            if (imported && imported.reused) { result.skipped += 1; result.duplicates = (result.duplicates || []).concat(item.title); continue }
            result.added += 1
            continue
          }
          if (part.kind === 'settings') {
            let value
            try { value = JSON.parse(text) } catch { throw new Error('设置文件不是有效的 JSON') }
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置文件内容无效')
            if (!backupPath) {
              const saved = await backup('tavern-settings.json', JSON.stringify(readTavernSettings(), null, 2) + '\n')
              backupPath = str(backup && saved)
            }
            try { await updateTavernSettings(value) }
            catch (error) {
              // One unknown key must not discard the rest: retry field by field.
              const failedFields = []
              for (const key of Object.keys(value)) {
                try { await updateTavernSettings({ [key]: value[key] }) } catch (fieldError) { failedFields.push(key + '：' + errorText(fieldError)) }
              }
              if (failedFields.length) result.failed.push({ title: '部分设置', error: failedFields.join('；') })
            }
            result.overwritten += 1
            continue
          }
          result.skipped += 1
        } catch (error) {
          result.failed.push({ title: item.title, error: errorText(error) })
        }
      }
    }

    return { results, backupPath }
  }

  return Object.freeze({ preview, apply })
}
