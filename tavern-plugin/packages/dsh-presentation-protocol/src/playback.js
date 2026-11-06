import { assertJson, canonicalJson, check, fail, integer, jsonDigest, object, oneOf, parseJson, shape, text } from './json.js'
export { projectIncrementalStageState } from './playback-state.js'
export { stageLighting, stageApplyLight, stageLightingReplay, stageLookLayer } from './stage-light.cjs'
export { stagePacing } from './stage-pacing.cjs'
export { jsonDigest as playbackDigest } from './json.js'
const digest = (value, path) => check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), path)
const map = (value, path) => check(object(value), path)
const strings = (value, path) => { check(Array.isArray(value) && value.length <= 10000, path); for (const item of value) text(item, path) }
const clone = value => structuredClone(value)
const finite = (value, path, min, max) => check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, path)
function figureScale(value, path, event = false) {
  shape(value, ['version', 'scene', 'hMax', 'groundRatio', 'rescales', ...(event ? ['event'] : [])], path)
  check(value.version === 6, `${path}.version`); integer(value.scene, `${path}.scene`); integer(value.rescales, `${path}.rescales`)
  finite(value.hMax, `${path}.hMax`, 1, 1000)
  if (value.groundRatio !== undefined) finite(value.groundRatio, `${path}.groundRatio`, .001, 1000)
  if (event && value.event !== null) {
    shape(value.event, ['kind', 'at', 'from', 'warning'], `${path}.event`)
    oneOf(value.event.kind, ['cut', 'rescale'], `${path}.event.kind`); integer(value.event.at, `${path}.event.at`)
    if (value.event.from !== undefined) finite(value.event.from, `${path}.event.from`, 1, 1000)
    if (value.event.warning !== undefined) text(value.event.warning, `${path}.event.warning`, 100)
  }
}

