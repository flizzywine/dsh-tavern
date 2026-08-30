import { parse as parseYaml } from 'yaml'
import * as math from 'mathjs'

// Compatibility behavior is derived from MagicalAstrogy/MagVarUpdate at the
// pinned commit recorded in lib/vendor/magvarupdate/SOURCE.md (MIT licensed).

export const MVU_EVENTS = Object.freeze({
  initialized: 'mag_variable_initialized',
  updateStarted: 'mag_variable_update_started',
  commandParsed: 'mag_command_parsed',
  commandParsedForZod: 'mag_command_parsed_for_zod',
  commandParsedEndedForZod: 'mag_command_parsed_ended_for_zod',
  updateEnded: 'mag_variable_update_ended',
  updateEndedForZod: 'mag_variable_update_ended_for_zod',
  beforeMessageUpdate: 'mag_before_message_update'
})

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function analysisSummary(source) {
  const match = str(source).match(/<analysis>([\s\S]*?)<\/analysis>/i)
  return match ? match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : ''
}

function pointerPath(segments) {
  const path = Array.isArray(segments) ? segments : []
  return '/' + path.map(function (item) { return str(item).replaceAll('~', '~0').replaceAll('/', '~1') }).join('/')
}

function receiptValue(value) {
  if (value === undefined) return '不存在'
  if (typeof value === 'string') return value.length > 240 ? value.slice(0, 240) + '…' : value
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return str(value)
  return serialized.length > 240 ? serialized.slice(0, 240) + '…' : serialized
}

function updateReceipt(source, commands, changes, diagnostics) {
  const failures = diagnostics.map(function (item) {
    return { command: str(item.command), message: str(item.message) }
  })
  const summary = analysisSummary(source) || commands.map(function (command) {
    return command.reason === 'json_patch' ? '' : str(command.reason).trim()
  }).filter(Boolean).join('；').slice(0, 300)
  const status = failures.length > 0 ? (changes.length > 0 ? 'partial' : 'error') : (changes.length > 0 ? 'updated' : 'unchanged')
  return { version: 1, status, summary, changes, failures }
}

function mergeInto(target, source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return target
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (target[key] === null || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {}
      mergeInto(target[key], value)
    } else target[key] = clone(value)
  }
  return target
}

function renderMacros(value, context) {
  const variables = object(context)
  return str(value)
    .replaceAll(/{{\s*user\s*}}/gi, str(variables.userName || variables.user || '你'))
    .replaceAll(/{{\s*char\s*}}/gi, str(variables.charName || variables.char || ''))
}

function parseValue(value) {
  const source = str(value).trim()
  if (source === 'undefined') return undefined
  try { return JSON.parse(source) } catch {}
  try {
    const result = math.evaluate(source, { Math, math })
    if (math.isComplex(result) || math.isMatrix(result)) return result.toString()
    if (typeof result === 'number' && Number.isFinite(result)) return Number(result.toPrecision(12))
    if (result !== undefined) return result
  } catch {}
  try { return parseYaml(source) } catch {}
  return source.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1')
}

function parseParameters(source) {
  const parameters = []
  let current = ''
  let quote = ''
  let escaped = false
  let round = 0
  let square = 0
  let curly = 0
  for (const character of str(source)) {
    if (quote !== '') {
      current += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      current += character
      continue
    }
    if (character === '(') round += 1
    else if (character === ')') round -= 1
    else if (character === '[') square += 1
    else if (character === ']') square -= 1
    else if (character === '{') curly += 1
    else if (character === '}') curly -= 1
    if (character === ',' && round === 0 && square === 0 && curly === 0) {
      parameters.push(current.trim())
      current = ''
    } else current += character
  }
  if (current.trim() !== '') parameters.push(current.trim())
  return parameters
}

