import { classifyWorldbookEntry } from './worldbook-entry-classification.js'
import { mergeWorldBooks } from './worldbook-merge.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'
import { worldBookChannel } from './worldbook-channel.js'
import {
  DEFAULT_WORLD_BOOK_TOKEN_BUDGET,
  estimateWorldBookTokens,
  placementKey,
  promptOrder,
  worldBookSettings
} from './worldbook-activation.js'
import { computeWorldBookTailBudget } from './worldbook-layout-reorder.js'

// 内联正文预览上限（字符数）：常规条目直接 0 延迟展示，超长条目按需再拉全文。
export const WORLD_BOOK_LAYOUT_PREVIEW_LIMIT = 4000

function sourceKey(source) {
  if (!source || typeof source !== 'object') return ''
  return source.kind === 'card' ? 'card:' + String(source.cardPath || '') : 'standalone:' + String(source.path || '')
}

function buildBookOriginLookup(records, mergedSources) {
  const byMergedUid = new Map()
  if (!Array.isArray(mergedSources)) return byMergedUid

  mergedSources.forEach((sourceInfo, bookIndex) => {
    const record = records[bookIndex]
    const viewEntries = record?.view?.entries || []
    const queues = new Map()
    // 与 mergeWorldBooks 相同的展示顺序排队，确保嵌入书存在重复 id 时也能一对一映射回原 ref。
    const ordered = viewEntries.map((entry, index) => ({ entry, index }))
      .sort((a, b) => (Number(a.entry.displayIndex ?? a.index) - Number(b.entry.displayIndex ?? b.index)) || (a.index - b.index))
    for (const { entry } of ordered) {
      const uid = Number(entry.sourceUid)
      if (!queues.has(uid)) queues.set(uid, [])
      queues.get(uid).push(entry)
    }
    for (const mapping of sourceInfo.entries || []) {
      const queue = queues.get(Number(mapping.originalUid))
      const originalEntry = queue && queue.length ? queue.shift() : null
      if (originalEntry) {
        byMergedUid.set(Number(mapping.uid), { bookIndex, originalEntry })
      }
    }
  })

  return byMergedUid
}

/**
 * 基于与实际请求装配完全相同的合并、分类与排序函数，生成世界书常驻条目排布视图。
 * 保证 prefix 正文串联结果与 `projectVirtualWorldbookPrefix` / `foreground-worldbook` 的静态前缀一致，
 * tail 顺位与 `promptOrder` 一致，预算挤出判定与 `activateWorldBook` 一致。
 */
