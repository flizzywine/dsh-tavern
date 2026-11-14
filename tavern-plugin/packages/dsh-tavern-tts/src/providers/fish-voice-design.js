import { randomUUID } from 'node:crypto'
import { mkdir, realpath, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { resolve, relative, dirname, basename, join, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fail, wav, durationMs } from '../core.js'

const execute = promisify(execFile)
export async function preparePilotAudio({source, target, bytes, signal, recordProbe, run = execute}) {
  const {stdout} = await run('ffprobe', ['-v','error','-select_streams','a:0','-show_entries','format=format_name,duration:stream=codec_name,sample_rate,channels,duration','-of','json',source], {windowsHide:true,timeout:30000,signal})
  const info = JSON.parse(stdout), stream = info.streams?.[0]
  const probe = {format:info.format?.format_name,codec:stream?.codec_name,sampleRate:Number(stream?.sample_rate),channels:stream?.channels,durationMs:Math.round(Number(stream?.duration ?? info.format?.duration) * 1000)}
  if (!probe.format || !probe.codec || !Number.isFinite(probe.sampleRate) || probe.sampleRate <= 0 || !Number.isFinite(probe.durationMs) || probe.durationMs <= 0) fail('INVALID_AUDIO')
  await recordProbe(probe)
  let compatible = true
  try { wav(bytes) } catch { compatible = false }
  if (compatible) await writeFile(target, bytes, {flag:'wx'})
  else {
    // One local conversion, never a second provider request; keep the source for review.
    await run('ffmpeg', ['-v','error','-nostdin','-n','-i',source,'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar','44100','-ac','1',target], {windowsHide:true,timeout:30000,signal})
    bytes = wav(await readFile(target))
  }
  return {probe,transcoded:!compatible,sampleRate:compatible ? probe.sampleRate : 44100,durationMs:durationMs(bytes)}
}
import { isFishCloud } from './fish-models.js'
import { createFishAudioAdapter } from './fish-audio.js'

export const maxAudioBytes = 8 * 1024 * 1024
export function decodePilotAudio(value) {
  if (typeof value !== 'string' || !value) fail('INVALID_AUDIO')
  if (Buffer.byteLength(value, 'base64') > maxAudioBytes) fail('AUDIO_TOO_LARGE')
  if (value.length % 4 || /[^A-Za-z0-9+/=]/.test(value) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('INVALID_AUDIO')
  return Buffer.from(value, 'base64')
}

const priceSource = 'https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits'
const prices = { 's2.1-pro':15, 's2-pro':15, s1:15, 's2.1-pro-free':0, 'drama-3':50 }
const units = 1000000000, cap = 500000000
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_INPUT')
}
function chinese(value, max = 20000) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || !/[\u3400-\u9fff]/u.test(value) || /[\u3040-\u30ff]/u.test(value)) fail('INVALID_INPUT')
}
export async function outputPath(root, value, fresh = false) {
  if (typeof value !== 'string' || value.split(/[\\/]/).includes('..')) fail('INVALID_OUTPUT_PATH')
  const base = await realpath(root), target = resolve(root, value)
  const inside = path => { const rel = relative(base, path); if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('INVALID_OUTPUT_PATH') }
  // Canonicalize the existing parent first: Windows short names are not traversal.
  const canonical = join(await realpath(dirname(target)), basename(target))
  inside(canonical)
  if (fresh) {
    try { await lstat(canonical); fail('OUTPUT_EXISTS') } catch (error) { if (error.code !== 'ENOENT') throw error }
    return canonical
  }
  const file = await realpath(canonical)
  inside(file)
  return file
}
// local: a pilot on a configured local Fish-compatible service (e.g. the Drama 3 worker): free, no model or budget fields.
export function validatePilot(action, plan, now = Date.now(), enforceBudget = true, local = false) {
  if (local && action !== 'pilot') fail('INVALID_PROVIDER')
  keys(plan, action === 'design' ? ['language','characters','maxCostUsd'] : local ? ['language','rows'] : ['language','model','rows','maxCostUsd'])
  if (!['design','pilot'].includes(action) || plan.language !== 'zh' || (!local && (!Number.isFinite(plan.maxCostUsd) || plan.maxCostUsd <= 0 || plan.maxCostUsd > 0.5))) fail('INVALID_INPUT')
  let price = 0
  if (action === 'pilot' && !local) {
    if (!Object.hasOwn(prices, plan.model)) fail('INVALID_INPUT')
    price = plan.model === 'drama-3' && now < Date.parse('2026-12-01T08:00:00Z') ? 10 : prices[plan.model]
  }
  const rows = action === 'design' ? plan.characters : plan.rows
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) fail('INVALID_INPUT')
  const ids = new Set()
  const requests = rows.map(row => {
    keys(row, action === 'design' ? ['id','instruction','reference_text','n'] : ['id','text','reference','references'])
    if (typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.id) || ids.has(row.id)) fail('INVALID_INPUT')
    ids.add(row.id)
    if (action === 'design') {
      chinese(row.instruction, 2000); chinese(row.reference_text, 150)
      if (!Number.isInteger(row.n) || row.n < 1 || row.n > 4) fail('INVALID_INPUT')
      return {id:row.id, body:{instruction:row.instruction, reference_text:row.reference_text, language:'zh', n:row.n}, textUtf8Bytes:Buffer.byteLength(row.reference_text), cost:10000000}
    }
    // One reference, or a whole reference pool (as an installed voice sends it) via references.
    if ((row.reference === undefined) === (row.references === undefined)) fail('INVALID_INPUT')
    const references = row.references ?? [row.reference]
    if (!Array.isArray(references) || !references.length || references.length > 32) fail('INVALID_INPUT')
    chinese(row.text); for (const reference of references) { keys(reference, ['file','text','audioBase64']); chinese(reference.text) }
    const textUtf8Bytes = Buffer.byteLength(row.text)
    return {id:row.id, text:row.text, references, pool:row.references !== undefined, textUtf8Bytes, cost:textUtf8Bytes * price * 1000}
  })
  if (enforceBudget && !local && requests.reduce((n,r) => n + r.cost, 0) > Math.floor(plan.maxCostUsd * units)) fail('BUDGET_EXCEEDED')
  return {requests, price, model:action === 'design' ? 'voice-design-1' : local ? null : plan.model}
}

