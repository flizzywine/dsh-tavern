import { effectiveImageProvider } from './image-provider-capabilities.js'
import { activePromptBlocks, applyStructurePositive, normalizePromptStructure, structureGuidance, structureNegative } from './prompt-structure.js'
export { normalizePromptStructure } from './prompt-structure.js'

export const PROMPT_FORMATS = Object.freeze(['tags', 'natural', 'mixed', 'structured'])
const MODES = new Set(['auto', ...PROMPT_FORMATS])
export const STRUCTURED_PROMPT_SECTIONS = Object.freeze(['人物与表情', '服装', '动作', '环境', '镜头与光线', '风格', '约束'])
export const BASIC_IMAGE_WORLDBOOK = [
  '根据正文当下可见事实写一个可同时成立的定格姿态；不为解释光线新增窗帘、开口、掀布或光源，不擅自改设画风。',
  '正文出现人物库角色时，使用库中的准确姓名引用，例如 ${"name":"角色名"}$；确知使用库内某套服装时可加 "outfit"。未知人物按正文描述。',
  '有参考图时，参考图编号和绑定由插件处理；仅写本张可见的状态和动作。',
].join('\n')
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
export const MAX_PROMPT_PRESETS = 200
const MAX_TEXT = 4000

/** Built-in profiles describe visual intent, not a particular model or quality score. */
export const EXAMPLE_PROMPT_PRESET = {
  id: 'cinematic-example', name: '电影叙事', independent: true,
  structure: { format: 'structured', targets: [], blocks: [
    { kind: 'scene', title: '场景', text: '' },
    { kind: 'style', title: '画风', text: '电影叙事风格。用前后景体现空间层次，光线来自场景中可见或合理的光源。' },
  ] },
}
export const STRUCTURED_PROMPT_TEMPLATE = {
  id: 'structured-template', name: '结构化模板', independent: true,
  structure: { format: 'structured', targets: [], blocks: [
    { kind: 'output', title: '生成方式', format: 'structured', text: BASIC_IMAGE_WORLDBOOK + '\n用中文自然段描述一个定格画面。只写正文已确立的可见细节，省略没有依据的内容。按照下方分节组织，不复述生成要求。' },
    { kind: 'library', title: '角色与服装引用', text: '先识别画面里实际出场的人，再引用该人物和当前服装。' },
    { kind: 'section', title: '人物与表情', text: '写明出场人物、位置和可见表情。' },
    { kind: 'section', title: '服装', text: '描述本场实际穿着，保留正文明确的变化。' },
    { kind: 'section', title: '动作', text: '只描述同一瞬间可同时成立的姿态、朝向和交互。' },
    { kind: 'section', title: '环境', text: '描述已有场景、可见道具和前后景关系。' },
    { kind: 'section', title: '镜头与光线', text: '描述景别、构图和有依据的光线方向。' },
    { kind: 'style', title: '画风', text: '' },
    { kind: 'entries', title: '词条库', entryGroup: '', text: '' },
  ] },
}
export const DEFAULT_MODULAR_TEMPLATE = {
  name: '模块化模板', independent: true,
  structure: { format: 'auto', targets: [], blocks: [
    { kind: 'output', title: '生成方式', format: 'auto', text: '依据当前画面的可见事实，按主体与关系、一个可同时成立的定格姿态、场景、构图与光线组织提示词。多人要写清谁在做什么，人物朝向、道具归属和服装状态符合当前时点。角色与服装优先引用库中已确认的资料；未给出的发色、瞳色、性别、年龄、服装、物件和动作不猜测，不为解释光线新增窗帘、开口、掀布或光源。不得改变人物朝向、动作、天气或时段；没有时间依据就不写白天、夜晚。画风只来自启用的画风模块，不擅自改设画风；画风模块为空时不写画风、媒介或画师，不自行加入写实、电影、动漫等风格。允许选择有利于主体的景别与构图。使用当前生图模型适合的表达；缺少依据的内容省略，不为填满分节而补写。正面只写可见画面，不写规则解释或 Negative 清单；正文明确要求排除的内容写到同一 image 的 <negative_prompt>，没有排除要求则省略。' },
    { kind: 'scene', title: '画面描述', text: '' },
    { kind: 'library', title: '角色与服装引用', text: '只引用实际出场的人物和本场穿着。' },
    { kind: 'style', title: '画风', text: '' },
    { kind: 'entries', title: '词条库', text: '', entryGroup: '' },
  ] },
}

