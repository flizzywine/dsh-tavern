// MVU hidden attribute rules, display projection, receipt masking, and write-back protection.
// Pure and dependency-free so both Node domain services and browser client bundles share it.

const MVU_HIDDEN_SENTINEL = '$mvu_hidden$'

function mvuVisPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mvuVisClone(value) {
  if (value === undefined) return undefined
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function mvuVisStr(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function mvuVisDecodeSegment(segment) {
  return mvuVisStr(segment).replace(/~1/g, '/').replace(/~0/g, '~')
}

function mvuVisEncodeSegment(segment) {
  return mvuVisStr(segment).replace(/~/g, '~0').replace(/\//g, '~1')
}

function mvuVisPointerSegments(pointerOrSegments) {
  if (Array.isArray(pointerOrSegments)) {
    const list = pointerOrSegments.map(item => mvuVisStr(item)).filter(item => item !== '')
    return list[0] === 'stat_data' ? list.slice(1) : list
  }
  const text = mvuVisStr(pointerOrSegments).trim()
  if (!text) return []
  const raw = (text.startsWith('/') ? text.slice(1) : text).split('/').map(mvuVisDecodeSegment).filter(item => item !== '')
  return raw[0] === 'stat_data' ? raw.slice(1) : raw
}

function mvuVisFormatPointer(segments, rooted) {
  const list = rooted ? ['stat_data', ...segments] : segments
  return list.length ? '/' + list.map(mvuVisEncodeSegment).join('/') : '/'
}

function normalizeMvuVisibilityPointer(pointer) {
  const segments = mvuVisPointerSegments(pointer)
  return segments.length ? mvuVisFormatPointer(segments, false) : ''
}

function normalizeMvuVisibilityTiers(rawTiers, path, error) {
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    if (error) error(path + '/tiers', 'tiered 模式必须提供非空的 tiers 档位数组，如 [[0, "疏离"], [60, "信赖"]]')
    return null
  }
  const byMin = new Map()
  for (let index = 0; index < rawTiers.length; index += 1) {
    const item = rawTiers[index]
    const min = Array.isArray(item) ? Number(item[0]) : (mvuVisPlainObject(item) ? Number(item.min) : NaN)
    const label = Array.isArray(item) ? mvuVisStr(item[1]).trim() : (mvuVisPlainObject(item) ? mvuVisStr(item.label).trim() : '')
    if (!Number.isFinite(min) || !label) {
      if (error) error(path + '/tiers/' + index, '档位项必须是 [阈值数字, "阶段词"] 或 { min, label }，且阶段词不能为空')
      return null
    }
    byMin.set(min, label)
  }
  return [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([min, label]) => [min, label])
}

function normalizeSingleMvuVisibilityRule(rawRule, rulePath, error) {
  if (typeof rawRule === 'string') {
    const shorthand = rawRule.trim().toLowerCase()
    if (shorthand === 'masked' || shorthand === 'trend') {
      return { mode: shorthand, trend: shorthand === 'trend', placeholder: '？？？', largeDelta: 10 }
    }
    if (error) error(rulePath, '简写隐藏规则仅支持 "masked" 或 "trend"')
    return null
  }
  if (!mvuVisPlainObject(rawRule)) {
    if (error) error(rulePath, '隐藏规则必须是对象，如 { "mode": "trend" }')
    return null
  }
  const rawMode = rawRule.mode === undefined ? 'masked' : mvuVisStr(rawRule.mode).trim().toLowerCase()
  if (!['masked', 'trend', 'tiered'].includes(rawMode)) {
    if (error) error(rulePath + '/mode', 'mode 必须是 masked、trend 或 tiered')
    return null
  }
  const mode = rawMode === 'masked' && rawRule.trend === true ? 'trend' : rawMode
  const trend = mode === 'trend' ? true : (mode === 'masked' ? false : rawRule.trend !== false)
  const defaultPlaceholder = mode === 'tiered' ? '未知' : '？？？'
  const placeholder = rawRule.placeholder === undefined ? defaultPlaceholder : (mvuVisStr(rawRule.placeholder).trim() || defaultPlaceholder)
  const largeDeltaRaw = rawRule.largeDelta === undefined ? 10 : Number(rawRule.largeDelta)
  if (!Number.isFinite(largeDeltaRaw) || largeDeltaRaw <= 0) {
    if (error) error(rulePath + '/largeDelta', 'largeDelta 必须是大于 0 的有限数字')
    return null
  }
  const normalized = { mode, trend, placeholder, largeDelta: largeDeltaRaw }
  if (mode === 'tiered') {
    const tiers = normalizeMvuVisibilityTiers(rawRule.tiers, rulePath, error)
    if (!tiers) return null
    normalized.tiers = tiers
  }
  if (rawRule.revealWhen !== undefined && rawRule.revealWhen !== null) {
    const rw = rawRule.revealWhen
    const validRw = (typeof rw === 'string' && rw.trim() !== '') || (mvuVisPlainObject(rw) && Object.keys(rw).length > 0)
    if (!validRw) {
      if (error) error(rulePath + '/revealWhen', '预留字段 revealWhen 必须是非空对象或条件字符串')
      return null
    }
    normalized.revealWhen = mvuVisClone(rw)
  }
  return normalized
}

function validateMvuVisibility(input, prefix = '/extensions/dsh_tavern/mvuVisibility') {
  const errors = [], warnings = []
  const error = (path, message) => errors.push({ path, message })
  if (input === undefined || input === null) return { errors, warnings, normalized: null }
  if (!mvuVisPlainObject(input)) {
    error(prefix, 'mvuVisibility 必须是路径到规则的对象映射')
    return { errors, warnings, normalized: null }
  }
  const out = {}
  for (const [rawKey, rawRule] of Object.entries(input)) {
    if (rawRule === null || rawRule === false) continue
    const canonical = normalizeMvuVisibilityPointer(rawKey)
    const rulePath = prefix + '/' + mvuVisEncodeSegment(rawKey)
    if (!canonical || canonical === '/') {
      error(rulePath, '隐藏属性路径不能为空或根路径：' + mvuVisStr(rawKey))
      continue
    }
    const rule = normalizeSingleMvuVisibilityRule(rawRule, rulePath, error)
    if (rule) out[canonical] = rule
  }
  return { errors, warnings, normalized: Object.keys(out).length ? out : null }
}

function normalizeMvuVisibility(input) {
  if (!mvuVisPlainObject(input)) return null
  if (input.__mvuVisibilityNormalized === true) return input.rules
  return validateMvuVisibility(input).normalized
}

function hasMvuVisibilityRules(visibility) {
  const rules = normalizeMvuVisibility(visibility)
  return Boolean(rules && Object.keys(rules).length > 0)
}

// Reserved hook for conditional fog-of-war reveal (`revealWhen`).
// Kept inactive in phase 1 per design: always returns false while preserving schema compatibility.
function isMvuPathRevealed(_rule, _statData) {
  return false
}

function mvuVisSegmentsMatch(patternSegs, targetSegs, pIdx = 0, tIdx = 0) {
  while (pIdx < patternSegs.length && tIdx < targetSegs.length) {
    const pat = patternSegs[pIdx]
    if (pat === '**') {
      if (pIdx === patternSegs.length - 1) return true
      for (let skip = tIdx + 1; skip <= targetSegs.length; skip += 1) {
        if (mvuVisSegmentsMatch(patternSegs, targetSegs, pIdx + 1, skip)) return true
      }
      return false
    }
    if (pat !== '*' && pat !== targetSegs[tIdx]) return false
    pIdx += 1
    tIdx += 1
  }
  return pIdx === patternSegs.length && tIdx === targetSegs.length
}

function mvuVisPatternScore(patternSegs) {
  let exact = 0, singleWild = 0, multiWild = 0
  for (const seg of patternSegs) {
    if (seg === '**') multiWild += 1
    else if (seg === '*') singleWild += 1
    else exact += 1
  }
  const noWild = singleWild === 0 && multiWild === 0 ? 1 : 0
  return noWild * 1000000 + exact * 1000 - singleWild * 10 - multiWild * 100
}

function matchMvuVisibilityRule(visibility, pathOrSegments, statData) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules) return null
  const segments = mvuVisPointerSegments(pathOrSegments)
  if (!segments.length) return null

  function findDirect(targetSegs) {
    let best = null
    let order = 0
    for (const [pattern, rule] of Object.entries(rules)) {
      order += 1
      const pSegs = mvuVisPointerSegments(pattern)
      if (!mvuVisSegmentsMatch(pSegs, targetSegs)) continue
      if (isMvuPathRevealed(rule, statData)) continue
      const score = mvuVisPatternScore(pSegs) * 1000 + order
      if (!best || score >= best.score) best = { pattern, rule, score }
    }
    return best
  }

  const direct = findDirect(segments)
  if (direct) return { pattern: direct.pattern, rule: direct.rule, matchedSegments: segments, tupleIndex: null }

  // Upstream MVU ValueWithDescription tuples `[value, "description"]` diff at `/path/0` or `/path/1`.
  const tail = segments[segments.length - 1]
  if (segments.length >= 2 && (tail === '0' || tail === '1')) {
    const parentSegs = segments.slice(0, -1)
    const parentMatch = findDirect(parentSegs)
    if (parentMatch) return { pattern: parentMatch.pattern, rule: parentMatch.rule, matchedSegments: parentSegs, tupleIndex: Number(tail) }
  }
  return null
}

