import { createHash } from 'node:crypto'
import { CAST_EMOTIONS } from './cast-annotation.js'

// Voiced dialogue (docs/design/cast-presentation.md): one speech channel for all games, a voice
// per character per channel (kept with the card's character material), audio cached by content.
// Channels: the browser's own voices, a few common services, and any a plugin adds.

const MAX_TEXT = 1000
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 60000
const CONFIG_PATH = 'speech/config.json'
const CACHE_DIR = 'speech-cache'
const AUDIO_TYPES = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac' })
const hash = value => createHash('sha256').update(value).digest('hex')

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_SPEECH_INVALID' }) }

export function audioExtension(mediaType) {
  const type = String(mediaType || '').split(';')[0].trim().toLowerCase()
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3'
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav'
  if (type === 'audio/ogg' || type === 'audio/opus') return 'ogg'
  if (type === 'audio/aac') return 'aac'
  if (type === 'audio/flac') return 'flac'
  return null
}

/** A speaking style for models that take one, from the annotated emotion. */
export function emotionStyle(emotion) {
  return emotion && emotion !== 'neutral' && Object.hasOwn(CAST_EMOTIONS, emotion) ? '用' + CAST_EMOTIONS[emotion] + '的语气说这句话。' : ''
}

const MINIMAX_EMOTIONS = {
  happy: ['joy', 'amusement', 'excitement', 'love', 'gratitude', 'pride', 'optimism', 'relief', 'admiration', 'approval', 'caring', 'desire'],
  sad: ['sadness', 'grief', 'disappointment', 'remorse'],
  angry: ['anger', 'annoyance', 'disapproval'],
  fearful: ['fear', 'nervousness'],
  disgusted: ['disgust'],
  surprised: ['surprise', 'realization']
}
export function minimaxEmotion(emotion) {
  return Object.keys(MINIMAX_EMOTIONS).find(key => MINIMAX_EMOTIONS[key].includes(emotion)) || 'neutral'
}

function trimSlash(value) { return String(value || '').trim().replace(/\/+$/, '') }

async function request(fetchImpl, url, init, signal) {
  const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]
  let response
  try { response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any(signals) }) }
  catch (error) { throw new Error(error?.name === 'TimeoutError' ? '配音服务超过 60 秒未响应' : '无法连接配音服务：' + String(error?.message || error)) }
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_AUDIO_BYTES) throw new Error('配音结果超过 20 MB')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('配音结果超过 20 MB')
  if (!response.ok) throw new Error('配音服务返回 HTTP ' + response.status + '：' + bytes.toString('utf8').replace(/\s+/g, ' ').slice(0, 200))
  return { bytes, mediaType: response.headers.get('content-type') || '' }
}

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
const MINIMAX_VOICES = ['female-shaonv', 'female-yujie', 'female-chengshu', 'female-tianmei', 'male-qn-qingse', 'male-qn-jingying', 'male-qn-badao', 'male-qn-daxuesheng',
  'presenter_male', 'presenter_female', 'audiobook_male_1', 'audiobook_female_1']

