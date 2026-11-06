'use strict'

// Minimal vocabulary subset of OpenCC TSCharacters.txt (Apache-2.0), v1.1.9.
// https://github.com/BYVoid/OpenCC/blob/ver.1.1.9/data/dictionary/TSCharacters.txt
// Deliberately not a general-purpose Chinese converter; changes require a version bump.
const NORMALIZATION_VERSION = 'opencc-1.1.9-place-sfx-subset-1'
// 2: no catalogue modes (the old stored mode is ignored); one recall mode per asset: always = 必发, else keyword.
// Legacy `core` reads as always; there is no core quota.
// 3: resolve former names and retain logical source priority for portable borrowed references.
const SELECTOR_VERSION = 'keyword-catalogue-3'
const traditional = '醫學樓門開關聲風雨電車馬鈴鐘書館場園廳間網機鐵橋邊廣辦廚臥寢臺燈牆戰鬥劍槍擊響腳步葉鳥蟲蟬貓龍靈藥煉爐陣雲霧島灣樹林綠紅黃藍驚動靜樂溫暖懸謎險傷祕舊報話訊號櫃課體泳禮營礦窯獄廟廢遺跡鎮鄉莊農倉庫邁進傳來後裡遠處側陰陽曉晚時長廊實驗術藝計腦飛發髮滿覺麗區鄰賣買貨攤飲煙塵滅爆彈殼鎖鑰敲碎落濺濕濤浪轟轎輪軌輛廠產經濟會議訓練護衛隊軍敵聖殿國宮寬窄圍觀戲劇院幹'
const simplified = '医学楼门开关声风雨电车马铃钟书馆场园厅间网机铁桥边广办厨卧寝台灯墙战斗剑枪击响脚步叶鸟虫蝉猫龙灵药炼炉阵云雾岛湾树林绿红黄蓝惊动静乐温暖悬谜险伤秘旧报话讯号柜课体泳礼营矿窑狱庙废遗迹镇乡庄农仓库迈进传来后里远处侧阴阳晓晚时长廊实验术艺计脑飞发发满觉丽区邻卖买货摊饮烟尘灭爆弹壳锁钥敲碎落溅湿涛浪轰轿轮轨辆厂产经济会议训练护卫队军敌圣殿国宫宽窄围观戏剧院干'
const conversion = new Map([...traditional].map((c, i) => [c, [...simplified][i]]))
const dangerous = new Set(['__proto__', 'constructor', 'prototype'])
const controls = /[\u0000-\u001f\u007f-\u009f]/u
const length = value => [...value].length
const codepointCompare = (a, b) => {
  const x = [...String(a)], y = [...String(b)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d }
  return x.length - y.length
}
function normalizeFormerNames(raw = {}) {
  const names = Array.isArray(raw.formerNames) ? raw.formerNames : []
  const formerNames = [...new Set(names.filter(value => typeof value === 'string' && !controls.test(value)).map(value => value.trim()).filter(value => value && length(value) <= 80))].slice(0, 128)
  return formerNames.length ? { formerNames } : {}
}
function normalizeAssetMetadata(raw = {}) {
  const result = normalizeFormerNames(raw)
  for (const key of ['provenance', 'license', 'credits', 'author', 'origin', 'borrowedFrom']) {
    if (raw[key] === undefined) continue
    const encoded = JSON.stringify(raw[key])
    if (encoded && encoded.length <= 16384) result[key] = JSON.parse(encoded)
  }
  return result
}
function resolveAssetReference(value, items = [], libraryIds = []) {
  if (!value) return null
  const byId = typeof value === 'string' && items.find(item => !item.name && (item.id === value || item.ref?.id === value))
  if (byId) return byId
  const ranked = catalogueNameRepresentatives(items.map(item => ({ ...item, name: item.name || item.label || item.id })), libraryIds).items
  if (typeof value === 'object') return items.find(item => (item.ref?.id || item.id) === value.id && (item.ref?.source || (item.source === 'card' ? 'card' : item.libraryId)) === value.source) || null
  // Current wire names beat former names; source order breaks alias collisions deterministically.
  return ranked.find(item => item.name === value) || ranked.find(item => (item.formerNames || []).includes(value)) || items.find(item => item.id === value || item.ref?.id === value) || null
}
function normalizeCatalogueText(value) {
  return [...String(value ?? '').normalize('NFKC')].map(c => conversion.get(c) || c).join('').toLowerCase().replace(/\s+/gu, ' ').trim()
}
function normalizeCategory(value) {
  if (typeof value !== 'string' || controls.test(value)) return ''
  const parts = value.trim().split('/').map(p => p.trim())
  return parts.length <= 4 && parts.every(p => length(p) >= 1 && length(p) <= 20 && !dangerous.has(p)) ? parts.join('/') : ''
}
// Sparse output preserves old indexes and RPC shapes. Missing fields have matcher defaults.
function normalizeRecallMetadata(raw = {}, warnings = []) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}, warn = field => warnings.push({ code: 'invalid-recall-metadata', field })
  function words(input, max, field) {
    if (!Array.isArray(input)) { warn(field); return [] }
    const seen = new Set(), result = []
    for (const value of input) {
      if (typeof value !== 'string' || controls.test(value)) { warn(field); continue }
      const word = value.trim(), normalized = normalizeCatalogueText(word)
      if (length(word) < 2 || length(word) > 40 || length(normalized) < 2 || length(normalized) > 40 || dangerous.has(normalized)) { warn(field); continue }
      if (!seen.has(normalized)) { seen.add(normalized); if (result.length < max) result.push(word); else warn(field) }
    }
    return result
  }
  if (Object.hasOwn(raw, 'keywords')) out.keywords = words(raw.keywords, 16, 'keywords')
  if (Object.hasOwn(raw, 'synonyms')) {
    out.synonyms = {}
    if (!raw.synonyms || typeof raw.synonyms !== 'object' || Array.isArray(raw.synonyms)) warn('synonyms')
    else for (const [key, values] of Object.entries(raw.synonyms)) {
      const canonical = (out.keywords || []).find(w => normalizeCatalogueText(w) === normalizeCatalogueText(key))
      if (dangerous.has(key) || controls.test(key) || !canonical) { warn('synonyms.' + key); continue }
      out.synonyms[canonical] = words([...(out.synonyms[canonical] || []), ...(Array.isArray(values) ? values : [])], 6, 'synonyms.' + key)
      if (!Array.isArray(values)) warn('synonyms.' + key)
    }
  }
  if (Object.hasOwn(raw, 'category')) { const category = normalizeCategory(raw.category); if (category) out.category = category; else warn('category') }
  for (const flag of ['always', 'core']) if (Object.hasOwn(raw, flag)) { if (typeof raw[flag] === 'boolean') out[flag] = raw[flag]; else warn(flag) }
  return out
}
// no 优先级 — an old `priority` is ignored and dropped, never an order.
const RECALL_FIELDS = ['keywords', 'synonyms', 'category', 'always', 'core']
// Backgrounds and sounds have one recall mode: `always` (必发) or keyword. The old `core` flag (a quota of
// base items) reads as always. Music keeps `core` as its curation mark (精选), so it is not folded there.
function foldLegacyCore(metadata) {
  if (metadata && Object.hasOwn(metadata, 'core')) { if (metadata.core === true) metadata.always = true; delete metadata.core }
  return metadata
}
// options.foldCore (backgrounds / sounds): an explicit `always` replaces a stored legacy core, then any core
// left is folded into always and dropped, so saved entries carry `always` only.
function recallMetadataPatch(current, input, warnings = [], { foldCore = false } = {}) {
  const raw = { ...current }
  if (foldCore && Object.hasOwn(input, 'always')) delete raw.core
  for (const key of RECALL_FIELDS) if (Object.hasOwn(input, key)) raw[key] = input[key]
  const normalized = normalizeRecallMetadata(raw, warnings)
  if (foldCore) foldLegacyCore(normalized)
  for (const key of RECALL_FIELDS) delete current[key]
  return Object.assign(current, normalized)
}
function normalizeCataloguePolicy(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {}
  const caps = {}
  for (const [module, fallback, min, max] of [['backgrounds', 24, 8, 64], ['sfx', 20, 8, 48], ['ambience', 10, 4, 24]]) {
    const value = raw.caps?.[module]
    caps[module] = Number.isInteger(value) && value >= min && value <= max ? value : fallback
  }
  // No catalogue modes: a stored mode ('full' / 'keyword' from older cards) is ignored and dropped.
  return { caps, musicLibraryThreshold: Number.isSafeInteger(raw.musicLibraryThreshold) && raw.musicLibraryThreshold >= 0 ? raw.musicLibraryThreshold : 40 }
}
const timeOnly = /^(?:清晨|早晨|早上|上午|中午|午后|下午|傍晚|黄昏|夜晚|夜间|深夜|凌晨|白天|日间|早|晚|夜|day|night|morning|noon|afternoon|evening|dawn|dusk)$/u
function matchOffset(text, word) {
  let offset = text.indexOf(word)
  const han = /\p{Script=Han}/u.test(word)
  while (offset >= 0) {
    if (han || (!/[\p{Script=Latin}\p{N}]/u.test(text[offset - 1] || '') && !/[\p{Script=Latin}\p{N}]/u.test(text[offset + word.length] || ''))) return offset
    offset = text.indexOf(word, offset + 1)
  }
  return -1
}
// pack looks/music may use time words; legacy and place matching keep the old exclusion.
function lexicalEvidence(item, units, { excludeTimeWords = true } = {}) {
  const metadata = normalizeRecallMetadata(item), candidates = new Map()
  const canonicalOf = new Map()
  for (const word of metadata.keywords || []) {
    const canonical = normalizeCatalogueText(word)
    canonicalOf.set(canonical, canonical)
    for (const alias of metadata.synonyms?.[word] || []) canonicalOf.set(normalizeCatalogueText(alias), canonical)
  }
  function add(raw, base, kind, canonical) {
    const word = normalizeCatalogueText(raw)
    if (length(word) < 2 || excludeTimeWords && timeOnly.test(word)) return
    if (!candidates.has(word) || candidates.get(word).base < base) candidates.set(word, { word, base, kind, canonical: canonical || canonicalOf.get(word) || word })
  }
  for (const name of [item.name, item.label].filter(Boolean)) { add(name, 100, 'name'); for (const part of name.split('·')) if (part !== name) add(part, 40, 'name-part') }
  for (const word of metadata.keywords || []) {
    add(word, 80, 'keyword', normalizeCatalogueText(word))
    for (const alias of metadata.synonyms?.[word] || []) add(alias, 60, 'synonym', normalizeCatalogueText(word))
  }
  const groups = new Map()
  let earliest = Infinity
  for (const candidate of candidates.values()) for (let index = 0; index < units.length; index++) {
    const offset = matchOffset(units[index], candidate.word)
    if (offset < 0) continue
    earliest = Math.min(earliest, index + 1)
    const hit = { ...candidate, paragraph: index + 1, offset, beyondPrompt: offset >= 600, score: candidate.base + Math.min(length(candidate.word), 20) }
    const prior = groups.get(candidate.canonical)
    if (!prior || hit.score > prior.score || hit.score === prior.score && hit.paragraph < prior.paragraph) groups.set(candidate.canonical, hit)
    break
  }
  const evidence = [...groups.values()].sort((a, b) => b.score - a.score || a.paragraph - b.paragraph || codepointCompare(a.word, b.word))
  return { score: evidence.length ? evidence[0].score + Math.min(12, (evidence.length - 1) * 3) : 0, paragraph: evidence.length ? earliest : null, evidence }
}
function categoryDigest(items, backgrounds = false) {
  let groups = new Map()
  const add = (map, path, count, pictures) => { const entry = map.get(path) || { path, count: 0, pictures: 0 }; entry.count += count; entry.pictures += pictures; map.set(path, entry) }
  for (const item of items) add(groups, normalizeCategory(item.category) || '', 1, item.sha || item.url ? 1 : 0)
  const line = row => `${row.path || '未分类'}：${row.count} 项${backgrounds ? `，${row.pictures} 张有图` : ''}`
  function fold(path) {
    const parent = path.split('/').slice(0, -1).join('/'), next = new Map()
    for (const [key, row] of groups) add(next, key === parent || key.startsWith(parent + '/') ? parent : key, row.count, row.pictures)
    groups = next
  }
  while (true) {
    const candidates = [...groups.values()].filter(r => r.path.includes('/') && (groups.size > 12 || length(line(r)) > 80)).sort((a, b) => b.path.split('/').length - a.path.split('/').length || codepointCompare(a.path, b.path))
    if (!candidates.length) break
    fold(candidates[0].path)
  }
  let rows = [...groups.values()]
  if (rows.length > 12) {
    rows.sort((a, b) => b.count - a.count || codepointCompare(a.path, b.path))
    const rest = rows.splice(11)
    rows.push({ path: '', label: '其他', count: rest.reduce((sum, r) => sum + r.count, 0), pictures: rest.reduce((sum, r) => sum + r.pictures, 0) })
  }
  rows.sort((a, b) => codepointCompare(a.path, b.path))
  return { rows, categories: rows.filter(r => r.path && !r.label).map(r => r.path), lines: rows.length ? rows.map(r => r.label ? line(r).replace('未分类', r.label) : line(r)) : ['(none)'] }
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze) }
  return value
}
function catalogueNameRepresentatives(items, libraryIds = []) {
  const rank = item => {
    const source = item.ref?.source || (item.source === 'card' ? 'card' : item.libraryId)
    return source === 'card' ? -1 : source === 'general' ? 1e6 : Math.max(0, libraryIds.indexOf(source))
  }
  const seen = new Set(), warnings = []
  const representatives = items.slice().sort((a, b) => rank(a) - rank(b) || codepointCompare(a.id, b.id)).filter(item => {
    if (seen.has(item.name)) { warnings.push({ code: 'ambiguous-name', id: item.id, wireValue: item.name }); return false }
    seen.add(item.name); return true
  })
  return { items: representatives, warnings }
}
function selectDirectorCatalogue({ full = {}, units = [], start = {}, previous, policy, stage = {} }) {
  policy = normalizeCataloguePolicy(policy)
  // JSON-like snapshot only: never freeze mutable host catalogues or widget functions.
  full = JSON.parse(JSON.stringify(full))
  const warnings = [], unresolvedReferences = [], diagnostics = {}, digest = {}
  const sourceRank = (item, module) => {
    const source = item.ref?.source || (item.source === 'card' ? 'card' : item.libraryId)
    return source === 'card' ? -1 : source === 'general' ? 1e6 : Math.max(0, (stage.sources?.[module]?.libraries || []).indexOf(source))
  }
  const stable = module => (a, b) => sourceRank(a, module) - sourceRank(b, module) || codepointCompare(a.id, b.id)
  const modules = { backgrounds: full.scenes || full.backgrounds || [], music: full.tracks || [], sfx: (full.sounds || []).filter(s => s.kind === 'oneshot'), ambience: (full.sounds || []).filter(s => s.kind === 'ambience'), looks: full.looks || [] }
  // Names are wire values. Select one stable representative before recall, never rename.
  for (const module of ['backgrounds', 'music']) {
    const resolved = catalogueNameRepresentatives(modules[module], stage.sources?.[module]?.libraries)
    // Keep the catalogue's own order (looks and music are listed in full, in that order).
    const kept = new Set(resolved.items)
    modules[module] = modules[module].filter(item => kept.has(item))
    warnings.push(...resolved.warnings.map(warning => ({ ...warning, module })))
  }
  const forced = Object.fromEntries(Object.keys(modules).map(k => [k, new Map()]))
  const wire = (module, item) => ['backgrounds', 'music'].includes(module) ? item.name : item.id
  function pin(module, value, reason) {
    if (!value || module === 'ambience' && value === 'none' || module === 'looks' && ['auto', 'none', 'clear'].includes(value)) return
    const item = resolveAssetReference(value, modules[module], stage.sources?.[module]?.libraries)
    if (!item) { unresolvedReferences.push({ module, wireValue: value, reason }); return }
    const reasons = forced[module].get(item.id) || []; if (!reasons.includes(reason)) reasons.push(reason); forced[module].set(item.id, reasons)
  }
  function references(value, reason) {
    if (!value || typeof value !== 'object') return
    pin('backgrounds', value.scene, reason); pin('music', value.music, reason); pin('ambience', value.amb, reason); pin('looks', value.light, reason)
    if (value.lighting) { pin('looks', value.lighting.time, reason); pin('looks', value.lighting.mood, reason) }
    for (const command of value.commands || []) if (['sfx', 'amb', 'light'].includes(command.op)) pin({ sfx: 'sfx', amb: 'ambience', light: 'looks' }[command.op], command.value, reason)
    // Read actual pacing fields only, never stats.catalogue or previous selections.
    const pacing = value.pacing
    if (pacing && typeof pacing === 'object') {
      pin('backgrounds', pacing.scene, reason)
      pin('looks', pacing.mood, reason); pin('looks', pacing.previousMood, reason)
      pin('music', pacing.music, reason)
      for (const track of Array.isArray(pacing.recentTracks) ? pacing.recentTracks : []) pin('music', track, reason)
    }
  }
  references(start, 'carried'); pin('backgrounds', stage.background, 'default-background')
  if (previous?.status === 'done') { references(previous.start, 'previous-record'); for (const entry of previous.entries || []) references(entry, 'previous-record'); references({ pacing: previous.pacing }, 'previous-record') }
  const normalizedUnits = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text))
  const chosen = {}
  const identity = (module, item) => ({ id: item.id, source: item.source || '', libraryId: item.libraryId || '', wireValue: wire(module, item) })
  for (const [module, items] of Object.entries(modules)) {
    const lexical = ['backgrounds', 'sfx', 'ambience'].includes(module)
    const rows = items.map(item => {
      const metadata = normalizeRecallMetadata(item, warnings)
      if (lexical) foldLegacyCore(metadata)
      if (metadata.always) { const reasons = forced[module].get(item.id) || []; reasons.push('always'); forced[module].set(item.id, reasons) }
      const normalizedItem = { ...item }
      for (const field of [...RECALL_FIELDS, 'priority']) delete normalizedItem[field]
      Object.assign(normalizedItem, metadata)
      return { item: normalizedItem, module, ...identity(module, item), ...(lexical ? lexicalEvidence(item, normalizedUnits) : { score: 0, paragraph: null, evidence: [] }), reason: [...(forced[module].get(item.id) || [])] }
    })
    const compare = (a, b) => stable(module)(a.item, b.item)
    // Lexical modules rank by source → id; looks and music keep the catalogue order.
    if (lexical) rows.sort(compare)
    const triggered = rows.filter(r => r.score).sort((a, b) => b.score - a.score || a.paragraph - b.paragraph || compare(a, b))
    const pinned = rows.filter(r => r.reason.length).sort(compare)
    let curated = [], selected = [], overflow = 0
    if (module === 'looks') selected = rows
    else if (lexical) {
      // 必发 (always), carried and default items are never cut by the cap; keyword hits fill up to it.
      selected = [...pinned]
      overflow = Math.max(0, selected.length - policy.caps[module])
      if (overflow) warnings.push({ code: 'overflow', module, count: overflow })
      for (const row of triggered) if (!selected.includes(row)) { if (selected.length < policy.caps[module]) selected.push(row); else row.excluded = 'cap' }
      if (!triggered.length) digest[module] = categoryDigest(items, module === 'backgrounds')
    } else {
      const library = rows.filter(r => r.item.ref ? r.item.ref.source !== 'card' : r.item.source === 'library')
      const categories = ['日常', '温暖', '喜剧', '悬疑', '危险', '战斗', '悲伤', '神秘'].map(c => '氛围/' + c)
      if (library.length <= policy.musicLibraryThreshold) selected = rows
      else if (!library.some(r => categories.includes(r.item.category))) { selected = rows; warnings.push({ code: 'music-needs-curation', module }) }
      else {
        // Music `core` is the curator's pick per mood category (精选), not a recall mode.
        for (const category of categories) {
          const group = library.filter(r => r.item.category === category).sort(compare), picks = group.filter(r => r.item.core).slice(0, 2)
          for (const row of group) if (picks.length < 2 && !picks.includes(row)) { picks.push(row); warnings.push({ code: 'music-core-fallback', id: row.id, category }) }
          curated.push(...picks)
        }
        curated.forEach(row => row.reason.push('curated'))
        selected = [...new Set([...pinned, ...rows.filter(r => !library.includes(r)), ...curated])]
        const omitted = rows.length - selected.length
        if (omitted) warnings.push({ code: 'music-curation-omitted', count: omitted })
      }
    }
    triggered.forEach(row => row.reason.push('lexical'))
    chosen[module] = selected.map(r => r.item)
    const clean = row => { const { item, ...rest } = row; return rest }
    diagnostics[module] = { full: items.length, triggered: triggered.length, selected: selected.length, pinned: pinned.length, always: rows.filter(r => r.reason.includes('always')).length, curated: curated.length, excluded: rows.filter(r => r.excluded).length, overflow, triggeredIds: triggered.map(r => identity(module, r.item)), selectedIds: selected.map(r => identity(module, r.item)), items: rows.map(clean) }
  }
  return deepFreeze({ selected: { scenes: chosen.backgrounds, tracks: chosen.music, sounds: [...chosen.sfx, ...chosen.ambience], looks: chosen.looks }, full: { ...full, scenes: modules.backgrounds, tracks: modules.music }, digest, diagnostics, warnings, unresolvedReferences, policy, selectorVersion: SELECTOR_VERSION, normalizationVersion: NORMALIZATION_VERSION })
}

