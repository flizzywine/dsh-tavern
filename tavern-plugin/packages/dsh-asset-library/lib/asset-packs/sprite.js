import layeredContract from '../shared/layered-sprite.cjs'
import imageContract from '../shared/sprite-images.cjs'
import { assertJson, check, shape, text, oneOf, array, unique, record, relativePath, validateStateId, validateShortId } from './common.js'
const rectKeys = ['x', 'y', 'w', 'h']
const events = ['closed', 'small', 'mid', 'open']
function source(value, path) { relativePath(value, path); check(/\.(png|webp)$/i.test(value), path, 'Sprite sources must be PNG/WebP paths') }
function rect(value, path) { shape(value, rectKeys, rectKeys, path) }
// optional authored blink patch, drawn over the base at a fixed base-canvas rect. Decoded sizes are
// verified at import.
export function validateBlink(value, path, canvas) {
  shape(value, ['closed', 'half', 'rect', 'blend'], ['closed', 'rect'], path)
  if (value.blend !== undefined) oneOf(value.blend, ['replace'], path + '.blend')
  source(value.closed, path + '.closed')
  if (value.half !== undefined) { source(value.half, path + '.half'); check(value.half !== value.closed, path + '.half') }
  array(value.rect, path + '.rect', 4)
  const [x, y, w, h] = value.rect
  check(value.rect.length === 4 && value.rect.every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && w <= 1024 && h <= 1024, path + '.rect')
  if (canvas) check(x + w <= canvas[0] && y + h <= canvas[1], path + '.rect', 'Blink rect outside the sprite')
}
function view(value, path) {
  shape(value, ['src', 'width', 'height', 'mouth', 'mouthByFrame', 'mouthOcclusionMask', 'mouthFrames', 'blink'], ['src', 'width', 'height'], path)
  source(value.src, path + '.src')
  if (value.blink !== undefined) validateBlink(value.blink, path + '.blink', [value.width, value.height])
  // view-specific event mappings resolve within the selected state atlas.
  if (value.mouthFrames !== undefined) record(value.mouthFrames, path + '.mouthFrames', (id, p, key) => { check(events.includes(key), p, 'mouthFrames requires exactly closed/small/mid/open'); validateShortId(id, p) })
  if (value.mouth !== undefined) rect(value.mouth, path + '.mouth')
  if (value.mouthByFrame !== undefined) record(value.mouthByFrame, path + '.mouthByFrame', rect)
  if (value.mouthOcclusionMask !== undefined) source(value.mouthOcclusionMask, path + '.mouthOcclusionMask')
}
function atlas(value, path) {
  shape(value, ['src', 'width', 'height', 'frames', 'defaultFrames'], ['src', 'width', 'height', 'frames'], path)
  source(value.src, path + '.src'); record(value.frames, path + '.frames', (frame, p) => {
    shape(frame, [...rectKeys, 'replace'], rectKeys, p)
    if (frame.replace !== undefined) check(typeof frame.replace === 'boolean', p + '.replace')
  })
  if (value.defaultFrames !== undefined) record(value.defaultFrames, path + '.defaultFrames', (id, p, key) => { check(events.includes(key), p, 'mouthFrames requires exactly closed/small/mid/open'); validateShortId(id, p) })
}
export function validateSpriteManifest(value, path = '$') {
  assertJson(value)
  const flat = value?.kind === 'static-sprites'
  const imageFormat = imageContract.spriteUsesImages(value), table = imageFormat ? 'images' : 'emotions'
  // A static-sprites manifest is plain stills; every mouth and blink lives in layered-static-sprites.
  shape(value, flat ? ['version','kind',table] : ['version','kind','character','closedBehavior','mouthAtlas','mouthSets',table], ['version','kind',table], path)
  const entries = [], sets = new Set()
  record(value[table], path + '.' + table, (entry, p, id) => {
    if (imageFormat) validateStateId(id,p)
    else check(/^[a-z][a-z0-9_-]{0,23}$/.test(id) && id !== 'default', p, 'Canonical figure emotion ID required')
    shape(entry, flat ? ['src'] : ['initialPhoneme','mouthSet','mouthFrames','closedMouthFrame','stage','portrait'], flat ? ['src'] : ['stage'], p)
    entries.push({id, ...entry})
    if (entry.mouthSet !== undefined) sets.add(entry.mouthSet)
  })
  check(entries.length > 0, path + '.' + table, 'At least one sprite image required')
  for (const key of Object.keys(value.mouthSets || {})) check(sets.has(key), path + '.mouthSets.' + key, 'Unused mouth set cannot be installed')
  if (value.mouthAtlas) check(entries.some(entry => entry.mouthSet === undefined), path + '.mouthAtlas', 'Unused mouth atlas cannot be installed')
  const {emotions, images, ...render} = value
  if (imageFormat) render.version = flat ? 1 : 2
  validateSpriteRenderManifest({...render, states:entries, defaultState:entries.find(entry => entry.id === 'calm')?.id || entries[0].id}, path)
  return value
}
function validateSpriteRenderManifest(value, path = '$') {
  assertJson(value)
  if (value?.kind === 'static-sprites') return validateStaticSprite(value, path)
  shape(value, ['version', 'kind', 'character', 'closedBehavior', 'defaultState', 'mouthAtlas', 'mouthSets', 'states'], ['version', 'kind', 'character', 'closedBehavior', 'states'], path)
  oneOf(value.version, [2], path + '.version'); oneOf(value.kind, ['layered-static-sprites'], path + '.kind')
  shape(value.character, ['id', 'name'], ['id', 'name'], path + '.character'); validateShortId(value.character.id); text(value.character.name, path + '.character.name', 160)
  oneOf(value.closedBehavior, ['restore-base'], path + '.closedBehavior')
  if (value.mouthAtlas !== undefined) atlas(value.mouthAtlas, path + '.mouthAtlas')
  if (value.mouthSets !== undefined) record(value.mouthSets, path + '.mouthSets', (set, p, key) => { validateStateId(key, p); atlas(set, p) })
  check(Array.isArray(value.states), path + '.states', 'Expected array'); check(value.states.length > 0, path + '.states')
  for (const [i, state] of value.states.entries()) {
    const p = `${path}.states[${i}]`
    shape(state, ['id', 'label', 'emotion', 'initialPhoneme', 'mouthSet', 'mouthFrames', 'closedMouthFrame', 'stage', 'portrait'], ['id', 'stage'], p)
    validateStateId(state.id, p + '.id')
    if (state.label !== undefined) text(state.label, p + '.label', 160)
    if (state.emotion !== undefined) validateStateId(state.emotion, p + '.emotion')
    view(state.stage, p + '.stage'); if (state.portrait !== undefined) view(state.portrait, p + '.portrait')
  }
  unique(value.states.map(s => s.id), path + '.states')
  const defaultState = value.defaultState === undefined ? (value.states.some(s => s.id === 'calm') ? 'calm' : value.states[0].id) : value.defaultState
  check(value.states.some(s => s.id === defaultState), path + '.defaultState')
  // Reuse the established pixel/atlas checks without its lossy normalization.
  // Surrogate IDs avoid imposing the existing parser's narrower state-name limit.
  const ids = new Map(value.states.map((s, i) => [s.id, 'state_' + i]))
  const candidate = { ...value, defaultState: ids.get(defaultState), states: value.states.map(s => ({ ...s, id: ids.get(s.id), portrait: s.portrait || s.stage })) }
  try { layeredContract.layeredSpriteAssets(layeredContract.layeredSpriteManifest(candidate)) } catch (error) { check(false, path, 'Invalid layered sprite: ' + error.message) }
  return value
}
// Plain stills: one image per state, nothing else.
function validateStaticSprite(value, path) {
  shape(value, ['version', 'kind', 'defaultState', 'states'], ['version', 'kind', 'defaultState', 'states'], path)
  oneOf(value.version, [1], path + '.version'); check(Array.isArray(value.states), path + '.states', 'Expected array'); check(value.states.length > 0, path)
  for (const state of value.states) { shape(state, ['id', 'src'], ['id', 'src'], path + '.states'); validateStateId(state.id); source(state.src, path) }
  unique(value.states.map(s => s.id), path + '.states'); check(value.states.some(s => s.id === value.defaultState), path + '.defaultState')
  return value
}
export function spriteResourcePaths(value) {
  const paths = new Set()
  const walk = item => { if (item && typeof item === 'object') for (const [key, v] of Object.entries(item)) {
    if (['src', 'mouthOcclusionMask'].includes(key)) paths.add(v)
    else if (key === 'blink') { paths.add(v.closed); if (v.half) paths.add(v.half) }
    else walk(v)
  } }
  walk(value); return [...paths]
}
