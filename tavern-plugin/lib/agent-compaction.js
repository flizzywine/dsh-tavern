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

// the returned service's ctx is this relay's context. Both
// compaction adapters need these services even outside a native engine method.
export const inject = ['compaction', 'tokenMeter', 'llm', 'sessions']
const EVENT = 'tavern/resolve-compaction'

// Runs inside the preset's isolated compaction group. DSH routes this event
// through the Agent's preset ancestry, including standing/shared compositions.
export function apply(ctx) {
  ctx.on(EVENT, () => ctx.get('compaction'))
}

export async function resolveAgentCompaction(ctx, agent) {
  const engine = await agentEvents(ctx, agent).serial(EVENT, {})
  if (!engine || typeof engine.compactNow !== 'function' || typeof engine.compactIfNeeded !== 'function') {
    throw new Error('当前 Agent 未提供原生压缩能力')
  }
  return engine
}