// Category-first stage stand-in. The caller supplies its existing name fallback;
// the returned item is a picture only, never a replacement scene cue.
function categoryStandIn(name, category, items, fallback = () => null, libraryIds = []) {
  items = catalogueNameRepresentatives(items, libraryIds).items
  const available = items.filter(item => !item.missing && !item.pending && (item.url || item.sha))
  const exact = available.find(item => item.name === name)
  if (exact) return exact
  const target = normalizeCategory(category), parts = target.split('/')
  const rank = item => {
    const timeOf = text => ['夜|晚上|深夜|午夜', '黄昏|傍晚|夕', '清晨|早晨|早上|晨', '白天|昼|中午|午后|下午|上午|晴'].findIndex(pattern => new RegExp(pattern).test(text))
    const wantedName = normalizeCatalogueText(name), actualName = normalizeCatalogueText(item.name)
    const wanted = wantedName.split(/[·・\s]+/u).filter(word => word && timeOf(word) < 0), actual = actualName.split(/[·・\s]+/u)
    let score = 0
    for (const word of wanted) {
      if (actual.includes(word)) score += 4
      else if (actual.some(part => word.includes(part) || part.includes(word))) score += 2
      else { const shared = [...new Set([...word])].filter(c => actualName.includes(c)).length; if (shared >= 2) score += shared * 0.8 }
    }
    const time = timeOf(wantedName)
    return { place: score, time: time >= 0 && timeOf(actualName) === time ? 1 : 0 }
  }
  if (target) for (let depth = parts.length; depth >= 2; depth--) {
    const path = parts.slice(0, depth).join('/')
    const group = available.filter(item => item.category === path || depth < parts.length && item.category?.startsWith(path + '/'))
    group.sort((a, b) => { const x = rank(a), y = rank(b); return y.place - x.place || y.time - x.time || codepointCompare(a.id, b.id) })
    if (group.length) return group[0]
  }
  return fallback(name, available)
}

