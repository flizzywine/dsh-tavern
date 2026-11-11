// card-level opening scenes. Storage shape only.
import { createHash } from 'node:crypto'
import { TIMES_OF_DAY, validateAssetRef, validateFigureRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { check, shape, text, array, unique, object } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const OPENING_ID = /^(?:primary|alternate:\d{1,4})$/
// Greeting text fingerprint: a scene follows its greeting when alternates are reordered.
export const greetingKey = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)

// openings = {lead?: alias, scenes?: {[openingId]: {greeting, title?, summary?, background, timeOfDay, music, cast:[{alias, outfitKey, emotion}]}}}
// title: the greeting's short display name, written by the card author (an opening page names the greeting by it);
// summary: one plain sentence of what this opening is about, for a player choosing between greetings (up to 60 chars).
export function validateCardOpenings(value, path = '$.openings') {
  shape(value, ['lead', 'scenes'], [], path)
  if (value.lead !== undefined) validateFigureRef(value.lead, path + '.lead')
  if (value.scenes === undefined) return value
  check(object(value.scenes), path + '.scenes')
  for (const [id, scene] of Object.entries(value.scenes)) {
    const p = path + '.scenes.' + id
    check(OPENING_ID.test(id), p, 'Unknown greeting')
    shape(scene, ['greeting', 'title', 'summary', 'background', 'timeOfDay', 'music', 'cast', 'cg'], ['greeting', 'background', 'timeOfDay', 'music', 'cast'], p)
    check(/^[0-9a-f]{16}$/.test(scene.greeting), p + '.greeting')
    if (scene.title !== undefined) {
      text(scene.title, p + '.title', 12)
      check(scene.title.trim() === scene.title, p + '.title', 'Title must be a short name without surrounding spaces, e.g. 竹取之夜')
    }
    if (scene.summary !== undefined) {
      text(scene.summary, p + '.summary', 60)
      check(scene.summary.trim() === scene.summary, p + '.summary', 'Summary must be one sentence without surrounding spaces, e.g. 她第一次登入虚拟城，一落地就撞上了你')
    }
    if (scene.background !== null) validateAssetRef(scene.background, p + '.background', 'backgrounds')
    if (scene.music !== null) validateAssetRef(scene.music, p + '.music', 'music')
    // opening CG is independent of the underlying background.
    if (scene.cg !== undefined) {
      shape(scene.cg, ['ref','variant'], ['ref'], p + '.cg')
      validateAssetRef(scene.cg.ref, p + '.cg.ref', 'cg')
      if (scene.cg.variant !== undefined) text(scene.cg.variant, p + '.cg.variant', 64)
    }
    check(scene.timeOfDay === null || TIMES_OF_DAY.includes(scene.timeOfDay), p + '.timeOfDay')
    array(scene.cast, p + '.cast', 3)
    scene.cast.forEach((entry, i) => {
      shape(entry, ['figure', 'outfitKey', 'emotion'], ['figure', 'outfitKey', 'emotion'], p + '.cast.' + i)
      validateFigureRef(entry.figure, p + '.cast.' + i + '.figure')
      if (entry.outfitKey !== null) text(entry.outfitKey, p + '.cast.' + i + '.outfitKey', 64)
      text(entry.emotion, p + '.cast.' + i + '.emotion', 40)
    })
    unique(scene.cast.map(entry => entry.figure.packId + '/' + entry.figure.figureId), p + '.cast')
  }
  return value
}