function unwrapMvuScalar(value) {
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'string') return value[0]
  return value
}

function parseMvuFiniteNumber(value) {
  if (value === undefined || value === null || value === '（不存在）') return null
  const unwrapped = unwrapMvuScalar(value)
  if (typeof unwrapped === 'number') return Number.isFinite(unwrapped) ? unwrapped : null
  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim()
    if (!trimmed || trimmed === '（不存在）') return null
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : null
    }
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed)
        if (Array.isArray(arr) && arr.length === 2 && typeof arr[1] === 'string') return parseMvuFiniteNumber(arr[0])
      } catch (_error) {}
    }
  }
  return null
}

function resolveMvuTierLabel(num, rule) {
  const tiers = Array.isArray(rule && rule.tiers) ? rule.tiers : []
  if (!tiers.length || !Number.isFinite(num)) return (rule && rule.placeholder) || '未知'
  let chosen = tiers[0][1]
  for (let i = 0; i < tiers.length; i += 1) {
    if (num >= tiers[i][0]) chosen = tiers[i][1]
    else break
  }
  return chosen
}

function formatMvuHiddenValue(rawValue, rule) {
  if (!rule) return rawValue
  if (rule.mode === 'tiered') {
    const num = parseMvuFiniteNumber(rawValue)
    return num !== null ? resolveMvuTierLabel(num, rule) : (rule.placeholder || '未知')
  }
  return rule.placeholder || '？？？'
}

