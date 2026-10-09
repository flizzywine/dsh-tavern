import { inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { worldbookContentDigest } from './worldbook-version.js'
import { cardContentDigest } from './play-card-snapshots.js'

const MARKER = 'characterDesign'
const SECTIONS = [['identity', '身份'], ['personality', '性格'], ['appearance', '外貌'], ['speechStyle', '说话方式'], ['narrativeRole', '剧情作用与可能的发展（不是已发生的事实）']]

const normalized = value => String(value || '').normalize('NFKC').trim().toLowerCase()
export function characterWorldbookEntries(document, names = []) {
  const terms = names.map(normalized).filter(Boolean)
  return (document ? inspectWorldBookDocument(document).entries : []).filter(entry => entry.enabled !== false && entry.content?.trim()).flatMap(entry => {
    const keys = entry.primaryKeys || [], title = entry.title || entry.comment || ''
    const identityMatch = terms.some(term => keys.some(key => normalized(key) === term) || normalized(title).includes(term))
    if (terms.length && !identityMatch && !terms.some(term => normalized(entry.content).includes(term))) return []
    return [{ ref: entry.ref, title, keys, content: entry.content, identityMatch,
      generated: Boolean(entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.[MARKER]) }]
  })
}

export function characterDesignWorldbookSnapshot(chat, record) {
  if (chat.openingWorldbookSnapshot?.version === 1) return structuredClone(chat.openingWorldbookSnapshot)
  return { version: 1, libraryDigest: chat.worldbookLibraryDigest || worldbookContentDigest(record),
    source: structuredClone(record?.source ?? null), document: structuredClone(record?.document ?? null) }
}

/** Apply only a generated character entry, preserving unrelated entries and user edits. */
export function applyCharacterDesignWorldbook(chat, character, fallbackSnapshot) {
  const snapshot = structuredClone(chat.openingWorldbookSnapshot?.version === 1
    ? chat.openingWorldbookSnapshot : fallbackSnapshot || characterDesignWorldbookSnapshot(chat, null))
  const document = snapshot.document ?? { name: '本局世界书', entries: {}, extensions: {} }
  const view = inspectWorldBookDocument(document)
  const matches = view.entries.filter(entry => entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.[MARKER]?.name === character.name)
  if (matches.length > 1) throw new Error('人物“' + character.name + '”对应多个设计条目，请先整理本局世界书')
  const existing = matches[0]
  const originals = characterWorldbookEntries(document, [character.name, ...(character.aliases || [])])
    .filter(entry => !entry.generated && entry.identityMatch)
  if (originals.length) throw new Error('本局世界书已有该人物条目（' + originals.map(entry => entry.ref).join('、') + '），请先读取并用 character_design_reuse 复用；不另建人物档案或同名条目')
  const extra = existing?.rawEntry?.extensions?.dsh_tavern_helper_extra || {}
  const previous = extra[MARKER]
  const content = ['人物：' + character.name, ...SECTIONS.map(([key, label]) => label + '：' + character.design[key])].join('\n\n')
  const keys = [...new Set([character.name, ...(character.aliases || [])])]
  if (existing && existing.content !== previous.content) {
    throw new Error('人物“' + character.name + '”的本局世界书正文已被手动修改，未覆盖；请先处理该条目后重试')
  }
  const patch = { content, helperExtra: { ...extra, [MARKER]: { name: character.name, content, keys } } }
  // Keep user-edited activation settings and keywords. Only untouched generated keys follow aliases.
  if (!existing || JSON.stringify(existing.primaryKeys) === JSON.stringify(previous.keys)) patch.primaryKeys = keys
  const operation = existing ? { op: 'update', ref: existing.ref, patch } : {
    op: 'add', entry: { ...patch, comment: '人物设计 · ' + character.name,
      enabled: true, constant: false, selective: true, vectorized: false, secondaryKeys: [],
      position: 1, order: 100, probability: 100, probabilityEnabled: false }
  }
  snapshot.document = updateWorldBookDocument(document, { operations: [operation] }).document
  chat.openingWorldbookSnapshot = snapshot
  return { worldbook: { scope: 'worldbook-and-current-chat', name: character.name, created: !existing }, operation }
}


/** Remove one character's generated entry from this game's worldbook. A hand-edited entry stays. */
export function removeCharacterDesignWorldbook(chat, name) {
  const snapshot = chat.openingWorldbookSnapshot
  if (snapshot?.version !== 1 || !snapshot.document) return { removed: false, edited: false }
  const entry = inspectWorldBookDocument(snapshot.document).entries.find(item => item.rawEntry?.extensions?.dsh_tavern_helper_extra?.[MARKER]?.name === name)
  if (!entry) return { removed: false, edited: false }
  if (entry.content !== entry.rawEntry.extensions.dsh_tavern_helper_extra[MARKER].content) return { removed: false, edited: true }
  snapshot.document = updateWorldBookDocument(snapshot.document, { operations: [{ op: 'delete', ref: entry.ref }] }).document
  return { removed: true, edited: false }
}

/** Publish the generated entries only, then acknowledge that delta in this game. */
export function createCharacterDesignPublisher({ worldBooks, readCard }) {
  return async function publish(chat, characters) {
    if (!characters.length) return
    const card = await readCard(chat.cardPath)
    const before = await worldBooks.bound(chat.cardPath, card)
    const binding = await worldBooks.binding(chat.cardPath)
    const source = binding.source || { kind: 'card', cardPath: chat.cardPath }
    const previousSource = chat.openingWorldbookSnapshot?.source
    const identity = value => value?.kind === 'card' ? value.cardPath : value?.path
    if (previousSource && identity(previousSource) !== identity(before?.source || source)) throw new Error('世界书绑定已变化，请先同步后重新设计人物')
    // Validate against all bound books, including supplementary books.
    const all = { openingWorldbookSnapshot: { version: 1, document: structuredClone(before?.document ?? null) } }
    for (const character of characters) applyCharacterDesignWorldbook(all, character)
    const target = await worldBooks.get(source)
    const draft = { openingWorldbookSnapshot: { version: 1, document: target.view.raw } }
    const operations = []
    for (const character of characters) {
      // A generated entry in a supplementary book must not be duplicated in the primary book.
      const elsewhere = characterWorldbookEntries(before?.document, [character.name]).some(entry => entry.generated && entry.identityMatch)
      const here = characterWorldbookEntries(draft.openingWorldbookSnapshot.document, [character.name]).some(entry => entry.generated && entry.identityMatch)
      if (elsewhere && !here) throw new Error('人物设计条目位于附加世界书，请先将该世界书设为主书后再修订')
      operations.push(applyCharacterDesignWorldbook(draft, character).operation)
    }
    const acknowledged = chat.worldbookLibraryDigest ?? chat.openingWorldbookSnapshot?.libraryDigest
    await worldBooks.update(source, { operations })
    if (!binding.source) await worldBooks.bind(chat.cardPath, source)
    const latestCard = await readCard(chat.cardPath)
    const after = await worldBooks.bound(chat.cardPath, latestCard)
    chat.openingWorldbookSnapshot.source = structuredClone(after.source)
    // Do not acknowledge unrelated resource edits that the player has not accepted.
    if (acknowledged === worldbookContentDigest(before)) {
      chat.worldbookLibraryDigest = worldbookContentDigest(after)
      chat.openingWorldbookSnapshot.libraryDigest = chat.worldbookLibraryDigest
    }
    if (chat.cardContentDigest === cardContentDigest(card)) {
      chat.cardContentDigest = cardContentDigest(latestCard)
      if (chat.cardDefinitionSnapshot) chat.cardDefinitionSnapshot.character_book = structuredClone(latestCard.character_book)
    }
    (chat.characterDesignTask ||= {}).published = characters.map(character => character.name)
  }
}
