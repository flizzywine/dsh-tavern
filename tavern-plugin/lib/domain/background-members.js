import { taskMember } from './background-tasks.js'

// The named resident background Agents of a game. Each keeps its own Session (and prompt
// cache); tasks on one member run one at a time, tasks on different members may overlap.
// `background` is the Session every game already has, so old saves keep using it.
// `timeline`: its Session is bound in the save (timeline.participants[id]), rewound with the
// story, compacted with it and counted as the game's own; a member without it keeps its
// Session itself (润色师: plugin data).
export const BACKGROUND_MEMBERS = Object.freeze([
  { id: 'background', name: '书记', timeline: true },
  { id: 'polish', name: '润色师', timeline: false }
])

// Members whose Sessions the save binds, in table order.
export const TIMELINE_MEMBERS = Object.freeze(BACKGROUND_MEMBERS.filter(member => member.timeline).map(member => member.id))

// Coordinator roles (and runner tasks) by the member whose Session and slot they use: each
// task's own `member` in the task table, and roles retired from it still found in old saves.
const RETIRED_ROLE_MEMBER = Object.freeze({ 'worldbook-filter': 'background', 'style-reference': 'background' })

export function memberOf(role) {
  const key = String(role || '')
  return taskMember(key) || RETIRED_ROLE_MEMBER[key] || ''
}

// The timeline participant a role binds: its member, or the role itself when it has none.
export function participantOf(role) {
  return memberOf(role) || String(role || '')
}

// The coordinator slot a role waits for. A plugin task has no resident Session, but it
// writes the reply's variables beside settlement, so it waits for 书记's slot.
export function slotOf(role) {
  return memberOf(role) || (role === 'plugin-task' ? 'background' : String(role || ''))
}

// Members plugins register (tavern.member): `plugin:<owner>:<name>`. Their Sessions are the
// runner's, like 润色师's: not bound in the save, never rewound with the story.
// A member may bring a prefix of its own (`system`, `tools`): its Session then holds that
// system prompt and those tools only, fixed for every task, and each task is one message.
const pluginMembers = new Map()
const pluginPrefixes = new Map()

export function pluginMemberId(owner, name) {
  return 'plugin:' + String(owner) + ':' + String(name)
}

/** Register a plugin's member; returns the function that removes it. */
export function registerPluginMember({ owner, name, title, system, tools }) {
  const id = pluginMemberId(owner, name)
  if (pluginMembers.has(id)) throw new Error('成员 ' + name + ' 已注册')
  const member = Object.freeze({ id, name: String(title || name), timeline: false, plugin: String(owner), ownPrefix: system !== undefined })
  const prefix = system === undefined ? null : Object.freeze({ system: String(system), tools: tools || new Map() })
  pluginMembers.set(id, member)
  if (prefix) pluginPrefixes.set(id, prefix)
  return () => { if (pluginMembers.get(id) === member) { pluginMembers.delete(id); pluginPrefixes.delete(id) } }
}

/** The prefix a plugin member brought, { system, tools: Map(name → tool) }, or null. */
export function pluginMemberPrefix(id) {
  return pluginPrefixes.get(String(id || '')) || null
}

export function pluginMember(id) {
  return pluginMembers.get(String(id || '')) || null
}

/** Built-in members, then plugin members. */
export function listMembers() {
  return [...BACKGROUND_MEMBERS, ...pluginMembers.values()]
}

export function memberName(id) {
  return listMembers().find(member => member.id === id)?.name || ''
}
