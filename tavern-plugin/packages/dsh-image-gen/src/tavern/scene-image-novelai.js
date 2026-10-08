import { randomInt } from 'node:crypto'

// Verified against NovelAI's public frontend build 6750aa2; see research note.
const models = {
  'nai-diffusion-5-full': { guidance: 7, characters: 22 },
  'nai-diffusion-5-curated': { guidance: 7, characters: 22 },
  'nai-diffusion-4-5-full': { guidance: 5, characters: 6 },
  'nai-diffusion-4-5-curated': { guidance: 5, characters: 6 },
  'nai-diffusion-4-full': { guidance: 5.5, characters: 6 },
  'nai-diffusion-4-curated-preview': { guidance: 5.5, characters: 6 },
  'nai-diffusion-3': { guidance: 5, characters: 0 }
}
export const NOVELAI_MODELS = Object.freeze(Object.keys(models))
// The four caption sections a NovelAI base prompt is assembled from.
export const NOVELAI_BASE_SECTIONS = Object.freeze(['quality', 'scene', 'style', 'artist'])
// Official quality-tag and undesired-content presets, adapted from the MIT-licensed
// Langbai NovelAI Studio v2.4.7 tables (mobile/lib/services/nai_api.dart).
export const NOVELAI_QUALITY_PRESETS = Object.freeze(['none', 'light', 'standard'])
export const NOVELAI_UC_PRESETS = Object.freeze(['none', 'light', 'heavy', 'human-focus'])
// Samplers and noise schedules NovelAI's image API accepts; the first entries
// are the defaults earlier versions always sent.
export const NOVELAI_SAMPLERS = Object.freeze(['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m', 'k_dpmpp_2m_sde', 'k_dpmpp_sde', 'ddim_v3'])
// How an endpoint is called: NovelAI's own /ai/generate-image (ZIP reply), or
// a relay's chat/completions "conversation generation" (Nai2API style, e.g. STA1N).
export const NOVELAI_PROTOCOLS = Object.freeze(['native', 'chat'])
export const NOVELAI_NOISE_SCHEDULES = Object.freeze(['karras', 'native', 'exponential', 'polyexponential'])
const LIBRARY_ID = /^[a-z0-9]{1,12}$/
const MAX_ENDPOINTS = 10, MAX_ARTISTS = 50
const QUALITY_PRESET_TAGS = {
  'nai-diffusion-5-full': 'very aesthetic, masterpiece, no text',
  'nai-diffusion-5-curated': 'very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-full': 'very aesthetic, masterpiece, no text',
  'nai-diffusion-4-5-curated': 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
  'nai-diffusion-4-full': 'no text, best quality, very aesthetic, absurdres',
  'nai-diffusion-4-curated': 'rating:general, best quality, very aesthetic, absurdres',
  'nai-diffusion-3': 'best quality, amazing quality, very aesthetic, absurdres'
}
// The V5 frontend offers a lighter quality row instead of the standard one.
const QUALITY_LIGHT_V5_TAGS = 'very aesthetic, amazing quality, no text'
const UC_PRESET_TAGS = {
  'nai-diffusion-4-5-full': {
    heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    'human-focus': 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy'
  },
  'nai-diffusion-4-5-curated': {
    heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    'human-focus': 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page'
  },
  'nai-diffusion-4-full': {
    heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks',
    light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing'
  },
  'nai-diffusion-4-curated': {
    heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
    light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature'
  },
  'nai-diffusion-3': {
    heavy: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
    light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
    'human-focus': 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes'
  }
}
// V5 reuses the V4.5 tables; Tavern stores the pre-release V4 curated id.
const QUALITY_MODEL_ALIASES = { 'nai-diffusion-4-curated-preview': 'nai-diffusion-4-curated' }
const UC_MODEL_ALIASES = { 'nai-diffusion-5-full': 'nai-diffusion-4-5-full', 'nai-diffusion-5-curated': 'nai-diffusion-4-5-curated', 'nai-diffusion-4-curated-preview': 'nai-diffusion-4-curated' }
// Wire indices of NovelAI's own undesired-content selector.
const UC_PRESET_INDEX = { heavy: 0, light: 1, 'human-focus': 2, none: 3 }
// NovelAI drops the official `no text` tag when the prompt already asks for text.
const NOVELAI_TEXT_TAG = /(?:^|[\s,;|])Text\s*:\s*\S/i
const BASE64_IMAGE = /^[A-Za-z0-9+/]+={0,2}$/

