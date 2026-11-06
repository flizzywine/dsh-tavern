import { effectiveImageProvider } from './image-provider-capabilities.js'

export const PROMPT_FORMATS = Object.freeze(['tags', 'natural', 'mixed', 'structured'])
const MODES = new Set(['auto', ...PROMPT_FORMATS])
export const STRUCTURED_PROMPT_SECTIONS = Object.freeze(['人物与表情', '服装', '动作', '环境', '镜头与光线', '风格', '约束'])
export const STRUCTURED_PROMPT_GUIDANCE = [
  '使用结构化中文自然语言写画面提示词，标题和描述都使用中文，不堆砌英文标签。',
  '默认可按以下分节组织：' + STRUCTURED_PROMPT_SECTIONS.join('、') + '。没有内容的节可以省略，不增加任务宣告段。',
  '这些只是默认分节；本格式独立世界书可以调整标题、顺序、增减分节，不要求机械套用固定模板。',
  '人物节写清人物名称与当前可见表情，服装和动作各归对应分节。参考图编号、绑定及用途说明由插件统一追加一次，不在画面正文中重复代写；没有身份参考图的人物仍需描述有依据的可见外貌。',
  '单张只描述一个可同时成立的定格姿态，明确支撑点、朝向和视线落点；不混写起身中与已经坐稳等不同阶段，不用“扫过”“随后”等词串联动作。表情以主导情绪和可见面部变化表达，不堆叠相互冲突的情绪。',
  '服装、陈设、道具及人物状态以正文和此时点之前最后明确的信息为准，不为填满分节猜测衣物颜色、家具清单或物品位置；无依据的内容省略。',
  '核对遮挡对象、覆盖范围、窗扇状态和入光路径是否能在同一画面成立；只澄清已有空间关系，不为解释光线新增窗帘、开口、掀布或光源，无法确定的细节不要编造。',
  '构图与风格遵循用户设置和已确立的画面信息；缺少设置时仅作不改变事实的必要构图选择，不擅自改设画风，也不要求身份图提供场景或风格。画风指导不能改写剧情事实，不虚构画师、质量分数或接口参数。',
  '约束只保留本张需要且可执行的限制，明确人数、对象或允许的陈设范围，不写“不添加不存在的道具”等无指向要求。内部优先级、生成规则和未发生的湿衣、破损等示例不输出到画面提示词；实际发生的变化直接写成当前状态。',
  '保持自然段、列表、标点和有意义的重复，不把不同人物的相同特征全局去重。',
].join('\n')
const MAX_PRESETS = 60
const MAX_TEXT = 4000

