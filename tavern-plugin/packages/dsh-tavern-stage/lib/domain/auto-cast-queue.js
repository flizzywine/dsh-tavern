// 自动选角's generation queue. Pure: the record (one per card, kept by the runtime) and
// the cast it reads (the figures of the card's 自动生成 pack) in, the next picture out. Nothing here draws or writes.
//
// Record: {version:1, lines:{[figure]:n}, rounds:{[figure]:n}, turns:{[figure]:last turn counted}, moods:{[figure]:{[emotionId]:n}},
// misses:{[figure]:{[emotionId]:n}}, tier:{[figure]:importance the 选角助理 judged}, streaming:{turn, requests} (the finished lines of a
// reply still streaming), wanted:{[figure]:true} (a CG waits for its
// 人设图), jobs:{[jobKey]:{…}}, drawn:[…]}. `figure` is packId/figureId. A job is only kept while it is ready (drawn, not yet
// landed) or has failed; what is done is read from the cast, never stored twice. `drawn` keeps every call to the channel
// (redraws and failures too): what it drew, when, how long it took and, when the channel tells, what it cost.
import {pictureValues, worthDrawing, autoCastLevel, picturePriority} from './auto-cast-priority.js'

// The standard emotions in the order a figure's lines use them (replays of 14 games: 平和 47%, 喜悦 17%, 紧张 15% …).
export const AUTO_CAST_EMOTIONS = Object.freeze(['calm', 'joy', 'anxious', 'sad', 'shy', 'disgust', 'crying', 'anger', 'love'])
const MAX_FAILURES = 2, FAILURE_PAUSE_MS = 30 * 60_000

export const emptyAutoCastRecord = () => ({version:1, misses:{}, lines:{}, rounds:{}, turns:{}, moods:{}, tier:{}, wanted:{}, jobs:{}, cast:{}, same:{}, appearance:{}, looks:{}, drawn:[]})
export const figureKey = ref => ref.packId + '/' + ref.figureId
// One picture: a figure's 人设图, or one emotion's 立绘 (in the outfit it lands in; null = the figure's first outfit).
export const jobKey = job => JSON.stringify([job.kind, job.ref.packId, job.ref.figureId, job.kind === 'sprite' ? job.emotionId : null])

// A round's lines, counted once when the round is committed: each line of an automatic figure counts toward its lines, its
// rounds (once per turn) and its emotions; a line whose emotion has no 立绘 yet is one miss of that (figure, emotion).
// requests: [{ref, emotionId|null}] (null: a mood matching none of the figure's emotions, shown as its default).
export function noteRound(record, requests, cast, turn = null) {
  const next = structuredClone(record), byKey = new Map(cast.map(row => [figureKey(row.ref), row]))
  for (const field of ['rounds', 'turns', 'moods']) next[field] ??= {}
  for (const {ref, emotionId} of requests) {
    const key = figureKey(ref), figure = byKey.get(key)
    if (!figure) continue
    next.lines[key] = (next.lines[key] || 0) + 1
    if (turn === null || next.turns[key] !== turn) { next.rounds[key] = (next.rounds[key] || 0) + 1; if (turn !== null) next.turns[key] = turn }
    const shown = emotionId || figure.defaultEmotion || AUTO_CAST_EMOTIONS[0]
    next.moods[key] = {...next.moods[key], [shown]:(next.moods[key]?.[shown] || 0) + 1}
    if (!emotionId || figure.sprites.includes(emotionId)) continue
    next.misses[key] ??= {}
    next.misses[key][emotionId] = (next.misses[key][emotionId] || 0) + 1
  }
  return next
}

// The jobs to draw, best first. cast: [{ref, settei:boolean, sprites:[emotionId], emotions?:[emotionId]}] (the automatic pack's
// figures); level: 节省 / 平衡 / 激进 (saving | balanced | aggressive; the old late | eager | all read as these). Each figure's
// pictures are valued by auto-cast-priority.js (its importance — judged by the 选角助理, raised by its lines — what its lines
// asked for and are likely to ask); a picture worth less than the level's bar is not drawn. Skipped: a job ready or in flight
// (`busy`: Set of job keys), or one that failed MAX_FAILURES times in a row on this `channel`, for FAILURE_PAUSE_MS after the
// last (another channel or model tries it at once). A 立绘 is drawn from the figure's 人设图: a figure without one has only its
// 人设图 planned (the runtime counts a drawn, not yet landed 人设图 as there). A CG waiting for a figure (`wanted`) puts its
// 人设图 before everything.
export function planAutoCast(record, cast, level, {busy = new Set(), now = 0, channel = null} = {}) {
  // a reply still streaming: its finished lines count already (the commit replaces them with the whole round)
  if (record.streaming) record = noteRound(record, record.streaming.requests, cast, record.streaming.turn)
  const usable = job => {
    const key = jobKey(job), stored = record.jobs[key]
    return !busy.has(key) && stored?.status !== 'ready'
      && !(stored?.status === 'failed' && stored.channel === channel && stored.failures >= MAX_FAILURES && now - stored.at < FAILURE_PAUSE_MS)
  }
  const wanted = [], valued = []
  for (const figure of cast) {
    const key = figureKey(figure.ref)
    if (!figure.settei && record.wanted?.[key]) { wanted.push({kind:'identity-settei', ref:figure.ref}); continue }
    const person = {judged:record.tier?.[key], rounds:record.rounds?.[key] || 0, lines:record.lines[key] || 0, moods:record.moods?.[key] || {},
      misses:record.misses[key] || {}, settei:figure.settei, sprites:figure.sprites, emotions:figure.emotions?.length ? figure.emotions.map(row => row.id ?? row) : AUTO_CAST_EMOTIONS}
    for (const job of pictureValues(person, autoCastLevel(level))) {
      if (job.kind === 'sprite' && !figure.settei || !worthDrawing(job.value, autoCastLevel(level))) continue
      valued.push({value:job.value, tier:job.tier, job:job.kind === 'sprite' ? {kind:'sprite', ref:figure.ref, emotionId:job.emotionId} : {kind:'identity-settei', ref:figure.ref}})
    }
  }
  return [...wanted, ...valued.sort(picturePriority).map(row => row.job)].filter(usable)
}

