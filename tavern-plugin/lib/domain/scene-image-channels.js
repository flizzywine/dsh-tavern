import { novelaiSettings, novelaiRequest, NOVELAI_MODELS } from './scene-image-novelai.js'
import { comfyWorkflow } from './scene-image-comfy-workflow.js'
import { imageReferenceCapability } from './scene-image-reference.js'

// Protocol presets are versioned here, not inferred by issuing paid probes.
const channels = [
  { id: 'dsh-image-gen', label: 'dsh-image-gen（内置插件）', model: '', pluginProvider: '', aspectRatio: '', size: '', fields: ['model', 'pluginProvider', 'aspectRatio', 'size'], hint: '随 Tavern 安装，无需另装插件。请到设置 → 插件 → Image generation 配置渠道、模型和 Key；此处无需重复填写。目前 Tavern 接入文生图，不含 ComfyUI 或参考图。' },
  { id: 'comfyui', label: 'ComfyUI', baseURL: '', authType: 'none', username: '', fields: ['baseURL', 'authType', 'username'], hint: '使用维护者已部署的服务与工作流。导入 API 工作流或维护者准备的映射文件；不会安装模型、节点或清空共享队列。本机地址指 Tavern 服务器。' },
  { id: 'novelai', label: 'NovelAI / 同协议第三方', baseURL: 'https://image.novelai.net', model: 'nai-diffusion-5-full', size: '832x1216', fields: ['baseURL', 'model', 'size'], hint: '默认使用官方 V5 Full。第三方必须支持相同的 /ai/generate-image 协议与 ZIP 图片响应，不是 OpenAI 兼容地址。' },
  { id: 'openai', label: 'OpenAI / Images 兼容中转', baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2', size: '1024x1024', fields: ['baseURL', 'model', 'size'], hint: '官方可使用默认地址与模型；兼容中转请填写自己的地址和模型。' },
  { id: 'gemini', label: 'Google Gemini 原生', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image', size: '1K', aspectRatio: '1:1', fields: ['baseURL', 'model', 'size', 'aspectRatio'], hint: '使用 Interactions API，不是聊天兼容地址。' },
  { id: 'banana', label: 'Banana / Gemini 聊天兼容中转', baseURL: '', model: '', size: '1K', fields: ['baseURL', 'model', 'size'], hint: '填写支持 chat/completions 生图的中转地址与模型；不自动猜测接口。' },
  { id: 'grok', label: 'Grok Images', baseURL: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', size: '1k', aspectRatio: '1:1', fields: ['baseURL', 'model', 'size', 'aspectRatio'], hint: '使用 Images 接口；图片分辨率为 1k 或 2k。' },
  { id: 'seedream', label: 'Seedream / 火山方舟', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-260128', size: '2K', fields: ['baseURL', 'model', 'size'], hint: '可填账号可用的模型或接入点；关闭组图，每次只请求一张。' },
  { id: 'qwen', label: '百炼 Qwen-Image', baseURL: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-image-3.0', size: '1024*1024', fields: ['baseURL', 'model', 'size'], hint: '默认北京地址。其他地域或工作空间请填写控制台提供的 API 根地址，密钥须属于相同地域。' },
  { id: 'webui', label: 'SD WebUI / Forge', baseURL: '', size: '512x512', authType: 'none', username: '', fields: ['baseURL', 'size', 'authType', 'username'], hint: '使用已开启 API 的 WebUI / Forge 服务，沿用服务端模型与默认采样参数。本机地址指 Tavern 服务器，不是访问页面的手机；不会安装模型或修改服务端全局设置。' }
]
export const SCENE_IMAGE_CHANNELS = channels.map(({ id, label, fields, hint, model }) => ({ id, label, fields, hint, models: id === 'novelai' ? NOVELAI_MODELS : model ? [model] : [], canListModels: ['openai', 'banana', 'gemini', 'grok', 'seedream'].includes(id) }))
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
    if (result[field].length > (field === 'baseURL' ? 2000 : 200)) throw new Error('渠道配置过长')
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
  if (id === 'novelai') novelaiSettings(result)
  if (id === 'comfyui') result.workflow = comfyWorkflow(value.workflow)
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

export function imageChannelRequest(input) {
  const config = channelSettings(input)
  const references = input.referenceImages || []
  const capability = imageReferenceCapability(config)
  if (!Array.isArray(references) || references.length && (!capability.supported || references.length > capability.maxImages)) throw new Error('当前渠道不支持所选参考图，未发送请求')
  if (config.provider === 'comfyui') throw new Error('ComfyUI 须通过任务提交与查询流程调用')
  if (!channelReady(config, input.apiKey)) throw new Error('请先配置生图渠道地址、模型与密钥')
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + input.apiKey }
  const prompt = input.prompt
  let path = 'images/generations', body
  if (config.provider === 'novelai') {
    path = 'ai/generate-image'
    body = novelaiRequest(input, config)
  } else if (config.provider === 'webui') {
    path = 'sdapi/v1/txt2img'
    if (config.authType === 'none') delete headers.authorization
    else if (config.authType === 'basic') headers.authorization = 'Basic ' + Buffer.from(config.username + ':' + input.apiKey, 'utf8').toString('base64')
    const [width, height] = config.size.split('x').map(Number)
    body = { prompt, width, height, batch_size: 1, n_iter: 1, seed: -1, send_images: true, save_images: false }
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
    body = { model: config.model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { size: config.size, n: 1, prompt_extend: false } }
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
