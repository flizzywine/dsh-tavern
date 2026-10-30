import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { combineStructuredPrompt } from './prompt-presets.js'
import { effectiveImageProvider, supportsImageReferences, supportsImageTaskResume } from './image-provider-capabilities.js'
export { effectiveImageProvider, supportsImageReferences, supportsImageTaskResume }

const DEFAULT_MAX = 32 * 1024 * 1024
const DEFAULT_TIMEOUT = 300_000
const PROVIDERS = {
  novelai: ['NovelAI / 同协议第三方', 'https://image.novelai.net', 'nai-diffusion-4-5-full'],
  openai: ['OpenAI / Images 兼容中转', 'https://api.openai.com/v1', 'gpt-image-2.5-flare'],
  gemini: ['Google Gemini 原生', 'https://generativelanguage.googleapis.com/v1', 'gemini-3.1-flash-image'],
  'gemini-chat': ['Banana / Gemini 聊天兼容中转', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash-image'],
  grok: ['Grok Images', 'https://api.x.ai/v1', 'grok-imagine-image-2.0'],
  seedream: ['Seedream / 火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seedream-5-0-pro-260628'],
  qwen: ['百炼 Qwen-Image', 'https://dashscope-intl.aliyuncs.com/api/v1', 'qwen-image-3.0'],
  atlascloud: ['atlas cloud', 'https://api.atlascloud.ai/api/v1', 'black-forest-labs/flux-schnell'],
  sdwebui: ['Stable Diffusion WebUI / Forge', 'http://127.0.0.1:7860', ''],
  custom: ['自定义兼容渠道', '', '']
}

// Atlas Cloud remains a supported wire adapter, but users configure it as an
// explicitly selected protocol under the single custom channel type.
export const IMAGE_PROVIDERS = Object.entries(PROVIDERS)
  .filter(([id]) => id !== 'atlascloud')
  .map(([id, [label, baseUrl, model]]) => ({ id, label, baseUrl, model }))

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const secretValues = channel => [channel?.apiKey, channel?.password,
  channel?.authMode === 'basic' && (channel.username || channel.password) ? `${channel.username || ''}:${channel.password || ''}` : '',
].filter(Boolean).map(String)
function redact(text, channel) {
  let out = String(text ?? '').replace(/\r\n?|\n|\t/g, ' ')
  const secrets = secretValues(channel).flatMap(secret => [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])
  for (const secret of secrets) if (secret) out = out.split(secret).join('[redacted]')
  // Provider/network errors can echo signed URLs, URL userinfo or local file
  // names. None are needed to explain an API failure, and they must not reach
  // the job log/UI. Decode JSON slash escaping before removing entire URLs.
  out = out.replace(/\\\//g, '/')
    .replace(/data:[^\s,]+,[a-z\d+/=_\s-]+/gi, '[redacted-image]')
    .replace(/\b(?:https?|file)(?::\/\/|%3a%2f%2f)[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b[a-z]:[\\/][^\r\n"'<>]*/gi, '[redacted-path]')
    .replace(/\\\\[^\r\n"'<>]+/g, '[redacted-path]')
    .replace(/(^|[\s("'])\/(?!\/)[^\r\n"'<>]+/g, '$1[redacted-path]')
  return out.slice(0, 500)
}
function validateBase(channel) {
  let url
  try { url = new URL(channel?.baseUrl || PROVIDERS[channel?.provider]?.[1]) } catch { throw new Error('生图渠道地址必须是完整的 HTTP(S) 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('生图渠道地址必须是干净的 HTTP(S) 服务地址')
  return url.href.replace(/\/+$/, '')
}
function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path) || String(path).startsWith('//')) throw new Error('接口路径必须是相对路径')
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}
function checkedRemoteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('服务返回了无效的图片地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('服务返回了不安全的图片地址')
  return url.href
}
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
export const USER_AGENT = `dsh-tavern-image/${packageVersion}`

function authHeaders(channel, json = true) {
  const headers = json ? { 'content-type': 'application/json' } : {}
  if (channel.authMode === 'none') return headers
  if (channel.authMode === 'basic') {
    if (channel.username || channel.password) headers.authorization = `Basic ${Buffer.from(`${channel.username || ''}:${channel.password || ''}`).toString('base64')}`
    return headers
  }
  if (channel.apiKey) headers.authorization = `Bearer ${channel.apiKey}`
  return headers
}
function requestHeaders(channel, provider, json = true) {
  const headers = authHeaders(channel, json)
  headers['user-agent'] = USER_AGENT
  if (provider === 'gemini' && channel.authMode !== 'none' && channel.authMode !== 'basic' && channel.apiKey) {
    delete headers.authorization
    headers['x-goog-api-key'] = channel.apiKey
  }
  return headers
}
function bounded(value, min = 1, max = DEFAULT_MAX) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : max
}
function clampedNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
function imageType(bytes, declared = '') {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (declared && imageTypes.has(declared.toLowerCase().split(';')[0].trim())) throw new Error('服务返回的数据不是有效图片')
  throw new Error('服务没有返回受支持的图片格式')
}
async function readLimited(response, limit) {
  const size = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(size) && size > limit) throw new Error('服务响应超过允许大小')
  const reader = response.body?.getReader?.()
  if (reader) {
    const parts = []; let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > limit) { await reader.cancel().catch(() => {}); throw new Error('服务响应超过允许大小') }
        parts.push(Buffer.from(value))
      }
    } finally { reader.releaseLock?.() }
    return Buffer.concat(parts, total)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > limit) throw new Error('服务响应超过允许大小')
  return data
}
function abortScope(signal, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs)
  timer.unref?.()
  return { signal: controller.signal, close() { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
}
async function fetchBytes(fetchImpl, url, init, max, signal, channel) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal })
  if (!response.ok) {
    const raw = await readLimited(response, Math.min(max, 64 * 1024)).catch(() => Buffer.alloc(0))
    let message = raw.toString('utf8')
    try { const j = JSON.parse(message); message = j.error?.message || j.message || j.detail || message } catch {}
    throw new Error(`生图服务 HTTP ${response.status}${message ? `：${redact(message, channel)}` : ''}`)
  }
  const bytes = await readLimited(response, max)
  const type = imageType(bytes, response.headers?.get?.('content-type') || '')
  return { bytes, mediaType: type }
}
async function fetchJson(fetchImpl, url, init, limit, signal, channel) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal })
  const bytes = await readLimited(response, limit)
  if (!response.ok) {
    let message = bytes.toString('utf8')
    try { const j = JSON.parse(message); message = j.error?.message || j.message || j.detail || message } catch {}
    throw new Error(`生图服务 HTTP ${response.status}${message ? `：${redact(message, channel)}` : ''}`)
  }
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error('生图服务返回了无效 JSON') }
}
function combinedPrompt(request) {
  const prompt = String(request.positive ?? '').trim()
  const negative = String(request.negative ?? '').trim()
  if (request.promptMode === 'structured') return combineStructuredPrompt(prompt, negative)
  return negative ? `${prompt}\n\nAvoid: ${negative}` : prompt
}
function dims(request) {
  const width = bounded(request.width ?? 1024, 64, 8192), height = bounded(request.height ?? 1024, 64, 8192)
  return { width, height }
}
function option(channel, name, fallback) {
  const value = channel.options?.[name]
  return value === undefined || value === null || (typeof value === 'string' && !value.trim()) ? fallback : value
}
function findImage(value, max) {
  if (typeof value !== 'string' || !value) return null
  const data = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/i)
  if (data) return decodeBase64(data[2], max, data[1])
  const md = value.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i)
  if (md) return { url: md[1] }
  const embedded = value.match(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+/i)
  if (embedded) return findImage(embedded[0], max)
  if (/^https?:\/\//i.test(value)) return { url: value }
  if (/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value) && value.length > 100) return decodeBase64(value, max)
  return null
}
async function fetchRaw(fetchImpl, url, init, max, signal, channel) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal })
  if (!response.ok) {
    const raw = await readLimited(response, Math.min(max, 64 * 1024)).catch(() => Buffer.alloc(0))
    throw new Error(`生图服务 HTTP ${response.status}${raw.length ? `：${redact(raw.toString('utf8'), channel)}` : ''}`)
  }
  return readLimited(response, max)
}
function decodeBase64(value, max, declared = '') {
  const clean = String(value).replace(/\s/g, '')
  if (clean.length > Math.ceil(max * 4 / 3) + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) throw new Error('服务返回的图片编码无效或过大')
  const bytes = Buffer.from(clean, 'base64')
  if (!bytes.length || bytes.length > max) throw new Error('服务返回的图片超过允许大小')
  return { bytes, mediaType: imageType(bytes, declared) }
}
async function fromDataObject(data, fetchImpl, max, signal, channel) {
  const item = Array.isArray(data) ? data[0] : data
  if (!item) throw new Error('生图服务没有返回图片')
  for (const key of ['b64_json', 'base64', 'image', 'data']) {
    if (typeof item[key] === 'string' && !/^https?:\/\//.test(item[key])) return decodeBase64(item[key], max, item.mime_type || item.mimeType || '')
  }
  const url = item.url || item.image_url?.url || item.image_url
  if (url) return fetchBytes(fetchImpl, checkedRemoteUrl(url), { method: 'GET', headers: {} }, max, signal, channel)
  throw new Error('生图服务没有返回可用图片数据')
}
function zipImage(bytes, max) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('NovelAI 返回了无效 ZIP 图片')
  let eocd = -1
  for (let i = Math.max(0, bytes.length - 65557); i <= bytes.length - 22; i++) if (bytes.readUInt32LE(i) === 0x06054b50) eocd = i
  if (eocd < 0) throw new Error('NovelAI ZIP 缺少目录')
  const count = bytes.readUInt16LE(eocd + 10), offset = bytes.readUInt32LE(eocd + 16)
  let cursor = offset
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('NovelAI ZIP 目录无效')
    const method = bytes.readUInt16LE(cursor + 10), packed = bytes.readUInt32LE(cursor + 20), unpacked = bytes.readUInt32LE(cursor + 24)
    const nameLen = bytes.readUInt16LE(cursor + 28), extraLen = bytes.readUInt16LE(cursor + 30), commentLen = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42)
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLen)
    if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
      if (unpacked > max || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('NovelAI 图片超过允许大小或 ZIP 无效')
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
      if (start + packed > bytes.length) throw new Error('NovelAI ZIP 图片数据损坏')
      let output
      try { output = method === 0 ? bytes.subarray(start, start + packed) : method === 8 ? inflateRawSync(bytes.subarray(start, start + packed), { maxOutputLength: max }) : null } catch { throw new Error('NovelAI ZIP 图片无法解压') }
      if (!output) throw new Error('NovelAI ZIP 使用了不支持的压缩格式')
      if (output.length > max || (unpacked && output.length !== unpacked)) throw new Error('NovelAI ZIP 图片大小校验失败')
      const image = Buffer.from(output)
      return { bytes: image, mediaType: imageType(image) }
    }
    cursor += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('NovelAI ZIP 中没有图片')
}
function endpointFromOption(channel, key, fallback) { return String(option(channel, key, fallback)) }

