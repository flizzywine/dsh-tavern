export function worldbookEntryTitle(entry) {
  const clean = value => String(value || '').replace(/^\s*(?:\d+[a-z]?[_-])?(?:\[(?:mvu_[\w-]+|worldbook)\]\s*)+/i, '')
    .replace(/^\s*\d+[a-z]?_/, '').replace(/\s+/g, ' ').trim()
  const heading = String(entry.content || '').match(/^#{1,3}\s+([^\n]+)$/m)?.[1]
  return clean(entry.title || entry.comment) || clean(heading) || `条目 ${entry.sourceUid ?? entry.ref}`
}