function mvuVisTrendPhrase(direction, strength) {
  if (direction === 'up') return strength === 'major' ? '大幅上升 ↑↑' : '略有上升 ↑'
  if (direction === 'down') return strength === 'major' ? '大幅下降 ↓↓' : '略有下降 ↓'
  return '已发生变化'
}

function describeMvuHiddenChange(beforeRaw, afterRaw, operation, rule) {
  const op = mvuVisStr(operation).toLowerCase()
  const removed = op === 'delete' || op === 'remove' || (beforeRaw !== undefined && beforeRaw !== '（不存在）' && beforeRaw !== '' && (afterRaw === undefined || afterRaw === '（不存在）' || afterRaw === ''))
  const placeholder = (rule && rule.placeholder) || (rule && rule.mode === 'tiered' ? '未知' : '？？？')

  if (!rule || rule.mode === 'masked') {
    const text = removed ? '已移除' : '已发生变化'
    return { mode: 'masked', text, before: placeholder, after: removed ? '' : placeholder, direction: null, strength: null, crossed: false, beforeTier: '', afterTier: '' }
  }

  const bNum = parseMvuFiniteNumber(beforeRaw)
  const aNum = parseMvuFiniteNumber(afterRaw)
  const hasDelta = bNum !== null && aNum !== null && aNum !== bNum
  const diff = hasDelta ? aNum - bNum : 0
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : null
  const large = Number(rule.largeDelta) > 0 ? Number(rule.largeDelta) : 10
  const strength = direction ? (Math.abs(diff) >= large ? 'major' : 'minor') : null

  if (rule.mode === 'trend') {
    const text = removed ? '已移除' : (direction ? mvuVisTrendPhrase(direction, strength) : '已发生变化')
    return { mode: 'trend', text, before: placeholder, after: removed ? '' : placeholder, direction, strength, crossed: false, beforeTier: '', afterTier: '' }
  }

  // mode === 'tiered'
  const beforeTier = bNum !== null ? resolveMvuTierLabel(bNum, rule) : ''
  const afterTier = removed ? '' : (aNum !== null ? resolveMvuTierLabel(aNum, rule) : placeholder)
  if (removed) {
    return { mode: 'tiered', text: '已移除', before: beforeTier || placeholder, after: '', direction: null, strength: null, crossed: false, beforeTier: beforeTier || placeholder, afterTier: '' }
  }
  if (!beforeTier && aNum !== null) {
    return { mode: 'tiered', text: afterTier, before: '', after: afterTier, direction: null, strength: null, crossed: false, beforeTier: '', afterTier }
  }
  if (beforeTier && afterTier && beforeTier !== afterTier) {
    const arrow = direction === 'up' ? ' ↑' : direction === 'down' ? ' ↓' : ''
    return { mode: 'tiered', text: beforeTier + ' → ' + afterTier + arrow, before: beforeTier, after: afterTier, direction, strength, crossed: true, beforeTier, afterTier }
  }
  const currentTier = afterTier || beforeTier || placeholder
  const hint = rule.trend !== false && direction ? mvuVisTrendPhrase(direction, strength) : '已发生变化'
  return { mode: 'tiered', text: currentTier + '（' + hint + '）', before: currentTier, after: currentTier, direction: rule.trend !== false ? direction : null, strength: rule.trend !== false ? strength : null, crossed: false, beforeTier: currentTier, afterTier: currentTier }
}

