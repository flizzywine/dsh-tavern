import { chatHistoryScriptText } from './chat-history-import.js'
import { bm25Scores, buildBm25Index, tokenizeBigram } from './bm25.js'
import { normalizeResourcePath } from './file-resources.js'
import { prepareTextImport } from './text-resource-import.js'

export function createScriptLibrary({ fileResources, readScript }) {
  const searchIndexes = new WeakMap()

  function prepareScriptImport(payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    if (/\.jsonl$/i.test(prepared.name)) {
      return { ...prepared, text: chatHistoryScriptText(prepared.originalText ?? prepared.text) }
    }
    return prepared
  }
  async function importScript(cardPath, payload) {
    const prepared = prepareScriptImport(payload)
    await fileResources.importBoundScript(cardPath, prepared)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length, importedAt: Date.now() }
  }
  async function bindScript(cardPath, materialPath) {
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length }
  }
  async function deleteScript(cardPath) {
    await fileResources.unbindMaterial(cardPath)
    return { unbound: true }
  }
  // ---------- 剧本（可独立保存，也可与人物卡一对一绑定） ----------
  async function readSource(sourcePath) {
    return readScript(normalizeResourcePath(sourcePath, 'source'))
  }
  async function listSourceTitles() {
    return (await fileResources.list('source')).map(path => ({ path, title: path.split('/').pop() }))
  }
  async function listSources() {
    const sources = await Promise.all((await listSourceTitles()).map(async ({ path, title }) => {
      const source = await readSource(path)
      return source && { path, title, sourceChars: source.sourceChars, chunkCount: source.chunks.length }
    }))
    return sources.filter(Boolean)
  }
  async function searchSource({ path, query, limit }) {
    const source = await readSource(path)
    if (!source) return null
    const { chunks } = source
    const terms = new Set(tokenizeBigram(query).filter(term => !/^\p{Script=Han}$/u.test(term)))
    const picks = new Set()
    if (terms.size && chunks.length > limit) {
      let index = searchIndexes.get(source)
      if (!index) {
        index = buildBm25Index(chunks.map(chunk => chunk.text))
        searchIndexes.set(source, index)
      }
      const scores = bm25Scores(terms, index)
      const ranked = chunks.filter(chunk => scores[chunk.order] > 0)
        .sort((a, b) => scores[b.order] - scores[a.order])
      for (const chunk of ranked.slice(0, Math.floor(limit * 0.75) || 1)) picks.add(chunk)
    }
    // Fill remaining slots with excerpts spread across the book, including when the scene shares no keywords.
    const remaining = chunks.filter(chunk => !picks.has(chunk))
    const count = Math.min(remaining.length, limit - picks.size)
    for (let i = 0; i < count; i++) picks.add(remaining[Math.floor((i + 0.5) * remaining.length / count)])
    return { path: source.path, title: source.title,
      chunks: [...picks].map(chunk => ({ id: chunk.id, text: chunk.text.trim().slice(0, 1000) })) }
  }
  async function importSource(payload) {
    const prepared = prepareScriptImport(payload)
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }

  return { importScript, bindScript, deleteScript, readSource, listSources, listSourceTitles, searchSource, importSource }
}
