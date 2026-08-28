import { cardOpeningChoices } from './card-openings.js'
import { readMvuWorldBookInitialState } from './tavern-mvu-runtime.js'

export const MVU_OPENING_RECONCILIATION_VERSION = 1

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function pending(chat) {
  const state = chat && chat.mvu && chat.mvu.openingInitialization
  return state && Number(state.version) === MVU_OPENING_RECONCILIATION_VERSION && state.status === 'pending'
}

function greetingOf(chat) {
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).find(function (message) {
    return message && message.role === 'assistant' && message.greeting === true
  })
}

/**
 * Re-run opening MVU after browser-owned Helper listeners are ready.
 * The provisional server-only result keeps first paint fast; this coordinator
 * replaces it only after every lifecycle event completed in the leased runtime.
 */
export function createTavernMvuOpeningReconciler(options = {}) {
  const runtime = options.runtime
  const resolveChat = options.resolveChat
  const readCard = options.readCard
  const updateChat = options.updateChat
  const dispatch = options.dispatch
  const now = typeof options.now === 'function' ? options.now : Date.now
  const jobs = new Map()
  if (!runtime || typeof runtime.initializeChat !== 'function') throw new Error('MVU 开场协调器缺少运行时')
  if (typeof resolveChat !== 'function' || typeof readCard !== 'function' || typeof updateChat !== 'function' || typeof dispatch !== 'function') throw new Error('MVU 开场协调器缺少宿主 adapter')

  async function execute(sessionId) {
    const chat = await resolveChat(sessionId)
    if (!chat || !pending(chat)) return { updated: false, status: 'not-required' }
    const greeting = greetingOf(chat)
    if (!greeting) return { updated: false, status: 'missing-greeting' }
    const card = await readCard(chat)
    const macroContext = {
      userName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      charName: str(card && card.name)
    }
    const choices = cardOpeningChoices(card)
    const swipes = Array.isArray(greeting.swipes) && greeting.swipes.length > 0
      ? greeting.swipes.map(str)
      : choices.map(function (choice) { return choice.text })
    if (swipes.length === 0) return { updated: false, status: 'missing-swipes' }
    const initial = readMvuWorldBookInitialState(card && card.character_book, macroContext)
    let handledEvents = 0
    let complete = true
    const result = await runtime.initializeChat({
      swipes,
      selectedSwipeId: Number(greeting.swipeId) || 0,
      baseStatData: initial.statData,
      initializedLorebooks: initial.initializedLorebooks,
      macroContext,
      emit: async function (name, ...args) {
        const delivered = await dispatch({ sessionId, name, args, chat })
        if (!delivered || delivered.handled !== true) complete = false
        else handledEvents += 1
        return delivered && Array.isArray(delivered.args) ? delivered.args : args
      }
    })
    if (!complete || handledEvents === 0) return { updated: false, status: 'runtime-unavailable', handledEvents }
    const diagnostics = initial.diagnostics.concat(result.diagnostics)
    const saved = await updateChat(chat.id, function (current) {
      if (!current || !pending(current)) return current
      const target = greetingOf(current)
      if (!target) return current
      target.swipeId = result.swipeId
      target.swipes = clone(result.swipes)
      target.variables = clone(result.variables)
      target.mvu = {
        modified: false,
        diagnostics: clone(diagnostics),
        events: clone(result.events)
      }
      current.mvu.diagnostics = clone(diagnostics)
      current.mvu.openingInitialization = {
        version: MVU_OPENING_RECONCILIATION_VERSION,
        status: 'complete',
        handledEvents,
        completedAt: now()
      }
      current.tavernHelperLifecycleRevision = Math.max(0, Number(current.tavernHelperLifecycleRevision) || 0) + 1
      return current
    }, { source: 'mvu.opening-helper-reconciliation' })
    const completed = saved && saved.mvu && saved.mvu.openingInitialization && saved.mvu.openingInitialization.status === 'complete'
    return { updated: Boolean(completed), status: completed ? 'complete' : (saved ? 'not-required' : 'missing-chat'), handledEvents }
  }

  async function reconcile(sessionId) {
    const key = str(sessionId)
    if (key === '') return { updated: false, status: 'missing-session' }
    if (jobs.has(key)) return await jobs.get(key)
    const job = execute(key).finally(function () { jobs.delete(key) })
    jobs.set(key, job)
    return await job
  }

  return Object.freeze({ reconcile, pending })
}
