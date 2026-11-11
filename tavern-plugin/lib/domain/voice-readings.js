// Speech-only, single-pass longest match. Replacements are never scanned again.
import { createHash } from 'node:crypto'

export function createReadingLexicon(source) {
  const { version, entries } = JSON.parse(source.toString())
  if (typeof version !== 'string' || !version || !Array.isArray(entries) || !entries.length) throw new Error('Invalid reading lexicon')
  const seen = new Set()
  for (const entry of entries) {
    if (entry.lang !== 'ja' || typeof entry.surface !== 'string' || !entry.surface || typeof entry.reading !== 'string' || !entry.reading || seen.has(entry.surface)) throw new Error('Invalid reading entry')
    seen.add(entry.surface)
  }
  const ordered = [...entries].sort((a, b) => b.surface.length - a.surface.length)
  const pattern = new RegExp(ordered.map(({ surface }) => surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu')
  const readings = new Map(entries.map(({ surface, reading }) => [surface, reading]))
  const sha256 = createHash('sha256').update(source).digest('hex')
  return Object.freeze({
    version, sha256, revision: version + ':' + sha256,
    apply(text, language) { return language === 'ja' || language === 'all_ja' ? text.replace(pattern, surface => readings.get(surface)) : text }
  })
}
