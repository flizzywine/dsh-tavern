import {fishModelId} from './fish-models.js'
import {httpConfig, HTTP_PRESETS} from './http-config.js'
export const PROVIDER_ID = /^[a-z][a-z0-9-]{0,23}$/
// `advanced` fields keep their default in 基础 mode; every kind may be added
// any number of times (instances differ by id, and credentials are keyed by id).
// `voiceSources`: the 配音来源 the protocol itself always serves (Provider.capabilities.voiceSources), for the protocols
// with nothing to ask: every online protocol speaks preset voice names; every Fish service takes reference audio, and adds
// voice IDs when the server answers that it serves a voice library (fish-audio.js voiceLibrary).
// `fields` are the connection (语音后端); `voice` is what a figure picks for its source of this kind (素材库 人物 › 声音),
// in order: `model` (the service's models list), `voice` (its voice list). How it speaks (the source kind) is `voiceSources`.
export const PROVIDER_KINDS = [
  { kind: 'qwen', label: '通义千问', paid: true, voiceSources: ['preset'], voice: ['model', 'voice'], fields: [{ key: 'region', label: '区域', type: 'select', required: true, options: [['cn', '中国内地'], ['intl', '国际']], default: 'cn' }, { key: 'key', label: 'API Key', secret: true }] },
  { kind: 'azure', label: 'Azure', paid: true, voiceSources: ['preset'], voice: ['voice'], fields: [{ key: 'region', label: '区域', required: true, placeholder: 'eastasia' }, { key: 'key', label: 'API Key', secret: true }] },
  // A service is only its connection: which model speaks is each figure's choice (its voice source's `model`).
  { kind: 'fish-audio', label: 'Fish Audio', paid: true, voiceSources: ['reference-list'], voice: ['model'], fields: [
    { key: 'url', label: 'Base URL', required: true, default: 'https://api.fish.audio', advanced: true },
    { key: 'key', label: 'API Key', secret: true },
  ] },
  { kind: 'volcengine', label: '火山引擎', paid: true, voiceSources: ['preset'], voice: ['voice'], fields: [{ key: 'key', label: 'API Key', secret: true }, { key: 'resourceId', label: '资源 ID', required: true, default: 'seed-tts-2.0', advanced: true }] },
  { kind: 'minimax', label: 'MiniMax', paid: true, voiceSources: ['preset'], voice: ['model', 'voice'], fields: [
    { key: 'url', label: 'Base URL', required: true, default: 'https://api.minimaxi.com', advanced: true },
    { key: 'groupId', label: 'Group ID', advanced: true },
    { key: 'key', label: 'API Key', secret: true },
  ] },
  // 自定义语音服务 (http-config.js): `preset` fills the form; the fields marked `more` sit under the form's 「高级」.
  { kind: 'openai-compatible', label: '自定义语音服务', paid: true, voiceSources: ['preset'], voice: ['model', 'voice'], presets: HTTP_PRESETS, fields: [
    { key: 'preset', label: '预设', type: 'preset', required: true, options: [['openai', 'OpenAI 兼容'], ['volc-agent-plan', '火山方舟 Agent Plan'], ['blank', '从空白开始']], default: 'openai' },
    { key: 'url', label: 'Base URL', required: true, placeholder: 'https://api.example.com' },
    { key: 'key', label: 'API Key', secret: true },
    { key: 'speechPath', label: '合成路径', required: true, more: true },
    { key: 'method', label: '请求方法', type: 'select', options: [['POST', 'POST'], ['GET', 'GET']], more: true },
    { key: 'headers', label: '请求头', type: 'lines', placeholder: 'Authorization: Bearer {{key}}', more: true, help: '每行一个「名称: 值」。{{key}} 换成上面的 API Key，{{requestId}} 换成每次不同的请求 ID。' },
    { key: 'body', label: '请求体模板', type: 'lines', more: true, help: 'JSON。可用 {{text}} 台词、{{voice}} 音色、{{model}} 模型、{{speed}} 语速、{{format}} 音频格式、{{language}} 语言、{{instructions}} 风格说明；整格只放一个占位时没有值的那项会被去掉。' },
    { key: 'responseMode', label: '返回内容', type: 'select', options: [['audio', '音频本身'], ['json', 'JSON 里的 base64'], ['lines', '流式逐段（SSE 或逐行 JSON）']], more: true },
    { key: 'audioPath', label: '音频字段', placeholder: 'data', more: true },
    { key: 'statusPath', label: '状态字段', placeholder: 'code', more: true },
    { key: 'okValues', label: '成功值', placeholder: '0', more: true },
    { key: 'endValues', label: '结束值', placeholder: '20000000', more: true },
    { key: 'messagePath', label: '错误说明字段', placeholder: 'message', more: true },
    { key: 'audioFormat', label: '音频格式', type: 'select', options: [['wav', 'WAV'], ['pcm', 'PCM（16 位单声道）']], more: true },
    { key: 'sampleRate', label: 'PCM 采样率', more: true },
    { key: 'voicesPath', label: '音色列表路径', placeholder: '/v1/audio/voices', more: true },
    { key: 'voicesListPath', label: '音色列表字段', placeholder: 'voices', more: true },
    { key: 'modelsPath', label: '模型列表路径', placeholder: '/v1/models', more: true },
    { key: 'modelsListPath', label: '模型列表字段', placeholder: 'data', more: true },
    { key: 'voiceCatalog', label: '内置音色表', type: 'select', options: [['', '无'], ['volcengine', '豆包语音 2.0']], more: true },
    { key: 'testPath', label: '测试路径', placeholder: '/v1/models', more: true, help: '免费检查密钥的 GET 路径；不填时「测试」会真的合成一个字。' },
    { key: 'testVoice', label: '测试音色', more: true },
    { key: 'timeoutSec', label: '超时（秒）', more: true },
  ] },
].map(item => ({ paid: false, voice: [], ...item, fields: item.fields.map(field => ({ secret: false, required: false, advanced: false, placeholder: '', ...field })) }))
export function providerKind(kind) { const value = PROVIDER_KINDS.find(item => item.kind === kind); if (!value) throw new Error('语音服务类型无效'); return value }
export function credentialRef(id, field) { return 'DSH_TAVERN_TTS_' + id.toUpperCase().replace(/-/g, '_') + '_' + field.toUpperCase() }
export function providerConfig(kind, input = {}) {
  providerKind(kind)
  if (kind === 'openai-compatible') return httpConfig(input)
  if (kind === 'fish-audio') {
    let url
    try { url = new URL(input.url || 'https://api.fish.audio') } catch { throw new Error('Fish Audio Base URL 无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Fish Audio Base URL 无效')
    return {url:url.href.replace(/\/+$/, '')}
  }
  if (kind === 'minimax') {
    let url
    try { url = new URL(input.url || 'https://api.minimaxi.com') } catch { throw new Error('MiniMax Base URL 无效') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MiniMax Base URL 无效')
    const groupId = input.groupId || ''
    if (!/^[\w-]{0,80}$/.test(groupId)) throw new Error('MiniMax Group ID 无效')
    return { url: url.href.replace(/\/+$/, ''), ...(groupId ? { groupId } : {}) }
  }
  if (kind === 'azure') { if (!/^[a-z][a-z0-9-]{0,50}$/.test(input.region || '')) throw new Error('Azure 区域无效'); return { region: input.region } }
  if (kind === 'qwen') { const region = input.region ?? 'cn'; if (!['cn', 'intl'].includes(region)) throw new Error('通义千问区域无效'); return { region } }
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
  const allowed = kind === 'fish-audio' ? ['referenceId','model','speed','volume','latency','normalize','emotionTags','emotionTag'] : kind === 'openai-compatible' ? ['voice', 'model', 'speed', 'instructions'] : kind === 'qwen' ? ['voice', 'model', 'instructions', 'moods', 'moodInstruction'] : kind === 'azure' ? ['voiceName', 'pitch', 'rate', 'styles', 'moods', 'style'] : kind === 'volcengine' ? ['speaker', 'speechRate', 'moods', 'emotion'] : kind === 'minimax' ? ['voice', 'model', 'speed', 'moods', 'emotion'] : []
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('不支持的语音参数')
  const p = { ...base, ...raw }
  const moods = p.moods === undefined ? {} : { moods: moodOverrides(p.moods) }
  if (kind === 'fish-audio') {
    if (typeof p.referenceId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(p.referenceId)) throw new Error('请填写 Fish 声音模型 ID')
    if (p.latency !== undefined && !['normal','balanced','low'].includes(p.latency)) throw new Error('Fish 延迟模式无效')
    for (const key of ['normalize','emotionTags']) if (p[key] !== undefined && typeof p[key] !== 'boolean') throw new Error('Fish 参数无效')
    return {referenceId:p.referenceId,...(p.model === undefined ? {} : {model:fishModelId(p.model)}),speed:number(p.speed,1,0.5,2),volume:number(p.volume,0,-20,20),latency:p.latency ?? 'normal',normalize:p.normalize ?? true,emotionTags:p.emotionTags ?? true,...(p.emotionTag===undefined?{}:{emotionTag:p.emotionTag})}
  }
  if (kind === 'openai-compatible') {
    if (typeof p.voice !== 'string' || !p.voice.trim() || p.voice.length > 160 || /[\r\n]/.test(p.voice)) throw new Error('请填写音色名称')
    if (p.model !== undefined && (typeof p.model !== 'string' || p.model.length > 160 || /[\r\n]/.test(p.model))) throw new Error('模型名称无效')
    if (p.instructions !== undefined && (typeof p.instructions !== 'string' || p.instructions.length > 200)) throw new Error('风格说明无效')
    return {voice:p.voice.trim(),...(p.model?.trim() ? {model:p.model.trim()} : {}),speed:number(p.speed,1,0.25,4),...(p.instructions?.trim() ? {instructions:p.instructions.trim()} : {})}
  }
  if (kind === 'azure') {
    if (p.styles !== undefined && typeof p.styles !== 'boolean') throw new Error('语音风格参数无效')
    if (!/^[a-z]{2,3}-[A-Za-z0-9-]+(?::[A-Za-z0-9-]+)?Neural$/.test(p.voiceName || '')) throw new Error('Azure 音色名称无效')
    return { voiceName: p.voiceName, pitch: number(p.pitch, 0, -50, 50), rate: number(p.rate, 0, -50, 100), ...(p.styles === undefined ? {} : { styles: p.styles }), ...(p.style === undefined ? {} : {style:p.style}), ...moods }
  }
  if (kind === 'qwen') {
    const model = p.model ?? 'qwen3-tts-flash'
    if (typeof p.voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(p.voice)) throw new Error('通义千问音色名称无效')
    if (typeof model !== 'string' || !/^qwen[0-9a-z.-]{0,60}$/.test(model)) throw new Error('通义千问模型名称无效')
    // optional base style for instruct models, combined with the mood instruction.
    if (p.instructions !== undefined && (typeof p.instructions !== 'string' || p.instructions.length > 200)) throw new Error('通义千问风格说明无效')
    return { voice: p.voice, model, ...(p.instructions?.trim() ? { instructions: p.instructions.trim() } : {}), ...(p.moodInstruction === undefined ? {} : {moodInstruction:p.moodInstruction}), ...moods }
  }
  if (kind === 'minimax') {
    // System voice ids carry spaces and brackets ("Chinese (Mandarin)_News_Anchor"); the id travels only in the JSON body.
    if (typeof p.voice !== 'string' || !/^[^\p{Cc}]{1,160}$/u.test(p.voice)) throw new Error('MiniMax 音色 ID 无效')
    if (p.model !== undefined && !/^[\w.-]{1,80}$/.test(p.model)) throw new Error('MiniMax 模型名称无效')
    if (p.emotion !== undefined && p.emotion !== null && !/^[a-z]{1,24}$/.test(p.emotion)) throw new Error('MiniMax 情绪参数无效')
    return { voice: p.voice, speed: number(p.speed, 1, 0.5, 2), ...(p.model === undefined ? {} : { model: p.model }), ...(p.emotion === undefined ? {} : { emotion: p.emotion }), ...moods }
  }
  if (kind === 'volcengine') { if (!/^[a-zA-Z0-9_-]{1,180}$/.test(p.speaker || '')) throw new Error('火山引擎音色 ID 无效'); return { speaker: p.speaker, speechRate: number(p.speechRate, 0, -50, 100), ...(p.emotion===undefined?{}:{emotion:p.emotion}), ...moods } }
  return {}
}
export function resolveProvider(voice, providers = []) {
  const hinted = providers.find(p => p.id === voice.providerId)
  if (hinted) return hinted.kind === voice.providerKind ? hinted : undefined
  return providers.find(p => p.kind === voice.providerKind && p.status === 'ready')
}
export function localeLanguage(locale) { const root = String(locale).split('-')[0]; return ['zh', 'ja', 'en'].includes(root) ? root : locale }
