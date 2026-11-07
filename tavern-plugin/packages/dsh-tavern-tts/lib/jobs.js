import { randomBytes } from 'node:crypto'
import { fail, describeTtsError } from './core.js'

// Browser principals come from the authenticated single-user Connection carrier,
// never from JSON. Only grants explicitly issued to that principal are usable.
export function createJobs({ synthesize, resolveGrant, checkGrant, ticket, liveTicket, onError = () => {}, now = Date.now, timeoutMs = () => 125000 }) {
  const jobs = new Map()
  function expire() {
    for (const [id,j] of jobs) if (j.expires <= now()) { j.abort.abort(); j.settled.abort(); jobs.delete(id) }
  }
  function read(id, principal) {
    expire(); const j = jobs.get(id)
    if (!j || j.principal !== principal) fail('JOB_GONE')
    checkGrant(j.grant); return j
  }
  return {
    pendingCount() { return [...jobs.values()].filter(job => job.state === 'running').length },
    submit(input, { principal, scope, priority }) {
      if (priority !== undefined && !['call','story'].includes(priority)) fail('INVALID_INPUT')
      expire(); const grant = resolveGrant(principal,input.voice?.source,scope)
      if (jobs.size >= 256) {
        const terminal = [...jobs].find(([,j]) => j.state !== 'running')
        if (terminal) jobs.delete(terminal[0]); else fail('QUEUE_FULL')
      }
      const requestId = randomBytes(32).toString('base64url'), abort = new AbortController()
      const budget = timeoutMs(input,grant)
      const job = { grant, principal, abort, settled:new AbortController(), streamed:new AbortController(), state:'running', expires:now()+Math.max(300000,budget+5000) }
      jobs.set(requestId,job)
      // A streaming provider's line is playable before it is complete: the job then carries a live audio ticket.
      const onStream = liveTicket && (async ({key,loudness}) => {
        try {
          const audioTicket = await liveTicket({key,grant})
          if (abort.signal.aborted || job.state !== 'running') return
          job.stream = {ticket:audioTicket,mime:'audio/wav',...(loudness ? {loudness} : {})}; job.streamed.abort()
        } catch { /* the line still arrives complete */ }
      })
      void synthesize(input,{grant,scope,priority,signal:abort.signal,...(onStream ? {onStream} : {})}).then(async result => {
        checkGrant(grant); if (abort.signal.aborted) return
        const audioTicket = await ticket({key:result.key,grant})
        checkGrant(grant); if (abort.signal.aborted) return
        job.result = { ...result, ticket:audioTicket }; job.state = 'ready'
      }).catch(e => { if (abort.signal.aborted) return; job.state = 'error'; job.error = /^[A-Z_]+$/.test(e.code || '') ? e.code : 'SERVICE_OFFLINE'; job.status = e.status; onError(job.error) }).finally(() => { job.expires = now()+300000; job.settled.abort() })
      return {requestId,timeoutMs:budget}
    },
    poll(id, principal) { const j = read(id,principal); return {requestId:id,state:j.state,...(j.stream && j.state === 'running' ? {stream:j.stream} : {}),...(j.result ? {result:j.result} : {}),...(j.error ? {error:j.error,message:describeTtsError(j.error),...(j.status ? {status:j.status} : {})} : {})} },
    // stream: also return as soon as the line is playable while it is still being spoken.
    async wait(id, principal, signal, {stream = false} = {}) {
      const j = read(id,principal)
      const woken = stream ? [j.settled.signal,j.streamed.signal] : [j.settled.signal]
      if (j.state === 'running' && !(stream && j.stream) && !signal?.aborted) {
        // Wait on the job, not a polling interval; one bounded HTTP request per caller.
        let timer, wake
        try {
          await new Promise(resolve => {
            wake = resolve
            timer = setTimeout(wake,1000)
            for (const s of woken) s.addEventListener('abort',wake,{once:true})
            signal?.addEventListener('abort',wake,{once:true})
          })
        } finally {
          clearTimeout(timer)
          for (const s of woken) s.removeEventListener('abort',wake)
          signal?.removeEventListener('abort',wake)
        }
      }
      if (signal?.aborted) fail('ABORTED')
      return this.poll(id,principal)
    },
    cancel(id, principal) { const j = read(id,principal); j.abort.abort(); j.state='cancelled'; j.result=undefined; j.settled.abort(); return {cancelled:true} },
    dispose() { for (const j of jobs.values()) { j.abort.abort(); j.settled.abort() }; jobs.clear() },
  }
}
