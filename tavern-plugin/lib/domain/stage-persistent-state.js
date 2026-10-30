// The incremental contract applies to every persistent presentation field.
// Reuse the existing widget definitions/typed prop validator, not a second UI runtime.
import { stageWidgetBuiltins, stageWidgetProps, STAGE_WIDGET_SLOTS } from '../../src/client/stage-widgets.cjs'
import { buildSoundscapeFieldSchema, validateSoundTags } from './stage-soundscape-protocol.js'
const clone = value => structuredClone(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fail = (path, message) => { throw Object.assign(new Error(message), { path }) }
function shape(value, keys, path) {
  if (!object(value)) fail(path, 'Expected an object')
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unknown field')
}
const choice = (value, values, path) => { if (!values.includes(value)) fail(path, 'Invalid persistent field value') }
const reference = (id, state, catalog, path, present = false) => {
  if (typeof id !== 'string' || !own(catalog.actors, id) || present && !state.cast.includes(id)) fail(path, 'Unknown or unavailable actor')
}
export const stageWidgetDefinitions = catalog => catalog?.widgetsEnabled === false ? [] : [...stageWidgetBuiltins, ...(catalog?.widgets || []).filter(item => !stageWidgetBuiltins.some(builtin => builtin.id === item.id)).map(item => ({ ...item, thirdParty: true }))]
const WEATHER = ['none', 'rain', 'storm', 'snow', 'sakura', 'leaves', 'sparkle']
const CAMERA = ['reset', 'wide', 'push', 'close', 'pan-left', 'pan-right', 'dutch']
export const actorPresentationDefaults = () => ({ position: 'auto', focus: 'normal', gaze: 'viewer', figureLight: 'lit' })
// sound: scene-derived soundscape deviation tags; a scene change restores [].
export const persistentStageDefaults = () => ({ weather: 'none', sound: [], lighting: { time: 'auto', mood: 'none' }, camera: { mode: 'reset', actor: null }, dof: null, widgets: {}, widgetTime: 0 })

function mergeProps(base, patch, path) {
  if (!object(patch)) fail(path, 'Expected partial typed props')
  const result = clone(base)
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${path}.${key}`, 'Unsafe property')
    result[key] = object(value) && object(result[key]) ? mergeProps(result[key], value, `${path}.${key}`) : clone(value)
  }
  return result
}
function validateLifetime(raw, path) {
  const value = raw ?? { until: 'explicit' }
  shape(value, ['until', 'durationSeconds'], path)
  choice(value.until, ['explicit', 'scene-change', 'turn-end'], `${path}.until`)
  if (own(value, 'durationSeconds') && (!Number.isSafeInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 86400)) fail(path, 'Invalid explicit story-time lifetime')
  return clone(value)
}
export function expireStageWidgets(state, boundary) {
  for (const [id, widget] of Object.entries(state.widgets || {})) {
    if (widget.lifetime.until === boundary || widget.lifetime.durationSeconds !== undefined && state.widgetTime >= widget.bornStoryTime + widget.lifetime.durationSeconds) delete state.widgets[id]
  }
}
export function projectStageWidgets(state) {
  return Object.values(state.widgets).map(widget => ({ ...clone(widget), ...(widget.deadline !== null ? { remainingSeconds: Math.max(0, widget.deadline - state.widgetTime) } : {}) }))
}

/** undefined means this operation belongs to the older core operations. */
export function applyPersistentStageOperation(state, op, catalog, path, metadata = {}) {
  if (!object(op)) return undefined
  if (catalog.widgetsEnabled === false && (String(op.op).startsWith('widget.') || op.op === 'clock.advance')) fail(path, 'Widgets are disabled')
  if (op.op === 'stage.patch') {
    shape(op, ['op', 'value'], path)
    shape(op.value, ['weather', 'sound', 'lighting', 'camera', 'dof', 'cast'], `${path}.value`)
    const next = clone(state)
    for (const [field, value] of Object.entries(op.value)) {
      if (field === 'weather') { choice(value, WEATHER, `${path}.value.weather`); next.weather = value }
      if (field === 'sound') {
        const checked = validateSoundTags(value)
        if (checked.errors.length) fail(`${path}.value.sound`, checked.errors[0])
        next.sound = checked.tags
      }
      if (field === 'lighting') {
        shape(value, ['time', 'mood'], `${path}.value.lighting`)
        const allowed = { time: ['auto', ...(catalog.lighting?.time || [])], mood: ['none', ...(catalog.lighting?.mood || [])] }
        for (const [layer, id] of Object.entries(value)) { choice(id, allowed[layer], `${path}.value.lighting.${layer}`); next.lighting[layer] = id }
      }
      if (field === 'camera') {
        shape(value, ['mode', 'actor'], `${path}.value.camera`)
        next.camera = { ...next.camera, ...value }
        choice(next.camera.mode, CAMERA, `${path}.value.camera.mode`)
        if (next.camera.actor !== null) reference(next.camera.actor, next, catalog, `${path}.value.camera.actor`)
        if (next.camera.mode === 'close' && next.camera.actor === null) fail(`${path}.value.camera.actor`, 'Close camera needs an actor')
      }
      if (field === 'dof') { if (value !== null) reference(value, next, catalog, `${path}.value.dof`); next.dof = value }
      if (field === 'cast') {
        if (!Array.isArray(value) || value.length > (catalog.maxCast || 3) || new Set(value).size !== value.length) fail(`${path}.value.cast`, 'Invalid complete cast change')
        for (const id of value) reference(id, next, catalog, `${path}.value.cast`)
        // complete cast updates cannot rearrange survivors or insert between them.
        const kept = state.cast.filter(id => value.includes(id)), added = value.filter(id => !state.cast.includes(id))
        if (!['replay', 'projection'].includes(path) && !equal(value, kept.concat(added))) fail(`${path}.value.cast`, 'Keep existing actors in order and append arrivals; use actor.enter value to select another gap')
        next.cast = [...value]
      }
    }
    if (equal(state, next)) return false
    Object.assign(state, next); return true
  }
  if (op.op === 'actor.patch') {
    shape(op, ['op', 'actor', 'value'], path); reference(op.actor, state, catalog, `${path}.actor`)
    shape(op.value, ['position', 'focus', 'gaze', 'figureLight'], `${path}.value`)
    const historical = ['replay', 'projection'].includes(path)
    if (!historical && own(op.value, 'position')) fail(`${path}.value.position`, 'Position patches are removed; use actor.enter value: left, center, right or after:ID on arrival')
    if (!historical && own(op.value, 'focus') && op.value.focus !== 'normal') fail(`${path}.value.focus`, 'Distance focus is removed; use camera.close for brief emphasis')
    const values = { position: ['auto', 'far-left', 'left', 'center', 'right', 'far-right'], focus: ['normal', 'near', 'far'], figureLight: ['lit', 'glow', 'shadow'] }
    for (const [field, value] of Object.entries(op.value)) {
      if (field === 'gaze') { if (!['viewer', 'away'].includes(value)) reference(value, state, catalog, `${path}.value.gaze`) }
      else choice(value, values[field], `${path}.value.${field}`)
    }
    const next = { ...state.actors[op.actor], ...op.value }
    if (equal(next, state.actors[op.actor])) return false
    state.actors[op.actor] = next; return true
  }
  if (op.op === 'clock.advance') {
    shape(op, ['op', 'value'], path)
    if (!Number.isSafeInteger(op.value) || op.value < 0 || op.value > 86400 || !Number.isSafeInteger(state.widgetTime + op.value)) fail(`${path}.value`, 'Use explicit elapsed story seconds, 0..86400')
    if (!op.value) return false
    state.widgetTime += op.value; expireStageWidgets(state, 'story-time'); return true
  }
  if (!['widget.show', 'widget.update', 'widget.hide'].includes(op.op)) return undefined
  shape(op, op.op === 'widget.show' ? ['op', 'widgetId', 'type', 'props', 'slot', 'lifetime'] : op.op === 'widget.update' ? ['op', 'widgetId', 'props'] : ['op', 'widgetId'], path)
  if (typeof op.widgetId !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(op.widgetId)) fail(`${path}.widgetId`, 'Invalid widget ID')
  const old = state.widgets[op.widgetId]
  if (op.op === 'widget.hide') { if (!old) return false; delete state.widgets[op.widgetId]; return true }
  if (op.op === 'widget.show' ? Boolean(old) : !old) fail(`${path}.widgetId`, 'Show requires a new ID; update requires an existing ID')
  const type = old?.type || op.type, definition = stageWidgetDefinitions(catalog).find(item => item.id === type)
  const props = stageWidgetProps(type, old ? mergeProps(old.props, op.props, `${path}.props`) : op.props, stageWidgetDefinitions(catalog))
  if (!definition || !props) fail(`${path}.props`, 'Invalid typed widget props')
  const slot = old?.slot || op.slot || definition.slot || 'corner-right'
  choice(slot, STAGE_WIDGET_SLOTS, `${path}.slot`)
  if (props.frame === 'phone' && !['corner-left', 'corner-right'].includes(slot)) fail(`${path}.slot`, 'Phone widgets require a corner slot')
  if (!old && Object.keys(state.widgets).length >= 3) fail(path, 'At most three active widgets')
  const next = old ? { ...old, props } : { widgetId: op.widgetId, type, props, slot, ...(op.slot !== undefined ? { slotExplicit: true } : {}), lifetime: validateLifetime(op.lifetime, `${path}.lifetime`), bornStoryTime: state.widgetTime, deadline: null, originKey: metadata.sourceKey || '', instanceId: metadata.instanceId || '', bornAt: metadata.at || 1, order: Math.max(-1, ...Object.values(state.widgets).map(widget => widget.order || 0)) + 1 }
  if (!old || own(op.props, 'remainingSeconds')) next.deadline = Number.isSafeInteger(props.remainingSeconds) ? state.widgetTime + props.remainingSeconds : null
  if (equal(old, next)) return false
  if (new TextEncoder().encode(JSON.stringify({ ...state.widgets, [op.widgetId]: next })).length > 12 * 1024) fail(path, 'Widget state exceeds 12 KiB')
  state.widgets[op.widgetId] = next; return true
}

export function validatePersistentDependencies(effect, catalog) {
  for (const op of effect.semanticDependencies) {
    if (op.op === 'stage.patch') {
      for (const [layer, id] of Object.entries(op.value.lighting || {})) if (![{ time: 'auto', mood: 'none' }[layer], ...(catalog.lighting?.[layer] || [])].includes(id)) throw new Error('Stage lighting catalogue changed')
      for (const id of [...(op.value.cast || []), op.value.camera?.actor, op.value.dof].filter(Boolean)) if (!own(catalog.actors, id)) throw new Error('Stage actor catalogue changed')
      if (op.value.cast && op.value.cast.length > (catalog.maxCast || 3)) throw new Error('Stage cast limit changed')
    }
    if (op.op === 'widget.show') {
      const old = stageWidgetDefinitions(effect.catalogSnapshot).find(item => item.id === op.type), current = stageWidgetDefinitions(catalog).find(item => item.id === op.type)
      if (!old || !current || !equal(old.propsSchema, current.propsSchema) || !equal(old.caps, current.caps)) throw new Error('Stage widget catalogue changed')
    }
    if (op.op === 'actor.patch' && !['viewer', 'away', undefined].includes(op.value.gaze) && !own(catalog.actors, op.value.gaze)) throw new Error('Stage gaze target changed')
  }
}

export function persistentStageSchemas(catalog) {
  const en = values => ({ type: 'string', enum: values })
  const shape = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
  const actor = { type: 'string' }, nullableActor = { anyOf: [actor, { type: 'null' }] }
  const schemas = [
    shape({ op: en(['stage.patch']), value: shape({ weather: en(WEATHER), sound: buildSoundscapeFieldSchema(), lighting: shape({ time: actor, mood: actor }, []), camera: shape({ mode: en(CAMERA), actor: nullableActor }, []), dof: nullableActor, cast: { type: 'array', maxItems: 3, items: actor } }, []) }),
    shape({ op: en(['actor.patch']), actor, value: shape({ focus: en(['normal']), gaze: actor, figureLight: en(['lit', 'glow', 'shadow']) }, []) }),
    shape({ op: en(['clock.advance']), value: { type: 'integer', minimum: 0, maximum: 86400 } }),
    ...stageWidgetDefinitions(catalog).map(item => shape({ op: en(['widget.show']), widgetId: actor, type: en([item.id]), props: item.propsSchema, slot: en([...STAGE_WIDGET_SLOTS]), lifetime: shape({ until: en(['explicit', 'scene-change', 'turn-end']), durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 } }, ['until']) }, ['op', 'widgetId', 'type', 'props'])),
    shape({ op: en(['widget.update']), widgetId: actor, props: { type: 'object', description: 'Partial typed props; omitted properties keep their previous value.' } }),
    shape({ op: en(['widget.hide']), widgetId: actor })
  ]
  return catalog?.widgetsEnabled === false ? schemas.filter(schema => !schema.properties.op.enum[0].startsWith('widget.') && schema.properties.op.enum[0] !== 'clock.advance') : schemas
}