function closingParen(source, start) {
  let depth = 1
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== '') {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function pointerSegments(path) {
  const source = str(path)
  if (source === '') return []
  return (source.startsWith('/') ? source.slice(1) : source).split('/').map(function (segment) {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~')
  })
}

function lodashPath(segments) {
  return pathSegments(segments).map(function (segment) {
    return '["' + String(segment).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"]'
  }).join('')
}

function normalizeMvuPath(path) {
  const fixedBrackets = str(path).replace(/\[([^\]]*)\]/g, function (_match, rawInner) {
    let inner = rawInner.trim()
    if (inner === '') return '[]'
    let quoted = false
    const first = inner[0]
    const last = inner[inner.length - 1]
    if (inner.length >= 2 && (first === '"' || first === "'") && first === last) {
      quoted = true
      inner = inner.slice(1, -1)
    }
    if (/^\d+$/.test(inner)) return quoted ? '["' + inner.replaceAll('"', '\\"') + '"]' : '[' + inner + ']'
    if (/\s/.test(inner)) return '["' + inner.replaceAll('"', '\\"') + '"]'
    return '[' + inner + ']'
  })
  return fixedBrackets.replace(/(^|\.)(["'])([^"']*)\2(?=\.|\[|$)/g, function (_match, prefix, _quote, name) {
    if (!/\s/.test(name) && !/[.[\]]/.test(name)) return prefix + name
    const escaped = name.replaceAll('"', '\\"')
    return prefix === '.' ? '["' + escaped + '"]' : prefix + '["' + escaped + '"]'
  })
}

function pathSegments(path) {
  if (Array.isArray(path)) return path.map(String)
  const source = normalizeMvuPath(str(path).trim().replace(/^["'`](.*)["'`]$/, '$1'))
  if (source === '') return []
  const result = []
  const matcher = /([^.[\]]+)|\[\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\]]+))\s*\]/g
  let match
  while ((match = matcher.exec(source)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
    result.push(value.replaceAll('\\"', '"').replaceAll("\\'", "'").trim())
  }
  return result
}

function hasAt(root, path) {
  const segments = pathSegments(path)
  if (segments.length === 0) return true
  let current = root
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return false
    current = current[segment]
  }
  return true
}

function getAt(root, path) {
  let current = root
  for (const segment of pathSegments(path)) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

function parentAt(root, path, create = false) {
  const segments = pathSegments(path)
  const key = segments.pop()
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (current === null || typeof current !== 'object') return { parent: null, key }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      if (!create) return { parent: null, key }
      current[segment] = /^\d+$/.test(segments[index + 1] || '') ? [] : {}
    }
    current = current[segment]
  }
  return { parent: current, key }
}

function setAt(root, path, value) {
  const segments = pathSegments(path)
  if (segments.length === 0) return value
  const location = parentAt(root, segments, true)
  if (location.parent === null) return root
  location.parent[location.key] = value
  return root
}

function deleteAt(root, path) {
  const location = parentAt(root, path)
  if (location.parent === null || location.key === undefined) return false
  if (Array.isArray(location.parent) && /^\d+$/.test(location.key)) {
    const index = Number(location.key)
    if (index < 0 || index >= location.parent.length) return false
    location.parent.splice(index, 1)
    return true
  }
  if (!Object.prototype.hasOwnProperty.call(location.parent, location.key)) return false
  delete location.parent[location.key]
  return true
}

