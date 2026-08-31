import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../../tavern-plugin/lib/domain/tavern-extension-settings.js'
import { createWorldBookLibrary } from '../../tavern-plugin/lib/domain/worldbook-library.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

// Production library and adapter; only their storage providers point to disposable files.
export async function createHelperWorldbookHost(embedded = false) {
  const directory = await mkdtemp(join(tmpdir(), 'helper-worldbook-'))
  const book = { name: '审计书', unknownBook: 'keep', entries: embedded
    ? [{ id: 7, comment: '原条目', content: '旧正文', keys: ['旧词'], enabled: true, extensions: { vendor: 'keep' }, unknownEntry: 'keep' }]
    : { 7: { uid: 7, comment: '原条目', content: '旧正文', key: ['旧词'], disable: false, extensions: { vendor: 'keep' }, unknownEntry: 'keep' } } }
  const card = { name: '测试角色', ...(embedded ? { character_book: book } : {}) }
  const json = async name => JSON.parse(await readFile(join(directory, name), 'utf8'))
  const save = async (name, value) => writeFile(join(directory, name), JSON.stringify(value))
  await save('book.json', book)
  await save('card.json', card)
  const chat = { id: 'audit', cardPath: 'card.json', mvu: { enabled: false }, messages: [] }
  const library = createWorldBookLibrary({
    normalizePath(path) { if (!['book.json', 'card.json'].includes(path)) throw Error('fixture path'); return path },
    resources: { readText: path => readFile(join(directory, path), 'utf8'), write: (path, text) => writeFile(join(directory, path), text),
      bindingForCard: async () => embedded ? { kind: 'default' } : { kind: 'standalone', path: 'book.json', available: true } },
    cards: { read: () => json('card.json'), update: async (_path, patch) => save('card.json', { ...await json('card.json'), ...patch }) },
    removeStandalone: async () => {}
  })
  const extensionSettings = createTavernExtensionSettings(createProfileDataStore({ dataRoot: directory }))
  const adapter = createTavernScriptHostAdapter({ hasScripts: async () => true, extensionSettings, resolveChat: async () => chat, writeChat: async () => {}, readCard: () => json('card.json'), worldBooks: library, eventGate: {} })
  return { adapter, library, extensionSettings,
    read: async () => embedded ? (await json('card.json')).character_book : await json('book.json'),
    record: async () => library.bound('card.json', await json('card.json')),
    cleanup: () => rm(directory, { recursive: true, force: true }),
    async invoke(method, args) {
      if (method === 'saveTavernExtensionSettings') return adapter.saveExtensionSettings('audit', args.settings, args.expectedSettings)
      if (method === 'loadTavernWorldInfo') return adapter.loadWorldInfo('audit', args.name)
      if (method === 'saveTavernWorldInfo') return adapter.saveWorldInfo('audit', args.name, args.worldInfo, args.expectedWorldInfo)
      if (method === 'getTavernHelperWorldbook') return adapter.getWorldbook('audit', args.name)
      if (method === 'replaceTavernHelperWorldbook') return adapter.replaceWorldbook('audit', args.name, args.entries, args.expectedEntries)
      throw Error('Unexpected method: ' + method)
    }
  }
}
