// Task activity and startup eligibility need header metadata, not message rows.
// A legacy unfinished foreground operation is the exception: timeline.inspect
// migrates that body using its original story data, so retain the full fallback.
export const taskStateFields = Object.freeze([
  'title', 'createdAt', 'lastOpenedAt', 'backgroundHistoryIds',
  'id', 'sessionId', '_storageRevision', 'mode', 'backgroundConfigVersion', 'conversationFeaturesVersion',
  'regenInProgress', 'contextCompaction', 'cardPath', 'cardName', 'requestMode', 'candidates', 'taskMailbox', 'candidateAgent', 'updatedAt',
  ...['schemaVersion','branchId','revision','operations','participants','updatedAt'].map(key=>'timeline.'+key),
])
const needsStory = chat => Object.values(chat?.timeline?.operations || {}).some(operation =>
  operation?.kind === 'body' && operation.status === 'foreground-completed')

export function createTaskStateReader({ readSlice, readState, headerForSession, stateForSession }) {
  return Object.freeze({
    async read(chatId) {
      const selected = await readSlice(chatId, [], taskStateFields)
      if (!selected || needsStory(selected.chat)) return readState(chatId)
      return selected.chat
    },
    async forSession(sessionId) {
      // The host adapter still owns alias recovery and configuration adoption.
      const chat = await headerForSession(sessionId, taskStateFields)
      return needsStory(chat) ? stateForSession(sessionId) : chat
    },
  })
}
