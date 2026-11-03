import { sessionEvents } from './session-events.js'
import { cordisToolNames } from './turn-orchestration.js'

// Tools only some card tasks use. Their schemas would otherwise ride on every
// card-Agent step; they appear once a Skill that needs them is loaded. Loading
// changes the tool list, costing one cache miss in exchange for every other session.
// Tavern's own gated tools by Skill; plugins add theirs through tavern.toolSkills().
const SKILL_TOOLS = Object.freeze({
  'advanced-capabilities': [...cordisToolNames, 'tavern_save_skill'],
  'tavern-plugin': [...cordisToolNames],
  'create-skill': ['tavern_save_skill'],
  'create-writing-skill': ['tavern_save_skill'],
  'user-profile': ['tavern_user_profile_read', 'tavern_user_profile_save'],
  'create-card': ['tavern_user_profile_read'],
  'create-dsh-card': ['tavern_user_profile_read'],
  'debug-card': ['tavern_read_play_chat', 'tavern_read_runtime_health']
})
const BUILT_IN = new Map()
for (const [skill, tools] of Object.entries(SKILL_TOOLS)) for (const tool of tools) BUILT_IN.set(tool, [...(BUILT_IN.get(tool) || []), skill])
const SKILL_CONTENT = /<skill_content name=\\?"([^"\\]+)/g

/** Remembers which Skills each session has loaded, scanning only new events. */
export function createSkillGatedTools({ pluginSkills = () => null } = {}) {
  const seen = new Map()
  function loaded(session) {
    if (!session) return new Set()
    const events = sessionEvents(session)
    let state = seen.get(session.id)
    if (!state || state.count > events.length) state = { count: 0, names: new Set() }
    for (const event of events.slice(state.count)) {
      if (event.type !== 'tool/result' && event.type !== 'user/message') continue
      for (const match of JSON.stringify(event.data ?? null).matchAll(SKILL_CONTENT)) state.names.add(match[1])
    }
    state.count = events.length
    seen.set(session.id, state)
    return state.names
  }
  return function visible(names, session) {
    const skills = loaded(session)
    return names.filter(name => {
      const needed = BUILT_IN.get(name) || pluginSkills(name)
      return !needed || needed.some(skill => skills.has(skill))
    })
  }
}
