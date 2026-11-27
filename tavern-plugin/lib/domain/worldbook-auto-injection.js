import { bm25Scores, buildBm25Index, tokenizeBigram } from './bm25.js'
import { activateWorldBook, estimateWorldBookTokens, historyScanDepth, worldbookScanMessages, worldBookSettings } from './worldbook-activation.js'
import { worldbookEntryTitle } from './worldbook-entry-title.js'
import { formatWorldbookTitleHints } from './worldbook-title-hints.js'
import { virtualEntriesVersion, virtualEntryVersion } from './worldbook-virtual-state.js'

const MAX_ENTRIES = 5
const COOLDOWN_ROUNDS = 10
const STRATEGY_HISTORY_LIMIT = 20

export function recentCompletedWorldbookTurns(messages = []) {
  const turns = new Set()
  for (let i = messages.length - 1; i >= 0 && turns.size < COOLDOWN_ROUNDS; i--) {
    const row = messages[i]
    if (row?.role === 'assistant' && !row.placeholder && !row.greeting && Number.isSafeInteger(row.turn)) turns.add(row.turn)
  }
  return turns
}

export const hasWorldbookCooldownHistory = messages => recentCompletedWorldbookTurns(messages).size >= COOLDOWN_ROUNDS

/** Admit ordered static entries from the built-in ranker or the selected plugin. */
export function createWorldbookAutoInjection() {
  const corpora = new Map()
  function indexFor(entries) {
    const version = virtualEntriesVersion(entries)
    const cached = corpora.get(version)
    if (cached) return cached
    const index = buildBm25Index(entries.map(entry =>
      [worldbookEntryTitle(entry), ...(entry.primaryKeys || []), ...(entry.secondaryKeys || []), entry.content].join('\n')))
    corpora.set(version, index)
    if (corpora.size > 2) corpora.delete(corpora.keys().next().value)
    return index
  }
  function rankBuiltIn(input, entries, docs, isCoolingDown) {
    const matched = activateWorldBook({ ...input, entries, isCoolingDown, ignoreBudget: true })
    const docIndexes = new Map(docs.map((entry, index) => [entry.ref, index]))
    const query = matched.entries.length > 1
      ? [...worldbookScanMessages(input).slice(0, historyScanDepth(input.worldBook)).map(row => row.text), input.scanText].join('\n')
      : ''
    const scores = query ? bm25Scores(new Set(tokenizeBigram(query)), indexFor(docs), new Set(matched.entries.map(entry => docIndexes.get(entry.ref)))) : []
    // Stable sort keeps the author's activation priority on ties.
    return matched.entries.map(entry => ({ entry: docs[docIndexes.get(entry.ref)], score: scores[docIndexes.get(entry.ref)] || 0 }))
      .sort((a, b) => b.score - a.score)
  }

  return async function project(input, { entries, original, currentTurn, completedTurns, epoch, prior, strategy }) {
    const cooldown = new Map()
    if (prior?.epoch === epoch) {
      for (const entry of entries) {
        const receipt = prior.entries?.[entry.ref]
        if (receipt && completedTurns.has(receipt.turn) &&
            receipt.version === virtualEntryVersion(original.get(entry.ref) || entry)) cooldown.set(entry.ref, receipt)
      }
    }
    const isCoolingDown = entry => cooldown.has(entry.ref)
    const docs = entries.map(entry => original.get(entry.ref) || entry)
    let pluginRefs = null
    if (strategy) {
      const history = worldbookScanMessages({ ...input, userTextInHistory: true })
        .slice(0, STRATEGY_HISTORY_LIMIT).reverse().map(({ role, text, turn }) => ({ role, text, turn }))
      pluginRefs = await strategy.select({ history, scanText: input.scanText, entries: entries.map((entry, index) => ({
        ...entry, content: docs[index].content, coolingDown: isCoolingDown(entry)
      })) })
    }
    let ranked
    if (pluginRefs === null) {
      ranked = rankBuiltIn(input, entries, docs, isCoolingDown)
    } else {
      const byRef = new Map(docs.map(entry => [entry.ref, entry]))
      ranked = pluginRefs.map(ref => byRef.get(ref)).filter(entry => entry && !isCoolingDown(entry)).map(entry => ({ entry }))
    }
    const selected = [], refs = new Set()
    let remainingBudget = worldBookSettings(input.worldBook).tokenBudget
    for (const { entry, score } of ranked) {
      if (selected.length >= MAX_ENTRIES) break
      const title = worldbookEntryTitle(entry).slice(0, 120).replaceAll('】', '］')
      const text = '【世界书 · ' + title + '】\n' + entry.content
      const cost = estimateWorldBookTokens(text) + 2
      if (cost > remainingBudget) continue
      remainingBudget -= cost
      refs.add(entry.ref)
      cooldown.set(entry.ref, { turn: currentTurn, version: virtualEntryVersion(entry) })
      selected.push({ ref: entry.ref, title, text, score, location: 'foreground' })
    }
    const recentlyRead = new Set(input.recentlyReadRefs)
    const titleHints = formatWorldbookTitleHints(ranked.map(item => item.entry)
      .filter(entry => !refs.has(entry.ref) && !recentlyRead.has(entry.ref)))
    return { selected, titleHints, strategy: pluginRefs === null ? 'native-skills' : strategy.id, state: { epoch, entries: Object.fromEntries(cooldown) } }
  }
}
