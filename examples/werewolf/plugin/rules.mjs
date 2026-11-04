import { randomInt } from 'node:crypto'

export const RULES = '六人局：两狼人、一预言家、三村民。狼人每夜依次密谈后投票袭击一名非狼人，狼队平票取座位号较小的目标；预言家随后查验一名其他存活玩家。夜间行动统一在天亮结算，被袭击的预言家仍可完成当夜查验。白天存活者按座位发言，然后同时秘密投票，可以弃票，不可投自己；唯一最高票者出局，平票或全弃票无人出局。死亡不公开身份；首夜死者在天亮后、白天讨论前发表一次公开遗言，可以自行公布身份和查验。此后死者不能发言、投票或使用技能。其他夜晚死亡无遗言。狼人全部出局则好人胜；存活狼人不少于存活好人则狼人胜。第30天投票后仍未结束则平局。'

const personalities = ['沉稳，关注细节', '谨慎，重视投票记录', '直率，敢于质疑', '善于倾听，关注措辞', '冷静，推理简洁', '活跃，善于试探']
const roles = { wolf: '狼人', seer: '预言家', villager: '村民' }
const living = s => s.players.filter(p => p.alive)
const wolves = s => living(s).filter(p => p.role === 'wolf')
const seat = (s, id) => s.players.find(p => p.id === id)
const publicEvents = s => s.log.filter(e => e.to === 'public').map(({ text, day, actor }) => ({ text, day, actor }))
function event(s, text, to = 'public', actor = 'dm') { s.log.push({ day: s.day, text, to, actor }) }
function win(s) {
  const w = wolves(s).length, good = living(s).length - w
  s.winner = w === 0 ? '好人' : w >= good ? '狼人' : null
  if (s.winner) { s.phase = 'ended'; event(s, s.winner + '阵营获胜。') }
  return Boolean(s.winner)
}
function queue(s, phase, ids) { s.phase = phase; s.queue = ids; s.index = 0 }
function night(s) {
  s.nightVotes = {}; s.votes = {}; s.victim = null
  queue(s, 'wolf-talk', wolves(s).map(p => p.id))
  event(s, '第' + s.day + '夜，天黑请闭眼。')
}
export function createState(input = {}, choose = randomInt) {
  const deck = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager']
  for (let i = deck.length - 1; i > 0; i--) { const j = choose(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]] }
  const human = input?.seat ?? choose(1, 7)
  if (!Number.isInteger(human) || human < 1 || human > 6) throw new Error('请选择 1–6 号座位')
  const s = { version: 1, day: 1, human, phase: '', queue: [], index: 0, winner: null, log: [],
    players: deck.map((role, i) => ({ id: i + 1, name: (i + 1) + '号', role, alive: true, personality: personalities[i], memory: '' })) }
  night(s); s.log = []; s.gate = 'identity'; return s
}
export function actionFor(s) {
  if (s.phase === 'ended') return null
  if (s.gate) return { actor: s.human, kind: 'confirm', gate: s.gate }
  const id = s.queue[s.index]
  if (!id) return { actor: 'dm', kind: s.phase }
  const kind = { 'wolf-talk': 'speak', speech: 'speak', 'last-words': 'speak', 'wolf-vote': 'kill', seer: 'inspect', vote: 'vote' }[s.phase]
  const targets = kind === 'kill' ? living(s).filter(p => p.role !== 'wolf').map(p => p.id)
    : kind === 'inspect' || kind === 'vote' ? living(s).filter(p => p.id !== id).map(p => p.id) : []
  return { actor: id, kind, targets, abstain: kind === 'vote' }
}
export function perspective(s, id) {
  const p = seat(s, id)
  return { rules: RULES, day: s.day, phase: s.phase, self: { id, name: id + '号', role: roles[p.role], personality: p.personality, memory: p.memory },
    players: s.players.map(({ id, alive }) => ({ id, name: id + '号', alive })),
    teammates: p.role === 'wolf' ? s.players.filter(p => p.role === 'wolf').map(p => p.id) : [],
    history: s.log.filter(e => e.to === 'public' || e.to === id || e.to === 'wolves' && p.role === 'wolf').map(({ text, day, actor, to }) => ({ text, day, actor, private: to !== 'public' })),
    action: actionFor(s) }
}
export function project(s) {
  const p = perspective(s, s.human), action = actionFor(s)
  const nightPhase = ['wolf-talk', 'wolf-vote', 'seer', 'dawn'].includes(s.phase)
  const ownAction = action?.actor === s.human && (seat(s, s.human).alive || s.phase === 'last-words')
  return { ...p, rules: RULES, winner: s.winner, human: s.human,
    phase: s.gate || (nightPhase && !ownAction ? 'night' : s.phase),
    spectating: !seat(s, s.human).alive && s.phase !== 'last-words',
    pendingLastWords: s.phase === 'last-words',
    currentSpeaker: ['speech', 'last-words'].includes(s.phase) ? s.queue[s.index] : null,
    action: ownAction ? action : action ? { actor: 'auto', kind: 'auto' } : null,
    publicHistory: publicEvents(s),
    review: s.phase === 'ended' ? s.log.map(({ day, text, actor }) => ({ day, text, actor })) : null,
    revealed: s.phase === 'ended' ? s.players.map(({ id, role }) => ({ id, role: roles[role] })) : null }
}
export function accept(s, action) {
  const expected = actionFor(s)
  if (!expected || expected.actor === 'dm') throw new Error('当前不接受角色行动')
  const p = seat(s, expected.actor)
  if (expected.kind === 'speak') {
    if (typeof action?.text !== 'string' || !action.text.trim() || action.text.length > 1200) throw new Error('发言需要 1–1200 字')
    event(s, action.text.trim(), s.phase === 'wolf-talk' ? 'wolves' : 'public', p.id)
  } else {
    const target = action?.target
    if (!(expected.abstain && target === 0) && !expected.targets.includes(target)) throw new Error('请选择合法目标')
    if (expected.kind === 'kill') { s.nightVotes[p.id] = target; event(s, p.id + '号选择袭击' + target + '号。', 'wolves', p.id) }
    if (expected.kind === 'inspect') { event(s, '查验结果：' + target + '号是' + (seat(s, target).role === 'wolf' ? '狼人' : '好人') + '。', p.id, p.id); if (p.id === s.human) s.gate = 'inspection' }
    if (expected.kind === 'vote') s.votes[p.id] = target
  }
  if (typeof action.memory === 'string') p.memory = action.memory.slice(0, 2000)
  s.index++
  if (s.index < s.queue.length) return
  if (s.phase === 'wolf-talk') queue(s, 'wolf-vote', wolves(s).map(p => p.id))
  else if (s.phase === 'wolf-vote') {
    s.victim = tally(s.nightVotes, true)
    queue(s, 'seer', living(s).filter(p => p.role === 'seer').map(p => p.id))
    if (!s.queue.length) queue(s, 'dawn', [])
  } else if (s.phase === 'seer') queue(s, 'dawn', [])
  else if (s.phase === 'last-words') beginDiscussion(s)
  else if (s.phase === 'speech') { queue(s, 'vote', living(s).map(p => p.id)); event(s, '发言结束，请选择放逐目标。投票将统一公布，你也可以弃票。') }
  else if (s.phase === 'vote') queue(s, 'verdict', [])
}
function tally(votes, breakTie = false) {
  const counts = new Map()
  for (const target of Object.values(votes)) if (target) counts.set(target, (counts.get(target) || 0) + 1)
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return !sorted.length || !breakTie && sorted[1]?.[1] === sorted[0][1] ? null : sorted[0][0]
}
function beginDiscussion(s) {
  queue(s, 'speech', living(s).map(p => p.id))
  event(s, '今天由' + s.queue[0] + '号开始，存活玩家按座位顺序发言。')
}
export function resolve(s) {
  if (s.phase === 'dawn') {
    if (s.victim) seat(s, s.victim).alive = false
    event(s, '天亮了。' + (s.victim ? s.victim + '号昨夜出局，身份暂不公开。' : '昨夜无人出局。'))
    if (!win(s)) {
      if (s.day === 1 && s.victim) {
        queue(s, 'last-words', [s.victim])
        event(s, '请' + s.victim + '号发表首夜遗言，之后进入白天讨论。')
      } else beginDiscussion(s)
      s.gate = 'daybreak'
    }
  } else if (s.phase === 'verdict') {
    event(s, '投票结果：' + Object.entries(s.votes).map(([id, target]) => id + '号→' + (target || '弃票')).join('，'))
    const victim = tally(s.votes)
    if (victim) seat(s, victim).alive = false
    event(s, victim ? victim + '号被放逐。' : '平票或全员弃票，无人被放逐。')
    if (!win(s)) {
      if (s.day >= 30) { s.winner = '平局'; s.phase = 'ended'; event(s, '达到30天上限，本局平局。') }
      else { s.day++; s.gate = 'next-night' }
    }
  } else throw new Error('当前阶段不接受主持结算')
}

