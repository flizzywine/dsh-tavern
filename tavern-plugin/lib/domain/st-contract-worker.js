import { parentPort, workerData } from 'node:worker_threads'
import { createTavernRegexEngine } from './tavern-regex-engine.js'

const { regexFromString, applyTavernRegexText } = createTavernRegexEngine()
try {
  const { op, input } = workerData
  for (const rule of input.pluginRegexScripts || input.regexScripts || []) regexFromString(rule.findRegex)
  let result
  if (op === 'regex') {
    result = applyTavernRegexText(input.text, input.regexScripts, {
      placement: input.placement, depth: input.depth, isEdit: input.isEdit, isMarkdown: input.channel === 'display',
    })
  } else if (op === 'macros') {
    const { renderTavernMacros } = await import('./tavern-macro-engine.js')
    result = renderTavernMacros(input.text, input.env)
  } else if (op === 'projection') {
    const { projectPluginReply } = await import('./reply-presentation.js')
    result = projectPluginReply(input.text, input)
    if (result.warnings.length) throw new Error('正文投影出现错误')
  } else throw new Error('未知字符串操作')
  if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new Error('字符串处理结果超过 2 MiB')
  parentPort.postMessage({ result })
} catch {
  parentPort.postMessage({ error: 'ST 字符串处理失败：规则无效或结果超限' })
}
