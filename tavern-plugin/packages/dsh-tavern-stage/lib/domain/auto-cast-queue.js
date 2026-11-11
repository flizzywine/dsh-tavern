// 自动选角's generation queue. Pure: the record (one per card, kept by the runtime) and
// the cast it reads (the figures of the card's 自动生成 pack) in, the next picture out. Nothing here draws or writes.
//
// Record: {version:1, misses:{[figure]:{[emotionId]:n}}, lines:{[figure]:n}, jobs:{[jobKey]:{…}},
// channels:{[channel]:{transparent:false}}}. `figure` is packId/figureId. A job is only kept while it is ready (drawn,
// not yet landed) or has failed; what is done is read from the cast, never stored twice.

// The standard emotions in the order a figure's lines use them (gap.md §7: 平和 35.8%, 紧张 20.0%, 喜悦 17.9% …).
export const AUTO_CAST_EMOTIONS = Object.freeze(['calm', 'anxious', 'joy', 'sad', 'shy', 'crying', 'disgust', 'anger', 'love'])
const COMMON = 3, MAX_FAILURES = 2, FAILURE_PAUSE_MS = 30 * 60_000

export const emptyAutoCastRecord = () => ({version:1, misses:{}, lines:{}, jobs:{}, channels:{}, cast:{}, same:{}, appearance:{}})
export const figureKey = ref => ref.packId + '/' + ref.figureId
// One picture: a figure's 人设图, or one emotion's 立绘 (in the outfit it lands in; null = the figure's first outfit).
export const jobKey = job => JSON.stringify([job.kind, job.ref.packId, job.ref.figureId, job.kind === 'sprite' ? job.emotionId : null])

// A round's lines, counted once when the round is committed: each line of an automatic figure counts toward its lines;
// a line whose emotion has no 立绘 yet is one miss of that (figure, emotion). requests: [{ref, emotionId|null}].
export function noteRound(record, requests, cast) {
  const next = structuredClone(record), byKey = new Map(cast.map(row => [figureKey(row.ref), row]))
  for (const {ref, emotionId} of requests) {
    const key = figureKey(ref), figure = byKey.get(key)
    if (!figure) continue
    next.lines[key] = (next.lines[key] || 0) + 1
    if (!emotionId || figure.sprites.includes(emotionId)) continue
    next.misses[key] ??= {}
    next.misses[key][emotionId] = (next.misses[key][emotionId] || 0) + 1
  }
  return next
}