/** Built-in profiles describe visual intent, not a particular model or quality score. */
export const BUILTIN_PROMPT_PRESETS = [
  {
    id: 'portrait-editorial', name: '杂志人像',
    structuredPositive: '采用杂志人像的视觉风格：构图有意图，姿态自然且富有表现力，面部清楚可读。以柔和、有方向的主光配合轻微补光，保留皮肤与织物的真实质感，控制色彩，让主体与背景清晰分离。',
    structuredNegative: '避免面部模糊、不自然的裁切、僵硬姿态、生硬闪光、蜡质或塑料质感、杂乱背景，以及非剧情要求的文字和水印。',
    positive: 'intentional portrait framing, expressive but natural pose, readable facial features, soft directional key light with gentle fill, realistic skin and fabric texture, restrained color palette, clean separation from the background',
    tagPositive: 'editorial portrait, intentional framing, natural expressive pose, readable face, soft directional key light, gentle fill light, realistic skin texture, detailed fabric, restrained palette, clean background separation',
    naturalPositive: 'Frame this as an intentional editorial portrait with a natural expressive pose. Keep the face readable, use soft directional key light with gentle fill, show realistic skin and fabric texture, and separate the subject cleanly from a restrained background.',
    mixedPositive: 'An intentional editorial portrait with a natural expressive pose and readable face; soft directional key light, gentle fill, realistic skin and fabric texture, restrained palette, clean background separation.',
    negative: 'unclear face, awkward crop, stiff pose, harsh flash, waxy skin, plastic texture, cluttered background, text, watermark',
  },
  {
    id: 'story-cinematic', name: '电影叙事',
    structuredPositive: '采用电影叙事的视觉风格：以清楚的剧情瞬间和富有表现力的肢体动作组织画面，体现前后景的空间层次。光线应来自场景中合理的光源，环境细节连贯，材质自然，对比适度。',
    structuredNegative: '避免动作含混、道具与情节脱节、光线平板、对比浑浊、透视矛盾、画面杂乱，以及非剧情要求的文字和水印。',
    positive: 'clear story moment, expressive body language, foreground and background depth, cinematic composition, motivated practical lighting, coherent environment details, natural material texture, balanced contrast',
    tagPositive: 'clear story moment, expressive body language, foreground depth, background depth, cinematic composition, motivated practical lighting, coherent environment, natural material texture, balanced contrast',
    naturalPositive: 'Show one clear story moment through expressive body language and a cinematic composition with foreground and background depth. Let practical light sources motivate the lighting, keep environment details coherent, and preserve natural materials and balanced contrast.',
    mixedPositive: 'A clear story moment told through expressive body language and cinematic depth; motivated practical lighting, coherent environment details, natural material texture, balanced contrast.',
    negative: 'ambiguous action, disconnected props, flat lighting, muddy contrast, inconsistent perspective, clutter, text, watermark',
  },
  {
    id: 'anime-character', name: '动漫角色',
    structuredPositive: '采用精致的手绘动画视觉风格：人物轮廓清楚，眼神和面部表情有表现力，线条干净且有意图，赛璐璐明暗有层次，高光克制，服装细节可读，色彩相互协调。',
    structuredNegative: '避免线条风格不一致、阴影浑浊、面部变形、服装细节难以辨认、多余肢体，以及非剧情要求的文字和水印。',
    positive: 'polished hand-drawn anime illustration, appealing silhouette, expressive eyes and face, clean intentional linework, layered cel shading, controlled highlights, readable outfit details, complementary colors',
    tagPositive: 'polished hand-drawn anime, appealing silhouette, expressive eyes, clean intentional linework, layered cel shading, controlled highlights, readable outfit details, complementary colors',
    naturalPositive: 'Render the character as a polished hand-drawn anime illustration. Give them an appealing silhouette and expressive face, with clean intentional linework, layered cel shading, controlled highlights, readable outfit details, and complementary colors.',
    mixedPositive: 'A polished hand-drawn anime character with an appealing silhouette and expressive face; clean linework, layered cel shading, controlled highlights, readable outfit details, complementary colors.',
    negative: 'inconsistent linework, muddy shading, distorted face, unreadable outfit, extra limbs, text, watermark',
  },
  {
    id: 'eastern-fantasy', name: '东方幻想',
    structuredPositive: '在不改变正文人物和服装事实的前提下采用东方幻想的视觉语言：衣形舒展流畅，装饰有取舍，景观有空气透视与空间层次。以微亮雾气和方向光表现氛围，让丝绸、漆器和石材有真实触感，色彩协调克制。',
    structuredNegative: '避免服装失去辨识度、装饰无节制堆积、氛围浑浊、材质平板、建筑风格矛盾，以及非剧情要求的文字和水印。',
    positive: 'eastern fantasy visual language, graceful flowing costume shapes, considered ornamental details, atmospheric landscape depth, luminous mist and directional light, tactile silk, lacquer and stone, harmonious restrained palette',
    tagPositive: 'eastern fantasy, graceful flowing costume, considered ornaments, atmospheric landscape depth, luminous mist, directional light, tactile silk, lacquer, stone, harmonious restrained palette',
    naturalPositive: 'Use an eastern fantasy visual language with graceful flowing costume shapes and considered ornamental details. Set the subject in an atmospheric landscape with luminous mist and directional light, and make silk, lacquer, and stone feel tactile within a harmonious restrained palette.',
    mixedPositive: 'Eastern fantasy with graceful flowing costume and considered ornaments; atmospheric landscape depth, luminous mist, directional light, tactile silk, lacquer and stone, harmonious restrained palette.',
    negative: 'generic costume, indiscriminate ornament, muddy atmosphere, flat materials, inconsistent architecture, text, watermark',
  },
  {
    id: 'landscape-atmosphere', name: '氛围场景',
    structuredPositive: '以鲜明的场景轮廓组织画面，明确前景、中景和远景，使用空气透视和一致的自然光方向。地形与材质富有变化，留白平衡，天气与色彩连贯，主体仍以正文要求为准。',
    structuredNegative: '避免空间层次平板、地形单调、多个焦点相互争夺、天气矛盾、色彩过饱和，以及非剧情要求的文字和水印。',
    positive: 'strong landscape silhouette, clear foreground middle ground and distance, atmospheric perspective, natural light direction, varied terrain and material texture, balanced negative space, coherent weather and color',
    tagPositive: 'strong landscape silhouette, clear foreground, middle ground and distance, atmospheric perspective, natural light direction, varied terrain, material texture, balanced negative space, coherent weather and color',
    naturalPositive: 'Build the scene around a strong landscape silhouette with a clear foreground, middle ground, and distance. Use atmospheric perspective and a consistent natural light direction, vary terrain and material texture, and leave balanced negative space with coherent weather and color.',
    mixedPositive: 'A strong landscape silhouette with clear foreground, middle ground and distance; atmospheric perspective, natural light direction, varied terrain and material texture, balanced negative space, coherent weather and color.',
    negative: 'flat depth, featureless terrain, competing focal points, incoherent weather, oversaturated color, text, watermark',
  },
]