function imageExtension(mediaType) { return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[mediaType] }
function referenceFiles(references, max) {
  if (references === undefined) return []
  if (!Array.isArray(references)) throw new Error('参考图必须是数组')
  return references.map((reference, index) => {
    const label = `第 ${index + 1} 张参考图`
    if (!(reference?.data instanceof Uint8Array) || !reference.data.byteLength) throw new Error(`${label}缺少本地图片数据`)
    if (reference.data.byteLength > max) throw new Error(`${label}超过允许大小`)
    const mediaType = String(reference.mediaType ?? '').split(';')[0].trim().toLowerCase()
    if (!imageTypes.has(mediaType)) throw new Error(`${label}格式不受支持`)
    const bytes = Buffer.from(reference.data.buffer, reference.data.byteOffset, reference.data.byteLength)
    let detected
    try { detected = imageType(bytes) } catch { throw new Error(`${label}不是有效图片`) }
    if (detected !== mediaType) throw new Error(`${label}内容与声明的图片格式不符`)
    return { bytes, mediaType }
  })
}
function imageDataUrl(reference) { return `data:${reference.mediaType};base64,${reference.bytes.toString('base64')}` }

// 对话格式：有些中转站把 NovelAI 包成 chat/completions。它按固定的中文字段模板校验
// 用户消息、优先读 nai 对象里的值；每个采样器单列一个模型（nai-diffusion-4-5-full:k_euler）；
// 回复文字里带图片链接。移植自 Tavern 原生生图的 novelaiChatRequest。
async function generateNovelaiChat(ch, request, ctx) {
  const { base, fetchImpl, signal, max, jsonLimit } = ctx
  const { width, height } = requestedDims(ch, request)
  const oneLine = text => String(text || '').replace(/\s*,?\s*\n+\s*/g, ', ').trim()
  const tags = oneLine(request.positive), negative = oneLine(request.negative)
  const sampler = String(option(ch, 'sampler', 'k_euler_ancestral'))
  const size = width === height ? '方图' : width > height ? '横图' : '竖图'
  const scale = clampedNumber(request.cfg ?? option(ch, 'cfg', option(ch, 'scale', 5)), 0, 30, 5)
  const cfg = clampedNumber(option(ch, 'cfgRescale', 0), 0, 1, 0)
  const model = ch.model || PROVIDERS.novelai[2]
  const content = ['提示词:' + tags, '画师串:', '尺寸:' + size, '提示词引导值:' + scale, '缩放引导值:' + cfg, '负面提示词:' + negative, '采样器:' + sampler].join('\n')
  const payload = { model: model.includes(':') ? model : model + ':' + sampler, stream: false, messages: [{ role: 'user', content }],
    nai: { tag: tags, artist: '', size, scale, cfg, negative, sampler, noise_schedule: String(option(ch, 'noiseSchedule', 'karras')) } }
  // 只填了域名的地址，OpenAI 风格接口在 /v1 下。
  const path = new URL(base).pathname.replace(/\/+$/, '') ? '/chat/completions' : '/v1/chat/completions'
  const data = await fetchJson(fetchImpl, joinUrl(base, endpointFromOption(ch, 'generatePath', path)), { method: 'POST', headers: requestHeaders(ch, 'novelai'), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  const text = String(data.choices?.[0]?.message?.content ?? '')
  const link = text.match(/!\[[^\]]*\]\(((?:https?:\/\/|data:image\/[^;]+;base64,)[^\s)]+)\)/)?.[1] || text.match(/https?:\/\/[^\s)\]"'<>]+/)?.[0]
  const found = link ? findImage(link, max) : null
  if (found?.bytes) return found
  if (found?.url) return fetchBytes(fetchImpl, checkedRemoteUrl(found.url), { method: 'GET', headers: {} }, max, signal, ch)
  throw new Error(text.trim() ? '该接口没有返回图片链接：' + redact(text.trim().slice(0, 200), ch) : '该接口没有返回图片链接')
}

