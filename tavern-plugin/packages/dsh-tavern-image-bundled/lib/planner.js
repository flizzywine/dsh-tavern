import { STRUCTURED_PROMPT_GUIDANCE } from './prompt-presets.js'

/**
 * 生图规划：把正文交给"图图"（一个后台模型调用），换回一组 <image> 块。
 *
 * 这一层让前台模型完全不用管图 —— 它只管写正文；配哪几张、插在哪、
 * 用什么提示词，全部由这里另起一次模型调用决定。
 *
 * 规则和输出格式沿用「comfyui 正文生图变量」世界书的约定：
 *   <images><image>
 *     <regex>原文里一字不差的一句话</regex>      ← 图插在这句之后
 *     <title_styled>标题</title_styled>
 *     <Tag_think>画面思考</Tag_think>
 *     <size>分辨率</size>
 *     <prompts>女主姓名, 英文自然语言长句, 句尾Booru标签</prompts>
 *   </image></images>
 */

/** 世界书条目的默认选择：任务规则区（0-19）、思考模式、以及角色/服装库的说明。 */
export const RULE_ENTRY_HINT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 142]

export function worldbookEntries(raw) {
  const inner = raw && typeof raw === 'object' ? Object.values(raw)[0] : null
  const list = inner && typeof inner === 'object' && Array.isArray(inner.entries) ? inner.entries : []
  return list.map((entry, index) => ({
    index,
    comment: String(entry?.comment ?? entry?.name ?? `条目 ${index}`),
    content: String(entry?.content ?? ''),
    length: String(entry?.content ?? '').length,
  }))
}

/**
 * 剥掉"给别的引擎看的"语法，只留给人/模型读的规则正文。
 *
 * 世界书常被 MVU 复用，条目开头会有 {@setvar::生图数量::3-5@}、
 * <system_override> 这类标记 —— 它们是给 Tavern/MVU 的，发给画图规划模型只会干扰，
 * 尤其像"生图数量"这种参数，应该由插件设置说了算，不能被世界书覆盖。
 */
