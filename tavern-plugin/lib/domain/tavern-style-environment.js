function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function normalizeTavernStyleEnvironment(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const variables = source.themeVariables && typeof source.themeVariables === 'object' && !Array.isArray(source.themeVariables) ? source.themeVariables : {}
  const themeVariables = {}
  for (const key of Object.keys(variables).slice(0, 128)) {
    if (!/^--[A-Za-z0-9_-]+$/.test(key)) continue
    themeVariables[key] = str(variables[key]).slice(0, 2048)
  }
  const extensionStyles = []
  for (const item of Array.isArray(source.extensionStyles) ? source.extensionStyles : []) {
    const url = str(item).trim()
    if (!/^https:\/\//i.test(url) || extensionStyles.includes(url)) continue
    extensionStyles.push(url.slice(0, 4096))
    if (extensionStyles.length >= 64) break
  }
  return {
    themeVariables,
    customCss: str(source.customCss).slice(0, 256 * 1024),
    extensionStyles
  }
}
