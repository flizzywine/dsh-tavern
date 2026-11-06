/**
 * 从「卡的设定」导入人物形象。
 *
 * 两个来源：
 *   1. MVU 变量块 <initvar>{ "角色": { 名字: {身份, 性格, 外貌, 身体, 服装} } }</initvar>
 *   2. 卡的 characterBook（世界书）条目：条目名像人名、内容里有外貌描述
 *
 * 输出直接对齐 definitions.json 的 characters 结构，交给 index.js 落盘。
 */

const MAX_TRAIT_LEN = 400

/** 体积词 → 比例词：直接照抄会画成一堆肥肉 */
const BODY_REWRITES = [
  [/[A-Z]罩杯[^，,；;]*/g, '胸型饱满'],
  [/巨乳|大乳|豪乳|爆乳/g, '胸型饱满'],
  [/巨臀|大屁股|肥臀|丰满的臀/g, '臀部圆润'],
  [/小腹(?:微凸|赘肉|柔软)/g, '腰线柔和'],
  [/肉感|赘肉|松垮|松弛/g, '线条紧实'],
  [/腰腹柔软/g, '腰线柔和'],
  [/大腿粗|粗腿/g, '腿线流畅'],
  [/极其丰满|非常丰满/g, '丰满匀称'],
]

export function cleanBody(text) {
  let out = String(text ?? '')
  for (const [re, rep] of BODY_REWRITES) out = out.replace(re, rep)
  // “拥有胸型饱满”这种残留动词去掉，提示词更干净
  out = out.replace(/(拥有|有着|带着|长着)(?=胸型饱满|臀部圆润|线条紧实|丰满匀称|腰线柔和)/g, '')
  out = out.replace(/(^|[，,])\s*拥有(?=[^，,]{0,6}[，,]|$)/g, '$1')
  return out.replace(/[，,]{2,}/g, '，').replace(/^[，,]+|[，,]+$/g, '').trim()
}

/** 40 岁 → 三十出头（插件规则要求整体下压一档，避免画老） */
export function youngifyAge(text) {
  const s = String(text ?? '')
  return s.replace(/(\d{1,3})\s*岁/, (m, n) => {
    const age = Number(n)
    if (!Number.isFinite(age)) return m
    if (age <= 22) return '十八九岁'
    if (age <= 28) return '二十五六岁'
    if (age <= 34) return '二十七八岁'
    if (age <= 42) return '三十出头'
    if (age <= 50) return '三十五岁左右'
    return '四十出头'
  })
}

function clip(value, max = MAX_TRAIT_LEN) {
  return String(value ?? '').trim().slice(0, max)
}

export function splitNameAliases(name) {
  const n = String(name ?? '').trim()
  if (!n) return ''
  // 中文名去掉常见后缀，方便匹配正文里的称呼
  const aliases = new Set([n])
  if (n.length >= 3) aliases.add(n.slice(-2))
  return [...aliases].join(', ')
}

/** 一个 MVU 角色对象 → definitions.characters 条目 */
export function roleToDefinition(name, role = {}) {
  const identity = clip(role.身份 ?? '', 120)
  const persona = clip(role.性格 ?? '')
  const look = clip(role.外貌 ?? '')
  const body = clip(cleanBody(role.身体 ?? ''))
  const wear = role.服装 && typeof role.服装 === 'object' ? role.服装 : null

  const feature = [look, identity ? `身份：${identity}` : ''].filter(Boolean).join('，')

  const outfit = wear ? {
    id: 'o1',
    name: '常服',
    upper: clip(wear.外层 ?? ''),
    lower: '',
    shoes: clip(wear.鞋袜 ?? ''),
    accessory: clip(wear.内衣 ?? ''),
    full: '',
    back: '',
    negative: '',
    enabled: true,
    default: true,
  } : null

  return {
    id: `import-${Buffer.from(String(name)).toString('hex').slice(0, 12)}`,
    enabled: true,
    name: String(name).trim(),
    match: splitNameAliases(name),
    continuity: '',
    note: persona,
    inject: {},
    cards: [],
    outfitRefs: [],
    traits: {
      feature,
      face: look,
      faceBack: '',
      bodySFW: body,
      bodySFWBack: '',
      lowerSFW: '',
      lowerSFWBack: '',
      bodyNSFW: '',
      bodyNSFWBack: '',
      lowerNSFW: '',
      lowerNSFWBack: '',
      negative: '',
    },
    outfits: outfit ? [outfit] : [],
  }
}