export function validateTargetRef(value) {
  assertJson(value)
  shape(value, ['sessionId', 'chatId', 'branchId', 'revision', 'turn', 'messageId', 'messageIdentity', 'swipeId', 'sourceDigest', 'prefixDigest', 'sourceKey'], 'target')
  for (const key of ['sessionId', 'chatId', 'branchId', 'sourceKey']) text(value[key], `target.${key}`)
  for (const key of ['revision', 'swipeId', 'messageId']) integer(value[key], `target.${key}`)
  integer(value.turn, 'target.turn', 1)
  if (value.messageIdentity !== null) text(value.messageIdentity, 'target.messageIdentity')
  for (const key of ['sourceDigest', 'prefixDigest']) digest(value[key], `target.${key}`)
  return value
}
export function validatePlaybackState(state) {
  assertJson(state)
  shape(state, ['scene', 'sceneCleared', 'cast', 'order', 'outfits', 'positions', 'focus', 'look', 'figureLight', 'music', 'weather', 'soundscape', 'light', 'lighting', 'camera', 'dof', 'widgetState', 'phone', 'figureScale', 'assetRefs'], 'state')
  for (const key of ['scene', 'music', 'light', 'dof']) text(state[key], `state.${key}`, 256, true)
  check(typeof state.sceneCleared === 'boolean', 'state.sceneCleared')
  strings(state.cast, 'state.cast'); strings(state.order, 'state.order')
  check(new Set(state.cast).size === state.cast.length && new Set(state.order).size === state.order.length && state.order.length === state.cast.length && state.order.every(id => state.cast.includes(id)), 'state.order')
  for (const key of ['outfits', 'positions', 'focus', 'look', 'figureLight']) { map(state[key], `state.${key}`); for (const item of Object.values(state[key])) text(item, `state.${key}`, 256, true) }
  oneOf(state.weather, ['none', 'rain', 'storm', 'snow', 'sakura', 'leaves', 'sparkle'], 'state.weather')
  shape(state.lighting, ['time', 'mood'], 'state.lighting'); text(state.lighting.time, 'state.lighting.time'); text(state.lighting.mood, 'state.lighting.mood')
  shape(state.camera, ['value', 'id'], 'state.camera'); text(state.camera.value, 'state.camera.value', 32, true)
  if (state.camera.id !== undefined) text(state.camera.id, 'state.camera.id')
  shape(state.soundscape, ['scene', 'sceneKey', 'weather', 'tags'], 'state.soundscape')
  text(state.soundscape.scene, 'state.soundscape.scene', 256, true)
  if (state.soundscape.sceneKey !== undefined) text(state.soundscape.sceneKey, 'state.soundscape.sceneKey', 1024)
  check(state.soundscape.weather === state.weather, 'state.soundscape.weather')
  const tags = state.soundscape.tags
  check(Array.isArray(tags) && tags.length <= 2 && new Set(tags).size === tags.length && tags.every(tag => ['empty', 'open', 'sheltered', 'sealed'].includes(tag)) && tags.filter(tag => tag !== 'empty').length <= 1, 'state.soundscape.tags')
  shape(state.widgetState, ['version', 'time', 'scene', 'widgets'], 'state.widgetState')
  check(state.widgetState.version === 1, 'state.widgetState.version'); integer(state.widgetState.time, 'state.widgetState.time')
  text(state.widgetState.scene, 'state.widgetState.scene', 256, true)
  check(Array.isArray(state.widgetState.widgets) && state.widgetState.widgets.length <= 3, 'state.widgetState.widgets')
  assertJson(state.widgetState.widgets, { maxBytes: 12 * 1024 })
  const widgets = new Set()
  for (const widget of state.widgetState.widgets) {
    shape(widget, ['widgetId', 'type', 'props', 'slot', 'slotExplicit', 'lifetime', 'bornStoryTime', 'deadline', 'originKey', 'instanceId', 'bornAt', 'order'], 'widget')
    text(widget.widgetId, 'widget.widgetId'); check(!widgets.has(widget.widgetId), 'widget.widgetId'); widgets.add(widget.widgetId)
    text(widget.type, 'widget.type'); map(widget.props, 'widget.props')
    oneOf(widget.slot, ['top-center', 'corner-left', 'corner-right', 'center-card'], 'widget.slot')
    if (widget.slotExplicit !== undefined) check(typeof widget.slotExplicit === 'boolean', 'widget.slotExplicit')
    shape(widget.lifetime, ['until', 'durationSeconds'], 'widget.lifetime')
    oneOf(widget.lifetime.until, ['explicit', 'scene-change', 'turn-end'], 'widget.lifetime.until')
    if (widget.lifetime.durationSeconds !== undefined) integer(widget.lifetime.durationSeconds, 'widget.lifetime.durationSeconds', 1, 86400)
    for (const key of ['bornStoryTime', 'order']) integer(widget[key], `widget.${key}`)
    integer(widget.bornAt, 'widget.bornAt', 1)
    if (widget.deadline !== null) integer(widget.deadline, 'widget.deadline')
    for (const key of ['originKey', 'instanceId']) text(widget[key], `widget.${key}`, 256, true)
  }
  // Phone data links back to publication units, never duplicates prose or speech.
  shape(state.phone, ['messages'], 'state.phone'); check(Array.isArray(state.phone.messages), 'state.phone.messages')
  for (const message of state.phone.messages) {
    shape(message, ['unit', 'contact', 'side'], 'state.phone.message'); text(message.contact, 'state.phone.contact'); oneOf(message.side, ['in', 'out'], 'state.phone.side')
    shape(message.unit, ['publicationId', 'partId', 'unitIndex', 'sourceRange', 'unitDigest'], 'unit')
    text(message.unit.publicationId, 'unit.publicationId'); text(message.unit.partId, 'unit.partId'); integer(message.unit.unitIndex, 'unit.unitIndex')
    digest(message.unit.unitDigest, 'unit.unitDigest')
    check(Array.isArray(message.unit.sourceRange) && message.unit.sourceRange.length === 2, 'unit.sourceRange')
    integer(message.unit.sourceRange[0], 'unit.sourceRange'); integer(message.unit.sourceRange[1], 'unit.sourceRange', message.unit.sourceRange[0])
  }
  if (state.figureScale !== undefined) figureScale(state.figureScale, 'state.figureScale')
  if (state.assetRefs !== undefined) {
    map(state.assetRefs, 'state.assetRefs')
    for (const ref of Object.values(state.assetRefs)) {
      if (ref === null) continue
      shape(ref, ['source', 'libraryId', 'id', 'revision'], 'state.assetRefs.ref')
      for (const key of ['source', 'id']) check(typeof ref[key] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(ref[key]), `state.assetRefs.${key}`)
      if (ref.libraryId !== undefined) text(ref.libraryId, 'state.assetRefs.libraryId', 128, true)
      if (ref.revision !== undefined) text(ref.revision, 'state.assetRefs.revision', 256)
    }
  }
  return state
}
function validateEvent(event) {
  shape(event, ['op', 'id', 'value'], 'event')
  oneOf(event.op, ['act', 'emote', 'beat', 'sfx', 'title', 'trans', 'focus'], 'event.op')
  text(event.value, 'event.value', event.op === 'title' ? 96 : 256)
  if (event.id !== undefined) text(event.id, 'event.id')
  if (['act', 'emote', 'focus'].includes(event.op)) text(event.id, 'event.id')
  if (event.op === 'title') check([...event.value].length <= 24, 'event.value')
  const values = {
    act: ['nod', 'shake', 'jump', 'tremble', 'turn', 'bow', 'lean', 'step-back'],
    emote: ['!', '?', '...', 'sweat', 'anger', 'heart', 'note', 'gloom', 'sparkle', 'blush'],
    beat: ['shake-1', 'shake-2', 'shake-3', 'flash', 'flash-red', 'glitch', 'shock', 'heartbeat', 'blur', 'blackout'],
    trans: ['cut', 'fade', 'black', 'white', 'wipe', 'iris'], focus: ['close']
  }
  if (values[event.op]) oneOf(event.value, values[event.op], 'event.value')
  if (event.op === 'sfx') check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(event.value), 'event.value')
}
export function validatePlaybackRecord(value) {
  assertJson(value)
  if (value?.version !== 3) fail('version', 'Playback migration required', 'MIGRATION_REQUIRED')
  shape(value, ['version', 'target', 'publicationDigest', 'unitizerRevision', 'canonicalEffectDigest', 'provenance', 'units', 'start', 'changes', 'events', 'figureCatalog', 'soundscapeScenes', 'rulesHash', 'metadata'], '$')
  validateTargetRef(value.target); digest(value.publicationDigest, 'publicationDigest'); text(value.unitizerRevision, 'unitizerRevision')
  shape(value.provenance, ['kind', 'sourceDigest'], 'provenance'); oneOf(value.provenance.kind, ['canonical-effect', 'offline-import'], 'provenance.kind'); digest(value.provenance.sourceDigest, 'provenance.sourceDigest')
  if (value.provenance.kind === 'canonical-effect') digest(value.canonicalEffectDigest, 'canonicalEffectDigest')
  else check(value.canonicalEffectDigest === null && value.provenance.sourceDigest === value.target.sourceDigest, 'provenance.sourceDigest')
  integer(value.units, 'units', 1, 100000); validatePlaybackState(value.start)
  check(Array.isArray(value.changes), 'changes'); let at = 0
  for (const change of value.changes) { shape(change, ['at', 'state'], 'changes'); integer(change.at, 'changes.at', at + 1, value.units); at = change.at; validatePlaybackState(change.state) }
  check(Array.isArray(value.events), 'events'); const ids = new Set(), ordinals = new Map(); at = 1
  for (const event of value.events) {
    shape(event, ['id', 'at', 'event'], 'events'); text(event.id, 'events.id'); integer(event.at, 'events.at', at, value.units); at = event.at
    const ordinal = ordinals.get(event.at) || 0
    check(event.id === playbackEventId(value.publicationDigest, event.at, ordinal), 'events.id', 'Expected deterministic event identity')
    ordinals.set(event.at, ordinal + 1)
    check(!ids.has(event.id), 'events.id'); ids.add(event.id); validateEvent(event.event)
  }
  map(value.figureCatalog, 'figureCatalog')
  for (const variants of Object.values(value.figureCatalog)) {
    map(variants, 'figureCatalog.variants')
    for (const measurements of Object.values(variants)) {
      check(Array.isArray(measurements) && measurements.length > 0, 'figureCatalog.measurements')
      for (const measurement of measurements) {
        shape(measurement, ['heightCm', 'elevationCm', 'headRatio'], 'figureCatalog.measurement')
        finite(measurement.heightCm, 'figureCatalog.heightCm', 1, 1000); finite(measurement.elevationCm, 'figureCatalog.elevationCm', 0, 500)
        finite(measurement.headRatio, 'figureCatalog.headRatio', .001, 1000)
      }
    }
  }
  check(Array.isArray(value.soundscapeScenes), 'soundscapeScenes')
  for (const scene of value.soundscapeScenes) {
    shape(scene, ['name', 'source', 'libraryId', 'id', 'soundscape'], 'soundscapeScenes.scene')
    for (const key of ['name', 'source', 'libraryId', 'id']) text(scene[key], `soundscapeScenes.${key}`, 256, true)
    shape(scene.soundscape, ['place', 'exposure', 'people', 'warnings'], 'soundscapeScenes.soundscape')
    text(scene.soundscape.place, 'soundscapeScenes.place', 128); oneOf(scene.soundscape.exposure, ['open', 'indoor', 'sheltered', 'sealed'], 'soundscapeScenes.exposure')
    if (scene.soundscape.people !== undefined) check(typeof scene.soundscape.people === 'boolean', 'soundscapeScenes.people')
    strings(scene.soundscape.warnings, 'soundscapeScenes.warnings')
  }
  digest(value.rulesHash, 'rulesHash')
  shape(value.metadata, ['warnings', 'usage', 'origin'], 'metadata')
  if (value.metadata.warnings !== undefined) strings(value.metadata.warnings, 'metadata.warnings')
  if (value.metadata.origin !== undefined) check(value.metadata.origin === value.provenance.kind, 'metadata.origin')
  if (value.metadata.usage !== undefined) {
    shape(value.metadata.usage, ['inputTokens', 'outputTokens', 'totalTokens'], 'metadata.usage')
    for (const [key, number] of Object.entries(value.metadata.usage)) integer(number, `metadata.usage.${key}`)
  }
  return clone(value)
}
export function compactPlaybackRecord(value) {
  const record = validatePlaybackRecord(value)
  let previous = canonicalJson(record.start)
  record.changes = record.changes.filter(change => { const next = canonicalJson(change.state); if (next === previous) return false; previous = next; return true })
  return record
}
export async function encodePlaybackRecord(value) {
  const record = compactPlaybackRecord(value)
  return { json: canonicalJson(record), recordDigest: await jsonDigest(record) }
}
export async function decodePlaybackRecord(source, expected) {
  const record = validatePlaybackRecord(parseJson(source))
  check(object(expected), 'expected', 'Expected target/publication/digest binding')
  digest(expected.recordDigest, 'expected.recordDigest'); validateTargetRef(expected.target); digest(expected.publicationDigest, 'expected.publicationDigest')
  if (await jsonDigest(record) !== expected.recordDigest) fail('recordDigest', 'Playback digest mismatch', 'DIGEST_MISMATCH')
  if (canonicalJson(record.target) !== canonicalJson(expected.target) || record.publicationDigest !== expected.publicationDigest) fail('target', 'Playback target mismatch', 'STALE_TARGET')
  return record
}
export function seekPlayback(value, paragraph) {
  const record = validatePlaybackRecord(value); integer(paragraph, 'paragraph', 0, record.units)
  let state = record.start
  for (const change of record.changes) { if (change.at > paragraph) break; state = change.state }
  return clone(state)
}
export function playbackEventsBetween(value, from, through) {
  const record = validatePlaybackRecord(value); integer(from, 'from', 0, record.units); integer(through, 'through', 0, record.units)
  return through <= from ? [] : clone(record.events.filter(event => event.at > from && event.at <= through))
}
export function playbackEventId(publicationDigest, at, ordinal) {
  digest(publicationDigest, 'publicationDigest'); integer(at, 'at', 1); integer(ordinal, 'ordinal')
  return `${publicationDigest}:${at}:${ordinal}`
}
export function validatePlaybackIndex(value) {
  assertJson(value)
  if (value?.version !== 3) fail('version', 'Playback index migration required', 'MIGRATION_REQUIRED')
  shape(value, ['version', 'records'], '$'); check(Array.isArray(value.records), 'records')
  const keys = new Set()
  for (const pointer of value.records) {
    shape(pointer, ['recordKey', 'target', 'publicationDigest', 'recordDigest', 'origin'], 'pointer')
    check(typeof pointer.recordKey === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(pointer.recordKey), 'pointer.recordKey')
    check(!keys.has(pointer.recordKey), 'pointer.recordKey'); keys.add(pointer.recordKey)
    validateTargetRef(pointer.target); digest(pointer.publicationDigest, 'pointer.publicationDigest'); digest(pointer.recordDigest, 'pointer.recordDigest')
    oneOf(pointer.origin, ['canonical-effect', 'offline-import'], 'pointer.origin')
  }
  return clone(value)
}
export function encodePlaybackIndex(value) { return canonicalJson(validatePlaybackIndex(value)) }
export function decodePlaybackIndex(source) { return validatePlaybackIndex(parseJson(source)) }
