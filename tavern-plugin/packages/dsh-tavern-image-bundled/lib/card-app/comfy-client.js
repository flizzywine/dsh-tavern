/**
 * ComfyUI 客户端（从 dsh-tavern-image 的实现抽出来，只跑导入的工作流）。
 *
 * 链路：/system_stats 探活 → /object_info 拉模型 → 取工作流 → POST /prompt
 *       → 轮询 /history/{id} → GET /view 取字节。
 *
 * 不做简单模式、参考图、作业恢复；这些留在 dsh-tavern-image。
 */
import { randomUUID } from 'node:crypto'
import { applyWorkflowBindings } from './workflow-import.js'

const DEFAULT_TIMEOUT = 600_000
const POLL_INTERVAL = 1500

/** 按配置生成 ComfyUI 的鉴权头。 */
export function comfyHeaders(config) {
  const mode = String(config?.comfyAuthMode ?? 'none')
  if (mode === 'bearer' && config?.comfyAuthToken) return { authorization: 'Bearer ' + String(config.comfyAuthToken) }
  if (mode === 'basic' && config?.comfyAuthUser) {
    const raw = String(config.comfyAuthUser) + ':' + String(config.comfyAuthPass ?? '')
    return { authorization: 'Basic ' + Buffer.from(raw, 'utf8').toString('base64') }
  }
  return {}
}

/** 规整地址：只接受干净的 HTTP(S) 根地址。 */
export function comfyBase(config) {
  const raw = String(config?.comfyUrl || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '')
  let url
  try { url = new URL(raw) } catch { throw new Error('ComfyUI 地址必须是完整的 http:// 或 https:// 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('ComfyUI 地址必须是干净的 HTTP(S) 服务地址')
  }
  return raw
}

/** 按文件头判断图片类型，服务声明的 content-type 只作为兜底。 */
function detectImage(bytes, declared = '') {
  const type = String(declared).split(';')[0].trim().toLowerCase()
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif'
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return type
  throw new Error('ComfyUI 返回的数据不是受支持的图片')
}

async function comfyJson(config, path, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController()
  const abort = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs)
  try {
    const response = await fetch(comfyBase(config) + path, {
      ...init,
      signal: controller.signal,
      headers: { ...comfyHeaders(config), ...(init.headers || {}) },
    })
    const text = await response.text()
    let value = null
    try { value = text ? JSON.parse(text) : null } catch { /* 下面统一处理 */ }
    if (!response.ok) {
      const raw = value?.error?.message || value?.error || text.slice(0, 300) || `HTTP ${response.status}`
      const error = new Error(`ComfyUI ${path} → HTTP ${response.status}：${typeof raw === 'string' ? raw : JSON.stringify(raw)}`)
      error.statusCode = response.status
      throw error
    }
    if (text && value === null) throw new Error('ComfyUI 返回了无效 JSON')
    return value
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}

/** 探活 + 拉可用模型（设置页的「测试连接」和 LoRA 列表都走它）。 */
export async function comfyState(config, { signal } = {}) {
  const started = Date.now()
  try {
    const stats = await comfyJson(config, '/system_stats', { signal }, 8000)
    const objectInfo = await comfyJson(config, '/object_info', { signal }, 20_000).catch(() => ({}))
    const choices = (node, input) => {
      const entry = objectInfo?.[node]?.input?.required?.[input] ?? objectInfo?.[node]?.input?.optional?.[input]
      return Array.isArray(entry?.[0]) ? entry[0].map(String) : []
    }
    const loras = choices('LoraLoader', 'lora_name')
    return {
      ok: true,
      ms: Date.now() - started,
      version: String(stats?.system?.comfyui_version ?? stats?.system?.comfy_version ?? ''),
      checkpoints: choices('CheckpointLoaderSimple', 'ckpt_name'),
      loras: loras.length ? loras : choices('LoraLoaderModelOnly', 'lora_name'),
      samplers: choices('KSampler', 'sampler_name'),
      schedulers: choices('KSampler', 'scheduler'),
    }
  } catch (error) {
    return { ok: false, url: String(config?.comfyUrl ?? ''), ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 400) }
  }
}

function findOutputImage(history) {
  for (const output of Object.values(history?.outputs ?? {})) {
    const images = Array.isArray(output?.images) ? output.images : []
    if (images[0]?.filename) return images[0]
  }
  return null
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('已取消'))
    const timer = setTimeout(done, ms)
    function done() { signal?.removeEventListener('abort', abort); resolve() }
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new Error('已取消')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 出图。request: { positive, negative, width, height, sampler?, steps?, cfg?, seed? }
 * 返回 { bytes, mediaType }。
 */
export async function comfyGenerate(config, request = {}, { signal, maxImageBytes = 32 * 1024 * 1024, workflow = null } = {}) {
  if (!workflow) throw new Error('还没有可用的 ComfyUI 工作流，先在设置页导入一张')
  // 只覆盖识别出来的槽位，其余节点保持原样。
  const prompt = applyWorkflowBindings(workflow, {
    positive: request.positive,
    negative: request.negative,
    width: request.width,
    height: request.height,
    steps: request.steps,
    cfg: request.cfg,
    sampler: request.sampler,
    seed: request.seed,
  })
  const outputNode = String(workflow.outputNode ?? '')

  const submitted = await comfyJson(config, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: randomUUID() }),
    signal,
  }, 60_000)
  const promptId = submitted?.prompt_id
  if (!promptId) throw new Error('ComfyUI 没有返回任务编号')

  const timeout = Number(config?.comfyTimeoutMs) > 0 ? Number(config.comfyTimeoutMs) : DEFAULT_TIMEOUT
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await wait(POLL_INTERVAL, signal)
    let history = null
    try { history = await comfyJson(config, `/history/${encodeURIComponent(promptId)}`, { signal }, 20_000) }
    catch (error) { if (error.statusCode !== 404) throw error }
    const hit = history?.[promptId]
    if (!hit) continue
    if (hit.status?.status_str === 'error') {
      const detail = (hit.status?.messages ?? [])
        .map(item => (Array.isArray(item) ? item[1]?.exception_message || item[0] : ''))
        .filter(Boolean)
        .join('；')
      throw new Error('ComfyUI 出图失败：' + (detail || '工作流执行报错'))
    }
    const image = (outputNode && hit.outputs?.[outputNode]?.images?.[0]) || findOutputImage(hit)
    if (!image) continue
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    })
    const response = await fetch(comfyBase(config) + '/view?' + params, { headers: comfyHeaders(config), signal })
    if (!response.ok) throw new Error('ComfyUI /view → HTTP ' + response.status)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error('ComfyUI 返回了空图片')
    if (bytes.length > maxImageBytes) throw new Error('图片超过大小上限')
    return { bytes, mediaType: detectImage(bytes, response.headers.get('content-type') || '') }
  }
  throw new Error('ComfyUI 出图等待超时')
}