export const BUILTIN_SPEECH_PROVIDERS = Object.freeze([
  {
    id: 'browser', label: '浏览器朗读', browser: true, key: false, fields: [], voices: [],
    description: '用这台设备自带的语音朗读，不用配置、不花钱；音色取决于系统，声音名留空时用默认中文语音。'
  },
  {
    id: 'openai', label: 'OpenAI 兼容接口', key: true, voices: OPENAI_VOICES, defaultVoice: 'alloy',
    description: '走 /audio/speech 接口：OpenAI、硅基流动（CosyVoice，声音名如 FunAudioLLM/CosyVoice2-0.5B:anna）和多数中转都可以。gpt-4o-mini-tts 会按台词情绪调整语气。',
    fields: [{ name: 'baseUrl', label: 'API 根地址', default: 'https://api.openai.com/v1', required: true }, { name: 'model', label: '模型', default: 'gpt-4o-mini-tts', required: true }],
    async synthesize({ config, apiKey, text, voice, emotion, signal, fetchImpl }) {
      const style = /gpt-4o/.test(config.model) ? emotionStyle(emotion) : ''
      const result = await request(fetchImpl, trimSlash(config.baseUrl) + '/audio/speech', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model: config.model, input: text, voice, response_format: 'mp3', ...(style ? { instructions: style } : {}) })
      }, signal)
      return { data: result.bytes, mediaType: audioExtension(result.mediaType) ? result.mediaType : 'audio/mpeg' }
    }
  },
  {
    id: 'gpt-sovits', label: 'GPT-SoVITS', key: false, voices: [],
    description: '自己部署的 GPT-SoVITS（api_v2.py）。声音写参考音频在服务器上的路径，可在后面加「|参考音频的文字」，例如 /data/linxi.wav|今天天气真好。',
    fields: [{ name: 'baseUrl', label: '服务地址', default: 'http://127.0.0.1:9880', required: true }, { name: 'textLang', label: '文本语言', default: 'zh', required: true }],
    async synthesize({ config, text, voice, signal, fetchImpl }) {
      const [path, ...rest] = String(voice).split('|')
      const promptText = rest.join('|').trim()
      if (!path.trim()) throw invalid('GPT-SoVITS 需要参考音频路径')
      const result = await request(fetchImpl, trimSlash(config.baseUrl) + '/tts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, text_lang: config.textLang, ref_audio_path: path.trim(), prompt_text: promptText, prompt_lang: config.textLang, media_type: 'wav', streaming_mode: false })
      }, signal)
      return { data: result.bytes, mediaType: 'audio/wav' }
    }
  },
  {
    id: 'minimax', label: 'MiniMax 语音', key: true, voices: MINIMAX_VOICES, defaultVoice: 'female-shaonv',
    description: 'MiniMax T2A v2 接口，按台词情绪选择语气。声音填系统音色或自己复刻的音色 ID。',
    fields: [{ name: 'baseUrl', label: 'API 根地址', default: 'https://api.minimaxi.com', required: true }, { name: 'model', label: '模型', default: 'speech-02-hd', required: true },
      { name: 'groupId', label: 'Group ID（选填）', default: '' }],
    async synthesize({ config, apiKey, text, voice, emotion, signal, fetchImpl }) {
      const query = config.groupId ? '?GroupId=' + encodeURIComponent(config.groupId) : ''
      const result = await request(fetchImpl, trimSlash(config.baseUrl) + '/v1/t2a_v2' + query, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model: config.model, text, stream: false, voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0, emotion: minimaxEmotion(emotion) },
          audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 } })
      }, signal)
      let body
      try { body = JSON.parse(result.bytes.toString('utf8')) } catch { throw new Error('MiniMax 返回的不是 JSON') }
      if (body?.base_resp?.status_code) throw new Error('MiniMax：' + String(body.base_resp.status_msg || body.base_resp.status_code))
      const audio = body?.data?.audio
      if (typeof audio !== 'string' || !/^[0-9a-f]+$/i.test(audio)) throw new Error('MiniMax 没有返回音频')
      return { data: Buffer.from(audio, 'hex'), mediaType: 'audio/mpeg' }
    }
  }
])