function parseCharCenter(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const grid = /^([a-e])\s*([1-5])$/i.exec(text)
  if (grid) return { x: { a: 0.1, b: 0.3, c: 0.5, d: 0.7, e: 0.9 }[grid[1].toLowerCase()], y: { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 }[grid[2]] }
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      const x = Number(Array.isArray(parsed) ? parsed[0] : parsed?.x ?? parsed?.X)
      const y = Number(Array.isArray(parsed) ? parsed[1] : parsed?.y ?? parsed?.Y)
      if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
    } catch { /* use the pair parser below */ }
  }
  const pair = /^([-+]?[0-9.]+)\s*[,，\s]\s*([-+]?[0-9.]+)$/.exec(text)
  if (!pair) return null
  const x = Number(pair[1]), y = Number(pair[2])
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : null
}

async function generateNovelai(channel, request, ctx) {
  const { base, fetchImpl, signal, max, channel: ch } = ctx
  if (option(ch, 'protocol', 'native') === 'chat') return generateNovelaiChat(ch, request, ctx)
  const { width, height } = requestedDims(ch, request)
  const positive = String(request.positive || ''), negative = String(request.negative || '')
  const novelaiModel = String(ch.model || PROVIDERS.novelai[2])
  const isNovelaiV5 = novelaiModel.includes('nai-diffusion-5')
  let novelaiSampler = String(option(ch, 'sampler', 'k_euler_ancestral'))
  if (isNovelaiV5 && novelaiSampler === 'ddim_v3') novelaiSampler = 'k_euler_ancestral'
  // 可选旋钮：只在你填了大于 0 的值时才写进请求，不填就跟以前完全一样。
  const extras = {}
  const uncondScale = clampedNumber(option(ch, 'uncondScale', 0), 0, 10, 0)
  if (uncondScale > 0) extras.uncond_scale = uncondScale
  const skipCfgAboveSigma = clampedNumber(option(ch, 'skipCfgAboveSigma', 0), 0, 1000, 0)
  if (skipCfgAboveSigma > 0 && !isNovelaiV5) extras.skip_cfg_above_sigma = skipCfgAboveSigma
  const charList = Array.isArray(request.characters) ? request.characters.filter(item => item && String(item.prompt ?? '').trim()).slice(0, 8) : []
  const centers = charList.map(item => parseCharCenter(item.centers))
  const useCoords = centers.length > 0 && centers.every(Boolean)
  const v4Prompt = { caption: { base_caption: positive, char_captions: [] }, use_coords: useCoords, use_order: true }
  const v4Negative = { caption: { base_caption: negative, char_captions: [] }, legacy_uc: false }
  charList.forEach((item, index) => {
    const center = centers[index]
    v4Prompt.caption.char_captions.push({ char_caption: String(item.prompt), centers: [center || {}] })
    v4Negative.caption.char_captions.push({ char_caption: String(item.uc ?? ''), centers: [center || {}] })
  })
  const payload = { input: String(request.positive || ''), model: novelaiModel, action: 'generate', parameters: {
    width, height, seed: Number.isFinite(Number(request.seed)) ? Number(request.seed) : Math.floor(Math.random() * 2 ** 32),
    steps: bounded(request.steps ?? option(ch, 'steps', 28), 1, 100), scale: clampedNumber(request.cfg ?? option(ch, 'cfg', option(ch, 'scale', 5)), 0, 30, 5), n_samples: 1,
    cfg_rescale: clampedNumber(option(ch, 'cfgRescale', 0), 0, 1, 0),
    negative_prompt: negative, sampler: novelaiSampler, noise_schedule: option(ch, 'noiseSchedule', 'karras'),
    qualityToggle: option(ch, 'qualityToggle', true) !== false, ucPreset: clampedNumber(option(ch, 'ucPreset', 3), 0, 4, 3), variety_boost: isNovelaiV5 ? false : option(ch, 'varietyBoost', false) === true, sm: false, dynamic_thresholding: false, params_version: isNovelaiV5 ? 4 : 3,
    v4_prompt: v4Prompt,
    v4_negative_prompt: v4Negative,
    add_original_image: true, legacy: false, legacy_uc: false, controlnet_strength: 1,
    ...extras
  } }
  if (isNovelaiV5) {
    delete payload.parameters.noise_schedule
    delete payload.parameters.skip_cfg_above_sigma
    if (novelaiModel.includes('medium')) {
      delete payload.parameters.cfg_rescale
      payload.parameters.steps = 14
      payload.parameters.sampler = 'k_euler_ancestral'
    }
  }
  const bytes = await fetchRaw(fetchImpl, joinUrl(base, endpointFromOption(ch, 'generatePath', '/ai/generate-image')), { method: 'POST', headers: requestHeaders(ch, 'novelai'), body: JSON.stringify(payload) }, Math.min(max + 1024 * 1024, 129 * 1024 * 1024), signal, ch)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return zipImage(bytes, max)
  return { bytes, mediaType: imageType(bytes) }
}

