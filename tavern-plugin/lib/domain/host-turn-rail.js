// 轮次导航（对话右侧那列刻度）里，每个刻度是一条 `turn/start`。
// 失败轮次、被撤回的输入、被重新生成取代的尝试轮都会在日志里留下 `turn/start`，
// 宿主整档投影 `turnOutline` 照单全收：正文已经没有这一轮的任何节点了，刻度却还在，
// 每重试一次就多一根，跳过去也落不到任何内容上。
//
// 这里在宿主投影 seam 上把真正发出去的 `turnOutline` 裁到「表面里还有节点」的轮次：
// 节点自带 `data.turn` 就按它算；没有 turn 的（tavern 重写的正文、玩家输入）退回投影自己的
// turn/start 边界换算，所以它们也能算对所属那一轮。只有清理标记（空 content 的插件消息）
// 不算数——那正是失败、撤回、尝试轮被清空的痕迹。
// 只裁已经发出去的值，原生 fold、state、检查点和 schema 校验一律不动；
// 不认识的宿主接口或版本原样放回。
const installations = new WeakMap()
const KEY = 'turnOutline'

function boundaries(entries) {
  const bounds = []
  for (const entry of entries) {
    const turn = Number(entry && entry.turn)
    const seq = Number(entry && entry.seq)
    if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(seq)) return null
    if (bounds.length && seq <= bounds[bounds.length - 1].seq) return null
    bounds.push({ turn, seq })
  }
  return bounds
}

// 表面里只剩清理标记的轮次不算活着：tavern 把尝试轮清掉时就是拿一个空 content 的
// 插件消息盖住整段，标记自己的 seq 会被算到下一轮区间里，不能当成正文。
function isEmptyMarker(event) {
  const data = event && event.data
  if (!data || data.message !== undefined) return false
  return Array.isArray(data.content) && data.content.length === 0
}

// 能跳的轮次：正文里有读者看得到的东西——助手正文，或者玩家自己那一句。
// 只剩系统消息、工具行、上下文注入的轮次也能「有节点」，但点过去只会滚一段空气。
function isReaderTurn(event) {
  if (!event) return false
  if (event.type === 'assistant/message') return true
  if (event.type !== 'user/message') return false
  return String(event.data && event.data.source && event.data.source.kind || '') === 'user'
}

function boundaryTurn(bounds, seq) {
  let low = 0, high = bounds.length - 1, found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (bounds[mid].seq <= seq) { found = mid; low = mid + 1 }
    else high = mid - 1
  }
  return found >= 0 ? bounds[found].turn : 0
}

// 表面节点 → 所属轮次。表面里一个节点都没有的轮次不再出现在目录里。
// 循环写入的消息自带 `data.turn`，优先用它；tavern 自己重写的、不带 turn 的正文
// 退回 turn/start 边界换算。
function liveTurns(session, bounds) {
  const surface = session && session.surface
  const nodes = surface && surface.nodes
  if (!Array.isArray(nodes)) return null
  const read = typeof session.eventAt === 'function' ? seq => { try { return session.eventAt(seq) } catch { return undefined } } : null
  const live = new Set()
  for (const raw of nodes) {
    const seq = Number(raw)
    if (!Number.isSafeInteger(seq)) continue
    const event = read === null ? undefined : read(seq)
    const turn = Number(event && event.data && event.data.turn)
    if (Number.isSafeInteger(turn) && turn > 0) {
      if (read === null || isReaderTurn(event)) live.add(turn)
      continue
    }
    if (isEmptyMarker(event)) continue
    if (read !== null && !isReaderTurn(event)) continue
    const mapped = boundaryTurn(bounds, seq)
    if (mapped > 0) live.add(mapped)
  }
  return live
}

/**
 * 表面里还有节点的轮次（升序）。查看层用同一套规则：`events` 是会话日志，`nodes` 是表面节点 seq。
 * 失败的尝试轮、被撤回的输入、被重新生成取代的轮次在表面里一个节点都不剩，就不再算轮次。
 * @param {{ events?: Array<object>, nodes?: Array<number> }} input - 会话日志与表面节点。
 * @returns {number[]} 仍有内容的轮次号。
 */
export function surfaceTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  if (!events.length || !nodes.length) return []
  const bySeq = new Map()
  const bounds = []
  for (const event of events) {
    const seq = Number(event && event.seq)
    if (!Number.isSafeInteger(seq)) continue
    bySeq.set(seq, event)
    if (event.type !== 'turn/start') continue
    const turn = Number(event.data && event.data.turn)
    if (!Number.isSafeInteger(turn) || turn <= 0) continue
    if (bounds.length && seq <= bounds[bounds.length - 1].seq) continue
    bounds.push({ turn, seq })
  }
  if (!bounds.length) return []
  const live = new Set()
  for (const raw of nodes) {
    const seq = Number(raw)
    if (!Number.isSafeInteger(seq)) continue
    const event = bySeq.get(seq)
    if (!isReaderTurn(event)) continue
    const turn = Number(event.data.turn)
    if (Number.isSafeInteger(turn) && turn > 0) { live.add(turn); continue }
    const mapped = boundaryTurn(bounds, seq)
    if (mapped > 0) live.add(mapped)
  }
  return [...live].sort((left, right) => left - right)
}

