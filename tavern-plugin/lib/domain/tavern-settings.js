import { compactionPolicy } from './auto-compaction.js'
import { normalizeBackgroundModel } from './background-model-selection.js'
import { applyCardPersonaChange, presentCardPersonas } from './card-personas.js'
import { readJudgeConfig, validateJudgeConfig } from './engine-judge.js'
import { validateStageSkinSelection } from './stage-skin-choice.js'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
// Global stage switches a patch may set.
const STAGE_TOGGLES = Object.freeze(['stage', 'music', 'sfx', 'items', 'entrance'])
// 舞台模式 › 可用演出: the director commands the director may use, every one on by default (stage-director.js).
export const STAGE_DIMENSIONS = Object.freeze(['scene', 'cast', 'acts', 'screenEffects'])
// 舞台模式 › 每轮上限: how many screen effects (`beat`) one reply may use.
export const STAGE_ACTION_CAPS = Object.freeze({ beat: 6 })
const stageDimensions = document => Object.fromEntries(STAGE_DIMENSIONS.map(key => [key, object(object(document).stageDimensions)[key] !== false]))
const stageActionCaps = document => Object.fromEntries(Object.entries(STAGE_ACTION_CAPS).map(([key, fallback]) => {
  const value = object(object(document).stageActionCaps)[key]
  return [key, Number.isSafeInteger(value) && value >= 1 && value <= 256 ? value : fallback]
}))
const PACK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const globalPackIds = document => Array.isArray(object(document).globalEnabledPackIds) ? document.globalEnabledPackIds.filter(id => typeof id === 'string' && PACK_ID.test(id)) : []

// A stored blank here is the user's choice and overrides the default; only
// resetting (deleting the key) restores it.
const BLANK_ALLOWED_PROMPTS = new Set(['system-append'])

// The single `storyToolCall` switch used to cover both directions; before that
// history had a switch of its own. Reads migrate in place: a merged save turns
// both on, and an old history-only save turns input on while output stays as it
// was. Explicit new fields always win over the retired ones.
export function storyToolCallSettings(document) {
  const source = object(document)
  const merged = Object.hasOwn(source, 'storyToolCall') ? source.storyToolCall === true : null
  const history = Object.hasOwn(source, 'storyHistoryToolCall') ? source.storyHistoryToolCall === true : null
  return {
    input: Object.hasOwn(source, 'storyInputToolCall') ? source.storyInputToolCall === true : (history === null ? merged === true : history),
    output: Object.hasOwn(source, 'storyOutputToolCall') ? source.storyOutputToolCall === true : merged === true
  }
}

function promptOverride(document, name) {
  const value = object(document.promptOverrides)[name]
  return typeof value === 'string' && (value.trim() !== '' || BLANK_ALLOWED_PROMPTS.has(name)) ? value : null
}

// System prompt sets: the active set's content stays in the top-level
// promptOverrides/systemAppendEnabled fields (what every reader uses, and what
// older versions read); promptSets only stores names plus inactive sets' content.
const DEFAULT_PROMPT_SET = Object.freeze({ id: 'default', name: '默认方案' })

function promptSetName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name.length > 80) throw new Error('方案名称需为 1–80 字')
  return name
}


// Header shortcuts: { display, items }. The items are page ids — a Tavern tab
// (dsh-tavern:*), a plugin tab (tavern-plugin:*), the export menu (header:export)
// or any other id the right sidebar registers.
const HEADER_ITEM_LIMIT = 24
const HEADER_ITEM_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/
const HEADER_DISPLAYS = ['icon', 'icon-text']
export const DEFAULT_HEADER_ITEMS = Object.freeze({ display: 'icon-text', items: Object.freeze(['dsh-tavern:status', 'header:export']) })

export function headerItems(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的顶栏设置')
  const display = value.display === undefined ? DEFAULT_HEADER_ITEMS.display : value.display
  if (!HEADER_DISPLAYS.includes(display)) throw new Error('无效的顶栏设置')
  const source = value.items === undefined ? [] : value.items
  if (!Array.isArray(source)) throw new Error('无效的顶栏设置')
  const items = []
  for (const item of source) {
    if (typeof item !== 'string' || !HEADER_ITEM_PATTERN.test(item)) throw new Error('无效的顶栏设置')
    if (!items.includes(item)) items.push(item)
  }
  return { display, items: items.slice(0, HEADER_ITEM_LIMIT) }
}

