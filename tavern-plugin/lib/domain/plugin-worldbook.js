import { inspectWorldBookDocument } from './worldbook-resource.js'

/** Stable per plugin entry, so cooldown and read records survive between turns. */
export function pluginWorldbookRef(entry) {
  return 'plugin:' + entry.owner + '/' + entry.source + '/' + entry.id
}

/**
 * The bound world book plus plugin entries (tavern.worldbookEntries), for recall only.
 * Plugin entries join the view Tavern's recall, search and screening read; the bound
 * document and its files stay untouched, so editing and templates never see them.
 */
export function withPluginWorldbookEntries(record, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return record
  const document = { entries: {} }
  entries.forEach((entry, index) => {
    document.entries[index] = {
      uid: index, key: entry.keys, keysecondary: entry.secondaryKeys, comment: entry.title, content: entry.content,
      constant: entry.constant, selective: entry.secondaryKeys.length > 0, selectiveLogic: 0, order: 100, position: 0, disable: false,
      extensions: { dsh_tavern_plugin: { plugin: entry.owner, source: entry.source, id: entry.id } }
    }
  })
  const added = inspectWorldBookDocument(document).entries.map((projected, index) => {
    const ref = pluginWorldbookRef(entries[index])
    return { ...projected, ref, sourceUid: ref, sourcePath: '', title: entries[index].title || entries[index].keys[0] || entries[index].id, plugin: entries[index].owner }
  })
  const view = record?.view || { ...inspectWorldBookDocument({ entries: {} }), displayName: '插件世界书' }
  const pluginActivationRequests = entries.filter(entry => entry.force).map(entry => ({ ref: pluginWorldbookRef(entry), force: true, sourceRef: '[PLUGIN:' + entry.owner + ']' }))
  return {
    ...(record || { source: { kind: 'plugin' }, document: null }),
    view: { ...view, entries: [...view.entries, ...added], entryCount: view.entries.length + added.length, enabledCount: (view.enabledCount || 0) + added.length },
    pluginActivationRequests
  }
}
