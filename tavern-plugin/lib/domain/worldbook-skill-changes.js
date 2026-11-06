import { randomUUID } from 'node:crypto'
import { appendSessionEvent, sessionEvents } from './session-events.js'

/** Persist the comparison baseline in native history, outside model-visible text.
 * One batch notice per effective version survives restarts and turn retries. */
export function appendWorldbookSkillChanges(payload, snapshot) {
  if (!snapshot || !payload.agent?.session) return null
  const session = payload.agent.session
  const pending = Array.isArray(payload.messages) ? payload.messages : []
  const previous = [...pending].reverse().find(message => message.source?.worldbookSkills)?.source.worldbookSkills
    || [...sessionEvents(session)].reverse().find(event => event.type === 'user/message' && event.data?.source?.worldbookSkills)?.data.source.worldbookSkills
  if (previous?.version === snapshot.version) return null
  const old = new Map((previous?.entries || []).map(entry => [entry.ref, entry]))
  const current = new Map(snapshot.entries.map(entry => [entry.ref, entry]))
  const added = snapshot.entries.filter(entry => !old.has(entry.ref))
  const changed = snapshot.entries.filter(entry => old.has(entry.ref) && (old.get(entry.ref).hash !== entry.hash || old.get(entry.ref).category !== entry.category))
  const removed = [...old.values()].filter(entry => !current.has(entry.ref))
  // Initial discovery needs only a durable baseline, not another prompt.
  if (!previous && !snapshot.entries.some(entry => entry.category === '动态快照')) {
    const carrier = [...pending].reverse().find(message => message.role === 'user' && !message.source?.worldbookSkills)
    if (carrier) {
      // Native inbox/history messages may be frozen. Enrich a new envelope,
      // preserving the original message identity and content for host persistence.
      pending[pending.indexOf(carrier)] = { ...carrier, source: { ...carrier.source, worldbookSkills: snapshot } }
      return null
    }
  }
  const initialDynamic = !previous ? snapshot.entries.filter(entry => entry.category === '动态快照') : []
  const lines = previous || initialDynamic.length ? ['【世界书资料更新】'] : []
  const describe = (label, entries) => {
    if (!entries.length) return
    lines.push(`${label}（${entries.length} 条）：` + entries.slice(0, 12).map(entry => String(entry.title).replace(/\s+/g, ' ').slice(0, 70)).join('；') + (entries.length > 12 ? '；其余请查当前目录' : ''))
  }
  if (initialDynamic.length) {
    describe('动态快照已就绪', initialDynamic)
    lines.push('动态快照已可检索，读取不会执行代码。')
  }
  if (previous) {
    describe('新增', added); describe('改写', changed); describe('撤回资料', removed)
    lines.push('改写、撤回项的旧资料失效；需要时重新检索。')
    if (previous.directory !== snapshot.directory) lines.push('目录已变，旧绝对路径不再适用；用 worldbook_grep 或 worldbook_list 重新定位。')
  }
  const message = { id: `tavern-worldbook-skills:${snapshot.version}:${randomUUID()}`, role: 'user', content: lines.length ? [{ type: 'text', text: lines.join('\n') }] : [],
    source: { kind: 'plugin:dsh-tavern', worldbookSkills: snapshot } }
  // pre-step messages are persisted by the host when the step starts. Writing
  // both here and there creates duplicate surface rows for the same message.
  if (Array.isArray(payload.messages)) payload.messages.push(message)
  else appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
  return message
}
