// Prefix-based prompt cache analysis between the latest request and its
// immediate predecessor in the same session. Pure functions only.

const CATALOG_PATTERN = /<system-reminder>\n(?:A skill is a reusable set of task-specific instructions\. The following skills are available in this session:|The available skill catalog changed\. This complete catalog replaces every earlier available-skills list in this session:)[\s\S]*?<\/system-reminder>/g

const PRESET_PHASE_LABELS = {
  'tavern:runtime-preset-front': '预设前段',
  'tavern:runtime-preset-middle': '预设中段',
  'tavern:runtime-preset-back': '预设后段'
}

const MAX_DIFF_LINES = 80
const MAX_LCS_CELLS = 250000

// Matches the client's offline heuristic (estimateTavernTokens).
export function estimateRequestTokens(text) {
  let halfTokens = 0
  for (const piece of String(text ?? '').match(/[A-Za-z]+|[0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\r?\n|[^\p{L}\p{N}\s]+|[^\s]/gu) || []) {
    if (/^[A-Za-z]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 4)
    else if (/^[0-9]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 3)
    else if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(piece)) halfTokens += 3
    else halfTokens += 2 * Math.ceil([...piece].length / 2)
  }
  return Math.ceil(halfTokens / 2)
}

function sectionLabel(name, rest) {
  if (name === 'tavern:runtime-preset-front') return '前段预设'
  if (name === 'tavern:runtime-preset-middle') return '中段预设'
  if (name === 'tavern:runtime-preset-back') return '末尾预设投影'
  if (name === 'tavern:constant-worldbook') return '常驻世界书'
  if (name === 'tavern:worldbook-skills') return '世界书 Skill'
  if (name === 'tavern:character-card') return '人物卡'
  if (name === 'tavern:card-system-prompt' || name === 'tavern:card-system') return '人物卡系统提示'
  if (name === 'tavern:card-reference') return '人物卡参考'
  if (name === 'tavern:user-preference') return '长期偏好'
  if (name === 'tavern:variable-directory') return '变量目录'
  if (name === 'tavern:resource-workspace') return '工作区资源'
  if (name === 'tavern:system-append') return '系统追加'
  if (name === 'tavern:plugin-body-generation' || name === 'tavern:plugin-body-generation-reminder') return '正文生成规范'
  if (name === 'tavern:story-tool-submission' || name === 'tavern:story-tool-submission-reminder') return '工具提交规范'
  if (name === 'tavern:no-foreground-tools') return '工具禁用说明'
  if (name === 'tavern:foreground-style-reference') return '文风参考'
  if (name === 'tavern:foreground-candidates') return '候选参考'
  if (name === 'tavern:session-context') return '会话上下文'
  if (name.includes(':writingRules:')) return '写作规则'
  if (name.includes(':activeWorldbook:')) return '本轮世界书'
  if (name.includes(':currentStateProjection:')) return '当前状态'
  if (name === 'tavern:dsh-system' || name === 'tavern:turn') return rest
  return name || '附加上下文'
}

function extractMessageDisplayParts(message) {
  let displayParts = []
  for (const block of (Array.isArray(message?.content) ? message.content : [message?.content])) {
    const plain = typeof block === 'string'
      ? block
      : block?.type === 'text' && Object.keys(block).every(key => key === 'type' || key === 'text')
        ? block.text
        : undefined
    if (typeof plain !== 'string') {
      const text = JSON.stringify(block, null, 2)
      if (text !== undefined) displayParts.push({ text })
      continue
    }
    let cursor = 0
    for (const match of plain.matchAll(CATALOG_PATTERN)) {
      if (match.index > cursor) displayParts.push({ text: plain.slice(cursor, match.index), label: message?.role === 'user' ? '消息正文' : undefined })
      displayParts.push({ text: match[0], label: '系统附加 · Skill 目录', catalog: true })
      cursor = match.index + match[0].length
    }
    if (cursor < plain.length || !plain.length) displayParts.push({ text: plain.slice(cursor), label: cursor ? '消息正文' : undefined })
  }

  const sourceSections = (message?.source?.sections || []).filter(section => typeof section?.text === 'string' && section.text.length)
  if (sourceSections.length && displayParts.length === 1 && !displayParts[0].catalog) {
    const text = displayParts[0].text
    const rest = message?.role === 'system' ? '系统提示词' : '消息正文'
    const parts = []
    let cursor = 0
    let aligned = true
    for (const section of sourceSections) {
      const start = text.indexOf(section.text, cursor)
      if (start < 0 || text.indexOf(section.text, start + section.text.length) >= 0) {
        aligned = false
        break
      }
      if (start > cursor) parts.push({ text: text.slice(cursor, start), label: text.slice(cursor, start).trim() ? rest : undefined })
      const name = section.name || ''
      parts.push({
        text: section.text,
        label: sectionLabel(name, rest),
        presetPhase: PRESET_PHASE_LABELS[name] ? name : undefined
      })
      cursor = start + section.text.length
    }
    if (aligned) {
      if (cursor < text.length) parts.push({ text: text.slice(cursor), label: text.slice(cursor).trim() ? rest : undefined })
      displayParts = parts
    }
  }
  return displayParts
}