// The jobs to draw, best first. cast: [{ref, settei:boolean, sprites:[emotionId]}] (the automatic pack's figures);
// level: late | eager | all; sprites: false while the channel cannot draw a transparent picture. Skipped: a job ready or in
// flight (`busy`: Set of job keys), or one that failed MAX_FAILURES times in a row, for FAILURE_PAUSE_MS after the last.
//   1. What the story asked for and has no picture, by misses; a figure with no 立绘 at all puts its 人设图 and its first
//      立绘 in front of everything else.
//   2. (积极 / 全部) The common emotions (平和 → 紧张 → 喜悦) of each figure in turn, the one with more lines first, then the
//      rest of the standard order. 积极 covers the figures who have spoken (the opening's speakers too); 全部 every figure.
// A 立绘 is drawn from the figure's 人设图: a figure without one has only its 人设图 planned (the runtime counts a drawn,
// not yet landed 人设图 as there).
export function planAutoCast(record, cast, level, {busy = new Set(), sprites = true, now = 0} = {}) {
  const jobs = [], seen = new Set()
  const usable = job => {
    const key = jobKey(job), stored = record.jobs[key]
    return !seen.has(key) && !busy.has(key) && stored?.status !== 'ready' && !(stored?.status === 'failed' && stored.failures >= MAX_FAILURES && now - stored.at < FAILURE_PAUSE_MS)
  }
  const add = (figure, emotionId) => {
    const settei = {kind:'identity-settei', ref:figure.ref}
    if (!figure.settei) { if (usable(settei)) { jobs.push(settei); seen.add(jobKey(settei)) } return }
    if (!sprites) return
    const sprite = {kind:'sprite', ref:figure.ref, emotionId}
    if (!figure.sprites.includes(emotionId) && usable(sprite)) { jobs.push(sprite); seen.add(jobKey(sprite)) }
  }
  const asked = figure => Object.entries(record.misses[figureKey(figure.ref)] || {}).filter(([id]) => !figure.sprites.includes(id)).sort((a, b) => b[1] - a[1])
  const total = figure => asked(figure).reduce((sum, [, n]) => sum + n, 0)
  const requested = cast.filter(figure => total(figure) > 0)
  // 1a. no 立绘 yet: its 人设图, else its first 立绘, first; the figure missed most first.
  for (const figure of requested.filter(row => !row.sprites.length).sort((a, b) => total(b) - total(a))) add(figure, asked(figure)[0][0])
  // 1b. every other requested (figure, emotion), by misses.
  const rows = requested.flatMap(figure => asked(figure).map(([emotionId, n]) => ({figure, emotionId, n}))).sort((a, b) => b.n - a.n)
  for (const row of rows) add(row.figure, row.emotionId)
  if (level === 'late') return jobs
  // 2. idle work.
  const lines = figure => record.lines[figureKey(figure.ref)] || 0
  const reach = level === 'all' ? cast : cast.filter(figure => lines(figure) > 0)
  const ordered = [...reach].sort((a, b) => lines(b) - lines(a))
  for (const [from, to] of [[0, COMMON], [COMMON, AUTO_CAST_EMOTIONS.length]]) for (const figure of ordered)
    for (const emotionId of AUTO_CAST_EMOTIONS.slice(from, to)) add(figure, emotionId)
  return jobs
}

// Bookkeeping of one job: drawn (bytes kept by the runtime until landed), failed, or landed (forgotten; a landed 立绘 also
// clears its misses).
export function jobReady(record, job, file, at) {
  return {...record, jobs:{...record.jobs, [jobKey(job)]:{...job, status:'ready', file, at}}}
}
// error: why it failed (its code, else its message), kept with the job for whoever reads the record.
export function jobFailed(record, job, at, error = null) {
  const key = jobKey(job), before = record.jobs[key], reason = error && String(error.code || error.message || error).slice(0, 200)
  return {...record, jobs:{...record.jobs, [key]:{...job, status:'failed', failures:(before?.status === 'failed' ? before.failures : 0) + 1, at, ...(reason ? {error:reason} : {})}}}
}
export function jobsLanded(record, jobs) {
  const next = structuredClone(record)
  for (const job of jobs) {
    delete next.jobs[jobKey(job)]
    if (job.kind === 'sprite') delete next.misses[figureKey(job.ref)]?.[job.emotionId]
  }
  return next
}
// A channel that returned an opaque 立绘 cannot draw transparent pictures: no more 立绘 go to it (its status() may say so
// first: `transparent: false`).
export const channelOpaque = (record, channel) => ({...record, channels:{...record.channels, [channel]:{transparent:false}}})
export const channelDrawsSprites = (record, channel, status) => status?.transparent !== false && record.channels[channel]?.transparent !== false

// Casting (选角助理): a speaker it found to be an existing figure under another name is never created (`same`, by name); a
// figure copied from the library is never drawn (`cast[figure] = 'copied'`); the 外貌 it wrote for a new figure waits in
// `appearance` until the figure's 人物库 record exists and takes it.
export const castDrawn = (record, figure) => record.cast?.[figureKey(figure.ref)] !== 'copied'
export function noteCasting(record, entries, same = {}) {
  const next = {...record, same:{...record.same, ...same}, cast:{...record.cast}, appearance:{...record.appearance}}
  for (const entry of entries) if (entry.ref) {
    const key = figureKey(entry.ref)
    if (entry.copied) next.cast[key] = 'copied'
    if (entry.appearance) next.appearance[key] = entry.appearance
  }
  return next
}