export function stripEngineSyntax(text) {
  let out = String(text ?? '')
  // MVU 的变量赋值：{@setvar::名字::值@} / {@getvar::名字@} / {@setvar:id@}
  out = out.replace(/\{@\s*(?:set|get|add|inc|dec)var[^@]*@\}/gi, '')
  // 别的插件常用的 {{...}} 宏
  out = out.replace(/\{\{[^{}]{0,80}\}\}/g, '')
  // 纯包装标签：<system_override> </system_override> 之类
  out = out.replace(/<\/?(?:system_override|system|override|attention|hint)>/gi, '')
  // 收尾：清掉多余空行
  return out.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 把世界书条目拼成一段规则文本。
 *
 * 开关只有一个：条目自己的 enabled（在世界书 tab 里勾）。
 * 之所以还留 selected 参数，是为了兼容"条目上没有 enabled 字段"的旧数据 ——
 * 那种情况才回退到用 plannerEntries / 默认规则区。
 */
export function rulesFromEntries(entries, selected) {
  const hasEnabled = entries.some(e => e && 'enabled' in e)
  const wanted = Array.isArray(selected) && selected.length ? new Set(selected.map(Number)) : new Set(RULE_ENTRY_HINT)
  const blocks = []
  for (const entry of entries) {
    // enabled 是唯一开关；没有 enabled 字段时才用老的 chosen 列表
    if (hasEnabled) {
      if (entry.enabled === false) continue
    } else if (!wanted.has(entry.index)) continue
    const body = stripEngineSyntax(entry.content)
    if (!body.trim()) continue
    blocks.push(`<!-- ${entry.comment} -->\n${body}`)
  }
  return blocks.join('\n\n')
}

/** 取某个标签里的文字（不区分大小写，非贪婪）。 */
function tagInner(chunk, tag) {
  const hit = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(chunk)
  return hit && hit[1].trim() ? hit[1].trim() : ''
}

const CHARACTER_BLOCK_RE = /<character_(\d+)\b[^>]*>([\s\S]*?)<\/character_\1>/gi

function collectCharacterBlocks(chunk) {
  const list = []
  for (const hit of String(chunk ?? '').matchAll(CHARACTER_BLOCK_RE)) {
    const prompt = tagInner(hit[2], 'prompt')
    if (!prompt) continue
    list.push({ prompt, centers: tagInner(hit[2], 'centers') || tagInner(hit[2], 'center'), uc: tagInner(hit[2], 'uc') || tagInner(hit[2], 'negative') })
  }
  return list
}

// Keep paragraph breaks and indentation: prompts can be structured Chinese prose,
// not only a comma-delimited tag list. Subjects metadata is never image prompt text.
const stripSubjectBlocks = text => String(text).replace(/<subjects\b[^>]*>[\s\S]*?<\/subjects\s*>/gi, '')
const promptBody = text => stripSubjectBlocks(text).replace(/<\/?[a-z][\w-]*[^>]*>/gi, ' ').trim()

function splitPromptsBlock(rawPrompts, wholeBlock = rawPrompts) {
  // Remove routing metadata before every path, including explicit scene and
  // character captions. The fallback may preserve opaque LoRA tokens, never
  // resurrect subjects JSON that was just stripped from the visible scene.
  rawPrompts = stripSubjectBlocks(rawPrompts)
  wholeBlock = stripSubjectBlocks(wholeBlock)
  const inPrompts = collectCharacterBlocks(rawPrompts)
  const inWhole = collectCharacterBlocks(wholeBlock)
  // Inner blocks are a subset of the outer set; dedupe by order and content.
  const characters = inWhole.length ? inWhole : inPrompts
  const explicitScene = tagInner(wholeBlock, 'scene_composition')
  let scene = explicitScene || tagInner(rawPrompts, 'scene_composition')
  if (!scene && characters.length) {
    scene = inPrompts.length
      ? promptBody(String(rawPrompts).replace(CHARACTER_BLOCK_RE, ' '))
      : promptBody(rawPrompts)
  } else if (!scene) {
    scene = promptBody(rawPrompts) || String(rawPrompts).replace(/<\/?scene_composition\b[^>]*>/gi, '').trim()
  }
  return { scene, characters }
}

export function parsePromptsBlock(text) {
  const raw = String(text ?? '')
  return splitPromptsBlock(raw, raw)
}

export function formatPromptsBlock(scene, characters) {
  const lines = ['<scene_composition>' + String(scene ?? '').trim() + '</scene_composition>']
  ;(Array.isArray(characters) ? characters : []).forEach((item, index) => {
    const prompt = String(item?.prompt ?? '').trim()
    if (!prompt) return
    const n = index + 1
    lines.push('<character_' + n + '>', '<prompt>' + prompt + '</prompt>')
    const centers = String(item?.centers ?? '').trim()
    if (centers) lines.push('<centers>' + centers + '</centers>')
    const uc = String(item?.uc ?? '').trim()
    if (uc) lines.push('<uc>' + uc + '</uc>')
    lines.push('</character_' + n + '>')
  })
  return lines.join('\n')
}

/** Merge a model's edited structure with original per-character metadata. */
export function preserveCharacterMetadata(originalText, revisedText, fallbackCharacters = []) {
  const before = parsePromptsBlock(originalText)
  const revised = stripSubjectBlocks(revisedText ?? '')
  const after = /<scene_composition|<character_\d/i.test(revised)
    ? parsePromptsBlock(revised)
    : { scene: revised.replace(/<[^>]+>/g, '').trim(), characters: [] }
  const numberedBlocks = text => [...stripSubjectBlocks(text ?? '').matchAll(CHARACTER_BLOCK_RE)]
    .filter(hit => tagInner(hit[2], 'prompt'))
    .map(hit => ({ number: Number(hit[1]), prompt: tagInner(hit[2], 'prompt'), centers: tagInner(hit[2], 'centers') || tagInner(hit[2], 'center'), uc: tagInner(hit[2], 'uc') || tagInner(hit[2], 'negative') }))
  const originalByNumber = new Map(numberedBlocks(originalText).map(item => [item.number, item]))
  const revisedBlocks = numberedBlocks(revised)
  // If the model returns unnumbered/plain text, keep the source roster as before.
  if (!revisedBlocks.length) {
    return formatPromptsBlock(after.scene || before.scene, before.characters.length ? before.characters : fallbackCharacters)
  }
  const seen = new Set()
  const merged = revisedBlocks.map(item => {
    seen.add(item.number)
    const original = originalByNumber.get(item.number)
    return { number: item.number, prompt: item.prompt, centers: item.centers || original?.centers || '', uc: item.uc || original?.uc || '' }
  })
  for (const item of numberedBlocks(originalText)) {
    if (!seen.has(item.number)) merged.push({ ...item })
  }
  const lines = ['<scene_composition>' + String(after.scene || before.scene).trim() + '</scene_composition>']
  for (const item of merged) {
    lines.push('<character_' + item.number + '>', '<prompt>' + item.prompt + '</prompt>')
    if (item.centers) lines.push('<centers>' + item.centers + '</centers>')
    if (item.uc) lines.push('<uc>' + item.uc + '</uc>')
    lines.push('</character_' + item.number + '>')
  }
  return lines.join('\n')
}

/** Optional reference roster. Omission remains distinct from an explicit empty list. */
function parseImageSubjects(body) {
  if (!/<\/?subjects\b/i.test(body)) return {}
  const starts = [...body.matchAll(/<subjects\b[^>]*>/gi)]
  const ends = [...body.matchAll(/<\/subjects\s*>/gi)]
  const blocks = [...body.matchAll(/<subjects\b[^>]*>([\s\S]*?)<\/subjects\s*>/gi)]
  try {
    if (starts.length !== 1 || ends.length !== 1 || blocks.length !== 1) throw new Error('必须是一个完整且唯一的 subjects 块')
    const value = JSON.parse(blocks[0][1])
    if (!Array.isArray(value)) throw new Error('subjects 必须是 JSON 数组')
    const subjects = value.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('第 ' + (index + 1) + ' 个主体必须是对象')
      for (const key of ['characterId', 'outfitId', 'name']) {
        if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(key + ' 必须是字符串')
      }
      const characterId = String(item.characterId ?? '').trim(), name = String(item.name ?? '').trim()
      if (!characterId && !name) throw new Error('主体需要 characterId，未知人物需要 name')
      const subject = {}
      if (characterId) subject.characterId = characterId
      if (name) subject.name = name
      if (item.outfitId !== undefined) subject.outfitId = item.outfitId.trim()
      return subject
    })
    return { subjects }
  } catch (error) {
    return { subjectsError: '画面主体清单无效：' + error.message }
  }
}

/** Parse complete image blocks only; partial streamed blocks must not be submitted. */
export function parseImagePlan(text) {
  const source = String(text ?? '')
  const images = []
  const blockRe = /<image\b[^>]*>([\s\S]*?)<\/image>/gi
  for (const match of source.matchAll(blockRe)) {
    const body = match[1]
    const pick = (...tags) => tags.map(tag => tagInner(body, tag)).find(Boolean) || ''
    const rawPrompts = pick('prompts', 'prompt') || pick('scene_composition')
    if (!rawPrompts) continue
    const { scene, characters } = splitPromptsBlock(rawPrompts, body)
    if (!scene.trim() && !characters.length) continue
    images.push({
      mount: pick('regex', '挂载文本', 'regex_mount'),
      title: pick('title_styled', 'title'),
      think: pick('Tag_think', 'think'),
      size: pick('size'),
      prompts: scene,
      characters,
      ...parseImageSubjects(body),
    })
  }
  return images
}

