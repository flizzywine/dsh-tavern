import { describeTtsError } from './core.js'
import { isSameOriginRequest } from './shared/request-origin.js'

// Connection owns login-cookie authentication for the shared /api carrier.
// Keep a stricter same-origin check here, including read-only sensitive actions.
export function sameOrigin(request) {
  // Connection's Fetch bridge deliberately uses http://dsh.internal, preserving Host.
  const host = request.headers.get('host') || new URL(request.url).host
  return isSameOriginRequest({ host, origin: request.headers.get('origin'), fetchSite: request.headers.get('sec-fetch-site') })
}
export function json(value, status = 200) { return Response.json(value, { status, headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'} }) }
// control requests carry whole reading presets on import (up to
// READING_ENTRY_LIMIT rows), so they get a larger, explicit bound; synthesis requests keep the small one.
export const BODY_LIMIT = 65536, CONTROL_BODY_LIMIT = 8 * 1024 ** 2
export async function body(request, limit = BODY_LIMIT) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error(), {code:'INVALID_INPUT'})
  const reader = request.body?.getReader(); let size = 0; const chunks = []
  if (!reader) return {}
  try {
    while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Object.assign(new Error('BODY_TOO_LARGE'), {code:'BODY_TOO_LARGE'}); chunks.push(Buffer.from(value)) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}
export function registerRoutes(ctx, prefix, dispatch, audio, jobs, samples) {
  ctx.inject(['connection'], child => {
    const connection = child.get('connection')
    child.effect(() => connection.fetch.register({ path:prefix + '/control', methods:['POST'], requestBody:'streaming', fetch:request => handleControl(request, dispatch) }))
    if (jobs) {
      child.effect(() => connection.fetch.register({ path:prefix + '/synthesis', methods:['POST'], requestBody:'streaming', fetch:request => handleSynthesis(request,jobs) }))
      child.effect(() => connection.fetch.register({ path:prefix + '/synthesis/status', methods:['GET','DELETE'], requestBody:'buffered', fetch:request => handleSynthesis(request,jobs) }))
    }
    if (audio) child.effect(() => connection.fetch.register({ path:prefix + '/audio', methods:['GET'], requestBody:'buffered', fetch:async request => {
      if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
      try { const bytes = await audio(new URL(request.url).searchParams.get('ticket')); return new Response(bytes,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}) }
      catch { return json({error:'AUDIO_GONE'},410) }
    } }))
    // an official provider sample already in the host's sample cache (fishSample
    // control); this route only reads the cache, it never downloads.
    if (samples) child.effect(() => connection.fetch.register({ path:prefix + '/sample', methods:['GET'], requestBody:'buffered', fetch:request => handleSample(request,samples) }))
  })
}
export async function handleSample(request, samples) {
  if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
  try { const {bytes,mime} = await samples.read(new URL(request.url).searchParams.get('key')); return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}}) }
  catch { return json({error:'SAMPLE_UNAVAILABLE'},404) }
}
export async function handleSynthesis(request, jobs) {
  if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
  // DSH 0.1.5 has one authenticated browser administrator, not user accounts.
  const principal = 'dsh-browser', query = new URL(request.url).searchParams, requestId = query.get('requestId')
  try {
    if (request.method === 'GET') return json(query.get('wait') === '1' ? await jobs.wait(requestId,principal,request.signal,{stream:query.get('stream') === '1'}) : jobs.poll(requestId,principal))
    if (request.method === 'DELETE') return json(jobs.cancel(requestId,principal))
    const input = await body(request)
    return json(jobs.submit(input.input,{principal,scope:input.scope,priority:input.priority}),202)
  } catch (e) { const code = /^[A-Z_]+$/.test(e.code || '') ? e.code : 'INVALID_INPUT'; return json({error:code,message:describeTtsError(code)},code === 'FORBIDDEN' ? 403 : code === 'JOB_GONE' ? 410 : 400) }
}
export async function handleControl(request, dispatch) {
  if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
  try { const input = await body(request, CONTROL_BODY_LIMIT); return json(await dispatch(input.method, input.args || {})) }
  catch (e) { const code = /^[A-Z_]+$/.test(e.code || '') ? e.code : 'REQUEST_FAILED'; return json({error:code,message:describeTtsError(code)},400) }
}

// Management stays available when the consumer service is disabled. Connection
// authenticates this same-origin stream just like the control endpoints.
export function registerEnabledRoute(ctx, state) {
  ctx.inject(['connection'], child => {
    const streams = new Set()
    child.effect(() => () => { for (const close of streams) close() })
    child.effect(() => child.get('connection').fetch.register({
      path:'/api/dsh-tts/v1/enabled', methods:['GET'], requestBody:'buffered',
      fetch(request) {
        if (!sameOrigin(request)) return json({error:'FORBIDDEN'},403)
        let close
        const stream = new ReadableStream({
          start(controller) {
            const send = enabled => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({enabled}) + '\n\n'))
            const unsubscribe = state.subscribe(send)
            close = (end = true) => {
              if (!streams.delete(close)) return
              unsubscribe(); request.signal.removeEventListener('abort',close); if (end) controller.close()
            }
            streams.add(close); request.signal.addEventListener('abort',close,{once:true})
            if (request.signal.aborted) close(); else send(state.get())
          },
          cancel() { close(false) },
        })
        return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store'}})
      },
    }))
  })
}
