// Cast, stage, speech and illustration requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createMediaHandlers(deps) {
  const { backgroundConfigForSession, castAssets, castEdit, castStage,
    pluginGalleryItems, pluginMediaForTurn, pluginMediaTurns, removePluginGalleryItems,
    removePluginMediaVersion, speakLine, str } = deps
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
    // 台词朗读: { url, mediaType, loudness } | { browser, voice, text } | { skip, reason } (TTS_UNAVAILABLE without a voice service).
    async speechForLine(args, method, serverTemplate, authority) {
      return await speakLine(args && args.sessionId, args || {}, authority?.origin)
    },
    // Speech recognition: the host's shared service (speech-recognition-host.js).
    getSpeechRecognitionConfig(args) { return deps.speechRecognition.methods.getSpeechRecognitionConfig(args) },
    saveSpeechRecognitionConfig(args) { return deps.speechRecognition.methods.saveSpeechRecognitionConfig(args) },
    setSpeechRecognitionKey(args) { return deps.speechRecognition.methods.setSpeechRecognitionKey(args) },
    startSpeechRecognition(args) { return deps.speechRecognition.methods.startSpeechRecognition(args) },
    appendSpeechRecognition(args) { return deps.speechRecognition.methods.appendSpeechRecognition(args) },
    pollSpeechRecognition(args) { return deps.speechRecognition.methods.pollSpeechRecognition(args) },
    cancelSpeechRecognition(args) { return deps.speechRecognition.methods.cancelSpeechRecognition(args) },
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