function libraryText(value, limit, label) {
  if (value !== undefined && typeof value !== 'string') throw new Error(label + '须为文本')
  const text = (value || '').trim()
  if (text.length > limit) throw new Error(label + '过长')
  return text
}
function libraryEntries(value, limit, label) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > limit) throw new Error(label + '最多 ' + limit + ' 条')
  const ids = new Set()
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !LIBRARY_ID.test(entry.id) || ids.has(entry.id)) throw new Error(label + '格式不正确')
    ids.add(entry.id)
    return entry
  })
}

/** Named NovelAI endpoints (official site or same-protocol relays). Each keeps
 * its own key; the active one's address is the channel baseURL, so switching
 * endpoints changes only where requests go, never model or prompt settings.
 * Older single-endpoint configurations become the `default` entry. */
export function novelaiEndpoints(value, active, baseURL) {
  const endpoints = libraryEntries(value, MAX_ENDPOINTS, 'NovelAI 接入点').map(entry => {
    const url = libraryText(entry.baseURL, 2000, '接入点地址')
    let parsed
    try { parsed = url ? new URL(url) : undefined } catch { throw new Error('接入点地址须为 HTTP(S) API 根地址') }
    if (parsed && (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)) throw new Error('接入点地址须为不含密钥、查询参数的 HTTP(S) API 根地址')
    const protocol = entry.protocol === undefined || entry.protocol === '' ? 'native' : entry.protocol
    if (!NOVELAI_PROTOCOLS.includes(protocol)) throw new Error('接口格式只能是官方格式或对话格式')
    return { id: entry.id, name: libraryText(entry.name, 40, '接入点名称') || '未命名接入点', baseURL: url, protocol }
  })
  if (!endpoints.length) endpoints.push({ id: 'default', name: '默认', baseURL, protocol: 'native' })
  const id = active || endpoints[0].id
  const current = endpoints.find(entry => entry.id === id)
  if (!current) throw new Error('所选 NovelAI 接入点不存在')
  current.baseURL = baseURL
  return { endpoints, endpoint: id, protocol: current.protocol }
}

/** Named artist strings, each optionally carrying its own quality and negative
 * tags that replace the channel-level ones while selected. Older free-text
 * settings (one artist string, or the JSON presets) migrate into entries once. */
export function novelaiArtists(value) {
  let source = value.artists
  if (source === undefined) {
    source = []
    let presets = {}
    try { presets = value.promptPresets ? JSON.parse(value.promptPresets) : {} } catch {}
    if (presets && typeof presets === 'object' && !Array.isArray(presets)) for (const [name, preset] of Object.entries(presets)) {
      if (!preset || typeof preset !== 'object' || source.length >= MAX_ARTISTS) continue
      source.push({ id: 'p' + source.length, name, prompt: preset.artistString, quality: preset.qualityTags, negative: preset.negativePrompt })
    }
    if (typeof value.artistString === 'string' && value.artistString.trim() && source.length < MAX_ARTISTS) {
      source.push({ id: 'legacy', name: '我的画师串', prompt: value.artistString })
      return { artists: novelaiArtists({ artists: source }).artists, activeArtist: 'legacy' }
    }
  }
  const artists = libraryEntries(source, MAX_ARTISTS, '画师串库').map(entry => ({ id: entry.id,
    name: libraryText(entry.name, 40, '画师串名称') || '未命名画师串',
    prompt: libraryText(typeof entry.prompt === 'string' ? entry.prompt : undefined, 1000, '画师串'),
    quality: libraryText(typeof entry.quality === 'string' ? entry.quality : undefined, 600, '画师串质量词'),
    negative: libraryText(typeof entry.negative === 'string' ? entry.negative : undefined, 4000, '画师串负面词'),
    // Revision of the preview image Tavern stores beside the settings; '' means none.
    preview: typeof entry.preview === 'string' && /^[a-f0-9]{1,16}$/.test(entry.preview) ? entry.preview : '' }))
  return { artists }
}

/** The selected artist entry; its non-empty quality/negative tags take over. */
function novelaiArtist(config) {
  const entry = (config.artists || []).find(artist => artist.id === config.activeArtist)
  return { prompt: entry?.prompt || '', quality: entry?.quality || config.qualityTags || '', negative: entry?.negative || config.negativePrompt || '' }
}

