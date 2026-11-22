/**
 * 服装字段与展开规则的唯一一份实现。
 *
 * 角色自带的服装、通用服装库都使用同一套分部位字段：
 *   upper / lower / shoes / accessory / full / back / negative
 * 旧的通用库字段 body / bodyBack / fullBack 只作为读入兼容，
 * 分别映射到 upper 和 back；保存时保留原值，便于旧版本回滚。
 *
 * 宿主侧（lib/index.js、lib/library-prompts.js、lib/library-provider.js、
 * lib/reference-images.js）与浏览器侧（client.js）都用这里的规则，
 * 不要在别处再写第二份字段判断。
 */

/** 逐字段写进提示词的部位，顺序即输出顺序。 */
export const OUTFIT_PART_KEYS = ['upper', 'lower', 'shoes', 'accessory', 'full']
/** 会落盘的服装字段：新字段在前，旧字段仅兼容读入。 */
export const OUTFIT_FIELDS = [...OUTFIT_PART_KEYS, 'back', 'negative', 'body', 'bodyBack', 'fullBack']
/** 旧版通用服装库的字段。 */
export const LEGACY_OUTFIT_FIELDS = ['body', 'bodyBack', 'fullBack']

const PLACEHOLDER = /^(?:none|n\/a|null|undefined|无|没有)$/i
const text = (value) => String(value ?? '').trim()

/**
 * 旧字段 → 统一字段。upper 优先于 body。
 * 背面沿用旧读法：bodyBack（背面上身）与 fullBack（背面整套）都要，按顺序接成一段；
 * 旧版就是这么拼的，只取其中一个会丢掉另一段描述。
 */
export function normalizeOutfitParts(outfit = {}) {
  const source = outfit ?? {}
  const upper = text(source.upper ?? source.body)
  const back = source.back == null ? [source.bodyBack, source.fullBack].map(text).filter(Boolean).join('\n') : text(source.back)
  return { ...source, upper, back }
}

/**
 * 这条服装还要不要写回统一字段：只有旧字段、没有对应新字段时为真。
 * 迁移后新字段有值，条件自然变假，所以每次加载都安全地检查一次即可。
 * shared=true 时按通用库读法把 bodyBack 也算作背面；人物自带服装的 bodyBack 是旧的配饰字段，不参与。
 */
export function needsOutfitMigration(outfit, { shared = false } = {}) {
  const item = outfit ?? {}
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const upperStale = item.upper == null && Boolean(text(item.body))
  const backStale = item.back == null && Boolean(text(item.fullBack) || (shared && text(item.bodyBack)))
  return upperStale || backStale
}

/**
 * 按部位状态取这套衣服这一刻该写的字段。
 * upper / lower 取 'sfw' | 'nsfw' | 'hidden'；back 为真时追加背面字段。
 * dropFootwear 由调用方注入（鞋袜词表在宿主侧），默认不过滤。
 */
export function collectOutfitParts(outfit, options = {}) {
  const item = normalizeOutfitParts(outfit)
  const tags = options.tags ?? (options.mode !== 'natural' && options.mode !== 'structured')
  const level = (value) => {
    const v = String(value ?? '').toLowerCase()
    return v === 'hidden' || v === 'nsfw' ? v : 'sfw'
  }
  const upperPart = level(options.upper)
  const lowerPart = level(options.lower)
  const cropped = options.cropped === true
  const barefoot = options.barefoot === true
  const keepSocks = options.keepSocks === true
  const dropFootwear = typeof options.dropFootwear === 'function' ? options.dropFootwear : (value) => value
  const accept = (value) => {
    const next = text(value)
    return next && !PLACEHOLDER.test(next) ? next : ''
  }
  const parts = []
  for (const field of OUTFIT_PART_KEYS) {
    // 标了 hidden 的部位出了画框、标了 nsfw 的部位露着，对应衣服都不能写。
    if (field === 'shoes' && (lowerPart === 'hidden' || lowerPart === 'nsfw')) continue
    // 只有上下都出框时才连下装一起省掉；只拍上半身照样写下装，否则下摆会画到大腿。
    if (field === 'lower' && (lowerPart === 'nsfw' || (lowerPart === 'hidden' && upperPart === 'hidden'))) continue
    if (field === 'upper' && (upperPart === 'hidden' || upperPart === 'nsfw')) continue
    // full 是整套的总述，任何一个部位裸露或出框都不能再用它。
    if (field === 'full' && (upperPart !== 'sfw' || lowerPart !== 'sfw')) continue
    if (cropped && (field === 'lower' || field === 'shoes' || field === 'full')) continue
    if (barefoot && !keepSocks && field === 'shoes') continue
    // 标签写法里已经有上衣下装时，整套总述只是噪音。
    if (field === 'full' && (tags || options.conciseOutfit) && (text(item.upper) || text(item.lower))) continue
    const value = accept(barefoot ? dropFootwear(item[field], keepSocks) : item[field])
    if (value) parts.push({ field, text: value })
  }
  if (!cropped && options.back === true) {
    const back = accept(item.back)
    if (back) parts.push({ field: 'back', text: back })
  }
  return parts
}

/** 把一套服装按同一套规则拼成一段提示词。 */
export function outfitPromptText(outfit, { mode = 'tags', back = false, upper = 'sfw', lower = 'sfw', cropped = false } = {}) {
  const parts = collectOutfitParts(outfit, { mode, back, upper, lower, cropped })
  return parts.map((part) => part.text).join(mode === 'tags' ? ', ' : '\n')
}