async function generateOpenai(channel, request, ctx, provider) {
  const { base, fetchImpl, signal, max, channel: ch, jsonLimit } = ctx
  const { width, height } = requestedDims(ch, request)
  const path = endpointFromOption(ch, 'generatePath', '/images/generations')
  const orientationSize = width > height * 1.15 ? '1536x1024' : height > width * 1.15 ? '1024x1536' : '1024x1024'
  const size = provider === 'seedream' ? option(ch, 'size', '2K') : request.exactSize === true ? orientationSize : option(ch, 'size', orientationSize)
  const payload = { model: ch.model || PROVIDERS[provider][2], prompt: combinedPrompt(request), size, n: 1 }
  if (provider === 'openai') {
    if (payload.model.startsWith('gpt-image-')) {
      payload.quality = ['low', 'medium', 'high', 'auto'].includes(request.quality) ? request.quality : option(ch, 'quality', 'medium')
      payload.output_format = request.background === 'transparent' ? 'png' : option(ch, 'outputFormat', 'png')
      if (request.background === 'transparent') payload.background = 'transparent'
    }
  }
  if (provider === 'grok') delete payload.size
  if (request.references?.length) {
    const refs = referenceFiles(request.references, max)
    if (provider === 'grok') {
      if (refs.length !== 1) throw new Error('Grok Images 编辑接口一次只接受 1 张参考图')
      const edit = { model: payload.model, prompt: payload.prompt,
        image: { url: imageDataUrl(refs[0]), type: 'image_url' } }
      const data = await fetchJson(fetchImpl, joinUrl(base, endpointFromOption(ch, 'editPath', '/images/edits')),
        { method: 'POST', headers: requestHeaders(ch, provider), body: JSON.stringify(edit) }, jsonLimit, signal, ch)
      return fromDataObject(data.data, fetchImpl, max, signal, ch)
    }
    if (provider === 'seedream') {
      payload.image = refs.map(imageDataUrl)
      const data = await fetchJson(fetchImpl, joinUrl(base, path), { method: 'POST', headers: requestHeaders(ch, provider), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
      return fromDataObject(data.data, fetchImpl, max, signal, ch)
    }
    const body = new FormData()
    body.append('model', payload.model)
    body.append('prompt', payload.prompt)
    body.append('size', payload.size)
    body.append('n', '1')
    if (payload.quality) body.append('quality', String(payload.quality))
    if (payload.output_format) body.append('output_format', String(payload.output_format))
    if (payload.background) body.append('background', String(payload.background))
    for (const [index, ref] of refs.entries()) body.append('image[]', new Blob([ref.bytes], { type: ref.mediaType }), `reference-${index + 1}.${imageExtension(ref.mediaType)}`)
    const data = await fetchJson(fetchImpl, joinUrl(base, endpointFromOption(ch, 'editPath', '/images/edits')),
      { method: 'POST', headers: requestHeaders(ch, provider, false), body }, jsonLimit, signal, ch)
    return fromDataObject(data.data, fetchImpl, max, signal, ch)
  }
  const data = await fetchJson(fetchImpl, joinUrl(base, path), { method: 'POST', headers: requestHeaders(ch, provider), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  return fromDataObject(data.data, fetchImpl, max, signal, ch)
}

async function generateGemini(channel, request, ctx) {
  const { base, fetchImpl, signal, max, channel: ch, jsonLimit } = ctx
  const model = encodeURIComponent(ch.model || PROVIDERS.gemini[2])
  const { width, height } = dims(request)
  const ratio = request.exactSize === true ? closestRatio(width, height) : option(ch, 'aspectRatio', closestRatio(width, height))
  let imageSize = option(ch, 'imageSize', option(ch, 'size', sizeLabel(width, height)))
  const sizePixels = String(imageSize).match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i)
  if (sizePixels) imageSize = sizeLabel(Number(sizePixels[1]), Number(sizePixels[2]))
  const parts = [...referenceFiles(request.references, max).map(ref => ({ inlineData: { mimeType: ref.mediaType, data: ref.bytes.toString('base64') } })), { text: combinedPrompt(request) }]
  const payload = { contents: [{ parts }], generationConfig: {
    responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio: ratio, imageSize } }
  } }
  const data = await fetchJson(fetchImpl, joinUrl(base, `/models/${model}:generateContent`), { method: 'POST', headers: requestHeaders(ch, 'gemini'), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  const responseParts = data.candidates?.flatMap(candidate => candidate.content?.parts || []) || []
  for (const part of responseParts) if (part.inlineData?.data || part.inline_data?.data) {
    const blob = part.inlineData || part.inline_data
    return decodeBase64(blob.data, max, blob.mimeType || blob.mime_type || '')
  }
  throw new Error('Gemini 没有返回图片内容')
}
function closestRatio(w, h) {
  const ratios = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']
  return ratios.reduce((best, ratio) => Math.abs(Math.log(w / h / ratio.split(':').map(Number).reduce((a, b) => a / b))) < Math.abs(Math.log(w / h / best.split(':').map(Number).reduce((a, b) => a / b))) ? ratio : best, ratios[0])
}
function sizeLabel(w, h) { const pixels = w * h; return pixels > 7_000_000 ? '4K' : pixels > 2_000_000 ? '2K' : '1K' }
function requestedDims(channel, request) {
  let { width, height } = dims(request)
  // Tavern's stage assets need the size they ask for (sprite sheets are sliced by it).
  if (request.exactSize === true) return { width, height }
  // 宽高分开填：两个都填了就以它们为准（优先于下面的 size 文本）
  const rawWidth = Number(option(channel, 'sizeWidth', 0)), rawHeight = Number(option(channel, 'sizeHeight', 0))
  if (Number.isFinite(rawWidth) && Number.isFinite(rawHeight) && rawWidth > 0 && rawHeight > 0) {
    width = bounded(rawWidth, 64, 8192); height = bounded(rawHeight, 64, 8192)
  } else {
    const rawSize = String(option(channel, 'size', '')).trim()
    const match = rawSize.match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i)
    if (match) { width = bounded(match[1], 64, 8192); height = bounded(match[2], 64, 8192) }
    else {
      const tier = rawSize.match(/^(1|1\.5|2|4)\s*k$/i)
      if (tier) width = height = Number(tier[1]) * 1024
    }
  }
  const ratio = String(option(channel, 'aspectRatio', '')).trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (ratio) {
    const area = width * height, value = Number(ratio[1]) / Number(ratio[2])
    if (value > 0 && Number.isFinite(value)) {
      const unit = effectiveImageProvider(channel) === 'sdwebui' ? 8 : 64
      width = Math.max(64, Math.round(Math.sqrt(area * value) / unit) * unit)
      height = Math.max(64, Math.round(Math.sqrt(area / value) / unit) * unit)
    }
  }
  return { width, height }
}
async function generateGeminiChat(channel, request, ctx) {
  const { base, fetchImpl, signal, max, channel: ch, jsonLimit } = ctx
  const content = [...referenceFiles(request.references, max).map(ref => ({ type: 'image_url', image_url: { url: imageDataUrl(ref) } })), { type: 'text', text: combinedPrompt(request) }]
  const payload = { model: ch.model || PROVIDERS['gemini-chat'][2], messages: [{ role: 'user', content: request.references?.length ? content : combinedPrompt(request) }], n: 1 }
  const data = await fetchJson(fetchImpl, joinUrl(base, endpointFromOption(ch, 'generatePath', '/chat/completions')), { method: 'POST', headers: requestHeaders(ch, 'gemini-chat'), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  const message = data.choices?.[0]?.message || data
  const contents = [message.content, ...(Array.isArray(message.images) ? message.images.map(x => x.image_url?.url || x.url || x) : [])]
  for (const content of contents) {
    const parts = Array.isArray(content) ? content : [content]
    for (const part of parts) {
      const value = typeof part === 'string' ? part : (part.image_url?.url || part.url || part.text || part.image?.url || '')
      const found = findImage(value, max)
      if (found?.bytes) return found
      if (found?.url) return fetchBytes(fetchImpl, checkedRemoteUrl(found.url), { method: 'GET', headers: {} }, max, signal, ch)
    }
  }
  throw new Error('聊天兼容服务没有返回图片或图片地址')
}
async function generateQwen(channel, request, ctx) {
  const { base, fetchImpl, signal, max, channel: ch, jsonLimit } = ctx
  const { width, height } = dims(request)
  const legacyAsync = Boolean(ctx.resumeTaskId) || option(ch, 'apiMode', 'sync') === 'async'
  if (request.references?.length && legacyAsync) throw new Error('Qwen 旧版异步任务接口不支持参考图；请切换为同步 Qwen-Image 接口')
  const content = [...referenceFiles(request.references, max).map(ref => ({ image: imageDataUrl(ref) })), { text: String(request.positive || '') }]
  const payload = legacyAsync ? {
    model: ch.model || 'wanx-v1', input: { prompt: String(request.positive || '') }, parameters: { negative_prompt: String(request.negative || ''), size: `${width}*${height}`, n: 1 }
  } : {
    model: ch.model || PROVIDERS.qwen[2], input: { messages: [{ role: 'user', content }] }, parameters: {
      negative_prompt: String(request.negative || ''), size: `${width}*${height}`, n: 1,
      ...(Number.isFinite(Number(request.seed)) ? { seed: ((Math.trunc(Number(request.seed)) % 2147483648) + 2147483648) % 2147483648 } : {})
    }
  }
  const path = endpointFromOption(ch, 'generatePath', legacyAsync ? '/services/aigc/text2image/image-synthesis' : '/services/aigc/multimodal-generation/generation')
  const headers = requestHeaders(ch, 'qwen')
  if (legacyAsync) headers['X-DashScope-Async'] = 'enable'
  const response = ctx.resumeTaskId ? { output: { task_id: ctx.resumeTaskId } }
    : await fetchJson(fetchImpl, joinUrl(base, path), { method: 'POST', headers, body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  if (!legacyAsync) {
    const content = response.output?.choices?.[0]?.message?.content || []
    const image = content.find?.(part => part.image)?.image
    if (image) {
      const embedded = findImage(image, max)
      if (embedded?.bytes) return embedded
      return fetchBytes(fetchImpl, checkedRemoteUrl(embedded?.url || image), { method: 'GET', headers: {} }, max, signal, ch)
    }
    throw new Error(redact(response.message || response.code || 'Qwen-Image 没有返回图片', ch))
  }
  const taskId = response.output?.task_id
  if (!taskId) {
    const image = response.output?.choices?.[0]?.message?.content?.find?.(item => item.image)?.image
    if (image) return fetchBytes(fetchImpl, checkedRemoteUrl(image), { method: 'GET', headers: {} }, max, signal, ch)
    throw new Error(redact(response.message || response.code || 'DashScope 没有返回任务编号', ch))
  }
  await ctx.onTask?.({ provider: effectiveImageProvider(ch), taskId: String(taskId) })
  const pollPath = endpointFromOption(ch, 'taskPath', '/tasks/')
  const deadline = Date.now() + bounded(option(ch, 'pollTimeoutMs', 240000), 1000, 600000)
  while (Date.now() < deadline) {
    await wait(bounded(option(ch, 'pollIntervalMs', 1500), 1, 30_000), signal)
    const task = await fetchJson(fetchImpl, joinUrl(base, `${pollPath.replace(/\/?$/, '/')}${encodeURIComponent(taskId)}`), { method: 'GET', headers: requestHeaders(ch, 'qwen', false) }, jsonLimit, signal, ch)
    const output = task.output || task
    if (['SUCCEEDED', 'succeeded', 'done', 'completed'].includes(output.task_status || output.status)) {
      const urls = output.results?.map(item => item.url) || output.choices?.flatMap(choice => choice.message?.content?.map(part => part.image).filter(Boolean) || []) || []
      if (urls[0]) return fetchBytes(fetchImpl, checkedRemoteUrl(urls[0]), { method: 'GET', headers: {} }, max, signal, ch)
      throw new Error('DashScope 任务完成但没有返回图片地址')
    }
    if (['FAILED', 'failed', 'CANCELED', 'cancelled'].includes(output.task_status || output.status)) {
      const error = new Error(redact(task.message || output.message || 'DashScope 生图任务失败', ch))
      error.providerDefinitiveFailure = true
      throw error
    }
  }
  throw new Error('DashScope 生图任务等待超时')
}
// Atlas MCP: POST /model/generateImage → data.id → GET /model/prediction/{id}.
// Model parameters are top-level and model-specific; do not send OpenAI's n or
// a universal negative_prompt/seed. Flux uses size="W*H", Nano Banana aspect_ratio.
const ATLAS_SUCCESS = new Set(['completed', 'succeeded', 'success'])
const ATLAS_FAILURE = new Set(['failed', 'canceled', 'cancelled', 'error', 'timeout'])
const ATLAS_PENDING = new Set(['created', 'starting', 'queued', 'processing', 'pending', 'running'])
const atlasStatus = task => String(task?.status || '').toLowerCase()
const validTaskId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[\w-]+$/.test(value)

async function fetchAtlasJson(ctx, path, init) {
  const { base, fetchImpl, signal, jsonLimit, channel } = ctx
  const response = await fetchImpl(joinUrl(base, path), { ...init, redirect: 'error', signal })
  const bytes = await readLimited(response, jsonLimit)
  let data
  try { data = JSON.parse(bytes.toString('utf8')) } catch {
    throw new Error(`atlas cloud ${response.ok ? '返回了无效 JSON' : 'HTTP ' + response.status}`)
  }
  const task = data?.data || data
  const code = Number(data?.code)
  const failed = ATLAS_FAILURE.has(atlasStatus(task))
  if (!response.ok || failed || (Number.isFinite(code) && code !== 0 && (code < 200 || code >= 300))) {
    const detail = task?.error?.message || task?.error || data?.error?.message || data?.error || data?.message || data?.msg || task?.message || '请求失败'
    const error = new Error(`atlas cloud${response.ok ? '' : ' HTTP ' + response.status}：${redact(typeof detail === 'string' ? detail : JSON.stringify(detail), channel)}`)
    // Polling may return HTTP 5xx together with a definitive failed task. Conversely,
    // a polling 401/404 does not prove a previously accepted paid task has failed.
    error.providerDefinitiveFailure = failed || (init.method === 'POST' && code >= 400 && code < 500)
    throw error
  }
  return task
}

// Official upload contract: multipart POST /model/uploadMedia, field `file`,
// response data.download_url (official skill) or top-level url (docs examples).
// Seedream/GPT Image multi-image endpoints accept these URLs in top-level
// `images` on /model/generateImage:
// https://github.com/AtlasCloudAI/atlas-cloud-skills/blob/main/atlas-cloud/references/upload.md
// https://www.atlascloud.ai/docs/upload-files
// https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v5.0-pro-edit/generateImage
// No model allowlist, automatic model switch, reference selection or truncation:
// the caller supplies only this picture's references, in prompt-number order.
function atlasReferenceFiles(references, max) {
  return Array.from(references ?? [], (reference, index) => {
    const label = `第 ${index + 1} 张参考图`
    if (!(reference?.data instanceof Uint8Array) || !reference.data.byteLength) throw new Error(`${label}缺少本地图片数据`)
    if (reference.data.byteLength > max) throw new Error(`${label}超过允许大小`)
    const mediaType = String(reference.mediaType ?? '').split(';')[0].trim().toLowerCase()
    if (!imageTypes.has(mediaType)) throw new Error(`${label}格式不受支持`)
    const bytes = Buffer.from(reference.data.buffer, reference.data.byteOffset, reference.data.byteLength)
    let detected
    try { detected = imageType(bytes) } catch { throw new Error(`${label}不是有效图片`) }
    if (detected !== mediaType) throw new Error(`${label}内容与声明的图片格式不符`)
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mediaType]
    // `name`, local paths and other caller metadata are deliberately never sent.
    return { bytes, mediaType, name: `reference-${index + 1}.${extension}` }
  })
}

async function uploadAtlasReferences(references, ctx) {
  // Validate every image before uploading any, rather than drawing with a
  // successful subset when a later reference is invalid or fails to upload.
  const files = atlasReferenceFiles(references, ctx.max)
  const urls = []
  for (const [index, file] of files.entries()) {
    ctx.signal.throwIfAborted()
    try {
      const body = new FormData()
      body.append('file', new Blob([file.bytes], { type: file.mediaType }), file.name)
      const uploaded = await fetchAtlasJson({ ...ctx, fetchImpl: ctx.uploadFetch }, '/model/uploadMedia', {
        method: 'POST', headers: requestHeaders(ctx.channel, 'atlascloud', false), body,
      })
      const url = uploaded?.download_url || uploaded?.url
      if (typeof url !== 'string' || !url.trim()) throw new Error('未返回参考图下载地址')
      urls.push(checkedRemoteUrl(url))
    } catch (error) {
      throw new Error(`第 ${index + 1} 张参考图上传失败：${redact(error?.message || '上传请求失败', ctx.channel)}`)
    }
  }
  return urls
}

async function generateAtlascloud(channel, request, ctx) {
  const { fetchImpl, signal, max, channel: ch } = ctx
  let task
  if (ctx.resumeTaskId) task = { id: ctx.resumeTaskId, status: 'created' }
  else {
    const payload = { model: ch.model || PROVIDERS.atlascloud[2], prompt: combinedPrompt(request) }
    const { width, height } = dims(request)
    const sizeMode = option(ch, 'sizeMode', 'size')
    if (sizeMode === 'size') {
      const size = String(option(ch, 'size', `${width}*${height}`)).trim().match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i)
      if (!size || Number(size[1]) <= 0 || Number(size[2]) <= 0) throw new Error('atlas cloud 尺寸请填写宽×高，例如 1024x1536')
      payload.size = `${Number(size[1])}*${Number(size[2])}`
    } else if (sizeMode === 'aspect_ratio') {
      payload.aspect_ratio = String(option(ch, 'aspectRatio', closestRatio(width, height))).trim()
    } else if (sizeMode !== 'none') throw new Error('atlas cloud 尺寸参数模式无效')
    // Resolve the endpoint and construct the request before the tracked POST.
    // Reference uploads use uploadFetch, so they never mark a paid submission.
    const path = endpointFromOption(ch, 'generatePath', '/model/generateImage')
    joinUrl(ctx.base, path)
    if (request.references?.length) payload.images = await uploadAtlasReferences(request.references, ctx)
    const init = { method: 'POST', headers: requestHeaders(ch, 'atlascloud'), body: JSON.stringify(payload) }
    task = await fetchAtlasJson(ctx, path, init)
  }
  const taskId = task?.id
  if (taskId !== undefined && !validTaskId(taskId)) throw new Error('atlas cloud 返回了无效的平台任务编号')
  if (taskId) await ctx.onTask?.({ provider: effectiveImageProvider(ch), taskId })
  const deadline = Date.now() + bounded(option(ch, 'pollTimeoutMs', 240000), 1000, 600000)
  const pollPath = endpointFromOption(ch, 'taskPath', '/model/prediction/')
  while (true) {
    const status = atlasStatus(task)
    if (ATLAS_SUCCESS.has(status)) {
      const outputs = task.outputs ?? task.output
      const output = Array.isArray(outputs) ? outputs[0] : outputs
      const image = findImage(output, max)
      if (image?.bytes) return image
      if (image?.url) return fetchBytes(fetchImpl, checkedRemoteUrl(image.url), { method: 'GET', headers: {} }, max, signal, ch)
      if (output && typeof output === 'object') return fromDataObject({ ...output, url: output.url || output.download_url }, fetchImpl, max, signal, ch)
      const error = new Error('atlas cloud 任务完成但没有返回图片地址' + (task.has_nsfw_contents?.some?.(Boolean) ? '（平台内容过滤）' : ''))
      error.providerDefinitiveFailure = true
      throw error
    }
    if (!taskId) throw new Error('atlas cloud 没有返回平台任务编号')
    if (status && !ATLAS_PENDING.has(status)) throw new Error('atlas cloud 返回了未知任务状态：' + redact(status, ch))
    if (Date.now() >= deadline) throw new Error('atlas cloud 生图任务等待超时')
    await wait(bounded(option(ch, 'pollIntervalMs', 2000), 1, 30_000), signal)
    task = await fetchAtlasJson(ctx, `${pollPath.replace(/\/?$/, '/')}${encodeURIComponent(taskId)}`, {
      method: 'GET', headers: requestHeaders(ch, 'atlascloud', false),
    })
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error('请求已取消'))
    const timer = setTimeout(done, ms)
    function done() { signal.removeEventListener('abort', abort); resolve() }
    function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new Error('请求已取消')) }
    signal.addEventListener('abort', abort, { once: true })
  })
}
async function generateSdwebui(channel, request, ctx) {
  const { base, fetchImpl, signal, max, channel: ch, jsonLimit } = ctx
  const { width, height } = requestedDims(ch, request)
  const payload = { prompt: String(request.positive || ''), negative_prompt: String(request.negative || ''), width, height,
    steps: bounded(request.steps ?? option(ch, 'steps', 20), 1, 200), cfg_scale: clampedNumber(request.cfg ?? option(ch, 'cfg', 7), 0, 50, 7), seed: Number.isFinite(Number(request.seed)) ? Number(request.seed) : -1, sampler_name: option(ch, 'sampler', 'Euler a'), batch_size: 1 }
  const refs = referenceFiles(request.references, max)
  if (refs.length > 1) throw new Error('SD WebUI img2img 一次只支持 1 张参考图；请改用支持多图参考的协议或减少所选参考图')
  const path = refs.length ? endpointFromOption(ch, 'editPath', '/sdapi/v1/img2img') : endpointFromOption(ch, 'generatePath', '/sdapi/v1/txt2img')
  if (refs.length) payload.init_images = refs.map(ref => ref.bytes.toString('base64'))
  const data = await fetchJson(fetchImpl, joinUrl(base, path), { method: 'POST', headers: requestHeaders(ch, 'sdwebui'), body: JSON.stringify(payload) }, jsonLimit, signal, ch)
  if (!Array.isArray(data.images) || !data.images[0]) throw new Error('SD WebUI 没有返回图片')
  return decodeBase64(String(data.images[0]).replace(/^data:image\/[^;]+;base64,/i, ''), max)
}

