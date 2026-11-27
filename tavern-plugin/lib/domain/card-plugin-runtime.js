import { existsSync } from 'node:fs'
import path from 'node:path'
import { loaderReload, readPatchedUserPlugins, reconcileUserPluginsAtStartup, reloadUpdatedCardPlugins, syncUserPlugins, watchUserPlugins } from './user-plugins.js'

export async function createCardPluginRuntime({ dataRoot, dshHome, cardPaths, loader, fiber }) {
  const journalPath = path.join(dataRoot, 'card-plugin-update.journal.json')
  let writing = false
  let queued = Promise.resolve()

  // Read the patch the host started with before refreshing it. Moved plugin
  // folders may need an explicit reload even after DSH sees the new patch.
  const loaded = await readPatchedUserPlugins({ dataRoot, dshHome })
  const reload = loaderReload(loader, fiber)
  const syncPatch = beforePatch => syncUserPlugins({
    dataRoot, dshHome, cardPaths, pending: () => writing || existsSync(journalPath), beforePatch,
  })

  function enqueue(work) {
    const next = queued.catch(() => {}).then(() => work())
    queued = next
    return next
  }

  async function reloadCommitted(names) {
    let runtime = { reloaded: [], restartRequired: names }
    try {
      await syncPatch(async result => {
        runtime = await reloadUpdatedCardPlugins({ result, names, loaded, reload })
      })
    } catch (error) {
      console.warn('dsh-tavern: 同步已更新的人物卡插件失败', error?.message || error)
    }
    return runtime
  }

  // Keep filesystem writes and their reconciliation in the same queue as watch
  // events. Clear the write flag before reading the committed binding and files.
  function commit(write, after) {
    return enqueue(async () => {
      writing = true
      let committed
      try { committed = await write() } finally { writing = false }
      return after(committed, reloadCommitted)
    })
  }

  try {
    const result = await syncPatch()
    await reconcileUserPluginsAtStartup({ result, loaded, reload })
  } catch (error) { console.warn('dsh-tavern: 同步用户插件失败', error?.message || error) }

  const sync = () => enqueue(syncPatch)
  const watch = () => watchUserPlugins({ dataRoot, dshHome, loaded, reload, sync })
  return { journalPath, commit, sync, watch }
}
