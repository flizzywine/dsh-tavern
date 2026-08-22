import { cardFieldCatalog } from './card-reading.js'
import { projectRuntimeContent } from './runtime-content-projection.js'

const MAX_CONSTANT_WORLD_BOOK_ENTRIES = 10

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function playProjector(input, warnings) {
  let macroState = {
    userName: str(input.chat && input.chat.macroState && input.chat.macroState.userName) || 'User',
    local: Object.assign({}, input.chat && input.chat.macroState && input.chat.macroState.local || {}),
    global: Object.assign({}, input.chat && input.chat.macroState && input.chat.macroState.global || {})
  }
  return function (text) {
    const result = projectRuntimeContent(text, {
      policy: 'play',
      charName: str(input.card && input.card.name),
      macroState
    })
    macroState = result.macroState
    warnings.push.apply(warnings, result.warnings)
    return result.agentText
  }
}

function worldBookEntries(card) {
  const book = card && card.character_book
  if (book === null || book === undefined || !Array.isArray(book.entries)) return []
  const entries = []
  for (let index = 0; index < book.entries.length; index++) {
    const entry = book.entries[index]
    if (entry === null || typeof entry !== 'object' || entry.enabled === false) continue
    let text = ''
    if (Array.isArray(entry.content)) {
      text = entry.content.map(function (item) { return item !== null && typeof item === 'object' ? str(item.content) : str(item) }).filter(Boolean).join('\n')
    } else {
      text = str(entry.content)
    }
    if (text === '') continue
    const keys = Array.isArray(entry.keys)
      ? entry.keys.map(function (key) { return str(key).trim() }).filter(Boolean)
      : []
    const displayIndex = Number(entry.extensions && entry.extensions.display_index)
    entries.push({ id: 'wb-' + index, index, displayIndex: Number.isFinite(displayIndex) ? displayIndex : index, keys, text, constant: entry.constant === true })
  }
  return entries.sort(function (a, b) { return a.displayIndex - b.displayIndex || a.index - b.index })
}

function cardFieldCatalogText(card) {
  const lines = ['name: ' + (str(card && card.name) || '未命名')]
  for (const item of cardFieldCatalog(card)) {
    if (item.field === 'name') continue
    lines.push(item.field + ': ' + item.chars + ' 字' + (item.empty ? '（空）' : ''))
  }
  return lines.join('\n')
}

function worldBookOverviewText(overview) {
  if (overview === null || typeof overview !== 'object') return '【世界书目录】\n无'
  const entries = Array.isArray(overview.entries) ? overview.entries : []
  const lines = ['【世界书目录 · 《' + (str(overview.name) || '未命名') + '》· ' + (Number(overview.entryCount) || entries.length) + ' 条】']
  if (entries.length === 0) lines.push('无条目')
  for (const entry of entries) {
    const labels = [entry.constant === true ? '常驻' : '非常驻']
    const identity = Array.isArray(entry.keys) && entry.keys.length > 0 ? entry.keys.join('、') : (str(entry.comment) || '无关键词')
    lines.push('[' + str(entry.ref) + '] ' + labels.join('、') + '｜' + identity + '｜' + (Number(entry.chars) || 0) + ' 字')
  }
  return lines.join('\n')
}