/** Parse the planner's explicit automatic image decision and optional story facts. */
export function parsePlannerDecision(text) {
  const source = String(text ?? '')
  // A decision is trustworthy only when there is exactly one closed decision
  // tag and its complete contents are one of the supported values.
  const decisions = [...source.matchAll(/<decision\b[^>]*>([\s\S]*?)<\/decision>/gi)]
  const choice = decisions.length === 1 ? decisions[0][1].trim().toLowerCase() : ''
  const decision = choice === 'draw' || choice === 'skip' ? choice : ''
  const reason = /<reason\b[^>]*>([\s\S]*?)<\/reason>/i.exec(source)?.[1]?.trim() ?? ''
  const updateBlock = /<character_updates\b[^>]*>([\s\S]*?)<\/character_updates>/i.exec(source)?.[1]
  let characterUpdates = []
  let characterUpdatesValid = false
  if (updateBlock) {
    try {
      const parsed = JSON.parse(updateBlock)
      if (Array.isArray(parsed)) { characterUpdates = parsed; characterUpdatesValid = true }
      else if (parsed && Array.isArray(parsed.updates)) { characterUpdates = parsed.updates; characterUpdatesValid = true }
    } catch { /* malformed optional history is ignored; image plan remains usable */ }
  }
  return { decision, reason, characterUpdates, characterUpdatesPresent: Boolean(updateBlock), characterUpdatesValid }
}