export function novelaiSettings(config) {
  if (!Object.hasOwn(models, config.model)) throw new Error('NovelAI 请选择已接入的 V5、V4.5、V4 或 Anime V3 模型')
  const dimensions = config.size.match(/^(\d+)x(\d+)$/)
  // The 2048-per-side ceiling is Tavern's local resource guard, not an API claim.
  if (!dimensions || dimensions.slice(1).some(value => Number(value) < 64 || Number(value) > 2048 || Number(value) % 64)) throw new Error('NovelAI 尺寸须为宽x高；本插件支持每边 64–2048 且为 64 的倍数')
  const [width, height] = dimensions.slice(1).map(Number)
  if (width * height > 3145728) throw new Error('NovelAI 图片面积不能超过 3145728 像素')
  return { ...models[config.model], width, height }
}

/** Join two tag lists, dropping duplicates case-insensitively. An empty right
 * side returns the left side verbatim, so untouched settings keep the exact
 * prompt earlier versions sent. */
function mergeTags(first, second) {
  const left = String(first || ''), right = String(second || '')
  if (!right.trim()) return left
  if (!left.trim()) return right
  const seen = new Set(), parts = []
  for (const segment of [left, right]) for (const part of segment.split(',').map(value => value.trim())) {
    if (part && !seen.has(part.toLowerCase())) { seen.add(part.toLowerCase()); parts.push(part) }
  }
  return parts.join(', ')
}

/** Official quality tags for the selected model and preset, or '' when unused. */
function novelaiQualityTags(config, positivePrompt) {
  const preset = String(config.qualityPreset || 'none').trim().toLowerCase()
  if (preset === 'none') return ''
  const model = String(config.model || '').trim()
  const tags = preset === 'light' && model.startsWith('nai-diffusion-5')
    ? QUALITY_LIGHT_V5_TAGS
    : QUALITY_PRESET_TAGS[QUALITY_MODEL_ALIASES[model] || model] || ''
  if (!tags) return ''
  if (!NOVELAI_TEXT_TAG.test(String(positivePrompt || ''))) return tags
  return tags.split(',').map(tag => tag.trim()).filter(tag => tag && tag.toLowerCase() !== 'no text').join(', ')
}

/** Official undesired-content preset text, or '' when unused. */
function novelaiNegativeTags(config) {
  const preset = String(config.ucPreset || 'none').trim().toLowerCase()
  if (preset === 'none') return ''
  const model = String(config.model || '').trim()
  return UC_PRESET_TAGS[UC_MODEL_ALIASES[model] || model]?.[preset] || ''
}

/** Section order comes from the user only when it is a full, duplicate-free
 * permutation; anything else falls back to the documented default. */
function novelaiPromptOrder(value) {
  const order = String(value || '').split(',').map(section => section.trim()).filter(Boolean)
  const complete = order.length === NOVELAI_BASE_SECTIONS.length && new Set(order).size === order.length && order.every(section => NOVELAI_BASE_SECTIONS.includes(section))
  return complete ? order : [...NOVELAI_BASE_SECTIONS]
}

/** Expand one `{A|B|C}` option per call. Braces without a pipe carry NovelAI
 * weight syntax, so they must reach the API untouched. */
function expandWildcards(text) {
  if (typeof text !== 'string' || !text.includes('{')) return text || ''
  let output = text
  // Bounded: unwrapped weight braces never change, so the loop ends immediately.
  for (let round = 0; round < 64; round++) {
    const expanded = output.replace(/\{([^{}]*)\}/g, function (whole, inner) {
      if (!inner.includes('|')) return whole
      const options = inner.split('|')
      return options[randomInt(0, options.length)]
    })
    if (expanded === output) break
    output = expanded
  }
  return output
}

/** Section weights wrap a whole section. V4 and later take NovelAI's numeric
 * `1.5::tags::` syntax, so every value counts; Anime V3 only has brace
 * emphasis: >1 becomes {{}}, <1 becomes {}. 1 leaves the section unwrapped. */
function applySectionWeight(tags, weight, numeric) {
  const text = String(tags || '').trim()
  if (!text) return ''
  const value = Number(weight)
  if (!Number.isFinite(value) || value === 1) return text
  if (numeric) return value + '::' + text + '::'
  return value > 1 ? '{{' + text + '}}' : '{' + text + '}'
}

/** Positional section weights; a missing or unusable entry means 1. */
function novelaiSectionWeights(value) {
  return String(value || '').split(',').map(weight => weight.trim()).filter(Boolean).slice(0, NOVELAI_BASE_SECTIONS.length).map(weight => /^\d+(\.\d+)?$/.test(weight) && Number(weight) > 0 ? Number(weight) : 1)
}

/** Assemble base_caption from the configured section order, skipping empty
 * sections so an untouched configuration reproduces the previous prompt. The
 * official quality preset is appended to the user's own quality text. */