// Stored documents are read leniently: an older or hand-edited value falls back
// to the default instead of breaking every settings read.
export function readHeaderItems(value) {
  if (value === null || value === undefined) return { display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] }
  try {
    return headerItems(value)
  } catch (_) {
    return { display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] }
  }
}

// Conversation view tabs: { items }, the row below the title (对话 / 轨迹 /
// 完整上下文 / 画廊 / 精修对比). The host owns the chat view, so it is always
// kept first and cannot be removed; the rest are an ordered visible list.
export const VIEW_TAB_RESIDENT = 'chat'
export const DEFAULT_VIEW_TABS = Object.freeze({ items: Object.freeze(['chat', 'trajectory', 'dsh-tavern:full-context', 'dsh-tavern:gallery', 'dsh-tavern:polish']) })

export function viewTabs(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的顶部标签设置')
  const source = value.items === undefined ? [] : value.items
  if (!Array.isArray(source)) throw new Error('无效的顶部标签设置')
  const items = []
  for (const item of source) {
    if (typeof item !== 'string' || !HEADER_ITEM_PATTERN.test(item)) throw new Error('无效的顶部标签设置')
    if (!items.includes(item)) items.push(item)
  }
  const resident = items.indexOf(VIEW_TAB_RESIDENT)
  if (resident > 0) items.splice(resident, 1)
  if (resident !== 0) items.unshift(VIEW_TAB_RESIDENT)
  return { items: items.slice(0, HEADER_ITEM_LIMIT) }
}

export function readViewTabs(value) {
  if (value === null || value === undefined) return { items: [...DEFAULT_VIEW_TABS.items] }
  try {
    return viewTabs(value)
  } catch (_) {
    return { items: [...DEFAULT_VIEW_TABS.items] }
  }
}

export function uniqueName(names, base) {
  const taken = new Set(names)
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) if (!taken.has(base + ' (' + index + ')')) return base + ' (' + index + ')'
}

export function promptSetLibrary(document) {
  const source = Array.isArray(object(document).promptSets) ? document.promptSets : []
  const sets = []
  for (const item of source) {
    const entry = object(item)
    if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.name !== 'string' || sets.some(set => set.id === entry.id)) continue
    sets.push(entry)
  }
  if (sets.length === 0) sets.push({ ...DEFAULT_PROMPT_SET })
  const activeId = sets.some(set => set.id === object(document).activePromptSetId) ? document.activePromptSetId : sets[0].id
  return { activeId, sets }
}

function storedPromptSetContent(value) {
  const overrides = {}
  for (const [name, text] of Object.entries(object(value))) if (typeof text === 'string' && text.length <= 100000) overrides[name] = text.trim()
  return overrides
}

function writeActivePromptContent(next, overrides, systemAppendEnabled) {
  if (Object.keys(overrides).length === 0) delete next.promptOverrides
  else next.promptOverrides = overrides
  next.systemAppendEnabled = systemAppendEnabled !== false
}

function applyPromptSetChange(next, change) {
  const { activeId, sets } = promptSetLibrary(next)
  const action = change.action
  const nameOf = id => sets.find(set => set.id === id)
  const names = sets.map(set => set.name)
  const newId = () => 'set-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  // Snapshot the live content into its entry before any switch.
  const stash = list => list.map(set => set.id === activeId ? { id: set.id, name: set.name, promptOverrides: storedPromptSetContent(next.promptOverrides), systemAppendEnabled: next.systemAppendEnabled !== false } : set)
  const activate = (list, id) => {
    const target = list.find(set => set.id === id)
    writeActivePromptContent(next, storedPromptSetContent(target.promptOverrides), target.systemAppendEnabled)
    next.promptSets = list.map(set => set.id === id ? { id: set.id, name: set.name } : set)
    next.activePromptSetId = id
  }
  if (action === 'select') {
    if (!nameOf(change.id)) throw new Error('系统提示词方案不存在')
    if (change.id !== activeId) activate(stash(sets), change.id)
    return
  }
  if (action === 'rename') {
    if (!nameOf(change.id)) throw new Error('系统提示词方案不存在')
    const name = uniqueName(names.filter((value, index) => sets[index].id !== change.id), promptSetName(change.name))
    next.promptSets = sets.map(set => set.id === change.id ? { ...set, name } : set)
    next.activePromptSetId = activeId
    return
  }
  if (action === 'delete') {
    if (!nameOf(change.id)) throw new Error('系统提示词方案不存在')
    if (sets.length === 1) throw new Error('至少保留一个方案')
    if (change.id === activeId) {
      // Deleting the set in use switches to the next remaining one first.
      const index = sets.findIndex(set => set.id === activeId)
      const fallback = sets[index + 1] || sets[index - 1]
      activate(stash(sets).filter(set => set.id !== activeId), fallback.id)
      return
    }
    next.promptSets = sets.filter(set => set.id !== change.id)
    next.activePromptSetId = activeId
    return
  }
  if (action === 'create' || action === 'duplicate' || action === 'add') {
    const id = newId()
    const name = uniqueName(names, promptSetName(change.name))
    let content
    if (action === 'duplicate') content = { promptOverrides: storedPromptSetContent(next.promptOverrides), systemAppendEnabled: next.systemAppendEnabled !== false }
    else if (action === 'add') content = { promptOverrides: storedPromptSetContent(change.promptOverrides), systemAppendEnabled: change.systemAppendEnabled !== false }
    else content = { promptOverrides: {}, systemAppendEnabled: true }
    activate([...stash(sets), { id, name, ...content }], id)
    return
  }
  throw new Error('未知的系统提示词方案操作')
}

