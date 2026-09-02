import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { channelSettings, channelReady } from './scene-image-channels.js'
import { compileComfyWorkflow } from './scene-image-comfy-workflow.js'

const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const opaqueId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)

/** One submitted job, then read-only reconciliation. Persist before dispatch:
 * ComfyUI accepts client IDs but does not promise idempotent POST /prompt. */
export async function generateComfyImage(input, deps) {
  const config = channelSettings(input)
  if (!channelReady(config, input.apiKey)) throw new Error('请先配置 ComfyUI 地址、工作流与必要认证')
  const request = deps.fetch || fetch, maxBytes = input.maxBytes || 20 * 1024 * 1024
  const headers = {}
  if (config.authType === 'basic') headers.authorization = 'Basic ' + Buffer.from(config.username + ':' + input.apiKey).toString('base64')
  if (config.authType === 'bearer') headers.authorization = 'Bearer ' + input.apiKey
  const endpoint = path => new URL(path, config.baseURL.replace(/\/+$/, '') + '/').href
  async function json(path, body) {
    const response = await request(endpoint(path), { method: body ? 'POST' : 'GET', redirect: 'error', signal: input.signal, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!response.ok) {
      await response.body?.cancel()
      const error = new Error('ComfyUI 请求失败（HTTP ' + response.status + '）')
      error.status = response.status
      throw error
    }
    const bytes = await deps.readBytes(response, 2 * 1024 * 1024)
    try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error('ComfyUI 未返回有效 JSON') }
  }
  let task = input.providerTask
  const saveTask = async update => { task = { ...task, ...update }; await input.onProviderTask?.(structuredClone(task)) }
  if (task) {
    if (task.provider !== 'comfyui' || !opaqueId(task.promptId) || task.baseURL !== config.baseURL || task.workflowDigest !== config.workflow.digest || task.outputNode !== config.workflow.outputNode) throw new Error('原 ComfyUI 任务与当前配置不匹配，请恢复原配置后查询')
  } else {
    const compiled = compileComfyWorkflow(config.workflow, input.prompt)
    task = { provider: 'comfyui', promptId: randomUUID(), clientId: randomUUID(), baseURL: config.baseURL, workflowDigest: compiled.digest, outputNode: compiled.outputNode, state: 'submitting', ...(compiled.seed === undefined ? {} : { seed: compiled.seed }) }
    await saveTask({})
    let response
    try { response = await json('prompt', { prompt: compiled.prompt, prompt_id: task.promptId, client_id: task.clientId }) }
    catch (error) {
      // Explicit request rejection is distinct from a connection lost after
      // submission. Unknown acceptance is never retried as a paid POST.
      if ([400, 401, 402, 403, 404, 422].includes(error.status)) await saveTask({ state: 'rejected' })
      throw error
    }
    if (response?.error || !opaqueId(response?.prompt_id)) {
      if (response?.error) await saveTask({ state: 'rejected' })
      throw new Error('ComfyUI 未确认任务，请检查工作流节点与服务配置；不会自动重新提交')
    }
    await saveTask({ promptId: response.prompt_id, state: 'pending' })
  }
  for (;;) {
    input.signal?.throwIfAborted()
    const history = await json('history/' + encodeURIComponent(task.promptId))
    const result = history?.[task.promptId]
    if (result) {
      if (result.status?.status_str === 'error') {
        await saveTask({ state: 'failed' })
        throw new Error('ComfyUI 执行失败或被中止，请检查工作流与服务器日志')
      }
      if (result.status?.completed === true || result.status?.status_str === 'success') {
        const images = result.outputs?.[task.outputNode]?.images
        if (!Array.isArray(images) || images.length !== 1) {
          await saveTask({ state: 'failed' })
          throw new Error('ComfyUI 工作流未在指定输出返回唯一图片，请使用单图模板')
        }
        const image = images[0]
        if (typeof image.filename !== 'string' || image.filename.length > 256 || /[\\/\0]/.test(image.filename) || !image.filename || !['output', 'temp'].includes(image.type) || typeof image.subfolder !== 'string' || image.subfolder.length > 1024 || /[\\\0]/.test(image.subfolder) || image.subfolder.startsWith('/') || image.subfolder.split('/').includes('..')) throw new Error('ComfyUI 图片位置不合法')
        const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })
        // This is the configured service's /view, not a provider-supplied URL.
        // Authentication is needed here; redirects remain forbidden.
        const response = await request(endpoint('view?' + params), { headers, signal: input.signal, redirect: 'error' })
        if (!response.ok) { await response.body?.cancel(); throw new Error('ComfyUI 图片读取失败（HTTP ' + response.status + '）') }
        const imageData = deps.decodeImage(await deps.readBytes(response, maxBytes), maxBytes)
        await saveTask({ state: 'succeeded', image: { filename: image.filename, subfolder: image.subfolder, type: image.type } })
        return { ...imageData, metadata: { promptId: task.promptId, workflowDigest: task.workflowDigest, ...(task.seed === undefined ? {} : { seed: task.seed }) } }
      }
    }
    // Query only this task. A missing history row is not proof that it failed.
    // Queue may be empty after history cleanup or an uncertain submission.
    if (task.state === 'submitting' && uuid(task.promptId)) {
      const queue = await json('queue')
      const pending = [...(Array.isArray(queue?.queue_running) ? queue.queue_running : []), ...(Array.isArray(queue?.queue_pending) ? queue.queue_pending : [])]
      const entry = pending.find(item => Array.isArray(item) && (item[1] === task.promptId || item[3]?.client_id === task.clientId))
      if (entry && opaqueId(entry[1])) await saveTask({ promptId: entry[1], state: 'pending' })
      else throw new Error('ComfyUI 原任务结果未确认，服务可能已接单；不会重新提交，请稍后查询或检查服务器历史')
    }
    await (deps.wait || (ms => delay(ms, undefined, { signal: input.signal })))(1000)
  }
}
