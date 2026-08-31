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
export function novelaiSettings(config) {
  if (!Object.hasOwn(models, config.model)) throw new Error('NovelAI 请选择已接入的 V5、V4.5、V4 或 Anime V3 模型')
  const dimensions = config.size.match(/^(\d+)x(\d+)$/)
  // The 2048-per-side ceiling is Tavern's local resource guard, not an API claim.
  if (!dimensions || dimensions.slice(1).some(value => Number(value) < 64 || Number(value) > 2048 || Number(value) % 64)) throw new Error('NovelAI 尺寸须为宽x高；本插件支持每边 64–2048 且为 64 的倍数')
  const [width, height] = dimensions.slice(1).map(Number)
  if (width * height > 3145728) throw new Error('NovelAI 图片面积不能超过 3145728 像素')
  return { ...models[config.model], width, height }
}

/** Compile frozen per-person blocks, not current game variables. Image-local
 * adjustments live in blocks; stale person.fields must not override them.
 * Names identify records but aren't repeated as invented visual subjects. */
export function novelaiPrompts(input) {
  const plan = input.plan
  if (!plan || !Array.isArray(plan.blocks)) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000) throw new Error('NovelAI 画面提示词为空或过长')
    return { base: input.prompt, characters: [] }
  }
  const people = plan.people || [], ids = new Set(people.map(person => person.id))
  if (ids.size !== people.length || plan.blocks.some(block => block.owner !== 'scene' && !ids.has(block.owner))) throw new Error('NovelAI 人物方案包含重复或未知人物')
  const characters = people.map(person => ({
    id: person.id,
    caption: plan.blocks.filter(block => block.owner === person.id && block.tags).map(block => block.tags).join(', ')
  }))
  if (characters.some(person => !person.caption)) throw new Error('NovelAI 人物方案缺少人物描述')
  const style = plan.styleOverride?.tags ?? plan.style?.tags ?? ''
  const base = [...plan.blocks.filter(block => block.owner === 'scene' && block.tags).map(block => block.tags), style].filter(Boolean).join(', ')
  if (!base.trim() && !characters.length) throw new Error('NovelAI 画面提示词为空')
  if (base.length + characters.reduce((sum, person) => sum + person.caption.length, 0) > 16000) throw new Error('NovelAI 组合提示词过长')
  return { base: base || characters.length + ' people', characters }
}

export function novelaiRequest(input, config) {
  const { width, height, guidance, characters: limit } = novelaiSettings(config)
  const prompt = novelaiPrompts(input)
  if (limit && prompt.characters.length > limit) throw new Error('当前 NovelAI 模型最多支持 ' + limit + ' 人，请选择 V5 或调整画面')
  const seed = randomInt(0, 0x100000000)
  const captions = prompt.characters.map(person => ({ char_caption: person.caption, centers: [{ x: 0.5, y: 0.5 }] }))
  return {
    input: limit ? prompt.base : [prompt.base, ...prompt.characters.map(person => person.caption)].filter(Boolean).join('\n'),
    model: config.model,
    action: 'generate',
    parameters: {
      params_version: 4, width, height, scale: guidance, steps: 23,
      sampler: 'k_euler_ancestral', noise_schedule: 'karras', n_samples: 1, seed,
      negative_prompt: '', cfg_rescale: 0, dynamic_thresholding: false, legacy: false, legacy_v3_extend: false,
      deliberate_euler_ancestral_bug: false, prefer_brownian: true,
      ...(limit ? {
        use_coords: false, legacy_uc: false,
        v4_prompt: { caption: { base_caption: prompt.base, char_captions: captions }, use_coords: false, use_order: true },
        v4_negative_prompt: { caption: { base_caption: '', char_captions: captions.map(() => ({ char_caption: '', centers: [{ x: 0.5, y: 0.5 }] })) }, legacy_uc: false }
      } : { sm: false, sm_dyn: false })
    }
  }
}
