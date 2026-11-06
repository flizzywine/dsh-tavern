import { runTemplateCommand, templateCommandNames } from './host.js'

/** Read ST named arguments without splitting JavaScript bodies on spaces or pipes. */
export function parseTemplateCommand(source) {
  const match = String(source).trim().match(/^\/(ejs-refresh|ejs)(?=\s|$)\s*/)
  if (!match) return null
  let rest = String(source).trim().slice(match[0].length)
  const args = {}
  for (;;) {
    const named = rest.match(/^(ctx|block)=/)
    if (!named) break
    rest = rest.slice(named[0].length)
    let end = 0, quote = '', escaped = false, depth = 0
    for (; end < rest.length; end++) {
      const char = rest[end]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (quote) { if (char === quote) quote = ''; continue }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '{' || char === '[') depth++
      else if (char === '}' || char === ']') depth--
      if (/\s/.test(char) && !depth) break
    }
    if (quote || depth) throw new Error('命令参数未闭合')
    let value = rest.slice(0, end)
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    else if (value.startsWith('"')) value = JSON.parse(value)
    args[named[1]] = named[1] === 'block' ? !['false', '0', ''].includes(value) : value
    rest = rest.slice(end).trimStart()
  }
  return { name: match[1], args, value: rest }
}

export async function executeTemplateSlash(source, fallback) {
  const parsed = parseTemplateCommand(source)
  if (parsed && templateCommandNames().includes(parsed.name)) return { pipe: await runTemplateCommand(parsed.name, parsed.args, parsed.value) }
  if (fallback) return fallback(source)
  throw new Error('当前宿主没有注册这条命令：' + String(source).split(/\s/)[0])
}
