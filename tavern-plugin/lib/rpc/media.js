// Cast, stage, speech and illustration requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createMediaHandlers(deps) {
  const { backgroundConfigForSession, castAssets, castCardOf, castEdit, castPresentation, castStage,
    castView, fontLibrary, pluginGalleryItems, pluginMediaForTurn, pluginMediaTurns, removePluginGalleryItems,
    removePluginMediaVersion, sceneIllustrations, speakLine, prepareVoices, speech, speechReply, stageMusicTracks, str } = deps
  return {
    // The font library's families (font-library.js): what a skin's font ids resolve to.
    async listFonts() {
      return await fontLibrary.listFonts()
    },
    async pluginMediaForTurn(args) {
      return await pluginMediaForTurn(args && args.sessionId, args && args.turn)
    },
    async removePluginMediaVersion(args) {
      return await removePluginMediaVersion(args && args.sessionId, args && args.itemId, args && args.version)
    },
    // The lines come with the cast, so the story shows each speaker's picture for the line's emotion.
    async castForTurns(args) {
      const sessionId = str(args && args.sessionId)
      const result = await castPresentation.forTurns(sessionId, args && args.turns)
      const card = await castCardOf(sessionId).catch(() => null)
      return { ...result, characters: card ? await castView(sessionId, card.path, await castAssets.read(card.path)) : [] }
    },
    async castStage(args) {
      return await castStage(args && args.sessionId, args && args.count)
    },
    // The BGM player's list for its game (manual picks).
    async getStageMusicTracks(args) {
      return await stageMusicTracks(str(args && args.sessionId))
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
    // A character's reference clips (audio + what it says) for channels that take them inline (cast-presentation.md 22/N).
    async castAddVoiceReference(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.addVoiceReference({ cardPath, name: args.name, text: args.text, bytes: Buffer.from(str(args.data), 'base64') }))
    },
    async castRemoveVoiceReference(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.removeVoiceReference({ cardPath, name: args.name, file: str(args.file) }))
    },
    // A character's 配音来源: one configured channel, or its clone of the character's clips; '' is the channel in use.
    async castSetVoiceSource(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.setVoiceSource({ cardPath, name: args.name, provider: args.provider, clone: args.clone === true }))
    },
    // A character's 配音语言 (33/N); '' is the story's own language.
    async castSetVoiceLanguage(args) {
      return await castEdit(args && args.sessionId, cardPath => castAssets.setVoiceLanguage({ cardPath, name: args.name, language: args.language }))
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
    async speechPrepare(args) {
      return await prepareVoices(args && args.sessionId)
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
    async sceneImageStatus(args) {
      return { illustration: await sceneIllustrations.status(args.sessionId, args.turn) }
    },
    async listSceneImageHistory(args) {
      // The gallery shows only the session's own game.
      if (!args?.sessionId) return { items: await sceneIllustrations.history() }
      const chat = await backgroundConfigForSession(str(args.sessionId))
      return { items: chat?.id ? await sceneIllustrations.history(chat.id) : [], pluginItems: await pluginGalleryItems(args.sessionId) }
    },
    async removeSceneImageHistory(args) {
      const legacyItems = args && args.items || []
      const pluginItems = args && args.pluginItems || []
      if (!Array.isArray(legacyItems) || !Array.isArray(pluginItems) || legacyItems.length + pluginItems.length > 500) throw new Error('一次最多删除 500 张')
      if (args && Object.hasOwn(args, 'sessionId')) {
        const chat = await backgroundConfigForSession(str(args.sessionId))
        if (!chat?.id) throw new Error('当前游戏不存在，未删除图片')
        if (legacyItems.some(item => item?.chatId !== chat.id)) throw new Error('图片不属于当前游戏，未删除图片')
      }
      const results = await sceneIllustrations.removeStoredImages(legacyItems)
      return { results: results.concat(await removePluginGalleryItems(args && args.sessionId, pluginItems)) }
    },
  }
}
