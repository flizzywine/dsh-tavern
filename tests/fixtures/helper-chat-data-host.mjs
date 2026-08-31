import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { projectTavernHelperContext } from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
import { helperHostHarness } from './helper-host-harness.mjs'

export async function createHelperChatDataHost() {
  const directory = await mkdtemp(join(tmpdir(), 'helper-chat-data-'))
  const open = () => createChatPersistence({ store: createChatJournalStore({ dataRoot: directory }) })
  const persistence = open()
  for (const id of ['audit', 'other']) await persistence.write({
    id, sessionId: id, cardPath: 'card.json', mode: 'story', mvu: { enabled: false },
    tavernHelperLifecycleRevision: 2,
    messages: [{ id: 'greeting', role: 'assistant', greeting: true, turn: 1, text: '她回到了家。', sourceText: '她回到了家。', swipes: ['她回到了家。'], swipeId: 0, variables: [{ hp: 1 }] }],
    timeline: { revision: 5, branchId: 'branch-one' },
    foregroundFrame: { frameId: 'fixed', contributions: [{ text: '固定输入' }] }
  })
  const adapter = createTavernScriptHostAdapter({
    resolveChat: id => persistence.read(id), writeChat: (...args) => persistence.write(...args),
    updateChat: (...args) => persistence.update(...args), readChatRevision: (...args) => persistence.readRevision(...args),
    hasScripts: async () => true, isPlayChat: chat => chat.mode === 'story',
    readCard: async () => ({}), worldBooks: {}, eventGate: {}
  })
  const host = { directory, persistence, adapter, open,
    context: async (id = 'audit') => projectTavernHelperContext(await persistence.read(id)),
    cleanup: () => rm(directory, { recursive: true, force: true }),
    async invoke(method, args) {
      if (method !== 'saveTavernChatData') throw new Error('Unexpected method: ' + method)
      return adapter.saveChatData(args.sessionId || 'audit', args.request)
    },
    async connect(id = 'audit', intercept) {
      let run
      const initial = await host.context(id)
      run = helperHostHarness(initial, { onCall(message) {
        if (message.type !== 'dsh-tavern-helper-call') return
        const dispatch = () => host.invoke(message.method, { ...message.args, sessionId: id }).then(result => run.reply(message, result), error => run.reply(message, error.message, false))
        if (intercept) intercept(message, dispatch)
        else dispatch()
      } })
      return { ...run, api: run.window.SillyTavern.getContext() }
    }
  }
  return host
}
