import { normalizeResourcePath, resourceKind } from './file-resources.js'

// Set a list field only when its content changes, so untouched Chats are not rewritten.
function setList(target, key, next) { if (JSON.stringify(next) !== JSON.stringify(target[key] || [])) target[key] = next }

function str(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

/** Keep resource files, bindings, Chat references and indexes as one recoverable graph. */
export function createResourceGraph(options = {}) {
  const resources = options.resources
  const presets = options.presets
  const chats = options.chats
  const operations = options.operations
  const fault = typeof options.fault === 'function' ? options.fault : async function () {}
  const logger = options.logger || console
  let tail = Promise.resolve()
  for (const method of ['rename', 'remove']) if (!resources || typeof resources[method] !== 'function') throw new Error('Resource Graph 缺少 resources.' + method)
  for (const method of ['readIndex', 'updateIndex', 'updateRefs']) if (!chats || typeof chats[method] !== 'function') throw new Error('Resource Graph 缺少 chats.' + method)
  for (const method of ['read', 'write', 'remove']) if (!operations || typeof operations[method] !== 'function') throw new Error('Resource Graph 缺少 operations.' + method)

  async function checkpoint(operation, stage) {
    operation.stage = stage
    await operations.write(operation)
    await fault({ operation, stage })
  }

  async function projectRename(operation, committed) {
    const oldPath = operation.path
    const renamed = await resources.rename(oldPath, operation.name)
    operation.result = renamed
    await checkpoint(operation, 'resource-renamed')
    const kind = resourceKind(oldPath)
    if (kind === 'card') {
      await options.cardOrganization?.movePath(renamed.oldPath, renamed.path)
      await options.castAssets?.movePath(renamed.oldPath, renamed.path)
      await options.cardPlugins?.movePath(renamed.oldPath, renamed.path)
      await checkpoint(operation, 'card-assets-moved')
    }
    if (kind === 'preset' && presets && typeof presets.rename === 'function') await presets.rename(renamed.oldPath, renamed.path)
    const replacements = new Map([[renamed.oldPath, renamed.path]])
    if (renamed.scriptOldPath && renamed.scriptPath) replacements.set(renamed.scriptOldPath, renamed.scriptPath)
    // Only the reference header fields are read and patched: a full Chat read per save made
    // renaming or deleting one preset replay every save's history.
    function project(chat) {
      if (replacements.has(chat.cardPath)) chat.cardPath = replacements.get(chat.cardPath)
      if (kind === 'preset') {
        if (chat.runtimePresetPath === renamed.oldPath) chat.runtimePresetPath = renamed.path
        if (chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object') {
          const snapshot = chat.runtimePresetSnapshot
          if (snapshot.presetPath === renamed.oldPath) snapshot.presetPath = renamed.path
          for (const source of (snapshot.sources || []).concat(snapshot.regexSources || [])) {
            if (source && source.path === renamed.oldPath) source.path = renamed.path
          }
        }
      }
      if (chat.workspace && typeof chat.workspace === 'object') {
        setList(chat.workspace, 'sourcePaths', (chat.workspace.sourcePaths || []).map(function (item) { return replacements.get(item) || item }))
        setList(chat.workspace, 'mountedResources', (chat.workspace.mountedResources || []).map(function (item) {
          if (!item || !replacements.has(item.path)) return item
          const nextPath = replacements.get(item.path)
          const filename = nextPath.split('/').pop()
          return Object.assign({}, item, { path: nextPath, label: filename.replace(/\.[^.]+$/, '') })
        }))
      }
      return chat
    }
    // A Chat opens by its cardPath, so Chats played on the renamed card or script are
    // updated before answering; every other reference is updated in the background.
    const rows = ((await chats.readIndex()).chats || []).filter(Boolean)
    for (const row of rows.filter(row => replacements.has(row.cardPath))) await chats.updateRefs(row.id, project)
    await chats.updateIndex(current => ({ ...current,
      chats: (current?.chats || []).map(row => replacements.has(row.cardPath) ? { ...row, cardPath: replacements.get(row.cardPath) } : row)
    }))
    committed({ kind, path: renamed.path })
    for (const row of rows.filter(row => !replacements.has(row.cardPath))) await chats.updateRefs(row.id, project)
    await checkpoint(operation, 'projected')
    await operations.remove()
    return { kind, path: renamed.path }
  }

  async function projectRemove(operation, committed) {
    const normalized = normalizeResourcePath(operation.path, operation.expectedKind)
    await resources.remove(normalized)
    await checkpoint(operation, 'resource-removed')
    if (resourceKind(normalized) === 'card') await options.cardOrganization?.movePath(normalized, null)
    if (resourceKind(normalized) === 'preset' && presets && typeof presets.remove === 'function') await presets.remove(normalized)
    committed({ kind: resourceKind(normalized), path: normalized })
    const index = await chats.readIndex()
    // Only card workbenches mount resources; other Chats never need reading here.
    for (const row of (index.chats || []).filter(function (row) { return row && row.mode === 'card' })) {
      await chats.updateRefs(row.id, function (chat) {
        if (!chat.workspace || typeof chat.workspace !== 'object') return chat
        setList(chat.workspace, 'sourcePaths', (chat.workspace.sourcePaths || []).filter(function (item) { return item !== normalized }))
        setList(chat.workspace, 'mountedResources', (chat.workspace.mountedResources || []).filter(function (item) { return !item || item.path !== normalized }))
        return chat
      })
    }
    await checkpoint(operation, 'projected')
    await operations.remove()
    return { kind: resourceKind(normalized), path: normalized }
  }

  async function execute(operation, committed = function () {}) {
    if (operation.kind === 'rename') return await projectRename(operation, committed)
    if (operation.kind === 'remove') {
      try { return await projectRemove(operation, committed) }
      catch (error) {
        // This rejection happens before any file mutation. Keeping it as a
        // recoverable operation would block every later rename/remove forever.
        // I/O failures and partially applied operations must remain recoverable.
        if (operation.stage === 'prepared' && error.code === 'DSH_TAVERN_RESOURCE_BOUND') await operations.remove()
        throw error
      }
    }
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

  // The caller gets its answer once the resource itself has changed. Rewriting
  // references in every Chat goes on in the background, still serialized: the next
  // rename/remove waits for it, and the operation log finishes it after a crash.
  function start(operation) {
    return new Promise(function (resolve, reject) {
      let answered = false
      function answer(value) { if (!answered) { answered = true; resolve(value) } }
      serialize(async function () {
        const previous = await operations.read()
        if (previous) await execute(previous)
        await operations.write(operation)
        return await execute(operation, answer)
      }).then(answer, function (error) {
        if (!answered) { answered = true; reject(error); return }
        logger.warn('dsh-tavern: 后台更新存档中的资源引用失败，下次资源操作或启动时继续:', str(error && error.message || error))
      })
    })
  }

  async function rename(path, name) {
    return await start({ schemaVersion: 1, kind: 'rename', path: normalizeResourcePath(path), name: str(name), stage: 'prepared' })
  }

  async function remove(path, expectedKind) {
    return await start({ schemaVersion: 1, kind: 'remove', path: normalizeResourcePath(path, expectedKind), expectedKind: str(expectedKind), stage: 'prepared' })
  }

  /** Resolves once every queued operation, including background reference updates, has settled. */
  function idle() { return tail.catch(function () {}).then(function () {}) }

  return Object.freeze({ recover, rename, remove, idle })
}