/** 人物库备注明确标为「玩家」或 player，且没有否定该标记时，这个角色就是玩家本人。 */
export function isPlayerCharacter(character) {
  const note = String(character?.note ?? '')
    // 否定标签不能因为包含「玩家」/ player 子串而被当作肯定标记。
    .replace(/(?:并不是|并非|不是|非|不属于|不算)\s*玩家/gi, ' ')
    .replace(/\b(?:non[-\s]?player|(?:is\s+)?not\s+(?:a\s+|the\s+)?player|isn['’]?t\s+(?:a\s+|the\s+)?player|no\s+player)\b/gi, ' ')
  const chineseMarker = /^(?:玩家|玩家本人|玩家角色)(?:\s*[（(【\[].*[）)】\]])?\s*[。.!！?？]?$/u.test(note.trim()) ||
    /(?:^|[\s,，;；|/([{（【])(?:身份|角色|标记)\s*[:：=]\s*玩家(?:$|[\s,，;；|/)\]})）】])/u.test(note)
  const englishMarker = /^(?:the\s+)?player(?:\s*[（(【\[].*[）)】\]])?\s*[.!?]?$/i.test(note.trim()) ||
    /\bplayer\s+(?:avatar|character|role)\b/i.test(note) ||
    /\b(?:role|identity|type)\s*[:=]\s*(?:the\s+)?player\b/i.test(note)
  return chineseMarker || englishMarker
}

/**
 * 这张卡自己绑了玩家角色时，没绑卡的全局通用玩家让开（list 已经按卡筛过）。
 * 否则清单里会同时出现两个玩家角色，规划不知道「我」该画成谁。
 */
export function hideGlobalPlayers(list) {
  const usable = Array.isArray(list) ? list : []
  const ownPlayer = usable.some(c => c && c.enabled !== false && isPlayerCharacter(c) && (c.cards ?? []).length)
  return ownPlayer ? usable.filter(c => !(isPlayerCharacter(c) && !(c.cards ?? []).length)) : usable
}

/** 人物库 → 给规划模型的"可用角色"清单（按可见块列，模型好照抄）。 */
const ROSTER_TRAITS = [
  ['feature', '性格气质（据此挑这一刻的表情、神态和动作，不要原样抄进提示词）'],
  ['face', '五官（正面）'],
  ['faceBack', '五官（背面）'],
  ['bodySFW', '上半身SFW'],
  ['bodySFWBack', '上半身SFW背面'],
  ['lowerSFW', '下半身SFW'],
  ['lowerSFWBack', '下半身SFW背面'],
  ['bodyNSFW', '上半身NSFW'],
  ['bodyNSFWBack', '上半身NSFW背面'],
  ['lowerNSFW', '下半身NSFW'],
  ['lowerNSFWBack', '下半身NSFW背面'],
]

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}

const ROSTER_FULL_OUTFITS = 6

// 两个字就能确定是哪类衣服的词；更长的服装名片段（三个字以上，如「包臀裙」）直接按原文匹配。
const GARMENT_WORDS_ZH = ['旗袍', '浴袍', '睡袍', '睡衣', '寝衣', '内衣', '泳装', '泳衣', '礼服', '汉服', '襦裙', '肚兜', '浴衣', '和服', '西装', '皮衣', '热裤', '围裙', '毛衣', '衬衫', '风衣', '大衣', '女仆', '护士', '修女', '水手服', '比基尼', '短裙', '长裙', '瑜伽', '网球']
/**
 * 正文里提到的衣服能对上服装库里哪几套（按服装名里的片段匹配）。
 * 服装多时角色清单只列名字，规划看不到「深V秘书包臀裙」和「酒红色挂脖包臀裙」各是什么样，
 * 正文只写「深色包臀裙」时就挑不出来，只好自己编。对上的几套把完整内容也列出来，让规划按颜色款式挑。
 */
export function outfitsMentioned(outfits, text) {
  const body = String(text ?? '')
  if (!body) return []
  return (outfits ?? []).filter(o => {
    const name = String(o?.name ?? '').replace(/[·・\s]/g, '')
    if (name.length < 2) return false
    if (body.includes(name)) return true
    if (GARMENT_WORDS_ZH.some(word => name.includes(word) && body.includes(word))) return true
    for (let i = 0; i + 3 <= name.length; i++) {
      const piece = name.slice(i, i + 3)
      if (/[裙装衣袍服裤]$/.test(piece) && body.includes(piece)) return true
    }
    return false
  })
}

export function characterRoster(definitions, { fullTraits = false, text = '' } = {}) {
  const blocks = []
  const printedOutfits = []
  for (const character of definitions?.characters ?? []) {
    if (character.enabled === false) continue
    const name = String(character.name ?? '').trim()
    if (!name) continue
    const traits = character.traits ?? {}
    const lines = []
    if (character.referenceImage) lines.push('  有身份参考图（实际图片由插件提供给生图模型；这里仅列可用性，不代表规划模型已看图）')
    if (String(character.consistencyText ?? '').trim()) lines.push('  身份一致性补充：' + clip(character.consistencyText, 700))
    for (const [key, label] of ROSTER_TRAITS) {
      const value = clip(traits[key], fullTraits ? 700 : 110)
      if (value) lines.push('  ' + label + '：' + value)
    }
    const outfits = (character.outfits ?? []).filter(o => o && o.enabled !== false)
    // 同一角色的另一个形态（名字互为前缀）如果服装表完全相同，就不再重复列一遍。
    const signature = outfits.map(o => String(o.name ?? '')).join('|')
    const sameAs = signature && printedOutfits.find(p => p.signature === signature && (name.startsWith(p.name) || p.name.startsWith(name)))
    if (sameAs) lines.push('  服装：与「' + sameAs.name + '」相同，调用时把服装名写在这个形态的宏里')
    else if (outfits.length) {
      printedOutfits.push({ name, signature })
      const describe = o => {
        const bits = [o.upper, o.lower, o.shoes, o.accessory, o.full, o.back].map(v => clip(v, 55)).filter(v => v && !/^(?:none|n\/a|null)$/i.test(v))
        return (o.name || '未命名') + ' = ' + (bits.join(' / ') || '（未填）')
      }
      if (outfits.length <= ROSTER_FULL_OUTFITS) {
        // 「常穿」标在描述后面，免得规划把它当成服装名的一部分抄进宏里。
        lines.push('  服装：' + outfits.map(o => describe(o) + (o.default ? '（这套是常穿）' : '')).join('；'))
      } else {
        // 服装多时只列名字：规划按名字挑，插件展开宏时会自动补上完整描述。
        lines.push('  服装（共 ' + outfits.length + ' 套，只列名字；调用时原样写名字，插件会补全描述）：' + outfits.map(o => o.name || '未命名').join('、'))
        const mentioned = outfitsMentioned(outfits, text).slice(0, 6)
        if (mentioned.length) lines.push('  正文提到的衣服可能是下面这几套（完整内容）：' + mentioned.map(describe).join('；')
          + '\n  注意：这只是正文里的衣服词碰上了这个人衣服库里的衣服，不说明画面里的人是她；先认出是谁，再看是不是这套。'
          + '\n  挑选规则：正文只写了类别（如「换上包臀裙」）时，选颜色、款式最接近的一套，在宏里写它的服装名，整套带上；'
          + '正文明确写到的上衣、下装、鞋袜等单品和这套冲突时（如正文写针织衫、帆布鞋，这套是衬衫、高跟鞋），不要用这套，照正文自己描述，正文没写到的部分沿用当前穿着。')
        const usual = outfits.find(o => o.default)
        if (usual) lines.push('  常穿：' + describe(usual))
      }
    }
    // IDs and reference availability belong on separate lines, never inside a
    // quoted outfit name (the planner must still be able to copy its exact name).
    for (const outfit of outfits) {
      if (!outfit.id && !outfit.referenceImage && !outfit.characterOutfitImage && !String(outfit.consistencyText ?? '').trim()) continue
      lines.push('  服装标识：' + (outfit.name || '未命名') + ' [outfit_id=' + String(outfit.id ?? '') + ']' + (outfit.characterOutfitImage ? '；有角色×服装设定图' : '') + (outfit.referenceImage ? '；有服装参考图' : ''))
      if (String(outfit.consistencyText ?? '').trim()) lines.push('    服装一致性补充：' + clip(outfit.consistencyText, 700))
    }
    if (String(character.formCues ?? '').trim()) lines.push('  形态线索（画面里有这些就是这个形态，宏里写这个形态的名字）：' + clip(character.formCues, 200))
    if (character.current?.outfit) lines.push('  当前穿着（插件之前的记录，可能记错；宏里没写 outfit 时插件会自动用它）：' + clip(character.current.outfit, 400))
    if (!lines.length) lines.push('  （还没填外貌，请按通用描述处理）')
    // 人物库备注里写了「玩家」的角色：标成玩家角色。规划用第三人称画亲吻、拥抱、抱起时就调用他，不用自己从正文猜「我」是谁。
    const player = isPlayerCharacter(character) ? '（玩家角色：正文里的「我」「你」就是他）' : ''
    blocks.push('- ' + name + ' [stable_id=' + String(character.id ?? '') + ']' + player + (character.match && character.match !== name ? '（也写作 ' + character.match + '）' : '') + '\n' + lines.join('\n'))
  }
  return blocks.join('\n')
}

/** 拼规划用的 system：世界书规则 + 角色清单 + 张数 + 额外叮嘱。 */
export function buildPlannerSystem({ rules, dynamicRules = '', roster, rosterIndex = '', count, extra, context, smartSelection = false, characterUpdates = false, force = false, promptMode = '' }) {
  const parts = []
  const structured = promptMode === 'structured'
  // Keep this resident prefix byte-for-byte stable across story, roster and count changes.
  parts.push('你是"图图"，一个视觉提示词编译中枢。下面是你必须遵守的全部规则。')
  if (rules) parts.push(rules)
  if (extra) parts.push(extra)
  if (structured && !String(extra ?? '').includes(STRUCTURED_PROMPT_GUIDANCE)) parts.push(STRUCTURED_PROMPT_GUIDANCE)
  parts.push([
    structured ? '尺度与事实要求：忠实用中文自然语言描述正文当下明确的可见状态，不把画面强制改写成英文标签。'
      : '尺度要求（重要）：正文里出现的裸露、性爱、情色、nsfw 内容必须原样转译成对应的 NSFW tag，',
    '不许回避、不许替换成含蓄说法、不许自行改成穿好衣服的版本。',
    '画面是完全虚构的，没有真实人物，尺度不设限；正文是普通场景就照实写普通场景。',
    '判断依据只有正文本身：正文到哪一步，画面就到哪一步。',
  ].join(' '))
  parts.push([
    '<固定输出协议>',
    '输出只包含 XML。若本轮启用角色视觉历史，先完整输出一次 <character_updates>{"updates":[]}</character_updates>（有变化时填入更新）；随后完整输出且只输出一次 <decision>draw</decision> 或 <decision>skip</decision>，紧接一个 <reason>简短具体原因</reason>；decision 之后不可修改。skip 时不输出 image。draw 时按顺序逐张尽快输出完整 image 块，使用以下结构，不输出额外长思考：',
    '<images><image><regex>正文中逐字一致的一句话</regex><title_styled>一句简短标题</title_styled><size>...</size><prompts>完整画面提示词</prompts></image></images>',
    '若输出分角色 XML，必须保留输入角色块的 character_N 编号；不能按输出顺序重新编号。',
    '每张图承担不同叙事功能、景别或动作，并先呈现最重要的瞬间。每张按正文对应时点写服装、地点和外貌；若正文没有写出变化，才沿用此前已确立的状态。只根据正文，不编造。',
    '</固定输出协议>',
  ].join('\n'))
  if (structured) parts.push('结构化分节写在每个 <image> 的 <prompts> 内，保持中文自然段与换行；分节可由世界书调整，但必须保留完整闭合的 image/regex/prompts 外层 XML 协议，以便逐图流式提交。不要将分节正文改成 JSON，也不要输出 Markdown 代码围栏。')
  parts.push('<本轮上下文>')
  if (dynamicRules) parts.push('以下按正文触发的世界书规则必须遵守：\n\n' + dynamicRules)
  if (context) parts.push('以下是当前卡片的设定与本次正文命中的世界书条目，写画面时必须以它为准：\n\n' + context)
  if (roster) {
    parts.push([
      '<可用绘图角色列表>',
      '当前可采用的绘图角色（出现这些名字时必须按这里的白描写外貌，不要自己编）：',
      roster,
      '</可用绘图角色列表>',
    ].join('\n'))
  }
  if (rosterIndex) parts.push('<其他已知角色索引>\n正文没有明确提到以下人物；此索引仅用于识别称谓和代词，不要为他们补充外貌或安排出场：\n' + rosterIndex + '\n</其他已知角色索引>')
  if (Number(count) === 0) {
    parts.push('<本次任务>\n只做角色视觉历史检查，不生成图片，也不要输出任何 <image> 块。')
  } else if (smartSelection && !force) {
    parts.push('<本次任务>\n你正在判断这一轮是否值得配图，最多生成 ' + count + ' 张；可以选择 0 到 ' + count + ' 张。\n'
      + '如果没有值得单独呈现的视觉瞬间，必须明确输出 <decision>skip</decision><reason>简短具体原因</reason>，并且不要输出任何 <image> 块。\n'
      + '如果值得配图，完整输出一次 <decision>draw</decision> 与 <reason>简短具体原因</reason>，之后决定不可修改，然后输出 1 到 ' + count + ' 个完整 <image> 块。不得为了凑数制造画面。\n'
      + '先呈现正文中最重要的视觉瞬间。多张图必须各有不同叙事功能、景别或动作，并按重要性排序；服装、地点与外貌按各自对应的正文时点描述，正文明确变化时如实反映，未写出变化时沿用该画面正文时点之前最后明确的状态，不能按输出前一张继承状态。只依据正文，不编造事件、道具或事实。每个 image 块尽快完整输出，不要添加冗长思考。\n'
      + '本次的 0 到上限选择优先于世界书里固定图片数量的通用要求。\n'
      + 'image 块严格按上面的格式输出；只输出 XML，不要其他解释。')
  } else {
    parts.push('<本次任务>\n把用户给你的这段正文，转译成 ' + count + ' 张插图。\n'
      + '必须完整输出一次 <decision>draw</decision> 与 <reason>简短具体原因</reason>，随后输出 ' + count + ' 个完整的 <image> 块；decision 一旦输出不可修改。先输出正文中最重要的瞬间，多张图各有不同叙事功能、景别或动作并按重要性排序；服装、地点与外貌按各自对应的正文时点描述，正文明确变化时如实反映，未写出变化时沿用该画面正文时点之前最后明确的状态，不能按输出前一张继承状态。只依据正文，不编造。每个 image 块尽快完整输出，不要添加冗长思考。\n'
      + '本次要求的张数优先于世界书里固定图片数量的通用要求。\n'
      + '宁可每张写得紧凑，也要凑够张数。严格按上面的输出格式返回 <images>...</images>，只输出 XML，不要任何解释。')
  }
  if (characterUpdates) {
    const taskAt = parts.findIndex(part => part.startsWith('<本次任务>'))
    const update = '<角色视觉历史>\n在本次同一份分析中检查正文是否明确叙述了已知人物永久外貌的改变，例如新留疤、永久剪发、失明或永久义肢。只记录正文明确确认的永久变化，不能推测或补充 traits。衣着、姿势、表情、妆容、临时伤痕、场景状态都不是永久外貌更新。只更新可用角色列表中的人物，并复制角色列表的 stable_id。若更新某一字段，输出该字段的完整新描述，并保留该字段里正文未改变的旧事实；不要只写变化片段。先输出 <character_updates>{"updates":[{"id":"stable_id","name":"角色原名","permanent":true,"fields":{"face":"该字段完整的新描述"},"reason":"引用正文明确叙述的永久变化"}]}</character_updates>，无变化时也必须输出空数组。必须在 decision 与任何 image 块之前完整输出这个标签。字段只可用 feature、face、faceBack、bodySFW、bodySFWBack、lowerSFW、lowerSFWBack、bodyNSFW、bodyNSFWBack、lowerNSFW、lowerNSFWBack。'
      + '\n另外记录人物的当前穿着（这不是永久外貌，不要写 permanent）：本段正文写到某个可用角色此刻身上穿着什么（换了衣服，或第一次写到），就在同一个 updates 数组里加一条 {"id":"stable_id","name":"角色原名","current":{"outfit":"完整描述（上衣、下装、鞋袜等身上正穿着的，每件都写颜色，颜色照正文写的来，正文没写才沿用服装库或之前记录里的颜色；角色列表里这个人的外貌是中文写的就用中文，否则用英文，例如 white blouse, light grey trousers, beige apron；只写衣服本身，不写湿了、沾了泥、被水洇出深色、皱了、敞开这类会变的状态）；如果正文只说了类别、你从服装库里挑了一套，就直接写那套的服装名（正文写到的单品和那套冲突时不要用它，照正文写，没写到的部分沿用之前的记录）；全身脱光时写 nude"},"reason":"引用正文"}。'
      + '只写正文明确写到的；手里拿着或放在一旁的衣服不算；衣服临时的状态（湿、脏、洇出水渍、扣子解开、袖子挽起）不记进当前穿着，只在那一张图的宏里写，下一张正文没再提就不写——记进去的话之后每张图都会一直带着；正文没写到穿着就不要输出这一条，插件会沿用之前的记录。正文只说换了衣服、没写换成什么时，从这个角色的服装库里挑一套最符合当时场景的（例如出门挑外出的、睡前挑睡衣、上班挑职场装），current.outfit 写那套的服装名，这一轮之后的画面宏里也写同一个服装名；服装库里没有合适的才沿用之前的记录。画面宏里写 outfit 时：已经确定是服装库里的某一套（包括「当前穿着」里记的服装名），就直接写服装名，不要改写成英文描述；' + (structured
        ? '画面提示词里的衣着描述使用中文自然语言，明确每件衣服的颜色、款式和当刻状态，不要求按逗号拆成标签。character_updates 的英文描述仅供跨格式共用的内部历史记录，不能使 <prompts> 变成英文标签。'
        : '自己描述时按逗号分成单个 tag，每件衣服前面写颜色，例如 burgundy dress, halterneck, bodycon, side slit，不要写成一整句长描述（长句里的颜色模型常常画错）。') + '同一角色的不同形态共用这条记录，写其中一个即可。'
      + '本段正文里有人换了衣服时，current.outfit 写换完之后的穿着；同时这一轮每张 image 里这个人物的宏都必须写 "outfit" 字段，填那张图那一刻身上穿的（换衣之前的画面写换之前的，之后的写之后的），不要留空让插件自动补。'
    parts.splice(taskAt < 0 ? parts.length : taskAt, 0, update)
  }
  return parts.join('\n\n').replace('\n\n<本轮上下文>\n\n', '\n\n<本轮上下文>\n')
}

/** 世界书里的"角色调用 / 服装调用"写法：${"name":"han yuemei","angle":"from front"}$ → 展开成 tag。 */
const CALL_SKIP = new Set(['sfw', 'hidden', 'visible', 'none', 'n/a', 'null', 'undefined', 'negligible', ''])

export function expandCallMacros(text) {
  return String(text ?? '').replace(/\$\{([\s\S]*?)\}\$/g, (_match, body) => {
    const source = String(body ?? '').trim()
    if (!source) return ''
    const picked = []
    try {
      const parsed = JSON.parse('{' + source + '}')
      for (const value of Object.values(parsed)) {
        if (typeof value !== 'string') continue
        const item = value.trim()
        if (!item || CALL_SKIP.has(item.toLowerCase())) continue
        picked.push(item)
      }
    } catch {
      // 不是 JSON 就原样取内容
      const plain = source.replace(/^["']|["']$/g, '').trim()
      if (plain && !CALL_SKIP.has(plain.toLowerCase())) picked.push(plain)
    }
    return picked.join(', ')
  })
}

/**
 * Clean planner prompts for the selected image backend while preserving text for multilingual APIs.
 * context.allowChinese === true 时连 comfyui 后端也不清中文；默认 false，行为与之前完全一致。
 */
export function normalizePrompts(text, definitions, context = {}) {
  let out = expandCallMacros(text)
  // Explicit structured mode opts out of all tag/Comfy cleanup. This is also
  // essential for numbered references and custom paragraph/Markdown layouts.
  if (context === 'structured' || context?.style === 'structured' || context?.promptMode === 'structured') return out.trim()
  // Legacy callers retain the original local-prompt cleanup. Runtime callers pass the
  // selected backend so Chinese-capable image APIs can receive Chinese descriptions.
  const backend = typeof context === 'string' ? context : String(context?.backend ?? '')
  // 开关（默认关闭）：只有调用方明确打开时才跳过中文清理。
  // ComfyUI 只是执行器，编码器由工作流决定 —— Qwen-Image、FLUX.1 Krea(qwen3vl) 这类
  // 中文原生编码器读中文长句更准，但此前没有任何绕过的办法；默认仍按原规则删中文。
  const allowChinese = context?.allowChinese === true
  const shouldCleanChinese = !allowChinese && (!backend || backend.toLowerCase() === 'comfyui')
  if (allowChinese && context?.style === 'natural') {
    // 中文整句写法：单独写在开头或人物句前面的中文名（「殷雪, 画面中的女子是……」）对画面没用，
    // 读中文的模型还可能把它写成画面里的字，去掉。只删确实是人名的那一段（人物库里有这个名字，
    // 或者后面紧跟着「画面中的」人物句），「近景，」「傍晚，」这类画面描述不动。
    const names = new Set((definitions?.characters ?? []).flatMap(c => [c?.name, String(c?.name ?? '').replace(/\s*[（(][^）)]*[）)]\s*$/, ''),
      ...String(c?.match ?? '').split(/[,，]/)]).map(v => String(v ?? '').trim()).filter(v => /^[\u4e00-\u9fa5]/.test(v)))
    const NAME = /([\u4e00-\u9fa5]{2,6}(?:[（(][^）)]{1,8}[）)])?)\s*[,，]\s*/
    out = out.replace(new RegExp('^\\s*' + NAME.source), (m, name, offset, all) => (names.has(name) || all.slice(m.length).startsWith('画面中的')) ? '' : m)
    out = out.replace(/。\s*[。，,]+/g, '。')
    out = out.replace(new RegExp('(^|[。，,；;\\s])' + NAME.source + '(?=画面中的)', 'g'), (m, pre, name) => names.has(name) ? pre : m)
  }
  if (shouldCleanChinese) {
    const hadChinese = /[\u4e00-\u9fa5]/.test(out)
    // A leading Chinese character name is useful for local models only when replaced by its
    // English alias. Keep it untouched for image APIs that accept Chinese descriptions.
    const lead = /^\s*([\u4e00-\u9fa5]{2,6})\s*[,，]\s*/.exec(out)
    if (lead) {
      const known = (definitions?.characters ?? []).find(item => item.name === lead[1])
      const alias = String(known?.match ?? '').split(',')[0].trim()
      out = out.replace(lead[0], alias ? alias + ', ' : '')
    }
    // Remove full Chinese passages as well as CJK punctuation; planners can return an entire
    // scene description in Chinese even when the instruction asks for English.
    out = out.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e\u2018-\u201f\u2026\u2014\u00b7]+/g, ' ')
    out = out.replace(/\s{2,}/g, ' ').trim()
    // 自然语言写法里每个人的外貌是一整句；按逗号全局去重会把两人共有的词（如 fair skin）从后一个人身上删掉。
    const cleaned = context?.style === 'natural' ? out.replace(/^[,\s]+|[,\s]+$/g, '') : dedupeTags(out)
    if (hadChinese && !cleaned) {
      throw Object.assign(new Error('ComfyUI 提示词清理后为空，请改用英文提示词。'), { submissionNotStarted: true })
    }
    return cleaned
  }
  out = out.replace(/\s{2,}/g, ' ').trim()
  return context?.style === 'natural' ? out : dedupeTags(out)
}

