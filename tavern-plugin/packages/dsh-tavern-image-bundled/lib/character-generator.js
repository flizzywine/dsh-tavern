import { randomUUID } from 'node:crypto'

/**
 * 角色批量生成器：以卡片里的角色为原型，批量产出完整角色设定
 * （traits 正面/背面 × SFW/NSFW 分块 + 服装），支持任意年龄段与 NSFW。
 *
 * 纯函数，不依赖 LLM / 磁盘，方便单测。
 * 与 outfit-generator 的分工：那边管「给已有角色加衣服」，这边管「造角色 + 连带造衣服」。
 */

/** 角色的 traits 分块字段，顺序即提示词里的顺序。 */
export const TRAIT_BLOCKS = [
  ['feature', '角色特征（气质与画风，不写年龄）'],
  ['face', '正面五官：眼睛、鼻子、嘴唇、脸型、发型正面'],
  ['faceBack', '背面头部：后脑勺、发型背面、耳朵背面、颈后'],
  ['bodySFW', '有衣物时正面身体：身高、体型、肩、胸廓、手臂、腿型'],
  ['bodySFWBack', '有衣物时背面身体：背、肩胛骨、腰、臀、腿背面'],
  ['lowerSFW', '有衣物时下半身正面：腰线、胯、大腿、小腿、脚'],
  ['lowerSFWBack', '有衣物时下半身背面：臀、大腿后侧、小腿、脚踝'],
  ['bodyNSFW', '裸露时正面身体：胸部、锁骨、腹部、腰侧'],
  ['bodyNSFWBack', '裸露时背面身体：背部、脊柱线、腰窝、臀部'],
  ['lowerNSFW', '裸露时下半身正面：胯部、大腿、膝、小腿、脚'],
  ['lowerNSFWBack', '裸露时下半身背面：臀下缘、大腿后侧、膝窝、脚跟'],
  ['negative', '这个角色身上不该出现的东西（绝不写年龄、体型、发色等本体特征）'],
]

export const AGE_BANDS = ['child', 'teen', 'adult']

const AGE_WORDING = {
  child: 'child（未满 18）。年龄段词照实写进外貌块：loli / young girl / petite 这类词该写就写；版型、体型、气质都按这个年龄段写。',
  teen: 'teen（青少年）。年龄段词照实写：teenager / young girl；版型与气质按这个年龄段写。',
  adult: 'adult。年龄段词照实写：young woman / mature woman 等。',
}

function textOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' ? value.trim() : ''
}

function listOf(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean)
  return String(value).split(/[,，、]/).map(s => s.trim()).filter(Boolean)
}

/**
 * 组装「按卡片批量生成角色」的提示词。
 *
 * @param {object} input
 * @param {Array}  [input.prototypes] 卡片里提取出的原型角色（charactersFromCardBook 的结果）
 * @param {string} [input.cardName]   卡片名，仅用于提示
 * @param {string} [input.cardContext] 卡片设定正文（description / personality / scenario 摘要）
 * @param {number} [input.count]      要生成几个角色，1–12
 * @param {string} [input.ageBand]    child / teen / adult
 * @param {number|string} [input.age] 具体年龄或年龄描述（如 14 / "十四五岁"），可空
 * @param {boolean} [input.nsfw]      是否包含 NSFW 分块内容
 * @param {string} [input.preference] 额外偏好（如「古风」「学院」「末世」）
 * @param {Array}  [input.existing]   人物库里已存在的角色（用于避免重名）
 */