function keyRef(id) { return 'DSH_TAVERN_SPEECH_' + id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY' }

/** Text worth saying: markup and decoration out, at most MAX_TEXT characters. */
export function speechText(value) {
  const text = String(value || '').replace(/<[^>]*>/g, '').replace(/[*_~`#>|]/g, '').replace(/\s+/g, ' ').trim()
  return [...text].slice(0, MAX_TEXT).join('')
}

/**
 * @param {object} input
 * @param {object} input.store profile data store
 * @param {() => object|null} input.credentials DSH credentials service
 * @param {() => Array} input.plugins channels plugins added: { id, owner, label, description?, voices?, synthesize }
 */
export function createSpeech({ store, credentials, plugins = () => [], fetchImpl = (...args) => fetch(...args) }) {
  const pending = new Map()
  const cached = path => (typeof store.size === 'function' ? store.size(path) : store.readBytes(path).then(bytes => bytes?.length || 0)).then(size => size > 0, () => false)

  function providers() {
    return [...BUILTIN_SPEECH_PROVIDERS, ...(plugins() || []).map(entry => ({ id: entry.id, owner: entry.owner, label: entry.label, description: entry.description || '',
      key: false, fields: [], voices: entry.voices || [], defaultVoice: entry.defaultVoice || '', plugin: entry }))]
  }
  function providerOf(id) {
    const provider = providers().find(item => item.id === id)
    if (!provider) throw invalid('没有这个配音渠道（插件未加载？）：' + id)
    return provider
  }
  async function readConfig() {
    const value = await store.readJson(CONFIG_PATH).catch(() => null)
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return { enabled: object.enabled === true, provider: typeof object.provider === 'string' ? object.provider : 'browser',
      providers: object.providers && typeof object.providers === 'object' ? object.providers : {} }
  }
  function settingsOf(provider, stored) {
    const saved = stored.providers[provider.id] || {}
    const fields = Object.fromEntries(provider.fields.map(field => [field.name, typeof saved[field.name] === 'string' && saved[field.name] ? saved[field.name] : field.default || '']))
    return { ...fields, voice: typeof saved.voice === 'string' && saved.voice ? saved.voice : provider.defaultVoice || '', narratorVoice: typeof saved.narratorVoice === 'string' ? saved.narratorVoice : '' }
  }
  async function keyOf(provider) {
    if (!provider.key) return ''
    return String((await credentials()?.resolve?.(keyRef(provider.id)))?.value || '')
  }
  function missing(provider, config, apiKey) {
    const field = provider.fields.find(item => item.required && !config[item.name])
    if (field) return '请填写' + field.label
    if (provider.key && !apiKey) return '请填写 API Key'
    return ''
  }

  async function present() {
    const stored = await readConfig()
    const list = []
    for (const provider of providers()) {
      const config = settingsOf(provider, stored)
      list.push({ id: provider.id, label: provider.label, description: provider.description, owner: provider.owner || '', browser: provider.browser === true,
        key: provider.key, hasKey: Boolean(await keyOf(provider)), voices: provider.voices.slice(0, 200),
        fields: provider.fields.map(field => ({ name: field.name, label: field.label, value: config[field.name], placeholder: field.default || '' })),
        voice: config.voice, narratorVoice: config.narratorVoice })
    }
    return { enabled: stored.enabled, provider: providers().some(item => item.id === stored.provider) ? stored.provider : 'browser', providers: list }
  }

  /** Save one channel's settings (and key), which channel is used, and whether voicing is on. */
  async function save({ enabled, provider: id, config = {}, apiKey } = {}) {
    const stored = await readConfig()
    const target = id === undefined ? stored.provider : id
    const provider = providerOf(target)
    const previous = settingsOf(provider, stored)
    const next = { ...previous }
    for (const field of provider.fields) {
      if (!Object.hasOwn(config, field.name)) continue
      if (typeof config[field.name] !== 'string' || config[field.name].length > 500) throw invalid(field.label + '最多 500 字')
      next[field.name] = config[field.name].trim()
      if (field.name === 'baseUrl' && next.baseUrl && !/^https?:\/\/[^\s]+$/i.test(next.baseUrl)) throw invalid('地址要以 http:// 或 https:// 开头')
    }
    for (const name of ['voice', 'narratorVoice']) {
      if (!Object.hasOwn(config, name)) continue
      if (typeof config[name] !== 'string' || [...config[name]].length > 300) throw invalid('声音设置最多 300 字')
      next[name] = config[name].trim()
    }
    if (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey))) throw invalid('API Key 格式不正确')
    const supplied = provider.key && typeof apiKey === 'string' ? apiKey.trim() : ''
    const savedKey = await keyOf(provider)
    // A key belongs to the address it was saved with; never send it to a new one.
    if (provider.key && savedKey && !supplied && trimSlash(next.baseUrl) !== trimSlash(previous.baseUrl)) throw invalid('地址已修改，请重新填写 API Key；旧密钥不会发送到新地址')
    const turnOn = enabled === undefined ? stored.enabled : enabled === true
    if (turnOn) {
      const reason = missing(provider, next, supplied || savedKey)
      if (reason) throw invalid('还不能开启配音：' + reason)
    }
    if (supplied && supplied !== savedKey) {
      const vault = credentials()
      if (!vault?.set) throw new Error('DSH 凭据服务不可用，无法保存 API Key')
      await vault.set(keyRef(provider.id), supplied)
    }
    const { voice, narratorVoice, ...fields } = next
    await store.writeJson(CONFIG_PATH, { enabled: turnOn, provider: provider.id,
      providers: { ...stored.providers, [provider.id]: { ...fields, voice, narratorVoice } } })
    return present()
  }

  /** The channel in use, with its settings; null when voicing is off. */
  async function active() {
    const stored = await readConfig()
    if (!stored.enabled) return null
    const provider = providers().find(item => item.id === stored.provider)
    return provider ? { provider, config: settingsOf(provider, stored) } : null
  }

  async function produce(provider, config, text, voice, emotion, signal) {
    if (provider.plugin) {
      const result = await provider.plugin.synthesize({ text, voice, emotion: emotion || 'neutral', signal })
      return { data: result?.data, mediaType: result?.mediaType }
    }
    const apiKey = await keyOf(provider)
    const reason = missing(provider, config, apiKey)
    if (reason) throw invalid('配音设置不完整：' + reason)
    return provider.synthesize({ config, apiKey, text, voice, emotion, signal, fetchImpl })
  }

  /**
   * Say one line with a channel: { browser: true, voice, text } for the browser's own voices,
   * or { id, mediaType } of the cached audio. Same channel, settings, voice and text share one file.
   */
  async function synthesize({ provider: id, text: raw, voice, emotion = 'neutral', signal } = {}) {
    const stored = await readConfig()
    const provider = providerOf(id || stored.provider)
    const config = settingsOf(provider, stored)
    const text = speechText(raw)
    if (!text) throw invalid('没有可以朗读的文字')
    const speaker = typeof voice === 'string' && voice.trim() ? voice.trim() : config.voice
    if (provider.browser) return { browser: true, voice: speaker, text }
    if (!speaker) throw invalid('请先为「' + provider.label + '」填写默认声音')
    const { voice: _voice, narratorVoice: _narrator, ...fields } = config
    const usesEmotion = provider.plugin || provider.id === 'minimax' || (provider.id === 'openai' && /gpt-4o/.test(config.model))
    const digest = hash(JSON.stringify([provider.id, fields, speaker, usesEmotion ? emotion : '', text]))
    for (const extension of Object.keys(AUDIO_TYPES)) {
      if (await cached(CACHE_DIR + '/' + digest + '.' + extension)) return { id: digest + '.' + extension, mediaType: AUDIO_TYPES[extension] }
    }
    if (pending.has(digest)) return pending.get(digest)
    const job = (async () => {
      const result = await produce(provider, config, text, speaker, emotion, signal)
      const data = result?.data ? Buffer.from(result.data) : null
      const extension = audioExtension(result?.mediaType)
      if (!data?.length) throw new Error('配音渠道没有返回音频')
      if (data.length > MAX_AUDIO_BYTES) throw new Error('配音结果超过 20 MB')
      if (!extension) throw new Error('不支持的音频格式：' + String(result?.mediaType || '未知'))
      await store.writeBytes(CACHE_DIR + '/' + digest + '.' + extension, data)
      return { id: digest + '.' + extension, mediaType: AUDIO_TYPES[extension] }
    })().finally(() => pending.delete(digest))
    pending.set(digest, job)
    return job
  }

  /** The voice a character speaks with on the channel in use; narration has its own, empty = silent. */
  function voiceFor({ character, provider, config, narration }) {
    if (narration) return config.narratorVoice || null
    return character?.voices?.[provider.id] || config.voice || ''
  }

  async function readAudio(id) {
    const match = /^([0-9a-f]{64})\.(mp3|wav|ogg|aac|flac)$/.exec(String(id))
    if (!match) return undefined
    const bytes = await store.readBytes(CACHE_DIR + '/' + id).catch(() => undefined)
    return bytes ? { bytes, mediaType: AUDIO_TYPES[match[2]] } : undefined
  }

  return Object.freeze({ providers, present, save, active, synthesize, voiceFor, readAudio })
}
