import { stripBubbleCodeQuote } from '../../src/client/bubble-line.cjs'
import { mayHaveLegacyTemplateDamage, repairLegacyTemplateDisplay } from './legacy-template-display-repair.js'
import { projectDisplayParts } from './display-source.js'
export { editableReplyParts, projectDisplayParts, hasHtmlCodeBlock, displayModeOf } from './display-source.js'
import { visibleTemplateDisplay, annotateTemplateStatusParts } from './template-variable-display.js'
import { createHash } from 'node:crypto'
import { applyTavernRegexText } from './tavern-regex-display.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Display refreshes resolve identity only; never replay stateful/random macros. */
export function resolveDisplayIdentityMacros(value, options = {}) {
  return str(value).replace(/\{\{\s*(user|char)\s*\}\}|<(user|char)>/gi, (token, macro, legacy) => {
    if ((macro || legacy).toLowerCase() === 'user') return str(options.macroState?.userName) || '你'
    return str(options.charName) || token
  })
}

function targetOptions(options, isMarkdown) {
  return {
    placement: options.placement,
    isMarkdown,
    isEdit: options.isEdit,
    depth: options.depth
  }
}

/**
 * Project one authoritative model reply independently for Session and display.
 * Regex execution only transforms strings; it never extracts HTML or changes
 * where matched content belongs in the message.
 */
export function projectReplyLayers(value, options = {}) {
  const sourceText = str(value)
  const projectionText = Object.prototype.hasOwnProperty.call(options, 'projectionText')
    ? str(options.projectionText)
    : sourceText
  const scripts = Array.isArray(options.regexScripts) ? options.regexScripts : []
  const session = applyTavernRegexText(projectionText, scripts, targetOptions(options, false))
  const displayOptions = targetOptions(options, true)
  let display = applyTavernRegexText(projectionText, scripts, displayOptions)
  // Some cards encode dialogue inside now_plot. Recover an omitted wrapper
  // only when that card's own active renderer recognizes the repaired text.
  // Never persist this display repair into model context or editable source.
  if (projectionText.split('\n').some(line => /^\s*@bubble:/.test(stripBubbleCodeQuote(line))) && !/<\/?now_plot\b/i.test(projectionText)) {
    const candidates = scripts.filter(script =>
      str(script.findRegex).includes('<now_plot>') &&
      str(script.replaceString).includes('@bubble')
    )
    const wrapped = '<now_plot>\n' + projectionText + '\n</now_plot>'
    const probe = applyTavernRegexText(wrapped, candidates, displayOptions)
    if (probe.applied.length > 0) {
      display = applyTavernRegexText(wrapped, scripts, displayOptions)
      display.warnings.push('气泡显示：已为卡片渲染规则补齐缺失的 now_plot 标签（仅显示）')
    }
  }
  display.text = resolveDisplayIdentityMacros(display.text, options)
  const displayProjection = projectDisplayParts(display.text)
  const displayMode = displayProjection.parts.some(part => part.kind === 'html') ? 'html' : 'markdown'

  return {
    sourceText,
    projectionText,
    sessionText: session.text,
    displayText: display.text,
    displayMode,
    displayParts: displayProjection.parts,
    applied: {
      session: session.applied,
      display: display.applied
    },
    warnings: session.warnings.map(function (warning) { return 'Session：' + warning })
      .concat(display.warnings.map(function (warning) { return '展示：' + warning }))
      .concat(displayProjection.warnings)
  }
}

/** Strip markup for equality checks; comments and tags contribute no text. */
function stripHtmlTags(value) {
  return str(value).replace(/<!--[\s\S]*?-->|<[^>]+>/g, '')
}

/** Tags with attributes imply author/UI HTML, not a plain markdown wrap. */
function hasAttributedHtmlTags(value) {
  return /<[a-z][\w:-]*\s+[^>\/]/i.test(str(value))
}

/**
 * Degenerate template_display: markdown wrapped the body (e.g. &lt;p&gt;…&lt;/p&gt;)
 * without EJS/author markup. Using it as a single html part sends the whole
 * message into the iframe and enlarges native body font size.
 */
function isDegenerateTemplateDisplay(html, sourceText, options = {}) {
  if (hasAttributedHtmlTags(html)) return false
  const expected = resolveDisplayIdentityMacros(
    str(sourceText).replace(/<\/?mvu-status\b[^>]*>/gi, ''),
    options
  )
  return stripHtmlTags(html) === expected
}

