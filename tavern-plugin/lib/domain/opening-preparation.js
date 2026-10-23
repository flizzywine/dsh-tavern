import { applyPendingOpeningCommand, parseOpeningCommand, parsePendingOpeningCommand } from './opening-command.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState } from './full-prompt-template-state.js'
import { projectTavernHelperScripts } from './tavern-helper-scripts.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { appendTavernHelperMessages, projectTavernHelperContext, replaceTavernHelperVariables, replaceTavernHelperMessages } from './tavern-helper-context.js'
import { applyChatPluginData, validateChatPluginRequest } from './tavern-chat-plugin-data.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { randomUUID } from 'node:crypto'
import { cardOpeningChoices } from './card-openings.js'
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook } from './worldbook-resource.js'
import { patchTavernHelperWorldbookEntries, projectTavernHelperWorldbook, replaceTavernHelperWorldbookOperations, tavernHelperWorldbookChanges, tavernHelperWorldbookVersion } from './tavern-helper-worldbook.js'
import { createHelperGenerationTasks } from './helper-generation-tasks.js'
import { helperGenerationHistory } from './helper-generation-prompts.js'

const copy = value => structuredClone(value)

const untraced = { stage: (_name, run) => run() }

// A wizard may save chat data before the first turn exists. Every write keeps
// the snapshot that a later saveChat request names as its read baseline.
const REVISION_WINDOW = 16
function rememberRevision(draft) {
  const revision = Math.max(0, Number(draft.chat._storageRevision) || 0)
  if (!(draft.revisions instanceof Map)) draft.revisions = new Map()
  draft.revisions.set(revision, copy(draft.chat))
  while (draft.revisions.size > REVISION_WINDOW) draft.revisions.delete(draft.revisions.keys().next().value)
  return revision
}
function bumpRevision(draft) {
  draft.chat._storageRevision = Math.max(0, Number(draft.chat._storageRevision) || 0) + 1
  return rememberRevision(draft)
}