/** 从任意文本里抓 <initvar> JSON */
export function parseInitvar(text) {
  const src = String(text ?? '')
  const m = /<initvar>([\s\S]*?)<\/initvar>/i.exec(src)
  if (!m) return null
  const body = m[1].trim()
  try {
    const data = JSON.parse(body)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** MVU 变量对象 → 角色条目数组 */
export function charactersFromVariables(vars) {
  const roles = vars && typeof vars === 'object' ? vars['角色'] ?? vars.characters : null
  if (!roles || typeof roles !== 'object') return []
  return Object.entries(roles)
    .filter(([name, role]) => String(name).trim() && role && typeof role === 'object')
    .map(([name, role]) => roleToDefinition(name, role))
}

/** 卡的世界书条目 → 角色条目（只认像人名的条目） */
export function charactersFromCardBook(card) {
  const entries = card?.characterBook?.entries ?? card?.character_book?.entries ?? card?.data?.character_book?.entries ?? []
  if (!Array.isArray(entries)) return []
  const out = []
  for (const entry of entries) {
    const keys = Array.isArray(entry?.keys) ? entry.keys : []
    const rawName = String(entry?.comment ?? entry?.name ?? keys[0] ?? '').trim()
    const text = String(entry?.content ?? '').trim()
    if (!rawName || !text) continue
    // 方括号/中文方括号开头的是分类条目：[机制] / [地区] / [initvar] / [mvu_update] / 【角色】
    // 它们正文常提到外貌或穿着，会被下面的关键词过滤误判成角色。
    if (/^[\[【]/.test(rawName) && !/^[\[【]\s*角色\s*[\]】]\s*[:：]/.test(rawName)) continue
    // 剥掉前缀，只留真名。前缀可能是嵌套的（仙界人物详情：玖柒），
    // 所以直接取最后一个冒号后面的部分，比枚举前缀稳。
    const colonAt = Math.max(rawName.lastIndexOf('：'), rawName.lastIndexOf(':'))
    const name = (colonAt >= 0 ? rawName.slice(colonAt + 1) : rawName).trim()
    if (!name) continue
    if (!/外貌|外表|长相|容貌|发色|头发|身高|体型|穿着|服装|appearance|hair|wearing/i.test(text)) continue
    // 排除「不是角色」的世界书条目：它们正文里常顺带提到外貌/穿着，会被上面那条误判成角色。
    // 实测：卡里名为「世界观与初始设定」这类条目会被当成角色抓进来，污染生成原型。
    if (/世界观|设定|规则|系统|背景|时间线|地图|事件|列表|目录|说明|玩法|属性|面板|界面|教程|指南|须知|声明|免责|前言|序章|大纲|摘要|索引|附录|统计|数值|公式|算法|提示词|正则|脚本|变量|宏|状态栏|开场白|问候|任务|剧情|结局|选项|指令|格式|示例|模板|术语|称呼|关系|势力|组织|地点|道具|货币|等级|技能|天赋|血脉|境界|功法|修炼|职业|种族|阵营|好感|数值表/i.test(name)) continue
    if (name.length > 12) continue
    // 剥完前缀只剩分类词的也跳过
    if (/^(妖族|仙界|魔道|凡人|人物|角色|其他|杂项|总览|目录|关键人物)$/.test(name)) continue
    const look = clip(text.replace(/\s+/g, ' '), 200)
    out.push({
      id: `card-${Buffer.from(name).toString('hex').slice(0, 12)}`,
      enabled: true,
      name,
      match: keys.length ? keys.join(', ') : name,
      continuity: '',
      note: '',
      inject: {},
      cards: [],
      outfitRefs: [],
      traits: {
        feature: look,
        face: '',
        faceBack: '',
        bodySFW: '',
        bodySFWBack: '',
        lowerSFW: '',
        lowerSFWBack: '',
        bodyNSFW: '',
        bodyNSFWBack: '',
        lowerNSFW: '',
        lowerNSFWBack: '',
        negative: '',
      },
      outfits: [],
    })
  }
  return out
}

// 从「世界书条目的正文」里抠人物：很多卡不写中文「姓名：」，而是 YAML 的 name:/age:/gender:，
// 真名只存在正文里（条目标题往往只是「母后」「姐姐」这种称谓）。
const BODY_PLACE_SUFFIX = /(厅|室|森林|城|宫|殿|塔|岛|港|联盟|协会|工坊|公司|学院|军团|王朝|帝国|战场|街区|小镇|村庄|山|河|湖|谷|洞|酒馆|教堂|神殿|祭坛|商会|公会|派系|势力|组织|家族|军营|要塞|据点|营地|广场|车站|码头|集市|公园|能量|水晶|药剂|道具|武器|装备|货币|技能|魔法|系统|规则|仪式|契约|诅咒|祝福|面纱|法则|训练|管教|惩罚|奖励|制度|体系|计划|阴谋|秘密|传闻|历史|传说)$/
const BODY_VISUAL = /(发|瞳|眼|眉|鼻|唇|脸|皮肤|身高|罩杯|胸|腰|臀|腿|脚|身形|身材|体型|身穿|穿着|衣|裙|鞋|袜|纹身|疤痕)/
const BODY_PLOT = /(丈夫|妻子|女儿|儿子|父亲|母亲|结婚|婚后|去世|离婚|改嫁|工作|公司|集团|俱乐部|组织|开展|暗恋|喜欢|追求|性格|三观|经历|生下|家庭|财政|事业|毕业于|政治|王权|礼法|统治|阴谋|战争)/

/**
 * 从卡内世界书条目的**正文**解析角色（name:/age:/gender: 这类 YAML 键）。
 * 过滤：地名/组织后缀、占位符、信号不足（年龄/性别/外貌至少两项）。
 */
export function charactersFromCardBookBody(card) {
  const entries = card?.characterBook?.entries ?? card?.character_book?.entries ?? card?.data?.character_book?.entries ?? []
  if (!Array.isArray(entries)) return []
  const out = []
  const seen = new Set()
  for (const entry of entries) {
    const text = String(entry?.content ?? '')
    if (text.length < 120) continue
    const nameMatch = /(?:^|\n)\s*(?:name|姓名|名字)\s*[:：]\s*(.+)/i.exec(text)
    if (!nameMatch) continue
    const name = nameMatch[1].split(/[，,（(]/)[0]
      .replace(/^["'“”「」[\]【】\s]+|["'“”「」[\]【】\s]+$/g, '')
      .trim()
    if (!name || name.length > 12) continue
    if (/[{}<>[\]:/\\]/.test(name)) continue
    if (BODY_PLACE_SUFFIX.test(name)) continue
    if (seen.has(name)) continue
    const hasAge = /(?:^|\n)\s*(?:age|年龄)\s*[:：]/i.test(text)
    const hasGender = /(?:^|\n)\s*(?:gender|性别)\s*[:：]/i.test(text)
    const clauses = text.replace(/\s+/g, ' ').split(/[。；;！!？?]/).flatMap(s => s.split(/[，,]/)).map(p => p.trim()).filter(Boolean)
    const visual = clauses.filter(p => BODY_VISUAL.test(p) && !BODY_PLOT.test(p)).join('，').slice(0, 200)
    const signals = (hasAge ? 1 : 0) + (hasGender ? 1 : 0) + (visual ? 1 : 0)
    if (signals < 2) continue
    let ageText = ''
    const outerAge = /外表年龄[^0-9]{0,6}(\d{1,3})\s*岁/.exec(text)
    if (outerAge) ageText = '外表年龄约' + outerAge[1] + '岁'
    else {
      const m = /(?:^|\n)\s*(?:age|年龄)\s*[:：]\s*(.+)/i.exec(text)
      if (m) {
        const n = /(\d{1,3})\s*岁/.exec(m[1])
        ageText = n ? n[1] + '岁' : m[1].trim().slice(0, 24)
      }
    }
    const alias = String(entry?.comment ?? '').replace(/\s+/g, ' ').trim()
    const aliases = [name]
    if (alias && alias !== name && alias.length <= 12 && !/[{}<>[\]]/.test(alias) && !BODY_PLACE_SUFFIX.test(alias)) aliases.push(alias)
    seen.add(name)
    out.push({
      id: `cardbody-${Buffer.from(name).toString('hex').slice(0, 12)}`,
      enabled: true,
      name,
      match: aliases.join(', '),
      continuity: '',
      note: '',
      inject: {},
      cards: [],
      outfitRefs: [],
      traits: {
        feature: [ageText, visual].filter(Boolean).join('，').slice(0, 400),
        face: visual.slice(0, 200),
        faceBack: '',
        bodySFW: visual.slice(0, 160),
        bodySFWBack: '',
        lowerSFW: '',
        lowerSFWBack: '',
        bodyNSFW: '',
        bodyNSFWBack: '',
        lowerNSFW: '',
        lowerNSFWBack: '',
        negative: '',
      },
      outfits: [],
    })
  }
  return out
}

/** 合并：同名更新为空字段，不同名追加 */
export function mergeCharacters(existing, incoming) {
  const list = Array.isArray(existing) ? existing.map(item => ({ ...item })) : []
  const report = { added: [], updated: [], skipped: [] }

  for (const fresh of incoming) {
    const hit = list.find(item => String(item.name ?? '').trim() === fresh.name)
    if (!hit) {
      list.push(fresh)
      report.added.push(fresh.name)
      continue
    }
    let touched = false
    for (const [key, value] of Object.entries(fresh.traits ?? {})) {
      if (!String(hit.traits?.[key] ?? '').trim() && String(value ?? '').trim()) {
        hit.traits[key] = value
        touched = true
      }
    }
    if (!String(hit.match ?? '').trim() && fresh.match) { hit.match = fresh.match; touched = true }
    if (!String(hit.note ?? '').trim() && fresh.note) { hit.note = fresh.note; touched = true }
    if (!(hit.outfits ?? []).length && (fresh.outfits ?? []).length) { hit.outfits = fresh.outfits; touched = true }
    if (touched) report.updated.push(fresh.name)
    else report.skipped.push(fresh.name)
  }
  return { characters: list, report }
}

/** 一次性导入：变量优先，其次卡世界书 */
export function importCharacters({ texts = [], card = null, existing = [] } = {}) {
  const found = []
  for (const text of texts) {
    const vars = parseInitvar(text)
    if (vars) {
      const chars = charactersFromVariables(vars)
      if (chars.length) { found.push(...chars); break }
    }
  }
  if (card) found.push(...charactersFromCardBook(card))
  if (!found.length) return { characters: existing, report: { added: [], updated: [], skipped: [] }, source: 'none' }
  const { characters, report } = mergeCharacters(existing, found)
  return { characters, report, source: found[0].id.startsWith('import-') ? 'variables' : 'cardbook' }
}


/**
 * 世界书（YAML 风格的 NPC 条目）→ 角色库条目。
 * 兼容：
 *   - 姓名: 陈秋月 / 名字: 陈秋月
 *   年龄: 40岁 / 身份关系: 母亲 / 职业: … / 生活地点: … / 简介: …
 */
export function charactersFromWorldbookText(text, options = {}) {
  const src = String(text ?? '')
  if (!src.trim()) return []
  const lines = src.split(/\r?\n/)
  const out = []
  let current = null

  const flush = () => {
    if (!current) return
    const filled = describeFromWikiEntry(current)
    if (filled) out.push(filled)
    current = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const nameMatch = /^[-*•·]?\s*(?:姓名|名字)\s*[:：]\s*(.+)$/.exec(line)
    if (nameMatch) {
      flush()
      current = { name: nameMatch[1].trim().replace(/[，。,]$/, ''), fields: {} }
      continue
    }
    if (!current) continue
    const fieldMatch = /^[-*•·]?\s*(年龄|身份关系|身份|职业|生活地点|简介|外貌|身体|体型|服装|性格|关系)\s*[:：]\s*(.*)$/.exec(line)
    if (fieldMatch) {
      current.fields[fieldMatch[1]] = fieldMatch[2].trim()
      continue
    }
    // 简介常常换行续写
    if (current.fields['简介']) current.fields['简介'] += ' ' + line
  }
  flush()
  return out
}

const APPEARANCE_HINT = /(发|瞳|眼|眉|鼻|唇|脸|皮肤|身高|罩杯|乳|胸|腰|臀|腿|脚|身形|身材|体型|身穿|穿着|衣|裙)/

/** 把一条世界书 NPC 条目变成 definitions 结构 */
function describeFromWikiEntry(entry) {
  const name = String(entry.name ?? '').trim()
  if (!name || name.length > 12) return null
  // 过滤模板占位符与代码残片：<user>、{{char}}、身份: string; 之类
  if (/[<>{}[\]:]/.test(name)) return null
  if (/^[\x00-\x7f]+$/.test(name)) return null
  const f = entry.fields ?? {}
  // 代码残片/占位符条目（身份: string; 之类）直接丢弃
  if (/string|number|boolean|unknown|any\b/.test(String(f['身份关系'] ?? f['身份'] ?? ''))) return null
  const intro = String(f['简介'] ?? '').replace(/\s+/g, ' ').trim()
  const appearanceRaw = [f['外貌'], f['身体'], f['体型'], f['服装'], intro].filter(Boolean).join('，')

  // 只保留"看得见"的长相/身材片段，剔除剧情、家庭、职业经历。
  // 按逗号逐段过滤，避免一句话里出现"性格"就把同句的发型描述一起丢掉。
  const PLOT = /(丈夫|妻子|女儿|儿子|父亲|母亲|结婚|婚后|去世|离婚|猝死|改嫁|工作|公司|集团|俱乐部|组织|开展|关系|暗恋|喜欢|追求|性格|三观|经历|生下|试管|家庭|财政|掌管|事业|毕业于)/
  const clauses = appearanceRaw
    .split(/[。；;！!？?]/)
    .filter(Boolean)
    .flatMap(sentence => sentence.split(/[，,]/))
    .map(part => part.trim())
    .filter(Boolean)
  const visual = clauses
    .filter(part => APPEARANCE_HINT.test(part) && !PLOT.test(part))
    .join('，')
    .slice(0, 220)
  // 体型只挑和身材比例有关的片段，避免把发型重复写进 body
  const BODY_HINT = /(胸|腰|臀|腿|身形|身材|体型|肩|臂|背|皮肤|身高|罩杯|骨|足)/

  const identity = [f['身份关系'] ?? f['身份'], f['职业']].filter(Boolean).join(' · ')
  const age = String(f['年龄'] ?? '').match(/(\d{1,3})\s*岁/)
  const ageText = age ? String(age[0] ?? '') : ''

  const feature = [ageText, cleanBody(visual), identity ? '身份：' + identity : '']
    .filter(Boolean).join('，').slice(0, 400)
  const bodyText = cleanBody(clauses.filter(part => BODY_HINT.test(part) && !PLOT.test(part)).join('，')).slice(0, 160)

  if (!feature && !intro) return null

  return {
    id: `wb-${Buffer.from(name).toString('hex').slice(0, 12)}`,
    enabled: true,
    name,
    match: splitNameAliases(name),
    continuity: '',
    note: String(f['性格'] ?? intro).slice(0, 160),
    inject: {},
    cards: [],
    outfitRefs: [],
    traits: {
      feature,
      face: cleanBody(visual).slice(0, 200),
      faceBack: '',
      bodySFW: bodyText || cleanBody(visual).slice(0, 160),
      bodySFWBack: '',
      lowerSFW: '',
      lowerSFWBack: '',
      bodyNSFW: '',
      bodyNSFWBack: '',
      lowerNSFW: '',
      lowerNSFWBack: '',
      negative: '',
    },
    outfits: (f['服装'] ? [{
      id: 'o1', name: '常服', upper: String(f['服装']).slice(0, 120), lower: '', shoes: '',
      accessory: '', full: '', back: '', negative: '', enabled: true, default: true,
    }] : []),
  }
}


/** 解析模型返回的 JSON（{characters:[...]} 或 [...]）→ 人物库条目 */
export function charactersFromExtraction(raw) {
  const text = String(raw ?? '')
  let data = null
  const tryParse = value => { try { return JSON.parse(value) } catch { return null } }
  data = tryParse(text.trim())
  if (!data) {
    const start = text.search(/[[{]/)
    const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
    if (start >= 0 && end > start) data = tryParse(text.slice(start, end + 1))
  }
  if (!data) return []
  const list = Array.isArray(data) ? data : Array.isArray(data.characters) ? data.characters : []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const name = String(item.name ?? '').trim().slice(0, 12)
    if (!name) continue
    const ageText = String(item.age ?? '').trim()
    const ageNum = Number((ageText.match(/(\d{1,3})/) ?? [])[1])
    const feature = clip([ageText, String(item.feature ?? '').trim(), String(item.identity ?? '')].filter(Boolean).join('，'), 400)
    const body = cleanBody(String(item.body ?? '').trim()).slice(0, 160)
    if (!feature && !body) continue
    out.push({
      id: `ai-${Buffer.from(name).toString('hex').slice(0, 12)}`,
      enabled: true,
      name,
      match: splitNameAliases(name),
      continuity: '',
      note: clip(String(item.note ?? ''), 160),
      inject: {},
      cards: [],
      outfitRefs: [],
      traits: {
        feature,
        face: clip(feature, 200),
        faceBack: '',
        bodySFW: body,
        bodySFWBack: '',
        lowerSFW: '',
        lowerSFWBack: '',
        bodyNSFW: '',
        bodyNSFWBack: '',
        lowerNSFW: '',
        lowerNSFWBack: '',
        negative: '',
      },
      outfits: item.outfit ? [{
        id: 'o1', name: '常服', upper: clip(item.outfit, 120), lower: '', shoes: '',
        accessory: '', full: '', back: '', negative: '', enabled: true, default: true,
      }] : [],
    })
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// 批量生成未成年 NSFW 角色（2026-10-20）
//
// 场景：卡片里可能只有成年角色的设定，但使用者需要一批同世界的未成年角色，
//       并且要带完整的 NSFW 分块（生图时正/背面 × SFW/NSFW 四个视角都要能调）。
//
// 与 youngifyAge 的关系：youngifyAge 是把年龄往成年推的清洗手段（导入旧数据时用），
//       这里是反过来——按使用者指定的年龄段**照实生成**，两者互不影响。
//
// 边界（写死在提示词里，不靠模型自觉）：
//   · 年龄段词必须出现在 face / faceBack / bodySFW / bodySFWBack 四处
//   · negative 里绝不能出现年龄词或本体特征（否则生图时会把角色特征压掉）
// ════════════════════════════════════════════════════════════════════

/** 未成年批量生成支持的年龄段。 */
export const MINOR_AGE_BANDS = ['child', 'teen']

const MINOR_AGE_HINT = {
  child: {
    label: 'child（未满 18）',
    words: 'loli / young girl / petite / small frame',
    body: '体型按这个年龄段写：身高偏矮、骨架小、肩窄、腿细，胸腹按该年龄段的真实体征写。',
  },
  teen: {
    label: 'teen（青少年，未满 18）',
    words: 'teenager / young girl / slim',
    body: '体型按青少年写：正在长开的骨架、偏瘦、四肢修长，胸腹按该年龄段的真实体征写。',
  },
}

/**
 * 组装「从卡片批量生成未成年 NSFW 角色」的提示词。
 *
 * @param {object} input
 * @param {Array}  [input.prototypes]  卡片里已有的角色（同世界风格参照）
 * @param {string} [input.cardName]
 * @param {string} [input.cardContext]
 * @param {number} [input.count]       生成几个，1–12
 * @param {string} [input.ageBand]     child / teen，默认 child
 * @param {string|number} [input.age]  具体年龄或写法，如 14 / "十四五岁"
 * @param {string} [input.preference]  额外偏好
 * @param {Array}  [input.existing]    人物库已有角色（避免重名）
 */
export function buildMinorBatchPrompt({
  prototypes = [],
  cardName = '',
  cardContext = '',
  count = 3,
  ageBand = 'child',
  age = '',
  preference = '',
  existing = [],
} = {}) {
  const band = MINOR_AGE_BANDS.includes(ageBand) ? ageBand : 'child'
  const hint = MINOR_AGE_HINT[band]
  const safeCount = Math.max(1, Math.min(12, Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 3))
  const ageText = String(age ?? '').trim() || (band === 'child' ? '未满 18' : '十四五岁')

  const protoLines = []
  for (const proto of (Array.isArray(prototypes) ? prototypes : []).slice(0, 12)) {
    const name = String(proto?.name ?? '').trim()
    if (!name) continue
    const look = String(proto?.traits?.feature ?? proto?.traits?.face ?? '').trim()
    protoLines.push('- ' + name + (look ? '：' + look.slice(0, 160) : ''))
  }
  const existingNames = (Array.isArray(existing) ? existing : [])
    .map(c => String(c?.name ?? '').trim()).filter(Boolean)

  const system = [
    '你是角色设定师，为一部虚构作品批量创建未成年角色，输出严格的 JSON 数组。',
    '',
    cardName ? '来源卡片：' + cardName : '',
    cardContext ? '卡片设定摘要：' + String(cardContext).slice(0, 3000) : '',
    '',
    protoLines.length
      ? '卡片里已有的角色（同世界的风格参照，不要照抄、不要重名）：' + '\n' + protoLines.join('\n')
      : '卡片里没有可参照的角色，按卡片题材自行定风格。',
    '',
    '## 硬性要求',
    '- 数量：' + safeCount + ' 个角色',
    '- 年龄：**' + ageText + '**，年龄段 ' + hint.label,
    '- 年龄段词照实写，用：' + hint.words,
    '- ' + hint.body,
    '- **每个角色都必须写完整的 NSFW 分块**：bodyNSFW / bodyNSFWBack / lowerNSFW / lowerNSFWBack，用具体的英文 Tag，不要留空、不要写 none',
    '- 名字互不重复' + (existingNames.length ? '，且不要与人物库重名：' + existingNames.join('、') : ''),
    '- 每个角色的气质要独立，不要同质化',
    '- 每个角色附带 2–4 套服装，至少一套 nsfw: true',
    '',
    '## traits 分块（全部英文 Tag，逗号分隔）',
    '- `feature`：气质与画风（innocent / curious / cold / gentle …），**不写年龄**',
    '- `face`：正面五官、脸型、发型正面 + **年龄段词**',
    '- `faceBack`：后脑勺、发型背面、颈后 + **年龄段词**',
    '- `bodySFW`：有衣物时正面身体 + **年龄段词**',
    '- `bodySFWBack`：有衣物时背面身体 + **年龄段词**',
    '- `lowerSFW` / `lowerSFWBack`：下半身正/背面（有衣物）',
    '- `bodyNSFW` / `bodyNSFWBack`：裸露时正/背面身体，要具体',
    '- `lowerNSFW` / `lowerNSFWBack`：裸露时下半身正/背面，要具体',
    '- `negative`：**只能写画面质量类**（bad hands, extra limbs, blurry, lowres）。'
      + '**绝不能**出现年龄词（loli / child / young girl / flat chest / petite）或发色体型等本体特征——'
      + '写进去会在生图时把角色特征直接压掉。',
    '',
    '## 服装字段（2–4 套）',
    '- `name` 中文名；`upper` / `lower` / `shoes` 英文 Tag 必填',
    '- `accessory` / `full` / `back` / `negative` 可空',
    '- `nsfw` 私密场景为 true（至少一套）',
    '- `default` 最多一套 true',
    '',
    '只写角色与服装，不写剧情对白。',
    '输出格式：只输出 JSON 数组，不要解释、不要 markdown 围栏：',
    '[{"name":"林小满","match":"Lin Xiaoman","traits":{"feature":"innocent, curious","face":"black hair, twin tails, ((amber eyes)), petite, young girl","faceBack":"black hair, twin tails, nape, petite, young girl","bodySFW":"small frame, narrow shoulders, young girl","bodySFWBack":"narrow back, young girl","lowerSFW":"slim legs","lowerSFWBack":"slim legs, ankles","bodyNSFW":"flat chest, bare shoulders, collarbone","bodyNSFWBack":"smooth back, spine line","lowerNSFW":"slim thighs, knees","lowerNSFWBack":"slim thighs, hamstrings","negative":"bad hands, extra limbs"},"outfits":[{"name":"校服","upper":"white sailor blouse","lower":"pleated navy skirt","shoes":"black mary janes","accessory":"red ribbon","full":"school uniform","back":"","negative":"","nsfw":false,"default":true},{"name":"私密居家","upper":"thin white camisole, bare shoulders","lower":"cotton underwear","shoes":"barefoot","accessory":"","full":"undressed at home","back":"bare back","negative":"shoes","nsfw":true,"default":false}]}]',
    preference ? '' : '',
    preference ? '## 偏好' : '',
    preference ? String(preference) : '',
  ].filter(Boolean).join('\n')

  return {
    system,
    text: '请生成 ' + safeCount + ' 个 ' + ageText + ' 的角色，每个都带完整 NSFW 分块与服装。'
      + (preference ? '偏好：' + preference + '。' : ''),
    count: safeCount,
    ageBand: band,
    age: ageText,
    nsfw: true,
  }
}

/**
 * 把「批量未成年」的解析结果再收一道：清掉 negative 里的年龄词。
 * 模型偶尔会把 loli / child 写进 negative，那会直接压掉角色特征，必须剔掉。
 */
export function scrubMinorNegatives(characters) {
  const FORBIDDEN = ['loli', 'child', 'young girl', 'little girl', 'flat chest', 'petite', 'teen', 'teenager', 'underage', 'kid', 'minor']
  return (Array.isArray(characters) ? characters : []).map(character => {
    const traits = character?.traits && typeof character.traits === 'object' ? { ...character.traits } : null
    if (!traits) return character
    const negative = String(traits.negative ?? '')
    if (!negative.trim()) return character
    traits.negative = negative
      .split(',')
      .map(token => token.trim())
      .filter(Boolean)
      .filter(token => !FORBIDDEN.some(bad => token.toLowerCase().includes(bad)))
      .join(', ')
    return { ...character, traits }
  })
}
