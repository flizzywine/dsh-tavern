import { novelaiSettings, novelaiRequest, novelaiChatRequest, novelaiArtists, novelaiEndpoints, NOVELAI_MODELS, NOVELAI_BASE_SECTIONS, NOVELAI_QUALITY_PRESETS, NOVELAI_UC_PRESETS, NOVELAI_SAMPLERS, NOVELAI_NOISE_SCHEDULES } from './scene-image-novelai.js'
import { comfyWorkflow } from './scene-image-comfy-workflow.js'
import { imageReferenceCapability } from './scene-image-reference.js'

// Protocol presets are versioned here, not inferred by issuing paid probes.
const channels = [
  { id: 'dsh-image-gen', label: 'dsh-image-gen（内置插件）', model: '', pluginProvider: '', aspectRatio: '', size: '', fields: ['model', 'pluginProvider', 'aspectRatio', 'size'], hint: '随 Tavern 安装，无需另装插件。请到设置 → 插件 → Image generation 配置渠道、模型和 Key；此处无需重复填写。目前 Tavern 接入文生图，不含 ComfyUI 或参考图。' },
  { id: 'comfyui', label: 'ComfyUI（自建）', baseURL: '', authType: 'none', username: '', fields: ['baseURL', 'authType', 'username'], hint: '使用维护者已部署的服务与工作流。导入 API 工作流或维护者准备的映射文件；不会安装模型、节点或清空共享队列。本机地址指 Tavern 服务器。' },
  { id: 'novelai', label: 'NovelAI（官方或中转站）', baseURL: 'https://image.novelai.net', model: 'nai-diffusion-5-full', size: '832x1216', fields: ['baseURL', 'model', 'size'], hint: '默认连 NovelAI 官方，使用 V5 Full。用中转站时新建一个接入点，填中转站地址和 Key：接口和官方一样的选「官方格式」，STA1N 这类选「对话格式」。' },
  { id: 'openai', label: 'OpenAI（gpt-image 及兼容中转）', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2', size: '1024x1024', fields: ['baseURL', 'model', 'size'], hint: '官方可直接用默认地址与模型；兼容中转请填写自己的地址和模型。' },
  { id: 'gemini', label: 'Google Gemini（官方）', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image', size: '1K', aspectRatio: '1:1', fields: ['baseURL', 'model', 'size', 'aspectRatio'], hint: '使用 Interactions API，不是聊天兼容地址。' },
  { id: 'banana', label: 'Gemini 中转站（Nano Banana 等）', baseURL: '', model: '', size: '1K', fields: ['baseURL', 'model', 'size'], hint: 'Gemini 图片模型（Nano Banana 等）的中转站选这个，地址填到 /v1，模型名照中转站列表填写。NovelAI 的中转站（如 STA1N）请选「NovelAI（官方或中转站）」。' },
  { id: 'grok', label: 'Grok（xAI）', baseURL: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', size: '1k', aspectRatio: '1:1', fields: ['baseURL', 'model', 'size', 'aspectRatio'], hint: '使用 Images 接口；图片分辨率为 1k 或 2k。' },
  { id: 'seedream', label: 'Seedream（火山方舟）', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-260128', size: '2K', fields: ['baseURL', 'model', 'size'], hint: '可填账号可用的模型或接入点；关闭组图，每次只请求一张。' },
  { id: 'qwen', label: 'Qwen-Image（阿里百炼）', baseURL: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-image-3.0', size: '1024*1024', fields: ['baseURL', 'model', 'size'], hint: '默认北京地址。其他地域或工作空间请填写控制台提供的 API 根地址，密钥须属于相同地域。' },
  { id: 'webui', label: 'SD WebUI / Forge（自建）', baseURL: '', size: '512x512', authType: 'none', username: '', fields: ['baseURL', 'size', 'authType', 'username'], hint: '使用已开启 API 的 WebUI / Forge 服务，沿用服务端模型与默认采样参数。本机地址指 Tavern 服务器，不是访问页面的手机；不会安装模型或修改服务端全局设置。' }
]
// Advanced controls are optional strings, like the existing form fields.
export const IMAGE_ADVANCED_FIELDS = ['negativePrompt', 'steps', 'guidance']
// NovelAI-only controls: positive prompt, official quality/undesired-content
// presets, section ordering, sampling, image-to-image and reproducibility, plus
// the selected endpoint and artist-library entry. The endpoint and artist lists
// themselves are structured values, validated like a ComfyUI workflow.
export const IMAGE_NOVELAI_PROMPT_FIELDS = ['qualityTags', 'qualityPreset', 'ucPreset', 'promptOrder', 'sectionWeights', 'useOrder', 'seed', 'referenceImage', 'imageStrength',
  'sampler', 'noiseSchedule', 'cfgRescale', 'varietyBoost', 'endpoint', 'activeArtist']
// Per-field length ceilings; unlisted extended fields keep the historical 200-character cap.
const IMAGE_FIELD_LIMITS = {
  negativePrompt: 4000, baseURL: 2000,
  qualityTags: 600,
  qualityPreset: 16, ucPreset: 16, imageStrength: 8,
  promptOrder: 120, sectionWeights: 120,
  useOrder: 8, seed: 20, referenceImage: 50000,
  sampler: 32, noiseSchedule: 32, cfgRescale: 8, varietyBoost: 8, endpoint: 16, activeArtist: 16
}
for (const channel of channels) {
  const advanced = channel.id === 'novelai' ? [...IMAGE_ADVANCED_FIELDS, ...IMAGE_NOVELAI_PROMPT_FIELDS] : ['webui', 'comfyui'].includes(channel.id) ? IMAGE_ADVANCED_FIELDS : channel.id === 'qwen' ? ['negativePrompt'] : []
  channel.fields = [...channel.fields, ...advanced]
}
// Keep the old sentinel readable for stored records, never offer it as a provider.
export const SCENE_IMAGE_CHANNELS = channels.filter(channel => channel.id !== 'dsh-image-gen').map(({ id, label, fields, hint, model }) => ({ id, label, fields, hint, models: id === 'novelai' ? NOVELAI_MODELS : model ? [model] : [], canListModels: ['openai', 'banana', 'gemini', 'grok', 'seedream'].includes(id) }))
export function sceneImageChannel(id = 'openai') {
  const channel = channels.find(item => item.id === id)
  if (!channel) throw new Error('未知或尚未接入的生图渠道')
  return channel
}
export function channelSettings(value = {}, id = value.provider || 'openai') {
  const defaults = sceneImageChannel(id)
  const result = { provider: id }
  for (const field of defaults.fields) {
    if (value[field] !== undefined && typeof value[field] !== 'string') throw new Error('渠道配置须为文本')
    result[field] = (value[field] ?? defaults[field] ?? '').trim()
    if (result[field].length > (IMAGE_FIELD_LIMITS[field] ?? 200)) throw new Error('渠道配置过长')
  }
  for (const field of ['steps', 'guidance']) {
    if (!result[field]) continue
    const number = Number(result[field]), max = field === 'steps' ? (id === 'novelai' ? 50 : 150) : (id === 'novelai' ? 10 : 30)
    if (!/^\d+(?:\.\d+)?$/.test(result[field]) || !Number.isFinite(number) || number < (field === 'steps' ? 1 : 0) || number > max || field === 'steps' && !Number.isInteger(number)) throw new Error(`${field === 'steps' ? '生成步数' : '提示词引导强度'}须为 ${field === 'steps' ? 1 : 0}–${max}${field === 'steps' ? ' 的整数' : ' 的数值'}`)
    result[field] = String(number)
  }
  if (result.baseURL) {
    const url = new URL(result.baseURL)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('生图地址须为不含密钥、查询参数的 HTTP(S) API 根地址')
  }
  if (['webui', 'comfyui'].includes(id)) {
    result.model = '' // The running server owns model selection.
    if (!['none', 'basic', 'bearer'].includes(result.authType)) throw new Error('请选择有效的自建服务鉴权方式')
    if (/[:\r\n]/.test(result.username)) throw new Error('鉴权用户名不能包含冒号或换行')
  }
  if (id === 'webui') {
    const dimensions = result.size.match(/^(\d+)x(\d+)$/)
    if (!dimensions || dimensions.slice(1).some(value => Number(value) < 64 || Number(value) > 2048 || Number(value) % 8)) throw new Error('WebUI 尺寸须为宽x高，每边 64–2048 且为 8 的倍数')
  }
  if (id === 'novelai') {
    // Prompt controls accept a full permutation only; partial or duplicated
    // orders would silently drop sections from the assembled caption.
    if (result.promptOrder) {
      const order = result.promptOrder.split(',').map(section => section.trim()).filter(Boolean)
      if (order.length !== NOVELAI_BASE_SECTIONS.length || new Set(order).size !== order.length || order.some(section => !NOVELAI_BASE_SECTIONS.includes(section))) throw new Error('promptOrder 须为 quality,scene,style,artist 的完整排列')
    }
    if (result.sectionWeights) {
      const weights = result.sectionWeights.split(',').map(weight => weight.trim()).filter(Boolean)
      if (weights.length > NOVELAI_BASE_SECTIONS.length) throw new Error('sectionWeights 数量不能超过 4')
      if (weights.some(weight => !/^\d+(\.\d+)?$/.test(weight) || Number(weight) <= 0)) throw new Error('sectionWeights 须为正数，例如 1.5,1,1,0.75')
    }
    if (result.useOrder) {
      if (!['true', 'false'].includes(result.useOrder.toLowerCase())) throw new Error('useOrder 须填 true 或 false')
      result.useOrder = result.useOrder.toLowerCase()
    }
    if (result.seed && (!/^\d+$/.test(result.seed) || Number(result.seed) > 0xFFFFFFFF)) throw new Error('种子须为 0–4294967295 的非负整数')
    // Official presets stay opt-in: 'none' keeps the prompt the user typed alone.
    result.qualityPreset = (result.qualityPreset || 'none').toLowerCase()
    if (!NOVELAI_QUALITY_PRESETS.includes(result.qualityPreset)) throw new Error('官方质量词预设只能选择 none、light 或 standard')
    result.ucPreset = (result.ucPreset || 'none').toLowerCase()
    if (!NOVELAI_UC_PRESETS.includes(result.ucPreset)) throw new Error('官方负面预设只能选择 none、light、heavy 或 human-focus')
    if (result.imageStrength) {
      if (!/^\d+(?:\.\d+)?$/.test(result.imageStrength) || Number(result.imageStrength) > 1) throw new Error('图片参考强度须为 0–1 的数值')
      result.imageStrength = String(Number(result.imageStrength))
    }
    result.sampler ||= 'k_euler_ancestral'
    if (!NOVELAI_SAMPLERS.includes(result.sampler)) throw new Error('请选择有效的 NovelAI 采样器')
    if (result.sampler === 'ddim_v3' && result.model.startsWith('nai-diffusion-5')) throw new Error('V5 不支持 DDIM 采样器，请换用其他采样器')
    result.noiseSchedule ||= 'karras'
    if (!NOVELAI_NOISE_SCHEDULES.includes(result.noiseSchedule)) throw new Error('请选择有效的 NovelAI 噪声表')
    if (result.cfgRescale) {
      if (!/^\d+(?:\.\d+)?$/.test(result.cfgRescale) || Number(result.cfgRescale) > 1) throw new Error('CFG Rescale 须为 0–1 的数值')
      result.cfgRescale = String(Number(result.cfgRescale))
    }
    if (result.varietyBoost && !['true', 'false'].includes(result.varietyBoost)) throw new Error('Variety Boost 须为开启或关闭')
    Object.assign(result, novelaiEndpoints(value.endpoints, result.endpoint, result.baseURL), novelaiArtists(value))
    if (result.activeArtist && !result.artists.some(artist => artist.id === result.activeArtist)) result.activeArtist = ''
    novelaiSettings(result)
  }
  if (id === 'comfyui') {
    result.workflow = comfyWorkflow(value.workflow)
    for (const field of IMAGE_ADVANCED_FIELDS) if (result[field] && !result.workflow?.bindings[field === 'negativePrompt' ? 'negative' : field]?.length) throw new Error('工作流缺少 ' + field + ' 映射，请重新导入支持该参数的工作流或清空该设置')
  }
  return result
}
export function imageCredentialRef(provider = 'openai', authType) {
  sceneImageChannel(provider)
  if (['webui', 'comfyui'].includes(provider) && authType === 'basic') return 'DSH_TAVERN_IMAGE_' + provider.toUpperCase() + '_PASSWORD'
  return provider === 'openai' ? 'DSH_TAVERN_IMAGE_API_KEY' : 'DSH_TAVERN_IMAGE_' + provider.toUpperCase() + '_API_KEY'
}
export function channelNeedsKey(config) { return config.provider !== 'dsh-image-gen' && (!['webui', 'comfyui'].includes(config.provider) || config.authType !== 'none') }
export function channelReady(config, hasKey) {
  if (config.provider === 'dsh-image-gen') return config.pluginReady === true
  return Boolean(config.baseURL && (config.provider === 'comfyui' ? config.workflow : config.provider === 'webui' || config.model) && (!channelNeedsKey(config) || hasKey) && (config.authType !== 'basic' || config.username))
}
export function imageExpressionProfile(config) {
  if (config.provider === 'comfyui') return 'scene-tags-v1:comfyui:' + (config.workflow?.digest || 'unconfigured')
  // Preserve old OpenAI plans while isolating other protocol/model expressions.
  return config.provider === 'openai' || !config.provider ? 'scene-tags-v1:' + config.model : 'scene-tags-v1:' + config.provider + ':' + (config.model || 'server-default')
}
export function imageExpressionGuidance(config) {
  if (config.provider !== 'novelai') return undefined
  return 'NovelAI：tags 优先用简洁英文绘图标签，必要关系用短英文句子。人物外貌、服装、动作、表情、位置只放各自的人物块，不在 scene 中重写。scene 只放人数、环境、镜头和关系；人数与性别须有依据，不猜测。V4/V4.5/V5 会分开提交角色描述，人数标签如 2girls 放 scene，单个人物只写 girl/boy/other，不写 1girl，不使用 | 人物分隔语法。保留稳定身份与事实，只转换表达。'
}

/** The picture's own orientation turns a configured WxH size or W:H ratio
 * around, keeping its resolution. Square settings and named sizes (1K, 2K)
 * stay as configured; so does everything when the user fixed the orientation. */
export function orientedChannelSettings(config, input = {}) {
  const orientation = input.style?.orientation === 'fixed' ? '' : input.plan?.orientation
  if (!['portrait', 'landscape'].includes(orientation)) return config
  const turn = (width, height) => orientation === 'portrait' ? width > height : width < height
  const result = { ...config }
  const size = typeof config.size === 'string' && config.size.match(/^(\d+)([x*])(\d+)$/)
  if (size && turn(Number(size[1]), Number(size[3]))) result.size = size[3] + size[2] + size[1]
  const ratio = typeof config.aspectRatio === 'string' && config.aspectRatio.match(/^(\d+):(\d+)$/)
  if (ratio && turn(Number(ratio[1]), Number(ratio[2]))) result.aspectRatio = ratio[2] + ':' + ratio[1]
  return result
}
/** Negative tags the picture itself asks for, added after the configured ones. */
export function imageNegativePrompt(configured, input = {}) {
  const extra = typeof input.plan?.negative === 'string' ? input.plan.negative.trim() : ''
  return [configured || '', extra].filter(Boolean).join(', ')
}

export function imageChannelRequest(input) {
  const config = orientedChannelSettings(channelSettings(input), input)
  const references = input.referenceImages || []
  const capability = imageReferenceCapability(config)
  if (!Array.isArray(references) || references.length && (!capability.supported || references.length > capability.maxImages)) throw new Error('当前渠道不支持所选参考图，未发送请求')
  if (config.provider === 'comfyui') throw new Error('ComfyUI 须通过任务提交与查询流程调用')
  if (!channelReady(config, input.apiKey)) throw new Error('请先配置生图渠道地址、模型与密钥')
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + input.apiKey }
  const prompt = input.prompt
  let path = 'images/generations', body
  if (config.provider === 'novelai' && config.protocol === 'chat') {
    // A bare relay host serves the OpenAI-style API under /v1.
    path = new URL(config.baseURL).pathname.replace(/\/+$/, '') ? 'chat/completions' : 'v1/chat/completions'
    body = novelaiChatRequest(input, config)
  } else if (config.provider === 'novelai') {
    path = 'ai/generate-image'
    body = novelaiRequest(input, config)
  } else if (config.provider === 'webui') {
    path = 'sdapi/v1/txt2img'
    if (config.authType === 'none') delete headers.authorization
    else if (config.authType === 'basic') headers.authorization = 'Basic ' + Buffer.from(config.username + ':' + input.apiKey, 'utf8').toString('base64')
    const [width, height] = config.size.split('x').map(Number)
    body = { prompt, width, height, batch_size: 1, n_iter: 1, seed: -1, send_images: true, save_images: false, ...(imageNegativePrompt(config.negativePrompt, input) ? { negative_prompt: imageNegativePrompt(config.negativePrompt, input) } : {}), ...(config.steps ? { steps: Number(config.steps) } : {}), ...(config.guidance ? { cfg_scale: Number(config.guidance) } : {}) }
  } else if (config.provider === 'gemini') {
    path = 'interactions'; delete headers.authorization; headers['x-goog-api-key'] = input.apiKey
    body = { model: config.model, input: [{ type: 'text', text: prompt }], response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: config.aspectRatio, image_size: config.size } }
    for (const image of references) {
      if (!Buffer.isBuffer(image.data) || !image.data.length || image.data.length > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)) throw new Error('参考图数据不合法')
      body.input.push({ type: 'text', text: 'Identity reference for ' + image.name + ' (identity ' + image.personId + '). ' + (image.description ? 'Identify this person in the reference using these source-image cues: ' + image.description + '. ' : '') + 'Use only this selected person, not other people in the reference. Use only identity/appearance cues. Follow the written scene for clothing, pose, expression, placement and background; do not copy the old composition or outfit.' },
        { type: 'image', mime_type: image.mediaType, data: image.data.toString('base64') })
    }
  } else if (config.provider === 'banana') {
    path = 'chat/completions'
    body = { model: config.model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], size: config.size, stream: false }
  } else if (config.provider === 'qwen') {
    if (!config.model.startsWith('qwen-image')) throw new Error('百炼渠道当前只接入 Qwen-Image，不支持其他万相模型')
    path = 'services/aigc/multimodal-generation/generation'
    body = { model: config.model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { size: config.size, n: 1, prompt_extend: false, ...(imageNegativePrompt(config.negativePrompt, input) ? { negative_prompt: imageNegativePrompt(config.negativePrompt, input) } : {}) } }
  } else if (config.provider === 'grok') {
    if (!['1k', '2k'].includes(config.size)) throw new Error('Grok 分辨率须为 1k 或 2k')
    body = { model: config.model, prompt, n: 1, aspect_ratio: config.aspectRatio, resolution: config.size }
  } else if (config.provider === 'seedream') {
    body = { model: config.model, prompt, size: config.size, sequential_image_generation: 'disabled', stream: false, response_format: 'url' }
  } else body = { model: config.model, prompt, size: config.size, n: 1 }
  return { url: new URL(path, config.baseURL.replace(/\/+$/, '') + '/').href, headers, body }
}

/** Only image-bearing fields count as results, never a thought or arbitrary link. */
export function channelImageResult(provider = 'openai', payload) {
  if (provider === 'webui') {
    const data = payload?.images?.[0]
    return typeof data === 'string' ? data.startsWith('data:') ? { url: data } : { b64_json: data } : undefined
  }
  if (provider === 'gemini') {
    const direct = payload?.output_image
    const parts = (Array.isArray(payload?.steps) ? payload.steps : []).filter(step => step?.type === 'model_output').flatMap(step => Array.isArray(step.content) ? step.content : [])
    const image = typeof direct?.data === 'string' ? direct : parts.find(part => part?.type === 'image' && typeof part.data === 'string')
    return image ? { b64_json: image.data } : undefined
  }
  if (provider === 'qwen') {
    if (payload?.code) throw new Error('百炼未生成图片，请检查模型、地域和账号配置')
    const parts = payload?.output?.choices?.[0]?.message?.content
    const image = Array.isArray(parts) ? parts.find(part => typeof part?.image === 'string') : undefined
    return image ? { url: image.image } : undefined
  }
  if (provider === 'novelai') {
    // Conversation generation: the reply text holds a Markdown image or a bare link.
    const text = String(payload?.choices?.[0]?.message?.content ?? '')
    const url = text.match(/!\[[^\]]*\]\(((?:https?:\/\/|data:image\/[^;]+;base64,)[^\s)]+)\)/)?.[1] || text.match(/https?:\/\/[^\s)\]"'<>]+/)?.[0]
    if (url) return { url }
    const error = new Error(text.trim() ? '中转站没有返回图片链接：' + text.trim().slice(0, 200) : '中转站没有返回图片链接')
    throw error
  }
  if (provider === 'banana') {
    const message = payload?.choices?.[0]?.message
    const parts = [message?.content, message?.images, message?.reasoning_details?.images].filter(Array.isArray).flat()
    const image = parts.find(part => part?.type === 'image_url' && part.image_url)
    if (image) return { url: typeof image.image_url === 'string' ? image.image_url : image.image_url.url }
    if (typeof message?.content === 'string') {
      const url = message.content.match(/!\[[^\]]*\]\(((?:https?:\/\/|data:image\/[^;]+;base64,)[^\s)]+)\)/)?.[1]
      if (url) return { url }
    }
    return undefined
  }
  const images = payload?.data || payload?.images || payload?.output
  return Array.isArray(images) ? images[0] : undefined
}