/** Private pre-game state; explicit plugin-setting saves use the profile store. */
export function createOpeningPreparation({ readCard, worldBooks, generate, generateRaw, readRuntimeExtensions, extensionSettings, now = Date.now, trace = untraced }) {
  const drafts = new Map()
  const generations = createHelperGenerationTasks()
  const lifetime = 2 * 60 * 60 * 1000
  function requireDraft(id) {
    const draft = drafts.get(id)
    if (!draft || now() - draft.touchedAt > lifetime) {
      generations.stopAll('opening:' + id)
      drafts.delete(id)
      throw new Error('开局准备已过期，请重新打开人物卡')
    }
    draft.touchedAt = now()
    return draft
  }
  function runtimeContext(draft) {
    return { ...projectTavernHelperContext(draft.chat), worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null,
      characterName: draft.card.name, playerName: draft.userName, character: copy(draft.card),
      globalVariables: copy(draft.globalVariables || {}), characterVariables: copy(draft.characterVariables || {}),
      extensionSettings: copy(draft.extensionSettings), regexScripts: copy(draft.regexScripts || { global: [], character: [] }) }
  }
  function present(draft) {
    return copy({ id: draft.id, cardPath: draft.cardPath, openings: draft.openings,
      openingId: draft.openingId || draft.openings[0]?.id, diagnostics: copy(draft.diagnostics || []),
      runtime: draft.runtimeEnabled ? { context: runtimeContext(draft), scripts: (draft.chat.mvu.enabled ? [{ id: '__dsh_official_mvu__', name: 'MVU', system: 'official-mvu', assetUrl: OFFICIAL_MVU_VERSION.assetUrl }] : []).concat(draft.helperScripts || []) } : null,
      worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null })
  }
  async function createDraft(cardPath, settings = {}) {
    for (const [id, draft] of drafts) if (now() - draft.touchedAt > lifetime) { generations.stopAll('opening:' + id); drafts.delete(id) }
    if (drafts.size >= 64) throw new Error('打开的游戏准备页过多，请稍后重试')
    const card = settings.card || await trace.stage('prepCard', () => readCard(cardPath))
    if (!card) throw new Error('人物卡不存在')
    const record = await trace.stage('prepWorldbook', () => worldBooks.bound(cardPath, card, settings.sourceChat))
    const draft = { id: randomUUID(), cardPath, openings: cardOpeningChoices(card),
      // inspect() already owns an independent copy of the document, and every
      // edit path clones before writing, so the draft can use it directly.
      document: record ? record.view.raw : null, source: record ? copy(record.source) : null,
      worldBookView: record ? record.view : null, touchedAt: now() }
    draft.sourceSessionId = settings.sourceChat?.sessionId || ''
    draft.presetSnapshot = settings.sourceChat ? copy(settings.sourceChat.runtimePresetSnapshot || null) : undefined
    draft.sourceLifecycleRevision = Number(settings.sourceChat?.tavernHelperLifecycleRevision) || 0
    draft.card = copy(card)
    draft.userName = settings.userName || settings.sourceChat?.macroState?.userName || '你'
    const swipes = draft.openings.map(opening => opening.text)
    draft.chat = { id: draft.id, cardPath, mode: 'story', mvu: { enabled: settings.runtime === true }, _storageRevision: 0,
      macroState: { userName: draft.userName, local: {}, global: {} },
      variables: {}, messages: [{ role: 'assistant', text: swipes[0], sourceText: swipes[0], greeting: true, turn: 1, swipeId: 0, swipes, variables: swipes.map(() => ({})) }] }
    const extensions = settings.extensions || (readRuntimeExtensions ? await trace.stage('prepExtensions', () => readRuntimeExtensions(cardPath)) : {})
    draft.characterVariables = copy(extensions.variables || {})
    const projected = projectTavernHelperScripts(extensions.helperScripts)
    draft.helperScripts = projected.scripts
    draft.regexScripts = { global: extensions.globalRegexScripts || [], character: extensions.characterRegexScripts || extensions.regexScripts || [] }
    draft.diagnostics = projected.diagnostics.concat(extensions.diagnostics || [])
    draft.runtimeEnabled = projected.scripts.length > 0
    draft.extensionSettings = extensionSettings ? await trace.stage('prepSettings', () => extensionSettings.read()) : {}
    // Starting MVU must not replace another plugin's settings or its save baseline.
    if (settings.runtime === true) draft.runtimeEnabled = true
    draft.chat.sessionId = 'opening:' + draft.id
    drafts.set(draft.id, draft)
    return draft
  }
  return {
    // Plain greetings start from the draft id alone; projecting the card and the
    // whole worldbook for a presentation nobody reads would run twice per start.
    async begin(cardPath, settings = {}) {
      return { id: (await createDraft(cardPath, settings)).id }
    },
    async create(cardPath, settings = {}) {
      return present(await createDraft(cardPath, settings))
    },
    templateState(id) {
      const draft = requireDraft(id), world = draft.card.name || 'opening'
      const card = { ...copy(draft.card), data: { ...copy(draft.card), extensions: { ...draft.card.extensions, world } } }
      return { state: projectFullPromptTemplateState(draft.chat), environment: { characters: [card], this_chid: 0,
        name1: draft.userName, name2: draft.card.name, world_names: [world], selected_world_info: [],
        extension_settings: { ...copy(draft.extensionSettings), variables: { global: copy(draft.globalVariables || {}) } },
        worldbooks: { [world]: draft.document ? exportSillyTavernWorldBook(draft.document) : { entries: {} } },
        dsh: { cardPath: draft.cardPath, regexScripts: [], model: '' } } }
    },
    saveTemplateState(id, state) {
      const draft = requireDraft(id)
      draft.chat = applyFullPromptTemplateState(draft.chat, copy(draft.chat), state)
      draft.chat._storageRevision++
      return { updated: true, state: projectFullPromptTemplateState(draft.chat) }
    },
    saveTemplateSettings(id, settings) {
      const draft = requireDraft(id); draft.extensionSettings.EjsTemplate = copy(settings)
      return { updated: true, settings: copy(settings) }
    },
    saveTemplateGlobals(id, variables) {
      const draft = requireDraft(id); draft.globalVariables = copy(variables)
      return { updated: true, variables: copy(variables) }
    },
    applyTemplateInitial(id, result) {
      const draft = requireDraft(id)
      if (result.diagnostics?.length) throw new Error('完整模板初始化失败')
      draft.chat.variables = copy(result.initial)
      draft.chat._storageRevision++
      return present(draft)
    },
    get(id) { return present(requireDraft(id)) },
    retain(id) { requireDraft(id); return { retained: true } },
    release(id) { generations.stopAll('opening:' + id); return { released: drafts.delete(id) } },
    dispose() { generations.dispose(); drafts.clear() },
    async callRuntime(id, method, args = {}) {
      const draft = requireDraft(id)
      if (method === 'stopTavernHelperGeneration') return { stopped: generations.stop(draft.chat.sessionId, args.generationId, { generationToken: args.generationToken, pending: args.pending }) }
      if (method === 'stopAllTavernHelperGeneration') return { stopped: true, generationIds: generations.stopAll(draft.chat.sessionId, args.pendingGenerations) }
      if (method === 'generateTavernHelperRaw' || method === 'generateTavernHelper') {
        const callback = method === 'generateTavernHelper' ? generate : generateRaw
        if (!callback) throw new Error('独立生成服务尚未就绪')
        return await generations.run(draft.chat.sessionId, args.config?.generation_id, async signal => ({ text: await callback(args.config, {
          sessionId: draft.sourceSessionId, signal, chat: { ...copy(draft.chat), macroState: { ...copy(draft.chat.macroState), global: copy(draft.globalVariables || {}) } }, card: copy(draft.card),
          worldBook: draft.document ? { view: inspectWorldBookDocument(copy(draft.document)) } : null,
          presetSnapshot: copy(draft.presetSnapshot), characterVariables: copy(draft.characterVariables || {}),
          extensions: { globalRegexScripts: copy(draft.regexScripts.global), characterRegexScripts: copy(draft.regexScripts.character), regexScripts: copy([...draft.regexScripts.global, ...draft.regexScripts.character]) },
          history: helperGenerationHistory(draft.chat)
        }) }), args.generationToken)
      }
      if (method === 'prepareOpeningCommand') {
        const openingId = args.openingId || draft.openingId || draft.openings[0]?.id
        if (!draft.openings.some(opening => opening.id === openingId)) throw new Error('人物卡开场白不存在')
        const pending = parsePendingOpeningCommand(args.line)
        if (pending) {
          // Nothing is committed yet: the page stays mounted so the wizard can
          // still write its variables, floors and chat data into this draft.
          draft.pendingOpening = { ...(draft.pendingOpening || {}), ...pending }
          return { deferred: true, input: '' }
        }
        const command = applyPendingOpeningCommand(parseOpeningCommand(args.line), draft.pendingOpening, args.line)
        draft.pendingOpening = undefined
        draft.startCommand = { ...command, openingId }
        return { deferred: false, input: command.input }
      }
      if (!draft.runtimeEnabled) throw new Error('准备页脚本运行时未初始化')
      if (method === 'loadTavernWorldInfo') return { worldInfo: exportSillyTavernWorldBook(draft.document) }
      if (method === 'getTavernHelperWorldbook') {
        const worldbook = draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null
        if (!worldbook) return { worldbook }
        const version = tavernHelperWorldbookVersion(worldbook.entries)
        return { worldbook: args.knownVersion === version ? { name: worldbook.name, version, unchanged: true } : { ...worldbook, version } }
      }
      if (method === 'patchTavernHelperWorldbook') {
        if (!draft.document) throw new Error('当前人物卡没有绑定世界书')
        const before = projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)).entries
        if (tavernHelperWorldbookVersion(before) !== String(args.patch?.version ?? '')) throw new Error('世界书已被其他操作修改，请重新读取后重试')
        const result = await this.replaceWorldbook(id, patchTavernHelperWorldbookEntries(before, args.patch), before)
        const after = result.worldbook.entries
        return { updated: true, worldbook: { name: result.worldbook.name, version: tavernHelperWorldbookVersion(after), ...tavernHelperWorldbookChanges(before, after) } }
      }
      if (method === 'replaceTavernHelperWorldbook') {
        const result = await this.replaceWorldbook(id, args.entries, args.expectedEntries)
        return { updated: true, worldbook: result.worldbook }
      }
      if (method === 'updateTavernHelperPrompts') {
        mutateScriptPrompts(draft.chat, args.operation)
      } else if (method === 'updateTavernHelperVariables') {
        const type = args.option?.type
        if (type === 'global') draft.globalVariables = copy(args.variables)
        else if (type === 'character') draft.characterVariables = copy(args.variables)
        else replaceTavernHelperVariables(draft.chat, args)
      } else if (method === 'createTavernHelperMessages') {
        const targets = appendTavernHelperMessages(draft.chat, args.messages, args.option)
        // Each floor is its own storage revision, so a later saveChat names the
        // baseline it actually read.
        for (let index = 0; index < targets.length; index++) bumpRevision(draft)
        return { updated: true, targets, context: runtimeContext(draft) }
      } else if (method === 'saveTavernChatData') {
        const request = args.request
        const revisions = validateChatPluginRequest(request)
        if (request.chatId !== draft.chat.id) throw new Error('草稿已变化，请重新打开准备页')
        const baselines = draft.revisions instanceof Map ? draft.revisions : new Map()
        for (const revision of revisions) {
          if (!baselines.has(revision)) throw new Error('插件存档读取版本已过期，请重新打开准备页')
        }
        // The draft, not a shared resource: nothing here reaches the library or
        // another session's history.
        draft.chat = applyChatPluginData(draft.chat, baselines, request)
        bumpRevision(draft)
        return { updated: true, context: runtimeContext(draft) }
      } else if (method === 'updateTavernHelperMessages') {
        // Interactive wizards may edit the existing draft greeting, never add story floors.
        for (const patch of args.messages || []) {
          if (Number(patch.message_id) !== 0 || Object.keys(patch).some(key => !['message_id', 'message', 'data', 'swipes_data'].includes(key))) throw new Error('准备阶段只能更新已有开场内容和变量')
        }
        replaceTavernHelperMessages(draft.chat, args.messages)
      } else if (method === 'saveTavernExtensionSettings') {
        if (JSON.stringify(draft.extensionSettings) !== JSON.stringify(args.expectedSettings)) throw new Error('设置已变化，请重新读取')
        draft.extensionSettings = extensionSettings ? await extensionSettings.save(args.settings, args.expectedSettings) : copy(args.settings)
        draft.chat._storageRevision++
        return { updated: true, extensionSettings: copy(draft.extensionSettings), context: runtimeContext(draft) }
      } else if (method === 'recordMvuRuntimeDiagnostic' || method === 'recordMvuLoadDiagnostic') {
        draft.diagnostics = (draft.diagnostics || []).concat(copy(args.diagnostic || {})).slice(-50)
        return { recorded: true }
      } else throw new Error('准备阶段暂不支持此宿主操作：' + method)
      bumpRevision(draft)
      return { updated: true, context: runtimeContext(draft) }
    },
    select(id, openingId) {
      const draft = requireDraft(id)
      const index = draft.openings.findIndex(opening => opening.id === openingId)
      if (index < 0) throw new Error('人物卡开场白不存在')
      draft.openingId = openingId
      if (draft.chat.messages[0]) draft.chat.messages[0].swipeId = index
      return { saved: true, openingId }
    },
    async replaceWorldbook(id, entries, expectedEntries) {
      const draft = requireDraft(id)
      if (!draft.document) throw new Error('当前人物卡没有绑定世界书')
      const view = inspectWorldBookDocument(draft.document)
      if (JSON.stringify(projectTavernHelperWorldbook(view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(view, entries)
      const updated = updateWorldBookDocument(draft.document, { operations })
      draft.document = updated.document
      draft.worldBookView = updated.view
      return present(draft)
    },
    resolve(id, cardPath, openingId) {
      const draft = requireDraft(id)
      if (draft.cardPath !== cardPath) throw new Error('开局草稿与人物卡不匹配')
      // No choice falls back to the first greeting the card has (an empty first_mes
      // is skipped); a card with no greeting at all starts from a blank scene.
      const selected = openingId || draft.openings[0]?.id || ''
      const selectedIndex = draft.openings.findIndex(opening => opening.id === selected)
      if (selectedIndex < 0 && selected !== '') throw new Error('人物卡开场白不存在')
      // Nothing is cloned here: the start path clones the variables it installs
      // and takes ownership of the document, so copying the whole world book a
      // second and third time only duplicated a multi-megabyte read.
      const greeting = draft.chat.messages[0]
      const created = draft.chat.messages.filter(message => message && message.tavernHelperCreated === true)
      return { startCommand: draft.startCommand?.openingId === selected ? draft.startCommand : undefined,
        // Chat data the wizard saved before the first turn travels with the game.
        openingPluginData: greeting && greeting.tavernPluginData ? copy(greeting.tavernPluginData) : undefined,
        chatPluginMetadata: draft.chat.tavernPluginMetadata ? copy(draft.chat.tavernPluginMetadata) : undefined,
        preparedMessages: created.map(message => copy(message)),
        openingMessages: Object.fromEntries(draft.openings.map((opening,index)=>[opening.id,draft.chat.messages[0]?.swipes?.[index] ?? opening.text])), openingVariables: Object.fromEntries(draft.openings.map((opening, index) => [opening.id, draft.chat.messages[0]?.variables?.[index] || {}])), variables: draft.chat.variables || {}, messageVariables: draft.chat.messages[0]?.variables?.[selectedIndex] || {}, openingId: selected, sourceSessionId: draft.sourceSessionId, sourceLifecycleRevision: draft.sourceLifecycleRevision,
        // The projection this game starts from. Nothing is copied into the chat:
        // the game follows the library, so a later edit takes effect.
        worldbook: draft.worldBookView ? { source: draft.source, document: draft.document, view: draft.worldBookView } : null }
    }
  }
}