const TAG_BACKENDS = new Set(['comfyui', 'novelai', 'stable-diffusion', 'sd', 'sdwebui', 'forge', 'automatic1111'])
const NATURAL_BACKENDS = new Set(['openai', 'gemini', 'gemini-chat', 'grok', 'seedream', 'qwen', 'atlascloud'])

function clean(value, max = MAX_TEXT) { return String(value ?? '').trim().slice(0, max) }
function id(value) { return clean(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-') }

export function normalizePromptPresets(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set(BUILTIN_PROMPT_PRESETS.map(item => item.id))
  return input.filter(item => item && typeof item === 'object').slice(0, MAX_PRESETS).map((item, index) => {
    let presetId = id(item.id) || `custom-${index + 1}`
    while (seen.has(presetId)) presetId = `${presetId}-${index + 1}`
    seen.add(presetId)
    return {
      id: presetId,
      name: clean(item.name, 80) || `Prompt profile ${index + 1}`,
      positive: clean(item.positive),
      negative: clean(item.negative, 2000),
      // Optional backend-specific text can refine a custom profile without silently setting API parameters.
      tagPositive: clean(item.tagPositive),
      naturalPositive: clean(item.naturalPositive),
      mixedPositive: clean(item.mixedPositive),
      structuredPositive: clean(item.structuredPositive),
      structuredNegative: clean(item.structuredNegative, 2000),
      enabled: item.enabled !== false,
    }
  })
}

export function effectivePromptPreset(config = {}) {
  const custom = normalizePromptPresets(config.promptPresets)
  const presets = [...BUILTIN_PROMPT_PRESETS, ...custom]
  const selected = String(config.activePromptPreset ?? '')
  return presets.find(item => item.id === selected && item.enabled !== false) ?? null
}

export function validPromptPresetId(config = {}, value = config.activePromptPreset) {
  const selected = String(value ?? '')
  if (!selected) return ''
  return [...BUILTIN_PROMPT_PRESETS, ...normalizePromptPresets(config.promptPresets)].some(item => item.id === selected && item.enabled !== false) ? selected : ''
}

/** Prompt-mode context follows the image execution path, never stale Comfy settings on another provider. */
export function promptBackendContext(config = {}, workflow = null) {
  const backend = String(config.imageBackend || 'comfyui').toLowerCase()
  if (backend !== 'comfyui') {
    const channel = (config.imageChannels ?? []).find(item => item.id === config.activeImageChannel && item.provider === backend)
    try { return channel ? effectiveImageProvider(channel) : backend } catch { return backend }
  }
  return ['comfyui', workflow?.summary?.model, workflow?.label].filter(Boolean).join(' ')
}

export function resolvePromptMode(config = {}, backend = '') {
  const requested = String(config.promptMode ?? 'auto').toLowerCase()
  if (MODES.has(requested) && requested !== 'auto') return requested
  const name = String(backend ?? config.imageBackend ?? '').toLowerCase()
  const isComfy = /(?:^|\s)comfyui(?:$|\s)/.test(name)
  if (isComfy) {
    if (name.includes('flux')) return 'natural'
    // Z-Image / Lumina / Qwen-Image / HiDream 用大语言模型做文本编码器，读整句自然语言；SDXL（如 Illustrious、Pony）读 tag。
    if (/z[\s_-]?image|lumina|qwen[\s_-]?image|hidream|moss/.test(name)) return 'natural'
    if (name.includes('anima')) return 'mixed'
    return 'tags'
  }
  if ([...TAG_BACKENDS].some(item => item !== 'comfyui' && (name === item || name.startsWith(item + ' ')))) return 'tags'
  if ([...NATURAL_BACKENDS].some(item => name === item || name.startsWith(item + ' '))) return 'natural'
  if (name === 'flux' || name.startsWith('flux ')) return 'natural'
  if (name === 'anima' || name.startsWith('anima ')) return 'mixed'
  return 'mixed'
}

/**
 * 文本编码器读得懂中文的本地模型（目前是 MOSS-Image，编码器是 Qwen3.5）：中文画面描述原样保留，
 * 相当于对这类工作流自动打开 allowChinesePrompt。其他 ComfyUI 模型照旧清理中文。
 */
export function acceptsChinese(backend = '') {
  return /moss/.test(String(backend ?? '').toLowerCase())
}

export function formatPromptForBackend(text, backend = '', mode = 'tags') {
  // Structured prose can legitimately contain brackets, ratios, repeated words,
  // and newlines next to commas. Do not run tag syntax rewrites over that text.
  if (mode === 'structured') return String(text ?? '').trim()
  const name = String(backend ?? '').toLowerCase()
  let out = String(text ?? '')
  if (mode === 'natural' || mode === 'mixed') {
    out = out.replace(/-?\d+(?:\.\d+)?::([^:]+)::/g, '$1').replace(/\(([^()]+):\s*-?\d+(?:\.\d+)?\)/g, '$1').replace(/[{}\[\]]/g, '')
  } else if (name.includes('novelai')) {
    out = out.replace(/\(([^(),]+):\s*(\d+(?:\.\d+)?)\)/g, (_m, tag, weight) => `${Math.max(0.01, Math.min(2, Number(weight))).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}::${tag.trim()}::`)
  }
  out = out.replace(/\s*,\s*/g, ', ').replace(/,\s*,+/g, ',')
  // 中文整句后面紧跟的英文逗号（「……空气感。, 画面中……」）去掉，只留中文句号。
  if (mode === 'natural' || mode === 'mixed') out = out.replace(/([。！？；：])\s*,\s*/g, '$1')
  return out.trim()
}

function textForMode(preset, mode) {
  if (!preset) return ''
  if (mode === 'tags') return preset.tagPositive || preset.positive
  if (mode === 'natural') return preset.naturalPositive || preset.positive
  if (mode === 'structured') return preset.structuredPositive || preset.naturalPositive || preset.positive
  return preset.mixedPositive || preset.naturalPositive || preset.positive
}

/** Returns a short clause for the existing planner call; never performs an extra model call. */
export function getPromptGuidance(config = {}, backend = '') {
  const preset = effectivePromptPreset(config)
  const mode = resolvePromptMode(config, backend)
  const clauses = []
  if (mode === 'structured') {
    clauses.push(STRUCTURED_PROMPT_GUIDANCE)
    if (preset) {
      const visual = textForMode(preset, mode)
      if (visual) clauses.push(`视觉预设「${preset.name}」：${visual}\n将此作为构图、光线、材质与风格指导，保留正文的主体、动作和事实；按世界书的相应分节表达。`)
      const negative = preset.structuredNegative || preset.negative
      if (negative) clauses.push('需要避免的视觉问题：' + negative)
    }
    return clauses.join('\n')
  }
  if (preset) {
    const visual = textForMode(preset, mode)
    clauses.push(`Apply the selected visual profile “${preset.name}”: ${visual}. Keep the scene-specific subject and action from the request; use these as composition, lighting, material, and style guidance.`)
    if (preset.negative) clauses.push(`Avoid these visual problems where applicable: ${preset.negative}.`)
  }
  clauses.push(mode === 'tags'
    ? 'Write positive and negative image prompts as concise comma-separated visual tags. Keep NovelAI/Stable Diffusion weighted-tag syntax only when explicitly requested; do not invent quality scores, artist names, model names, or unsupported parameters.'
    : mode === 'natural'
      ? 'Write positive and negative image prompts as clear natural-language visual descriptions, not comma-separated tag piles. Do not invent quality scores, artist names, model names, or unsupported parameters.'
      : 'Use a readable mixed prompt: a concise natural-language scene description followed by a few useful visual tags. Do not invent quality scores, artist names, model names, or unsupported parameters.')
  return clauses.join('\n')
}

/** Deterministically adds active profile guidance to a finished prompt for both direct and planned jobs. */
export function composePresetText(text, config = {}, backend = '') {
  const preset = effectivePromptPreset(config)
  const mode = resolvePromptMode(config, backend)
  const addition = textForMode(preset, mode)
  if (mode === 'structured') return appendStructuredSection(text, '风格补充', addition)
  const base = clean(text, 12000)
  if (!addition || base.toLowerCase().includes(addition.toLowerCase())) return base
  return [base, addition].filter(Boolean).join(mode === 'tags' ? ', ' : '. ')
}

export function promptPresetNegative(config = {}, backend = '') {
  const preset = effectivePromptPreset(config)
  return (resolvePromptMode(config, backend) === 'structured' ? preset?.structuredNegative || preset?.negative : preset?.negative) ?? ''
}

/** Append an isolated addendum; never rewrite a user's custom section layout. */
export function appendStructuredSection(text, title, addition, { position = 'suffix' } = {}) {
  const base = String(text ?? '').trim()
  const body = String(addition ?? '').trim()
  if (!body) return base
  const block = '【' + String(title || '补充').trim() + '】\n' + body
  // This only makes the exact same complete addendum idempotent. It is not tag
  // deduplication: repeated clauses about different people must remain intact.
  if (base.includes(block)) return base
  return (position === 'prefix' ? [block, base] : [base, block]).filter(Boolean).join('\n\n')
}

/** Single-prompt channels use Chinese constraints instead of an English Avoid tail. */
export function combineStructuredPrompt(positive, negative) {
  return appendStructuredSection(positive, '约束补充', negative)
}

/**
 * Final structured assembly, called instead of the tag-oriented prepare path.
 * `positive`/`negative` are caller-owned additions (e.g. style negatives or
 * definition injection). Config manual text and the active profile are included
 * here exactly once. Reference bindings have already been resolved by the caller.
 * Return separate channels for inspection/native APIs and `combined` for APIs
 * accepting only one prompt. Do not combine `combined` with `negative` again.
 */
export function composeStructuredPrompt({ text = '', config = {}, artist = '', artistPosition = 'prefix', positive = '', negative = '', referenceText = '' } = {}) {
  const preset = effectivePromptPreset(config)
  let composed = String(text ?? '').trim()
  composed = appendStructuredSection(composed, '风格补充', artist, { position: artistPosition })
  composed = appendStructuredSection(composed, '视觉预设补充', textForMode(preset, 'structured'))
  composed = appendStructuredSection(composed, '画面补充', positive)
  composed = appendStructuredSection(composed, '手动补充', config.promptManualPositive)
  composed = appendStructuredSection(composed, '参考图对应与一致性', referenceText)
  const constraints = [preset?.structuredNegative || preset?.negative, config.promptManualNegative, negative]
    .map(value => String(value ?? '').trim()).filter(Boolean).join('\n\n')
  return { positive: composed, negative: constraints, combined: combineStructuredPrompt(composed, constraints) }
}