function maskMvuSubtree(node, segments, rules, rootStatData, forEditor) {
  const matched = matchMvuVisibilityRule(rules, segments, rootStatData)
  if (matched && matched.tupleIndex === null) {
    return { changed: true, value: forEditor ? MVU_HIDDEN_SENTINEL : formatMvuHiddenValue(node, matched.rule) }
  }
  if (Array.isArray(node)) {
    let anyChanged = false
    const next = node.map((item, idx) => {
      const child = maskMvuSubtree(item, segments.concat(String(idx)), rules, rootStatData, forEditor)
      if (child.changed) anyChanged = true
      return child.value
    })
    return anyChanged ? { changed: true, value: next } : { changed: false, value: node }
  }
  if (mvuVisPlainObject(node)) {
    let anyChanged = false
    const next = {}
    for (const [key, childVal] of Object.entries(node)) {
      if (key.startsWith('$')) { next[key] = childVal; continue }
      const child = maskMvuSubtree(childVal, segments.concat(key), rules, rootStatData, forEditor)
      if (child.changed) anyChanged = true
      next[key] = child.value
    }
    return anyChanged ? { changed: true, value: next } : { changed: false, value: node }
  }
  return { changed: false, value: node }
}

function maskMvuStatDataForDisplay(statData, visibility) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || !mvuVisPlainObject(statData)) return statData
  return maskMvuSubtree(statData, [], { __mvuVisibilityNormalized: true, rules }, statData, false).value
}

function maskMvuStatDataForEditor(statData, visibility) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || !mvuVisPlainObject(statData)) return statData
  return maskMvuSubtree(statData, [], { __mvuVisibilityNormalized: true, rules }, statData, true).value
}

function describeMvuEditorNode(rawValue, pathSegments, visibility, rootStatData) {
  const matched = matchMvuVisibilityRule(visibility, pathSegments, rootStatData)
  if (!matched || matched.tupleIndex !== null) return null
  return {
    hidden: true,
    mode: matched.rule.mode,
    displayText: formatMvuHiddenValue(rawValue, matched.rule),
    pattern: matched.pattern
  }
}

function maskMvuVariablesEnvelope(variables, wrappedRules) {
  if (!mvuVisPlainObject(variables) || !mvuVisPlainObject(variables.stat_data)) return variables
  const maskedStat = maskMvuSubtree(variables.stat_data, [], wrappedRules, variables.stat_data, false)
  if (!maskedStat.changed) return variables
  const next = Object.assign({}, variables, { stat_data: maskedStat.value })
  if (mvuVisPlainObject(variables.display_data)) {
    next.display_data = maskMvuSubtree(variables.display_data, [], wrappedRules, variables.stat_data, false).value
  }
  if (mvuVisPlainObject(variables.delta_data)) {
    next.delta_data = maskMvuSubtree(variables.delta_data, [], wrappedRules, variables.stat_data, false).value
  }
  return next
}

function maskMvuHelperMessageRow(row, visibility) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || !row || typeof row !== 'object' || row.stub) return row
  const wrapped = { __mvuVisibilityNormalized: true, rules }
  const nextVars = mvuVisPlainObject(row.variables) ? maskMvuVariablesEnvelope(row.variables, wrapped) : row.variables
  let swipesChanged = false
  const nextSwipes = Array.isArray(row.swipes_data)
    ? row.swipes_data.map(item => {
        const masked = mvuVisPlainObject(item) ? maskMvuVariablesEnvelope(item, wrapped) : item
        if (masked !== item) swipesChanged = true
        return masked
      })
    : row.swipes_data
  if (nextVars === row.variables && !swipesChanged) return row
  const copy = Object.assign({}, row)
  if (nextVars !== row.variables) copy.variables = nextVars
  if (swipesChanged) copy.swipes_data = nextSwipes
  return copy
}

