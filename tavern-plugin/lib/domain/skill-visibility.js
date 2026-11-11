import { promptSection } from './prompt-section.js'
import { randomUUID } from 'node:crypto'
import { canonicalTavernSkillName } from './tavern-skills.js'
import { isProducerSource } from './message-source.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Writing Skill switches for this game:",
  p002: "This is the full current state, replacing all earlier writing Skill switch notices, effective from this request.",
  p003: "Disabled now: ",
  p004: "All writing Skills reported disabled earlier are re-enabled for this game.",
  p005: "Stop following disabled Skills' previously loaded text and references, and don't call them again; their history remains only as a record, not active guidance.",
  p006: "Skills disabled earlier but no longer listed are re-enabled for this game; use them as scenes require, within the current catalogue and call permissions. Switches don't change established story facts."
})


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
  const text = promptSection('writing_skills', [
    PROMPT_PROSE.p001,
    PROMPT_PROSE.p002,
    disabled.length ? PROMPT_PROSE.p003 + disabled.map(name => '`' + name + '`').join('、') + '。' : PROMPT_PROSE.p004,
    ...(disabled.length ? [PROMPT_PROSE.p005] : []),
    PROMPT_PROSE.p006
  ].join('\n'))
  return [...messages, {
    id: randomUUID(), role: 'user', content: [{ type: 'text', text }],
    source: { kind: 'plugin:dsh-tavern', form: 'writing-skill-state', disabledWritingSkills: disabled }
  }]
}