function jsonPatchCommands(source) {
  const commands = []
  // Match the innermost usable block. Models sometimes repeat an opening
  // marker (for example `<JsonPatch> <JsonPatch>[...]</JsonPatch>`); this is
  // the same recovery rule used by the pinned MagVarUpdate parser.
  const matcher = /<(json_?patch)>(?:\s*```[^\n]*\n?)?((?:(?!<json_?patch>)[\s\S])*?)(?:```\s*)?<\/\1>/gim
  let match
  while ((match = matcher.exec(source)) !== null) {
    try {
      const patch = parseYaml(match[2].trim())
      if (!Array.isArray(patch)) continue
      for (const operation of patch) {
        if (!operation || typeof operation !== 'object') continue
        const aliases = { replace: 'set', delta: 'add', add: 'insert', remove: 'delete' }
        const target = pointerSegments(operation.path ?? operation.to)
        const source = pointerSegments(operation.from)
        const fullMatch = JSON.stringify(operation)
        let args
        if (operation.op === 'move') args = [lodashPath(source), lodashPath(target)]
        else if (operation.op === 'add' || operation.op === 'insert') {
          const key = target.at(-1) ?? ''
          args = [lodashPath(target.slice(0, -1)), /^\d+$/.test(key) ? key : JSON.stringify(key), JSON.stringify(operation.value)]
        } else if (operation.op === 'remove') args = [lodashPath(target)]
        else args = [lodashPath(target), JSON.stringify(operation.value)]
        commands.push({
          type: aliases[operation.op] || operation.op,
          path: target,
          from: source,
          value: clone(operation.value),
          args,
          reason: 'json_patch',
          fullMatch,
          full_match: fullMatch,
          index: match.index
        })
      }
    } catch {}
  }
  return commands
}

