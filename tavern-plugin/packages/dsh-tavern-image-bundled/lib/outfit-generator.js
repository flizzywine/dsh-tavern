import { randomUUID } from 'node:crypto'

/**
 * 服装库生成器：把「按偏好生成 / 批量生成」提示词与解析逻辑集中在这里，
 * 保持纯函数，方便单独测（不依赖 LLM、不依赖磁盘）。
 *
 * 与 lib/index.js 的分工：
 *   本模块只负责「说什么」和「怎么解析」；
 *   index.js 负责「叫谁去做」（runPlanner）与「写到哪」（definitions.json）。
 */

/** 服装的字段白名单与顺序。解析时只保留这些，多余字段丢掉。 */
export const OUTFIT_FIELDS = [
  'upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'negative',
]

/** 年龄段。未指定时按 adult，不擅自推断年龄。 */
export const AGE_BANDS = ['child', 'teen', 'adult']

const AGE_HINT = {
  child: '年龄段 child（未满 18）：版型、剪裁、配饰按这个年龄段应有的样式写。私密场景服装同样可以生成，只是把年龄差异体现在版型与配饰上。',
  teen: '年龄段 teen（青少年）：日常穿着可以有流行元素与个人风格；私密场景服装同样可以生成。',
  adult: '年龄段 adult：不受版型限制。',
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function listOf(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean)
  return String(value).split(/[,，、|]/).map(s => s.trim()).filter(Boolean)
}

/**
 * 组装生成服装的系统提示与用户输入。
 *
 * @param {object} input
 * @param {object} input.character      角色对象（name / traits / outfits）
 * @param {string} [input.preference]   偏好，如「职场」「夏日」「古风」
 * @param {number} [input.count]        数量，1–12
 * @param {string} [input.ageBand]      child / teen / adult
 * @param {boolean} [input.nsfw]        是否包含私密场景服装
 * @returns {{ system: string, text: string, count: number, ageBand: string, nsfw: boolean }}
 */
