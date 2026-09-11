import { projectTavernHelperScripts } from './tavern-helper-scripts.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { projectTavernHelperContext, replaceTavernHelperVariables, replaceTavernHelperMessages } from './tavern-helper-context.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { randomUUID } from 'node:crypto'
import { cardOpeningChoices } from './card-openings.js'
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook } from './worldbook-resource.js'
import { projectTavernHelperWorldbook, replaceTavernHelperWorldbookOperations } from './tavern-helper-worldbook.js'

const copy = value => structuredClone(value)

/** Private pre-game host state. No Session or shared resource is written here. */
export function createOpeningPreparation({ readCard, worldBooks, templateRuntime, generateRaw, readRuntimeExtensions, now = Date.now }) {
  const drafts = new Map()
  const lifetime = 2 * 60 * 60 * 1000
  function requireDraft(id) {
    const draft = drafts.get(id)
    if (!draft || now() - draft.touchedAt > lifetime) {
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
      extensionSettings: copy(draft.extensionSettings), regexScripts: { global: [], character: [] } }
  }
  function present(draft) {
    return copy({ id: draft.id, cardPath: draft.cardPath, openings: draft.openings,
      openingId: draft.openingId || draft.openings[0]?.id, diagnostics: copy(draft.diagnostics || []),
      runtime: draft.runtimeEnabled ? { context: runtimeContext(draft), scripts: (draft.chat.mvu.enabled ? [{ id: '__dsh_official_mvu__', name: 'MVU', system: 'official-mvu', assetUrl: OFFICIAL_MVU_VERSION.assetUrl }] : []).concat(draft.helperScripts || []) } : null,
      worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null })
  }
  return {
    async create(cardPath, settings = {}) {
      for (const [id, draft] of drafts) if (now() - draft.touchedAt > lifetime) drafts.delete(id)
      if (drafts.size >= 64) throw new Error('打开的游戏准备页过多，请稍后重试')
      const card = await readCard(cardPath)
      if (!card) throw new Error('人物卡不存在')
      const record = await worldBooks.bound(cardPath, card, settings.sourceChat)
      const draft = { id: randomUUID(), cardPath, openings: cardOpeningChoices(card),
        document: record ? copy(record.view.raw) : null, source: record ? copy(record.source) : null, touchedAt: now() }
      draft.sourceSessionId = settings.sourceChat?.sessionId || ''
      draft.sourceLifecycleRevision = Number(settings.sourceChat?.tavernHelperLifecycleRevision) || 0
      draft.card = copy(card)
      draft.userName = settings.userName || '你'
      const swipes = [card.first_mes || ''].concat(card.alternate_greetings || [])
      draft.chat = { id: draft.id, cardPath, mode: 'story', mvu: { enabled: settings.runtime === true }, _storageRevision: 0,
        variables: {}, messages: [{ role: 'assistant', text: swipes[0], sourceText: swipes[0], greeting: true, turn: 1, swipeId: 0, swipes, variables: swipes.map(() => ({})) }] }
      const extensions = readRuntimeExtensions ? await readRuntimeExtensions(cardPath) : {}
      const projected = projectTavernHelperScripts(extensions.helperScripts)
      draft.helperScripts = projected.scripts
      draft.diagnostics = projected.diagnostics.concat(extensions.diagnostics || [])
      draft.runtimeEnabled = projected.scripts.length > 0
      draft.extensionSettings = {}
      if (settings.runtime === true && templateRuntime) {
        const runtime = await templateRuntime()
        const initialized = runtime.initializeVariables(record?.view.entries || [], { charName: card.name, userName: draft.userName })
        if (initialized.diagnostics.length) throw new Error('开场模板初始变量解析失败：' + initialized.diagnostics.map(item => item.code).join('、'))
        draft.chat.variables = copy(initialized.initial)
        draft.extensionSettings.EjsTemplate = { enabled: true }
        draft.runtimeEnabled = true
      }
      drafts.set(draft.id, draft)
      return present(draft)
    },
    get(id) { return present(requireDraft(id)) },
    async callRuntime(id, method, args = {}) {
      const draft = requireDraft(id)
      if (method === 'generateTavernHelperRaw') {
        if (!generateRaw) throw new Error('独立生成服务尚未就绪')
        return { text: await generateRaw(args.config, { sessionId: draft.sourceSessionId,
          history: projectTavernHelperContext(draft.chat).messages.map(message => ({ role: message.role, text: message.message })) }) }
      }
      if (!draft.runtimeEnabled) throw new Error('准备页脚本运行时未初始化')
      if (method === 'loadTavernWorldInfo') return { worldInfo: exportSillyTavernWorldBook(draft.document) }
      if (method === 'getTavernHelperWorldbook') return { worldbook: present(draft).worldbook }
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
      } else if (method === 'updateTavernHelperMessages') {
        // The variable framework may write data, but cannot invent a story floor.
        for (const patch of args.messages || []) {
          if (Number(patch.message_id) !== 0 || Object.keys(patch).some(key => !['message_id', 'data', 'swipes_data'].includes(key))) throw new Error('准备阶段变量运行时只能更新开场变量')
        }
        replaceTavernHelperMessages(draft.chat, args.messages)
      } else if (method === 'saveTavernExtensionSettings') {
        if (JSON.stringify(draft.extensionSettings) !== JSON.stringify(args.expectedSettings)) throw new Error('设置已变化，请重新读取')
        draft.extensionSettings = copy(args.settings)
        draft.chat._storageRevision++
        return { updated: true, extensionSettings: copy(draft.extensionSettings), context: runtimeContext(draft) }
      } else if (method === 'recordMvuRuntimeDiagnostic' || method === 'recordMvuLoadDiagnostic') {
        draft.diagnostics = (draft.diagnostics || []).concat(copy(args.diagnostic || {})).slice(-50)
        return { recorded: true }
      } else throw new Error('准备阶段暂不支持此宿主操作：' + method)
      draft.chat._storageRevision++
      return { updated: true, context: runtimeContext(draft) }
    },
    select(id, openingId) {
      const draft = requireDraft(id)
      if (!draft.openings.some(opening => opening.id === openingId)) throw new Error('人物卡开场白不存在')
      draft.openingId = openingId
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
      draft.document = updateWorldBookDocument(draft.document, { operations }).document
      return present(draft)
    },
    resolve(id, cardPath, openingId) {
      const draft = requireDraft(id)
      if (draft.cardPath !== cardPath) throw new Error('开局草稿与人物卡不匹配')
      const selected = openingId || 'primary'
      if (!draft.openings.some(opening => opening.id === selected)) throw new Error('人物卡开场白不存在')
      return copy({ variables: draft.chat.variables || {}, messageVariables: draft.chat.messages[0]?.variables?.[draft.chat.messages[0]?.swipeId || 0] || {}, openingId: selected, sourceSessionId: draft.sourceSessionId, sourceLifecycleRevision: draft.sourceLifecycleRevision, worldbookSnapshot: { version: 1, source: draft.source, document: draft.document } })
    }
  }
}
