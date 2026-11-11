import { Worker } from 'node:worker_threads'
import { projectPluginReply, projectProcessedReply } from './reply-presentation.js'

const MAX_BYTES = 1024 * 1024
let active = 0

export function copyPluginRegexScripts(value) {
  if (!Array.isArray(value) || value.length > 256) throw new TypeError('regexScripts 必须是最多 256 条规则的数组')
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json) > MAX_BYTES) throw new TypeError('regexScripts 不能超过 1 MiB')
  const scripts = JSON.parse(json)
  for (const rule of scripts) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.findRegex !== 'string'
      || typeof rule.replaceString !== 'string' || !Array.isArray(rule.placement)
      || !rule.placement.every(value => Number.isInteger(value))) throw new TypeError('正则规则需要 findRegex、replaceString 和整数 placement 数组')
  }
  return scripts
}

function run(op, input) {
  if (active >= 4) return Promise.reject(new Error('ST 字符串服务正忙，请稍后重试'))
  active++
  return new Promise((resolve, reject) => {
    let worker, timer, done = false
    const finish = (error, result) => {
      if (done) return
      done = true
      active--
      clearTimeout(timer)
      void worker?.terminate()
      error ? reject(error) : resolve(result)
    }
    try {
      worker = new Worker(new URL('./st-contract-worker.js', import.meta.url), {
        workerData: { op, input }, resourceLimits: { maxOldGenerationSizeMb: 64 },
      })
      timer = setTimeout(() => finish(new Error('ST 字符串处理超过 2 秒')), 2000)
      worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.result))
      worker.once('error', () => finish(new Error('ST 字符串处理失败')))
      worker.once('exit', () => finish(new Error('ST 字符串处理未完成')))
    } catch (error) { finish(error) }
  })
}

function textInput(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new TypeError('text 必须是最多 200000 字符的字符串')
  return text
}

export const tavernStContract = Object.freeze({
  async applyRegex({ text, regexScripts, placement = 2, depth = 0, channel, isEdit = false } = {}) {
    if (!['prompt', 'display'].includes(channel)) throw new TypeError('channel 必须为 prompt 或 display')
    if (!Number.isInteger(placement) || !Number.isFinite(depth) || depth < 0 || typeof isEdit !== 'boolean') throw new TypeError('placement、depth 或 isEdit 无效')
    return run('regex', { text: textInput(text), regexScripts: copyPluginRegexScripts(regexScripts), placement, depth, channel, isEdit })
  },
  async renderMacros({ text, env = {}, allowScript = false } = {}) {
    if (allowScript !== false) throw new TypeError('字符串服务不执行脚本，allowScript 必须为 false')
    if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env 必须为对象')
    const json = JSON.stringify(env)
    if (Buffer.byteLength(json) > MAX_BYTES) throw new TypeError('env 不能超过 1 MiB')
    return run('macros', { text: textInput(text), env: JSON.parse(json) })
  },
})

/** Optional projection failure must never discard an already generated body. */
export async function projectPluginBody(text, options = {}) {
  if (options.pluginRegexScripts === undefined && !options.projectionWarning) return projectPluginReply(text, options)
  try {
    if (options.projectionWarning) throw new Error(options.projectionWarning)
    const result = await run('projection', { text: textInput(text), hostRegex: options.hostRegex === true,
      regexScripts: options.regexScripts || [], pluginRegexScripts: copyPluginRegexScripts(options.pluginRegexScripts) })
    if (!result.sessionText.trim()) throw new Error('插件投影后的模型上下文为空')
    return result
  } catch {
    const result = projectProcessedReply(text)
    const warning = '插件正文投影失败（规则无效、超限或处理超时），已保留原文'
    result.warnings.push(warning)
    console.warn('dsh-tavern: ' + warning)
    return result
  }
}