/**
 * request.references?: Array<{ data: Uint8Array | Buffer, mediaType: string, name?: string }>
 * request.exactSize / background ('transparent') / quality: Tavern stage-asset requests; they win
 * over the channel's own size and quality options.
 * Callers load local bytes; no path/URL fetching happens here. Array order is
 * the image-number order used by the prompt.
 * onGenerationSubmit is awaited immediately before the first billable POST for
 * every protocol. Atlas uploads and task resumption never invoke the hook.
 */
export async function generateImage(channel, request = {}, { signal, fetchImpl = globalThis.fetch, maxImageBytes = DEFAULT_MAX, onTask, onGenerationSubmit, resumeTaskId } = {}) {
  let scope
  let sentGeneration = false
  let generationStatus = null
  let generationSubmitNotified = false
  try {
    if (!channel || !PROVIDERS[channel.provider]) throw new Error('不支持的生图渠道')
    const provider = effectiveImageProvider(channel)
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的网络请求功能')
    if (channel.provider === 'custom' && !String(channel.baseUrl || '').trim()) throw new Error('请填写自定义渠道地址')
    if (channel.provider === 'custom' && !String(channel.model || '').trim()) throw new Error('请填写自定义渠道模型')
    const base = validateBase(channel), max = bounded(maxImageBytes, 1024, 128 * 1024 * 1024)
    const jsonLimit = Math.min(192 * 1024 * 1024, max * 2 + 1024 * 1024)
    if (resumeTaskId !== undefined && (!supportsImageTaskResume(channel) || !validTaskId(resumeTaskId))) throw new Error('无效的平台任务编号')
    // A recovered Atlas task needs neither the original images nor their local
    // availability. Never inspect or load them, let alone upload/POST them again.
    if (!(resumeTaskId && provider === 'atlascloud')) {
      const references = request?.references
      if (references !== undefined && !Array.isArray(references)) throw new Error('参考图必须是数组')
      if (references?.length && !supportsImageReferences(channel)) throw new Error('当前接口协议不支持参考图，已停止请求，没有发送文字生图任务')
    }
    sentGeneration = Boolean(resumeTaskId)
    generationStatus = resumeTaskId ? 200 : null
    scope = abortScope(signal, bounded(channel.options?.timeoutMs, 1000, 600_000))
    const uploadFetch = (url, init) => {
      scope.signal.throwIfAborted()
      return fetchImpl(url, init)
    }
    const trackedFetch = async (url, init = {}) => {
      scope.signal.throwIfAborted()
      const generation = String(init.method ?? 'GET').toUpperCase() === 'POST'
      if (generation && !resumeTaskId && !generationSubmitNotified) {
        await onGenerationSubmit?.()
        generationSubmitNotified = true
        scope.signal.throwIfAborted()
      }
      if (generation) sentGeneration = true
      const response = await fetchImpl(url, init)
      if (generation) generationStatus = response.status
      return response
    }
    const ctx = { base, fetchImpl: trackedFetch, uploadFetch, signal: scope.signal, max, jsonLimit, channel, onTask, onGenerationSubmit, resumeTaskId }
    if (provider === 'novelai') return await generateNovelai(channel, request, ctx)
    if (provider === 'openai' || provider === 'grok' || provider === 'seedream') return await generateOpenai(channel, request, ctx, provider)
    if (provider === 'gemini') return await generateGemini(channel, request, ctx)
    if (provider === 'gemini-chat') return await generateGeminiChat(channel, request, ctx)
    if (provider === 'qwen') return await generateQwen(channel, request, ctx)
    if (provider === 'atlascloud') return await generateAtlascloud(channel, request, ctx)
    return await generateSdwebui(channel, request, ctx)
  } catch (error) {
    const message = scope?.signal.aborted && !signal?.aborted ? '生图请求超时' : redact(error?.message || '生图请求失败', channel)
    const failure = new Error(message)
    failure.submissionNotStarted = !sentGeneration
    // Upload POSTs do not count as generation. A lost generation POST response
    // or a later download error does not prove that the paid generation failed.
    failure.requestMayHaveSucceeded = error?.providerDefinitiveFailure !== true && sentGeneration && (generationStatus === null || generationStatus >= 500 || generationStatus < 400)
    throw failure
  } finally { scope?.close() }
}