function assembleBase(sections, config) {
  const order = novelaiPromptOrder(config.promptOrder), weights = novelaiSectionWeights(config.sectionWeights)
  const draft = order.map(name => String(sections[name] || '')).filter(Boolean).join(', ')
  const resolved = { ...sections, quality: mergeTags(sections.quality, novelaiQualityTags(config, draft)) }
  const numeric = Boolean(models[config.model]?.characters)
  return order.map((name, index) => applySectionWeight(expandWildcards(resolved[name]), weights[index], numeric)).filter(Boolean).join(', ')
}

/** Empty means NovelAI's own ordering; only an explicit false keeps model order. */
function novelaiUseOrder(config) {
  const value = String(config.useOrder || '').trim().toLowerCase()
  return value ? value !== 'false' : true
}

/** NovelAI wants raw base64 in `parameters.image`; a `data:` prefix must be
 * stripped and remote URLs are never fetched on the user's behalf. */
function referenceImageBytes(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!text.startsWith('data:') && /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) throw new Error('图片参考不支持远程地址，请填写 base64 图片数据，可带 data:image/...;base64, 前缀')
  const compact = (text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text).replace(/\s+/g, '')
  if (compact.length < 8 || compact.length % 4 || !BASE64_IMAGE.test(compact)) throw new Error('图片参考不是有效的 base64 图片数据')
  return compact
}

/** Image-to-image strength; NovelAI's own default is 0.7. An empty setting must
 * stay empty rather than coercing to 0, which would ignore the reference image. */
function imageStrength(config) {
  const raw = String(config.imageStrength ?? '').trim()
  if (!raw) return 0.7
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.7
}

/** Compile frozen per-person blocks, not current game variables. Image-local
 * adjustments live in blocks; stale person.fields must not override them.
 * Names identify records but aren't repeated as invented visual subjects. */
export function novelaiPrompts(input, config = {}, { withArtist = true } = {}) {
  const plan = input.plan, artist = withArtist ? novelaiArtist(config) : { ...novelaiArtist(config), prompt: '' }
  if (!plan || !Array.isArray(plan.blocks)) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000) throw new Error('NovelAI 画面提示词为空或过长')
    return { base: assembleBase({ quality: artist.quality, scene: input.prompt, artist: artist.prompt }, config), characters: [] }
  }
  const people = plan.people || [], ids = new Set(people.map(person => person.id))
  if (ids.size !== people.length || plan.blocks.some(block => block.owner !== 'scene' && !ids.has(block.owner))) throw new Error('NovelAI 人物方案包含重复或未知人物')
  const characters = people.map(person => ({
    id: person.id,
    caption: plan.blocks.filter(block => block.owner === person.id && block.tags).map(block => block.tags).join(', ')
  }))
  if (characters.some(person => !person.caption)) throw new Error('NovelAI 人物方案缺少人物描述')
  const style = plan.styleOverride?.tags ?? plan.style?.tags ?? ''
  const scene = plan.blocks.filter(block => block.owner === 'scene' && block.tags).map(block => block.tags).join(', ')
  const base = assembleBase({ quality: artist.quality, scene, style, artist: artist.prompt }, config)
  if (!base.trim() && !characters.length) throw new Error('NovelAI 画面提示词为空')
  if (base.length + characters.reduce((sum, person) => sum + person.caption.length, 0) > 16000) throw new Error('NovelAI 组合提示词过长')
  return { base: base || characters.length + ' people', characters }
}

/** Variety Boost skips CFG at high noise levels, scaled by image area as in
 * NovelAI's own frontend. V5 has no such switch, so it is never sent there. */
function varietyBoostSigma(model, width, height) {
  return Math.sqrt(width * height / 1011712) * (model.startsWith('nai-diffusion-4-5') ? 58 : 19)
}

