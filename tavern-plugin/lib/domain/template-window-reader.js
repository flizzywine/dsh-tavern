import { readRecentWindow } from './bounded-history.js'
// Fields consumed by template state and its environment, including the saved
// resource snapshots. Unchanged refreshes must not silently switch to live cards.
export const templateStateFields = Object.freeze([
  'id', 'sessionId', '_storageRevision', 'tavernHelperLifecycleRevision',
  'backgroundConfigVersion', 'conversationFeaturesVersion', 'mode', 'cardPath',
  'macroState.userName', 'settleStatus', 'variables', 'tavernPluginMetadata',
  'promptTemplateInput', 'runtimePresetSnapshot', 'cardDefinitionSnapshot', 'openingWorldbookSnapshot'
])

/** A complete short history uses the cursor/delta protocol. Only truncate when
 * there is actually an older page to fetch; otherwise readWindow would copy the
 * whole saved card and world on every template refresh before discarding it.
 */
export function createTemplateWindowReader({ links, readWindow, access, historyFrom = () => undefined }) {
  return async sessionId => {
    const chatId = (await links())[String(sessionId)]
    if (!chatId) return undefined
    // Older floors the browser has displayed stay loaded, so their template
    // display is processed as in a complete history.
    const window = await readRecentWindow(readWindow, chatId, { limit: 200, from: historyFrom(sessionId), requirePartial: true })
    if (!window || window.chat.sessionId !== sessionId || window.chat.backgroundConfigVersion !== 1 || window.chat.conversationFeaturesVersion !== 1) return undefined
    return { chat: window.chat, historyWindow: {
      ...access.issue({ chatId, revision: window.revision, messageCount: window.messageCount }),
      from: window.from, messageCount: window.messageCount + (window.chat.promptTemplateInput?.message ? 1 : 0)
    } }
  }
}