/** 去掉权重写法后的 tag 本体：((high ponytail)) / (high ponytail:1.2) / {x} / [x] → high ponytail。 */
function tagBody(tag) {
  return String(tag ?? '').trim()
    .replace(/^-?\d+(?:\.\d+)?::(.+?)::$/, '$1')
    .replace(/:\s*-?\d+(?:\.\d+)?\s*(?=[)\]}]*$)/, '')
    .replace(/^[(\[{]+|[)\]}]+$/g, '')
    .trim().toLowerCase()
}

// 这些 tag 自成一类（人数、视角、尺度），哪怕更长的 tag 里含着同样的词也要保留。
const STANDALONE_TAGS = new Set(['pov', 'solo', 'nude', 'nsfw', 'sfw', 'couple', 'hetero', 'yuri', 'multiple girls', 'multiple boys'])
const tagWords = body => body.split(/[\s_]+/).filter(Boolean).map(w => w === 'clothes' ? 'cloth' : (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))

/**
 * 同一个 tag 只留第一次出现（大小写、权重写法都不算区别：((x)) 和 x 是同一个）。
 * 后面的 tag 如果完全被前面某个更具体的 tag 覆盖（leather boots ← black leather boots、
 * dark blue clothes ← dark blue cloth），也去掉：人物库展开的服装和规划自己补写的衣服常这样重复，
 * 白占提示词长度，颜色写法不同时还会互相打架。
 */
