import { createHash } from 'node:crypto'
import { compileReadingDictionary } from './reading-dictionary.js'
import { presetParams } from './providers/params.js'
import ttsMessages from './shared/tts-messages.cjs'

export class TtsError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; this.retryable = status ? status === 408 || status === 429 || status >= 500 : ['TIMEOUT', 'SERVICE_OFFLINE'].includes(code) }
}
export function fail(code, status) { throw new TtsError(code, status) }
// One safe presentation boundary for control errors and asynchronous synthesis jobs; the messages live in the protocol.
export const describeTtsError = ttsMessages.describeTtsError
export const canonical = value => JSON.stringify(sort(value))
function sort(value) {
  if (Array.isArray(value)) return value.map(sort)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
  return value
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : canonical(value)).digest('hex')
export const SHA = /^[a-f0-9]{64}$/
export function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) fail('INVALID_INPUT'); return value }
export function serviceVoiceId(value) { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}(?:\/[a-z0-9][a-z0-9_-]{0,39})?$/.test(value)) fail('INVALID_INPUT'); return value }
export function language(value) { return value === 'all_ja' ? 'ja' : value }
export function wav(value, {maxBytes = 32 * 1024 ** 2} = {}) {
  const b = Buffer.from(value)
  if (b.length < 44 || b.length > maxBytes || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(4) + 8 !== b.length) fail('INVALID_AUDIO')
  let format, dataBytes = 0, at = 12
  while (at + 8 <= b.length) {
    const size = b.readUInt32LE(at + 4), name = b.toString('ascii',at,at + 4), start = at + 8
    if (start + size > b.length) fail('INVALID_AUDIO')
    if (name === 'fmt ') {
      if (size < 16) fail('INVALID_AUDIO')
      format = {codec:b.readUInt16LE(start),channels:b.readUInt16LE(start+2),rate:b.readUInt32LE(start+4),bytesPerSecond:b.readUInt32LE(start+8),bits:b.readUInt16LE(start+14)}
    }
    if (name === 'data') dataBytes += size
    at = start + size + (size % 2)
  }
  if (!format || format.codec !== 1 || ![1,2].includes(format.channels) || format.bits !== 16 || format.rate < 8000 || format.rate > 192000 || format.bytesPerSecond !== format.rate * format.channels * 2 || !dataBytes || dataBytes % (format.channels * 2)) fail('INVALID_AUDIO')
  return b
}
export function durationMs(bytes) {
  const b = wav(bytes); let at = 12, rate = 0, size = 0
  while (at + 8 <= b.length) { const n = b.readUInt32LE(at+4), name = b.toString('ascii',at,at+4); if (name === 'fmt ') rate = b.readUInt32LE(at+16); if (name === 'data') size += n; at += 8+n+(n%2) }
  return Math.round(size / rate * 1000)
}
// the active global preset only. Compiled once per entries array (the preset store replaces the array on
// every edit), so a 5,000-entry dictionary is not recompiled and rehashed for every line.
const lexicons = new WeakMap()
export function lexicon(entries = []) {
  const known = lexicons.get(entries)
  if (known) return known
  const value = compileLexicon(entries)
  lexicons.set(entries, value)
  return value
}
function compileLexicon(list) {
  const dictionary = compileReadingDictionary(list)
  // Keep the semantic fingerprint stable for unchanged/empty Japanese dictionaries.
  const entries = dictionary.entries.map(({language, form, reading}) => ({lang:language, surface:form, reading}))
  return {revision:hash({algorithm:'longest-single-pass-v1', entries}), apply:dictionary.apply}
}

