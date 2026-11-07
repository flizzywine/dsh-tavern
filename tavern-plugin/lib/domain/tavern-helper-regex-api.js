// Synchronous Helper APIs share the host's regex engine, with live context reads.
// Keep this installer self-contained for script and message iframe serialization.
function installTavernHelperRegexApi(options) {
  const target = options.window
  const engine = options.createEngine()
  const placements = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }

  target.getTavernRegexes = function (option = {}) {
    const groups = options.context()?.regexScripts || {}
    const types = option.type ? [option.type] : option.scope && option.scope !== 'all' ? [option.scope] : ['global', 'preset', 'character']
    return types.flatMap(type => (Array.isArray(groups[type]) ? groups[type] : []).map(script => {
      const source = script.source || {}, destination = script.destination || {}
      const enabled = script.enabled !== false && script.disabled !== true
      const places = script.placement || []
      return {
        id: String(script.id || ''), script_name: String(script.script_name || script.name || script.scriptName || ''), enabled,
        ...(option.type ? {} : { scope: type }), find_regex: String(script.find_regex ?? script.findRegex ?? ''),
        replace_string: String(script.replace_string ?? script.replaceString ?? ''), trim_strings: [...(script.trim_strings || script.trimStrings || [])],
        source: { user_input: places.includes(1), ai_output: places.includes(2), slash_command: places.includes(3), world_info: places.includes(5), reasoning: places.includes(6), ...source },
        destination: { display: script.markdownOnly === true, prompt: script.promptOnly === true, ...destination },
        run_on_edit: script.run_on_edit === true || script.runOnEdit === true,
        min_depth: script.min_depth ?? script.minDepth ?? null, max_depth: script.max_depth ?? script.maxDepth ?? null
      }
    })).filter(script => !option.enable_state || option.enable_state === 'all' || (option.enable_state === 'enabled' ? script.enabled : !script.enabled))
  }

  function boundCharacter(state) {
    // DSH applies enabled rules on a bound card without SillyTavern's separate
    // avatar opt-in. This reports the same permission as the Helper facade's
    // character_allowed_regex projection, even when all individual rules are off.
    return state.character !== null && typeof state.character === 'object' && !Array.isArray(state.character)
  }

  function substituteIdentity(value, state, characterName, escape = false) {
    function replacement(value) {
      const text = String(value)
      return escape ? text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : text
    }
    return String(value ?? '').replace(/{{\s*(user|char)\s*}}/gi, function (_match, name) {
      return replacement(name.toLowerCase() === 'user'
        ? state.playerName || '你'
        : characterName ?? (state.characterName || state.character?.name || state.character?.data?.name || '角色'))
    })
  }

  target.isCharacterTavernRegexesEnabled = function () {
    return boundCharacter(options.context() || {})
  }

  target.formatAsTavernRegexedString = function (value, source, destination, settings = {}) {
    if (!Object.prototype.hasOwnProperty.call(placements, source)) throw new TypeError('无效的正则来源: ' + String(source))
    if (destination !== 'display' && destination !== 'prompt') throw new TypeError('无效的正则目标: ' + String(destination))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('正则选项必须是对象')
    if (settings.depth !== undefined && (typeof settings.depth !== 'number' || !Number.isFinite(settings.depth))) {
      throw new TypeError('正则深度必须是有限数字')
    }
    const state = options.context() || {}
    const groups = state.regexScripts || {}
    const list = value => Array.isArray(value) ? value : []
    // Preserve DSH's global, preset, character priority; preset rules participate
    // when the host supplies that group. No state or stored message is modified.
    const scripts = list(groups.global).concat(list(groups.preset), boundCharacter(state) ? list(groups.character) : [])
      .filter(script => script && typeof script === 'object')
      .map(function (script) {
        const mode = Number(script.substituteRegex)
        return {
          ...script,
          findRegex: mode === 1 || mode === 2
            ? substituteIdentity(script.findRegex, state, settings.character_name, mode === 2) : script.findRegex,
          trimStrings: list(script.trimStrings).map(value => substituteIdentity(value, state, settings.character_name))
        }
      })
    const result = engine.applyTavernRegexText(value, scripts, {
      placement: placements[source], isMarkdown: destination === 'display', isEdit: false,
      depth: settings.depth, ignoreDepth: settings.depth === undefined
    })
    for (const warning of result.warnings) target.console?.warn?.('[TavernHelper regex] ' + warning)
    // Apply identity macros first, then the shared read-only macro adapter.
    // Unknown or side-effecting macros remain literal during formatting.
    const formatted = substituteIdentity(result.text, state, settings.character_name)
    return typeof target.substitudeMacros === 'function' ? target.substitudeMacros(formatted, {
      character_name: settings.character_name,
      message_id: settings.depth === undefined ? undefined : (state.messages || []).length - settings.depth - 1
    }) : formatted
  }

  return {
    formatAsTavernRegexedString: target.formatAsTavernRegexedString,
    isCharacterTavernRegexesEnabled: target.isCharacterTavernRegexesEnabled
  }
}

export { installTavernHelperRegexApi }
