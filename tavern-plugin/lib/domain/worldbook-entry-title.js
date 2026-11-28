export const BUBBLE_FORMAT_TITLE = '对话格式要求'
export const LEGACY_BUBBLE_FORMAT_TITLES = Object.freeze([
  '格式要求（由「对话气泡」设置维护）', '对话格式要求（由「对话气泡」设置维护）'
])

function staleTitle(value) { return LEGACY_BUBBLE_FORMAT_TITLES.includes(value) }

export function migrateBubbleBookTitle(document) {
  const entries = document?.entries
  if (!entries) return undefined
  let migrated
  for (const [key, entry] of Object.entries(entries)) {
    const owner = entry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles
    if (owner?.version !== 1 || !owner.cardKey || owner.figure) continue
    const fields = Object.fromEntries(['comment', 'name'].filter(field => staleTitle(entry[field])).map(field => [field, BUBBLE_FORMAT_TITLE]))
    if (!Object.keys(fields).length) continue
    migrated ??= Array.isArray(entries) ? entries.slice() : {...entries}
    migrated[key] = {...entry, ...fields}
  }
  return migrated && {...document, entries:migrated}
}

export function migrateChatBubbleTitles(chat) {
  const book = migrateBubbleBookTitle(chat.openingWorldbookSnapshot?.document)
  const snapshot = chat.foregroundCapabilities
  let entries
  for (const [index, entry] of (snapshot?.entries || []).entries()) {
    if (entry.ref !== 'foreground-capabilities:format' || entry.capabilityPart?.key !== 'format') continue
    const comment = staleTitle(entry.comment), name = staleTitle(entry.capabilityPart.name)
    if (!comment && !name) continue
    entries ??= snapshot.entries.slice()
    entries[index] = {...entry, ...(comment ? {comment:BUBBLE_FORMAT_TITLE} : {}),
      ...(name ? {capabilityPart:{...entry.capabilityPart, name:BUBBLE_FORMAT_TITLE}} : {})}
  }
  if (!book && !entries) return undefined
  return {...chat,
    ...(book ? {openingWorldbookSnapshot:{...chat.openingWorldbookSnapshot, document:book}} : {}),
    ...(entries ? {foregroundCapabilities:{...snapshot, entries}} : {})}
}

export function worldbookEntryTitle(entry) {
  const clean = value => String(value || '').replace(/^\s*(?:\d+[a-z]?[_-])?(?:\[(?:mvu_[\w-]+|worldbook)\]\s*)+/i, '')
    .replace(/^\s*\d+[a-z]?_/, '').replace(/\s+/g, ' ').trim()
  const heading = String(entry.content || '').match(/^#{1,3}\s+([^\n]+)$/m)?.[1]
  return clean(entry.title || entry.comment) || clean(heading) || `条目 ${entry.sourceUid ?? entry.ref}`
}