export async function testImageChannel(channel, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!channel || !PROVIDERS[channel.provider]) throw new Error('不支持的生图渠道')
  const provider = effectiveImageProvider(channel)
  const base = validateBase(channel)
  const safePaths = { novelai: '/user/subscription', openai: '/models', grok: '/models', 'gemini-chat': '/models', gemini: '/models', atlascloud: '/model/history?no=1&size=1', sdwebui: '/sdapi/v1/sd-models' }
  const chatNovelai = provider === 'novelai' && option(channel, 'protocol', 'native') === 'chat'
  const safePath = chatNovelai ? (new URL(base).pathname.replace(/\/+$/, '') ? '/models' : '/v1/models') : safePaths[provider]
  const path = safePath && endpointFromOption(channel, 'testPath', safePath)
  if (!path) return { ok: true, status: 'configured', message: '地址和渠道参数已配置；此服务没有可安全探测的无计费接口。' }
  const scope = abortScope(signal, 8000)
  try {
    const headers = requestHeaders(channel, provider)
    const response = await fetchImpl(joinUrl(base, path), { method: 'GET', headers, redirect: 'error', signal: scope.signal })
    if (!response.ok) return { ok: false, status: 'reachable', message: `服务已响应 HTTP ${response.status}` }
    const bytes = await readLimited(response, 2 * 1024 * 1024)
    let parsed = null; try { parsed = JSON.parse(bytes.toString('utf8')) } catch {}
    if (!parsed) return { ok: false, status: 'reachable', message: '服务已响应，但返回内容不是有效 JSON。' }
    if (provider === 'atlascloud') {
      if ((parsed.code !== undefined && ![0, 200].includes(Number(parsed.code))) || !Array.isArray(parsed.data?.items)) {
        return { ok: false, status: 'reachable', message: redact(parsed.message || parsed.msg || '任务查询未返回有效结果；请检查 API 根地址、密钥及查询权限。', channel) }
      }
      // The public model catalogue alone cannot verify a key. Probe authenticated
      // history first (no generation/billing), then use the catalogue for suggestions.
      let models = []
      try {
        const catalogue = await fetchJson(fetchImpl, joinUrl(base, '/models'), { method: 'GET', headers: { 'user-agent': USER_AGENT } }, 2 * 1024 * 1024, scope.signal, channel)
        if (Array.isArray(catalogue?.data)) models = [...new Set(catalogue.data.filter(item => item?.type === 'Image' && item.display_console !== false
          && item.tags?.some?.(tag => String(tag).toUpperCase().replaceAll('_', '-') === 'TEXT-TO-IMAGE'))
          .map(item => item.model).filter(model => typeof model === 'string' && model.trim()))]
      } catch (error) { if (signal?.aborted) throw error }
      return { ok: true, status: 'reachable', message: '鉴权与任务查询正常；实际生图仍需模型权限和可用额度。', ...(models.length ? { models: models.slice(0, 200) } : {}) }
    }
    const models = provider === 'sdwebui'
      ? (Array.isArray(parsed) ? parsed.map(x => x && typeof x === 'object' ? x.model_name : null).filter(Boolean) : [])
      : (Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : []).map(x => x && typeof x === 'object' ? x.id || x.name : null).filter(Boolean)
    return { ok: true, status: 'reachable', message: '连接正常。', ...(models.length ? { models: models.slice(0, 200) } : {}) }
  } catch (error) {
    if (signal?.aborted) throw error
    return { ok: false, status: 'configured', message: redact(error.message || '连接失败', channel) }
  } finally { scope.close() }
}