export function presentPromptSets(document) {
  const { activeId, sets } = promptSetLibrary(document)
  return { activeId, sets: sets.map(set => ({ id: set.id, name: set.name, active: set.id === activeId })) }
}

export function normalizeBackgroundTasks(value) {
  const tasks = object(value)
  return { posture: tasks.posture !== false, characterDesign: false, variables: tasks.variables !== false, ledger: false, styleReference: tasks.styleReference === true }
}


export function normalizePlayDefaults(value) {
  const input = object(value)
  return { playerName: typeof input.playerName === 'string' ? input.playerName.trim().slice(0, 80) || '你' : '你',
    statusBarPlacement: input.statusBarPlacement === 'body' ? 'body' : 'sidebar',
    // New games get 文风联想 unless the defaults turn it off; an existing game without the key stays off.
    backgroundTasks: { ...normalizeBackgroundTasks(input.backgroundTasks), styleReference: object(input.backgroundTasks).styleReference !== false },
    webSearchEnabled: input.webSearchEnabled === true }
}

export function applyTavernSettingsPatch(current, patch) {
  const next = Object.assign({}, object(current))
  const input = object(patch)
  if (Object.hasOwn(input, 'defaultPlaySettings')) {
    const patch = object(input.defaultPlaySettings)
    if (Object.hasOwn(patch, 'webSearchEnabled') && typeof patch.webSearchEnabled !== 'boolean') throw new Error('默认开关必须为布尔值')
    if (Object.hasOwn(patch, 'playerName') && (typeof patch.playerName !== 'string' || patch.playerName.length > 80)) throw new Error('玩家称呼最多 80 字')
    if (Object.hasOwn(patch, 'statusBarPlacement') && !['body', 'sidebar'].includes(patch.statusBarPlacement)) throw new Error('状态栏位置无效')
    for (const key of ['variables', 'posture', 'styleReference']) if (Object.hasOwn(object(patch.backgroundTasks), key) && typeof patch.backgroundTasks[key] !== 'boolean') throw new Error('默认结算开关必须为布尔值')
    const current = normalizePlayDefaults(next.defaultPlaySettings)
    next.defaultPlaySettings = normalizePlayDefaults({ ...current, ...patch, backgroundTasks: { ...current.backgroundTasks, ...object(patch.backgroundTasks) } })
  }
  if (Object.hasOwn(input, 'defaultWritingSkill')) {
    const { name, enabled } = object(input.defaultWritingSkill)
    if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || typeof enabled !== 'boolean') throw new Error('无效的写作 Skill 配置')
    const disabled = Array.isArray(next.defaultDisabledWritingSkills) ? next.defaultDisabledWritingSkills : []
    next.defaultDisabledWritingSkills = enabled ? disabled.filter(value => value !== name) : [...new Set([...disabled, name])]
  }
  for (const name of ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel']) {
    if (!Object.hasOwn(input, name)) continue
    const selection = normalizeBackgroundModel(input[name])
    if (input[name] !== null && !selection) throw new Error('默认模型配置无效')
    next[name] = selection
  }
  if (Object.hasOwn(input, 'hideContextAndReasoning')) {
    if (typeof input.hideContextAndReasoning !== 'boolean') throw new Error('无效的对话显示设置')
    next.hideContextAndReasoning = input.hideContextAndReasoning
  }
  if (Object.hasOwn(input, 'polishPrereview')) {
    if (typeof input.polishPrereview !== 'boolean') throw new Error('无效的精修预审设置')
    next.polishPrereview = input.polishPrereview
  }
  if (Object.hasOwn(input, 'candidateDismissMode')) {
    if (!['after-fill', 'after-send'].includes(input.candidateDismissMode)) throw new Error('无效的候选项收起方式')
    next.candidateDismissMode = input.candidateDismissMode
  }
  // Two independent directions: input replays the history that is sent to the
  // model, output turns this turn's body into a submission call. Legacy switches
  // are folded into the pair and then dropped, so a later patch to one side can
  // never fall back to a stale merged value.
  if (Object.hasOwn(input, 'storyToolCall') || Object.hasOwn(input, 'storyHistoryToolCall') ||
      Object.hasOwn(input, 'storyInputToolCall') || Object.hasOwn(input, 'storyOutputToolCall')) {
    const current = storyToolCallSettings(next)
    let inputToolCall = current.input
    let outputToolCall = current.output
    if (Object.hasOwn(input, 'storyToolCall')) {
      if (typeof input.storyToolCall !== 'boolean') throw new Error('正文走工具调用设置必须是布尔值')
      inputToolCall = input.storyToolCall
      outputToolCall = input.storyToolCall
    }
    if (Object.hasOwn(input, 'storyHistoryToolCall')) {
      if (typeof input.storyHistoryToolCall !== 'boolean') throw new Error('历史正文走工具调用设置必须是布尔值')
      inputToolCall = input.storyHistoryToolCall
    }
    if (Object.hasOwn(input, 'storyInputToolCall')) {
      if (typeof input.storyInputToolCall !== 'boolean') throw new Error('输入走工具调用设置必须是布尔值')
      inputToolCall = input.storyInputToolCall
    }
    if (Object.hasOwn(input, 'storyOutputToolCall')) {
      if (typeof input.storyOutputToolCall !== 'boolean') throw new Error('输出走工具调用设置必须是布尔值')
      outputToolCall = input.storyOutputToolCall
    }
    next.storyInputToolCall = inputToolCall
    next.storyOutputToolCall = outputToolCall
    delete next.storyToolCall
    delete next.storyHistoryToolCall
  }
  if (Object.hasOwn(input, 'autoOpenStatusPanel')) {
    if (typeof input.autoOpenStatusPanel !== 'boolean') throw new Error('自动打开酒馆状态面板设置必须是布尔值')
    next.autoOpenStatusPanel = input.autoOpenStatusPanel
  }
  if (Object.hasOwn(input, 'headerItems')) {
    // null restores the shipped top bar.
    if (input.headerItems === null) delete next.headerItems
    else next.headerItems = headerItems(input.headerItems)
  }
  if (Object.hasOwn(input, 'viewTabs')) {
    // null restores the shipped tab row (all five tabs, 对话 first).
    if (input.viewTabs === null) delete next.viewTabs
    else next.viewTabs = viewTabs(input.viewTabs)
  }
  if (Object.hasOwn(input, 'castPresentation')) {
    if (typeof input.castPresentation !== 'boolean') throw new Error('对话气泡设置必须是布尔值')
    next.castPresentation = input.castPresentation
  }
  // The stage's global switches (舞台设置 › 基础设置); 舞台模式 is stageToggles.stage, BGM stageToggles.music, 音效 stageToggles.sfx,
  // 物品 stageToggles.items, 入场演出 stageToggles.entrance.
  if (Object.hasOwn(input, 'stageToggles')) {
    const toggles = object(input.stageToggles)
    if (!Object.keys(toggles).length || Object.entries(toggles).some(([key, value]) => !STAGE_TOGGLES.includes(key) || typeof value !== 'boolean')) throw new Error('舞台开关只能是 ' + STAGE_TOGGLES.join('、') + '，且必须是布尔值')
    next.stageToggles = { ...object(next.stageToggles), ...toggles }
  }
  // 舞台模式 › 可用演出 and 每轮上限: every card's director; a patch names only what it changes.
  if (Object.hasOwn(input, 'stageDimensions')) {
    const dimensions = object(input.stageDimensions)
    if (!Object.keys(dimensions).length || Object.entries(dimensions).some(([key, value]) => !STAGE_DIMENSIONS.includes(key) || typeof value !== 'boolean')) throw new Error('可用演出只能是 ' + STAGE_DIMENSIONS.join('、') + '，且必须是布尔值')
    next.stageDimensions = { ...object(next.stageDimensions), ...dimensions }
  }
  if (Object.hasOwn(input, 'stageActionCaps')) {
    const caps = object(input.stageActionCaps)
    if (!Object.keys(caps).length || Object.entries(caps).some(([key, value]) => !Object.hasOwn(STAGE_ACTION_CAPS, key) || !Number.isSafeInteger(value) || value < 1 || value > 256)) throw new Error('每轮上限只能是 ' + Object.keys(STAGE_ACTION_CAPS).join('、') + '，且必须是 1 到 256 的整数')
    next.stageActionCaps = { ...object(next.stageActionCaps), ...caps }
  }
  // 舞台模式 › 判断模型 (engine-judge.js): the whole config; an omitted field takes its default or the provider's preset.
  // The API Key itself is never a setting (rpc setJudgeKey stores it in the host credential store).
  if (Object.hasOwn(input, 'stageJudge')) next.stageJudge = validateJudgeConfig(input.stageJudge)
  // 舞台设置 › 默认皮肤: a built-in skin's id or a pack skin; a missing one is passed over when drawn (stage-skin-choice.js).
  if (Object.hasOwn(input, 'stageSkin')) {
    try { next.stageSkin = structuredClone(validateStageSkinSelection(input.stageSkin)) } catch { throw new Error('无效的默认皮肤') }
  }
  // A pack the player turns on for every card (全局) or off again: one pack per change, applied to the stored list.
  if (Object.hasOwn(input, 'globalPack')) {
    const { packId, enabled } = object(input.globalPack)
    if (typeof packId !== 'string' || !PACK_ID.test(packId) || typeof enabled !== 'boolean') throw new Error('无效的素材包设置')
    const ids = globalPackIds(next).filter(id => id !== packId)
    if (enabled) ids.push(packId)
    if (ids.length) next.globalEnabledPackIds = ids
    else delete next.globalEnabledPackIds
  }
  if (Object.hasOwn(input, 'contextCompaction')) next.contextCompaction = { ...compactionPolicy(input.contextCompaction), revision: Date.now() }
  if (Object.prototype.hasOwnProperty.call(input, 'backgroundTasks')) {
    next.backgroundTasks = normalizeBackgroundTasks({ ...normalizeBackgroundTasks(next.backgroundTasks), ...object(input.backgroundTasks) })
  }
  if (input.sillyModeEnabled === true || input.compatibilityMode === true) throw new Error('silly 模式已停用')
  delete next.sillyModeEnabled
  delete next.compatibilityMode
  if (Object.hasOwn(input, 'promptSet')) applyPromptSetChange(next, object(input.promptSet))
  if (Object.hasOwn(input, 'cardPersona')) applyCardPersonaChange(next, object(input.cardPersona))
  if (Object.hasOwn(input, 'systemAppendEnabled')) next.systemAppendEnabled = input.systemAppendEnabled === true
  if (Object.prototype.hasOwnProperty.call(input, 'webSearchEnabled')) next.webSearchEnabled = input.webSearchEnabled === true
  if (Object.prototype.hasOwnProperty.call(input, 'backgroundModel')) {
    next.backgroundModelRevision = (Number.isSafeInteger(next.backgroundModelRevision) ? next.backgroundModelRevision : 0) + 1
    if (input.backgroundModel === null) delete next.backgroundModel
    else {
      const backgroundModel = normalizeBackgroundModel(input.backgroundModel)
      if (backgroundModel === null) throw new Error('后台模型配置无效')
      next.backgroundModel = backgroundModel
    }
  }
  const legacyStory = Object.prototype.hasOwnProperty.call(input, 'storyPrompt') ? { name: 'story', text: input.storyPrompt } : null
  const promptChange = Object.prototype.hasOwnProperty.call(input, 'systemPrompt') ? object(input.systemPrompt) : legacyStory
  if (promptChange !== null) {
    const name = typeof promptChange.name === 'string' ? promptChange.name : ''
    if (name === '') throw new Error('系统提示词名称不能为空')
    const overrides = Object.assign({}, object(next.promptOverrides))
    if (promptChange.text === null) {
      delete overrides[name]
    } else {
      if (typeof promptChange.text !== 'string' || (promptChange.text.trim() === '' && !BLANK_ALLOWED_PROMPTS.has(name))) throw new Error('系统提示词不能为空')
      if (promptChange.text.length > 100000) throw new Error('系统提示词不能超过 100000 字符')
      overrides[name] = promptChange.text.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Object.prototype.hasOwnProperty.call(input, 'systemPrompts')) {
    const values = object(input.systemPrompts)
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== 'string' || (value.trim() === '' && !BLANK_ALLOWED_PROMPTS.has(name))) throw new Error('系统提示词不能为空: ' + name)
      if (value.length > 100000) throw new Error('系统提示词不能超过 100000 字符: ' + name)
      overrides[name] = value.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Array.isArray(input.resetSystemPrompts)) {
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const name of input.resetSystemPrompts) delete overrides[name]
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  } else if (input.resetSystemPrompts === true) delete next.promptOverrides
  return next
}

