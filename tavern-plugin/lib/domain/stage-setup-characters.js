import {rawData} from './card-preparation.js'

const TOPIC = /系统|规则|格式|设定|列表|清单|名单|赛季|地图|历史|变量|思维链|总结|世界观|时间线|机制|教程|任务|\[|\]|EJS|\b(?:system|rules?|format|settings?|list|timeline|tutorial)\b/i
const FIELDS = '姓名|名字|性别|年龄|身高|生日|外貌(?:特征|与装备)?|外表|长相|性格(?:特点|调色盘|与行为模式)?|身份|职业|喜好|爱好|口癖|称呼|name|age|gender|appearance|personality|height|birthday'
const NAME_FIELDS = /^(?:姓名|名字|name)$/i
const text = value => typeof value === 'string' ? value : ''
const cleanName = value => text(value).trim()
const nameLike = name => /^[\p{Script=Han}]{2,4}$/u.test(name) || /^[\p{Script=Katakana}ー]{2,20}$/u.test(name) || /^[\p{L}]+(?:[·・][\p{L}]+)+$/u.test(name) || /^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+){0,3}$/.test(name)
const profileNameLike = name => nameLike(name) || /^[\p{Script=Han}]{2,8}$/u.test(name)

function profile(content) {
  // Only field boundaries count, not incidental words in prose or instruction text.
  const fields = new Set(), names = []
  // Keep prefix whitespace line-local and disjoint; imported text may contain long blank runs.
  const marker = new RegExp(`(?:^|[\\n{,;])[^\\S\\n]*(?:[-*#]+[^\\S\\n]*)?["'【\\[]?(${FIELDS})["'】\\]]?\\s*(?:[:：]\\s*([^\\n,;}]+)|[】\\]])`, 'gi')
  for (const match of content.matchAll(marker)) {
    fields.add(match[1].toLowerCase())
    if (NAME_FIELDS.test(match[1])) names.push({value:match[2],offset:match.index})
  }
  for (const match of content.matchAll(/<(name|age|gender|appearance|personality)\b[^<>]*>([^<]*)/gi)) {
    fields.add(match[1].toLowerCase())
    if (NAME_FIELDS.test(match[1])) names.push({value:match[2],offset:match.index})
  }
  names.sort((a,b) => a.offset - b.offset)
  // Only explicit name fields start profiles; relationship mentions are not extra people.
  const name = cleanName(names[0]?.value).split(/[|｜(（]/)[0].trim().replace(/^["']|["']$/g,'').replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu,'')
  return {count:fields.size, name:profileNameLike(name) ? name : '', offsets:names.map(row => row.offset)}
}

// Suggestions only, not entity resolution. Precision wins over exhaustive cast extraction.
export function detectStageSetupCharacters(raw, books = []) {
  const data = rawData(raw), candidates = new Map()
  const description = [data.description,data.personality].map(text).join('\n')
  const corroboration = [description,data.first_mes,...(data.alternate_greetings || []),...(data.group_only_greetings || [])].map(text).join('\n')
  function add(value, source, details = {count:0,name:''}, explicit = false) {
    const name = cleanName(value)
    if (!name || name.length > 60 || /[\r\n{}<>]/.test(name) || TOPIC.test(name)) return
    if (!details.count && /[师者士]$/.test(name)) return
    const named = nameLike(name) || (details.count >= 2 && profileNameLike(name))
    const score = (named ? 2 : 0) + Math.min(details.count,3) + (details.name === name ? 2 : 0) + (corroboration.includes(name) ? 2 : 0) + (explicit ? 5 : 0)
    if (!explicit && (!named || details.count < 2)) return
    const row = candidates.get(name) || {name,sources:[],score:0}
    if (!row.sources.includes(source)) row.sources.push(source)
    row.score = Math.max(row.score,score)
    candidates.set(name,row)
  }
  const own = profile(description), ownName = cleanName(data.name)
  const namedCharacter = ownName && ownName === cleanName(data.character_name)
  // A world card often contains somebody else's profile. Its title is not that person.
  const singleCharacter = !!ownName && (namedCharacter || own.name === ownName || (!own.name && own.count >= 2 && (description.includes(ownName) || description.includes('{{char}}'))))
  if (singleCharacter) add(ownName,'card',own,!!namedCharacter)
  add(data.character_name,'character',own,true)
  for (const row of [data.character,...(Array.isArray(data.characters) ? data.characters : [])]) {
    add(typeof row === 'string' ? row : row?.name,'character',profile([row?.description,row?.personality].map(text).join('\n')),true)
  }
  for (const book of [data.character_book,data.worldbook,...books]) {
    for (const row of Object.values(book?.entries || {})) {
      const title = cleanName(row.name) || cleanName(row.comment)
      if (TOPIC.test(title)) continue
      const content = text(row.content), details = profile(content)
      if (details.offsets.length > 1) {
        // Anthology entries can contain several complete profiles, each needing its own evidence.
        details.offsets.forEach((start,i) => {
          const part = profile(content.slice(start,details.offsets[i+1]))
          add(part.name,'worldbook',part)
        })
      } else add(details.name || title,'worldbook',details)
      // Single-character cards also keep supporting cast in explicit speaker rows.
      // World cards can carry unrelated shared style examples: require corroboration there.
      for (const match of content.matchAll(/^[ \t]*([\p{L}·・ '-]{2,40})[（(]ID[ \t]+[\w-]+[）)][ \t]*[:：]/gmu)) {
        if (singleCharacter || corroboration.includes(match[1])) add(match[1],'worldbook',undefined,true)
      }
    }
  }
  // Narrow independent evidence; keep these after profiles to preserve equal-score ordering.
  const ownPortrayal = ownName && /^[A-Za-z][A-Za-z-]{1,39}$/.test(ownName) &&
    new RegExp('^(?:你将扮演|你是|You are|You will play)\\s*'+ownName+'(?:[（(\\s.,，。]|$)','i').test(description.trim())
  if (ownPortrayal) add(ownName,'card-portrayal',undefined,true)
  for (const book of [data.character_book,data.worldbook,...books]) {
    for (const entry of Object.values(book?.entries || {})) {
      const content=text(entry.content), title=(cleanName(entry.name)||cleanName(entry.comment)).split(/[（(]/)[0].trim()
      const details=profile(content)
      const heading=content.replace(/^(?:\s*<[\w-]+>\s*)+/u,'').trimStart()
      const personHeading=/^[\p{Script=Han}]{2,6}$/u.test(title) &&
        new RegExp('^'+title+'[（(](?:次要角色|主要角色|角色|人物|配角|character)[）)]','i').test(heading)
      if (personHeading &&
        (details.count>=2 || (details.count>=1 && /(?:^|[。\s])\d{1,3}岁(?:[。\s]|$)/u.test(content)))) {
        add(title,'title-heading',{count:Math.max(2,details.count),name:title})
      }
    }
  }

  return [...candidates.values()].filter(row => row.score >= 5).sort((a,b) => b.score - a.score).map(({name,sources}) => ({name,sources}))
}