function lodashCommands(source) {
  const commands = []
  const matcher = /_\.(set|insert|assign|remove|unset|delete|add)\(/g
  let match
  while ((match = matcher.exec(source)) !== null) {
    const end = closingParen(source, matcher.lastIndex)
    if (end < 0 || source[end + 1] !== ';') continue
    const args = parseParameters(source.slice(matcher.lastIndex, end))
    const minimum = { set: 2, insert: 2, assign: 2, remove: 1, unset: 1, delete: 1, add: 2 }[match[1]]
    if (args.length < minimum || (match[1] === 'add' && args.length !== 2)) continue
    const comment = source.slice(end + 2).match(/^\s*\/\/([^\n\r]*)/)
    const fullMatch = source.slice(match.index, end + 2 + (comment ? comment[0].length : 0))
    commands.push({
      type: ({ assign: 'insert', remove: 'delete', unset: 'delete' })[match[1]] || match[1],
      path: pathSegments(parseValue(args[0])),
      args,
      reason: comment ? comment[1].trim() : '',
      fullMatch,
      full_match: fullMatch,
      index: match.index
    })
    matcher.lastIndex = end + 2
  }
  return commands
}

export function extractMvuCommands(source) {
  return jsonPatchCommands(str(source)).concat(lodashCommands(str(source))).sort(function (left, right) {
    return left.index - right.index
  })
}

function displayChange(before, after, reason) {
  return JSON.stringify(before) + '->' + JSON.stringify(after) + (reason ? ' (' + reason + ')' : '')
}

function applyCommand(statData, command) {
  const path = command.path
  if (command.type === 'set') {
    if (!hasAt(statData, path)) throw new Error('set 路径不存在')
    const before = clone(getAt(statData, path))
    let value = clone(parseValue(command.args.at(-1)))
    if (path.length === 0) return { statData: object(value), before, after: clone(value) }
    const current = getAt(statData, path)
    if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string' && !Array.isArray(current[0])) {
      if (typeof current[0] === 'number' && value !== null) value = Number(value)
      current[0] = value
    }
    else if (typeof current === 'number' && value !== null && typeof value === 'string') setAt(statData, path, Number(value))
    else setAt(statData, path, value)
    return { statData, before, after: clone(getAt(statData, path)) }
  }
  if (command.type === 'add') {
    if (!hasAt(statData, path)) throw new Error('add 路径不存在')
    const stored = getAt(statData, path)
    const value = Array.isArray(stored) && stored.length === 2 && typeof stored[1] === 'string' ? stored[0] : stored
    const delta = parseValue(command.args.at(-1))
    if (typeof value !== 'number' || typeof delta !== 'number') throw new Error('add 只支持数值增量')
    const next = Number((value + delta).toPrecision(12))
    const before = clone(stored)
    if (Array.isArray(stored)) stored[0] = next
    else setAt(statData, path, next)
    return { statData, before, after: clone(getAt(statData, path)) }
  }
  if (command.type === 'insert') {
    const collection = getAt(statData, path)
    const key = command.args.length >= 3 ? parseValue(command.args[1]) : undefined
    const value = parseValue(command.args.at(-1))
    if (collection === null || typeof collection !== 'object') throw new Error('insert 目标不是集合')
    const before = clone(collection)
    let receiptPath = path
    let receiptBefore = before
    let receiptAfter
    if (Array.isArray(collection)) {
      if (command.args.length >= 3) {
        const index = key === '-' || Number(key) === -1 ? collection.length : Number(key)
        if (!Number.isInteger(index)) throw new Error('insert 数组索引无效')
        receiptPath = path.concat(index)
        receiptBefore = undefined
        collection.splice(index, 0, clone(value))
        receiptAfter = clone(collection[index])
      } else {
        receiptPath = path.concat(collection.length)
        receiptBefore = undefined
        collection.push(clone(value))
        receiptAfter = clone(collection.at(-1))
      }
    } else if (command.args.length >= 3) {
      receiptPath = path.concat(String(key))
      receiptBefore = clone(collection[String(key)])
      collection[String(key)] = clone(value)
      receiptAfter = clone(collection[String(key)])
    }
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) Object.assign(collection, clone(value))
    else throw new Error('insert 对象合并值无效')
    if (receiptAfter === undefined && command.args.length < 3) receiptAfter = clone(collection)
    return { statData, before, after: clone(collection), displayPath: path, receiptPath, receiptBefore, receiptAfter }
  }
  if (command.type === 'delete') {
    const jsonPatch = command.reason === 'json_patch'
    if (!jsonPatch && command.args && command.args.length > 1) {
      const collection = getAt(statData, path)
      if (collection === null || typeof collection !== 'object') throw new Error('delete 目标不是集合')
      const before = clone(collection)
      const target = parseValue(command.args[1])
      if (Array.isArray(collection)) {
        const index = typeof target === 'number' ? target : collection.findIndex(function (item) { return same(item, target) })
        if (index < 0 || index >= collection.length) throw new Error('delete 数组目标不存在')
        collection.splice(index, 1)
      } else if (!Object.prototype.hasOwnProperty.call(collection, String(target))) throw new Error('delete 对象目标不存在')
      else delete collection[String(target)]
      return { statData, before, after: clone(collection) }
    }
    const before = clone(getAt(statData, path))
    if (!deleteAt(statData, path)) throw new Error('delete 路径不存在')
    return { statData, before, after: undefined }
  }
  if (command.type === 'move') {
    if (!hasAt(statData, command.from)) throw new Error('move 来源不存在')
    const value = clone(getAt(statData, command.from))
    const before = clone(getAt(statData, path))
    deleteAt(statData, command.from)
    const target = parentAt(statData, path)
    if (target.parent === null) throw new Error('move 目标不存在')
    if (Array.isArray(target.parent)) target.parent.splice(target.key === '-' ? target.parent.length : Number(target.key), 0, value)
    else target.parent[target.key] = value
    return { statData, before, after: clone(value) }
  }
  throw new Error('不支持的 MVU 命令: ' + command.type)
}

function emptyVariables(statData = {}, initializedLorebooks = {}) {
  return { initialized_lorebooks: clone(object(initializedLorebooks)), stat_data: clone(object(statData)), schema: { extensible: false, properties: {}, type: 'object' } }
}

async function emitEvent(emit, events, name, ...args) {
  events.push(name)
  if (!emit) return
  const returned = await emit(name, ...args)
  if (!Array.isArray(returned)) return
  for (let index = 0; index < Math.min(args.length, returned.length); index += 1) {
    const target = args[index]
    const next = returned[index]
    if (Array.isArray(target) && Array.isArray(next)) {
	  const replacement = clone(next)
	  target.splice(0, target.length, ...replacement)
	}
    else if (target && next && typeof target === 'object' && typeof next === 'object') {
	  const replacement = clone(next)
      for (const key of Object.keys(target)) delete target[key]
	  Object.assign(target, replacement)
    }
  }
}