export function portableVoice(input) {
  const v = structuredClone(input)
  if (v.schemaVersion !== 1 || !['service', 'reference', 'azure', 'volcengine', 'qwen', 'fish-audio', 'openai-compatible', 'minimax'].includes(v.kind)) fail('API_INCOMPATIBLE')
  if (['service', 'qwen'].includes(v.kind) || ['azure', 'volcengine', 'fish-audio', 'openai-compatible', 'minimax'].includes(v.kind) && typeof v.id === 'string' && v.id.includes('/')) serviceVoiceId(v.id); else id(v.id)
  const languages = v.kind === 'fish-audio' ? ['ja','all_ja','zh','en','ko','fr','de','ru','it','es','pt','ar','nl','pl'] : v.kind === 'qwen' || v.kind === 'service' && v.engine === 'qwen' ? ['ja','all_ja','zh','en','ko','fr','de','ru','it','es','pt'] : ['ja','all_ja','zh','en','ko','yue']
  if (typeof v.label !== 'string' || v.label.length > 160 || typeof v.enabled !== 'boolean' || !Array.isArray(v.languages) || !v.languages.length || v.languages.some(l => !languages.includes(l))) fail('INVALID_INPUT')
  if (!v.params || typeof v.params !== 'object' || Array.isArray(v.params)) fail('INVALID_INPUT')
  if (v.kind === 'service') {
    serviceVoiceId(v.voiceId)
    // A catalogue voice names the engine its service declares (serviceVoiceEngines); Tavern keeps no engine list.
    id(v.engine); if (typeof v.revision !== 'string' || !v.revision) fail('API_INCOMPATIBLE')
    if (v.model !== undefined || v.modelRequirements !== undefined || v.references !== undefined) fail('INVALID_INPUT')
    for (const key of ['modelSetId', 'modelVersion']) if (v[key] !== undefined) id(v[key])
    if (v.engine === 'qwen') { try { v.params = presetParams('qwen', v.params) } catch { fail('INVALID_PARAMS') } }
    else if (Object.values(v.params).some(value => !(typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string' && value.length <= 160))) fail('INVALID_PARAMS')
    return v
  }
  try { v.params = presetParams(v.kind, v.params) } catch { fail('INVALID_PARAMS') }
  if (v.model !== undefined || v.modelRequirements !== undefined) fail('INVALID_INPUT')
  delete v.modelDigest
  if (v.moodStyles && (typeof v.moodStyles !== 'object' || Object.entries(v.moodStyles).some(([m,s]) => !/^[a-z-]{1,24}$/.test(m) || typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(s)))) fail('INVALID_INPUT')
  if (v.references !== undefined && !Array.isArray(v.references)) fail('MISSING_REFERENCE')
  for (const r of v.references || []) {
    if (!r || typeof r !== 'object' || !SHA.test(r.sha256) || typeof r.transcript !== 'string' || r.file !== undefined && !/^[A-Za-z0-9_-]+\.(wav|mp3)$/.test(r.file)) fail('MISSING_REFERENCE')
    language(r.language)
  }
  if (v.kind === 'reference' && !v.references?.length) fail('MISSING_REFERENCE')
  if (['azure', 'volcengine', 'qwen', 'fish-audio', 'openai-compatible', 'minimax'].includes(v.kind) && Object.keys(v.references || {}).length) fail('REFERENCE_UNSUPPORTED')
  return v
}

// Presets carry synthesis data only; service configuration and credentials never travel.
export function voicePreset(input) {
  const keys = ['schemaVersion','id','label','enabled','kind','languages','params','providerId','moodStyles', ...(input?.kind === 'service' ? ['voiceId','engine','revision','modelSetId','modelVersion'] : [])]
  if (!input || Object.keys(input).some(k => !keys.includes(k)) || !['azure','qwen','fish-audio','volcengine','openai-compatible','minimax','service'].includes(input.kind)) fail('INVALID_INPUT')
  serviceVoiceId(input.id)
  if (!input.id.includes('/') || typeof input.label !== 'string' || !input.label.trim()) fail('INVALID_INPUT')
  if (input.providerId !== undefined) id(input.providerId)
  return portableVoice(input)
}
