import { normalizeResourcePath, resourceKind } from './file-resources.js'

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

/** Keep resource files, bindings, Chat references and indexes as one recoverable graph. */
export function createResourceGraph(options = {}) {
  const resources = options.resources
  const presets = options.presets
  const chats = options.chats
  const operations = options.operations
  const fault = typeof options.fault === 'function' ? options.fault : async function () {}
  let tail = Promise.resolve()
  for (const method of ['rename', 'remove']) if (!resources || typeof resources[method] !== 'function') throw new Error('Resource Graph 缺少 resources.' + method)
  for (const method of ['readIndex', 'writeIndex', 'readChat', 'writeChat']) if (!chats || typeof chats[method] !== 'function') throw new Error('Resource Graph 缺少 chats.' + method)
  for (const method of ['read', 'write', 'remove']) if (!operations || typeof operations[method] !== 'function') throw new Error('Resource Graph 缺少 operations.' + method)

  async function checkpoint(operation, stage) {
    operation.stage = stage
    await operations.write(operation)
    await fault({ operation, stage })
  }

  async function projectRename(operation) {
    const oldPath = operation.path
    const renamed = await resources.rename(oldPath, operation.name)
    operation.result = renamed
    await checkpoint(operation, 'resource-renamed')
    const kind = resourceKind(oldPath)
    if (kind === 'preset' && presets && typeof presets.rename === 'function') await presets.rename(renamed.oldPath, renamed.path)
    const replacements = new Map([[renamed.oldPath, renamed.path]])
    if (renamed.scriptOldPath && renamed.scriptPath) replacements.set(renamed.scriptOldPath, renamed.scriptPath)
    const index = await chats.readIndex()
    for (const row of index.chats || []) {
      const chat = await chats.readChat(row.id)
      if (chat === undefined) continue
      let changed = false
      if (replacements.has(chat.cardPath)) {
        chat.cardPath = replacements.get(chat.cardPath)
        row.cardPath = chat.cardPath
        changed = true
      }
      if (kind === 'preset') {
        if (chat.runtimePresetPath === renamed.oldPath) { chat.runtimePresetPath = renamed.path; changed = true }
        if (chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object') {
          const snapshot = chat.runtimePresetSnapshot
          if (snapshot.presetPath === renamed.oldPath) { snapshot.presetPath = renamed.path; changed = true }
          for (const source of (snapshot.sources || []).concat(snapshot.regexSources || [])) {
            if (source && source.path === renamed.oldPath) { source.path = renamed.path; changed = true }
          }
        }
      }
      if (chat.workspace && typeof chat.workspace === 'object') {
        const nextSources = (chat.workspace.sourcePaths || []).map(function (item) { return replacements.get(item) || item })
        if (JSON.stringify(nextSources) !== JSON.stringify(chat.workspace.sourcePaths || [])) { chat.workspace.sourcePaths = nextSources; changed = true }
        const nextMounted = (chat.workspace.mountedResources || []).map(function (item) {
          if (!item || !replacements.has(item.path)) return item
          const nextPath = replacements.get(item.path)
          const filename = nextPath.split('/').pop()
          return Object.assign({}, item, { path: nextPath, label: filename.replace(/\.[^.]+$/, '') })
        })
        if (JSON.stringify(nextMounted) !== JSON.stringify(chat.workspace.mountedResources || [])) { chat.workspace.mountedResources = nextMounted; changed = true }
      }
      if (changed) await chats.writeChat(chat)
    }
    await chats.writeIndex(index)
    await checkpoint(operation, 'projected')
    await operations.remove()
    return { kind, path: renamed.path }
  }

  async function projectRemove(operation) {
    const normalized = normalizeResourcePath(operation.path, operation.expectedKind)
    await resources.remove(normalized)
    await checkpoint(operation, 'resource-removed')
    if (resourceKind(normalized) === 'preset' && presets && typeof presets.remove === 'function') await presets.remove(normalized)
    const index = await chats.readIndex()
    for (const row of index.chats || []) {
      const chat = await chats.readChat(row.id)
      if (chat === undefined || !chat.workspace || typeof chat.workspace !== 'object') continue
      const nextSources = (chat.workspace.sourcePaths || []).filter(function (item) { return item !== normalized })
      const nextMounted = (chat.workspace.mountedResources || []).filter(function (item) { return !item || item.path !== normalized })
      if (JSON.stringify(nextSources) === JSON.stringify(chat.workspace.sourcePaths || []) && JSON.stringify(nextMounted) === JSON.stringify(chat.workspace.mountedResources || [])) continue
      chat.workspace.sourcePaths = nextSources
      chat.workspace.mountedResources = nextMounted
      await chats.writeChat(chat)
    }
    await checkpoint(operation, 'projected')
    await operations.remove()
    return { kind: resourceKind(normalized), path: normalized }
  }

  async function execute(operation) {
    if (operation.kind === 'rename') return await projectRename(operation)
    if (operation.kind === 'remove') return await projectRemove(operation)
    throw new Error('未知 Resource Graph operation: ' + str(operation.kind))
  }

  function serialize(work) {
    const current = tail.catch(function () {}).then(work)
    tail = current
    return current
  }

  async function recover() {
    return serialize(async function () {
      const operation = await operations.read()
      return operation ? await execute(operation) : null
    })
  }

  async function rename(path, name) {
    return serialize(async function () {
      const previous = await operations.read()
      if (previous) await execute(previous)
      const operation = { schemaVersion: 1, kind: 'rename', path: normalizeResourcePath(path), name: str(name), stage: 'prepared' }
      await operations.write(operation)
      return await execute(operation)
    })
  }

  async function remove(path, expectedKind) {
    return serialize(async function () {
      const previous = await operations.read()
      if (previous) await execute(previous)
      const operation = { schemaVersion: 1, kind: 'remove', path: normalizeResourcePath(path, expectedKind), expectedKind: str(expectedKind), stage: 'prepared' }
      await operations.write(operation)
      return await execute(operation)
    })
  }

  return Object.freeze({ recover, rename, remove })
}
