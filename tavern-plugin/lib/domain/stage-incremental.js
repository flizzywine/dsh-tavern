// Presentation effects share the upstream task lifecycle, never write MVU state,
// and never introduce another story or reader cursor.
import { createHash } from 'node:crypto'
import { sceneSourceDigest } from './scene-illustration.js'
import { modStageContributions } from './mods/stage-contributions.js'
import { actorPresentationDefaults, persistentStageDefaults, applyPersistentStageOperation, expireStageWidgets, validatePersistentDependencies, persistentStageSchemas } from './stage-persistent-state.js'

const clone = value => structuredClone(value)
// A source marker op (a phone message) is validated by the mod that contributes it.
const sourceMarkerValid = (op, unit, aliases) => !!modStageContributions().find(row => row.sourceMarker?.op === op.op)?.sourceMarker.valid(op, unit, aliases)
const own = (value, key) => Object.hasOwn(value, key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const stageRulesHash = value => createHash('sha256').update(String(value ?? '')).digest('hex')
export const stageDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
// byte stream used by the revision-bound prefix index, including JSON nulls.
export const stageTargetPrefixBytes = message => JSON.stringify(canonical([message.role, message.turn, message.sourceText ?? message.text]))
const fail = (path, message) => { throw Object.assign(new Error(message), { path }) }
function shape(value, keys, path) {
  if (!object(value)) fail(path, 'Expected an object')
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unknown field')
}
import { normalizeStageBudget } from '../../packages/dsh-presentation-protocol/src/config-budget.js'
export { normalizeStageBudget } from '../../packages/dsh-presentation-protocol/src/config-budget.js'

export function initialStageState(catalog) {
  return { version: 1, scene: catalog.initialScene || null, music: null, cast: [], ...persistentStageDefaults(),
    actors: Object.fromEntries(Object.entries(catalog.actors).map(([id, actor]) => [id, { variant: actor.defaultVariant, ...actorPresentationDefaults() }])) }
}

function normalizeBaseline(baseline, catalog) {
  const state = { ...persistentStageDefaults(), ...clone(baseline || initialStageState(catalog)) }
  for (const [id, actor] of Object.entries(state.actors)) state.actors[id] = { ...actorPresentationDefaults(), ...actor }
  // Schema extension is deterministic. Never reset or overwrite existing actor state.
  for (const [id, actor] of Object.entries(catalog.actors)) if (!own(state.actors, id)) Object.defineProperty(state.actors, id, { value: { variant: actor.defaultVariant, ...actorPresentationDefaults() }, enumerable: true, writable: true, configurable: true })
  return state
}

// A close-up is short emphasis (the client also limits it to a few paragraphs); it never
// survives a new place or the end of the turn, so it is never carried into the next reply.
function releaseCloseCamera(state) {
  if (state.camera?.mode === 'close') state.camera = { mode: 'reset', actor: null }
}
function endTurn(state) { expireStageWidgets(state, 'turn-end'); releaseCloseCamera(state) }
// Scene changes end scene-bound widgets and restore scene-default soundscape tags.
function changeScene(state, value) {
  expireStageWidgets(state, 'scene-change'); releaseCloseCamera(state); state.scene = value; state.sound = []
}

function operation(state, op, catalog, path, metadata = {}) {
  const persistent = applyPersistentStageOperation(state, op, catalog, path, metadata)
  if (persistent !== undefined) return persistent
  if (op?.op === 'phone.message') {
    if (catalog.widgetsEnabled !== true || !sourceMarkerValid(op, catalog.phone?.units?.[metadata.at - 1], catalog.phone?.aliases || [])) fail(path, 'Phone marker needs an existing source bubble, a known contact and matching side; no text or control fields')
    return true // Source marker, never persistent widget state or a new message.
  }
  if (op?.op === 'event') {
    shape(op, ['op', 'value'], path)
    const command = op.value
    shape(command, ['op', 'id', 'value'], `${path}.value`)
    const enums = { act: ['nod', 'shake', 'jump', 'tremble', 'turn', 'bow', 'lean', 'step-back'], emote: ['!', '?', '...', 'sweat', 'anger', 'heart', 'note', 'gloom', 'sparkle', 'blush'], beat: ['shake-1', 'shake-2', 'shake-3', 'flash', 'flash-red', 'glitch', 'shock', 'heartbeat', 'blur', 'blackout'], trans: ['cut', 'fade', 'black', 'white', 'wipe', 'iris'], focus: ['close'] }
    if (typeof command.op !== 'string' || ![...Object.keys(enums), 'title', 'sfx'].includes(command.op)) fail(`${path}.value.op`, 'Unknown one-shot command')
    if (typeof command.value !== 'string') fail(`${path}.value.value`, 'Expected a string')
    if (['act', 'emote', 'focus'].includes(command.op)) {
      if (typeof command.id !== 'string' || !state.cast.includes(command.id)) fail(`${path}.value.id`, 'One-shot actor must be on stage')
    } else if (own(command, 'id')) fail(`${path}.value.id`, 'Unexpected actor')
    if (enums[command.op] && !enums[command.op].includes(command.value)) fail(`${path}.value.value`, 'Invalid one-shot value')
    if (command.op === 'title' && (!command.value.trim() || [...command.value].length > 24)) fail(`${path}.value.value`, 'Title must be 1..24 characters')
    if (command.op === 'sfx' && !catalog.sfx?.includes(command.value)) fail(`${path}.value.value`, 'Unknown sound effect')
    return true
  }
  // scene proposals were removed (new submissions are rejected), but receipts already
  // committed in saved chats still replay them; replay only, so live stage state does not break.
  if (['replay', 'projection'].includes(path) && op?.op === 'scene.propose' && typeof op.value?.name === 'string' && op.value.name.trim()) {
    if (state.scene === op.value.name) return false
    changeScene(state, op.value.name); return true
  }
  shape(op, ['op', 'actor', 'value'], path)
  if (typeof op.op !== 'string') fail(`${path}.op`, 'Expected a string operation')
  const kind = op.op
  const fields = {
    'scene.set': ['op', 'value'], 'scene.clear': ['op'], 'music.set': ['op', 'value'], 'music.stop': ['op'],
    'actor.enter': ['op', 'actor', ...(own(op, 'value') ? ['value'] : [])],
    'actor.exit': ['op', 'actor'], 'actor.variant': ['op', 'actor', 'value'], 'actor.reset': ['op', 'actor'],
    'cast.clear': ['op'], 'stage.reset': ['op'], 'act': ['op', 'actor', 'value']
  }[kind]
  if (!fields) fail(`${path}.op`, 'Unknown operation')
  shape(op, fields, path)
  for (const field of fields) if (!own(op, field)) fail(`${path}.${field}`, 'Required field')
  for (const field of fields) if (typeof op[field] !== 'string') fail(`${path}.${field}`, 'Expected a string')
  if (fields.includes('actor') && !own(catalog.actors, op.actor)) fail(`${path}.actor`, 'Unknown actor')
  if (fields.includes('actor') && !own(state.actors, op.actor)) fail(`${path}.actor`, 'Actor missing from normalized state')
  const set = (field, value) => { if (state[field] === value) return false; if (field === 'scene') changeScene(state, value); else state[field] = value; return true }
  if (kind.endsWith('.set')) {
    const field = kind.split('.')[0]
    if (!catalog[field]?.includes(op.value)) fail(`${path}.value`, `Unknown ${field} asset`)
    return set(field, op.value)
  }
  if (kind === 'scene.clear') return set('scene', null)
  if (kind === 'music.stop') return set('music', null)
  if (kind === 'actor.enter') {
    // arrival placement selects a gap, never moves an on-stage actor.
    const placement = own(op, 'value') ? op.value : 'right'
    const after = placement.startsWith('after:') ? placement.slice(6) : null
    if (!['left', 'center', 'right'].includes(placement) && !(after && after !== op.actor && state.cast.includes(after))) fail(path, 'Use left, center, right or after:ID of an on-stage actor; omit value to append right')
    if (state.cast.includes(op.actor)) {
      if (own(op, 'value') && path !== 'replay' && path !== 'projection') fail(path, 'Actor already on stage; placement is only for arrivals')
      return false
    }
    if (state.cast.length >= (catalog.maxCast || 3)) fail(path, 'Cast limit exceeded')
    const index = placement === 'left' ? 0 : placement === 'center' ? Math.ceil(state.cast.length / 2) : after ? state.cast.indexOf(after) + 1 : state.cast.length
    state.cast.splice(index, 0, op.actor); return true
  }
  if (kind === 'actor.exit') {
    if (!state.cast.includes(op.actor)) return false
    state.cast = state.cast.filter(id => id !== op.actor); return true
  }
  if (kind === 'actor.variant' || kind === 'actor.reset') {
    const value = kind === 'actor.reset' ? catalog.actors[op.actor].defaultVariant : op.value
    if (!catalog.actors[op.actor].variants.includes(value)) fail(`${path}.value`, 'Variant does not belong to actor')
    if (state.actors[op.actor].variant === value) return false
    state.actors[op.actor].variant = value; return true
  }
  if (kind === 'cast.clear') { if (!state.cast.length) return false; state.cast = []; return true }
  if (kind === 'stage.reset') {
    const next = initialStageState(catalog)
    if (stageDigest(state) === stageDigest(next)) return false
    Object.assign(state, next); return true
  }
  if (!state.cast.includes(op.actor)) fail(`${path}.actor`, 'One-shot actor must be on stage')
  if (!['nod', 'shake', 'jump', 'tremble', 'turn', 'bow', 'lean', 'step-back'].includes(op.value)) fail(`${path}.value`, 'Unknown one-shot gesture')
  return true // Events may repeat intentionally; their identity is job/sequence/beat/op.
}

function cappedOperation(op) {
  const command = op?.op === 'event' ? op.value : op
  if (command?.op === 'act') return { key: 'act:' + (command.actor || command.id), limit: 4 }
  const limit = { beat: 6, emote: 8, sfx: 10, title: 2, 'phone.message': 40 }[command?.op]
  if (limit) return { key: command.op, limit }
  if (op?.op === 'stage.patch' && own(op.value || {}, 'camera')) return { key: 'cam', limit: 8 }
  return null
}

function resetsTransientFocus(op, at, entries) {
  if (op?.op !== 'actor.patch' || !own(op.value || {}, 'focus')) return false
  let until = 0
  for (const beat of entries) for (const command of beat.ops) {
    if (command.op === 'event' && command.value.op === 'focus' && command.value.id === op.actor) until = beat.at + 3
    if (command.op === 'stage.reset' || command.op === 'actor.patch' && command.actor === op.actor && own(command.value, 'focus')) until = 0
  }
  return until > at
}

/** Small-model-friendly transaction. Batches stage a draft; they never commit story state.
 * through seals an inspected paragraph range, including omitted/unchanged paragraphs.
 * Invalid batches are atomic. Corrections replace only the rejected batch, not the prefix.
 */
export function createStageTransaction({ baseline, catalog, target, units, budget, signal, isCurrent = () => true, checkpoint }) {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error('Stage target needs nonnegative paragraph units')
  catalog = clone(catalog); target = clone(target); baseline = normalizeBaseline(baseline, catalog)
  const limits = normalizeStageBudget(budget), entries = [], receipts = new Map(), dependencies = new Map()
  let counts = {}
  let draft = clone(baseline), nextSequence = 1, through = 0, calls = 0, done = units === 0, abandoned = false
  if (checkpoint) {
    const saved = checkpoint.state
    if (checkpoint.version !== 1 || !saved || checkpoint.digest !== stageDigest(saved) || saved.units !== units || stageDigest(saved.target) !== stageDigest(target) || stageDigest(saved.catalog) !== stageDigest(catalog) || stageDigest(saved.baseline) !== stageDigest(baseline) || stageDigest(saved.limits) !== stageDigest(limits)) throw new Error('Stage savepoint binding mismatch')
    if (!Number.isSafeInteger(saved.calls) || saved.calls < saved.receipts.length || saved.calls > limits.maxToolCalls || saved.nextSequence !== saved.receipts.length + 1 || saved.through < 0 || saved.through > units || saved.done !== (saved.through === units)) throw new Error('Invalid stage savepoint progress')
    draft = clone(saved.draft); nextSequence = saved.nextSequence; through = saved.through; calls = saved.calls; done = saved.done
    entries.push(...clone(saved.entries))
    for (const [sequence, receipt] of saved.receipts) receipts.set(sequence, clone(receipt))
    for (const beat of entries) for (const op of beat.ops) { const cap = cappedOperation(op); if (cap) counts[cap.key] = (counts[cap.key] || 0) + 1; if (op.op === 'phone.message') counts['phone-at:' + beat.at] = 1 }
    for (const dependency of saved.dependencies) dependencies.set(stageDigest(dependency), clone(dependency))
  }
  const alive = () => !abandoned && !signal?.aborted && isCurrent()
  function reject(path, message, retryable = true) {
    return { ok: false, retryable, error: { path, message }, nextSequence, through, remainingCalls: Math.max(0, limits.maxToolCalls - calls) }
  }
  function submit(args) {
    if (!alive()) return reject('target', 'Cancelled or superseded target', false)
    const digest = stageDigest(args ?? null), old = receipts.get(args?.sequence)
    if (old) return old.digest === digest ? { ...clone(old.reply), duplicate: true } : reject('sequence', 'Sequence already accepted with different content')
    if (done) return reject('done', 'Transaction already finalized', false)
    if (calls >= limits.maxToolCalls) return reject('budget', 'Stage tool-call budget exhausted', false)
    calls++
    try {
      shape(args, ['sequence', 'through', 'done', 'beats'], 'batch')
      if (args.sequence !== nextSequence) fail('sequence', `Expected sequence ${nextSequence}`)
      if (!Number.isSafeInteger(args.through) || args.through <= through || args.through > units) fail('through', `Expected ${through + 1}..${units}`)
      if (typeof args.done !== 'boolean') fail('done', 'Expected a boolean')
      if (args.done !== (args.through === units)) fail('done', 'Finish exactly when through reaches the final paragraph')
      if (!Array.isArray(args.beats) || args.beats.length > limits.maxBeatsPerCall) fail('beats', `Expected at most ${limits.maxBeatsPerCall} beats`)
      const next = clone(draft), accepted = [], acceptedDependencies = [], nextCounts = { ...counts }
      let last = through, count = 0, noops = 0
      for (const [i, beat] of args.beats.entries()) {
        const path = `beats[${i}]`
        shape(beat, ['at', 'ops'], path)
        if (!Number.isSafeInteger(beat.at) || beat.at <= through || beat.at < last || beat.at > args.through) fail(`${path}.at`, 'Paragraphs must follow the sealed prefix in nondecreasing order')
        if (!Array.isArray(beat.ops)) fail(`${path}.ops`, 'Expected operations array')
        last = beat.at
        const ops = []
        for (const [j, op] of beat.ops.entries()) {
          if (++count > limits.maxOpsPerCall) fail(`${path}.ops`, `At most ${limits.maxOpsPerCall} operations per batch`)
          const clearsOverlay = resetsTransientFocus(op, beat.at, entries.concat(accepted, [{ at: beat.at, ops }]))
          if (operation(next, op, catalog, `${path}.ops[${j}]`, { sourceKey: target.sourceKey, at: beat.at, instanceId: target.sourceKey + ':' + (entries.length + accepted.length) + ':' + ops.length }) || clearsOverlay) {
            if (op.op === 'phone.message') {
              if (nextCounts['phone-at:' + beat.at]) fail(`${path}.ops[${j}]`, 'At most one phone marker per source paragraph')
              nextCounts['phone-at:' + beat.at] = 1
            }
            const cap = cappedOperation(op)
            if (cap && (nextCounts[cap.key] || 0) >= cap.limit) fail(`${path}.ops[${j}]`, 'Existing presentation safety cap exceeded: ' + cap.key)
            if (cap) nextCounts[cap.key] = (nextCounts[cap.key] || 0) + 1
            ops.push(clone(op))
          } else noops++
          acceptedDependencies.push(clone(op))
        }
        if (ops.length) accepted.push({ at: beat.at, ops })
      }
      if (!alive()) return reject('target', 'Cancelled or superseded target', false)
      if (args.done) endTurn(next)
      draft = next; counts = nextCounts; entries.push(...accepted); through = args.through; nextSequence++; done = args.done
      for (const dependency of acceptedDependencies) dependencies.set(stageDigest(dependency), dependency)
      const reply = { ok: true, nextSequence, through, done, acceptedOperations: count - noops, omittedNoops: noops, remainingCalls: limits.maxToolCalls - calls }
      receipts.set(args.sequence, { digest, reply }); return clone(reply)
    } catch (error) {
      return reject(error.path || 'batch', error.message, calls < limits.maxToolCalls)
    }
  }
  const terminal = () => done || calls >= limits.maxToolCalls || !alive()
  function effect({ allowPartial = false } = {}) {
    if (!alive() || (!done && !allowPartial) || through === 0 && !done) return null
    return { ...clone(target), version: 1, baselineDigest: stageDigest(baseline), catalogDigest: stageDigest(catalog), catalogSnapshot: clone(catalog),
      units, through, complete: done, start: clone(baseline), entries: clone(entries), end: clone(draft),
      semanticDependencies: clone([...dependencies.values()]), dependencyDigest: stageDigest([...dependencies.values()]) }
  }
  const completed = () => alive() && done
  const outcome = () => ({ status: !alive() ? 'cancelled-or-stale' : done ? 'completed' : calls >= limits.maxToolCalls ? 'exhausted' : 'running', complete: completed(), through })
  function savepoint() {
    const state = { target: clone(target), baseline: clone(baseline), catalog: clone(catalog), units, limits: clone(limits),
      draft: clone(draft), nextSequence, through, calls, done, entries: clone(entries), receipts: clone([...receipts]), dependencies: clone([...dependencies.values()]) }
    return { version: 1, state, digest: stageDigest(state) }
  }
  return Object.freeze({ submit, terminal, completed, outcome, effect, savepoint, isCurrent: alive, cancel: () => { abandoned = true },
    inspect: () => ({ calls, nextSequence, through, done, terminal: terminal(), state: clone(draft), entries: clone(entries) }) })
}

/** Capture the real target once; commit re-derives it from the authoritative Chat.
 * Matches sceneTarget's selected-source/prefix semantics without importing its model adapter.
 * The host may use sceneTarget as its extra presentation identity, but cannot supply a
 * free-form sourceKey in place of this commit binding.
 */
export function captureStageTarget(chat, messageId, prefixDigest) {
  for (const field of ['id', 'sessionId']) if (typeof chat?.[field] !== 'string' || !chat[field]) throw new Error('Missing stage Chat identity')
  if (typeof chat.timeline?.branchId !== 'string' || !chat.timeline.branchId || !Number.isSafeInteger(chat.timeline?.revision) || chat.timeline.revision < 0) throw new Error('Missing stage timeline identity')
  if (!Number.isSafeInteger(messageId) || messageId < 0) throw new Error('Invalid stage message index')
  const message = chat.messages?.[messageId]
  if (!message || message.role !== 'assistant') throw new Error('Stage target message missing')
  const swipeId = Math.max(0, Number(message.swipeId) || 0)
  const source = String(message.swipes?.[swipeId] ?? message.sourceText ?? message.text ?? '')
  // Automatic polish preserves the scene identity of the original prose.
  const sourceDigest = message.polishedFrom || sceneSourceDigest(source)
  // the revision-bound history reader supplies the identical JSON prefix hash.
  prefixDigest ??= stageDigest(chat.messages.slice(0, messageId).map(item => [item.role, item.turn, item.sourceText ?? item.text]))
  const identity = { chatId: chat.id, sessionId: chat.sessionId, messageId, messageIdentity: message.id ?? null,
    turn: Number(message.turn || (message.greeting ? 1 : 0)), swipeId, sourceDigest, prefixDigest }
  return { ...identity, branchId: chat.timeline?.branchId, revision: chat.timeline?.revision, sourceKey: stageDigest(identity) }
}

/** The authority is the previous valid message effect, never a caller's old snapshot. */
export function readStageBaseline(chat, messageId, catalog) {
  let carried
  const anchorAt = index => {
    const anchor = chat.messages[index]?.stageDirectionBaselineV1
    if (!anchor) return undefined
    if (anchor.sourceKey !== captureStageTarget(chat, index).sourceKey) return undefined
    if (anchor.version !== 1 || anchor.digest !== stageDigest(anchor.state)) throw new Error('Stage baseline anchor mismatch')
    return clone(anchor.state)
  }
  for (let index = 0; index < messageId; index++) {
    if (carried === undefined) carried = anchorAt(index)
    const previous = chat.messages[index]?.stageDirectionV1
    if (!previous?.complete || chat.messages[index]?.role !== 'assistant') continue
    if (previous.sourceKey !== captureStageTarget(chat, index).sourceKey) continue
    // A late rewrite of an earlier presentation must not silently leave a stale
    // intermediate effect as the baseline for still later replies.
    const expected = normalizeBaseline(carried, previous.catalogSnapshot)
    if (previous.baselineDigest !== stageDigest(expected)) throw new Error('Stage predecessor baseline changed; rebuild dependent effects')
    carried = replayStage(previous)
  }
  if (carried === undefined) carried = anchorAt(messageId)
  return normalizeBaseline(carried, catalog)
}

/** Historical replay uses its immutable semantic catalogue, not today's asset list.
 * Keep the former (effect, currentCatalog, paragraph) call shape for this prototype;
 * currentCatalog is intentionally ignored. Renderer availability is resolved separately.
 * Replay never dispatches one-shots. A live renderer explicitly consumes event IDs.
 */
export function replayStage(effect, currentCatalogOrParagraph = Infinity, paragraph = Infinity) {
  const at = typeof currentCatalogOrParagraph === 'number' ? currentCatalogOrParagraph : paragraph
  const catalog = effect?.catalogSnapshot
  if (effect?.version !== 1 || !catalog || effect.catalogDigest !== stageDigest(catalog) || effect.baselineDigest !== stageDigest(effect.start) || !Array.isArray(effect.semanticDependencies) || effect.dependencyDigest !== stageDigest(effect.semanticDependencies)) throw new Error('Stage effect snapshot mismatch')
  const state = clone(effect.start)
  let previous = 0
  const phoneSeen = new Set()
  for (const [entryIndex, beat] of effect.entries.entries()) {
    if (!Number.isSafeInteger(beat.at) || beat.at < 1 || beat.at < previous || beat.at > effect.through) throw new Error('Invalid stage replay chronology')
    previous = beat.at
    if (beat.at > at) break
    for (const [opIndex, op] of beat.ops.entries()) {
      if (op.op === 'phone.message') {
        if (phoneSeen.has(beat.at) || phoneSeen.size >= 40) throw new Error('Invalid stage phone source markers')
        phoneSeen.add(beat.at)
      }
      operation(state, op, catalog, 'replay', { sourceKey: effect.sourceKey, at: beat.at, instanceId: effect.sourceKey + ':' + entryIndex + ':' + opIndex })
    }
  }
  if (effect.complete && at === Infinity) endTurn(state)
  if ((at === Infinity || !effect.complete && at >= effect.through) && stageDigest(state) !== stageDigest(effect.end)) throw new Error('Stage effect end-state mismatch')
  return state
}

/** Validated linear traversal for the existing client projection adapter. */
export function walkStageOperations(effect, visitor) {
  replayStage(effect)
  const state = clone(effect.start)
  for (const [entryIndex, beat] of effect.entries.entries()) for (const [opIndex, op] of beat.ops.entries()) {
    operation(state, op, effect.catalogSnapshot, 'projection', { sourceKey: effect.sourceKey, at: beat.at, instanceId: effect.sourceKey + ':' + entryIndex + ':' + opIndex })
    visitor(state, op, beat.at)
  }
}

// Check semantic dependencies used by this effect, not unrelated catalogue additions.
function validateCurrentCatalog(effect, current) {
  if (!object(current?.actors)) throw new Error('Current authoritative stage catalogue required')
  const frozen = effect.catalogSnapshot
  validatePersistentDependencies(effect, current)
  for (const beat of effect.entries) for (const op of beat.ops) if (op.op === 'phone.message') {
    if (current.widgetsEnabled !== true || !sourceMarkerValid(op, current.phone?.units?.[beat.at - 1], current.phone?.aliases || []) || stageDigest(current.phone.units[beat.at - 1]) !== stageDigest(frozen.phone.units[beat.at - 1])) throw new Error('Stage phone source or contact changed')
  }
  // Conservative actor-level dependency binding includes defaults and model IDs.
  // Comparing only end-state variants loses an earlier enter/act appearance.
  const semanticActor = actor => ({ defaultVariant: actor.defaultVariant, variants: [...actor.variants].sort(), bindings: actor.bindings || {} })
  const semanticRoster = value => Object.fromEntries(Object.entries(value.actors).map(([id, actor]) => [id, semanticActor(actor)]))
  // Accepted no-ops are not playback events, but they still bind reset/default and
  // explicit asset-selection semantics. Failed batches never add dependencies.
  for (const op of effect.semanticDependencies) {
    if (op.op === 'stage.reset' && (stageDigest(initialStageState(current)) !== stageDigest(initialStageState(frozen)) || stageDigest(semanticRoster(current)) !== stageDigest(semanticRoster(frozen)))) throw new Error('Stage reset catalogue changed')
    if (op.op === 'actor.enter' && (current.maxCast || 3) !== (frozen.maxCast || 3)) throw new Error('Stage cast limit changed')
    if (op.actor) {
      const actor = current.actors[op.actor], old = frozen.actors[op.actor]
      if (!actor || !old || stageDigest(semanticActor(actor)) !== stageDigest(semanticActor(old))) throw new Error('Stage actor catalogue changed')
      const variant = op.op === 'actor.reset' ? old.defaultVariant : op.op === 'actor.variant' ? op.value : effect.end.actors[op.actor]?.variant
      if (op.op === 'actor.reset' && actor.defaultVariant !== old.defaultVariant) throw new Error('Stage actor default changed')
      if (variant && (!actor.variants.includes(variant) || actor.bindings?.[variant] !== old.bindings?.[variant])) throw new Error('Stage variant catalogue changed')
    }
    if (op.op.endsWith('.set')) {
      const field = op.op.split('.')[0]
      if (!current[field]?.includes(op.value)) throw new Error('Stage asset catalogue changed')
    }
  }
}

/** Apply in the EXISTING coordinator's synchronous mutation. The host must read the
 * current catalogue under its normal configuration consistency guard before committing.
 * Target and baseline are always derived from Chat; no caller-supplied substitutes.
 */
export function applyStageEffect(chat, effect, { catalog, isCurrent } = {}) {
  if (!effect || effect.complete !== true || effect.through !== effect.units) throw new Error('Incomplete stage effect is not authoritative')
  if (typeof isCurrent !== 'function' || !isCurrent()) throw new Error('Stage commit owner cancelled or missing')
  if (chat.timeline?.branchId !== effect.branchId || chat.timeline?.revision !== effect.revision) throw new Error('Stale stage effect')
  const target = captureStageTarget(chat, effect.messageId)
  for (const key of Object.keys(target)) if (target[key] !== effect[key]) throw new Error('Stage target binding mismatch')
  replayStage(effect) // Validate immutable snapshot integrity and resolved end state.
  validateCurrentCatalog(effect, catalog)
  const baseline = readStageBaseline(chat, effect.messageId, effect.catalogSnapshot)
  if (effect.baselineDigest !== stageDigest(baseline)) throw new Error('Stage baseline changed')
  if (!isCurrent()) throw new Error('Stage commit owner cancelled')
  chat.messages[effect.messageId].stageDirectionV1 = clone(effect)
}

export function buildStageUpdateTool({ units, budget, catalog } = {}) {
  const limits = normalizeStageBudget(budget)
  const command = (op, properties = {}) => ({ type: 'object', additionalProperties: false,
    properties: { op: { type: 'string', enum: [op] }, ...properties }, required: ['op', ...Object.keys(properties)] })
  const actor = { type: 'string', description: 'Catalogue actor ID.' }
  const value = { type: 'string', description: 'Catalogue asset/variant ID.' }
  const operations = ['scene', 'music'].map(field => command(field + '.set', { value }))
    .concat(['scene.clear', 'music.stop', 'cast.clear', 'stage.reset'].map(op => command(op)))
    .concat(['actor.exit', 'actor.reset'].map(op => command(op, { actor })))
    .concat([{ ...command('actor.enter', { actor, value: { type: 'string', description: 'Arrival gap; omitted = right.', enum: ['left', 'center', 'right', ...Object.keys(catalog?.actors || {}).map(id => 'after:' + id)] } }), required: ['op', 'actor'] }])
    .concat(persistentStageSchemas(catalog))
    .concat([command('event', { value: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: ['act', 'emote', 'beat', 'trans', 'focus', 'sfx', 'title'] }, id: { type: 'string' }, value: { type: 'string' } }, required: ['op', 'value'] } })])
    .concat([command('actor.variant', { actor, value }), command('act', { actor, value: { type: 'string', enum: ['nod', 'shake', 'jump', 'tremble', 'turn', 'bow', 'lean', 'step-back'] } })])
  if (catalog?.widgetsEnabled === true && catalog.phone?.aliases?.length) operations.push(command('phone.message', { contact: { type: 'string', enum: catalog.phone.aliases }, side: { type: 'string', enum: ['in', 'out'] } }))
  return { name: 'stage_update', description: 'Stage incremental presentation changes. Omitted values persist, including offstage variants. Never repeat unchanged settings. Send an empty beats list to seal unchanged paragraphs. done finalizes the task; it does not clear the stage.',
    parameters: { type: 'object', additionalProperties: false, required: ['sequence', 'through', 'done', 'beats'], properties: {
      sequence: { type: 'integer', minimum: 1 }, through: { type: 'integer', minimum: 1, maximum: units }, done: { type: 'boolean' },
      beats: { type: 'array', maxItems: limits.maxBeatsPerCall, items: { type: 'object', additionalProperties: false, required: ['at', 'ops'], properties: {
        at: { type: 'integer', minimum: 1, maximum: units }, ops: { type: 'array', maxItems: limits.maxOpsPerCall, items: { oneOf: operations } }
      } } }
    } } }
}

/** Display fallback never rewrites the requested appearance or fabricates an exit. */
export function resolveStageAppearance(actorState, actor, availableModels) {
  const requested = actorState?.variant || actor.defaultVariant
  const selected = actor.bindings?.[requested]
  if (selected && availableModels.has(selected)) return { requested, effective: requested, model: selected, degraded: false }
  const fallback = actor.bindings?.[actor.defaultVariant]
  return { requested, effective: fallback && availableModels.has(fallback) ? actor.defaultVariant : null,
    model: fallback && availableModels.has(fallback) ? fallback : null, degraded: true,
    warning: `造型 ${requested} 的素材不可用，保留剧情造型并使用默认显示；可补回素材或显式重置造型。` }
}
