import { createSessionViewProjection } from '../../tavern-plugin/lib/domain/session-view-projection.js'

export function projectionFixture(overrides = {}) {
  const calls = [], events = []
  const card = { name: '卡', path: 'cards/a.json' }
  const deps = {
    readChanges: async () => undefined, scheduleTemplateSync: () => calls.push('sync'), warmCandidates: () => calls.push('warm'),
    requestPerformance: { stage: (_name, work) => work() }, readTavernSettings: async () => ({ trustedCardMode: true }),
    readScript: async () => undefined, scriptContinuity: { inspect: () => null }, groupOfMode: mode => mode === 'card' ? 'card' : 'play',
    tavernExtensionSettings: { read: async () => ({}) }, readCardExtensions: async () => ({ regexScripts: [], helperScripts: [] }),
    tavernRemoteAssets: { pinExtensions: async value => ({ ...value, pins: [], diagnostics: [] }) },
    liveCardUpdate: { project: async (_chat, _card, value) => value }, activityOf: () => ({ busy: false, phase: 'idle' }),
    cardUpdateStatus: async () => ({ available: false }), agentRegistry: { get() {} }, str: value => String(value ?? ''),
    sessionResources: { issue: (id, revision, kind) => ({ id, revision, kind }) }, worldBooks: { bound: async () => null },
    sessionDebugEvidence: () => ({ loaded: false, events: [], nodes: [] }), cardViewOf: value => value,
    projectLedgerTask: () => null, projectPhoneChat: () => null,
    readPromptTemplateGlobalVariables: async () => ({}), sessionStore: { get: () => ({ events }) },
    readChatCard: async () => card, workspaceViewOf: () => ({}), helperHistoryAccess: { issue: value => value }, ...overrides
  }
  const chat = { id: 'c', sessionId: 's', mode: 'story', cardPath: card.path, cardName: card.name,
    _storageRevision: 1, mvu: { enabled: true, owner: 'official' }, messages: [{ role: 'assistant', turn: 1, greeting: true, text: '开场白' }] }
  return { projection: createSessionViewProjection(deps), chat, card, events, calls, deps }
}
