import { buildGameSave, collectSaveRevisions, sessionTitleOf } from './game-save.js'
import { compressSaveImage } from './save-image-compression.js'
import { normalizeResourcePath, resourceKind } from './file-resources.js'
import { computeSceneTarget } from './scene-illustration.js'

const str = value => typeof value === 'string' ? value : (value == null ? '' : String(value))

// Attachment references inside saved JSON (scene image versions, images in messages).
function attachmentRefs(value, found = new Map(), skip = new Set()) {
  if (!value || typeof value !== 'object') return found
  if (typeof value.attachmentId === 'string' && typeof value.mediaType === 'string' && value.mediaType.startsWith('image/')) found.set(value.attachmentId, value)
  for (const [key, child] of Object.entries(value)) if (!skip.has(key) && child && typeof child === 'object') attachmentRefs(child, found, skip)
  return found
}

// A save carries its own copy of the opening worldbook (the whole book as JSON) so one `.dshsave`
// opened on a clean install behaves exactly like the game it came from. When the same export also
// packs that worldbook as a resource, the copy is pure duplication — a book ran to 15 MB here and
// eleven games held four copies of it. Dropping it is a supported shape: a chat without a snapshot
// re-resolves the worldbook its card is bound to (worldbook-library resolveBound), which is the
// book the bundle just installed. Games whose book differs from the library keep their copy.
function withoutWorldbookSnapshot(chat, embed) {
  if (embed || !chat || !chat.openingWorldbookSnapshot) return chat
  const next = { ...chat }
  delete next.openingWorldbookSnapshot
  return next
}

// The runtime preset snapshot is the frozen preset a game renders with (regex, templates, prompt
// pieces). It is per game and never shared, so a bundle that already carries the preset itself
// makes it duplication too. Import re-freezes it from the preset the chat points at
// (`runtimePresetPath`), which is what the importing install just installed.
function withoutPresetSnapshot(chat, embed) {
  if (embed || !chat || !chat.runtimePresetSnapshot) return chat
  const next = { ...chat }
  delete next.runtimePresetSnapshot
  return next
}

// Export options: `images` (scene pictures) and `embedWorldbook` (keep the opening worldbook
// copy inside the save). Both default to keeping everything, so a lone save stays self-contained.
export function createGameSaveExporter({ chatForSession, gameSaveSnapshot, readChatRevision,
  fileResources, gameFootprint, sceneWorldbookArchive, getAttachments, exportPluginData,
  tavernVersion, hasBoundWorldbook = async () => false, warn = console.warn }) {
  async function exportGameSave(sessionId, options = {}) {
    const header = await chatForSession(str(sessionId))
    if (!header) throw new Error('当前 Session 没有绑定 Tavern 对话')
    return await gameSaveSnapshot(header.id, header.sessionId, async ({ chat, session }) => {
      // Only a game whose card really has a worldbook can fall back to it: with no bound book the
      // snapshot is the only world this game has, so it stays even when the bundle carries books.
      const embedWorldbook = options.embedWorldbook !== false ||
        !(await hasBoundWorldbook(str(chat.cardPath)).catch(() => false))
      // Without a recorded preset path there is nothing to re-freeze from on import.
      const embedPreset = options.embedPreset !== false || str(chat.runtimePresetPath) === ''
      const thin = value => withoutPresetSnapshot(withoutWorldbookSnapshot(value, embedWorldbook), embedPreset)
      const revisions = (await collectSaveRevisions(chat, readChatRevision))
        .map(item => ({ revision: item.revision, state: thin(item.state) }))
      let cardPayload = null
      try { cardPayload = await fileResources.originalCardPayload(chat.cardPath) } catch {}
      if (!cardPayload && chat.cardDefinitionSnapshot?.raw) cardPayload = { kind: 'text', name: str(chat.cardName || 'card') + '.json', text: JSON.stringify(chat.cardDefinitionSnapshot.raw) }
      let script = null
      if ((chat.mode || 'story') === 'script') {
        const scriptPath = await fileResources.scriptForCard(chat.cardPath)
        const text = scriptPath ? await fileResources.readText(normalizeResourcePath(scriptPath, resourceKind(scriptPath))) : undefined
        if (text !== undefined) script = { path: scriptPath, text }
      }
      let scene = null
      const media = attachmentRefs(session.events)
      if (options.images !== false) {
        const files = await gameFootprint.readSceneFiles(chat.id)
        for (const file of files) attachmentRefs(JSON.parse(file.content.toString('utf8')), media, new Set(['deletedVersions']))
        const worldbooks = await sceneWorldbookArchive.exportForSave([chat, ...revisions.map(item => item.state)])
        scene = { files, worldbooks, attachments: [] }
      }
      const attachments = []
      for (const ref of media.values()) {
        try {
          const image = await getAttachments().readImage(ref)
          attachments.push(await compressSaveImage({ attachmentId: ref.attachmentId, mediaType: ref.mediaType, data: Buffer.from(image.data) }))
          await new Promise(resolve => setImmediate(resolve))
        }
        catch { /* A missing picture must not block the save; the game keeps its reference. */ }
      }
      if (scene) scene.attachments = attachments
      else if (attachments.length) scene = { files: [], worldbooks: [], attachments }
      const plugins = await pluginSaveContents(chat)
      const buffer = buildGameSave({ chat: thin(chat), revisions, session,
        card: { path: chat.cardPath, payload: cardPayload }, script, scene, plugins,
        tavernVersion: tavernVersion, exportedAt: Date.now() })
      const name = (sessionTitleOf(session.events) || str(chat.title) || str(chat.cardName) || 'game').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
      return { filename: name + '.dshsave', base64: buffer.toString('base64'), bytes: buffer.length, revisions: revisions.length, images: attachments.length }
    })
  }
  // Plugin data and media of the story line shown now, with the files the media point at.
  async function pluginSaveContents(chat) {
    let state = null
    try { state = await exportPluginData(chat.id) } catch (error) { warn('dsh-tavern: 读取插件数据失败，存档不含插件数据:', str(error?.message || error)) }
    if (!state) return null
    const shown = new Set()
    for (const message of chat.messages || []) {
      if (message?.role !== 'assistant') continue
      const turn = Number(message.turn || (message.greeting ? 1 : 0))
      try { shown.add(turn + '\u0000' + computeSceneTarget(chat, turn).key) } catch {}
    }
    const media = state.media ? { ...state.media, items: state.media.items.filter(item => shown.has(item.turn + '\u0000' + item.key)) } : null
    const attachments = [], seen = new Set(), store = getAttachments()
    for (const ref of (media?.items || []).flatMap(item => [item.attachment, ...(item.history || []).map(entry => entry.attachment)])) {
      if (!ref || seen.has(ref.attachmentId) || !store) continue
      seen.add(ref.attachmentId)
      try {
        let data
        if (ref.mediaType) data = Buffer.from((await store.readImage(ref)).data)
        else {
          const chunks = []
          for await (const chunk of store.readFileStream(ref)) chunks.push(Buffer.from(chunk))
          data = Buffer.concat(chunks)
        }
        attachments.push({ attachmentId: ref.attachmentId, mediaType: ref.mediaType, name: ref.name, data })
      } catch { /* A missing file must not block the save; its item is left out on import. */ }
    }
    return { data: state.data, media, attachments }
  }
  return exportGameSave
}
