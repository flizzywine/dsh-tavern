import { projectedSceneText } from './scene-illustration.js'
import { stagePages } from './stage-performance.js'
import { foldStageState } from './cast-stage-state.js'

const stopped = message => Object.assign(Error(message), { retryable: false })
// The log names why the director stopped; a model runner aborted underneath only reports a generic stop.
const SOURCE_CHANGED = '舞台导演已停止：本轮正文已变化'
const INTERRUPTED = '舞台导演已停止：正文生成已中止或已开始新的正文'
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// One operation owns at most two requests: five sealed rows, then the submitted remainder.
// Only tool-accepted changes enter this memory projection; save remains the journal CAS.
export function createStageDirectorStream({ director, source, catalog, publish = () => {}, warn = () => {} }) {
  const active = new Map()
  let disposed = false
  function close(owner) {
    owner.controller.abort()
    if (active.get(owner.sessionId) === owner) { active.delete(owner.sessionId); publish(owner.sessionId) }
  }
  // Closing with a reason keeps what actually stopped this owner for the log.
  function stop(owner, message) { owner.reason ||= stopped(message); close(owner) }
  const stale = owner => owner.reason || stopped('Stage stream closed')
  // The director depends on this round's body operation and branch (and, at commit, its prose), not on
  // the story revision: choices, 手动记账 or 人物设计 committing meanwhile leave it valid.
  // Whichever caller notices the change first (a preview, a tool call, a new request) stops it with that reason.
  async function current(owner) {
    if (disposed || active.get(owner.sessionId) !== owner || owner.controller.signal.aborted) throw stale(owner)
    const next = await source(owner.sessionId, owner.turn)
    if (!next || next.operationId !== owner.operationId || next.branchId !== owner.branchId ||
        !['running', 'completed'].includes(next.status)) { stop(owner, SOURCE_CHANGED); throw owner.reason }
    if (active.get(owner.sessionId) !== owner || owner.controller.signal.aborted) throw stale(owner)
    return next
  }
  async function window(owner, text, first) {
    const sequence = owner.seals.length + 1
    const accepted = await director.run({ ...owner.body, text }, owner.controller.signal, {
      // `earlier`: this turn's accepted performances, counted against 每轮上限.
      frozen: owner.frozen, previous: owner.state, sequence, first, earlier: owner.events,
      async accept(value, context) {
        await current(owner)
        if (context.signal?.aborted || context.stopped()) throw stale(owner)
        const delta = value.delta
        for (const field of ['background', 'music']) if (Object.hasOwn(delta, field)) owner.delta[field] = delta[field]
        if (Object.hasOwn(delta, 'figures')) {
          // A clear discards this turn's earlier edits, but must also remove inherited figures.
          if (delta.figures === null) owner.delta.figures = owner.frozen.previous.figures.map(figure => ({ speaker: figure.speaker, remove: true }))
          else owner.delta.figures = [...(owner.delta.figures || []), ...delta.figures]
        }
        owner.state = foldStageState(owner.state, delta)
        owner.events.push(...value.performances)
        owner.seals.push(value.seal)
        publish(owner.sessionId)
      }
    })
    if (!accepted) throw Error('Stage window ended without an accepted submission')
  }
  async function begin(sessionId, turn) {
    const origin = await source(sessionId, turn)
    if (disposed || !origin || origin.status !== 'running') return null
    let owner = active.get(sessionId)
    if (owner?.operationId !== origin.operationId) {
      if (owner) stop(owner, SOURCE_CHANGED)
      const body = { ...origin, sessionId, turn, key: 'stage-stream:' + origin.operationId, text: '' }
      const frozen = await director.freeze(body)
      if (disposed || !frozen?.model) return null
      // The await may have been overtaken by another request for this operation.
      owner = active.get(sessionId)
      if (owner && owner.operationId !== origin.operationId) return null
      if (!owner) {
        owner = { ...origin, sessionId, turn, body, frozen, state: frozen.previous, raw: '', pages: [],
          controller: new AbortController(), delta: {}, events: [], seals: [], started: false, work: Promise.resolve() }
        active.set(sessionId, owner)
      }
    }
    await current(owner)
    return {
      append(text) {
        if (owner.controller.signal.aborted || owner.finishing) return
        owner.raw += text
        if (owner.started) return
        const complete = owner.raw.slice(0, owner.raw.lastIndexOf('\n') + 1)
        // Effectful templates and unfinished markup need the host's final projection.
        if (/\{\{|<%|<(script|style)\b/i.test(complete) || complete.lastIndexOf('<') > complete.lastIndexOf('>')) return
        const pages = stagePages(projectedSceneText(complete))
        if (pages.length < 5) return
        owner.started = true
        owner.pages = pages.slice(0, 5)
        owner.prefix = owner.pages.map(page => page.text)
        publish(sessionId)
        owner.work = window(owner, owner.prefix.join('\n'), 1).catch(error => { warn(owner.reason || error); close(owner) })
      },
      cancel() { stop(owner, INTERRUPTED) }
    }
  }
  async function finish(body, signal) {
    const owner = body && active.get(body.sessionId)
    if (!owner || owner.turn !== body.turn) return false
    if (owner.finishing) return true
    owner.finishing = true
    const abort = () => stop(owner, INTERRUPTED)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) abort()
      await current(owner)
      const pages = stagePages(body.text)
      if (owner.prefix && !same(owner.prefix, pages.slice(0, 5).map(page => page.text))) throw stopped(SOURCE_CHANGED)
      owner.pages = pages
      publish(body.sessionId)
      await owner.work
      await current(owner)
      const first = owner.started ? 6 : 1
      if (pages.length >= first) await window(owner, body.text, first)
      await current(owner)
      await director.save({ ...body, operationId: owner.operationId }, {
        delta: owner.delta, performances: owner.events, presentationKey: owner.body.key, seals: owner.seals
      }, { branchId: owner.branchId }, {
        signal: owner.controller.signal, stopped: () => active.get(owner.sessionId) !== owner,
        async checkDependencies() {
          if (!same(await catalog(body.sessionId), owner.frozen.assets) ||
              !same(await director.state(body.sessionId, body.turn - 1), owner.frozen.previous)) throw stopped('舞台导演已停止：素材或上一轮舞台已变化')
        }
      })
    } catch (error) { warn(owner.reason || error) }
    finally { signal?.removeEventListener('abort', abort); close(owner) }
    return true
  }
  async function preview(sessionId) {
    const owner = active.get(sessionId)
    if (!owner || !owner.pages.length) return null
    try { await current(owner) } catch { return null }
    return structuredClone({ turn: owner.turn, key: owner.body.key, pages: owner.pages, performances: owner.events, state: owner.state })
  }
  // A turn's own end interrupts it. A new foreground request interrupts a round whose prose still stands;
  // over a regenerated, edited or rolled back round, `current` stops it because the prose changed.
  async function cancel(sessionId, turn) {
    const owner = active.get(sessionId)
    if (!owner || (turn !== undefined && owner.turn !== turn)) return
    if (turn === undefined) try { await current(owner) } catch { return }
    stop(owner, INTERRUPTED)
  }
  return Object.freeze({ begin, finish, preview, cancel, dispose() { disposed = true; for (const owner of active.values()) close(owner) } })
}

// Buffer while the frozen snapshot is prepared; never hold up foreground token delivery.
export function observeStageText({ begin, signal, warn = () => {} }) {
  let pending = '', observer, cancelled = false
  const cancel = () => { cancelled = true; pending = ''; observer?.cancel() }
  const ready = Promise.resolve().then(begin).then(value => {
    observer = value
    if (cancelled) observer?.cancel()
    else if (pending) { observer?.append(pending); pending = '' }
  }).catch(warn)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  return {
    append(text) { if (!cancelled) { if (observer) observer.append(text); else pending += text } },
    finish(completed) {
      signal?.removeEventListener('abort', cancel)
      if (!completed) cancel()
      return ready
    }
  }
}
