import {FISH_DEFAULT_MODEL, FISH_MODELS, fishModelId, isFishCloud} from './fish-models.js'
export const PROVIDER_ID = /^[a-z][a-z0-9-]{0,23}$/
// `advanced` fields keep their default in 基础 mode; every kind may be added
// any number of times (instances differ by id, and credentials are keyed by id).
// `voiceSources`: the 配音来源 the protocol itself always serves (Provider.capabilities.voiceSources), for the protocols
// with nothing to ask: every online protocol speaks preset voice names; every Fish service takes reference audio, and adds
// voice IDs when the server answers that it serves a voice library (fish-audio.js voiceLibrary).
export const PROVIDER_KINDS = [
  { kind: 'qwen', label: '通义千问', paid: true, voiceSources: ['preset'], fields: [{ key: 'region', label: '区域', type: 'select', required: true, options: [['cn', '中国内地'], ['intl', '国际']], default: 'cn' }, { key: 'key', label: 'API Key', secret: true }] },
  { kind: 'azure', label: 'Azure', paid: true, voiceSources: ['preset'], fields: [{ key: 'region', label: '区域', required: true, placeholder: 'eastasia' }, { key: 'key', label: '订阅密钥', secret: true }] },
  // explicit model allowlist prevents Fish's unknown-model paid fallback.
  { kind: 'fish-audio', label: 'Fish Audio', paid: true, voiceSources: ['reference-list'], fields: [
    { key: 'url', label: 'Base URL', required: true, default: 'https://api.fish.audio', advanced: true },
    { key: 'model', label: '模型', type: 'select', required: true, default: FISH_DEFAULT_MODEL, options: FISH_MODELS.map(m => [m.id, m.label + (m.hint ? '（' + m.hint + '）' : '') + (m.billing === 'free' ? '（免费）' : '（计费）')]) },
    { key: 'key', label: 'API Key', secret: true },
  ] },
  { kind: 'volcengine', label: '火山引擎', paid: true, voiceSources: ['preset'], fields: [{ key: 'key', label: 'API Key', secret: true }, { key: 'resourceId', label: '资源 ID', required: true, default: 'seed-tts-2.0', advanced: true }] },
  { kind: 'minimax', label: 'MiniMax', paid: true, voiceSources: ['preset'], fields: [
    { key: 'url', label: 'API 根地址', required: true, default: 'https://api.minimaxi.com', advanced: true },
    { key: 'model', label: '模型', required: true, default: 'speech-02-hd' },
    { key: 'groupId', label: 'Group ID（选填）', advanced: true },
    { key: 'key', label: 'API Key', secret: true },
  ] },
  // endpoint paths stay on the configured origin; credentials never enter URLs.
  { kind: 'openai-compatible', label: 'OpenAI 兼容', paid: true, voiceSources: ['preset'], fields: [
    { key: 'url', label: '服务地址', required: true, placeholder: 'https://api.example.com' },
    { key: 'speechPath', label: '合成路径', default: '/v1/audio/speech', required: true, advanced: true },
    { key: 'modelsPath', label: '模型列表路径', placeholder: '/v1/models', advanced: true },
    { key: 'voicesPath', label: '音色列表路径', placeholder: '/v1/audio/voices', advanced: true },
    { key: 'key', label: 'API Key', secret: true },
  ] },
].map(item => ({ paid: false, ...item, fields: item.fields.map(field => ({ secret: false, required: false, advanced: false, placeholder: '', ...field })) }))
export function providerKind(kind) { const value = PROVIDER_KINDS.find(item => item.kind === kind); if (!value) throw new Error('语音服务类型无效'); return value }
export function credentialRef(id, field) { return 'DSH_TAVERN_TTS_' + id.toUpperCase().replace(/-/g, '_') + '_' + field.toUpperCase() }
export function providerConfig(kind, input = {}) {
  providerKind(kind)
  if (kind === 'openai-compatible') {
    let url
    try { url = new URL(input.url) } catch { throw new Error('语音服务地址无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('语音服务地址无效')
    const result = { url: url.href.replace(/\/+$/, '') }
    for (const key of ['speechPath','modelsPath','voicesPath']) {
      const path = input[key] ?? (key === 'speechPath' ? '/v1/audio/speech' : '')
      if (typeof path !== 'string' || path.length > 500 || key === 'speechPath' && !path || path && (!/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(path) || path.includes('..'))) throw new Error('接口路径无效，请使用同一服务内的绝对路径')
      result[key] = path
    }
    return result
  }
  if (kind === 'fish-audio') {
    let url
    try { url = new URL(input.url || 'https://api.fish.audio') } catch { throw new Error('Fish Audio Base URL 无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Fish Audio Base URL 无效')
    const model = !isFishCloud({url:url.href}) && !input.model ? '' : fishModelId(input.model)
    return {url:url.href.replace(/\/+$/, ''),model}
  }
  if (kind === 'minimax') {
    let url
    try { url = new URL(input.url || 'https://api.minimaxi.com') } catch { throw new Error('MiniMax API 根地址无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MiniMax API 根地址无效')
    const model = input.model || 'speech-02-hd', groupId = input.groupId || ''
    if (!/^[\w.-]{1,80}$/.test(model)) throw new Error('MiniMax 模型名称无效')
    if (!/^[\w-]{0,80}$/.test(groupId)) throw new Error('MiniMax Group ID 无效')
    return { url: url.href.replace(/\/+$/, ''), model, ...(groupId ? { groupId } : {}) }
  }
  if (kind === 'azure') { if (!/^[a-z][a-z0-9-]{0,50}$/.test(input.region || '')) throw new Error('Azure 区域无效'); return { region: input.region } }
  if (kind === 'qwen') { const region = input.region ?? 'cn'; if (!['cn', 'intl'].includes(region)) throw new Error('Qwen 区域无效'); return { region } }
  const resourceId = String(input.resourceId || 'seed-tts-2.0').trim()
  if (!/^[\w.-]{1,100}$/.test(resourceId)) throw new Error('火山引擎资源 ID 无效')
  return { resourceId }
}
function number(value, fallback, min, max) {
  const valid = typeof value === 'number' || typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value)
  const n = value === undefined ? fallback : valid ? Number(value) : NaN
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('语音参数超出范围')
  return n
}
export function moodOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32 || Object.entries(value).some(([id, v]) => !/^[a-z][a-z0-9_-]{0,31}$/.test(id) || !(v === null || typeof v === 'string' && v.length <= 200))) throw new Error('语音情绪参数无效')
  return { ...value }
}
export function presetMood(defaults, spec) {
  const mood = spec.mood
  if (typeof mood !== 'string') return null
  // Explicit null wins; legacy per-voice mappings remain readable, not their default fallback.
  for (const table of [spec.params.moods, spec.moodStyles, defaults]) {
    if (table && Object.hasOwn(table, mood)) return table[mood] || null
  }
  return null
}
export function presetParams(kind, raw = {}, base = {}) {
  // reference parameters are provider-defined synthesis values, not connection config.
  if (kind === 'reference') {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw).length > 64 || Object.entries(raw).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) || /url|path|key|token|secret|password|credential/i.test(k) || !(typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 200))) throw new Error('Invalid reference parameters')
    return {...base,...raw}
  }
  providerKind(kind)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('语音参数无效')
  const allowed = kind === 'fish-audio' ? ['referenceId','speed','volume','latency','normalize','emotionTags','emotionTag'] : kind === 'openai-compatible' ? ['voice', 'model', 'speed', 'instructions'] : kind === 'qwen' ? ['voice', 'model', 'instructions', 'moods', 'moodInstruction'] : kind === 'azure' ? ['voiceName', 'pitch', 'rate', 'styles', 'moods', 'style'] : kind === 'volcengine' ? ['speaker', 'speechRate', 'moods', 'emotion'] : kind === 'minimax' ? ['voice', 'model', 'speed', 'moods', 'emotion'] : []
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('不支持的语音参数')
  const p = { ...base, ...raw }
  const moods = p.moods === undefined ? {} : { moods: moodOverrides(p.moods) }
  if (kind === 'fish-audio') {
    if (typeof p.referenceId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(p.referenceId)) throw new Error('请填写 Fish 声音模型 ID')
    if (p.latency !== undefined && !['normal','balanced','low'].includes(p.latency)) throw new Error('Fish 延迟模式无效')
    for (const key of ['normalize','emotionTags']) if (p[key] !== undefined && typeof p[key] !== 'boolean') throw new Error('Fish 参数无效')
    return {referenceId:p.referenceId,speed:number(p.speed,1,0.5,2),volume:number(p.volume,0,-20,20),latency:p.latency ?? 'normal',normalize:p.normalize ?? true,emotionTags:p.emotionTags ?? true,...(p.emotionTag===undefined?{}:{emotionTag:p.emotionTag})}
  }
  if (kind === 'openai-compatible') {
    for (const key of ['voice','model']) if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 160 || /[\r\n]/.test(p[key])) throw new Error('请填写模型和音色名称')
    if (p.instructions !== undefined && (typeof p.instructions !== 'string' || p.instructions.length > 200)) throw new Error('风格说明无效')
    return {voice:p.voice.trim(),model:p.model.trim(),speed:number(p.speed,1,0.25,4),...(p.instructions?.trim() ? {instructions:p.instructions.trim()} : {})}
  }
  if (kind === 'azure') {
    if (p.styles !== undefined && typeof p.styles !== 'boolean') throw new Error('语音风格参数无效')
    if (!/^[a-z]{2,3}-[A-Za-z0-9-]+(?::[A-Za-z0-9-]+)?Neural$/.test(p.voiceName || '')) throw new Error('Azure 声音名称无效')
    return { voiceName: p.voiceName, pitch: number(p.pitch, 0, -50, 50), rate: number(p.rate, 0, -50, 100), ...(p.styles === undefined ? {} : { styles: p.styles }), ...(p.style === undefined ? {} : {style:p.style}), ...moods }
  }
  if (kind === 'qwen') {
    const model = p.model ?? 'qwen3-tts-flash'
    if (typeof p.voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(p.voice)) throw new Error('Qwen 声音名称无效')
    if (typeof model !== 'string' || !/^qwen[0-9a-z.-]{0,60}$/.test(model)) throw new Error('Qwen 模型名称无效')
    // optional base style for instruct models, combined with the mood instruction.
    if (p.instructions !== undefined && (typeof p.instructions !== 'string' || p.instructions.length > 200)) throw new Error('Qwen 风格说明无效')
    return { voice: p.voice, model, ...(p.instructions?.trim() ? { instructions: p.instructions.trim() } : {}), ...(p.moodInstruction === undefined ? {} : {moodInstruction:p.moodInstruction}), ...moods }
  }
  if (kind === 'minimax') {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(p.voice || '')) throw new Error('MiniMax 音色 ID 无效')
    if (p.model !== undefined && !/^[\w.-]{1,80}$/.test(p.model)) throw new Error('MiniMax 模型名称无效')
    if (p.emotion !== undefined && p.emotion !== null && !/^[a-z]{1,24}$/.test(p.emotion)) throw new Error('MiniMax 情绪参数无效')
    return { voice: p.voice, speed: number(p.speed, 1, 0.5, 2), ...(p.model === undefined ? {} : { model: p.model }), ...(p.emotion === undefined ? {} : { emotion: p.emotion }), ...moods }
  }
  if (kind === 'volcengine') { if (!/^[a-zA-Z0-9_-]{1,180}$/.test(p.speaker || '')) throw new Error('火山引擎声音 ID 无效'); return { speaker: p.speaker, speechRate: number(p.speechRate, 0, -50, 100), ...(p.emotion===undefined?{}:{emotion:p.emotion}), ...moods } }
  return {}
}
export function resolveProvider(voice, providers = []) {
  const hinted = providers.find(p => p.id === voice.providerId)
  if (hinted) return hinted.kind === voice.providerKind ? hinted : undefined
  return providers.find(p => p.kind === voice.providerKind && p.status === 'ready')
}
export function localeLanguage(locale) { const root = String(locale).split('-')[0]; return ['zh', 'ja', 'en'].includes(root) ? root : locale }
