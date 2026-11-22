// Use accepted forward playback only; historical replay must not make a track stale.
export const musicFreshness = Object.freeze({ recentStarts: 3, recentRounds: 12 })

export function musicIsStale({starts = 0} = {}) {
  return starts >= musicFreshness.recentStarts
}

export const automaticMusicOrigin = 'dsh.auto-music'
export const automaticMusicCue = '这是后台生成完成的候选曲。若仍符合当前场景，且尚未开始播放，等到下一处适合换曲的段落再用 music.set；不要打断合适的当前曲或追补已经过去的场景。'

const trackKey = ref => JSON.stringify([ref.packId, ref.assetId])
export function recentMusicStarts(records) {
  const counts = new Map()
  const recent = records.slice(-musicFreshness.recentRounds)
  const carried = recent[0]?.baseline?.music
  let last = carried ? trackKey(carried) : null
  for (const record of recent) for (const {state} of record.entries) {
    const key = state.music ? trackKey(state.music) : null
    if (key && key !== last) counts.set(key, (counts.get(key) || 0) + 1)
    last = key
  }
  return ref => ({starts:counts.get(trackKey(ref)) || 0})
}

export function chooseAutomaticMusic({ suitable, usage, current, nearest, reason }) {
  const reusable = suitable.find(ref => !musicIsStale(usage(ref)))
  if (reusable) return {reuse:reusable}
  const fallback = current ?? nearest ?? suitable[0] ?? null
  const generate = reason === 'missing' ? suitable.length === 0
    : reason === 'overused' && suitable.length > 0
  return {fallback, generate}
}

const requestFields = {name:48, mood:80, style:120, tone:120, directorNote:240, variation:120}
export const automaticMusicTool = {
  name:'request_stage_music',
  description:'仅在曲库没有合适的背景音乐，或同类合适曲目近期播得太多且没有可复用的新鲜替代时，申请异步生成。例：调查场景缺少克制、略带悬疑的器乐。仍用原导演工具选择临时曲，也可以保留当前曲。不要为换场本身生成，也不要给适合留白的场景配乐。',
  parameters:{type:'object', additionalProperties:false, required:['reason','name','mood','style','tone','directorNote','keywords'], properties:{
    reason:{type:'string', enum:['missing','overused']},
    ...Object.fromEntries(Object.entries(requestFields).map(([key, maxLength]) => [key, {type:'string', minLength:1, maxLength}])),
    name:{type:'string', minLength:1, maxLength:48, description:'简洁中文曲名，不写用途、情绪标签或 AI 后缀。例：雨夜留声。'},
    keywords:{type:'array', minItems:1, maxItems:6, items:{type:'string', minLength:1, maxLength:30}},
  }},
}

export function readAutomaticMusicRequest(args) {
  if (!args || typeof args !== 'object' || !['missing','overused'].includes(args.reason)) return null
  const valid = (value, max) => typeof value === 'string' && value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)
  if (!Array.isArray(args.keywords) || args.keywords.length < 1 || args.keywords.length > 6 || args.keywords.some(word => !valid(word,30))) return null
  const request = {reason:args.reason, keywords:[...new Set(args.keywords.map(word => word.trim()))]}
  for (const [key,max] of Object.entries(requestFields)) {
    if (key === 'variation' && args[key] === undefined) continue
    if (!valid(args[key], max)) return null
    request[key] = args[key].trim()
  }
  return request
}

const normalize = text => text.normalize('NFKC').trim().replace(/\s+/g, ' ')
export function automaticMusicPrompt({ mood, style, tone, variation }) {
  return [
    'Compose original, loopable instrumental background music for a dialogue-driven scene. No singing, humming, speech, crowd voices, or sound effects. Keep dynamics controlled and make the loop transition unobtrusive.',
    `Mood: ${normalize(mood)}. Style: ${normalize(style)}. Story tone: ${normalize(tone)}.`,
    ...(variation ? [`Variation: ${normalize(variation)}.`] : []),
  ].join(' ')
}
