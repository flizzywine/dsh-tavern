import { matchesWorldBookKeywords } from './worldbook-activation.js'
import { projectAgentMessageText } from './runtime-content-projection.js'
import { extractMvuStoryText } from './mvu-background-settlement.js'

const REGISTRATION_RULE = '登记时以上述硬字段为准：身份不写姓名（卡头已有），简介不复述身份、不写本名；态度仍只填本轮私心好恶的个人偏置。气血最大值照上面的落点逐字抄；有 `$道`、`$天资` 或 `兵甲` 各行就连它一并照抄，没有则不写该项。'
const SHARED_RULE = '以下所有「NPC首登登记」条目共用这一条要求（硬字段取各自条目）：\n' + REGISTRATION_RULE

function registration(entry) {
  const name = /^\[mvu_update\]人物登记·(.+)$/i.exec((entry.comment || entry.title || '').trim())?.[1]
  if (!name) return null
  const content = entry.content.trim()
  if (!content.startsWith('# NPC首登登记·' + name + '\n') && !content.startsWith('# NPC首登登记·' + name + '\r\n')) return null
  if (!content.endsWith('\n' + REGISTRATION_RULE) || /\{\{|<%|^@@|@INJECT/m.test(content)) return null
  const identity = /^身份[：:]([^\r\n]+)$/m.exec(content)?.[1].trim()
  return { name, identity, body: content.slice(0, -REGISTRATION_RULE.length).trimEnd() }
}

function matchesIdentity({ name, identity }, text) {
  if (!identity) return false
  if (text.includes(identity)) return true
  const [affiliation, role, ...rest] = identity.split('的')
  if (!role || rest.length || affiliation.length < 2 || role.length < 2 || !text.includes('姓' + name[0])) return false
  return text.split(/\n+/).some(paragraph => paragraph.includes(affiliation) && paragraph.includes(role) && paragraph.includes('姓' + name[0]))
}

/** Keep other settlement rules in order. The catalogue is recognizable by
 * matching the authored heading and boilerplate, so custom rules stay intact. */
export function projectMvuNpcRegistration(entries, { chat, target, projection }) {
  const records = new Map(entries.flatMap(entry => {
    const record = registration(entry)
    return record ? [[entry, record]] : []
  }))
  if (records.size < 2) return entries

  const registered = target?.variables?.stat_data?.NPC
  const eligible = new Set()
  const matches = new Set()
  if (registered && typeof registered === 'object' && !Array.isArray(registered) && target?.message?.mvu?.variableRetry !== true) {
    const previous = Number.isInteger(target.messageId) ? chat.messages?.slice(0, target.messageId)
      .findLast(message => message?.role === 'assistant' && !message.greeting) : undefined
    const story = extractMvuStoryText(projectAgentMessageText(target.message, projection), { allowEmpty: true })
    const previousStory = extractMvuStoryText(projectAgentMessageText(previous, projection), { allowEmpty: true })
    const context = story ? [story, previousStory].filter(Boolean) : []
    for (const [entry, record] of records) {
      // A registration without authored keys remains part of the regular rules.
      if (!context.length || entry.constant === true || !entry.primaryKeys?.some(key => key.trim())) continue
      eligible.add(entry)
      if (context.some(text =>
        text.includes(record.name) || matchesWorldBookKeywords(entry, text) || matchesIdentity(record, text)
      )) matches.add(entry)
    }
  }

  let emittedSharedRule = false
  return entries.flatMap(entry => {
    const record = records.get(entry)
    if (!record) return [entry]
    // With no positive identification, retain the compressed roster. Ambiguous
    // aliases retain all matches, and a manual retry sees all profiles again.
    if (eligible.has(entry) && (Object.hasOwn(registered, record.name) || (matches.size > 0 && !matches.has(entry)))) return []
    const content = emittedSharedRule ? record.body : SHARED_RULE + '\n\n' + record.body
    emittedSharedRule = true
    return [{ ...entry, content }]
  })
}