// Reservations survive crashes and lost replies. Only a known unbilled response releases one.
export function createVoicePilot({fetch = globalThis.fetch, budgetRoot, now = Date.now} = {}) {
  return async function run(args, provider, resolveKey) {
    keys(args, ['action','serviceId','plan','dryRun','confirm'])
    if (typeof args.serviceId !== 'string' || args.serviceId !== provider.id || provider.kind !== 'fish-audio') fail('INVALID_PROVIDER')
    if (!((args.dryRun === true && !args.confirm) || (args.confirm === true && !args.dryRun))) fail('INVALID_INPUT')
    // Design is cloud only; a pilot on a local Fish-compatible service is free and never touches the budget.
    const local = !isFishCloud(provider.config)
    const prepared = validatePilot(args.action, args.plan, now(), args.dryRun === true, local)
    if (!budgetRoot) fail('PILOT_STORAGE_UNAVAILABLE')
    for (const row of prepared.requests) if (row.references) row.referenceBytes = row.references.map(reference => decodePilotAudio(reference.audioBase64))
    const total = prepared.requests.reduce((n,r) => n + r.cost, 0)
    const budgetFile = join(budgetRoot, 'voice-pilot-budget.json'), lock = join(budgetRoot, 'voice-pilot-budget.lock')
    async function loadBudget() {
      try { if ((await lstat(budgetFile)).isSymbolicLink()) fail('INVALID_OUTPUT_PATH'); const value = JSON.parse(await readFile(budgetFile, 'utf8')); if (!Number.isSafeInteger(value.reserved) || value.reserved < 0) fail('INVALID_BUDGET'); return value }
      catch (error) { if (error.code === 'ENOENT') return {reserved:0}; throw error }
    }
    if (args.dryRun) {
      const budget = await loadBudget()
      if (budget.reserved + total > cap) fail('BUDGET_EXCEEDED')
      return {dryRun:true, model:prepared.model, requests:prepared.requests.length, estimatedCostUsd:total / units, cumulativeReservedUsd:budget.reserved / units}
    }
    const key = await resolveKey()
    if (!key) fail('CREDENTIALS_REQUIRED')
    await mkdir(lock)
    try {
      const budget = await loadBudget()
      const budgetExceeded = !local && (budget.reserved + total > cap || total > Math.floor(args.plan.maxCostUsd * units))
      const receiptId = randomUUID()
      const receiptFile = join(budgetRoot, 'voice-pilot-receipts', receiptId + '.json')
      await mkdir(dirname(receiptFile), {recursive:true})
      const deadline = now() + 110000, signal = AbortSignal.timeout(110000)
      const receipt = {receiptId, receiptFile, serviceId:args.serviceId, model:prepared.model, language:'zh', ...(local ? {priceSource:null, priceUsd:0, priceUnit:null, accounting:'local-free'} : {priceSource, priceUsd:args.action === 'design' ? 0.01 : prepared.price / 1000000, priceUnit:args.action === 'design' ? 'successful-request' : 'utf8-byte', accounting:'public-price-not-invoice'}), complete:false, stopReason:'in_progress', plannedRequests:prepared.requests.length, requests:prepared.requests.map(row => ({id:row.id, kind:args.action, ...(row.body ? {instruction:row.body.instruction, reference_text:row.body.reference_text} : {text:row.text, ...(row.pool ? {references:row.references.map(r => ({file:r.file, text:r.text}))} : {reference:{file:row.references[0].file, text:row.references[0].text}})}), textUtf8Bytes:row.textUtf8Bytes, outcome:'not_attempted', unknownCostUsd:0, estimatedCostUsd:null, audio:[]}))}
      const save = async () => {
        await writeFile(budgetFile + '.tmp', JSON.stringify(budget) + '\n', {flag:'wx'}); await rename(budgetFile + '.tmp', budgetFile)
        await writeFile(receiptFile + '.tmp', JSON.stringify(receipt, (key,value) => key === 'audioBase64' ? undefined : value, 2) + '\n')
        await rename(receiptFile + '.tmp', receiptFile)
      }
      await save()
      for (const [position,row] of prepared.requests.entries()) {
        if (budgetExceeded) { receipt.stopReason = 'BUDGET_EXCEEDED'; break }
        if (signal.aborted || now() >= deadline) { receipt.stopReason = 'deadline'; break }
        const entry = receipt.requests[position]
        const referenceBytes = row.referenceBytes
        budget.reserved += row.cost
        Object.assign(entry, {at:new Date(now()).toISOString(), outcome:'unknown', unknownCostUsd:row.cost / units})
        await save()
        let knownError
        const singleFetch = async (url, init) => {
          const response = await fetch(url, {...init, redirect:'error'})
          entry.requestId = response.headers.get('x-request-id') ?? null
          if (!response.ok && [400,401,402,403,422,429,503].includes(response.status)) knownError = ({401:'FISH_AUTH_FAILED',403:'FISH_AUTH_FAILED',402:'FISH_BILLING_REQUIRED',429:'FISH_RATE_LIMITED'})[response.status] || 'FISH_REQUEST_FAILED'
          // Do not pass free-model 429s into the existing adapter's retry loop.
          if (!response.ok) { await response.body?.cancel(); throw new Error('FISH_REQUEST_FAILED') }
          return response
        }
        try {
          let candidates
          if (args.action === 'design') {
            const response = await singleFetch('https://api.fish.audio/v1/voice-design', {method:'POST', headers:{Authorization:'Bearer ' + key,'Content-Type':'application/json',model:'voice-design-1'}, body:JSON.stringify(row.body), signal})
            const value = await response.json()
            if (!Array.isArray(value.candidates) || value.candidates.length !== row.body.n) fail('INVALID_AUDIO')
            candidates = value.candidates.map((c,index) => {
              if (typeof c.id !== 'string' || !Number.isInteger(c.index) || (c.text != null && typeof c.text !== 'string') || typeof c.audio_base64 !== 'string' || !c.audio_base64 || !Number.isFinite(c.duration_ms) || !Number.isFinite(c.sample_rate)) fail('INVALID_AUDIO')
              return {bytes:decodePilotAudio(c.audio_base64),index,candidateId:c.id,candidateIndex:c.index,text:c.text ?? null,transcriptStatus:typeof c.text === 'string' && c.text.trim() ? 'provider_supplied' : 'not_provided',durationMs:c.duration_ms,sampleRate:c.sample_rate}
            })
          } else {
            // a local pilot speaks with its server's default model; a cloud pilot with the planned one.
            const target = local ? {kind:'fish-audio',config:provider.config} : {kind:'fish-audio',config:{url:'https://api.fish.audio'}}
            const audio = await createFishAudioAdapter({fetch:singleFetch}).synthesize(target, {key}, {text:row.text,textPrepared:true,references:row.references.map((r,i) => ({bytes:referenceBytes[i],promptText:r.text})),...(local ? {} : {params:{model:prepared.model}}), signal})
            candidates = [{bytes:audio,index:0,durationMs:durationMs(audio),sampleRate:44100}]
          }
          for (const c of candidates) {
            const file = `${row.id}-${c.index}.wav`
            if (c.bytes.length > maxAudioBytes) fail('AUDIO_TOO_LARGE')
            const item = {file,audioBase64:c.bytes.toString('base64'),durationMs:c.durationMs,sampleRate:c.sampleRate,sourceFile:`${row.id}-${c.index}.source`,...(args.action === 'design' ? {candidateId:c.candidateId,candidateIndex:c.candidateIndex,text:c.text,transcriptStatus:c.transcriptStatus,providerDurationMs:c.durationMs,providerSampleRate:c.sampleRate} : {})}
            entry.audio.push(item)
          }
          entry.outcome = 'success'; entry.estimatedCostUsd = row.cost / units; entry.unknownCostUsd = 0
        } catch (error) {
          if (error.code === 'AUDIO_TOO_LARGE') entry.nextAction = '缩短预览或试读文本；本次保留预算，不自动重试。'
          if (knownError) { budget.reserved -= row.cost; entry.outcome = 'error'; entry.code = knownError; entry.estimatedCostUsd = 0; entry.unknownCostUsd = 0 }
          else entry.code = error.code === 'AUDIO_TOO_LARGE' ? 'AUDIO_TOO_LARGE' : 'OUTCOME_UNKNOWN'
        }
        await save()
        if (entry.outcome !== 'success') { receipt.stopReason = entry.code; break }
      }
      receipt.complete = receipt.requests.every(row => row.outcome === 'success')
      if (receipt.complete) receipt.stopReason = null
      await save()
      return {complete:receipt.complete,status:receipt.complete ? 'complete' : receipt.requests.some(row => row.outcome === 'unknown') ? 'unknown' : 'partial',receipt}
    } finally { await rm(lock, {recursive:true}) }
  }
}
