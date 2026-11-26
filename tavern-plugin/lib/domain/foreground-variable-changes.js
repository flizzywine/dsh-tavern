import { promptSection } from './prompt-section.js'
import { isDeepStrictEqual } from 'node:util'
import contract from '../../src/client/widget-contracts.cjs'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Current values after last turn's settlement and the user's widget actions (paths relative to stat_data); an action may have restored an old value, so a listing isn't a net change. Write this turn from these values.",
  p002: "Variables changed by last turn's settlement, with latest values (paths relative to stat_data); others are unchanged. Write this turn from these values.",
  p003: "…and ",
  p004: " more changes not listed; query them with tavern_read_variables"
})


const { stageWidgetVariablePointer: parsePointer, stageWidgetVariableContains: contains } = contract

const LIMIT = 6000
// Long generated text (diaries, chat logs) only needs to be recognizable here.
const VALUE_LIMIT = 100
const escapeKey = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
const pathParts = path => path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const publicKey = key => !key.startsWith('$') && !key.startsWith('__') && !['constructor', 'prototype'].includes(key)

function statDataOf(message) {
  const value = message?.variables?.[Math.max(0, Number(message.swipeId) || 0)]?.stat_data
  return isObject(value) ? value : null
}

// Objects are walked; a list or scalar is one variable, reported with its whole latest value.
function changedPaths(before, after, path = '', out = []) {
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (!publicKey(key)) continue
    const next = after[key], previous = before?.[key], pointer = path + '/' + escapeKey(key)
    if (isObject(next) && isObject(previous)) changedPaths(previous, next, pointer, out)
    else if (!isDeepStrictEqual(previous, next)) out.push([pointer, next])
  }
  return out
}

function readPath(state, parts) {
  for (const key of parts) state = state && typeof state === 'object' && Object.hasOwn(state, key) ? state[key] : undefined
  return state
}

function settlementChanges(receipt, state) {
  if (!Array.isArray(receipt?.changes) || !Array.isArray(receipt.sideEffects)) return null
  return receipt.changes.flatMap(change => {
    if (typeof change?.path !== 'string' || !change.path.startsWith('/stat_data/')) return []
    const path = change.path.slice('/stat_data'.length)
    const parts = pathParts(path)
    return parts.every(publicKey) ? [[path, readPath(state, parts)]] : []
  })
}

function lastRoundChanges(chat) {
  const messages = chat?.messages
  if (!messages || !['story', 'script'].includes(chat.mode || 'story') || chat.mvu?.enabled !== true) return null
  let latest = -1, previous = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !statDataOf(message)) continue
    if (latest < 0) latest = index
    else { previous = index; break }
  }
  if (latest < 0) return null
  const head = messages[latest], after = statDataOf(head)
  const swipe = Math.max(0, Number(head.swipeId) || 0)
  // The opening Helper can initialize variables after the previous assistant floor.
  // Prefer the selected reply's actual pre-settlement snapshot, when recorded.
  const baseline = head.mvuBaseline?.swipeId === swipe ? head.mvuBaseline.variables?.stat_data : undefined
  const before = isObject(baseline) ? baseline : statDataOf(messages[previous])
  // The audited receipt identifies the writes. Script side effects stay in the
  // current snapshot and remain available to a targeted variable query.
  const confirmed = isObject(baseline) ? settlementChanges(head.mvu?.receipt, after) : null
  const changes = confirmed ?? (before ? changedPaths(before, after) : [])
  // edits belong to the selected head/swipe, including a single opening snapshot.
  const edit = head.variableEdits?.[swipe]
  const editedPaths = []
  if (edit?.editedAfterSettlement === true && Array.isArray(edit.feedbackPaths)) {
    for (const path of edit.feedbackPaths.slice(0, 64)) {
      try {
        const parts = parsePointer(path)
        if (editedPaths.some(item => contains(item.parts, parts))) continue
        for (let i = editedPaths.length - 1; i >= 0; i--) if (contains(parts, editedPaths[i].parts)) editedPaths.splice(i, 1)
        editedPaths.push({ path, parts })
      } catch { /* never interpolate internal or malformed stored paths */ }
    }
  }
  for (const { path, parts } of editedPaths) {
    for (let i = changes.length - 1; i >= 0; i--) {
      const existing = pathParts(changes[i][0])
      if (contains(parts, existing)) changes.splice(i, 1)
    }
    const ancestor = changes.find(([existing]) => contains(pathParts(existing), parts))
    if (ancestor) { ancestor[2] = true; continue }
    changes.push([path, readPath(after, parts), true])
  }
  return { changes, edited: editedPaths.length > 0 }
}

export function lastRoundVariableValues(chat) {
  return (lastRoundChanges(chat)?.changes ?? []).map(([path, value]) => ({ names: pathParts(path), value }))
}

/**
 * The foreground writes without the variable state; settlement updates it afterwards.
 * Before the next reply, hand back only what the last round changed, latest values.
 */
export function lastRoundVariableChanges(chat) {
  const { changes, edited } = lastRoundChanges(chat) ?? {}
  if (!changes?.length) return null
  const lines = []
  let size = 0, omitted = 0
  for (const [path, value, edited] of changes) {
    const text = value === undefined ? '（已删除）' : JSON.stringify(value)
    const chars = Array.from(text)
    const line = (edited ? '（用户组件操作后当前值）' : '') + path + ' = ' + (chars.length > VALUE_LIMIT ? chars.slice(0, VALUE_LIMIT).join('') + '…（已截断）' : text)
    if (size + line.length > LIMIT) { omitted++; continue }
    size += line.length
    lines.push(line)
  }
  return promptSection('variable_changes', [edited ? PROMPT_PROSE.p001 : PROMPT_PROSE.p002,
    ...lines, ...(omitted ? [PROMPT_PROSE.p003 + omitted + PROMPT_PROSE.p004] : [])].join('\n'))
}