export function buildOutfitPrompt({ character, preference = '', count = 3, ageBand = 'adult', nsfw = false, promptMode = 'auto', requirements = '' } = {}) {
  const safeCount = Math.max(1, Math.min(12, Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 3))
  const safeAge = AGE_BANDS.includes(ageBand) ? ageBand : 'adult'
  const name = textOf(character?.name) || '（未命名角色）'
  const traits = character?.traits || {}
  const existing = Array.isArray(character?.outfits) ? character.outfits : []

  const traitLines = [
    ['脸', traits.face], ['背影头部', traits.faceBack],
    ['有衣物时身体', traits.bodySFW], ['裸露时身体', traits.bodyNSFW],
    ['整套兜底', traits.fullSFW], ['整套裸露兜底', traits.fullNSFW],
  ].map(([label, value]) => textOf(value) ? `- ${label}：${textOf(value)}` : '').filter(Boolean)

  const existingNames = existing.map(o => textOf(o?.name)).filter(Boolean)
  // 人物外貌是中文写的（给 MOSS 这类读中文整句的模型用）：服装也要中文整句，格式照人物库现有的来。
  // 外貌是英文 Tag 的角色照旧出英文 Tag。
  const chinese = promptMode === 'chinese' || (promptMode !== 'tags' && /[\u3400-\u9fff]/.test([traits.face, traits.bodySFW].map(textOf).join('')))
  const customRequirements = textOf(requirements)
  // 已有服装当风格参考：时代背景（古风 / 现代）、写法和颜色习惯都照它们来。
  const samples = existing.filter(o => o && o.enabled !== false && (textOf(o.upper) || textOf(o.lower))).slice(0, 3)
    .map(o => '- ' + textOf(o.name) + '：' + [o.upper, o.lower, o.shoes].map(textOf).filter(Boolean).join('；'))

  const system = [
    '你是角色服装设计师，为一个虚构角色设计成套的服装，输出严格的 JSON 数组。',
    '',
    '角色：' + name,
    traitLines.length ? '外貌（来自人物库，不要改写）：' : '外貌：未填写，服装照样设计，不要凭猜测补外貌。',
    ...traitLines,
    '',
    '要求：',
    '- 数量：' + safeCount + ' 套',
    '- 偏好：' + (textOf(preference) || '不指定，按角色调性自由发挥'),
    '- 年龄段：' + AGE_HINT[safeAge],
    '- 类型：' + (nsfw
      ? '包含私密场景服装：需要时给 nsfw 标 true；也可以同时给几套日常服装'
      : '只要日常可穿的 sfw 服装，不要 nsfw'),
    '- name 全部不重复' + (existingNames.length ? '，且不要与已有服装重名：' + existingNames.join('、') : ''),
    '- 造型线索不重复：至少要换掉 upper 或 lower 之一',
    '- 覆盖不同场合：日常 / 正式 / 居家 / 户外 / 季节',
    '',
    ...(samples.length ? ['这个角色已有的服装（时代背景、写法和用色照这些来，新衣服不要和它们重样）：', ...samples] : []),
    '',
    ...(chinese ? [
      '每套服装的字段（全部用中文完整短句，画图模型读中文整句，不认英文 Tag）：',
      '- name       简短好记的名称；可以使用括号补充款式或季节信息',
      '- upper      上身，以「上身穿着」开头，写清颜色、面料、领口、袖子（如「上身穿着一件淡蓝色丝绸交领上襦，衬着白色内领，宽袖，袖口绣花」）',
      '- lower      下身，以「下身是」开头，写清颜色、款式、长度（如「下身是一条白色高腰百褶长裙，垂到脚踝」）',
      '- shoes      鞋袜，以「脚上穿着」开头，写清颜色和款式',
      '- accessory  配饰（簪子、耳坠、玉佩、镯子、腰带等），可空',
      '- full       整套一句话总结，如「整体是清雅的江南仕女日常装」，可空',
      '- back       从背后看的样子，如「背后是长长的丝带和裙褶」，可空',
      '- negative   这套不该出现的元素，可空',
      '- nsfw       只用于私密场景时为 true，否则 false',
      '- default    是否常穿，最多一套 true',
      '',
      '写法要求：',
      '- 每一件都要写颜色：没写颜色的衣服，每张图会被画成不一样的颜色。不要只写「素色」「深色」这种含糊的颜色。',
      '- 旗袍、连衣裙、长袍这类连体的衣服：upper 写整件衣服（颜色、领口、袖子），lower 写下摆的长度（如「旗袍的长下摆一直垂到脚踝，裹住双腿」），不要把 lower 空着。',
      '- 不写开衩、裙摆分叉、「露出一截腿」这类会露腿的写法：人一坐下，模型会从开衩里多画出一条腿（实测出现过三条腿）。',
      '- 发型不写进服装（不写「头发束成马尾」「挽成发髻」），发型属于人物外貌；发饰可以写在 accessory。',
      '- 不写否定句（「没有……」「不露……」），画图模型会把否定的东西画出来；要遮住的地方直接写「高立领」「长袖」这样的正面说法。',
    ] : [
      '每套服装的字段：',
      '- name       简短好记的名称；可以使用括号补充款式或季节信息',
      '- upper      上身英文 Tag（white shirt, denim jacket）',
      '- lower      下身英文 Tag（black slacks, pleated skirt）',
      '- shoes      鞋英文 Tag',
      '- accessory  配饰，可空',
      '- full       整套一句话描述，可空',
      '- back       背影专用补充，可空',
      '- negative   这套不该出现的元素，可空',
      '- nsfw       只用于私密场景时为 true，否则 false',
      '- default    是否常穿，最多一套 true',
      '',
      '每一件都要带颜色（white shirt，不写 shirt）。',
    ]),
    '',
    '只写服装本身：面料、版型、颜色、配饰、暴露程度。不要写身体描写，不要写情节，不要写年龄解释。',
    '',
    '输出格式：只输出 JSON 数组，不要任何解释文字、不要 markdown 代码围栏：',
    chinese
      ? '[{"name":"青竹纹素绸襦裙","upper":"上身穿着一件浅青色素绸交领短襦，袖口绣着细竹纹，窄袖","lower":"下身是一条月白色高腰长裙，垂到脚踝","shoes":"脚上穿着浅青色软缎绣鞋","accessory":"腰间系着一条青色丝绦，挂着一枚白玉坠","full":"整体是清爽的夏日常服","back":"背后是垂下的丝绦和裙褶","negative":"","nsfw":false,"default":false}]（这只是格式示例，不要照抄名字和内容）'
      : '[{"name":"常服","upper":"white shirt","lower":"black slacks","shoes":"leather loafers","accessory":"","full":"office attire","back":"","negative":"","nsfw":false,"default":true}]',
  ].join('\n') + [
    customRequirements ? '【用户自定义服装要求】\n' + customRequirements + '\n优先遵循用户对风格、款式、命名和写法的要求；仍须保留上述 JSON 数组结构、字段、数量和已选语言。' : '',
    '【写法选择】' + (chinese ? '使用中文整句。' : '使用英文绘图 Tag。') + '不得因自定义风格要求切换此语言。',
  ].filter(Boolean).join('\n\n')

  return {
    system,
    text: '请为「' + name + '」生成 ' + safeCount + ' 套服装。' + (textOf(preference) ? '偏好：' + textOf(preference) + '。' : ''),
    count: safeCount,
    ageBand: safeAge,
    nsfw: Boolean(nsfw),
  }
}

