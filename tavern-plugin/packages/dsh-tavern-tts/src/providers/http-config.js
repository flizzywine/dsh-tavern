// 自定义语音服务 (kind openai-compatible): any HTTP TTS API described by its connection, with no code. The presets are only
// starting values for the form; a saved service is its expanded fields, and nothing at run time reads which preset it was.
// Headers and the body template are kept as the text the owner typed and validated once, when the service is saved.
export const HTTP_PLACEHOLDERS = ['text', 'voice', 'model', 'speed', 'format', 'language', 'instructions', 'requestId']
const HEADER_PLACEHOLDERS = ['key', 'requestId']
const BLANK = {
  preset: 'blank', url: '', speechPath: '/tts', method: 'POST', headers: '', body: '{"text":"{{text}}","voice":"{{voice}}"}',
  responseMode: 'audio', audioPath: '', statusPath: '', okValues: '', endValues: '', messagePath: '', audioFormat: 'wav', sampleRate: 24000,
  modelsPath: '', modelsListPath: '', voicesPath: '', voicesListPath: '', voiceCatalog: '', testPath: '', testVoice: '', timeoutSec: 45,
}
export const HTTP_PRESETS = {
  openai: { ...BLANK, preset: 'openai', speechPath: '/v1/audio/speech', headers: 'Authorization: Bearer {{key}}',
    body: '{"model":"{{model}}","voice":"{{voice}}","input":"{{text}}","response_format":"wav","speed":"{{speed}}","instructions":"{{instructions}}"}',
    testPath: '/v1/models', testVoice: 'alloy' },
  // docs.volcengine.com/docs/ark/agent-plan-personal-voice-model (HTTP Chunked: one JSON object per line, base64 `data`,
  // code 0 while speaking, 20000000 at the end). Its voices are the 豆包语音 2.0 speakers; there is no list API.
  'volc-agent-plan': { ...BLANK, preset: 'volc-agent-plan', url: 'https://openspeech.bytedance.com', speechPath: '/api/v3/plan/tts/unidirectional',
    headers: 'X-Api-Key: {{key}}\nX-Api-Resource-Id: seed-tts-2.0\nX-Api-Request-Id: {{requestId}}',
    body: '{"req_params":{"text":"{{text}}","speaker":"{{voice}}","audio_params":{"format":"pcm","sample_rate":24000}}}',
    responseMode: 'lines', audioPath: 'data', statusPath: 'code', okValues: '0', endValues: '20000000', messagePath: 'message', audioFormat: 'pcm',
    voiceCatalog: 'volcengine', testVoice: 'zh_female_vv_uranus_bigtts' },
  blank: BLANK,
}
const KEYS = Object.keys(BLANK)
const bad = message => { throw new Error(message) }
const placeholders = text => [...text.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map(m => m[1])
function path(value, label, required = false) {
  if (typeof value !== 'string' || value.length > 500) bad(label + '无效')
  if (!value) return required ? bad('请填写' + label) : ''
  if (!/^\/(?!\/)[A-Za-z0-9_./~%-]*$/.test(value) || value.includes('..')) bad(label + '无效，请使用同一服务内的绝对路径')
  return value
}
function field(value, label) {
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9_$.-]*$/.test(value) || /^\.|\.$|\.\./.test(value)) bad(label + '无效（用点分隔的字段名，如 data.audio）')
  return value
}
const values = (value, label) => { if (typeof value !== 'string' || value.length > 200 || /[\r\n]/.test(value)) bad(label + '无效'); return value.split(',').map(v => v.trim()).filter(Boolean).join(',') }
function integer(value, min, max, label) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) bad(label + '应在 ' + min + '–' + max + ' 之间')
  return n
}
// One `名称: 值` per line. Names are HTTP tokens; the transport sets Host, length and cookies itself.
export function parseHeaders(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const at = line.indexOf(':'), name = at > 0 ? line.slice(0, at).trim() : '', value = at > 0 ? line.slice(at + 1).trim() : ''
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name) || /^(host|content-length|cookie|connection|transfer-encoding)$/i.test(name)) bad('请求头「' + line.slice(0, 40) + '」无效，每行写「名称: 值」')
    if (value.length > 2000 || /[\x00-\x1f]/.test(value)) bad('请求头「' + name + '」的值无效')
    return [name, value]
  })
}
// The form keeps what was typed; anything the owner did not set comes from the preset it started from (blank otherwise).
export function httpConfig(input = {}) {
  // a service saved before 自定义语音服务 has only {url, speechPath, modelsPath, voicesPath}: it is the OpenAI preset.
  const preset = input.preset ?? 'openai'
  if (!Object.hasOwn(HTTP_PRESETS, preset)) bad('预设无效')
  const raw = { ...HTTP_PRESETS[preset], ...Object.fromEntries(Object.entries(input).filter(([k, v]) => KEYS.includes(k) && v !== undefined)) }
  let url
  try { url = new URL(raw.url) } catch { bad('Base URL 无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) bad('Base URL 无效，只支持 http(s)，不带账号和查询参数')
  if (!['POST', 'GET'].includes(raw.method)) bad('请求方法无效')
  if (typeof raw.headers !== 'string' || raw.headers.length > 8000) bad('请求头无效')
  for (const [name, value] of parseHeaders(raw.headers)) for (const p of placeholders(value)) if (!HEADER_PLACEHOLDERS.includes(p)) bad('请求头「' + name + '」里只能用 {{key}} 和 {{requestId}}')
  if (typeof raw.body !== 'string' || raw.body.length > 8000) bad('请求体模板太长')
  let body
  try { body = JSON.parse(raw.body) } catch { bad('请求体模板不是有效的 JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('请求体模板应是一个 JSON 对象')
  const unknown = placeholders(raw.body).find(p => !HTTP_PLACEHOLDERS.includes(p))
  if (unknown) bad('请求体模板里的 {{' + unknown + '}} 不认识；可用 ' + HTTP_PLACEHOLDERS.map(p => '{{' + p + '}}').join(' '))
  if (!placeholders(raw.body).includes('text')) bad('请求体模板要用 {{text}} 放台词')
  if (!['audio', 'json', 'lines'].includes(raw.responseMode)) bad('返回内容无效')
  if (raw.responseMode !== 'audio' && !raw.audioPath) bad('请填写音频字段')
  if (!['wav', 'pcm'].includes(raw.audioFormat)) bad('音频格式无效')
  if (!['', 'volcengine'].includes(raw.voiceCatalog)) bad('内置音色表无效')
  if (typeof raw.testVoice !== 'string' || raw.testVoice.length > 160 || /[\r\n]/.test(raw.testVoice)) bad('测试音色无效')
  return {
    preset, url: url.href.replace(/\/+$/, ''), speechPath: path(raw.speechPath, '合成路径', true), method: raw.method, headers: raw.headers.trim(), body: raw.body.trim(),
    responseMode: raw.responseMode, audioPath: field(raw.audioPath, '音频字段'), statusPath: field(raw.statusPath, '状态字段'), okValues: values(raw.okValues, '成功值'),
    endValues: values(raw.endValues, '结束值'), messagePath: field(raw.messagePath, '错误说明字段'), audioFormat: raw.audioFormat,
    sampleRate: integer(raw.sampleRate, 8000, 96000, '采样率'), modelsPath: path(raw.modelsPath, '模型列表路径'), modelsListPath: field(raw.modelsListPath, '模型列表字段'),
    voicesPath: path(raw.voicesPath, '音色列表路径'), voicesListPath: field(raw.voicesListPath, '音色列表字段'), voiceCatalog: raw.voiceCatalog,
    testPath: path(raw.testPath, '测试路径'), testVoice: raw.testVoice.trim(), timeoutSec: integer(raw.timeoutSec, 5, 120, '超时秒数'),
  }
}
// Picks a dotted field (`data`, `audio.data`, `items.0.id`) out of a parsed JSON value.
export function pick(value, dotted) {
  if (!dotted) return value
  for (const part of dotted.split('.')) { if (value === null || typeof value !== 'object') return undefined; value = value[part] }
  return value
}
// A string that is exactly one placeholder becomes that value (a number stays a number; an empty value drops the key);
// placeholders inside longer text are spliced in as text.
export function fillTemplate(template, vars) {
  const one = /^\{\{\s*([A-Za-z]+)\s*\}\}$/
  const fill = value => {
    if (typeof value === 'string') {
      const m = value.match(one)
      if (m) return vars[m[1]] === undefined || vars[m[1]] === '' ? undefined : vars[m[1]]
      return value.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_, name) => vars[name] === undefined ? '' : String(vars[name]))
    }
    if (Array.isArray(value)) return value.map(fill).filter(v => v !== undefined)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]).filter(([, v]) => v !== undefined))
    return value
  }
  return fill(JSON.parse(template))
}