export function buildCharacterBatchPrompt({
  prototypes = [],
  cardName = '',
  cardContext = '',
  count = 3,
  ageBand = 'child',
  age = '',
  nsfw = true,
  preference = '',
  existing = [],
} = {}) {
  const safeCount = Math.max(1, Math.min(12, Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 3))
  const safeAge = AGE_BANDS.includes(ageBand) ? ageBand : 'child'
  const ageText = textOf(age) || (safeAge === 'child' ? '未满 18' : safeAge === 'teen' ? '青少年' : '成年')
  const existingNames = (Array.isArray(existing) ? existing : []).map(c => textOf(c?.name)).filter(Boolean)

  const protoLines = []
  for (const proto of (Array.isArray(prototypes) ? prototypes : []).slice(0, 12)) {
    const name = textOf(proto?.name)
    if (!name) continue
    const look = textOf(proto?.traits?.feature) || textOf(proto?.traits?.face) || ''
    protoLines.push('- ' + name + (look ? '：' + look.slice(0, 160) : ''))
  }

  const blockLines = TRAIT_BLOCKS.map(([key, hint]) => '- `' + key + '`：' + hint)

  const system = [
    '你是角色设定师，为一部虚构作品批量创建角色，输出严格的 JSON 数组。',
    '',
    cardName ? '来源卡片：' + cardName : '来源卡片：（未指定）',
    cardContext ? '卡片设定摘要：\n' + cardContext.slice(0, 3000) : '',
    '',
    protoLines.length
      ? '卡片里已有的角色（作为同世界的风格参照，不要照抄，也不要重名）：\n' + protoLines.join('\n')
      : '卡片里没有可参照的角色，按卡片的题材与氛围自行定风格。',
    '',
    '要求：',
    '- 数量：' + safeCount + ' 个角色',
    '- 年龄：**' + ageText + '**。' + AGE_WORDING[safeAge],
    '- 类型：' + (nsfw
      ? '**每个角色都要写 NSFW 分块**（bodyNSFW / bodyNSFWBack / lowerNSFW / lowerNSFWBack），内容具体，与 SFW 分块同样是英文 Tag。'
      : '只写 SFW 分块，NSFW 分块留空字符串。'),
    '- 偏好：' + (textOf(preference) || '无特别偏好，按卡片题材发挥'),
    '- 名字不重复' + (existingNames.length ? '，且不要与人物库已有角色重名：' + existingNames.join('、') : ''),
    '- 每个角色都要有独立的气质，不要 N 个都是同一种',
    '- 每个角色额外产出 2–4 套服装（字段见下）',
    '',
    '## 角色的 traits 分块（全部英文 Tag，逗号分隔）',
    ...blockLines,
    '',
    '### traits 硬规则',
    '- **年龄段词必须写进 `face`、`faceBack`、`bodySFW`、`bodySFWBack` 四处**（正背面都要，因为一张图只调其中一面）',
    '- **`negative` 里绝对不能出现年龄词**（loli / child / young girl / flat chest / petite），也不能写发色体型等本体特征——那会把角色特征压掉',
    '- `feature` 只写气质与画风（innocent / seductive / cold / gentle / ethereal …），不写年龄',
    '- 正面只写正面看得见的部位，背面只写背面看得见的部位，不许互相串',
    '',
    '## 服装字段（每个角色 2–4 套）',
    '- `name` 中文名（如「校服」「夏日便装」）',
    '- `upper` / `lower` / `shoes` 英文 Tag，必填',
    '- `accessory` / `full` /  `back` / `negative` 可空',
    '- `nsfw` 只用于私密场景时 true' + (nsfw ? '' : '（本次不要 nsfw 服装）'),
    '- `default` 最多一套 true',
    '',
    '输出格式：只输出 JSON 数组，不要解释文字、不要 markdown 围栏：',
    '[{"name":"林小满","match":"Lin Xiaoman, 小满","traits":{"feature":"innocent, curious","face":"black hair, twin tails, ((amber eyes)), petite, young girl","faceBack":"black hair, twin tails, nape, petite, young girl","bodySFW":"slim, small frame, young girl","bodySFWBack":"narrow back, young girl","lowerSFW":"slim legs","lowerSFWBack":"slim legs, ankles","bodyNSFW":"flat chest, bare shoulders","bodyNSFWBack":"smooth back","lowerNSFW":"slim thighs","lowerNSFWBack":"slim thighs","negative":""},"outfits":[{"name":"校服","upper":"white sailor blouse","lower":"pleated navy skirt","shoes":"black mary janes","accessory":"red ribbon","full":"school uniform","back":"","negative":"","nsfw":false,"default":true}]}]',
  ].filter(Boolean).join('\n')

  return {
    system,
    text: '请生成 ' + safeCount + ' 个角色，年龄 ' + ageText + (textOf(preference) ? '，偏好：' + textOf(preference) : '') + '。',
    count: safeCount,
    ageBand: safeAge,
    age: ageText,
    nsfw: Boolean(nsfw),
  }
}

