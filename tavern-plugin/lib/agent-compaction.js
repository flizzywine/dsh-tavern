import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { compactCjkIfNeeded } from './domain/cjk-compaction.js'

// resolve the pairing contract from the same installed host as Agent.
const hostRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'))
export async function compactNativePlayIfNeeded(engine, agent, trigger, signal, native) {
  const { toolPairingBalancedBefore } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-compaction')).href)
  return compactCjkIfNeeded({ engine, agent, trigger, signal, native,
    meter: engine.ctx.tokenMeter, llm: engine.ctx.llm, balancedBefore: toolPairingBalancedBefore })
}

// The returned service's ctx is this relay's context. Both compaction adapters
// need these services even outside a native engine method. Do not hard-inject
// "compaction" here: DSH 0.2.2 audits inject inside the preset's isolated
// compaction group, where the relay cannot see the service. Resolution below
// reads the same engine through the official preset-scoped API instead.
export const inject = ['tokenMeter', 'llm', 'sessions']
const EVENT = 'tavern/resolve-compaction'

// Runs inside the preset's isolated compaction group. DSH routes this event
// through the Agent's preset ancestry, including standing/shared compositions.
export function apply(ctx) {
  ctx.on(EVENT, () => ctx.get('compaction'))
}

function isCompactionEngine(engine) {
  return Boolean(engine)
    && typeof engine.compactNow === 'function'
    && typeof engine.compactIfNeeded === 'function'
}

export async function resolveAgentCompaction(ctx, agent) {
  // DSH 0.2.2 exposes services from an Agent's isolated preset mount directly.
  // This is the supported path when ctx.get('compaction') is realm-scoped.
  const proxy = ctx.get('agentPresets')
  const presets = proxy?.[Symbol.for('cordis.original')] ?? proxy
  const direct = presets?.serviceFor?.(agent, 'compaction')
  if (isCompactionEngine(direct)) return direct

  // DSH 0.2.1 fallback: resolve the group-local relay through the Agent scope.
  const engine = await agentEvents(ctx, agent).serial(EVENT, {})
  if (!isCompactionEngine(engine)) {
    throw new Error('当前 Agent 未提供原生压缩能力')
  }
  return engine
}
