// selection pricing only; the host owns summary transactions and the UI meter.
import { surfaceTurnKeys, wholeTurnKeepIndex } from './context-turns.js'
import { readCompactionPressure, requirePressureNumber } from './compaction-pressure-guard.js'
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u

export function estimateCjkText(text = '') {
  let units = 0
  for (const char of text) units += CJK.test(char) ? 4 : char.length
  return Math.ceil(units / 4)
}

function contentCorrection(content = []) {
  return content.reduce((sum, block) => {
    if (block.type === 'text' || block.type === 'reasoning') return sum + estimateCjkText(block.text) - Math.ceil((block.text || '').length / 4)
    if (block.type === 'tool-result') return sum + contentCorrection(block.content)
    if (block.type === 'tool-call') return sum + estimateCjkText(block.arguments) - Math.ceil((block.arguments || '').length / 4)
    return sum
  }, 0)
}

export function estimateCjkMessage(message, hostTokens) {
  return hostTokens + contentCorrection(message?.content)
}

export function measureCompactionSurface(session, meter) {
  const measured = meter.measure(session)
  const tools = session.requestHeader()?.tools || []
  const toolsJson = tools.length ? JSON.stringify(tools) : ''
  const toolsTokens = toolsJson ? Math.ceil(toolsJson.length / 4) + 4 : 0
  // Recover the *sampled* heuristic envelope, not today's shrinking surface.
  // This ratio stays stable across replacement events and includes cache input.
  const anchorTokens = toolsTokens + measured.surfaceTokens - measured.surfaceDeltaTokens
  const scale = measured.baseline?.kind === 'usage' && anchorTokens > 0
    ? Math.max(1, measured.baseline.tokens / anchorTokens) : 1
  const messages = measured.nodes.map(node => session.deriveEventMessage(session.eventAt(node.seq)))
  const nodes = measured.nodes.map((node, index) => ({
    seq: node.seq,
    message: messages[index],
    tokens: messages[index]
      ? Math.ceil(Math.max(estimateCjkMessage(messages[index], node.tokens), node.tokens * scale)) : 0
  }))
  const fixedTokens = Math.ceil(Math.max(toolsTokens * scale, toolsJson ? estimateCjkText(toolsJson) + 4 : 0))
  return { nodes, scale, totalTokens: fixedTokens + nodes.reduce((sum, node) => sum + node.tokens, 0) }
}

const isCheckpoint = message => message?.source?.kind === 'plugin' && ['compact', 'dsh-compaction-basic'].includes(message.source.plugin)

export function selectCjkCompactionRange(session, measurement, retainTokens, balancedBefore) {
  const nodes = measurement.nodes
  if (!nodes.length) return null
  const first = session.eventAt(nodes[0]?.seq)?.type === 'system/message' ? 1 : 0
  let keep = nodes.length, tokens = 0
  for (let i = nodes.length - 1; i >= first; i--) {
    // Always retain the newest indivisible message/tool exchange.
    if (keep < nodes.length && tokens + nodes[i].tokens > retainTokens) break
    keep = i
    tokens += nodes[i].tokens
  }
  const turns = surfaceTurnKeys(session, nodes)
  keep = wholeTurnKeepIndex(turns, keep)
  while (keep > first && keep < nodes.length && !balancedBefore(session, nodes[keep].seq)) {
    keep = wholeTurnKeepIndex(turns, keep - 1)
  }
  if (keep <= first || keep === nodes.length) return null
  // A checkpoint-only retry cannot reduce the retained story. Ask for a smaller tail.
  if (!nodes.slice(first, keep).some(node => node.tokens > 0 && !isCheckpoint(node.message))) return null
  return { start: nodes[first].seq, end: nodes[keep - 1].seq, keep }
}

/** Foreground native-play policy. Overflow/manual transactions remain host-owned. */
export async function compactCjkIfNeeded({ engine, agent, trigger, signal, native, meter, llm, balancedBefore }) {
  if (trigger !== 'pressure') return native()
  const session = agent.session
  const checked = await readCompactionPressure(session, signal, engine.ctx.logger || console, async () => {
    const target = session.requestHeader()?.config
    if (!target?.provider || !target?.model) return null // No priced request yet.
    const config = engine.config
    const override = config.modelPolicies?.find(policy => policy.provider === target.provider && policy.model === target.model) || {}
    const policy = { ...config, ...override }
    const info = await llm.resolveModelInfo(target.provider, target.model, signal)
    signal?.throwIfAborted()
    const capacity = requirePressureNumber(info?.context?.contextWindow, 'capacity', true)
    const threshold = requirePressureNumber(Math.floor(capacity * policy.thresholdRatio), 'threshold', true)
    const retain = requirePressureNumber(override.retainRatio !== undefined ? Math.floor(capacity * override.retainRatio)
      : policy.retainTokens ?? Math.floor(capacity * policy.retainRatio), 'retained tail')
    if (retain >= threshold) throw new Error('Tavern compaction: retained tail must be smaller than the threshold')
    const measurement = measureCompactionSurface(session, meter)
    requirePressureNumber(measurement.totalTokens, 'input tokens')
    return { policy, threshold, retain, measurement }
  })
  if (!checked) return null
  const { policy, threshold, retain } = checked
  let { measurement } = checked
  if (measurement.totalTokens < threshold) return null
  // Do not prune underneath a summary already in flight. A newer seed boundary
  // retires stale locks exactly as in the host transaction admission rule.
  for (let seq = session.seq - 1; seq >= 0; seq--) {
    const type = session.eventAt(seq).type
    if (type === 'session/end-seed' || type === 'compaction/end') break
    if (type === 'compaction/start') throw new Error('Tavern compaction already in progress')
  }
  engine.ctx.get('toolResultPruner')?.pruneSession(session)
  measurement = measureCompactionSurface(session, meter)
  // pruning and every retry must still meet the admission threshold.
  const targetTokens = threshold
  let result = null, tailBudget = retain
  for (let attempt = 0; attempt <= policy.compactionRetries && measurement.totalTokens >= targetTokens; attempt++) {
    let range = selectCjkCompactionRange(session, measurement, tailBudget, balancedBefore)
    // Avoid spending a call on just the old summary, even on the first attempt.
    while (!range && tailBudget > 0) {
      tailBudget = Math.floor(tailBudget / 2)
      range = selectCjkCompactionRange(session, measurement, tailBudget, balancedBefore)
    }
    if (!range) break
    signal?.throwIfAborted()
    result = await engine.compactRegion(range.start, range.end, agent, signal)
    measurement = measureCompactionSurface(session, meter)
    tailBudget = Math.floor(tailBudget / 2)
  }
  if (measurement.totalTokens >= targetTokens) throw new Error(`Tavern compaction cannot reach its safe target (${measurement.totalTokens} estimated tokens >= ${targetTokens}; threshold ${threshold}); fixed context or the newest tool exchange cannot be reduced safely`)
  return result
}