export function wantSettei(record, refs) {
  return {...record, wanted:{...record.wanted, ...Object.fromEntries(refs.map(ref => [figureKey(ref), true]))}}
}
// When the first picture paused on this channel may be tried again (ms), or null when none waits out a pause.
export function pauseEnds(record, channel) {
  const ends = Object.values(record.jobs).filter(job => job.status === 'failed' && job.channel === channel && job.failures >= MAX_FAILURES).map(job => job.at + FAILURE_PAUSE_MS)
  return ends.length ? Math.min(...ends) : null
}
// A 人设图 that will not come: it failed MAX_FAILURES times in a row and waits out its pause.
export function setteiGivenUp(record, ref, now) {
  const job = record.jobs[jobKey({kind:'identity-settei', ref})]
  return job?.status === 'failed' && job.failures >= MAX_FAILURES && now - job.at < FAILURE_PAUSE_MS
}

// Bookkeeping of one job: drawn (bytes kept by the runtime until landed), failed, or landed (forgotten; a landed 立绘 also
// clears its misses).
export function jobReady(record, job, file, at) {
  return {...record, jobs:{...record.jobs, [jobKey(job)]:{...job, status:'ready', file, at}}}
}
// error: why it failed (its code, else its message), kept with the job for whoever reads the record; failures count on one channel.
export function jobFailed(record, job, at, error = null, channel = null) {
  const key = jobKey(job), before = record.jobs[key], reason = error && String(error.code || error.message || error).slice(0, 200)
  return {...record, jobs:{...record.jobs, [key]:{...job, status:'failed', failures:(before?.status === 'failed' && before.channel === channel ? before.failures : 0) + 1, at, channel, ...(reason ? {error:reason} : {})}}}
}
// One call to the channel: {kind, ref, emotionId, channel, at, ms, failed?, cost?} (cost as the image entry returns it).
export const noteDrawn = (record, entry) => ({...record, drawn:[...(record.drawn || []), entry]})
export function jobsLanded(record, jobs) {
  const next = structuredClone(record)
  for (const job of jobs) {
    delete next.jobs[jobKey(job)]
    if (job.kind === 'sprite') delete next.misses[figureKey(job.ref)]?.[job.emotionId]
  }
  return next
}

// The 外貌 of these figures reached their 人物库 record (with their pictures, or deliver after a restart): the record keeps no copy.
export function looksDelivered(record, keys) {
  if (!keys.some(key => record.appearance?.[key])) return record
  const appearance = {...record.appearance}
  for (const key of keys) delete appearance[key]
  return {...record, appearance}
}
// A round whose speakers the asset library would not write ({at, error}: its code, else its message); the last ones kept.
export const noteWriteFailure = (record, failure) => ({...record, writeFailures:[...(record.writeFailures || []), failure].slice(-10)})

// What the player sees on 自动素材's page: the latest thing that did not work (the 选角助理, the write to the pack, a
// picture), unless a picture landed after it (it works again). → {at, kind:'cast'|'write'|'draw', error} | null
export function autoCastProblem(record) {
  const rows = [...(record.castFailures || []).map(row => ({...row, kind:'cast'})), ...(record.writeFailures || []).map(row => ({...row, kind:'write'})),
    ...Object.values(record.jobs || {}).filter(job => job.status === 'failed').map(job => ({at:job.at, kind:'draw', error:job.error || ''}))]
  const latest = rows.reduce((last, row) => !last || row.at > last.at ? row : last, null)
  return latest && !(record.drawn || []).some(entry => !entry.failed && entry.at > latest.at) ? {at:latest.at, kind:latest.kind, error:latest.error} : null
}

// Casting (选角助理): the importance it judged a new figure (	ier); a speaker it found to be an existing figure under another name is never created (`same`, by name); a
// figure copied from the library is never drawn (`cast[figure] = 'copied'`); the 外貌 it wrote for a new figure waits in
// `appearance` until the figure's 人物库 record exists and takes it.
export const castDrawn = (record, figure) => record.cast?.[figureKey(figure.ref)] !== 'copied'
// failure: why the 选角助理 did not decide this round ({at, error}); its speakers were then all created new. The last ones are
// kept for whoever reads the record (the fallback alone would hide a broken assistant).
// 借用形象: the 通用角色 each person (by the name they speak under) stands in with until they have a 立绘 of their own; the
// 选角助理's look: {[name]: {figure:{packId, figureId}}}. A later lending replaces an earlier one.
export function lendLooks(record, look) {
  return {...record, looks:{...record.looks, ...Object.fromEntries(Object.entries(look).map(([name, row]) => [name, {packId:row.packId, figureId:row.figureId}]))}}
}

export function noteCasting(record, entries, same = {}, failure = null) {
  const next = {...record, same:{...record.same, ...same}, cast:{...record.cast}, appearance:{...record.appearance},
    ...(failure ? {castFailures:[...(record.castFailures || []), failure].slice(-10)} : {})}
  for (const entry of entries) if (entry.ref) {
    const key = figureKey(entry.ref)
    if (entry.copied) next.cast[key] = 'copied'
    if (entry.appearance) next.appearance[key] = entry.appearance
    if (entry.importance) next.tier = {...next.tier, [key]:entry.importance}
  }
  return next
}
