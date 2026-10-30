import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {createStageRuntimeStore} = require('../../tavern-plugin/src/client/stage-runtime-store.cjs')
const {sourceKey} = require('../../tavern-plugin/src/client/stage-runtime.cjs')

// Kernel fixture only: Phase C/D will attach the real host and resource owners.
// Cancelled work stays addressable so timelines can deliver late completions.
export function createFakeClock() {
  let now = 0, serial = 0
  const tasks = new Map()
  return {
    get now() { return now },
    get size() { return tasks.size },
    setTimeout(fn, delay) {
      if (!Number.isFinite(delay) || delay < 0) throw new TypeError('Invalid delay')
      const id = ++serial
      tasks.set(id, {id, due: now + delay, fn})
      return id
    },
    clearTimeout(id) { tasks.delete(id) },
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new TypeError('Invalid advance')
      const end = now + ms
      let turns = 0
      for (;;) {
        const next = [...tasks.values()].filter(task => task.due <= end)
          .sort((a, b) => a.due - b.due || a.id - b.id)[0]
        if (!next) break
        if (++turns > 10000) throw new Error('Fake clock runaway')
        now = next.due
        tasks.delete(next.id)
        next.fn()
      }
      now = end
    }
  }
}

export function createControllableBinding(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    publish(value) { snapshot = value; for (const listener of [...listeners]) listener() },
    get subscribers() { return listeners.size }
  }
}

export function createStageRuntimeHarness() {
  const clock = createFakeClock(), calls = [], timers = new Map(), reads = new Map()
  const snapshots = new Map(), watches = new Map()
  const projections = new Map(), oneShots = new Map()
  const store = createStageRuntimeStore({runEffect(intent, dispatch) {
    calls.push({at: clock.now, ...intent})
    switch (intent.type) {
    case 'watch-director': watches.set(sourceKey(intent.source), intent.source); break
    case 'unwatch-director': watches.delete(sourceKey(intent.source)); break
    case 'read-director': reads.set(intent.token.id, {...intent, active: true}); break
    case 'cancel-read': {
      const read = reads.get(intent.token.id)
      if (read) read.active = false
      break
    }
    case 'schedule-read': {
      const id = clock.setTimeout(() => {
        timers.delete(intent.token.id)
        dispatch({type: 'READ_TIMER', token: intent.token})
      }, intent.delay)
      timers.set(intent.token.id, id)
      break
    }
    case 'cancel-timer':
      clock.clearTimeout(timers.get(intent.token.id)); timers.delete(intent.token.id); break
    // emulate slot discovery before independent readiness.
    case 'project': projections.set(intent.token.id, intent); dispatch({type:'PROJECTION_GROUPS',token:intent.token,figureKeys:['figure:actor']}); break
    case 'prepare-one-shot': oneShots.set(intent.token.key, intent); break
    }
  }})
  const matching = type => calls.filter(call => call.type === type)
  return {
    clock, store, calls, reads, watches, projections, oneShots,
    get state() { return store.getSnapshot() },
    get activeReads() { return [...reads.values()].filter(read => read.active) },
    effects: matching,
    last: type => matching(type).at(-1),
    dispatch: store.dispatch,
    publish(source, envelope, {notify = true} = {}) {
      snapshots.set(sourceKey(source), envelope)
      if (notify && watches.has(sourceKey(source))) store.dispatch({type: 'DIRECTOR_WAKE', source})
    },
    replyRead(token, envelope = snapshots.get(sourceKey(token.source))) {
      const read = reads.get(token.id)
      if (!read) throw new Error('Unknown read')
      read.active = false
      store.dispatch({type: 'DIRECTOR_READ_RESULT', token, envelope})
    },
    failRead(token, error = 'network timeout') {
      reads.get(token.id).active = false
      store.dispatch({type: 'DIRECTOR_READ_FAILED', token, error})
    },
    readyProjection(token, groups) { store.dispatch({type: 'PROJECTION_READY', token, groups}) },
    readyOneShot(token) { store.dispatch({type: 'ONE_SHOT_READY', token}) },
    dispose() { store.dispose() }
  }
}

export const runtimeSource = (overrides = {}) => ({sessionId: 'session-1', authorityEpoch: 1,
  branchId: 'branch-1', turn: 1, sourceKey: 'node-1', generation: 1, ...overrides})
export const runtimePage = (para, offset = 0, extra = {}) => ({
  anchor: {paragraphId: 'paragraph-' + para, para, offset}, text: 'Text ' + para, ...extra
})
export const runtimeText = (revision, pages, streaming = false) => ({revision, pages, streaming, hasReadableText: pages.length > 0})
export const runtimeDirection = (revision, through, overrides = {}) => ({
  phase: 'partial', revision, bindingKey: 'binding-1', prefixRevision: revision,
  through, complete: false, baseline: {scene: 'baseline'}, entries: [], ...overrides
})
export const runtimeGroups = (identity = 'opaque:hash-A') => ({
  background: {kind: 'set', value: {scene: {identity}, lighting: {mood: 'day'}, ruler: {scene: 'scene-1', hMax: 180}}},
  'figure:actor': {kind:'set',value:{identity:'figure:' + identity}},
  // a cue and its explicit request identity commit in one group.
  music: {kind: 'set', value: {music: {identity: 'music:' + identity}, musicRequest: null}},
  ambience: {kind: 'set', value: [{identity: 'ambience:' + identity}]},
  avatars: {kind: 'set', value: {actor: {identity: 'avatar:' + identity}}},
  widgets: {kind: 'keep'},
  cg: {kind:'clear'} // independent overlay readiness
})