export function buildWorldBookPromptLayout({
  records = [],
  globalSourceKeys = new Set(),
  cardName = '',
  openingSnapshot = false,
  anchors = null
} = {}) {
  const list = Array.isArray(records) ? records.filter(Boolean) : []
  const globals = globalSourceKeys instanceof Set ? globalSourceKeys : new Set(globalSourceKeys || [])
  const books = list.map((record, bookIndex) => {
    const key = sourceKey(record.source)
    const isGlobal = record.isGlobal === true || (record.source?.kind === 'standalone' && globals.has(key))
    const isPrimary = record.isPrimary === true || (bookIndex === 0 && !isGlobal)
    return {
      index: bookIndex,
      key,
      source: record.source,
      name: record.view?.displayName || record.document?.name || '未命名世界书',
      format: record.view?.format || 'sillytavern-worldbook',
      channel: record.view?.channel || 'auto',
      isGlobal,
      isPrimary
    }
  })

  if (list.length === 0) {
    return {
      cardName: String(cardName || ''),
      openingSnapshot: openingSnapshot === true,
      books: [],
      prefix: [],
      tail: [],
      summary: {
        totalCount: 0,
        prefixCount: 0,
        tailCount: 0,
        totalTokens: 0,
        prefixTokens: 0,
        tailTokens: 0
      },
      budget: {
        limit: DEFAULT_WORLD_BOOK_TOKEN_BUDGET,
        hardLimit: DEFAULT_WORLD_BOOK_TOKEN_BUDGET * 2,
        used: 0,
        overflowed: false
      },
      anchors: anchors || null
    }
  }

  let effectiveRecord
  let originOf
  if (list.length === 1) {
    effectiveRecord = list[0]
    originOf = entry => ({ bookIndex: 0, originalEntry: entry })
  } else {
    const merged = mergeWorldBooks(list)
    const mergedView = inspectWorldBookDocument(merged.document)
    effectiveRecord = { source: list[0].source, document: merged.document, view: mergedView }
    const lookup = buildBookOriginLookup(list, merged.sources)
    originOf = entry => lookup.get(Number(entry.sourceUid)) || { bookIndex: 0, originalEntry: entry }
  }

  const enabled = (effectiveRecord.view?.entries || []).filter(entry => entry.enabled !== false && !isMvuUpdateEntry(entry))
  const prefixRaw = promptOrder(enabled.filter(entry => classifyWorldbookEntry(entry).kind === 'static-constant'))
  const tailRaw = promptOrder(enabled.filter(entry => {
    const type = classifyWorldbookEntry(entry)
    return type.kind === 'static-tail' || type.kind === 'dynamic-constant'
  }))

  const settings = worldBookSettings(effectiveRecord)

  const toItem = (entry, zone) => {
    const origin = originOf(entry)
    const book = books[origin.bookIndex] || books[0]
    const orig = origin.originalEntry || entry
    const type = classifyWorldbookEntry(entry)
    const content = String(orig.content ?? entry.content ?? '')
    const tokens = estimateWorldBookTokens(content)
    const channel = worldBookChannel(entry)
    const chargesBudget = channel === 'tail' || (entry.constant !== true && channel === 'auto')
    const budgetCost = chargesBudget ? tokens + 2 : 0
    return {
      id: `${book.index}:${orig.ref}`,
      mergedRef: entry.ref,
      bookIndex: book.index,
      bookName: book.name,
      bookSource: book.source,
      bookFormat: book.format,
      bookChannel: book.channel,
      bookIsGlobal: book.isGlobal,
      bookIsPrimary: book.isPrimary,
      entryRef: orig.ref,
      title: String(orig.comment || orig.title || '未命名条目'),
      tokens,
      budgetCost,
      chargesBudget,
      budgetEvicted: false,
      zone,
      kind: type.kind,
      dynamic: type.dynamic,
      lockedToTail: type.dynamic,
      constant: entry.constant === true,
      forcedChannel: entry.constant !== true && channel !== 'auto',
      channel,
      channelInherited: orig.channelInherited !== false,
      order: Number(orig.order ?? entry.order ?? 100),
      displayIndex: Number(entry.displayIndex ?? orig.displayIndex ?? 0),
      position: orig.position,
      placementKey: placementKey(entry),
      depth: Number(orig.depth ?? entry.depth ?? 4),
      role: Number(orig.role ?? entry.role ?? 0),
      primaryKeys: Array.isArray(orig.primaryKeys) ? orig.primaryKeys : [],
      preview: content.slice(0, WORLD_BOOK_LAYOUT_PREVIEW_LIMIT),
      contentLength: content.length,
      contentTruncated: content.length > WORLD_BOOK_LAYOUT_PREVIEW_LIMIT
    }
  }

  const prefix = prefixRaw.map(entry => toItem(entry, 'prefix'))
  const tail = tailRaw.map(entry => toItem(entry, 'tail'))

  const budget = computeWorldBookTailBudget(tail, settings.tokenBudget)
  for (const item of tail) item.budgetEvicted = budget.evictedIds.has(item.id)

  const prefixTokens = prefix.reduce((sum, item) => sum + item.tokens, 0)
  const tailTokens = tail.reduce((sum, item) => sum + item.tokens, 0)

  return {
    cardName: String(cardName || ''),
    openingSnapshot: openingSnapshot === true,
    books,
    prefix,
    tail,
    summary: {
      totalCount: prefix.length + tail.length,
      prefixCount: prefix.length,
      tailCount: tail.length,
      totalTokens: prefixTokens + tailTokens,
      prefixTokens,
      tailTokens
    },
    budget: {
      limit: budget.limit,
      hardLimit: budget.hardLimit,
      used: budget.used,
      overflowed: budget.overflowed
    },
    anchors: anchors || null
  }
}
