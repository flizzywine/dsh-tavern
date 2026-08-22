import { MacroEngine } from '../vendor/sillytavern-macros/MacroEngine.js'
import { MacroRegistry, MacroCategory } from '../vendor/sillytavern-macros/MacroRegistry.js'
import { MacroParser } from '../vendor/sillytavern-macros/MacroParser.js'
import { MacroCstWalker } from '../vendor/sillytavern-macros/MacroCstWalker.js'
import { MACRO_VARIABLE_SHORTHAND_PATTERN } from '../vendor/sillytavern-macros/MacroLexer.js'
import { collectMacroDiagnostics } from '../vendor/sillytavern-macros/MacroDiagnostics.js'
import { ELSE_MARKER } from '../vendor/sillytavern-macros/constants.js'
import { isFalseBoolean } from '../vendor/sillytavern-macros/runtime.js'

let registered = false

const LEGACY_VARIABLE_EXPRESSION_PATTERN = new RegExp(
  '\\{\\{\\s*(getvar|getglobalvar)::\\s*(' + MACRO_VARIABLE_SHORTHAND_PATTERN.source + ')\\s*(\\?\\?=|\\|\\|=|\\+\\=|-\\=|==|!=|>=|<=|\\?\\?|\\|\\||>|<|=)\\s*([^{}]*?)\\s*\\}\\}',
  'g'
)

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function variableStore(initial = {}) {
  const values = Object.assign({}, initial && typeof initial === 'object' ? initial : {})
  return {
    get(name) { return values[name] },
    has(name) { return Object.hasOwn(values, name) },
    set(name, value) { values[name] = value },
    add(name, value) {
      const current = values[name]
      const left = Number(current)
      const right = Number(value)
      values[name] = current !== undefined && Number.isFinite(left) && Number.isFinite(right)
        ? left + right
        : str(current) + str(value)
      return values[name]
    },
    inc(name) {
      const current = Number(values[name])
      values[name] = (Number.isFinite(current) ? current : 0) + 1
      return values[name]
    },
    dec(name) {
      const current = Number(values[name])
      values[name] = (Number.isFinite(current) ? current : 0) - 1
      return values[name]
    },
    delete(name) { delete values[name] },
    snapshot() { return Object.assign({}, values) }
  }
}

function splitOnTopLevelElse(content) {
  const { cst } = MacroParser.parseDocument(content)
  const macroNodes = cst && cst.children && Array.isArray(cst.children.macro) ? cst.children.macro : []
  let depth = 0
  for (const macroNode of macroNodes) {
    const info = MacroCstWalker.extractMacroInfo(macroNode)
    if (!info) continue
    if (info.name === 'if' && !info.isClosing && info.argCount === 1) depth++
    else if (info.name === 'if' && info.isClosing) depth--
    else if (info.name === 'else' && depth === 0) {
      return { thenBranch: content.slice(0, info.startOffset), elseBranch: content.slice(info.endOffset + 1) }
    }
  }
  return { thenBranch: content, elseBranch: undefined }
}

function registerAccessor(name, scope, action) {
  const args = [{ name: 'name' }]
  if (action === 'set' || action === 'add') args.push({ name: 'value', optional: true, defaultValue: '' })
  MacroRegistry.registerMacro(name, {
    category: MacroCategory.VARIABLE,
    unnamedArgs: args,
    handler: ({ unnamedArgs, env }) => {
      const store = env.variables[scope]
      const key = str(unnamedArgs[0])
      if (action === 'get') return store.get(key)
      if (action === 'set') { store.set(key, unnamedArgs[1]); return '' }
      if (action === 'add') { store.add(key, unnamedArgs[1]); return '' }
      if (action === 'inc') return store.inc(key)
      if (action === 'dec') return store.dec(key)
      if (action === 'has') return store.has(key) ? 'true' : 'false'
      if (action === 'delete') { store.delete(key); return '' }
      return ''
    }
  })
}