// Empty URL deliberately selects the renderer's generated dark gradient, not an empty texture.
const NEUTRAL_BACKGROUND = Object.freeze({ id: '', name: '', url: '', neutral: true })
function resolveBackgroundAsset(value, items = [], stage = {}, fallback = () => null) {
  items = Array.isArray(items) ? items.filter(item => item && !item.hidden) : []
  stage ||= {}
  const safeFallback = (name, available) => { try { return fallback(name, available) } catch { return null } }
  const ids = stage.sources?.backgrounds?.libraries || []
  const representatives = catalogueNameRepresentatives(items, ids).items
  const requested = resolveAssetReference(value, value && typeof value === 'object' ? items : representatives, ids)
  const available = representatives.filter(item => item.url && !item.missing && !item.pending)
  const warnings = []
  const exact = requested?.url && !requested.missing && !requested.pending ? requested : null
  if (value && !exact) warnings.push({ code: 'missing-asset', module: 'backgrounds', reference: value })
  const name = requested?.name || (typeof value === 'string' ? value : typeof value?.name === 'string' ? value.name : '')
  const standIn = exact || (name ? categoryStandIn(name, requested?.category, available, safeFallback, ids) : null)
  const opening = stage.background && items.find(item => (item.id === stage.background || item.ref?.id === stage.background) && item.url && !item.missing && !item.pending)
  return { item: standIn || opening || NEUTRAL_BACKGROUND, warnings }
}

if (typeof window === 'undefined') module.exports = { normalizeFormerNames, normalizeAssetMetadata, resolveAssetReference, resolveBackgroundAsset, NEUTRAL_BACKGROUND, NORMALIZATION_VERSION, SELECTOR_VERSION, RECALL_FIELDS, normalizeCatalogueText, normalizeCategory, normalizeRecallMetadata, recallMetadataPatch, foldLegacyCore, normalizeCataloguePolicy, lexicalEvidence, categoryDigest, selectDirectorCatalogue, catalogueNameRepresentatives, categoryStandIn, deepFreeze, codepointCompare }
