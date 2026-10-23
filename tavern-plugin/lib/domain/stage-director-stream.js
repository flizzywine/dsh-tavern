import { projectedSceneText } from './scene-illustration.js'
import { stagePages } from './stage-performance.js'
import { foldStageState } from './cast-stage-state.js'

const stale = () => Object.assign(Error('Stage source changed or stream closed'), { retryable: false })
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
  async function current(owner) {
    if (disposed || active.get(owner.sessionId) !== owner || owner.controller.signal.aborted) throw stale()
    const next = await source(owner.sessionId, owner.turn)
    if (!next || next.operationId !== owner.operationId || next.branchId !== owner.branchId ||
        next.revision !== owner.revision + (next.status === 'completed' ? 1 : 0) || !['running', 'completed'].includes(next.status)) throw stale()
    if (active.get(owner.sessionId) !== owner || owner.controller.signal.aborted) throw stale()
    return next
  }
  async function window(owner, text, first) {
    const sequence = owner.seals.length + 1
    const accepted = await director.run({ ...owner.body, text }, owner.controller.signal, {
      // `earlier`: this turn's accepted performances, counted against 每轮上限.
      frozen: owner.frozen, previous: owner.state, sequence, first, earlier: owner.events,
      async accept(value, context) {
        await current(owner)
        if (context.signal?.aborted || context.stopped()) throw stale()
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
      if (owner) close(owner)
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
        owner.work = window(owner, owner.prefix.join('\n'), 1).catch(error => { close(owner); warn(error) })
      },
      cancel() { close(owner) }
    }
  }
  async function finish(body, signal) {
    const owner = body && active.get(body.sessionId)
    if (!owner || owner.turn !== body.turn) return false
    if (owner.finishing) return true
    owner.finishing = true
    const abort = () => close(owner)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) throw stale()
      await current(owner)
      const pages = stagePages(body.text)
      if (owner.prefix && !same(owner.prefix, pages.slice(0, 5).map(page => page.text))) throw stale()
      owner.pages = pages
      publish(body.sessionId)
      await owner.work
      await current(owner)
      const first = owner.started ? 6 : 1
      if (pages.length >= first) await window(owner, body.text, first)
      await current(owner)
      await director.save({ ...body, operationId: owner.operationId }, {
        delta: owner.delta, performances: owner.events, presentationKey: owner.body.key, seals: owner.seals
      }, { branchId: owner.branchId, revision: owner.revision + 1 }, {
        signal: owner.controller.signal, stopped: () => active.get(owner.sessionId) !== owner,
        async checkDependencies() {
          if (!same(await catalog(body.sessionId), owner.frozen.assets) ||
              !same(await director.state(body.sessionId, body.turn - 1), owner.frozen.previous)) throw stale()
        }
      })
    } catch (error) { warn(error) }
    finally { signal?.removeEventListener('abort', abort); close(owner) }
    return true
  }
  async function preview(sessionId) {
    const owner = active.get(sessionId)
    if (!owner || !owner.pages.length) return null
    try { await current(owner) } catch { close(owner); return null }
    return structuredClone({ turn: owner.turn, key: owner.body.key, pages: owner.pages, performances: owner.events, state: owner.state })
  }
  return Object.freeze({ begin, finish, preview, cancel(sessionId, turn) { const owner = active.get(sessionId); if (owner && (turn === undefined || owner.turn === turn)) close(owner) }, dispose() { disposed = true; for (const owner of active.values()) close(owner) } })
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
