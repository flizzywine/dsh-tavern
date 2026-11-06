import { createHash } from 'node:crypto'

function scriptToken(script) {
  const hash = createHash('sha256').update(JSON.stringify([script?.path, script?.importedAt]))
  for (const chunk of script?.chunks || []) hash.update(JSON.stringify([chunk.id, chunk.text]))
  return hash.digest('hex')
}

export function createScriptNavigation({ chats, readScript, scripts, isBusy, exclusive, updateSettings }) {
  function check(chat) {
    if (!chat || chat.mode !== 'script') throw new Error('当前会话不是剧本模式')
  }
  async function browse(sessionId, position) {
    const chat = await chats.forSession(sessionId)
    check(chat)
    const script = await readScript(chat.cardPath)
    return { ...scripts.inspect({ script, state: chat.scriptState, request: { kind: 'browse', position } }),
      revision: chat._storageRevision, cardPath: chat.cardPath, scriptVersion: scriptToken(script) }
  }
  async function mutate(sessionId, input, event) {
    const chat = await chats.forSession(sessionId)
    check(chat)
    return exclusive(chat.id, async () => {
      const script = await readScript(chat.cardPath)
      const token = scriptToken(script)
      const saved = await chats.update(chat.id, draft => {
        check(draft)
        if (isBusy(draft) || draft.scriptState?.prepared) throw new Error('请等待本轮任务结束后再修改剧本设置')
        if (input.revision === undefined || JSON.stringify(input.revision) !== JSON.stringify(draft._storageRevision)
          || input.cardPath !== draft.cardPath || draft.cardPath !== chat.cardPath) throw new Error('会话已变化，请刷新剧本列表后重试')
        if (input.scriptVersion !== token) throw new Error('剧本已更新，请刷新列表后重试')
        draft.scriptState = scripts.transition({ script, state: draft.scriptState, event }).state
        return draft
      }, { source: 'script.' + event.kind })
      if (event.kind === 'set-chunk-size') await updateSettings({ scriptChunkSize: saved.scriptState.chunkSize })
      return { cursor: saved.scriptState.cursor, chunkSize: saved.scriptState.chunkSize || 500, message: '已保存，下一轮生效' }
    })
  }
  return { browse, point: (sessionId, input) => mutate(sessionId, input, { kind: 'manual-focus', cursor: input.position }),
    setChunkSize: (sessionId, input) => mutate(sessionId, input, { kind: 'set-chunk-size', chunkSize: input.chunkSize }) }
}
