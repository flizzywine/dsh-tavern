const installations = new WeakMap()
const appendTypes = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

// Cold folds are unpublished: their accumulating arrays can be owned by the
// fold rather than copied at every event. Never use these adapters for live
// apply(), where previous states/views may already have escaped to observers.
function coldApply(def) {
  const apply = def.apply
  const owned = new WeakSet()
  let lastNodes, lastSystem
  // 0.2.0-rc.2 适配：dsh-token-meter 的 contextBreakdown 定义 stateVersion 从 4 升到 5
  // （state schema 未变，仍是 { nodes: [{ seq, heuristicTokens, system }], breakdown }）。
  // 版本号只表示「可能变了」，因此这里改判 >= 4：真正决定冷折叠能否成立的是下面几行
  // 对 state 形状的运行时断言，形状不符时一律退回原生 apply。
  if (def.key === 'contextBreakdown' && def.stateVersion >= 4) return function (state, event) {
    if (event.surfaceOp !== 'append' || !appendTypes.has(event.type)) return apply(state, event)
    if (!Array.isArray(state.nodes) || !state.breakdown) return apply(state, event)
    if (lastNodes !== state.nodes) {
      lastSystem = state.nodes.findLast(node => node.system && node.heuristicTokens > 0)
      lastNodes = state.nodes
    }
    // Keep native pricing and breakdown arithmetic. An append only needs the
    // latest nonempty system node; replacements still use the complete array.
    const seed = { ...state, nodes: lastSystem ? [lastSystem] : [] }
    const next = apply(seed, event)
    if (next === seed || next.nodes.length !== seed.nodes.length + 1) return apply(state, event)
    const node = next.nodes.at(-1)
    const nodes = owned.has(state.nodes) ? state.nodes : state.nodes.slice()
    nodes.push(node)
    owned.add(nodes)
    lastNodes = nodes
    if (node.system && node.heuristicTokens > 0) lastSystem = node
    return { ...next, nodes }
  }
  if (def.key === 'turnOutline' && def.stateVersion === 2) return function (state, event) {
    if (!Array.isArray(state.turns)) return apply(state, event)
    // Native outline transitions inspect only the last turn. Retain native
    // preview/truncation/turn checks by delegating against that one-row suffix.
    const seed = { ...state, turns: state.turns.length ? [state.turns.at(-1)] : [] }
    const next = apply(seed, event)
    if (next === seed) return state
    if (next.turns === seed.turns) return { ...next, turns: state.turns }
    if (!['turn/start', 'user/message', 'turn/end'].includes(event.type)) return apply(state, event)
    const turns = owned.has(state.turns) ? state.turns : state.turns.slice()
    if (next.turns.length === seed.turns.length + 1) turns.push(next.turns.at(-1))
    else if (next.turns.length === seed.turns.length && turns.length) turns[turns.length - 1] = next.turns.at(-1)
    else return apply(state, event)
    owned.add(turns)
    return { ...next, turns }
  }
  return apply
}

/**
 * Private host compatibility seam, gated by known projection state versions.
 * Retains native schemas, sequence validation, checkpoint format, live folds
 * and notifications. Can be removed once the host supports efficient batch
 * folds itself. Unsupported registries/versions keep their original behavior.
 */
export function installHostProjectionReplay(registry) {
  if (!registry || typeof registry.buildCell !== 'function' || typeof registry.restore !== 'function' || !(registry.registrations instanceof Map)) return () => {}
  let installed = installations.get(registry)
  if (!installed) {
    const originalBuild = registry.buildCell, originalRestore = registry.restore
    const ownBuild = Object.hasOwn(registry, 'buildCell'), ownRestore = Object.hasOwn(registry, 'restore')
    function build(def, ...args) {
      return originalBuild.call(this, { ...def, apply: coldApply(def) }, ...args)
    }
    function restore(...args) {
      // A private registry view also keeps reentrant observers on the original
      // live definitions. Native restore owns schema/sequence validation.
      const view = Object.create(this)
      view.registrations = new Map([...this.registrations].map(([key, registration]) => [
        key, { ...registration, def: { ...registration.def, apply: coldApply(registration.def) } },
      ]))
      return originalRestore.apply(view, args)
    }
    registry.buildCell = build
    registry.restore = restore
    installed = { users: 0, originalBuild, originalRestore, ownBuild, ownRestore }
    installations.set(registry, installed)
  }
  installed.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--installed.users) return
    if (installed.ownBuild) registry.buildCell = installed.originalBuild
    else delete registry.buildCell
    if (installed.ownRestore) registry.restore = installed.originalRestore
    else delete registry.restore
    installations.delete(registry)
  }
}
