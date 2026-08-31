function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isHostOwnedMvu(script) {
  return /^mvu$/i.test(str(script && script.name).trim()) || /MagicalAstrogy\/MagVarUpdate/i.test(str(script && script.content))
}

/** Select card-owned scripts that can run beside the Host-owned MVU core. */
export function projectTavernHelperScripts(helperScripts, savedVariables) {
  const variables = object(savedVariables) ? savedVariables : {}
  const scripts = []
  const diagnostics = []
  for (const source of Array.isArray(helperScripts) ? helperScripts : []) {
    const id = str(source && source.id).trim()
    const name = str(source && source.name).trim() || id
    if (!source || source.enabled === false || str(source.type) !== 'script' || id === '' || str(source.content).trim() === '') continue
    if (isHostOwnedMvu(source)) {
      diagnostics.push({ scriptId: id, name, status: 'host-owned', message: 'MVU 核心由 dsh-tavern 宿主运行，未重复执行人物卡远程 MVU bundle' })
      continue
    }
    const initial = Object.prototype.hasOwnProperty.call(variables, id) && object(variables[id])
      ? variables[id]
      : (object(source.data) ? source.data : {})
    scripts.push({
      id,
      name,
      content: str(source.content),
      data: clone(initial),
      buttons: clone(Array.isArray(source.buttons) ? source.buttons : []),
      info: str(source.info)
    })
  }
  return { scripts, diagnostics }
}

/** Ordinary card scripts do not require the MVU variable framework. */
export function hasTavernScriptRuntime(chat, helperScripts) {
  if (!chat || !chat.cardPath || !['story', 'script'].includes(chat.mode || 'story')) return false
  return chat.mvu?.enabled === true || projectTavernHelperScripts(helperScripts).scripts.length > 0
}
