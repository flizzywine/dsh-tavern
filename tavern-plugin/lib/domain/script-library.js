import { chatHistoryScriptText } from './chat-history-import.js'
import { normalizeResourcePath } from './file-resources.js'
import { prepareTextImport } from './text-resource-import.js'

export function createScriptLibrary({ fileResources, readScript }) {
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
  async function listSources() {
    return await Promise.all((await fileResources.list('source')).map(async function (sourcePath) {
      const source = await readSource(sourcePath)
      return { path: sourcePath, title: source.title, sourceChars: source.sourceChars, chunkCount: source.chunks.length }
    }))
  }
  async function importSource(payload) {
    const prepared = prepareScriptImport(payload)
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }

  return { importScript, bindScript, deleteScript, readSource, listSources, importSource }
}
