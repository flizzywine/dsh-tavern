import builtin from '../shared/azure-voices.json' with { type: 'json' }
import { localeLanguage, presetMood } from './params.js'
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]))
// Classic Neural SSML styles: shy is not a documented express-as style.
export const AZURE_MOODS = Object.freeze({}) // styles belong to voice declarations.
export function azureMood(spec) {
  const style = Object.hasOwn(spec.params,'style') ? spec.params.style : presetMood(AZURE_MOODS, spec), { voiceName, styles } = spec.params
  if (!style || styles === false) return null
  // Known capability lists are authoritative, including Ashley's empty list.
  const supported = builtin[voiceName]?.styles
  return supported ? supported.includes(style) ? style : null : styles === true ? style : null
}
export function azureSsml(spec) {
  const { voiceName, pitch = 0, rate = 0 } = spec.params
  const style = azureMood(spec)
  const pct = n => (n >= 0 ? '+' : '') + n + '%'
  let content = '<prosody pitch="' + pct(pitch) + '" rate="' + pct(rate) + '">' + escape(spec.text) + '</prosody>'
  if (style) content = '<mstts:express-as style="' + escape(style) + '" styledegree="1">' + content + '</mstts:express-as>'
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="' + escape(voiceName.split('-').slice(0, 2).join('-')) + '"><voice name="' + escape(voiceName) + '">' + content + '</voice></speak>'
}
export const azureVoices = () => [...Object.entries(builtin).map(([id,v]) => ({id,label:id,languages:[localeLanguage(id.split('-').slice(0,2).join('-'))],styles:v.styles})),
  {id:'ja-JP-NanamiNeural',label:'Nanami',languages:['ja'],gender:'Female',styles:[]},
  {id:'ja-JP-KeitaNeural',label:'Keita',languages:['ja'],gender:'Male',styles:[]}]
export function createAzureAdapter({ fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(provider, secret, route, body, signal) {
    let response
    try { response = await fetchImpl('https://' + provider.config.region + '.tts.speech.microsoft.com/cognitiveservices/' + route, { method: body ? 'POST' : 'GET', headers: { ...(secret.key ? { 'Ocp-Apim-Subscription-Key': secret.key } : {}), 'User-Agent': 'dsh-tavern-tts', ...(body ? { 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm' } : {}) }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]) }) } catch { throw new Error('Azure 语音连接失败或请求超时') }
    if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'Azure 密钥或区域无效' : response.status === 429 ? 'Azure 语音额度不足或请求过于频繁' : 'Azure 语音服务请求失败（' + response.status + '）'), {status:response.status})
    return response
  }
  return {
    async catalog(provider, secret) { const items = await (await request(provider, secret, 'voices/list')).json(); return { items: items.map(v => { const languages = [...new Set([v.Locale, ...(v.SecondaryLocaleList || [])].filter(Boolean).map(localeLanguage))]; return { id: v.ShortName, label: v.LocalName || v.DisplayName || v.ShortName, languages, gender: v.Gender, styles: v.StyleList || [], ...(languages.some(l => !['zh', 'ja', 'en'].includes(l)) ? { note: '包含当前角色界面尚不支持的语言' } : {}) } }) } },
    async synthesize(provider, secret, spec) { return Buffer.from(await (await request(provider, secret, 'v1', azureSsml(spec), spec.signal)).arrayBuffer()) }
  }
}