async function updateVariables(sourceText, previous, emit) {
  const variables = clone(previous && typeof previous === 'object' ? previous : emptyVariables())
  if (!variables.stat_data || typeof variables.stat_data !== 'object') {
    const diagnostics = [{ message: 'MVU stat_data 不存在' }]
    return { variables, modified: false, commands: [], diagnostics, events: [], receipt: updateReceipt(sourceText, [], [], diagnostics) }
  }
  const before = clone(variables)
  const commands = extractMvuCommands(sourceText)
  const diagnostics = []
  const events = []
  const changes = []
  const displayData = clone(variables.stat_data)
  const deltaData = {}
  await emitEvent(emit, events, MVU_EVENTS.updateStarted, variables)
  await emitEvent(emit, events, MVU_EVENTS.commandParsed, variables, commands, sourceText)
  await emitEvent(emit, events, MVU_EVENTS.commandParsedForZod, variables, commands, sourceText)
  await emitEvent(emit, events, MVU_EVENTS.commandParsedEndedForZod, variables, commands, sourceText)
  for (const command of commands) {
    try {
      if (Array.isArray(command.args) && command.args.length > 0) {
		if (command.type === 'move' && command.args.length > 1) {
		  const rawFrom = str(command.args[0])
		  const rawPath = str(command.args[1])
		  command.from = rawFrom.startsWith('/') ? pointerSegments(rawFrom) : pathSegments(parseValue(rawFrom))
		  if (command.from[0] === 'stat_data') command.from = command.from.slice(1)
		  command.path = rawPath.startsWith('/') ? pointerSegments(rawPath) : pathSegments(parseValue(rawPath))
		} else {
		  const rawPath = str(command.args[0])
		  command.path = rawPath.startsWith('/') ? pointerSegments(rawPath) : pathSegments(parseValue(rawPath))
		}
		if (command.path[0] === 'stat_data') command.path = command.path.slice(1)
      }
      const result = applyCommand(variables.stat_data, command)
      const displayPath = result.displayPath || command.path
      const display = displayChange(result.before, result.after, command.reason)
      if (displayPath.length === 0) variables.display_data = display
      else setAt(displayData, displayPath, display)
      if (displayPath.length === 0) Object.assign(deltaData, { $root: display })
      else setAt(deltaData, displayPath, display)
      const receiptBefore = Object.prototype.hasOwnProperty.call(result, 'receiptBefore') ? result.receiptBefore : result.before
      const receiptAfter = Object.prototype.hasOwnProperty.call(result, 'receiptAfter') ? result.receiptAfter : result.after
      if (!same(receiptBefore, receiptAfter)) changes.push({
        operation: command.type,
        path: pointerPath(result.receiptPath || displayPath),
        before: receiptValue(receiptBefore),
        after: receiptValue(receiptAfter)
      })
    } catch (error) {
      diagnostics.push({ command: command.fullMatch, message: error instanceof Error ? error.message : String(error) })
    }
  }
  variables.display_data = displayData
  variables.delta_data = deltaData
  await emitEvent(emit, events, MVU_EVENTS.updateEnded, variables, before)
  const modified = !same(variables.stat_data, before.stat_data)
  await emitEvent(emit, events, MVU_EVENTS.updateEndedForZod, variables, before)
  return { variables, modified, commands, diagnostics, events, receipt: updateReceipt(sourceText, commands, changes, diagnostics) }
}

function initBlocks(source, macroContext) {
  const merged = {}
  let found = false
  const matcher = /<(initvar)>(?:\s*```[^\n]*\n?)?([\s\S]*?)(?:```\s*)?<\/\1>/gim
  let match
  while ((match = matcher.exec(str(source))) !== null) {
    const value = parseYaml(renderMacros(match[2], macroContext))
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) mergeInto(merged, value)
    found = true
  }
  return { found, statData: merged }
}

