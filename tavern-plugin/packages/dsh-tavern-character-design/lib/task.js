import { randomUUID } from 'node:crypto'

const TASK_PROMPT = 'Character design task started manually by the user. With empty design notes, pick the important characters needing a new or fuller design from the current story and existing files; with notes, follow them first. '
  + "Load character-design with skill, then check this game's lorebook and existing files by name or alias with character_design_read. If the lorebook already defines a character, character_design_reuse completes it with no new file; call character_design_save only for new characters without a definition or to revise an existing design file. Leave variables, postures and story text untouched."

/** One explicit request, with drafts committed only after the agent succeeds. */
export function createManualCharacterDesign({ archive, store, runAgent, selection, beginTask, withForegroundAgent = (_id, work) => work(), publishWorldbook,
  signal,
  onStatus = () => {}, onError = error => console.error('人物设计保存状态失败', error) }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.characterDesignTask || { status: 'idle' }
    return ['running', 'queued'].includes(state.status) && !jobs.has(chat.id)
      ? { ...state, status: 'failed', error: '人物设计已中断，请重试。' } : state
  }
  async function start({ sessionId, guidance }) {
    signal?.throwIfAborted()
    const request = String(guidance || '').trim()
    if (request.length > 4000) throw new Error('设计意见最多 4000 字')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    const requestId = randomUUID()
    jobs.set(chat.id, true)
    // A running task's status only reaches the page through reads of the session,
    // so the writes announce themselves: the open panel refreshes from the signal
    // instead of re-projecting the whole view every two seconds.
    const setTask = (status, error) => store.updateChat(chat.id, draft => {
      if (status === 'failed' && draft.characterDesignTask?.requestId !== requestId) return draft
      if (status !== 'failed') signal?.throwIfAborted()
      draft.characterDesignTask = { requestId, status, guidance: request, error: error ? String(error.message || error) : '' }
      return draft
    }).then(function (result) {
      onStatus(String(sessionId || ''))
      return result
    })
    let started
    try { started = await archive.beginOrQueue(onQueued => beginTask(chat, sessionId, onQueued, signal)) }
    catch (error) { jobs.delete(chat.id); throw error }
    if (!started.queued) {
      try { await setTask('running') }
      catch (error) { jobs.delete(chat.id); await started.taskRun.fail(); throw error }
      jobs.set(chat.id, execute(chat, request, model, sessionId, started.taskRun, requestId, setTask).catch(onError).finally(() => jobs.delete(chat.id)))
      return { status: 'running' }
    }
    // 书记 is busy with another task: the click returns now; the design starts once it frees.
    jobs.set(chat.id, (async () => {
      await setTask('queued').catch(onError)
      let taskRun
      try {
        taskRun = await started.begun
        // The story and the design document may have moved while it waited.
        const fresh = await store.chatForSession(sessionId) || chat
        await setTask('running')
        await execute(fresh, request, model, sessionId, taskRun, requestId, setTask)
      } catch (error) {
        if (taskRun) await taskRun.fail().catch(onError)
        await setTask('failed', error)
      }
    })().catch(onError).finally(() => jobs.delete(chat.id)))
    return { status: 'queued' }
  }
  async function execute(chat, guidance, model, sessionId, taskRun, requestId, setTask) {
    let result
    try {
      signal?.throwIfAborted()
      const card = await store.readCard(chat)
      const snapshot = archive.snapshotWorldbook(chat, chat.openingWorldbookSnapshot?.version === 1
        ? null : await store.readWorldBook?.(chat, card))
      const worldbookDraft = { openingWorldbookSnapshot: snapshot }
      const savedCharacters = new Map()
      const draft = archive.createDraft({ document: chat.characterDesignDocument,
        worldbook: () => worldbookDraft.openingWorldbookSnapshot.document,
        onSave: character => {
          const applied = archive.applyWorldbook(worldbookDraft, character)
          savedCharacters.set(character.name, character)
          return applied
        } })
      let saveError = ''
      const recent = (chat.messages || []).filter(message => message.role === 'user' || message.role === 'assistant').slice(-12)
        .map(message => ({ role: message.role, text: message.sourceText || message.text || '' }))
      result = await withForegroundAgent(sessionId, () => runAgent({
        task: 'character-design', persistent: true,
        persistentSessionId: taskRun.participantRequest.sessionId,
        rewindTo: taskRun.participantRequest.rewindTo,
        rewindFormatVersion: taskRun.participantRequest.formatVersion,
        onPersistentSessionReady: id => taskRun.bindSession(id), sessionId, chatId: chat.id, selection: model,
        backgroundTasks: { variables: false, posture: false, characterDesign: true },
        signal,
        system: archive.promptSection('character_design', TASK_PROMPT),
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ guidance, card: { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario }, recent }) }] }],
        tools: draft.tools, onToolCall: async call => {
          const output = await draft.execute(call)
          if (call?.name === archive.saveToolName) {
            const saved = JSON.parse(output)
            saveError = saved.ok ? '' : saved.error
          }
          return output
        }
      }))
      signal?.throwIfAborted()
      if (!draft.changed() && !draft.reused().length) throw new Error(saveError
        ? '人物档案保存失败：' + saveError + '。模型未完成修正，请重试。'
        : '模型未调用人物档案保存工具，本次未保存设计档案。请重试；若持续出现，请检查后台模型是否支持工具调用。')
      // Character files change no story: in-flight work fenced on the revision stays valid.
      const completed = await taskRun.commit({ participant: taskRun.participant(result), stateChanged: false, beforePersist: publishWorldbook ? current => publishWorldbook(current, [...savedCharacters.values()]) : undefined, apply: current => {
        signal?.throwIfAborted()
        if (current.characterDesignTask?.requestId !== requestId) throw new Error('人物设计任务已更换')
        for (const reuse of draft.reused()) {
          const entries = archive.findWorldbookEntries(current.openingWorldbookSnapshot?.version === 1 ? current.openingWorldbookSnapshot.document : snapshot.document, [reuse.name])
          if (reuse.entries.some(old => !entries.some(entry => entry.ref === old.ref && entry.content === old.content))) throw new Error('复用的人物世界书已变化，请重新设计')
        }
        for (const character of savedCharacters.values()) archive.applyWorldbook(current, character, snapshot)
        if (draft.changed()) current.characterDesignDocument = draft.document()
        current.characterDesignTask = { requestId, status: 'done', guidance, error: '', reused: draft.reused().map(({ name }) => name) }
        return current
      } })
      if (completed.status !== 'committed') throw new Error('剧情已变化，本次设计未保存，请重试。')
      onStatus(String(sessionId || ''))
    } catch (error) {
      await taskRun.fail(result)
      await setTask('failed', error)
    }
  }
  // The player removes one archived character by name. Only this game changes: its
  // archive and its generated worldbook entry; the card's worldbook library is shared
  // with other games and stays as it is. The model has no delete tool.
  async function remove({ sessionId, name }) {
    signal?.throwIfAborted()
    const target = String(name || '').trim()
    if (!target) throw new Error('缺少要删除的人物')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中，请完成后再删除')
    let result
    await store.updateChat(chat.id, current => {
      signal?.throwIfAborted()
      const document = current.characterDesignDocument
      const characters = Array.isArray(document?.characters) ? document.characters : []
      if (!characters.some(character => character?.name === target)) throw new Error('找不到人物档案：' + target)
      current.characterDesignDocument = { ...document, characters: characters.filter(character => character?.name !== target),
        revision: Math.max(0, Number(document.revision) || 0) + 1, updatedAt: Date.now() }
      result = archive.removeFromWorldbook(current, target)
      return current
    })
    onStatus(sessionId)
    return { name: target, worldbookRemoved: result.removed, worldbookEdited: result.edited }
  }
  return { start, remove, project, wait: chatId => jobs.get(chatId) }
}