function maskMvuJsonTextAtPath(text, baseSegments, wrappedRules) {
  const raw = mvuVisStr(text)
  if (!/^\s*[\[{]/.test(raw)) return text
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return text
    const masked = maskMvuSubtree(parsed, baseSegments, wrappedRules, null, false)
    return masked.changed ? JSON.stringify(masked.value) : text
  } catch (_error) {
    return text
  }
}

function maskMvuChangeList(changes, wrappedRules) {
  if (!Array.isArray(changes) || !changes.length) return changes
  let anyChanged = false
  const seenTupleParents = new Set()
  const out = []
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]
    if (!change || typeof change !== 'object') { out.push(change); continue }
    if (change.hidden && typeof change.hidden === 'object') { out.push(change); continue }
    const rawPath = mvuVisStr(change.path || '/')
    const rooted = rawPath.startsWith('/stat_data/') || rawPath === '/stat_data'
    const segments = mvuVisPointerSegments(rawPath)
    const matched = matchMvuVisibilityRule(wrappedRules, segments, null)
    if (matched) {
      anyChanged = true
      if (matched.tupleIndex === 1) continue
      const canonicalPath = mvuVisFormatPointer(matched.matchedSegments, rooted)
      if (matched.tupleIndex === 0) {
        if (seenTupleParents.has(canonicalPath)) continue
        seenTupleParents.add(canonicalPath)
      }
      const hidden = describeMvuHiddenChange(change.before, change.after, change.operation, matched.rule)
      out.push(Object.assign({}, change, {
        path: canonicalPath,
        before: hidden.before,
        after: hidden.after,
        hidden
      }))
      continue
    }
    // Check if an inserted/updated object or array contains hidden descendant fields.
    const nextBefore = maskMvuJsonTextAtPath(change.before, segments, wrappedRules)
    const nextAfter = maskMvuJsonTextAtPath(change.after, segments, wrappedRules)
    if (nextBefore !== change.before || nextAfter !== change.after) {
      anyChanged = true
      out.push(Object.assign({}, change, { before: nextBefore, after: nextAfter }))
    } else {
      out.push(change)
    }
  }
  return anyChanged ? out : changes
}

function maskMvuReceipt(receipt, visibility) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || !receipt || typeof receipt !== 'object') return receipt
  const wrapped = { __mvuVisibilityNormalized: true, rules }
  const nextChanges = maskMvuChangeList(receipt.changes, wrapped)
  const nextSideEffects = maskMvuChangeList(receipt.sideEffects, wrapped)
  if (nextChanges === receipt.changes && nextSideEffects === receipt.sideEffects) return receipt
  return Object.assign({}, receipt, {
    ...(Array.isArray(receipt.changes) ? { changes: nextChanges } : {}),
    ...(Array.isArray(receipt.sideEffects) ? { sideEffects: nextSideEffects } : {})
  })
}

function restoreHiddenMvuStatData(incomingStatData, authoritativeStatData, visibility, options = {}) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || !mvuVisPlainObject(incomingStatData) || !mvuVisPlainObject(authoritativeStatData)) return incomingStatData
  const wrapped = { __mvuVisibilityNormalized: true, rules }
  const lockHidden = options.lockHidden === true

  function restoreNode(incoming, auth, segments) {
    if (auth === undefined) return incoming
    const matched = matchMvuVisibilityRule(wrapped, segments, authoritativeStatData)
    if (matched && matched.tupleIndex === null) {
      if (lockHidden || incoming === undefined || incoming === MVU_HIDDEN_SENTINEL || incoming === formatMvuHiddenValue(auth, matched.rule)) {
        return mvuVisClone(auth)
      }
      return incoming
    }
    if (mvuVisPlainObject(incoming) && mvuVisPlainObject(auth)) {
      const out = Object.assign({}, incoming)
      for (const [key, authChild] of Object.entries(auth)) {
        if (key.startsWith('$')) continue
        const childSegs = segments.concat(key)
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          out[key] = restoreNode(out[key], authChild, childSegs)
        } else if (lockHidden && matchMvuVisibilityRule(wrapped, childSegs, authoritativeStatData)) {
          out[key] = mvuVisClone(authChild)
        }
      }
      return out
    }
    if (Array.isArray(incoming) && Array.isArray(auth)) {
      return incoming.map((item, idx) => idx < auth.length ? restoreNode(item, auth[idx], segments.concat(String(idx))) : item)
    }
    return incoming
  }

  return restoreNode(mvuVisClone(incomingStatData), authoritativeStatData, [])
}