export function dedupeTags(text) {
  const seen = new Set()
  const kept = []
  const keptWords = []
  for (const part of String(text ?? '').split(',')) {
    const tag = part.trim()
    if (!tag) continue
    const body = tagBody(tag) || tag.toLowerCase()
    if (seen.has(body)) continue
    const words = tagWords(body)
    if (!STANDALONE_TAGS.has(body) && words.length && keptWords.some(prev => prev.length >= words.length && words.every(w => prev.includes(w)))) continue
    seen.add(body)
    kept.push(tag)
    keptWords.push(words)
  }
  return kept.join(', ')
}

/** 真正调一次模型，把流式文本收完。 */
export async function runPlanner(llm, { provider, model, system, text, maxTokens = 12000, temperature = 1, signal, onDelta, images, reasoningEffort }) {
  signal?.throwIfAborted()
  if (!llm || typeof llm.stream !== 'function') throw new Error('当前 DSH 没有可用的 llm 服务')
  if (!provider || !model) throw new Error('还没在控制台里选规划用的模型')
  // 图片消息：DSH 的格式是 { type: 'image', attachment: <附件引用> }
  // 之前这个参数根本不存在，导致"看图写 tag"和"参考图设计"都是在瞎编。
  const content = [{ type: 'text', text: String(text ?? '') }]
  for (const item of Array.isArray(images) ? images : []) {
    const ref = item && typeof item === 'object' && item.ref ? item.ref : item
    if (!ref || typeof ref !== 'object') continue
    if (ref.attachment && typeof ref.attachment === 'object') content.push({ type: 'image', attachment: ref.attachment })
    else if (ref.id || ref.mediaType || ref.path) content.push({ type: 'image', attachment: ref })
  }
  // 探针：把本次实际发出的图片消息条数暴露出来（供 /state 读取，验证图片真的发出去了）
  const imageParts = content.filter(part => part && part.type === 'image')
  const callRecord = {
    at: Date.now(),
    provider, model,
    textLen: String(text ?? '').length,
    imageCount: imageParts.length,
    imageShape: imageParts.length ? Object.keys(imageParts[0].attachment ?? {}).slice(0, 8) : [],
    contentTypes: content.map(part => part?.type),
  }
  globalThis.__rphubLastLlmCall = callRecord
  try {
    if (!Array.isArray(globalThis.__rphubLlmCalls)) globalThis.__rphubLlmCalls = []
    globalThis.__rphubLlmCalls.push(callRecord)
    if (globalThis.__rphubLlmCalls.length > 6) globalThis.__rphubLlmCalls.shift()
  } catch {}
  // DSH exposes exact-model capabilities and the official GenerateOptions field
  // is `reasoningEffort`. Only pass a persisted choice when this exact route
  // advertises it; stale choices for another model silently use its default.
  let selectedEffort = ''
  if (reasoningEffort && typeof llm.resolveModelInfo === 'function') {
    try {
      const info = await llm.resolveModelInfo(provider, model, signal)
      if (info?.reasoning?.efforts?.some(item => String(item.id) === String(reasoningEffort))) selectedEffort = String(reasoningEffort)
    } catch { /* if capability lookup is unavailable, retain the DSH default */ }
  }
  const chunks = llm.stream({
    provider,
    model,
    ...(selectedEffort ? { reasoningEffort: selectedEffort } : {}),
    system,
    temperature,
    maxTokens,
    signal,
    messages: [{ role: 'user', content }],
  })
  let output = ''
  let usage = null
  let failure = null
  for await (const chunk of chunks) {
    signal?.throwIfAborted()
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      output += chunk.text
      onDelta?.(chunk.text)
    } else if (chunk.type === 'usage') {
      usage = chunk.usage ?? null
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason ?? {}
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        failure = reason.failure?.message || (reason.kind === 'aborted' ? '规划被取消' : '规划调用失败')
      }
    }
  }
  signal?.throwIfAborted()
  if (failure && !output.trim()) throw new Error(failure)
  return { text: output, usage, failure }
}

