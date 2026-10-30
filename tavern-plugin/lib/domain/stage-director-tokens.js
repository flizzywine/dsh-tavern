// deterministic offline estimate, not a model tokenizer or a provider bill.
export function estimateDirectorTokens(text) {
  let halfTokens = 0
  const pieces = String(text ?? '').match(/[A-Za-z]+|[0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\r?\n|[^\p{L}\p{N}\s]+|[^\s]/gu) || []
  for (const piece of pieces) {
    if (/^[A-Za-z]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 4)
    else if (/^[0-9]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 3)
    else if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(piece)) halfTokens += 3
    else halfTokens += 2 * Math.ceil([...piece].length / 2)
  }
  return Math.ceil(halfTokens / 2)
}

export function directorPromptTokens(prompt, tool) {
  const seen = new Set()
  const sections = prompt.sections.map(section => {
    // The separator belongs to the following section; system and user have separate boundaries.
    const prefix = seen.has(section.role) ? '\n\n' : ''
    seen.add(section.role)
    const wireText = prefix + section.title + ':\n' + section.text
    return { ...section, tokens: estimateDirectorTokens(wireText) }
  })
  // Include tool name/description framing once; the pretty parameters are display-only.
  sections.push({ key: 'tool-schema', title: 'Tool schema', text: JSON.stringify(tool.parameters, null, 2), tokens: estimateDirectorTokens(JSON.stringify(tool)) })
  return { sections, totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0), tokenEstimate: { method: 'cjk-word-pieces-v1', approximate: true } }
}

// DSH usage buckets are disjoint: inputTokens excludes cache reads AND cache writes.
export function lastDirectorProviderUsage(events, startAt = 0) {
  for (let i = events.length - 1; i >= startAt; i--) {
    const event = events[i]
    if (!['assistant/message', 'assistant/attempt'].includes(event?.type)) continue
    const data = event.data || {}
    const usage = data.usage ?? data.stream?.findLast(record => record.type === 'chunk' && record.chunk?.type === 'usage')?.chunk.usage
    if (!usage) return undefined
    const valid = value => Number.isSafeInteger(value) && value >= 0
    if (!valid(usage.inputTokens) || (usage.cacheReadTokens !== undefined && !valid(usage.cacheReadTokens)) || (usage.cacheWriteTokens !== undefined && !valid(usage.cacheWriteTokens))) return undefined
    return { inputTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0), cacheHitTokens: usage.cacheReadTokens ?? 0 }
  }
  return undefined
}
