// 自动素材's generation priority: one value function, three levels (节省 / 平衡 / 激进) as its parameters. Pure.
//
// A picture is worth the story lines it will show right. A person's first 立绘 turns every later line of theirs from a stand-in
// (借用形象: a 通用角色's 立绘) into them; another emotion's 立绘 only changes the face of that emotion's lines (the first 立绘 already shows the
// person), so it is worth `face` of a line. Lines already asked for count in full; lines to come count by how likely the
// person is to come back and how much they say then (their importance). A picture is drawn when its value per picture reaches
// the level's bar; the best goes first. The numbers were fitted on replays of real games (fitted on 9 games, checked on 5
// others).

// Importance (重要度): extra = one scene's NPC, recurring = comes back, core = the story's own people. The casting assistant
// judges it when a person comes on; their lines raise it (tierOf), never lower it.
export const AUTO_CAST_TIERS = Object.freeze(['extra', 'recurring', 'core'])
// How a person's appearances raise their importance: a second round of lines makes them recurring, a third (or many lines)
// core. In the replays (people with five rounds of game left), 86% of those seen in two rounds came back again, 96% of those
// seen in three.
const RECURRING_ROUNDS = 2, CORE_ROUNDS = 3, CORE_LINES = 20
export function tierOf(judged, {rounds = 0, lines = 0} = {}) {
  const evidence = rounds >= CORE_ROUNDS || lines >= CORE_LINES ? 2 : rounds >= RECURRING_ROUNDS ? 1 : 0
  return AUTO_CAST_TIERS[Math.max(evidence, Math.max(0, AUTO_CAST_TIERS.indexOf(judged)))]
}

// What share of a person's lines each standard emotion takes (10 275 lines of 14 replayed games; a line with no mood or one
// matching no standard emotion shows the default, calm).
export const EMOTION_SHARE = Object.freeze({calm:0.47, joy:0.17, anxious:0.15, sad:0.057, shy:0.045, disgust:0.036, crying:0.031, anger:0.026, love:0.008})

// What is planned ahead for a person of each importance: the chance they have more lines, and for how many rounds the plan
// looks ahead (the queue is planned again every round, so lines further on count when they come). A debut judged extra came
// back in 24–40% of the replays, recurring 72–76%, core always.
const OUTLOOK = Object.freeze({comeBack:{extra:0.1, recurring:0.6, core:1}, rounds:{extra:1, recurring:4, core:4}})
// The three levels: from = the least importance whose pictures are drawn at all (below it a person keeps the 通用角色 立绘 they
// were lent, however much they say: owner 11-20, 「普通 NPC 一直用借来的通用立绘，重要角色优先做新素材」); bar = the lines a
// picture must be worth; face = what a right face is worth against a line shown at all.
// 节省 draws the story's own people (their default 立绘, an emotion once it is asked for often); 平衡 also those who come back;
// 激进 everyone who spoke and every emotion the story uses.
export const AUTO_CAST_LEVELS = Object.freeze({
  saving:Object.freeze({from:'core', bar:10, face:0.15}),
  balanced:Object.freeze({from:'recurring', bar:4, face:0.15}),
  aggressive:Object.freeze({from:'extra', bar:0.4, face:1}),
})
// The levels stored before (用到才生成 / 常用预备 / 整卡补全) read as the new ones.
const OLD_LEVELS = {late:'balanced', eager:'balanced', all:'aggressive'}
export const autoCastLevel = stored => AUTO_CAST_LEVELS[stored] ? stored : OLD_LEVELS[stored] || 'balanced'
// A level by name, or parameters of its own (the replay's fitting tries others): {from, bar, face, comeBack?, rounds?}.
const paramsOf = level => ({...OUTLOOK, ...(typeof level === 'object' ? level : AUTO_CAST_LEVELS[autoCastLevel(level)])})

const LINES_PER_ROUND = 3
// The lines a person is expected to have from now on, and how the emotions share them (their own lines, smoothed by the share
// of all lines: 10 lines of prior).
export function outlook(person, level) {
  const params = paramsOf(level), tier = tierOf(person.judged, person)
  const perRound = person.rounds ? Math.max(1, person.lines / person.rounds) : LINES_PER_ROUND
  const lines = params.comeBack[tier] * params.rounds[tier] * perRound
  const seen = Object.values(person.moods || {}).reduce((sum, n) => sum + n, 0)
  const share = emotion => ((person.moods?.[emotion] || 0) + 10 * (EMOTION_SHARE[emotion] ?? 0.01)) / (seen + 10)
  return {tier, lines, share}
}

// The value of each picture this person could still get, per picture. person: {judged, rounds, lines, moods:{emotion:n},
// misses:{emotion:n} (lines that asked for an emotion with no 立绘), settei:boolean, sprites:[emotion], emotions:[emotion]}.
// → [{kind:'identity-settei'|'sprite', emotionId, value, tier}] best first; a person with no 立绘 gets their 人设图 and first
// 立绘 as one pair (the 立绘 is drawn from the 人设图), valued per picture. None for a person below the level's rom.
export function pictureValues(person, level) {
  const {tier, lines, share} = outlook(person, level), misses = person.misses || {}, {face, from} = paramsOf(level)
  const emotions = person.emotions?.length ? person.emotions : Object.keys(EMOTION_SHARE)
  const open = emotions.filter(id => !person.sprites.includes(id))
  if (!open.length || AUTO_CAST_TIERS.indexOf(tier) < AUTO_CAST_TIERS.indexOf(from)) return []
  if (!person.sprites.length) {
    // the first 立绘: the emotion the story asked most, else the commonest; it shows every line until the others come
    const first = [...open].sort((a, b) => (misses[b] || 0) - (misses[a] || 0) || share(b) - share(a))[0]
    const asked = Object.values(misses).reduce((sum, n) => sum + n, 0)
    const value = (asked + lines) / (person.settei ? 1 : 2)
    return [...(person.settei ? [] : [{kind:'identity-settei', emotionId:null, value, tier}]), {kind:'sprite', emotionId:first, value, tier}]
  }
  return open.map(id => ({kind:'sprite', emotionId:id, value:face * ((misses[id] || 0) + lines * share(id)), tier})).sort(picturePriority)
}

// The queue's order: the more important person first (core before recurring), then the more valuable picture.
export const picturePriority = (a, b) => AUTO_CAST_TIERS.indexOf(b.tier) - AUTO_CAST_TIERS.indexOf(a.tier) || b.value - a.value

// Whether a picture of this value is drawn at this level. A budget (dollars per 100 rounds) raises the bar by the share it
// is overspent: `spent` dollars over `rounds` rounds.
export function worthDrawing(value, level, {budget = null, spent = 0, rounds = 0} = {}) {
  const over = budget && rounds ? Math.max(1, (spent / rounds * 100) / budget) : 1
  return value >= paramsOf(level).bar * over
}