/**
 * 从模型输出里抠出服装数组。
 * 容忍 markdown 代码围栏、前后废话、单个对象（不是数组）三种常见偏差。
 *
 * @returns {{ outfits: object[], dropped: number }}
 */
export function parseOutfits(text) {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = []
  if (fenced) candidates.push(fenced[1])
  candidates.push(raw)

  // 兜底：从第一个 [ 或 { 起，配平到结尾
  const bracket = raw.indexOf('[')
  if (bracket >= 0) candidates.push(raw.slice(bracket))
  const brace = raw.indexOf('{')
  if (brace >= 0) candidates.push(raw.slice(brace))

  let parsed = null
  for (const candidate of candidates) {
    const trimmed = String(candidate).trim()
    if (!trimmed) continue
    try { parsed = JSON.parse(trimmed); break } catch {}
    // 去掉尾部多余字符再试一次
    const cut = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'))
    if (cut > 0) { try { parsed = JSON.parse(trimmed.slice(0, cut + 1)); break } catch {} }
  }

  const list = Array.isArray(parsed) ? parsed
    : parsed && Array.isArray(parsed.outfits) ? parsed.outfits
      : parsed && typeof parsed === 'object' ? [parsed] : []

  const outfits = []
  let dropped = 0
  const seenNames = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') { dropped++; continue }
    // 名称原样保留括号内容（季节、款式等可能区分两套服装）。
    const name = textOf(item.name)
    const upper = textOf(item.upper)
    const lower = textOf(item.lower)
    // name 与上下身至少各有一个，否则这套没意义
    if (!name || (!upper && !lower)) { dropped++; continue }
    if (seenNames.has(name)) { dropped++; continue }
    seenNames.add(name)
    const outfit = { id: 'o-' + randomUUID().slice(0, 8), name }
    for (const field of OUTFIT_FIELDS) outfit[field] = textOf(item[field])
    outfit.shoes = textOf(item.shoes)
    outfit.nsfw = item.nsfw === true
    outfit.enabled = true
    outfit.default = item.default === true
    outfits.push(outfit)
  }
  return { outfits, dropped }
}

/**
 * 把新服装并进角色已有的 outfits：
 * - 同名跳过（不覆盖用户改过的）
 * - default 只保留一套
 * - 绝不删除已有服装
 */
export function mergeOutfits(existing, incoming, { keepDefault = true } = {}) {
  const base = Array.isArray(existing) ? existing.slice() : []
  // 只忽略空白；括号内容可能区分季节、款式或用途，不能据此合并。
  const key = v => textOf(v).replace(/\s+/g, '')
  const names = new Set(base.map(o => key(o?.name)).filter(Boolean))
  let added = 0, skipped = 0
  let hasDefault = base.some(o => o && o.default === true)
  for (const outfit of Array.isArray(incoming) ? incoming : []) {
    const name = textOf(outfit?.name)
    if (!name || names.has(key(name))) { skipped++; continue }
    names.add(key(name))
    const next = { ...outfit }
    if (keepDefault && hasDefault) next.default = false
    else if (next.default === true) hasDefault = true
    base.push(next)
    added++
  }
  return { outfits: base, added, skipped }
}

/**
 * 批量生成时钳制每个角色的数量，避免一次请求产出过多。
 * @param {number} count 每个角色要几套（1–12，非法回落 3）
 * @param {number} [maxTotal] 一次批量请求允许的总套数上限（1–60）
 */
export function clampBatchCount(count, maxTotal = 60) {
  const each = Math.max(1, Math.min(12, Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 3))
  const total = Math.max(1, Math.min(60, Number.isFinite(Number(maxTotal)) ? Math.trunc(Number(maxTotal)) : 60))
  return { perCharacter: each, maxTotal: total }
}
