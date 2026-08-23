function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function depth(value) {
  const number = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number
}

// Mirrors SillyTavern's slash-delimited regex parsing while still accepting a
// plain pattern such as "校园".
function regexFromString(value) {
  const source = str(value)
  const match = source.match(/(\/?)(.+)\1([a-z]*)/i)
  if (match === null) return new RegExp(source)
  try { return new RegExp(match[2], match[3]) } catch (error) {
    return new RegExp(source)
  }
}

function enabledFor(script, options) {
  if (!script || script.enabled === false) return false
  const placement = Number(options.placement === undefined ? 2 : options.placement)
  if (!Array.isArray(script.placement) || !script.placement.map(Number).includes(placement)) return false
  if (options.isMarkdown === true && script.promptOnly === true) return false
  if (options.isMarkdown !== true && script.markdownOnly === true) return false
  if (options.isEdit === true && script.runOnEdit !== true) return false
  const currentDepth = Number(options.depth) || 0
  const minimum = depth(script.minDepth)
  const maximum = depth(script.maxDepth)
  if (minimum !== null && currentDepth < minimum) return false
  if (maximum !== null && currentDepth > maximum) return false
  return true
}

function replacementFor(script) {
  const trims = Array.isArray(script.trimStrings) ? script.trimStrings.map(str).filter(Boolean) : []
  return function () {
    const args = Array.from(arguments)
    const match = str(args[0])
    let replacement = str(script.replaceString).replace(/\{\{match\}\}/gi, match)
    const tail = args.length > 0 && args.at(-1) !== null && typeof args.at(-1) === 'object' ? 3 : 2
    const captures = args.slice(1, args.length - tail).map(str)
    replacement = replacement.replace(/\$(\d{1,2})/g, function (token, digits) {
      const index = Number(digits)
      if (index >= 1 && index <= captures.length) return captures[index - 1]
      if (digits.length === 2) {
        const fallback = Number(digits[0])
        if (fallback >= 1 && fallback <= captures.length) return captures[fallback - 1] + digits[1]
      }
      return token
    })
    for (const trim of trims) replacement = replacement.split(trim).join('')
    return replacement
  }
}

function replaceAndCount(source, regex, replacement) {
  let count = 0
  const text = source.replace(regex, function () {
    count++
    return replacement.apply(null, arguments)
  })
  return { text, count }
}

/**
 * Apply character-card display regexes in their original array order.
 * `text` is the SillyTavern-compatible display projection. `bodyText` removes
 * every matched source segment so display markup never remains in story text.
 */
export function renderTavernRegexDisplay(value, scripts, options = {}) {
  const sourceText = str(value)
  let text = sourceText
  let bodyText = sourceText
  const warnings = []
  const applied = []
  const presentationParts = []

  function presentationToken(index) {
    return '\uE000DSH_TAVERN_REGEX_' + index + '\uE001'
  }

  function restorePresentationTokens(value) {
    return str(value).replace(/\uE000DSH_TAVERN_REGEX_(\d+)\uE001/g, function (token, index) {
      return presentationParts[Number(index)] || ''
    })
  }

  for (const [index, script] of (Array.isArray(scripts) ? scripts : []).entries()) {
    if (!enabledFor(script, options)) continue
    const label = str(script.name || script.id) || '正则 ' + (index + 1)
    try {
      const displayRegex = regexFromString(script.findRegex)
      const bodyRegex = regexFromString(script.findRegex)
      const buildReplacement = replacementFor(script)
      const displayed = replaceAndCount(text, displayRegex, function () {
        const replacement = buildReplacement.apply(null, arguments)
        const token = presentationToken(presentationParts.length)
        presentationParts.push(replacement)
        return token
      })
      if (displayed.count === 0) continue
      text = displayed.text
      bodyText = replaceAndCount(bodyText, bodyRegex, function () { return '' }).text
      applied.push({ index, id: str(script.id), name: label, matches: displayed.count })
    } catch (error) {
      warnings.push(label + '：' + str(error && error.message || error))
    }
  }

  if (applied.length > 0 && sourceText.trim() !== '' && bodyText.trim() === '') {
    warnings.push('显示正则覆盖了整轮正文，已忽略本轮展示结果')
    return {
      sourceText,
      text: sourceText,
      bodyText: sourceText,
      presentationText: '',
      changed: false,
      applied: [],
      warnings
    }
  }

  const presentationTokens = text.match(/\uE000DSH_TAVERN_REGEX_\d+\uE001/g) || []

  return {
    sourceText,
    text: restorePresentationTokens(text),
    bodyText,
    presentationText: presentationTokens.map(restorePresentationTokens).filter(Boolean).join('\n'),
    changed: applied.length > 0,
    applied,
    warnings
  }
}