export const BUILTIN_PROMPT_PRESETS = [
  STRUCTURED_PROMPT_TEMPLATE,
  EXAMPLE_PROMPT_PRESET,
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

/** Read-only presets supplied by server-side plugins at runtime; never persisted with user settings. */
const registeredPresets = new Map()

/** Register a plain style preset. Ids are namespaced (`plugin.name`), so they never collide with built-in or saved ids. */
export function registerPromptPreset(definition) {
  const presetId = String(definition?.id ?? '')
  if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(presetId) || presetId.length > 80) throw new Error('预设标识需采用「插件名.预设名」格式：' + presetId)
  if (registeredPresets.has(presetId)) throw new Error('预设标识已注册：' + presetId)
  const preset = { id: presetId, name: clean(definition.name, 80) || presetId, source: clean(definition.source, 80) || presetId.split('.')[0], registered: true,
    positive: clean(definition.positive), negative: clean(definition.negative, 2000), tagPositive: clean(definition.tagPositive),
    naturalPositive: clean(definition.naturalPositive), mixedPositive: clean(definition.mixedPositive),
    structuredPositive: clean(definition.structuredPositive), structuredNegative: clean(definition.structuredNegative, 2000) }
  registeredPresets.set(presetId, preset)
  return () => { if (registeredPresets.get(presetId) === preset) registeredPresets.delete(presetId) }
}

export function listRegisteredPromptPresets() {
  return [...registeredPresets.values()].map(preset => ({ ...preset }))
}

/**
 * Select a preset for one request without touching saved settings. Unknown or disabled ids are an error, never a silent fallback.
 * The caller chose the style for this request, so it is applied as named: the user's style library, default artist text and
 * manual additions are not stacked on it, and the worldbook prompt system does not drop a named template.
 */
export function withPromptPreset(config, presetId) {
  if (presetId === undefined) return config
  const selected = { ...config, activePromptPreset: String(presetId), promptSelectionResolved: true, requestedPromptPreset: true, resolvedPromptTemplate: undefined }
  if (!effectivePromptPreset(selected)) throw new Error('找不到画风预设：' + presetId + '（未注册、已卸载或已停用）')
  return selected
}

const TAG_BACKENDS = new Set(['comfyui', 'novelai', 'stable-diffusion', 'sd', 'sdwebui', 'forge', 'automatic1111'])
const NATURAL_BACKENDS = new Set(['openai', 'gemini', 'gemini-chat', 'grok', 'seedream', 'qwen', 'atlascloud'])