// Produces the exact ordered prompt prefix units matching FullRequestContextView's
// section layout (excluding non-prefix metadata): system -> leading system messages
// -> tools -> remaining messages, with presetPhase splits preserved.
export function extractPrefixSlots(request) {
  if (!request || typeof request !== 'object') return []
  const raw = []

  function pushField(key, label) {
    if (!Object.hasOwn(request, key)) return
    const value = request[key]
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    raw.push({
      key: 'field:' + key,
      kind: key,
      title: key + ' · ' + label,
      canonical: key + '\u0000' + (typeof value === 'string' ? value : JSON.stringify(value)),
      text,
      parts: [{ text, label }]
    })
  }

  function pushMessage(message, index) {
    const role = message?.role || '消息'
    const displayParts = extractMessageDisplayParts(message)
    const baseTitle = 'messages[' + index + '] · ' + role
    const hasPresetPhase = displayParts.some(part => part.presetPhase)
    if (!hasPresetPhase) {
      const text = displayParts.map(part => part.text).join('\n\n')
      // Use raw message content/role/tool_calls for canonical equality so non-text
      // fields (like tool_calls / tool_call_id) also detect prefix breaks.
      const canonicalPayload = { role: message?.role ?? null, content: message?.content ?? null }
      if (message?.tool_calls !== undefined) canonicalPayload.tool_calls = message.tool_calls
      if (message?.tool_call_id !== undefined) canonicalPayload.tool_call_id = message.tool_call_id
      if (message?.name !== undefined) canonicalPayload.name = message.name
      raw.push({
        key: 'msg:' + index,
        kind: 'message',
        messageIndex: index,
        role,
        title: baseTitle,
        canonical: 'msg\u0000' + JSON.stringify(canonicalPayload),
        text,
        parts: displayParts
      })
      return
    }
    const groups = []
    for (const part of displayParts) {
      const previous = groups[groups.length - 1]
      const phase = part.text.trim() ? (part.presetPhase || '') : (previous?.phase || '')
      if (previous && previous.phase === phase) previous.parts.push(part)
      else groups.push({ phase, parts: [part] })
    }
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]
      const text = group.parts.map(part => part.text).join('\n\n')
      const phaseTitle = group.phase ? (PRESET_PHASE_LABELS[group.phase] || '预设中段') : '消息正文'
      raw.push({
        key: 'msg:' + index + ':' + groupIndex,
        kind: 'message',
        messageIndex: index,
        groupIndex,
        role,
        title: baseTitle + ' · ' + phaseTitle,
        canonical: 'msg-group\u0000' + role + '\u0000' + group.phase + '\u0000' + text,
        text,
        parts: group.parts
      })
    }
  }

  pushField('system', '系统提示词')
  const messages = request.messages
  let firstOrdinary = 0
  if (Array.isArray(messages)) {
    while (firstOrdinary < messages.length && messages[firstOrdinary]?.role === 'system') {
      pushMessage(messages[firstOrdinary], firstOrdinary)
      firstOrdinary++
    }
  }
  pushField('tools', '工具定义')
  if (Array.isArray(messages) && messages.length) {
    for (let index = firstOrdinary; index < messages.length; index++) pushMessage(messages[index], index)
  } else if (Object.hasOwn(request, 'messages')) {
    pushField('messages', '消息')
  }

  return raw.map(slot => ({
    ...slot,
    tokens: estimateRequestTokens(slot.text)
  }))
}

function splitLines(text) {
  if (!text) return []
  return String(text).replace(/\r\n?/g, '\n').split('\n')
}