export function readMvuWorldBookInitialState(book, macroContext = {}) {
  const source = object(book)
  const entries = Array.isArray(source.entries) ? source.entries : Object.values(object(source.entries))
  const statData = {}
  const diagnostics = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = object(entries[index])
    if (entry.enabled === false || !str(entry.comment || entry.name).toLowerCase().includes('[initvar]')) continue
    let content = str(entry.content).trim()
    const xml = content.match(/.*<initvar>.*\n([\s\S]*)\n.*<\/initvar>.*/m)
    if (xml) content = xml[1]
    const code = content.match(/```[^\n]*\n([\s\S]*)\n```/m)
    if (code) content = code[1]
    try {
      const value = parseYaml(renderMacros(content, macroContext))
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) mergeInto(statData, value)
    } catch (error) {
      diagnostics.push({ entry: str(entry.comment || entry.name) || String(index), message: error instanceof Error ? error.message : String(error) })
    }
  }
  const name = str(source.name).trim()
  return { statData, initializedLorebooks: name === '' ? {} : { [name]: [] }, diagnostics }
}

/** Compatibility core for official MVU message/swipe state semantics. */
export function createTavernMvuRuntime(options = {}) {
  const emit = typeof options.emit === 'function' ? options.emit : null

  async function initializeChat(input = {}) {
	const runtimeEmit = typeof input.emit === 'function' ? input.emit : emit
    const swipes = Array.isArray(input.swipes) ? input.swipes.map(str) : []
    const selectedSwipeId = Math.max(0, Math.min(swipes.length - 1, Number(input.selectedSwipeId) || 0))
    const variables = []
    const diagnostics = []
    const events = []
    for (let index = 0; index < swipes.length; index += 1) {
      let initial = emptyVariables(input.baseStatData, input.initializedLorebooks)
      try {
        const embedded = initBlocks(swipes[index], input.macroContext)
        if (embedded.found) initial = emptyVariables(embedded.statData, input.initializedLorebooks)
      } catch (error) {
        diagnostics.push({ swipeId: index, message: error instanceof Error ? error.message : String(error) })
      }
	  await emitEvent(runtimeEmit, events, MVU_EVENTS.initialized, initial, index)
	  const updated = await updateVariables(renderMacros(swipes[index], input.macroContext), initial, runtimeEmit)
      variables.push(updated.variables)
      diagnostics.push(...updated.diagnostics.map(function (item) { return Object.assign({ swipeId: index }, item) }))
      events.push(...updated.events)
    }
    return { swipeId: selectedSwipeId, swipes, variables, diagnostics, events }
  }

  async function settleResponse(input = {}) {
	const runtimeEmit = typeof input.emit === 'function' ? input.emit : emit
    const sourceText = renderMacros(input.sourceText, input.macroContext)
	const updated = await updateVariables(sourceText, input.previousVariables, runtimeEmit)
    let messageText = sourceText
    if (updated.modified) {
      const context = { variables: updated.variables, message_content: messageText }
	  await emitEvent(runtimeEmit, updated.events, MVU_EVENTS.beforeMessageUpdate, context)
      messageText = str(context.message_content)
    }
    if (!messageText.includes('<StatusPlaceHolderImpl/>')) messageText += '\n\n<StatusPlaceHolderImpl/>'
    messageText = messageText.replaceAll(/<(status_current_variable)>(?:(?!<\1>).)*<\/\1?>/gis, '')
    return Object.assign(updated, { sourceText: messageText })
  }

  return Object.freeze({ initializeChat, settleResponse, lastVariables: lastMvuVariables })
}

export function lastMvuVariables(messages, endExclusive = Infinity) {
  const source = Array.isArray(messages) ? messages : []
  const end = Math.min(source.length, Number.isFinite(endExclusive) ? Math.max(0, endExclusive) : source.length)
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = source[index]
    if (!message || !Array.isArray(message.variables) || message.variables.length === 0) continue
    const swipeId = Math.max(0, Math.min(message.variables.length - 1, Number(message.swipeId) || 0))
    if (message.variables[swipeId] !== undefined) return clone(message.variables[swipeId])
  }
  return undefined
}
