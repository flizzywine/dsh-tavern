import {createHash} from 'node:crypto'
import {planAutoFigures} from './domain/auto-figure.js'
import {cardFigureRows} from './card-stage.js'

const assistant = (chat, turn) => chat.messages?.findLast(message => message.role === 'assistant' && (turn === undefined || Number(message.turn || (message.greeting ? 1 : 0)) === turn))
const identity = message => JSON.stringify([message.turn, !!message.greeting, message.swipeId || 0, message.sourceText ?? message.text, message.swipes])

// The capability is lazy: a disabled bubble card never even resolves the library.
// Queues own only pending work; durable dedupe belongs to the publication receipt.
// The new figure is for later rounds: a running director keeps the assets it started with (stage-director.js).
export function createAutoFigureWriter({getLibrary, dialogueBubbles, readCurrent, bodyForTurn, onError = () => {}}) {
  const queues = new Map()
  let active = true, owner, writer
  function plan({packs, card, context, globalEnabledPackIds}) {
    const figureRows = cardFigureRows({raw:card.raw, snapshots:packs, globalEnabledPackIds})
    return planAutoFigures({...context, figureRows}).creates.map(({name,aliases}) => ({op:'create',kind:'figures',value:{name,aliases}}))
  }
  function capability() {
    const library = getLibrary()
    if (!library) return null
    if (owner !== library) {
      writer?.dispose()
      owner = library
      writer = library.registerAutomaticWriter({writerId:'auto-figure',plan})
    }
    return {library,writer}
  }
  async function submit(chat, message) {
    if (!active) return
    const config = await dialogueBubbles.read(chat.cardPath)
    if (!active || !config?.enabled) return
    const turn = Number(message.turn || (message.greeting ? 1 : 0))
    const current = await readCurrent(chat)
    if (!active || current?.timeline?.branchId !== chat.timeline?.branchId || identity(assistant(current,turn) || {}) !== identity(message)) return
    const body = await bodyForTurn(current,turn)
    if (!body?.paragraphs) return
    const source = {chatId:chat.id,branchId:chat.timeline.branchId,revision:chat.timeline.revision,turn,
      messageId:message.id || 'turn:' + turn,
      paragraphIds:body.paragraphs.map(row => row.paragraphId)}
    const context = {body,playerIdentity:{actorKey:'player',name:current.macroState?.userName?.trim() || '你',aliases:[]}}
    const port = capability()
    if (!port || !active) return
    const requestId = JSON.stringify([source.chatId,source.branchId,source.turn,source.messageId,createHash('sha256').update(identity(message)).digest('hex'),source.paragraphIds])
    for (let attempt = 0; attempt < 2 && active; attempt++) {
      try {
        const snapshot = await port.writer.readContext({path:chat.cardPath})
        if (!active || snapshot.detached) return
        const changes = plan({...snapshot,context})
        if (!changes.length) return
        const input = {path:chat.cardPath,expectedCardRevision:snapshot.card.revision,target:snapshot.target,
          catalogueRevisions:snapshot.packs.map(pack => ({packId:pack.manifest.id,revision:pack.revision})),requestId,
          source:{kind:'story-speaker',occurrenceId:requestId},changes}
        return await port.library.writeAutomaticItems(input,port.writer.authorize(input,source,context))
      } catch (error) {
        if (error.code !== 'REVISION_CONFLICT' || attempt === 1) throw error
      }
    }
  }
  return {
    committed(chat) {
      if (!active || !chat?.cardPath) return
      const message = assistant(chat)
      if (!message || message.greeting) return
      const captured = structuredClone(chat), capturedMessage = structuredClone(message)
      const key = chat.cardPath
      const task = (queues.get(key) || Promise.resolve()).then(() => submit(captured,capturedMessage)).catch(error => onError(error))
      queues.set(key,task)
      void task.finally(() => {if (queues.get(key) === task) queues.delete(key)})
      return task
    },
    dispose() { active = false; writer?.dispose(); queues.clear() }
  }
}
