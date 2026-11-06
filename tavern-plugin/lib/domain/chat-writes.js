import { taskStateFields } from './task-state-reader.js'

// What the effects below read from a Chat besides its history: the conversation index row, the
// director and mods (ids, card, timeline), template display (mode, settlement) and candidates.
const EFFECT_HEAD_FIELDS = Object.freeze([...taskStateFields, 'timeline', 'backgroundSessionId', 'settleStatus'])

// Persistence owns conflict detection and revisions. This module owns the work
// triggered by a successful write, including the historical per-writer policy.
export function createChatWrites({ persistence, isDeleted, candidatesChanged, syncSummary, publish, syncTemplates, queueCompaction, observePatch }) {
  function assertWritable(id) {
    if (isDeleted(id)) throw new Error('对话已删除')
  }

  // observation: a projected patch's effects see its stored header, never its history.
  async function committed(kind, saved, metadata, input = saved, observation) {
    candidatesChanged(saved, metadata)
    // A patch can lose its CAS race; an update can find no remaining Chat.
    if (kind === 'patch' && !saved) return saved
    const source = String(metadata?.source || '')
    const mailbox = source.startsWith('candidate.mailbox.')
    if (kind === 'header' || kind === 'update' || !mailbox) {
      // Header writes refresh the caller's draft, including its full history.
      // Their returned value may be only a projection; the summary needs input.
      await syncSummary(kind === 'header' ? input : saved, observation)
    }
    if (saved === undefined) return saved
    void publish(saved.sessionId)
    // A Skill switch changes future availability, not story/template data.
    if (kind !== 'update' || source !== 'writing-skill.switch') {
      syncTemplates(saved, metadata)
      // Header/patch writers historically schedule even for compaction sources.
      if (kind === 'header' || kind === 'patch' || !source.startsWith('compaction.')) {
        queueCompaction(saved.sessionId)
      }
    }
    return saved
  }

  // Import/restore callers deliberately persist without notifying live consumers.
  async function writeRaw(chat, metadata) {
    assertWritable(chat.id)
    return await persistence.write(chat, metadata)
  }

  async function write(chat, metadata) {
    return committed('write', await writeRaw(chat, metadata), metadata)
  }

  async function writeHeader(chat, baseline, metadata) {
    assertWritable(chat.id)
    return committed('header', await persistence.writeHeader(chat, baseline, metadata), metadata, chat)
  }

  async function update(id, mutation, metadata) {
    assertWritable(id)
    return committed('update', await persistence.update(id, mutation, metadata), metadata)
  }

  // A patch may return only the fields its caller asked for (`returnProjection`), sometimes none,
  // not even the id. Its effects read the stored header instead; the caller still gets its projection.
  async function patch(id, revision, changes, metadata) {
    assertWritable(id)
    const saved = await persistence.patch(id, revision, changes, metadata)
    if (!saved || metadata?.returnProjection === undefined) {
      // Even the default patch result is a header with an empty history projection.
      // Source edits are observed separately through observePatch below.
      const result = await committed('patch', saved, metadata, saved, { metadataOnly: true })
      if (saved) await observePatch?.(saved, changes)
      return result
    }
    // Storage without slices returns whole Chats, so the full read costs it nothing extra.
    const head = (await persistence.readSlice?.(id, [], EFFECT_HEAD_FIELDS))?.chat ?? await persistence.read(id)
    if (!head) return saved
    await committed('patch', head, metadata, head, { metadataOnly: true })
    await observePatch?.(head, changes)
    return saved
  }

  return Object.freeze({ write, writeHeader, update, patch, writeRaw })
}