function registerMacros() {
  if (registered) return
  registered = true

  MacroRegistry.registerMacro('user', { category: MacroCategory.NAMES, handler: ({ env }) => env.names.user })
  MacroRegistry.registerMacro('char', { category: MacroCategory.NAMES, handler: ({ env }) => env.names.char })

  registerAccessor('getvar', 'local', 'get')
  registerAccessor('setvar', 'local', 'set')
  registerAccessor('addvar', 'local', 'add')
  registerAccessor('incvar', 'local', 'inc')
  registerAccessor('decvar', 'local', 'dec')
  registerAccessor('hasvar', 'local', 'has')
  registerAccessor('deletevar', 'local', 'delete')
  registerAccessor('getglobalvar', 'global', 'get')
  registerAccessor('setglobalvar', 'global', 'set')
  registerAccessor('addglobalvar', 'global', 'add')
  registerAccessor('incglobalvar', 'global', 'inc')
  registerAccessor('decglobalvar', 'global', 'dec')
  registerAccessor('hasglobalvar', 'global', 'has')
  registerAccessor('deleteglobalvar', 'global', 'delete')

  MacroRegistry.registerMacro('if', {
    category: MacroCategory.UTILITY,
    unnamedArgs: [{ name: 'condition' }, { name: 'content' }],
    delayArgResolution: true,
    handler: ({ unnamedArgs: [rawCondition, rawContent], flags, resolve, trimContent }) => {
      let inverted = false
      let condition = str(rawCondition)
      if (/^\s*!/.test(condition)) {
        inverted = true
        condition = condition.replace(/^\s*!\s*/, '')
      }
      condition = resolve(condition)
      const shorthand = condition.match(new RegExp(`^([.$])(${MACRO_VARIABLE_SHORTHAND_PATTERN.source})$`))
      if (shorthand) condition = resolve(`{{${shorthand[1] === '.' ? 'getvar' : 'getglobalvar'}::${shorthand[2]}}}`)
      else {
        const definition = MacroRegistry.getPrimaryMacro(condition)
        if (definition && definition.minArgs === 0) condition = resolve(`{{${condition}}}`)
      }
      let falsy = condition === '' || isFalseBoolean(condition)
      if (inverted) falsy = !falsy
      const branches = splitOnTopLevelElse(str(rawContent))
      const selected = falsy ? branches.elseBranch : branches.thenBranch
      if (selected === undefined) return ''
      const result = resolve(selected)
      return flags.preserveWhitespace ? result : trimContent(result)
    }
  })
  MacroRegistry.registerMacro('else', { category: MacroCategory.UTILITY, handler: () => ELSE_MARKER })
}

function normalizeLegacyVariableExpressions(text) {
  return str(text).replace(LEGACY_VARIABLE_EXPRESSION_PATTERN, function (_match, accessor, name, operator, value) {
    return '{{' + (accessor === 'getglobalvar' ? '$' : '.') + name + ' ' + operator + ' ' + value.trim() + '}}'
  })
}

/**
 * SillyTavern Macros 2.0 compatibility seam.
 * Unknown macros remain unchanged; callers receive updated variable snapshots.
 */
export function renderTavernMacros(text, context = {}) {
  registerMacros()
  const local = variableStore(context.localVariables)
  const global = variableStore(context.globalVariables)
  const env = {
    content: str(text),
    names: { user: str(context.userName) || 'User', char: str(context.charName) },
    character: {},
    system: { model: '' },
    functions: { postProcess: value => value },
    variables: { local, global },
    dynamicMacros: {},
    extra: {}
  }
  let rendered = normalizeLegacyVariableExpressions(text)
  const diagnostics = []
  // Some ecosystem cards deliberately escape a macro once so that an outer
  // macro pass exposes it for the next pass. Resolve those delayed macros, but
  // cap the loop so malformed or self-producing macros cannot run forever.
  for (let pass = 0; pass < 3; pass += 1) {
    env.content = rendered
    const evaluated = collectMacroDiagnostics(() => MacroEngine.evaluate(rendered, env))
    diagnostics.push(...evaluated.diagnostics)
    if (evaluated.value === rendered) break
    rendered = evaluated.value
  }
  return {
    text: rendered,
    localVariables: local.snapshot(),
    globalVariables: global.snapshot(),
    diagnostics
  }
}