export function createContextPlanner(options = {}) {
  if (typeof options.prompt !== 'function') throw new Error('缺少提示词目录')
  const prompt = options.prompt

  async function selectWorldBookEntries(input, warnings) {
    const entries = worldBookEntries(input.card).filter(function (entry) { return entry.constant !== true })
    if (entries.length === 0) return []
    const recent = (input.chat.messages || []).slice(-8).map(function (message) {
      return str(message.text)
    }).join('\n')
    const recentText = (recent + '\n' + str(input.userText).trim()).toLocaleLowerCase()
    return entries.filter(function (entry) {
      return entry.keys.some(function (keyText) {
        const key = str(keyText).trim().toLocaleLowerCase()
        return key !== '' && recentText.includes(key)
      })
    }).map(function (entry) { return entry.id })
  }

  function cardSections(input, projectText) {
    const sections = []
    const entries = worldBookEntries(input.card)
    const selectedIds = Array.isArray(input.worldBookIds) ? input.worldBookIds : []
    const constantEntries = entries.filter(function (entry) { return entry.constant === true }).slice(0, MAX_CONSTANT_WORLD_BOOK_ENTRIES)
    const triggeredEntries = entries.filter(function (entry) { return entry.constant !== true && selectedIds.includes(entry.id) })
    function worldBookSection(kind, selected) {
      return selected.length > 0
        ? { kind, required: false, text: '【世界设定】\n' + selected.map(function (entry) { return projectText('[' + (entry.keys.join('、') || '无触发词') + '] ' + entry.text) }).filter(Boolean).join('\n') }
        : null
    }
    const constantWorldBookSection = worldBookSection('world-book', constantEntries)
    const triggeredWorldBookSection = worldBookSection('world-book-triggered', triggeredEntries)
    const guides = Array.isArray(input.chat.guides) ? input.chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    const projectedGuides = guides.map(function (item) { return projectText(str(item.text).trim()) }).filter(Boolean)
    const guideSection = projectedGuides.length > 0 ? { kind: 'guide', required: true, text: '【用户指导 Guide · 优先遵循】\n' + projectedGuides.map(function (text, index) { return (index + 1) + '. ' + text }).join('\n') } : null
    const projectedPosture = projectText(input.chat.posture)
    const postureSection = projectedPosture !== '' ? { kind: 'posture', required: true, text: '【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + projectedPosture } : null
    const cardInfoSections = []
    const instructionSections = []
    if (input.includeName !== false) cardInfoSections.push({ kind: 'card', required: true, text: '【故事设定 · 人物卡】\n名字: ' + str(input.card.name) })
    if (input.includeDetails === true) {
      if (str(input.card.description) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '设定: ' + projectText(input.card.description) })
      if (str(input.card.personality) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '主要人物性格: ' + projectText(input.card.personality) })
      if (str(input.card.scenario) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '开场情境: ' + projectText(input.card.scenario) })
      if (input.includeStyleExample !== false && str(input.card.mes_example) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '【文风示例】\n' + projectText(input.card.mes_example) })
    }
    if (input.includeInstructions !== false) {
      if (str(input.card.post_history_instructions) !== '') instructionSections.push({ kind: 'card-instruction', required: true, text: '【附加要求】\n' + projectText(input.card.post_history_instructions) })
      if (str(input.card.system_prompt) !== '') instructionSections.push({ kind: 'card-instruction', required: true, text: '【特殊指令】\n' + projectText(input.card.system_prompt) })
    }
    if (input.stableFirst === true) {
      sections.push.apply(sections, cardInfoSections)
      sections.push.apply(sections, instructionSections)
      if (constantWorldBookSection !== null) sections.push(constantWorldBookSection)
      if (triggeredWorldBookSection !== null) sections.push(triggeredWorldBookSection)
      if (guideSection !== null) sections.push(guideSection)
      if (postureSection !== null) sections.push(postureSection)
    } else {
      if (constantWorldBookSection !== null) sections.push(constantWorldBookSection)
      if (triggeredWorldBookSection !== null) sections.push(triggeredWorldBookSection)
      if (postureSection !== null) sections.push(postureSection)
      if (guideSection !== null) sections.push(guideSection)
      sections.push.apply(sections, cardInfoSections)
      sections.push.apply(sections, instructionSections)
    }
    return sections
  }

  function resultOf(sections, warnings, omitted = []) {
    const projected = sections.map(function (section) { return Object.assign({}, section, { text: str(section.text) }) })
    const text = projected.map(function (section) { return section.text }).filter(Boolean).join('\n\n')
    return {
      text,
      audit: {
        included: projected.map(function (section) { return { kind: section.kind, chars: section.text.length, required: section.required === true } }),
        omitted,
        warnings,
        totalChars: text.length
      }
    }
  }

  async function plan(input) {
    const warnings = []
    if (input.purpose === 'body') {
      const projectText = playProjector(input, warnings)
      const selectedIds = await selectWorldBookEntries(input, warnings)
      const sections = [{
        kind: 'base', required: true,
        text: prompt('story')
      }]
      const hasStoryTurn = (input.chat.messages || []).some(function (message) { return message !== null && typeof message === 'object' && message.greeting !== true })
      const hasScript = (input.chat.mode || 'story') === 'script' || (input.scriptReference !== null && input.scriptReference !== undefined)
      sections.push.apply(sections, cardSections({ card: input.card, chat: input.chat, worldBookIds: selectedIds, includeName: false, includeDetails: !hasStoryTurn, includeStyleExample: !hasScript, includeInstructions: true }, projectText))
      if (input.scriptReference !== null && input.scriptReference !== undefined && str(input.scriptReference.text) !== '') {
        const order = Number(input.scriptReference.order)
        const position = Number.isInteger(order) && order >= 0 ? ' · 第 ' + (order + 1) + ' 块' : ''
        sections.push({ kind: 'script', required: true, text: '【本轮剧本参考' + position + '】\n' + projectText(input.scriptReference.text) })
        sections.push({ kind: 'script', required: true, text: prompt('script-story') })
      }
      return resultOf(sections, warnings, hasStoryTurn ? [{ kind: 'card-details', reason: '仅首轮注入完整人物卡细节' }] : [])
    }

    if (input.purpose === 'candidate') {
      const projectText = playProjector(input, warnings)
      const selectedIds = await selectWorldBookEntries(input, warnings)
      const stableSections = [{ kind: 'candidate-task', required: true, text: str(input.task) }]
      const dynamicSections = []
      const plannedCardSections = cardSections({
        card: input.card,
        chat: input.chat,
        worldBookIds: selectedIds,
        includeName: true,
        includeDetails: true,
        includeStyleExample: input.scriptWindow === null || input.scriptWindow === undefined,
        includeInstructions: true,
        stableFirst: true
      }, projectText)
      for (const section of plannedCardSections) {
        if (section.kind === 'guide' || section.kind === 'posture' || section.kind === 'world-book-triggered') dynamicSections.push(section)
        else stableSections.push(section)
      }
      if (input.scriptWindow !== null && input.scriptWindow !== undefined) {
        const window = input.scriptWindow
        dynamicSections.push({
          kind: 'script', required: true,
          text: '【剧本候选参考 · 游标 ' + Math.min(window.cursor + 1, window.total) + ' / ' + window.total + '】\n' + (window.ended
            ? '剧本已到结尾。按最近剧情自然收束，或给出一个新场景开头候选。'
            : window.chunks.map(function (chunk) { return '[' + chunk.id + ']\n' + projectText(chunk.text) }).join('\n\n'))
        })
      }
      const result = resultOf(stableSections.concat(dynamicSections), warnings, [{ kind: 'card-instruction', reason: '候选项不需要正文特殊指令' }])
      result.stableText = stableSections.map(function (section) { return str(section.text) }).filter(Boolean).join('\n\n')
      result.dynamicText = dynamicSections.map(function (section) { return str(section.text) }).filter(Boolean).join('\n\n')
      return result
    }

    if (input.purpose === 'card') {
      const card = input.card || null
      const workspace = input.workspace || {}
      const draft = workspace.draft || {}
      const current = card || draft
      const scriptInfo = input.scriptInfo
      const scriptHint = scriptInfo === null || scriptInfo === undefined
        ? ''
        : '\n\n本卡已绑定剧本《' + scriptInfo.title + '》，共 ' + scriptInfo.chunkCount + ' 块；需要核对内容时可调用 tavern_read_script。'
      const prepared = input.sourcePrepared
      const player = str(workspace.player)
      const sections = []
      sections.push({
        kind: card === null ? 'card-draft' : 'card-current', required: true,
        text: (card === null ? '【待创建人物卡 · 字段目录】\n' : '【当前人物卡 · 字段目录】\n') + cardFieldCatalogText(current) + '\n字段正文尚未自动读取；根据当前任务调用 tavern_read_card 按字段、分段读取。' + scriptHint
      })
      const mountedResources = Array.isArray(workspace.mountedResources) ? workspace.mountedResources.filter(function (item) { return item !== null && typeof item === 'object' }) : []
      if (mountedResources.length > 0) {
        const kindLabel = { card: '人物卡', preset: '预设', source: '资料', script: '剧本资料' }
        sections.push({ kind: 'workspace-resources', required: true, text: '【挂载的 Tavern 资源 · 仅目录，正文尚未自动读取】\n' + mountedResources.map(function (item) { return '- [' + (kindLabel[item.kind] || item.kind) + '] ' + str(item.label) + ' · path=' + str(item.path) }).join('\n') + '\n人物卡和资料使用对应 Tavern 只读工具按需读取；没有实际读取的内容，不得声称已经读过。' })
      }
      if (player !== '' || (Array.isArray(workspace.sourcePaths) && workspace.sourcePaths.length > 0)) {
        sections.push({ kind: 'card-player', required: true, text: '【玩家身份（{{user}}）】\n' + (player !== '' ? player + '\nmes_example、scenario、first_mes 中的 {{user}} 一律指这个身份。需要修改时在 fields 中提交 player。' : '尚未确认。需要制作新卡或处理玩家视角时，先请用户说明谁是玩家（{{user}}）。') })
      }
      if (card !== null) {
        sections.push({ kind: 'world-book-overview', required: false, text: worldBookOverviewText(input.worldBookOverview) + '\n需要查看世界书正文时调用 tavern_read_worldbook。确认修改时调用 tavern_update_card，并在 worldBook 数组中提交逐条操作；不要在 fields 中重传整本世界书。支持 update、add、delete、rename。' })
      }
      if (prepared !== null && typeof prepared === 'object' && Array.isArray(prepared.window) && prepared.window.length > 0) {
        sections.push({ kind: 'card-source', required: true, text: '【本轮挂载资料 · 第 ' + (Number(prepared.cursorBefore) + 1) + '~' + (Number(prepared.cursorBefore) + prepared.window.length) + ' 块 / 共 ' + prepared.total + ' 块】\n' + prepared.window.map(function (chunk) { return '[' + chunk.title + '] ' + chunk.text }).join('\n\n') })
      } else if (prepared !== null && typeof prepared === 'object' && Number(prepared.total) > 0) {
        sections.push({ kind: 'card-source', required: true, text: '【挂载资料】已读取完毕（共 ' + prepared.total + ' 块）。' })
      }
      return resultOf(sections, warnings)
    }

    throw new Error('未知上下文用途: ' + str(input.purpose))
  }

  return Object.freeze({ plan })
}