/** 解析设计输出的 <人物> / <服装> 块。 */
function fieldOf(body, label) {
  // 允许标签前有 markdown 记号（**中文名称**、- 中文名称、1. 中文名称、# 中文名称）。
  // 标签和冒号之间只允许空白/星号/下划线 —— 否则「上半身SFW」会误匹配「上半身SFW背面」。
  const re = new RegExp('^[ \t>*_\\-#\\d.、)]*' + label + '[ \t*_]*[:：][ \t]*([^\\n]+)', 'm')
  const hit = re.exec(body)
  if (!hit) return ''
  return String(hit[1]).trim().replace(/^\*+|\*+$/g, '').trim()
}

export function parseDesign(text) {
  const source = String(text ?? '')
  const people = []
  for (const match of source.matchAll(/<人物[^>]*>([\s\S]*?)<\/人物>/g)) {
    const body = match[1]
    const person = {
      name: fieldOf(body, '中文名称'),
      match: fieldOf(body, '英文名称'),
      note: fieldOf(body, '角色说明'),
      traits: {
        feature: fieldOf(body, '角色特征'),
        face: fieldOf(body, '五官外貌'),
        faceBack: fieldOf(body, '五官外貌背面'),
        bodySFW: fieldOf(body, '上半身SFW'),
        bodySFWBack: fieldOf(body, '上半身SFW背面'),
        lowerSFW: fieldOf(body, '下半身SFW'),
        lowerSFWBack: fieldOf(body, '下半身SFW背面'),
        bodyNSFW: fieldOf(body, '上半身NSFW'),
        bodyNSFWBack: fieldOf(body, '上半身NSFW背面'),
        lowerNSFW: fieldOf(body, '下半身NSFW'),
        lowerNSFWBack: fieldOf(body, '下半身NSFW背面'),
        negative: fieldOf(body, '负面'),
      },
      outfits: [],
    }
    for (const fit of body.matchAll(/<服装[^>]*>([\s\S]*?)<\/服装>/g)) {
      const inner = fit[1]
      person.outfits.push({
        name: fieldOf(inner, '服装名称') || '服装',
        upper: fieldOf(inner, '上衣'),
        lower: fieldOf(inner, '下装'),
        shoes: fieldOf(inner, '鞋袜'),
        accessory: fieldOf(inner, '配饰'),
        full: fieldOf(inner, '整体'),
        back: fieldOf(inner, '背面'),
        negative: fieldOf(inner, '负面'),
      })
    }
    if (person.name || person.traits.face) people.push(person)
  }

  // 服装块也可能写在 <人物> 外面（规范里就是"人物1 → 人物1的服装 → 人物2 → …"），
  // 靠「归属人」关联到对应角色。这里把没被上面吃掉的服装块补挂上去。
  if (people.length) {
    const inside = people.reduce((n, p) => n + (p.outfits?.length ?? 0), 0)
    for (const fit of source.matchAll(/<服装[^>]*>([\s\S]*?)<\/服装>/g)) {
      const inner = fit[1]
      const item = {
        name: fieldOf(inner, '服装名称') || fieldOf(inner, '名称') || '服装',
        upper: fieldOf(inner, '上衣'),
        lower: fieldOf(inner, '下装'),
        shoes: fieldOf(inner, '鞋袜'),
        accessory: fieldOf(inner, '配饰'),
        full: fieldOf(inner, '整体'),
        back: fieldOf(inner, '背面'),
        negative: fieldOf(inner, '负面'),
      }
      if (!item.name && !item.upper && !item.lower && !item.full) continue
      const owner = fieldOf(inner, '归属人') || fieldOf(inner, '角色')
      const key = String(owner).toLowerCase().replace(/[\s_\-.]/g, '')
      let target = null
      if (key) {
        target = people.find(p => {
          const a = String(p.name ?? '').toLowerCase().replace(/[\s_\-.]/g, '')
          const b = String(p.match ?? '').toLowerCase().replace(/[\s_\-.]/g, '')
          // 前缀/全等而不是 includes：空格标点已剔除，includes 会让短名吃到长名（归属人 li 命中 lina）。
      return (a && (a === key || a.startsWith(key) || key.startsWith(a))) || (b && (b === key || b.startsWith(key) || key.startsWith(b)))
        })
      }
      if (!target && people.length === 1) target = people[0]
      if (!target) continue
      const dup = (target.outfits ?? []).some(o => o.name === item.name)
      if (dup) continue
      target.outfits = (target.outfits ?? []).concat([item])
    }
    // 静默统计，方便排查
    const after = people.reduce((n, p) => n + (p.outfits?.length ?? 0), 0)
    if (after !== inside) {
      // 只在真的补挂了服装时才动
    }
  }
  // 没有 <人物> 包起来时，退一步：整篇里直接找 <服装>。
  // 但必须能定位到归属人，否则会产出"名字和字段全空的角色"污染人物库（曾经因此入库两个空条目）。
  if (!people.length) {
    for (const fit of source.matchAll(/<服装[^>]*>([\s\S]*?)<\/服装>/g)) {
      const inner = fit[1]
      const owner = fieldOf(inner, '归属人')
      const fitName = fieldOf(inner, '服装名称')
      const upper = fieldOf(inner, '上衣')
      if (!owner || (!fitName && !upper)) continue
      people.push({
        name: owner, match: owner, note: '', traits: {}, outfits: [{
          name: fitName || '服装',
          upper, lower: fieldOf(inner, '下装'), shoes: fieldOf(inner, '鞋袜'),
          accessory: fieldOf(inner, '配饰'), full: fieldOf(inner, '整体'), back: fieldOf(inner, '背面'),
          negative: fieldOf(inner, '负面'),
        }],
      })
    }
  }
  return people
}