/** 从模型输出里抠 JSON 数组，容忍围栏与废话。 */
function extractJsonList(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = []
  if (fenced) candidates.push(fenced[1])
  candidates.push(raw)
  const bracket = raw.indexOf('[')
  if (bracket >= 0) candidates.push(raw.slice(bracket))
  for (const candidate of candidates) {
    const trimmed = String(candidate).trim()
    if (!trimmed) continue
    try { return JSON.parse(trimmed) } catch {}
    const cut = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'))
    if (cut > 0) { try { return JSON.parse(trimmed.slice(0, cut + 1)) } catch {} }
  }
  return null
}

function normalizeTraits(raw) {
  const traits = {}
  for (const [key] of TRAIT_BLOCKS) traits[key] = textOf(raw?.[key])
  return traits
}

function normalizeOutfits(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  let hasDefault = false
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const name = textOf(item.name)
    if (!name || seen.has(name)) continue
    if (!textOf(item.upper) && !textOf(item.lower)) continue
    seen.add(name)
    const isDefault = item.default === true && !hasDefault
    if (isDefault) hasDefault = true
    out.push({
      id: 'o-' + randomUUID().slice(0, 8),
      name,
      upper: textOf(item.upper),
      lower: textOf(item.lower),
      shoes: textOf(item.shoes),
      accessory: textOf(item.accessory),
      full: textOf(item.full),
      back: textOf(item.back),
      negative: textOf(item.negative),
      nsfw: item.nsfw === true,
      enabled: true,
      default: isDefault,
    })
  }
  return out
}

/**
 * 把模型输出解析成角色数组。
 * 只保留结构完整的角色（有名字 + 至少一个 traits 块非空）。
 */
export function parseCharacters(text) {
  const parsed = extractJsonList(text)
  const list = Array.isArray(parsed) ? parsed
    : parsed && Array.isArray(parsed.characters) ? parsed.characters
      : parsed && typeof parsed === 'object' ? [parsed] : []

  const characters = []
  let dropped = 0
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') { dropped++; continue }
    const name = textOf(item.name)
    if (!name || name.length > 20 || seen.has(name)) { dropped++; continue }
    const traits = normalizeTraits(item.traits)
    const filled = TRAIT_BLOCKS.filter(([key]) => traits[key]).length
    if (!filled) { dropped++; continue }
    seen.add(name)
    const aliases = listOf(item.match)
    characters.push({
      id: 'card-' + randomUUID().slice(0, 12),
      enabled: true,
      name,
      match: aliases.length ? aliases.join(', ') : name,
      continuity: '',
      note: textOf(item.note),
      inject: {},
      cards: [],
      outfitRefs: [],
      traits,
      outfits: normalizeOutfits(item.outfits),
    })
  }
  return { characters, dropped }
}

/**
 * 年龄词安全检查：确保 negative 里没有把角色本体特征（含年龄）写进去。
 * 这是 design-rules.md 的硬规则，写进代码防回归。
 */
const NEGATIVE_FORBIDDEN = [
  'loli', 'child', 'young girl', 'little girl', 'flat chest', 'petite',
  'teen', 'teenager', 'underage', 'kid', 'minor',
]

export function sanitizeNegative(traits) {
  const next = { ...(traits || {}) }
  const negative = textOf(next.negative)
  if (!negative) { next.negative = ''; return next }
  const kept = negative
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(token => !NEGATIVE_FORBIDDEN.some(bad => token.toLowerCase().includes(bad)))
  next.negative = kept.join(', ')
  return next
}

/** 批量生成时钳制：每个请求最多几个角色。 */
export function clampCharacterCount(count, max = 12) {
  const each = Math.max(1, Math.min(12, Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 3))
  return { count: each, max: Math.max(1, Math.min(60, Number.isFinite(Number(max)) ? Math.trunc(Number(max)) : 12)) }
}
