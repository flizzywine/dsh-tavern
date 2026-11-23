// Parameter names every model provider accepts: Anthropic rejects a request whose tool schema has any other
// property key (`^[a-zA-Z0-9_.-]{1,64}$`), and it rejects the whole request, so one plugin's tool would stop every
// game's turn. Checked once where a plugin hands Tavern a tool; the display name belongs in the description.
export const TOOL_PARAMETER_KEY = /^[a-zA-Z0-9_.-]{1,64}$/

// Values, not schemas: their objects may hold a `properties` key of their own.
const VALUE_KEYWORDS = new Set(['const', 'enum', 'default', 'examples', 'example'])

/** The first property key in a tool's parameters schema a provider would refuse, with its JSON path; null if none. */
export function invalidToolParameterKey(schema, path = 'parameters') {
  if (!schema || typeof schema !== 'object') return null
  if (Array.isArray(schema)) {
    for (let index = 0; index < schema.length; index++) {
      const found = invalidToolParameterKey(schema[index], path + '[' + index + ']')
      if (found) return found
    }
    return null
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (VALUE_KEYWORDS.has(keyword) || !value || typeof value !== 'object') continue
    if (keyword === 'properties' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (!TOOL_PARAMETER_KEY.test(key)) return { key, path: path + '.properties' }
        const found = invalidToolParameterKey(child, path + '.properties.' + key)
        if (found) return found
      }
      continue
    }
    const found = invalidToolParameterKey(value, path + '.' + keyword)
    if (found) return found
  }
  return null
}

/** Throws a fixable error naming the tool and the key when its parameters schema has a key a provider would refuse. */
export function assertToolParameterKeys(toolName, schema) {
  const found = invalidToolParameterKey(schema)
  if (!found) return
  throw new Error('工具 ' + toolName + ' 的参数名「' + found.key + '」（' + found.path + '）不合模型接口的命名规则：只能用英文字母、数字和 _ . -，1–64 个字符，否则 Claude 会拒绝整轮请求。请改成英文标识符，把中文名写进这个参数的 description。')
}