// Fast bounded line diff: strips common prefix/suffix lines first, runs LCS
// when the differing core is small, and degrades cleanly on huge rewrites.
export function computeLineDiff(beforeText, afterText, maxLines = MAX_DIFF_LINES) {
  const before = splitLines(beforeText)
  const after = splitLines(afterText)

  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++

  const midBefore = before.slice(prefix, before.length - suffix)
  const midAfter = after.slice(prefix, after.length - suffix)

  const ops = []
  let addedLines = 0
  let removedLines = 0
  let addedChars = 0
  let removedChars = 0

  if (midBefore.length === 0 && midAfter.length === 0) {
    return { lines: [], addedLines: 0, removedLines: 0, addedChars: 0, removedChars: 0, truncated: false, firstChangedLine: 0 }
  }

  // Leading context (up to 2 lines)
  const contextBeforeStart = Math.max(0, prefix - 2)
  for (let i = contextBeforeStart; i < prefix; i++) {
    ops.push({ type: 'ctx', text: before[i], oldLine: i + 1, newLine: i + 1 })
  }

  if (midBefore.length * midAfter.length <= MAX_LCS_CELLS) {
    const m = midBefore.length
    const n = midAfter.length
    // Flat Uint32Array DP table for speed and low GC pressure
    const dp = new Uint32Array((m + 1) * (n + 1))
    const stride = n + 1
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (midBefore[i] === midAfter[j]) dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)] + 1
        else dp[i * stride + j] = Math.max(dp[(i + 1) * stride + j], dp[i * stride + (j + 1)])
      }
    }
    let i = 0
    let j = 0
    while (i < m && j < n) {
      if (midBefore[i] === midAfter[j]) {
        ops.push({ type: 'ctx', text: midBefore[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 })
        i++
        j++
      } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
        ops.push({ type: 'del', text: midBefore[i], oldLine: prefix + i + 1 })
        removedLines++
        removedChars += midBefore[i].length
        i++
      } else {
        ops.push({ type: 'add', text: midAfter[j], newLine: prefix + j + 1 })
        addedLines++
        addedChars += midAfter[j].length
        j++
      }
    }
    while (i < m) {
      ops.push({ type: 'del', text: midBefore[i], oldLine: prefix + i + 1 })
      removedLines++
      removedChars += midBefore[i].length
      i++
    }
    while (j < n) {
      ops.push({ type: 'add', text: midAfter[j], newLine: prefix + j + 1 })
      addedLines++
      addedChars += midAfter[j].length
      j++
    }
  } else {
    // Large rewrite fallback: count all lines/chars and emit compact head preview
    for (const line of midBefore) { removedLines++; removedChars += line.length }
    for (const line of midAfter) { addedLines++; addedChars += line.length }
    const previewCap = Math.max(6, Math.floor((maxLines - 6) / 2))
    for (let i = 0; i < Math.min(midBefore.length, previewCap); i++) {
      ops.push({ type: 'del', text: midBefore[i], oldLine: prefix + i + 1 })
    }
    if (midBefore.length > previewCap) {
      ops.push({ type: 'omit', text: '… 省略其余 ' + (midBefore.length - previewCap) + ' 行删除内容 …' })
    }
    for (let j = 0; j < Math.min(midAfter.length, previewCap); j++) {
      ops.push({ type: 'add', text: midAfter[j], newLine: prefix + j + 1 })
    }
    if (midAfter.length > previewCap) {
      ops.push({ type: 'omit', text: '… 省略其余 ' + (midAfter.length - previewCap) + ' 行新增内容 …' })
    }
  }

  // Trailing context (up to 2 lines)
  const suffixStartBefore = before.length - suffix
  const suffixStartAfter = after.length - suffix
  for (let k = 0; k < Math.min(2, suffix); k++) {
    ops.push({ type: 'ctx', text: before[suffixStartBefore + k], oldLine: suffixStartBefore + k + 1, newLine: suffixStartAfter + k + 1 })
  }

  // Collapse long unchanged context runs inside the middle
  const compacted = []
  let ctxRun = []
  function flushCtx() {
    if (ctxRun.length <= 5) {
      compacted.push(...ctxRun)
    } else {
      compacted.push(ctxRun[0], ctxRun[1])
      compacted.push({ type: 'omit', text: '… 省略 ' + (ctxRun.length - 4) + ' 行未变动内容 …' })
      compacted.push(ctxRun[ctxRun.length - 2], ctxRun[ctxRun.length - 1])
    }
    ctxRun = []
  }
  for (const op of ops) {
    if (op.type === 'ctx') ctxRun.push(op)
    else { flushCtx(); compacted.push(op) }
  }
  flushCtx()

  const truncated = compacted.length > maxLines
  const lines = (truncated ? compacted.slice(0, maxLines) : compacted).map(item => ({
    ...item,
    text: item.text.length > 400 ? item.text.slice(0, 400) + '…' : item.text
  }))

  return {
    lines,
    addedLines,
    removedLines,
    addedChars,
    removedChars,
    truncated,
    firstChangedLine: prefix + 1
  }
}