export function novelaiRequest(input, config) {
  const { width, height, guidance, characters: limit } = novelaiSettings(config)
  const prompt = novelaiPrompts(input, config)
  if (limit && prompt.characters.length > limit) throw new Error('当前 NovelAI 模型最多支持 ' + limit + ' 人，请选择 V5 或调整画面')
  const seed = config.seed ? Number(config.seed) : randomInt(0, 0x100000000)
  const negative = mergeTags(mergeTags(novelaiArtist(config).negative, novelaiNegativeTags(config)), typeof input.plan?.negative === 'string' ? input.plan.negative : '')
  const sampler = config.sampler || 'k_euler_ancestral'
  const reference = referenceImageBytes(config.referenceImage)
  const captions = prompt.characters.map(person => ({ char_caption: person.caption, centers: [{ x: 0.5, y: 0.5 }] }))
  // Only send the official preset switches when one is actually selected, so an
  // untouched configuration keeps the exact payload earlier versions produced.
  const qualityPreset = String(config.qualityPreset || 'none').trim().toLowerCase(), ucPreset = String(config.ucPreset || 'none').trim().toLowerCase()
  const presets = {
    ...(qualityPreset === 'none' ? {} : { qualityPresetId: qualityPreset, qualityToggle: true, quality_toggle: true, tag_hint_qt: qualityPreset === 'standard' ? 1 : 3 }),
    ...(ucPreset === 'none' ? {} : { uc: negative, ucPreset: UC_PRESET_INDEX[ucPreset], uc_preset: UC_PRESET_INDEX[ucPreset] })
  }
  return {
    input: limit ? prompt.base : [prompt.base, ...prompt.characters.map(person => person.caption)].filter(Boolean).join('\n'),
    model: config.model,
    // Image-to-image travels in `parameters`, never inside `v4_prompt`; the
    // noise seed derives from the chosen seed so a fixed seed stays reproducible.
    action: reference ? 'img2img' : 'generate',
    parameters: {
      params_version: 4, width, height, scale: config.guidance ? Number(config.guidance) : guidance, steps: config.steps ? Number(config.steps) : 23,
      sampler, noise_schedule: config.noiseSchedule || 'karras', n_samples: 1, seed,
      negative_prompt: negative, cfg_rescale: config.cfgRescale ? Number(config.cfgRescale) : 0, dynamic_thresholding: false, legacy: false, legacy_v3_extend: false,
      ...(sampler === 'k_euler_ancestral' ? { deliberate_euler_ancestral_bug: false, prefer_brownian: true } : {}),
      ...(config.varietyBoost === 'true' && !config.model.startsWith('nai-diffusion-5') ? { skip_cfg_above_sigma: varietyBoostSigma(config.model, width, height) } : {}),
      ...presets,
      ...(reference ? { image: reference, strength: imageStrength(config), noise: 0, extra_noise_seed: Math.max(0, seed - 1) } : {}),
      ...(limit ? {
        use_coords: false, legacy_uc: false,
        v4_prompt: { caption: { base_caption: prompt.base, char_captions: captions }, use_coords: false, use_order: novelaiUseOrder(config) },
        v4_negative_prompt: { caption: { base_caption: negative, char_captions: captions.map(() => ({ char_caption: '', centers: [{ x: 0.5, y: 0.5 }] })) }, legacy_uc: false }
      } : { sm: false, sm_dyn: false })
    }
  }
}

/** Nai2API-style conversation generation: the relay validates a fixed Chinese
 * field template in the user message and reads its values from the higher
 * priority `nai` object. One picture per call; the reply text carries its URL. */
export function novelaiChatRequest(input, config) {
  const { width, height, guidance, characters: limit } = novelaiSettings(config)
  const prompt = novelaiPrompts(input, config, { withArtist: false })
  if (limit && prompt.characters.length > limit) throw new Error('当前 NovelAI 模型最多支持 ' + limit + ' 人，请选择 V5 或调整画面')
  const oneLine = text => String(text || '').replace(/\s*\n+\s*/g, ', ').trim()
  const tags = oneLine([prompt.base, ...prompt.characters.map(person => person.caption)].filter(Boolean).join(', '))
  const artist = oneLine(novelaiArtist(config).prompt)
  const negative = oneLine(mergeTags(mergeTags(novelaiArtist(config).negative, novelaiNegativeTags(config)), typeof input.plan?.negative === 'string' ? input.plan.negative : ''))
  const sampler = config.sampler || 'k_euler_ancestral'
  const size = width === height ? '方图' : width > height ? '横图' : '竖图'
  const scale = config.guidance ? Number(config.guidance) : guidance
  const cfg = config.cfgRescale ? Number(config.cfgRescale) : 0
  const content = ['提示词:' + tags, '画师串:' + artist, '尺寸:' + size, '提示词引导值:' + scale, '缩放引导值:' + cfg, '负面提示词:' + negative, '采样器:' + sampler].join('\n')
  return {
    // Relays list each sampler as its own model, e.g. nai-diffusion-4-5-full:k_euler.
    model: config.model + ':' + sampler, stream: false,
    messages: [{ role: 'user', content }],
    nai: { tag: tags, artist, size, scale, cfg, negative, sampler, noise_schedule: config.noiseSchedule || 'karras' }
  }
}
