import { lastRoundVariableValues } from './foreground-variable-changes.js'
import { canonicalTavernSkillName } from './tavern-skills.js'
import { classifyWorldbookEntry } from './worldbook-entry-classification.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'
import { writingMaterialText } from './writing-material-text.js'

const BROWSE_LIMIT = 6

const normalize = value => String(value ?? '').toLocaleLowerCase()
const wordsOf = query => normalize(query).match(/[\p{L}\p{N}_-]+/gu) || []

const publicVariable = name => !/^(?:\$|__|constructor$|prototype$)/.test(name)

function describeVariable(names, value) {
  if (!names.every(publicVariable)) return []
  const labels = names.map(writingMaterialText)
  return labels.every(Boolean) ? variableSentences(labels.join('的'), value) : []
}

function variableSentences(label, value) {
  if (value === undefined) return [label + '已移除。']
  if (value === null) return [label + '暂无记录。']
  if (Array.isArray(value)) {
    if (!value.length) return [label + '目前没有内容。']
    return value.flatMap((item, index) => variableSentences(label + '的第 ' + (index + 1) + ' 项', item))
  }
  if (typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => {
    const name = publicVariable(key) && writingMaterialText(key)
    return name ? variableSentences(label + '的' + name, item) : []
  })
  const text = typeof value === 'boolean' ? (value ? '是' : '否') : writingMaterialText(value)
  return text ? [label + '为 ' + text + (/[。！？.!?]$/.test(text) ? '' : '。')] : []
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
        const state = context?.generationState
        const structured = state?.messageVariables?.stat_data || state?.variables?.stat_data || state?.variables
        const variables = Object.entries(structured || {}).flatMap(([key, value]) => {
          const lines = describeVariable([key], value)
          return lines.length ? [{ title: key, text: lines.join('\n') }] : []
        })
        const posture = state?.posture
        if (posture) variables.unshift({ id: 'posture', title: '角色情况', text: posture })
        const current = await readHistory()
        const changes = current.regenInProgress ? '' : lastRoundVariableValues(current)
          .flatMap(({ names, value }) => describeVariable(names, value)).join('\n')
        if (changes) variables.unshift({ id: 'changes', title: '上轮变量变化', text: changes })
        return ranked(variables, query, row => [row.title, row.text])
      }
    }
  }
}
