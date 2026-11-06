import { splitNovelText } from './script-chunks.js'

const originals = new WeakMap()

export function chunkOffsets(chunks) {
  let offset = 0
  return [...chunks.map(chunk => { const start = offset; offset += chunk.text.length; return start }), offset]
}

// Chunk numbers are a view of the source; progress is stored separately as
// an offset into the original text, independent of the current chunk budget.
export function scriptForState(script, state) {
  const base = originals.get(script) || script
  if (!base || !state?.chunkSize) return base
  const size = state.chunkSize
  if (!Number.isSafeInteger(size) || size < 100 || size > 10000) return base
  if (script !== base && script.chunkSize === size) return script
  const source = base.chunks.map(chunk => chunk.text).join('')
  const chunks = splitNovelText(source, size, { preserveWhitespace: true })
    .map((chunk, order) => ({ ...chunk, order, id: 'chunk-' + String(order + 1).padStart(5, '0') }))
  const layout = { ...base, chunks, chunkSize: size }
  originals.set(layout, base)
  return layout
}
