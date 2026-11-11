import {AsyncLocalStorage,AsyncResource} from 'node:async_hooks'

const context = new AsyncLocalStorage()
export const conversationReadLane = () => context.getStore()?.lane || 'foreground'
export const withConversationReadLane = (lane, operation) => context.run({lane,pending:new Set()}, operation)

// A decoded subtree can be shared by recovery and a player request. Promote
// its continuing reads as well as its current queued block when a player joins.
export function createConversationReadContext() {
  const parent=context.getStore(),state={lane:conversationReadLane(),pending:new Set()}
  const promote=()=>{
    parent?.pending.delete(promote)
    state.lane='foreground'
    for (const promoteChild of [...state.pending]) promoteChild()
  }
  // A parent decode may already be awaiting a nested shared decoder.
  parent?.pending.add(promote)
  const release=()=>parent?.pending.delete(promote)
  return {promote,run(operation) {
    try {return Promise.resolve(context.run(state,operation)).finally(release)}
    catch(error){release();throw error}
  }}
}

// Bound physical reads, not whole requests: a foreground reader can join a
// recovery load without waiting for recovery's remaining history or deadlocking.
export function createConversationReadLanes({concurrency = 8} = {}) {
  const foreground = [], background = []
  let active = 0, backgroundActive = 0
  function drain() {
    while (active < concurrency) {
      const job = foreground.shift() || (backgroundActive === 0 ? background.shift() : null)
      if (!job) return
      job.started = true
      job.context?.pending.delete(job.promote)
      active++
      if (job.lane === 'background') backgroundActive++
      Promise.resolve().then(()=>job.operation(job.lane)).then(job.resolve, job.reject).finally(() => {
        active--
        if (job.lane === 'background') backgroundActive--
        drain()
      })
    }
  }
  return function schedule(operation, lane = conversationReadLane()) {
    const job = {operation:AsyncResource.bind(operation), lane, context:context.getStore(), started:false}
    const promise = new Promise((resolve, reject) => Object.assign(job, {resolve, reject}))
    job.promote=() => {
      if (job.started || job.lane !== 'background') return
      background.splice(background.indexOf(job), 1)
      job.context?.pending.delete(job.promote)
      job.lane = 'foreground'
      foreground.push(job)
      drain()
    }
    if (lane === 'background') job.context?.pending.add(job.promote)
    ;(lane === 'background' ? background : foreground).push(job)
    drain()
    return {promise,promote:job.promote}
  }
}
