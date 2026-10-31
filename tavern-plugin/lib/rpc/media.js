// Cast, stage, speech and illustration requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createMediaHandlers(deps) {
  const { backgroundConfigForSession, castAssets, castEdit, castStage,
    pluginGalleryItems, pluginMediaForTurn, pluginMediaTurns, removePluginGalleryItems,
    removePluginMediaVersion, speakLine, speech, speechReply, str } = deps
  return {
    async pluginMediaForTurn(args) {
      return await pluginMediaForTurn(args && args.sessionId, args && args.turn)
    },
    async removePluginMediaVersion(args) {
      return await removePluginMediaVersion(args && args.sessionId, args && args.itemId, args && args.version)
    },
    async castStage(args) {
      return await castStage(args && args.sessionId, args && args.count)
    },
    async castSetImage(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.setImage({ cardPath, name: args.name, slot: args.slot, bytes: Buffer.from(str(args.data), 'base64') }))
    },
    async castRemoveImage(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.removeImage({ cardPath, name: args.name, slot: args.slot }))
    },
    async castSetCharacter(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.setCharacter({ cardPath, name: args.name, rename: args.rename, aliases: args.aliases }))
    },
    async castSetVoice(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.setVoice({ cardPath, name: args.name, provider: args.provider, voice: args.voice }))
    },
    async getSpeechSettings(args) {
      return await speech.present()
    },
    async updateSpeechSettings(args) {
      return await speech.save({ enabled: args && args.enabled, provider: args && args.provider, config: args && args.config || {}, apiKey: args && args.apiKey })
    },
    async speechTest(args) {
      return speechReply(await speech.synthesize({ provider: args && args.provider, text: str(args && args.text) || '你好，这是配音试听。', voice: args && args.voice, emotion: args && args.emotion }))
    },
    async speechForLine(args) {
      return await speakLine(args && args.sessionId, args || {})
    },
    // A channel's own model list (Fish /v1/info) for 配音 › 模型.
    async speechServiceInfo(args) {
      return await speech.serviceInfo({ provider: args && args.provider })
    },
    async castRemoveCharacter(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.removeCharacter({ cardPath, name: args.name }))
    },
    async castImportSpritePack(args) {
      return await castEdit(args && args.sessionId, (cardPath, card) => castAssets.importSpritePack({ cardPath, name: str(args.name).trim() || card.name || undefined, bytes: Buffer.from(str(args.data), 'base64') }))
    },
    async pluginMediaTurns(args) {
      return await pluginMediaTurns(args && args.sessionId)
    },
    // The gallery: pictures plugins attached to the session's game.
    async listSceneImageHistory(args) {
      return { items: [], pluginItems: args?.sessionId ? await pluginGalleryItems(args.sessionId) : [] }
    },
    async removeSceneImageHistory(args) {
      const pluginItems = args && args.pluginItems || []
      if (!Array.isArray(pluginItems) || pluginItems.length > 500) throw new Error('一次最多删除 500 张')
      return { results: await removePluginGalleryItems(args && args.sessionId, pluginItems) }
    },
  }
}