function clean(value, max = MAX_TEXT) { return String(value ?? '').trim().slice(0, max) }
function id(value) { return clean(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-') }

export function normalizePromptPresets(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set(BUILTIN_PROMPT_PRESETS.map(item => item.id))
  return input.filter(item => item && typeof item === 'object').slice(0, MAX_PROMPT_PRESETS).map((item, index) => {
    let presetId = id(item.id) || `custom-${index + 1}`
    while (seen.has(presetId)) presetId = `${presetId}-${index + 1}`
    seen.add(presetId)
    const structure = normalizePromptStructure(item.structure)
    return {
      id: presetId,
      name: clean(item.name, 80) || `Prompt profile ${index + 1}`,
      ...(typeof item.project === 'string' && clean(item.project, 60) ? { project: clean(item.project, 60) } : {}),
      ...(item.independent === true ? { independent: true } : {}),
      positive: clean(item.positive),
      negative: clean(item.negative, 2000),
      // Optional backend-specific text can refine a custom profile without silently setting API parameters.
      tagPositive: clean(item.tagPositive),
      naturalPositive: clean(item.naturalPositive),
      mixedPositive: clean(item.mixedPositive),
      structuredPositive: clean(item.structuredPositive),
      structuredNegative: clean(item.structuredNegative, 2000),
      enabled: item.enabled !== false,
      ...(structure ? { structure } : {}),
    }
  })
}

/** Whether the user's style library, default artist text and manual additions go with this preset. */
export function inheritsUserStyle(config = {}, preset) {
  return preset?.independent !== true && config.requestedPromptPreset !== true
}

export function promptConfigForTarget(config, workflow = null, channel = null) {
  // A preset named for one request resolves the same way under both prompt systems.
  if (config.promptSystem === 'worldbook' && !config.requestedPromptPreset) {
    // Older installs used plain visual presets alongside worldbook rules.
    // Only modular templates belong exclusively to the workbench.
    const presets = (Array.isArray(config.promptPresets) ? config.promptPresets : []).filter(preset => !preset?.structure)
    const selected = [...BUILTIN_PROMPT_PRESETS.filter(preset => !preset.structure), ...registeredPresets.values(), ...presets]
      .find(preset => preset?.id === config.activePromptPreset && preset.enabled !== false)
    return { ...config, activePromptPreset: selected?.id || '', promptPresets: presets, promptDefault: null, resolvedPromptTemplate: undefined }
  }
  if (registeredPresets.has(config.activePromptPreset)) return config
  const presets = Array.isArray(config.promptPresets) ? config.promptPresets : []
  const kind = workflow ? 'workflow' : 'channel'
  const targetId = workflow ? workflow.id : channel?.id || (config.imageBackend !== 'comfyui' ? config.activeImageChannel : '')
  const bound = targetId && presets.find(preset => preset?.enabled !== false && Array.isArray(preset?.structure?.targets) &&
    preset.structure.targets.some(target => target?.kind === kind && target.id === targetId))
  const selected = config.promptSelectionResolved ? (config.activePromptPreset ? presets.find(item => item.id === config.activePromptPreset && item.enabled !== false) : config.promptDefault) : bound || (config.activePromptPreset ? presets.find(preset => preset && preset.id === config.activePromptPreset && preset.enabled !== false) : config.promptDefault)
  const structure = normalizePromptStructure(selected?.structure)
  if (!structure) return config
  return { ...config, activePromptPreset: selected === config.promptDefault ? '' : selected.id, promptMode: structure.format }
}

export function normalizeDefaultPromptTemplate(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const [preset] = normalizePromptPresets([{ ...value, id: 'fallback', name: clean(value.name, 80) || '默认模板', enabled: true }])
  if (!preset?.structure) return undefined
  return { ...preset, structure: { ...preset.structure } }
}

/** Read the custom template for a channel or workflow without starting a generation. */
export function resolvePromptTemplate(config, { workflow, channel } = {}) {
  const preset = effectivePromptPreset(promptConfigForTarget(config, workflow, channel))
  return preset?.structure ? { id: preset.id, name: preset.name, ...preset.structure } : null
}

export function effectivePromptPreset(config = {}) {
  const selected = String(config.activePromptPreset ?? '')
  const resolved = config.resolvedPromptTemplate
  if (resolved && (selected ? resolved.id === selected : resolved.id === 'fallback')) return resolved
  if (!selected) return normalizeDefaultPromptTemplate(config.promptDefault) ?? null
  const builtin = BUILTIN_PROMPT_PRESETS.find(item => item.id === selected)
  if (builtin) return builtin
  const registered = registeredPresets.get(selected)
  if (registered) return registered
  const direct = Array.isArray(config.promptPresets) && config.promptPresets.find(item => item?.id === selected)
  if (direct) return direct.enabled === false ? null : normalizePromptPresets([direct])[0]
  return normalizePromptPresets(config.promptPresets).find(item => item.id === selected && item.enabled !== false) ?? null
}

export function validPromptPresetId(config = {}, value = config.activePromptPreset) {
  const selected = String(value ?? '')
  if (!selected) return ''
  if (registeredPresets.has(selected)) return selected
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
  if (!preset || preset.independent) return ''
  if (mode === 'tags') return preset.tagPositive || preset.positive
  if (mode === 'natural') return preset.naturalPositive || preset.positive
  if (mode === 'structured') return preset.structuredPositive || preset.naturalPositive || preset.positive
  return preset.mixedPositive || preset.naturalPositive || preset.positive
}

/** Returns a short clause for the existing planner call; never performs an extra model call. */
export function getPromptGuidance(config = {}, backend = '', { compact = false, usage } = {}) {
  const preset = effectivePromptPreset(config)
  const mode = resolvePromptMode(config, backend)
  const clauses = []
  if (mode === 'structured') {
    if (!compact && !preset?.structure && config.promptDefault !== null) clauses.push(STRUCTURED_PROMPT_GUIDANCE)
    else if (!preset?.structure && config.promptDefault !== null) {
      clauses.push('用中文自然语言，按需要使用以下分节：' + STRUCTURED_PROMPT_SECTIONS.join('、') + '。标题使用【分节名】，空白分节省略。')
    } else if (!activePromptBlocks(preset?.structure, usage).some(block => block.kind === 'section')) clauses.push('用中文自然语言描述画面。')
    if (preset && !preset.independent) {
      const visual = textForMode(preset, mode)
      if (visual) clauses.push(`视觉预设「${preset.name}」：${visual}\n将此作为构图、光线、材质与风格指导，保留正文的主体、动作和事实；按世界书的相应分节表达。`)
      const negative = preset.structuredNegative || preset.negative
      if (negative) clauses.push('需要避免的视觉问题：' + negative)
    }
    clauses.push(structureGuidance(preset?.structure, mode, usage))
    return clauses.filter(Boolean).join('\n')
  }
  if (preset && !preset.independent) {
    const visual = textForMode(preset, mode)
    clauses.push(`Apply the selected visual profile “${preset.name}”: ${visual}. Keep the scene-specific subject and action from the request; use these as composition, lighting, material, and style guidance.`)
    if (preset.negative) clauses.push(`Avoid these visual problems where applicable: ${preset.negative}.`)
  }
  clauses.push(mode === 'tags'
    ? 'Write positive and negative image prompts as concise comma-separated visual tags. Keep NovelAI/Stable Diffusion weighted-tag syntax only when explicitly requested; do not invent quality scores, artist names, model names, or unsupported parameters.'
    : mode === 'natural'
      ? 'Write positive and negative image prompts as clear natural-language visual descriptions, not comma-separated tag piles. Do not invent quality scores, artist names, model names, or unsupported parameters.'
      : 'Use a readable mixed prompt: a concise natural-language scene description followed by a few useful visual tags. Do not invent quality scores, artist names, model names, or unsupported parameters.')
  if (/comfyui/i.test(backend) && config.allowChinesePrompt !== true && !acceptsChinese(backend)) {
    clauses.push('The image text encoder requires English: write the contents of <prompts> and negative prompts in English, including both prose and tags. Keep Chinese only in regex/title metadata and literal library macros or IDs. Translate the scene faithfully; do not silently omit facts.')
  }
  clauses.push(structureGuidance(preset?.structure, mode, usage))
  return clauses.filter(Boolean).join('\n')
}

function structureWithStyles(structure, config, usage, mode) {
  const linked = activePromptBlocks(structure, usage).filter(block => block.kind === 'style' && block.styleId)
  if (!linked.length || !Array.isArray(config.stylePresets)) return structure
  const styles = new Map(config.stylePresets.filter(style => style?.enabled !== false && style?.id != null)
    .map(style => [String(style.id), style]))
  const resolved = new Set()
  const blocks = structure.blocks.flatMap(block => {
    if (!linked.includes(block)) return [block]
    const style = styles.get(block.styleId)
    if (!style || resolved.has(block.styleId)) return [block]
    resolved.add(block.styleId)
    const separator = mode === 'tags' ? ', ' : mode === 'structured' ? '\n' : '. '
    const text = [String(style.artist ?? '').trim(), block.text].filter(Boolean).join(separator)
    const negative = String(style.negative ?? '').trim()
    return [{ ...block, text }, ...(negative ? [{ kind: 'negative', text: negative }] : [])]
  })
  return { ...structure, blocks }
}

/** Deterministically adds active profile guidance to a finished prompt for both direct and planned jobs. */
export function composePresetText(text, config = {}, backend = '', { maxLength = 12000, usage } = {}) {
  const preset = effectivePromptPreset(config)
  const mode = resolvePromptMode(config, backend)
  const structure = structureWithStyles(preset?.structure, config, usage, mode)
  const addition = textForMode(preset, mode)
  if (mode === 'structured') return appendStructuredSection(applyStructurePositive(String(text ?? '').trim(), structure, mode, usage), '风格补充', addition)
  const base = applyStructurePositive(clean(text, maxLength), structure, mode, usage)
  if (!addition || base.toLowerCase().includes(addition.toLowerCase())) return base
  return [base, addition].filter(Boolean).join(mode === 'tags' ? ', ' : '. ')
}

export function promptPresetNegative(config = {}, backend = '', usage) {
  const preset = effectivePromptPreset(config)
  const mode = resolvePromptMode(config, backend)
  const structured = mode === 'structured'
  const structure = structureWithStyles(preset?.structure, config, usage, mode)
  return [preset?.independent ? '' : structured ? preset?.structuredNegative || preset?.negative : preset?.negative, ...structureNegative(structure, usage)]
    .filter(Boolean).join(structured ? '\n\n' : ', ')
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
export function composeStructuredPrompt({ text = '', config = {}, artist = '', artistPosition = 'prefix', positive = '', negative = '', referenceText = '', definitionAdditions = [], usage } = {}) {
  const preset = effectivePromptPreset(config)
  const structure = structureWithStyles(preset?.structure, config, usage, 'structured')
  let composed = applyStructurePositive(String(text ?? '').trim(), structure, 'structured', usage)
  const libraryText = definitionAdditions.filter(Boolean).join('\n\n')
  composed = preset?.structure
    ? appendStructuredSection(composed, '素材库补充', libraryText)
    : [composed, libraryText].filter(Boolean).join('\n\n')
  composed = appendStructuredSection(composed, '风格补充', artist, { position: artistPosition })
  composed = appendStructuredSection(composed, '视觉预设补充', textForMode(preset, 'structured'))
  composed = appendStructuredSection(composed, '画面补充', positive)
  composed = appendStructuredSection(composed, '手动补充', inheritsUserStyle(config, preset) ? config.promptManualPositive : '')
  const references = appendStructuredSection('', '参考图对应与一致性', referenceText)
  if (references) composed = [references, composed.replace(references, '').trim()].filter(Boolean).join('\n\n')
  const constraints = [preset?.independent ? '' : preset?.structuredNegative || preset?.negative, ...structureNegative(structure, usage), inheritsUserStyle(config, preset) ? config.promptManualNegative : '', negative]
    .map(value => String(value ?? '').trim()).filter(Boolean).join('\n\n')
  return { positive: composed, negative: constraints, combined: combineStructuredPrompt(composed, constraints) }
}
