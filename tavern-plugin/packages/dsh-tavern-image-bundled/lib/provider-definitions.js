const defaults = {
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
export const IMAGE_PROVIDERS = Object.freeze(Object.entries(defaults)
  .filter(([id]) => id !== 'atlascloud')
  .map(([id, [label, baseUrl, model]]) => Object.freeze({ id, label, baseUrl, model })))

export const PROVIDER_DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(defaults).map(([id, values]) => [id, Object.freeze(values)])))