export function presentTavernSettings(document, defaults) {
  const prompts = Object.keys(object(defaults)).map(function (name) {
    const custom = promptOverride(object(document), name)
    return { name, text: custom === null ? String(defaults[name] || '') : custom, customized: custom !== null }
  })
  const story = prompts.find(function (item) { return item.name === 'story' }) || { text: '', customized: false }
  const storyToolCalls = storyToolCallSettings(document)
  return {
    defaultPlaySettings: normalizePlayDefaults(object(document).defaultPlaySettings),
    defaultDisabledWritingSkills: Array.isArray(object(document).defaultDisabledWritingSkills) ? object(document).defaultDisabledWritingSkills.filter(name => typeof name === 'string') : [],
    defaultForegroundModel: normalizeBackgroundModel(object(document).defaultForegroundModel),
    defaultBackgroundModel: normalizeBackgroundModel(object(document).defaultBackgroundModel),
    defaultWorkbenchModel: normalizeBackgroundModel(object(document).defaultWorkbenchModel),
    contextCompaction: compactionPolicy(object(document).contextCompaction),
    hideContextAndReasoning: object(document).hideContextAndReasoning !== false,
    headerItems: readHeaderItems(object(document).headerItems),
    viewTabs: readViewTabs(object(document).viewTabs),
    candidateDismissMode: object(document).candidateDismissMode === 'after-fill' ? 'after-fill' : 'after-send',
    // 精修预审: off by default, since it reviews every reply whether or not 精修 is pressed.
    polishPrereview: object(document).polishPrereview === true,
    storyInputToolCall: storyToolCalls.input,
    storyOutputToolCall: storyToolCalls.output,
    castPresentation: object(document).castPresentation === true,
    // 舞台模式, BGM, 音效, 物品 and 入场演出: one switch each for every card, on by default; the stage also needs 对话气泡 (castPresentation).
    stageToggles: Object.fromEntries(STAGE_TOGGLES.map(key => [key, object(object(document).stageToggles)[key] !== false])),
    stageDimensions: stageDimensions(document),
    stageActionCaps: stageActionCaps(document),
    // Unset by default: no judge stage, green entries follow their triggers.
    stageJudge: readJudgeConfig(object(document).stageJudge),
    // 默认皮肤: 经典 until the player picks another; stored selections were checked when written.
    stageSkin: (skin => typeof skin === 'string' || skin && object(skin) === skin ? structuredClone(skin) : 'classic')(object(document).stageSkin),
    // Asset packs on for every card (全局); a card adds its own (本卡) in its cast manifest.
    globalEnabledPackIds: globalPackIds(document),
    // Only the latest floors run a card's HTML interface; 0 renders every floor.
    autoOpenStatusPanel: object(document).autoOpenStatusPanel !== false,
    // Library edits reach a running game on its next turn; only an explicit
    // reload still refreshes the card definition, initvars and MVU state.
    webSearchEnabled: object(document).webSearchEnabled === true,
    systemAppendEnabled: object(document).systemAppendEnabled !== false,
    backgroundModel: normalizeBackgroundModel(object(document).backgroundModel),
    backgroundTasks: normalizeBackgroundTasks(object(document).backgroundTasks),
    // Card rendering uses a fixed trusted policy; legacy preferences are no longer applied.
    trustedCardMode: true,
    systemPrompts: prompts,
    promptSets: presentPromptSets(object(document)),
    cardPersonas: presentCardPersonas(object(document)),
    storyPrompt: story.text,
    storyPromptCustomized: story.customized
  }
}

export function resolveSystemPrompt(document, name, fallback) {
  const custom = promptOverride(object(document), name)
  if (custom !== null) return custom
  return fallback(name)
}
