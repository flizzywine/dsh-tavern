import { publicPluginMedia, pluginFileMediaType, removedPictures } from './plugin-media.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// What the player sees of plugin media: every read is limited to the text version on
// screen (pluginTurns.currentKey), and every removal tells that game's pages to refresh
// and the owning plugin what went (mediaRemoved), so its own copies go with it.
export function createPluginMediaViews({ pluginMedia, pluginTurns, sessionSignals, attachments: getAttachments, mediaRemoved = () => {},
  resolveGalleryContext = async () => null, listGalleryProviderItems = async () => [], readGalleryProviderImage, removeGalleryProviderItems = async () => [] }) {
  const publishChange = sessionId => sessionSignals.publish(sessionId, { kind: 'plugin-media', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) })
  // Bytes of one item, only while it belongs to the text version on screen.
  // `version` picks an earlier picture of the item (its history index); without it, the current one.
  async function readPluginMediaFile(sessionId, itemId, version) {
    const missing = () => Object.assign(new Error('媒体不存在或不属于当前正文版本'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    const game = await pluginTurns.resolveGame(str(sessionId))
    const item = game ? await pluginMedia.find(game.chatId, str(itemId)) : null
    if (!item || await pluginTurns.currentKey(game.sessionId, item.turn) !== item.key) throw missing()
    const ref = version === undefined || version === null || version === '' ? item.attachment : item.history?.[Number(version)]?.attachment
    const attachments = getAttachments()
    if (!ref || !attachments) throw missing()
    if (ref.mediaType) {
      const image = await attachments.readImage(ref)
      return { mediaType: ref.mediaType, data: image.data, length: image.data.byteLength }
    }
    return { mediaType: pluginFileMediaType(ref.name), length: Number(ref.bytes) || 0, name: ref.name, stream: signal => attachments.readFileStream(ref, signal) }
  }
  // The player removes one picture of a plugin illustration from the story (see pluginMedia.removeVersion).
  async function removePluginMediaVersion(sessionId, itemId, version) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!game) throw new Error('当前游戏不存在')
    const before = await pluginMedia.find(game.chatId, str(itemId))
    const item = await pluginMedia.removeVersion({ chatId: game.chatId, itemId: str(itemId), version })
    publishChange(game.sessionId)
    if (before) mediaRemoved(game.sessionId, before, removedPictures(before, version ?? 'current'), item === null)
    return { item: item ? publicPluginMedia(item) : null }
  }
  // One picture of an item by its file (a 回想 CG deleted from the stage): whichever version shows it now; nothing when gone.
  async function removePluginPicture(sessionId, itemId, attachmentId) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    const item = game ? await pluginMedia.find(game.chatId, str(itemId)) : null
    if (!item) return { item: null }
    if (item.attachment?.attachmentId === attachmentId) return removePluginMediaVersion(sessionId, itemId, null)
    const version = (item.history || []).findIndex(entry => entry.attachment?.attachmentId === attachmentId)
    return version < 0 ? { item: publicPluginMedia(item) } : removePluginMediaVersion(sessionId, itemId, version)
  }
  // Turns that hold any plugin item, so the browser asks only those turns.
  async function pluginMediaTurns(sessionId) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!game) return { turns: [] }
    return { turns: [...new Set((await pluginMedia.list({ chatId: game.chatId })).map(item => item.turn))].sort((a, b) => a - b) }
  }
  async function pluginMediaForTurn(sessionId, turn) {
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!game) return { key: null, items: [] }
    const key = await pluginTurns.currentKey(game.sessionId, Number(turn))
    if (!key) return { key: null, items: [] }
    const items = (await pluginMedia.list({ chatId: game.chatId, turn: Number(turn) })).filter(item => item.key === key)
    return { key, items: items.map(item => publicPluginMedia(item)) }
  }
  // The gallery also shows pictures plugins attached (dsh-tavern-image draws new ones there),
  // limited to the current text version of each turn, the same rule the story view uses.
  async function pluginGalleryItems(sessionId) {
    const context = await resolveGalleryContext(str(sessionId))
    const game = await pluginTurns.resolveGame(str(sessionId))
    if (!context && !game) return []
    const keys = new Map(), items = []
    if (game) {
      for (const item of await pluginMedia.list({ chatId: game.chatId })) {
        if (item.status !== 'ready' || !str(item.attachment?.mediaType).startsWith('image/')) continue
        if (!keys.has(item.turn)) keys.set(item.turn, await pluginTurns.currentKey(game.sessionId, item.turn))
        if (keys.get(item.turn) !== item.key) continue
        items.push({ id: item.id, turn: Number(item.turn) || 0, caption: str(item.caption), createdAt: Number(item.createdAt) || 0, updatedAt: Number(item.updatedAt) || 0 })
      }
    }
    try { return [...items, ...(context ? await listGalleryProviderItems(context.sessionId) : [])] }
    catch { return items }
  }
  async function removePluginGalleryItems(sessionId, ids) {
    if (!Array.isArray(ids) || !ids.length) return []
    if (ids.length > 500) throw new Error('一次最多删除 500 张')
    const game = await pluginTurns.resolveGame(str(sessionId))
    const context = await resolveGalleryContext(str(sessionId))
    const providerIds = ids.filter(id => str(id).startsWith('gallery:'))
    const providerResults = context ? await removeGalleryProviderItems(context.sessionId, providerIds) : providerIds.map(id => ({ versionId: str(id), ok: false, error: '当前会话不存在' }))
    const providerResultById = new Map(providerResults.map(result => [result.versionId, result]))
    const results = []
    for (const id of ids) {
      if (str(id).startsWith('gallery:')) { results.push(providerResultById.get(str(id)) || { versionId: str(id), ok: false, error: '图片不存在或来源不可用' }); continue }
      try {
        const item = game ? await pluginMedia.find(game.chatId, str(id)) : null
        if (!item) throw new Error('图片不存在或已删除')
        if (await pluginMedia.remove({ chatId: game.chatId, owner: item.owner, itemId: item.id })) mediaRemoved(game.sessionId, item, removedPictures(item), true)
        results.push({ versionId: str(id), ok: true })
      } catch (error) { results.push({ versionId: str(id), ok: false, error: str(error?.message || error) }) }
    }
    const changedSession = context?.sessionId || game?.sessionId
    if (changedSession && results.some(row => row.ok)) publishChange(changedSession)
    return results
  }

  async function readPluginGalleryImage(sessionId, itemId) {
    const context = await resolveGalleryContext(str(sessionId))
    if (!context || !readGalleryProviderImage) throw Object.assign(new Error('画廊图片不存在或不可用'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
    return readGalleryProviderImage(context.sessionId, itemId)
  }

  return { readPluginMediaFile, readPluginGalleryImage, removePluginMediaVersion, removePluginPicture, pluginMediaTurns, pluginMediaForTurn, pluginGalleryItems, removePluginGalleryItems }
}