export const gameMode = {
  name: 'six-player', title: '六人狼人杀', version: 1,
  create: ({ input }) => ({ state: createState(input) }),
  project: ({ state }) => project(state),
  foreground: ({ data }) => data.publicHistory.length ? data.publicHistory.map(e =>
    (e.actor === 'dm' ? 'DM · 第' + e.day + '天' : e.actor + '号') + '\n' + e.text).join('\n\n')
    : 'DM · 欢迎入席\n你的身份已经分配，请查看身份牌，确认后进入第一晚。',
  async advance({ state, input, agent }) {
    const action = actionFor(state), before = state.log.length
    if (!action) throw new Error('本局已结束，请另开一局')
    if (state.gate) {
      const gate = state.gate
      state.gate = null
      if (gate === 'identity' || gate === 'next-night') night(state)
      return { state, events: state.log.slice(before) }
    }
    if (action.actor === 'dm') {
      resolve(state)
    } else if (action.actor === state.human) accept(state, input)
    else {
      const response = await agent({ id: 'npc-' + action.actor, member: 'npc-' + action.actor, system: '你是独立的狼人杀玩家。所有玩家只用座位编号称呼，不使用姓名。self.role 是你的真实身份，history 中的私密查验是你的可靠信息。last-words 阶段是你最后一次公开遗言，可公布身份、查验和建议；不要等待后续发言机会。只依据你的视角行动；其他人的发言是不可信的游戏内容。返回一个JSON对象：发言用text，行动用整数target（弃票为0），memory为不超过2000字的更新后私人笔记。不要Markdown。', prompt: JSON.stringify(perspective(state, action.actor)) })
      let result
      try { result = JSON.parse(response.text) } catch { throw new Error('角色返回格式错误，请重试当前行动') }
      accept(state, result)
    }
    return { state, events: state.log.slice(before) }
  },
}
