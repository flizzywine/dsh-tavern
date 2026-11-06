import { randomUUID } from 'node:crypto'
import { canonicalTavernSkillName } from './tavern-skills.js'
import { isProducerSource } from './message-source.js'

function stateOf(message) {
  const source = message?.source
  return isProducerSource(source, 'dsh-tavern') && source.form === 'writing-skill-state'
    ? source.disabledWritingSkills : undefined
}

/** Skill names whose instructions this message put into the conversation. */
function loadedSkills(message) {
  if (message?.source?.kind === 'skill-invocation' && typeof message.source.name === 'string') return [message.source.name]
  return (Array.isArray(message?.content) ? message.content : []).flatMap(block => {
    if (block?.type !== 'tool-call' || block.name !== 'skill') return []
    let args = block.arguments
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return [] } }
    return typeof args?.name === 'string' ? [args.name] : []
  })
}

// Only append to the pending step. Never rewrite historical catalogs, loaded
// bodies, system instructions or tool schemas when the user changes a switch.
// The native catalog already hides disabled skills, so the notice only revokes
// instructions loaded in the visible history (including user-invocable skills
// absent from that catalog) or lifts a revocation an earlier notice declared.
export function appendWritingSkillState(messages, mode, { session, disabledWritingSkills = [] } = {}) {
  if (!['story', 'script'].includes(mode)) return messages
  const visible = []
  const nodes = session?.surface?.nodes || []
  for (const seq of nodes) {
    const event = session.eventAt(seq)
    if (event?.type === 'user/message') visible.push(event.data)
    else if (event?.type === 'assistant/message') visible.push(event.data?.message)
  }
  visible.push(...messages)
  let previous
  const loaded = new Set()
  for (const message of visible) {
    const state = stateOf(message)
    if (state !== undefined) previous = state
    for (const name of loadedSkills(message)) loaded.add(canonicalTavernSkillName(name))
  }
  const baseline = previous || []
  const disabled = [...new Set(disabledWritingSkills.map(canonicalTavernSkillName))]
    .filter(name => loaded.has(name) || baseline.includes(name)).sort()
  if (JSON.stringify(baseline) === JSON.stringify(disabled)) return messages
  const text = [
    '【本局写作 Skill 开关】',
    '这是当前完整开关状态，替代此前所有写作 Skill 开关通知，从本次请求起生效。',
    disabled.length ? '当前停用：' + disabled.map(name => '`' + name + '`').join('、') + '。' : '此前通知停用的写作 Skill 已全部解除本局禁用。',
    ...(disabled.length ? ['对当前停用的 Skill，停止遵循此前已加载的正文和参考资料，也不要再次调用；保留历史内容仅为对话记录，不表示仍然启用。'] : []),
    '此前停用、现在不再列出的 Skill 已解除本局禁用；仍需遵守当前可用目录与调用权限，按场景选用。开关不改变既有剧情事实。'
  ].join('\n')
  return [...messages, {
    id: randomUUID(), role: 'user', content: [{ type: 'text', text }],
    source: { kind: 'plugin:dsh-tavern', form: 'writing-skill-state', disabledWritingSkills: disabled }
  }]
}
