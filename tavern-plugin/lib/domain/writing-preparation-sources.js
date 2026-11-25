import { lastRoundVariableValues } from './foreground-variable-changes.js'
import { canonicalTavernSkillName } from './tavern-skills.js'
import { classifyWorldbookEntry } from './worldbook-entry-classification.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'
import { writingMaterialText } from './writing-material-text.js'

const BROWSE_LIMIT = 6
const VARIABLE_VALUE_LIMIT = 400
const VARIABLE_NAME_FIELDS = ['name', 'displayName', '姓名', '名字', '名称']

const normalize = value => String(value ?? '').toLocaleLowerCase()
const wordsOf = query => normalize(query).match(/[\p{L}\p{N}_-]+/gu) || []

const publicVariable = (name, parent) => !/^(?:\$|__|constructor$|prototype$|schemaVersion$)/.test(name)
  && !(name === 'meta' && parent && Object.hasOwn(parent, 'schemaVersion'))
const variableRecordNames = record => VARIABLE_NAME_FIELDS.flatMap(key =>
  record && Object.hasOwn(record, key) && typeof record[key] === 'string' ? [record[key]] : [])

function* variableFacts(names, value, aliases = [], title = names[0], field = names.at(-1)) {
  if (Array.isArray(value) && value.length) {
    for (const [index, item] of value.entries()) {
      yield* variableFacts([...names, '第 ' + (index + 1) + ' 项'], item, aliases, title, field)
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const recordNames = [...aliases, ...variableRecordNames(value)]
    for (const [key, item] of Object.entries(value)) {
      if (!publicVariable(key, value)) continue
      yield* variableFacts([...names, key], item, recordNames, title ?? key)
    }
  } else {
    yield { names, field, value, aliases, title }
  }
}

function* changedVariableFacts(changes, snapshot) {
  for (const { names, value } of changes) {
    let parent = snapshot
    const aliases = []
    const visible = names.every(key => {
      if (!publicVariable(key, parent)) return false
      aliases.push(...variableRecordNames(parent))
      parent = parent?.[key]
      return true
    })
    if (visible) yield* variableFacts(names, value, aliases, '上轮变量变化')
  }
}

function describeVariable({ names, value }) {
  const labels = names.map(writingMaterialText)
  if (!labels.length || !labels.every(Boolean)) return ''
  const label = labels.join('的')
  if (value === undefined) return label + '已移除。'
  if (value === null) return label + '暂无记录。'
  if (Array.isArray(value)) return label + '目前没有内容。'
  const text = typeof value === 'boolean' ? (value ? '是' : '否') : writingMaterialText(value).replace(/\s*\n\s*/g, ' ')
  if (text.length > VARIABLE_VALUE_LIMIT) return label + '为 ' + text.slice(0, VARIABLE_VALUE_LIMIT) + '…'
  return text ? label + '为 ' + text + (/[。！？.!?]$/.test(text) ? '' : '。') : ''
}

function matchingVariableFacts(facts, words) {
  let best = Math.min(words.length, 2)
  let matches = []
  for (const fact of facts) {
    const field = normalize(fact.field)
    const value = normalize(fact.value)
    // A path or character name can narrow a query, but should not expand a whole record.
    if (!words.some(word => field.includes(word) || value.includes(word))) continue
    const scope = [...fact.names.slice(0, -1), ...fact.aliases].map(normalize)
    const score = words.filter(word => field.includes(word) || value.includes(word) || scope.some(part => part.includes(word))).length
    if (score < best) continue
    if (score > best) {
      best = score
      matches = []
    }
    matches.push(fact)
  }
  const rows = new Map()
  const seen = new Set()
  for (const fact of matches) {
    const text = describeVariable(fact)
    if (!text || seen.has(text)) continue
    seen.add(text)
    const lines = rows.get(fact.title) || []
    lines.push(text)
    rows.set(fact.title, lines)
    if (seen.size === BROWSE_LIMIT) break
  }
  return [...rows].map(([title, lines]) => ({ title, text: lines.join('\n') }))
}

function ranked(rows, query, fields) {
  const words = wordsOf(query)
  if (!words.length) return rows.slice(0, BROWSE_LIMIT)
  return rows.map(row => {
    const [title, text] = fields(row).map(normalize)
    return { row, score: words.reduce((score, word) => score + (title.includes(word) ? 4 : 0) + (text.includes(word) ? 1 : 0), 0) }
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score)
    .slice(0, BROWSE_LIMIT).map(item => item.row)
}

export function createWritingPreparationSources({ tavernSkills, chatForSession, worldbookForChat, historyRecall }) {
  return ({ gameId, frame, chat, signal }) => {
    let catalog, history, worldbook
    const disabled = new Set((chat?.disabledWritingSkills || []).map(canonicalTavernSkillName))
    const applicableSkills = () => catalog ??= tavernSkills.list().then(rows => rows.filter(skill =>
      skill.modelInvocable && skill.agents.includes('foreground') && !disabled.has(skill.name)))
    const readHistory = () => history ??= chatForSession(gameId).then(current => {
      if (!current) throw new Error('找不到本局写作上下文')
      const target = current.regenRecovery?.candidateFrame && current.regenRecovery
      const cutoff = target ? current.messages.findIndex(row => row?.role === 'assistant' &&
        (target.targetMessageUid ? row.messageUid === target.targetMessageUid : Number(row.turn) === Number(target.storyTurn))) : -1
      const rows = cutoff < 0 ? current.messages : current.messages.slice(0, cutoff)
      const settled = rows.findLastIndex(row => row?.role === 'assistant' && String(row.text ?? '').trim())
      return { ...current, messages: rows.slice(0, settled + 1) }
    })
    const context = frame.source?.regenerationMaterials
    const memoryScope = {}
    return {
      listSkills: async () => {
        signal.throwIfAborted()
        return (await applicableSkills()).map(({ name, description }) => ({ name, description })).slice(0, 100)
      },
      skill: async ({ name, reference }) => {
        const skill = (await applicableSkills()).find(row => row.name === name)
        if (!skill) throw new Error('当前写作 Skill 不可用')
        const text = reference ? await tavernSkills.readReference(name, reference) : skill.content
        return [{ text }]
      },
      worldbook: async ({ query }) => {
        if (!wordsOf(query).length) throw new Error('世界书检索需要当前场景的关键词')
        worldbook ??= readHistory().then(worldbookForChat)
        const rendered = new Map((context?.worldbookEntries || []).map(row => [row.ref, row.text]))
        const rows = ((await worldbook)?.view?.entries || []).flatMap(entry => {
          if (entry.enabled === false || isMvuUpdateEntry(entry)) return []
          const classification = classifyWorldbookEntry(entry)
          if (classification.kind === 'static-constant' && context?.worldbookPrefix?.includes(entry.content)) return []
          const text = rendered.get(entry.ref) ?? (classification.dynamic ? '' : entry.content)
          return text?.trim() ? [{ id: entry.ref, title: entry.title || entry.comment, keys: [...(entry.keys || []), ...(entry.secondaryKeys || [])], text }] : []
        })
        return ranked(rows, query, row => [[row.title, ...row.keys].join(' '), row.text]).map(({ keys, ...row }) => row)
      },
      memory: async ({ query, turn }) => {
        const saved = await readHistory()
        const result = historyRecall.recall({ chat: saved, query: String(query ?? '').slice(0, 200), turn,
          limit: 4, radius: 0, scope: memoryScope, audience: 'background' })
        return [
          ...result.matches.map(row => ({ id: row.turn + ':excerpt', title: '第 ' + row.turn + ' 轮', text: row.excerpt })),
          ...result.rounds.map(row => ({ id: row.turn + ':full', title: '第 ' + row.turn + ' 轮', text: row.messages.map(message => message.text).join('\n') }))
        ]
      },
      variables: async ({ query }) => {
        const words = [...new Set(wordsOf(query))]
        if (!words.length) return []
        const state = context?.generationState
        const structured = state?.messageVariables?.stat_data || state?.variables?.stat_data || state?.variables
        const current = await readHistory()
        const changes = current.regenInProgress ? [] : lastRoundVariableValues(current)
        return matchingVariableFacts([
          ...changedVariableFacts(changes, structured),
          ...(state?.posture ? variableFacts(['角色情况'], state.posture) : []),
          ...variableFacts([], structured || {})
        ], words)
      }
    }
  }
}
