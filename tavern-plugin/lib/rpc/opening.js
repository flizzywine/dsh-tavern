import { openingInitializationPayload } from '../domain/opening-transport.js'
import { prepareSessionOpening } from '../domain/session-opening.js'

// Opening selection and game start requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createOpeningHandlers(deps) {
  const { chatForSession, ensureNativeOpening, fullTemplateRuntime, getCardOpenings, openingPreparation,
    readChatCard, requestPerformance, runtimePresets, startChat, str } = deps
  return {
    async prepareSessionOpening(args) {
      const chat = await chatForSession(args && args.sessionId)
      if (!chat) throw new Error('找不到原对话')
      return await prepareSessionOpening({ chat, card: await readChatCard(chat), swipeId: args.swipeId, message: args.message, preparation: openingPreparation })
    },
    async callOpeningRuntime(args) {
      return await openingPreparation.callRuntime(args && args.id, args && args.method, args && args.args)
    },
    async saveOpeningSelection(args) {
      return openingPreparation.select(args && args.id, args && args.openingId)
    },
    async initializeOpeningTemplate(args) {
      // The engine seeds initial values from world-book entries naming [InitialVariables] and
      // returns an empty set otherwise. With no such entry the fork only pays a process start
      // (jsdom plus the 3.6 MB template engine) to compute {} — write the same result here.
      if (!openingPreparation.needsTemplateInitial(args && args.id)) return openingInitializationPayload(openingPreparation.applyTemplateInitial(args.id, { initial: {} }), args && args.compact)
      try { return openingInitializationPayload(await openingPreparation.applyTemplateInitial(args.id, await requestPerformance.stage('templateInitialize', () => fullTemplateRuntime.forSession('opening:' + args.id).initializeVariables([]))), args.compact) } finally { fullTemplateRuntime.cancel('opening:' + args.id) }
    },
    async createOpeningPreparation(args) {
      return await openingPreparation.create(args && args.path)
    },
    async getOpeningPreparation(args) {
      return args?.touchOnly === true ? openingPreparation.retain(args.id) : openingPreparation.get(args && args.id)
    },
    async retainOpeningPreparation(args) {
      return openingPreparation.retain(args && args.id)
    },
    async releaseOpeningPreparation(args) {
      fullTemplateRuntime.cancel('opening:' + args.id); return openingPreparation.release(args && args.id)
    },
    async replaceOpeningWorldbook(args) {
      return await openingPreparation.replaceWorldbook(args && args.id, args && args.entries, args && args.expectedEntries)
    },
    async getCardOpenings(args) {
      return await getCardOpenings(args && args.path, args && args.userName, args && args.previewTransport)
    },
    async preparePlayStart(args) {
      await requestPerformance.stage('preparePreset', () => runtimePresets.prepareFullSnapshot())
      return { prepared: true }
    },
    async startChat(args) {
      try {
        return { view: await startChat(args && args.path, args && args.sessionId, args && args.mode, args && args.openingId, args && args.userName, args && args.requestMode, args && args.preparationId, args && args.cardTask) }
      } catch (error) {
        console.error('dsh-tavern: 创建对话失败', {
          cardPath: str(args && args.path),
          sessionId: str(args && args.sessionId),
          mode: str(args && args.mode),
          openingId: str(args && args.openingId),
          error: str(error && error.message || error)
        })
        throw error
      }
    },
    async ensureOpening(args) {
      return { view: await ensureNativeOpening(args && args.sessionId) }
    },
  }
}
