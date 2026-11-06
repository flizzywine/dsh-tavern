import { randomUUID } from 'node:crypto'
import { fingerprintJsonProjection as digest, copyJsonProjection } from './immutable-json-projection.js'

const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, digest(item)]))
function changes(value, before, hashes) {
  return { set: Object.fromEntries(Object.entries(value).filter(([key, item]) => before[key] !== hashes[key]).map(([key, item]) => [key, copyJsonProjection(item)])),
    remove: Object.keys(before).filter(key => !Object.hasOwn(value, key)) }
}

/** Transport fingerprints only. The journal remains the authority for writes.
 * A lost/evicted cursor recovers with a full snapshot, never a guessed delta.
 */
export function createFullPromptTemplateSync({ capacity = 32 } = {}) {
  const readers = new Map()
  function synchronize(snapshot, cursor, unchangedLength) {
    const { chat, ...state } = snapshot.state
    const before = readers.get(cursor)
    const compatible = before && before.chatId === state.chatId && before.sessionId === state.sessionId
    const nextCursor = randomUUID()
    // This reader only receives authoritative projections. A storage revision
    // covers messages and metadata; settings/worldbooks have separate lifetimes.
    const unchanged = compatible && Number.isSafeInteger(state.stateRevision) && state.stateRevision > 0 && before.revision === state.stateRevision && before.lifecycle === state.lifecycleRevision
    if (unchangedLength !== undefined && !unchanged) return undefined
    const hashes = unchanged ? before.chat : chat.map(digest)
    const stateHashes = unchanged ? before.state : fields(state)
    const environmentHashes = fields(snapshot.environment)
    const result = compatible ? { cursor: nextCursor, baseCursor: cursor, delta: {
      state: unchanged ? {set:{},remove:[]} : changes(state, before.state, stateHashes), environment: changes(snapshot.environment, before.environment, environmentHashes),
      chat: { length: unchangedLength ?? chat.length, set: unchanged ? [] : chat.flatMap((row, index) => hashes[index] === before.chat[index] ? [] : [[index, row]]) }
    } } : { ...snapshot, environment: Object.fromEntries(Object.entries(snapshot.environment).map(([key, item]) => [key, copyJsonProjection(item)])), cursor: nextCursor }
    if (compatible) readers.delete(cursor)
    readers.set(nextCursor, { chatId: state.chatId, sessionId: state.sessionId,
      revision:state.stateRevision, lifecycle:state.lifecycleRevision, chat: hashes, state: stateHashes, environment: environmentHashes })
    while (readers.size > capacity) readers.delete(readers.keys().next().value)
    return result
  }
  synchronize.reader = cursor => {
    const before = readers.get(cursor)
    return before && {chatId:before.chatId, sessionId:before.sessionId, revision:before.revision, lifecycle:before.lifecycle}
  }
  synchronize.selected = (snapshot, cursor, indices, length, baseRevision) => {
    const before = readers.get(cursor)
    const {chat, ...state} = snapshot.state
    if (!before || before.chatId !== state.chatId || before.sessionId !== state.sessionId
      || before.revision !== baseRevision || before.lifecycle !== state.lifecycleRevision) return undefined
    const hashes = before.chat.slice(0, length)
    hashes.length = length
    const set = []
    for (let i=0;i<indices.length;i++) {
      const index = indices[i], hash = digest(chat[i])
      if (hash !== before.chat[index]) set.push([index, chat[i]])
      hashes[index] = hash
    }
    const stateHashes = fields(state), environmentHashes = fields(snapshot.environment)
    const nextCursor = randomUUID()
    readers.delete(cursor)
    readers.set(nextCursor, {...before, revision:state.stateRevision, chat:hashes, state:stateHashes, environment:environmentHashes})
    return {cursor:nextCursor, baseCursor:cursor, delta:{state:changes(state,before.state,stateHashes),
      environment:changes(snapshot.environment,before.environment,environmentHashes), chat:{length,set}}}
  }
  synchronize.matches = (cursor, chat) => {
    const before=readers.get(cursor)
    return Boolean(before && before.chatId===chat.id && before.sessionId===chat.sessionId && before.revision===chat._storageRevision && before.lifecycle===(chat.tavernHelperLifecycleRevision||0))
  }
  synchronize.unchanged = (snapshot,cursor,length) => synchronize(snapshot,cursor,length)
  return synchronize
}
