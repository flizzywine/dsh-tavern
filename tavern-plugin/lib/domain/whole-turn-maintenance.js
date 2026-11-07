import { surfaceTurnKeys, wholeTurnKeepIndex } from './context-turns.js'

// rc.2 compactNow bypasses compactRegion and hard-codes a one-node
// retained tail. Give its read-only selector a one-node view of the last *turn*.
// Appends, durability, locks, cancellation and the actual surface stay host-owned;
// the hidden remainder is never removed from the real Session or summarized.
export function compactWholeTurnsNow(engine, native, agent, signal, sourceCommandId) {
  const session = agent.session
  let hidden = new Set()
  const view = new Proxy(session, { get(target, key) {
    if (key === 'surface') return { ...target.surface, nodes: target.surface.nodes.filter(seq => !hidden.has(seq)) }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const owner = new Proxy(agent, { get(target, key) {
    if (key === 'session') return view
    if (key === 'runMaintenance') return work => target.runMaintenance(async abort => {
      const nodes = session.surface.nodes, turns = surfaceTurnKeys(session, nodes)
      const keep = wholeTurnKeepIndex(turns, nodes.length - 1)
      const hasOlderDialogue = nodes.slice(0, keep).some(seq => {
        const message = session.deriveEventMessage(session.eventAt(seq))
        return message?.role !== 'system' && message?.content?.length
          && !['compact', 'dsh-compaction-basic'].includes(message.source?.plugin)
      })
      if (!hasOlderDialogue) return null
      hidden = new Set(nodes.slice(keep + 1))
      return work(abort)
    })
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const meter = new Proxy(engine.ctx.tokenMeter, { get(target, key) {
    if (key === 'measure') return (value, ...args) => {
      const measured = target.measure(value === view ? session : value, ...args)
      return value === view ? { ...measured, nodes: measured.nodes.filter(node => !hidden.has(node.seq)) } : measured
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const sessions = new Proxy(engine.ctx.sessions, { get(target, key) {
    if (key === 'flush') return value => target.flush(value === view ? session : value)
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const context = new Proxy(engine.ctx, { get(target, key) {
    if (key === 'tokenMeter') return meter
    if (key === 'sessions') return sessions
    return Reflect.get(target, key, target)
  } })
  const facade = Object.create(engine)
  // Cordis shadows ctx again when native methods call other service methods.
  Object.defineProperty(facade, 'ctx', { value: context, configurable: true })
  return native.call(facade, owner, signal, sourceCommandId)
}