/** Bound retained projection data as well as entry count; oversized replies bypass caching. */
export function createReplyHistoryProjector({ maxCacheBytes = 16 * 1024 * 1024, maxCacheEntries = 2048 } = {}) {
  const cache = new Map()
  let bytes = 0, hits = 0, misses = 0, copies = 0
  function digest(value) { return createHash('sha256').update(value).digest('hex') }
  function projectCached(sourceText, projectionText, options, signature) {
    const key = createHash('sha256').update(signature).update(String(sourceText.length) + ':')
      .update(sourceText).update(String(projectionText.length) + ':').update(projectionText).digest('hex')
    let item = cache.get(key)
    if (item) {
      hits++
      cache.delete(key)
      cache.set(key, item)
    } else {
      misses++
      const projected = projectReplyLayers(sourceText, Object.assign({}, options, { projectionText }))
      const value = { displayText: projected.displayText, displayMode: projected.displayMode,
        displayParts: projected.displayParts, warnings: projected.warnings }
      // This is a conservative payload estimate, not a measurement of V8 heap usage.
      const size = value.displayText.length * 2 > maxCacheBytes ? Infinity : JSON.stringify(value).length * 2 + 256
      if (size > maxCacheBytes || maxCacheEntries <= 0) return value
      while (cache.size && (bytes + size > maxCacheBytes || cache.size >= maxCacheEntries)) {
        const oldest = cache.keys().next().value
        bytes -= cache.get(oldest).size
        cache.delete(oldest)
      }
      item = { value, size }
      cache.set(key, item)
      bytes += size
    }
    return item.value
  }
  function signatureOf(options) {
    return digest(JSON.stringify({ regexScripts: options.regexScripts || [],
      charName: options.charName, userName: options.macroState?.userName,
      placement: options.placement, isEdit: options.isEdit, depth: options.depth }))
  }
  function projectHistory(messages, options = {}, signature = signatureOf(options)) {
    const projections = []
    let inferredTurn = 1
    let latestSourceBacked = false

    for (const message of Array.isArray(messages) ? messages : []) {
      if (message === null || typeof message !== 'object') continue
      if (message.role === 'user') {
        inferredTurn += 1
        continue
      }
      if (message.role !== 'assistant') continue

      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
      if (turn === 0) continue
      const hasSource = Object.prototype.hasOwnProperty.call(message, 'sourceText')
      const sourceText = hasSource ? str(message.sourceText) : str(message.text)
      const projectionText = Object.prototype.hasOwnProperty.call(message, 'projectionText')
        ? str(message.projectionText)
        : sourceText

      const templateDisplay = message.tavernPluginData?.template_display
      const validDisplay = templateDisplay && templateDisplay.source === sourceText && templateDisplay.swipe === (message.swipeId || 0)
      const ordinaryDisplay = validDisplay && typeof templateDisplay.formattingText === 'string'
      if (validDisplay && !ordinaryDisplay
        && !isDegenerateTemplateDisplay(templateDisplay.html, sourceText, options)) {
        let repaired = templateDisplay
        if (mayHaveLegacyTemplateDamage(templateDisplay)) {
          // Historical recovery needs proof of an author's original script, not
          // a replay of every current display rewrite. Test source and each rich
          // renderer independently; unmatched/changed implementations stay frozen.
          const richRules = (options.regexScripts || []).filter(rule => /<(?:script|style)\b/i.test(str(rule.replaceString)))
          for (const rules of [[], ...richRules.map(rule => [rule])]) {
            const recoveryOptions = {...options, regexScripts:rules}
            const candidate = projectCached(sourceText, projectionText, recoveryOptions, signatureOf(recoveryOptions))
            repaired = repairLegacyTemplateDisplay(repaired, candidate)
          }
        }
        const visible = visibleTemplateDisplay(repaired)
        projections.push({ version: 2, turn, text: visible.html, mode: 'html', parts: Array.isArray(visible.parts) ? structuredClone(visible.parts) : [{ kind: 'html', content: visible.html }], warnings: [] })
        latestSourceBacked = hasSource
        continue
      }
      const projected = ordinaryDisplay
        ? projectCached(sourceText, templateDisplay.formattingText, { ...options, regexScripts: [] }, signatureOf({ ...options, regexScripts: [] }))
        : projectCached(sourceText, projectionText, options, signature)
      // Copy emitted projections; callers must never mutate cached parts.
      copies++
      projections.push({
        version: 2,
        turn,
        text: projected.displayText,
        mode: projected.displayMode,
        parts: ordinaryDisplay ? annotateTemplateStatusParts(projected.displayParts, templateDisplay.html) : structuredClone(projected.displayParts),
        warnings: [...projected.warnings]
      })
      latestSourceBacked = hasSource
    }

    return { projections, presentation: null, latestSourceBacked }
  }
  projectHistory.prepare = options => {
    const snapshot = structuredClone(options), signature = signatureOf(snapshot)
    return messages => projectHistory(messages, snapshot, signature)
  }
  projectHistory.cacheStats = () => ({ entries: cache.size, estimatedBytes: bytes, hits, misses, copies })
  return projectHistory
}

export const projectReplyHistory = createReplyHistoryProjector()