function maskTavernReadVariablesResultText(resultText, visibility) {
  const rules = normalizeMvuVisibility(visibility)
  if (!rules || typeof resultText !== 'string' || !resultText.trim().startsWith('{')) return resultText
  try {
    const parsed = JSON.parse(resultText)
    if (!mvuVisPlainObject(parsed) || parsed.available !== true) return resultText
    const wrapped = { __mvuVisibilityNormalized: true, rules }
    let changed = false
    if (typeof parsed.path === 'string' && parsed.path !== '' && Object.prototype.hasOwnProperty.call(parsed, 'value')) {
      const matched = matchMvuVisibilityRule(wrapped, parsed.path, null)
      if (matched) {
        parsed.value = formatMvuHiddenValue(parsed.value, matched.rule)
        parsed.hidden = true
        changed = true
      }
    }
    if (Array.isArray(parsed.entries)) {
      parsed.entries = parsed.entries.map(entry => {
        if (!mvuVisPlainObject(entry) || typeof entry.path !== 'string') return entry
        const matched = matchMvuVisibilityRule(wrapped, entry.path, null)
        if (!matched) return entry
        changed = true
        const next = Object.assign({}, entry, { hidden: true })
        if (Object.prototype.hasOwnProperty.call(next, 'value')) next.value = formatMvuHiddenValue(next.value, matched.rule)
        return next
      })
    }
    return changed ? JSON.stringify(parsed) : resultText
  } catch (_error) {
    return resultText
  }
}

function extractInlineInitvarVisibility(text) {
  const block = /<initvar>([\s\S]*?)<\/initvar>/i.exec(mvuVisStr(text))
  const source = block ? block[1] : mvuVisStr(text)
  const cleaned = source.replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').trim()
  if (!cleaned.startsWith('{')) return null
  try {
    const parsed = JSON.parse(cleaned)
    const meta = mvuVisPlainObject(parsed && parsed.$meta) ? parsed.$meta : null
    const rawVis = meta ? (meta.visibility || meta.hidden) : null
    return normalizeMvuVisibility(rawVis)
  } catch (_error) {
    return null
  }
}

function extractCardMvuVisibility(cardData) {
  if (!mvuVisPlainObject(cardData)) return null
  const data = (cardData.spec === 'chara_card_v2' || cardData.spec === 'chara_card_v3') && mvuVisPlainObject(cardData.data) ? cardData.data : cardData
  const extVis = normalizeMvuVisibility(data.extensions && data.extensions.dsh_tavern && data.extensions.dsh_tavern.mvuVisibility)
  let inlineVis = extractInlineInitvarVisibility(data.first_mes)
  if (!inlineVis && Array.isArray(data.character_book && data.character_book.entries)) {
    const initEntry = data.character_book.entries.find(entry => /^\s*\[initvar\]/i.test(mvuVisStr(entry && (entry.comment || entry.name))))
    if (initEntry && /<initvar>|\$meta/.test(mvuVisStr(initEntry.content))) inlineVis = extractInlineInitvarVisibility(initEntry.content)
  }
  if (extVis && inlineVis) return Object.assign({}, inlineVis, extVis)
  return extVis || inlineVis || null
}

export {
  MVU_HIDDEN_SENTINEL,
  normalizeMvuVisibilityPointer,
  validateMvuVisibility,
  normalizeMvuVisibility,
  hasMvuVisibilityRules,
  isMvuPathRevealed,
  matchMvuVisibilityRule,
  unwrapMvuScalar,
  parseMvuFiniteNumber,
  resolveMvuTierLabel,
  formatMvuHiddenValue,
  describeMvuHiddenChange,
  maskMvuStatDataForDisplay,
  maskMvuStatDataForEditor,
  describeMvuEditorNode,
  maskMvuHelperMessageRow,
  maskMvuReceipt,
  restoreHiddenMvuStatData,
  maskTavernReadVariablesResultText,
  extractCardMvuVisibility
}