function stampOf(session) {
  try {
    const surface = session && session.surface
    const nodes = surface ? surface.nodes : undefined
    if (!Array.isArray(nodes)) return ''
    const generation = Number(surface.replaceGeneration)
    return nodes.length + ':' + (nodes.length ? String(nodes[nodes.length - 1]) : '') + ':' + (Number.isSafeInteger(generation) ? generation : -1)
  } catch { return '' }
}

// 原位换回一组监听器，保持宿主登记的顺序。
function remapListeners(target, replacement) {
  const next = [...target].map(listener => (replacement.has(listener) ? replacement.get(listener) : listener))
  target.clear()
  for (const listener of next) target.add(listener)
}

function trimmed(session, value, memo) {
  if (!Array.isArray(value) || value.length === 0) return value
  if (!session || typeof session !== 'object') return value
  const stamp = stampOf(session)
  const known = memo.get(session)
  if (known && known.stamp === stamp && known.source === value) return known.value
  const bounds = boundaries(value)
  if (bounds === null || bounds.length === 0) {
    memo.set(session, { stamp, source: value, value })
    return value
  }
  let live = null
  try { live = liveTurns(session, bounds) } catch { live = null }
  let next = value
  if (live !== null) {
    const kept = value.filter(entry => live.has(Number(entry && entry.turn)))
    if (kept.length !== value.length) next = kept
  }
  memo.set(session, { stamp, source: value, value: next })
  return next
}

function withTrimmedValues(result, session, memo) {
  if (!result || typeof result !== 'object' || !result.values || typeof result.values !== 'object') return result
  const value = result.values[KEY]
  if (value === undefined) return result
  const next = trimmed(session, value, memo)
  if (next === value) return result
  return { ...result, values: { ...result.values, [KEY]: next } }
}

/**
 * 把发出去的 `turnOutline` 裁到表面里还有内容的轮次。
 * 只包装快照入口和变更推送的监听器；原生定义、state 和检查点都不替换。
 * @param {object} registry - 宿主 `ctx.sessionProjections`。
 * @returns {() => void} 卸载函数（重复安装共用一次真实安装）。
 */
export function installHostTurnRailFilter(registry) {
  const methods = ['snapshot', 'cachedSnapshot', 'hydrate']
  if (!registry || typeof registry !== 'object' || !(registry.registrations instanceof Map) ||
      !methods.every(name => typeof registry[name] === 'function')) return () => {}
  let installed = installations.get(registry)
  if (!installed) {
    const memo = new WeakMap()
    const originals = new Map()
    const own = new Map()
    const listeners = registry.listeners instanceof Set ? registry.listeners : null
    const wrapped = new Map()
    const listening = new Map()
    const wrapListener = listener => {
      if (typeof listener !== 'function') return listener
      let filter = wrapped.get(listener)
      if (filter) return filter
      filter = function (session, key, value, seq) {
        const next = key === KEY && session ? trimmed(session, value, memo) : value
        return listener(session, key, next, seq)
      }
      wrapped.set(listener, filter)
      return filter
    }
    for (const name of methods) {
      const original = registry[name]
      own.set(name, Object.hasOwn(registry, name))
      const wrapper = function (session, ...rest) {
        return withTrimmedValues(original.apply(this, [session, ...rest]), session, memo)
      }
      originals.set(name, original)
      registry[name] = wrapper
    }
    const originalOnChanged = typeof registry.onChanged === 'function' ? registry.onChanged : null
    if (originalOnChanged) {
      own.set('onChanged', Object.hasOwn(registry, 'onChanged'))
      originals.set('onChanged', originalOnChanged)
      registry.onChanged = function (listener) {
        const filter = wrapListener(listener)
        if (listeners) listening.set(filter, listener)
        const off = originalOnChanged.call(this, filter)
        // 卸载后集合里换回原监听器，lib 的 disposer 只认它注册的那个：两个都删。
        return function () {
          off()
          listening.delete(filter)
          if (listeners) { listeners.delete(filter); listeners.delete(listener) }
        }
      }
    }
    if (listeners) {
      const before = [...listeners]
      listeners.clear()
      for (const listener of before) {
        const filter = wrapListener(listener)
        if (filter !== listener) listening.set(filter, listener)
        listeners.add(filter)
      }
    }
    installed = {
      users: 0,
      dispose() {
        for (const [name, original] of originals) {
          if (name === 'onChanged') continue
          if (own.get(name)) registry[name] = original
          else delete registry[name]
        }
        if (originalOnChanged) {
          if (own.get('onChanged')) registry.onChanged = originalOnChanged
          else delete registry.onChanged
        }
        if (listeners) remapListeners(listeners, listening)
      },
    }
    installations.set(registry, installed)
  }
  installed.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--installed.users) return
    installed.dispose()
    installations.delete(registry)
  }
}