function findDifferingPartLabel(prevSlot, curSlot) {
  const prevParts = (prevSlot?.parts || []).filter(p => p?.text?.trim())
  const curParts = (curSlot?.parts || []).filter(p => p?.text?.trim())
  if (!curParts.length) return null
  const limit = Math.min(prevParts.length, curParts.length)
  for (let i = 0; i < limit; i++) {
    if (prevParts[i].text !== curParts[i].text || prevParts[i].label !== curParts[i].label) {
      return {
        label: curParts[i].label || prevParts[i].label || null,
        beforeText: prevParts[i].text,
        afterText: curParts[i].text,
        partIndex: i
      }
    }
  }
  if (curParts.length > prevParts.length) {
    const added = curParts[limit]
    return { label: added.label || null, beforeText: '', afterText: added.text, partIndex: limit }
  }
  if (prevParts.length > curParts.length) {
    const removed = prevParts[limit]
    return { label: removed.label || null, beforeText: removed.text, afterText: '', partIndex: limit }
  }
  return null
}

function summarizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const hasAny = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some(key => Number.isSafeInteger(usage[key]))
  if (!hasAny) return null
  const inputTokens = Number.isSafeInteger(usage.inputTokens) ? usage.inputTokens : 0
  const cacheReadTokens = Number.isSafeInteger(usage.cacheReadTokens) ? usage.cacheReadTokens : 0
  const cacheWriteTokens = Number.isSafeInteger(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0
  const outputTokens = Number.isSafeInteger(usage.outputTokens) ? usage.outputTokens : 0
  const totalInputTokens = inputTokens + cacheReadTokens + cacheWriteTokens
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    ...(Number.isSafeInteger(usage.cacheWrite1hTokens) ? { cacheWrite1hTokens: usage.cacheWrite1hTokens } : {}),
    ...(Number.isSafeInteger(usage.cacheWrite5mTokens) ? { cacheWrite5mTokens: usage.cacheWrite5mTokens } : {}),
    totalInputTokens,
    hitRate: totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : null
  }
}

