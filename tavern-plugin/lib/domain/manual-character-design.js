import { CHARACTER_DESIGN_SAVE_TOOL_NAME, createCharacterDesignDocumentSession } from './character-design-document.js'
import { applyCharacterDesignWorldbook, characterDesignWorldbookSnapshot, characterWorldbookEntries, removeCharacterDesignWorldbook } from './character-design-worldbook.js'

/** One explicit request, with drafts committed only after the agent succeeds. */
export function createManualCharacterDesign({ store, runAgent, selection, beginTask, ensureSession = async () => {}, publishWorldbook, onError = error => console.error('人物设计保存状态失败', error) }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.characterDesignTask || { status: 'idle' }
    return state.status === 'running' && !jobs.has(chat.id)
      ? { ...state, status: 'failed', error: '人物设计已中断，请重试。' } : state
  }
  async function start({ sessionId, guidance }) {
    const request = String(guidance || '').trim()
    if (request.length > 4000) throw new Error('设计意见最多 4000 字')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    jobs.set(chat.id, true)
    let taskRun
    try {
      taskRun = await beginTask(chat, sessionId)
      await store.updateChat(chat.id, draft => {
        draft.characterDesignTask = { status: 'running', guidance: request, error: '' }
        return draft
      })
    } catch (error) {
      jobs.delete(chat.id)
      if (taskRun) await taskRun.fail()
      throw error
    }
    const task = execute(chat, request, model, sessionId, taskRun).catch(onError).finally(() => jobs.delete(chat.id))
    jobs.set(chat.id, task)
    return { status: 'running' }
  }
  async function execute(chat, guidance, model, sessionId, taskRun) {
    let result
    try {
      await ensureSession(sessionId)
      const card = await store.readCard(chat)
      const snapshot = characterDesignWorldbookSnapshot(chat, chat.openingWorldbookSnapshot?.version === 1
        ? null : await store.readWorldBook?.(chat, card))
      const worldbookDraft = { openingWorldbookSnapshot: snapshot }
      const savedCharacters = new Map()
      const draft = createCharacterDesignDocumentSession({ document: chat.characterDesignDocument,
        worldbook: () => worldbookDraft.openingWorldbookSnapshot.document,
        onSave: character => {
          const applied = applyCharacterDesignWorldbook(worldbookDraft, character)
          savedCharacters.set(character.name, character)
          return applied
        } })
      let saveError = ''
      const recent = (chat.messages || []).filter(message => message.role === 'user' || message.role === 'assistant').slice(-12)
        .map(message => ({ role: message.role, text: message.sourceText || message.text || '' }))
      result = await runAgent({
        task: 'character-design', persistent: true,
        persistentSessionId: taskRun.participantRequest.sessionId,
        rewindTo: taskRun.participantRequest.rewindTo,
        onPersistentSessionReady: id => taskRun.bindSession(id), sessionId, chatId: chat.id, selection: model,
        backgroundTasks: { variables: false, posture: false, characterDesign: true },
        system: '本次执行用户手动发起的人物设计。设计意见留空时，根据当前剧情和已有档案，自行选择需要建立或补充设计的重要人物；有意见时优先遵循意见。先调用 skill 加载 character-design，再用 character_design_read 按姓名或别名检查本局世界书与已有档案。世界书已有该人物设定时调用 character_design_reuse 复用即可完成，不另建档案；只有缺少设定的新人物或已有设计档案的修订才调用 character_design_save。不得执行变量或姿势结算，不得改写正文。',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ guidance, card: { name: card.name, description: card.description, personality: card.personality, scenario: card.scenario }, recent }) }] }],
        tools: draft.tools, onToolCall: async call => {
          const output = await draft.execute(call)
          if (call?.name === CHARACTER_DESIGN_SAVE_TOOL_NAME) {
            const saved = JSON.parse(output)
            saveError = saved.ok ? '' : saved.error
          }
          return output
        }
      })
      if (!draft.changed() && !draft.reused().length) throw new Error(saveError
        ? '人物档案保存失败：' + saveError + '。模型未完成修正，请重试。'
        : '模型未调用人物档案保存工具，本次未保存设计档案。请重试；若持续出现，请检查后台模型是否支持工具调用。')
      const completed = await taskRun.commit({ participant: taskRun.participant(result), stateChanged: draft.changed(), beforePersist: publishWorldbook ? current => publishWorldbook(current, [...savedCharacters.values()]) : undefined, apply: current => {
        for (const reuse of draft.reused()) {
          const entries = characterWorldbookEntries(current.openingWorldbookSnapshot?.version === 1 ? current.openingWorldbookSnapshot.document : snapshot.document, [reuse.name])
          if (reuse.entries.some(old => !entries.some(entry => entry.ref === old.ref && entry.content === old.content))) throw new Error('复用的人物世界书已变化，请重新设计')
        }
        for (const character of savedCharacters.values()) applyCharacterDesignWorldbook(current, character, snapshot)
        if (draft.changed()) current.characterDesignDocument = draft.document()
        current.characterDesignTask = { status: 'done', guidance, error: '', reused: draft.reused().map(({ name }) => name) }
        return current
      } })
      if (completed.status !== 'committed') throw new Error('剧情已变化，本次设计未保存，请重试。')
    } catch (error) {
      await taskRun.fail(result)
      await store.updateChat(chat.id, current => {
        current.characterDesignTask = { status: 'failed', guidance, error: String(error.message || error) }
        return current
      })
    }
  }
  // The player removes one archived character by name. Only this game changes: its
  // archive and its generated worldbook entry; the card's worldbook library is shared
  // with other games and stays as it is. The model has no delete tool.
  async function remove({ sessionId, name }) {
    const target = String(name || '').trim()
    if (!target) throw new Error('缺少要删除的人物')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中，请完成后再删除')
    let result
    await store.updateChat(chat.id, current => {
      const document = current.characterDesignDocument
      const characters = Array.isArray(document?.characters) ? document.characters : []
      if (!characters.some(character => character?.name === target)) throw new Error('找不到人物档案：' + target)
      current.characterDesignDocument = { ...document, characters: characters.filter(character => character?.name !== target),
        revision: Math.max(0, Number(document.revision) || 0) + 1, updatedAt: Date.now() }
      result = removeCharacterDesignWorldbook(current, target)
      return current
    })
    return { name: target, worldbookRemoved: result.removed, worldbookEdited: result.edited }
  }
  return { start, remove, project, wait: chatId => jobs.get(chatId) }
}
