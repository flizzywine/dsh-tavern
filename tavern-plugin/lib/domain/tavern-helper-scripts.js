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
      // Some exported cards wrap executable source in a Markdown code fence.
      // Only unwrap a single complete JavaScript block, preserving its body.
      content: str(source.content).replace(/^\s*```(?:javascript|js)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/i, '$1'),
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

// 脚本级分派（proposal-card-runtime-full.md A.2）：改变状态的脚本进服务端沙箱，
// 操作 DOM 的 UI 脚本下发浏览器执行器。esm 型待模块系统（T2）处理，暂单独归类。
const DOM_TOKENS = /\b(document\s*\.|querySelector(?:All)?|getElementById|getElementsByClassName|createElement|createTextNode|innerHTML|outerHTML|insertAdjacentHTML|addEventListener|classList|getComputedStyle|matchMedia)\b/

export function classifyCardScript(code) {
  const src = str(code)
  if (src.trim() === '') return 'empty'
  if (/^\s*(import[\s{("']|export\s)/.test(src) || /\bimport\s*\(/.test(src)) return 'esm'
  if (DOM_TOKENS.test(src)) return 'browser-ui'
  return 'server-compute'
}