export function computeRequestCacheDiff(currentRecord, previousRecord, previousEntry) {
  const usage = summarizeUsage(currentRecord?.usage)
  const curRequest = currentRecord?.request
  const curSlots = extractPrefixSlots(curRequest)
  const estimatedTotalTokens = curSlots.reduce((sum, slot) => sum + slot.tokens, 0)

  if (!previousEntry) {
    return {
      compareStatus: 'no-previous',
      usage,
      baseline: null,
      modelChanged: false,
      sectionStatus: {},
      breakPoint: null,
      estimated: {
        totalTokens: estimatedTotalTokens,
        hitTokens: 0,
        breakTokens: 0,
        cascadeTokens: 0,
        appendedTokens: estimatedTotalTokens,
        prefixHitRate: null
      },
      zeroReadReason: usage && usage.totalInputTokens > 0 && usage.cacheReadTokens === 0 ? 'first-request' : null
    }
  }

  const baselineMeta = {
    id: previousEntry.id || previousRecord?.id || '',
    turn: previousEntry.turn ?? previousRecord?.turn ?? 0,
    step: previousEntry.step ?? previousRecord?.step ?? 1,
    createdAt: previousEntry.createdAt ?? previousRecord?.createdAt ?? 0,
    model: previousRecord?.request?.model || ''
  }

  if (!previousRecord?.request) {
    return {
      compareStatus: 'baseline-pruned',
      usage,
      baseline: { ...baselineMeta, pruned: true },
      modelChanged: false,
      sectionStatus: {},
      breakPoint: null,
      estimated: {
        totalTokens: estimatedTotalTokens,
        hitTokens: 0,
        breakTokens: 0,
        cascadeTokens: 0,
        appendedTokens: 0,
        prefixHitRate: null
      },
      zeroReadReason: null
    }
  }

  const prevRequest = previousRecord.request
  const prevSlots = extractPrefixSlots(prevRequest)
  const prevModel = String(prevRequest.model || '')
  const curModel = String(curRequest?.model || '')
  const modelChanged = Boolean(prevModel && curModel && prevModel !== curModel)

  const sectionStatus = {}
  let breakPoint = null
  let hitTokens = 0
  let breakTokens = 0
  let cascadeTokens = 0
  let appendedTokens = 0

  if (modelChanged) {
    sectionStatus['field:metadata'] = 'break'
    const prevCanonicals = new Set(prevSlots.map(slot => slot.canonical))
    let cascadeCount = 0
    for (let i = 0; i < curSlots.length; i++) {
      const slot = curSlots[i]
      if (i < prevSlots.length || prevCanonicals.has(slot.canonical)) {
        sectionStatus[slot.key] = 'cascade'
        cascadeTokens += slot.tokens
        cascadeCount++
      } else {
        sectionStatus[slot.key] = 'appended'
        appendedTokens += slot.tokens
      }
    }
    breakPoint = {
      kind: 'model',
      key: 'field:metadata',
      title: '调用参数 · 模型变更',
      previousModel: prevModel,
      currentModel: curModel,
      affectedSections: cascadeCount,
      affectedTokens: cascadeTokens,
      diff: null
    }
  } else {
    let breakIndex = -1
    const overlap = Math.min(curSlots.length, prevSlots.length)
    for (let i = 0; i < overlap; i++) {
      if (curSlots[i].canonical === prevSlots[i].canonical) {
        sectionStatus[curSlots[i].key] = 'hit'
        hitTokens += curSlots[i].tokens
      } else {
        breakIndex = i
        break
      }
    }

    if (breakIndex >= 0) {
      const curBreak = curSlots[breakIndex]
      const prevBreak = prevSlots[breakIndex]
      sectionStatus[curBreak.key] = 'break'
      const roleChanged = curBreak.kind === 'message' && prevBreak.kind === 'message' && curBreak.role !== prevBreak.role

      const remainingPrevCanonicals = new Set(prevSlots.slice(breakIndex + 1).map(slot => slot.canonical))
      let cascadeCount = 0
      for (let j = breakIndex + 1; j < curSlots.length; j++) {
        const slot = curSlots[j]
        if (j < prevSlots.length || remainingPrevCanonicals.has(slot.canonical)) {
          sectionStatus[slot.key] = 'cascade'
          cascadeTokens += slot.tokens
          cascadeCount++
        } else {
          sectionStatus[slot.key] = 'appended'
          appendedTokens += slot.tokens
        }
      }

      const partDiff = roleChanged ? null : findDifferingPartLabel(prevBreak, curBreak)
      const curParts = (curBreak.parts || []).filter(p => p?.text?.trim())
      if (partDiff && Number.isInteger(partDiff.partIndex) && curParts.length > 0) {
        const idx = partDiff.partIndex
        if (idx >= curParts.length) {
          hitTokens += curBreak.tokens
          breakTokens = 0
        } else {
          const prefixHitTokens = curParts.slice(0, idx).reduce((sum, p) => sum + estimateRequestTokens(p.text), 0)
          const partHit = Math.min(curBreak.tokens, prefixHitTokens)
          const remaining = curBreak.tokens - partHit
          if (idx === curParts.length - 1) {
            hitTokens += partHit
            breakTokens = remaining
          } else {
            const partBreak = Math.min(remaining, estimateRequestTokens(curParts[idx].text))
            hitTokens += partHit
            breakTokens = partBreak
            cascadeTokens += remaining - partBreak
          }
        }
      } else {
        breakTokens = curBreak.tokens
      }

      const diff = partDiff
        ? computeLineDiff(partDiff.beforeText, partDiff.afterText)
        : computeLineDiff(prevBreak.text, curBreak.text)

      breakPoint = {
        kind: curBreak.kind,
        key: curBreak.key,
        title: curBreak.title,
        partLabel: partDiff?.label || null,
        partIndex: partDiff?.partIndex ?? null,
        previousTitle: prevBreak.title,
        roleChanged,
        affectedSections: cascadeCount,
        affectedTokens: cascadeTokens,
        breakTokens,
        diff
      }
    } else {
      // No prefix break: all overlapping slots hit; extra tail slots are appended.
      for (let j = overlap; j < curSlots.length; j++) {
        sectionStatus[curSlots[j].key] = 'appended'
        appendedTokens += curSlots[j].tokens
      }
    }
  }

  const prefixHitRate = estimatedTotalTokens > 0 ? hitTokens / estimatedTotalTokens : null
  let zeroReadReason = null
  if (usage && usage.totalInputTokens > 0 && usage.cacheReadTokens === 0) {
    if (modelChanged) zeroReadReason = 'model-changed'
    else if (!breakPoint) zeroReadReason = 'ttl-or-provider'
    else if (hitTokens < 1024) zeroReadReason = 'prefix-too-short'
    else zeroReadReason = 'prefix-broken'
  }

  return {
    compareStatus: 'compared',
    usage,
    baseline: baselineMeta,
    modelChanged,
    sectionStatus,
    breakPoint,
    estimated: {
      totalTokens: estimatedTotalTokens,
      hitTokens,
      breakTokens,
      cascadeTokens,
      appendedTokens,
      prefixHitRate
    },
    zeroReadReason
  }
}
