// Bound transport silence, including providers that ignore cancellation. No retry.
export const MODEL_STREAM_IDLE_MS = 90000
export function createModelStreamProgress({signal, idleMs = MODEL_STREAM_IDLE_MS, now = Date.now, onInterrupt = () => {}} = {}) {
  const startedAt = now()
  let lastProgressAt = startedAt, firstOutputAt = null, phase = 'admission', timer, failure
  let reject
  const stopped = new Promise((_, no) => { reject = no }); stopped.catch(() => {})
  function interrupt(error) {
    if (failure) return
    failure = error
    clearTimeout(timer)
    reject(error)
    try { onInterrupt(error) } catch { /* Cancellation failure must not suppress the timeout receipt. */ }
  }
  function arm() {
    clearTimeout(timer)
    timer = setTimeout(() => interrupt(Object.assign(new Error('模型连续 ' + Math.ceil(idleMs / 1000) + ' 秒没有有效输出，已中断；请检查 API 后手动重试。'), {
      code: 'MODEL_STREAM_IDLE_TIMEOUT', phase
    })), Math.max(0, lastProgressAt + idleMs - now()))
    timer.unref?.()
  }
  const abort = () => interrupt(Object.assign(new Error('模型请求已停止，未完成内容保留。'), {code:'MODEL_STREAM_ABORTED', phase}))
  signal?.addEventListener('abort', abort, {once:true})
  if (signal?.aborted) abort()
  else arm()
  return {
    wait: promise => Promise.race([promise, stopped]),
    provider() {phase = 'provider'; lastProgressAt = now(); arm()},
    chunk(chunk) {
      if ((['text-delta', 'reasoning-delta'].includes(chunk?.type) && chunk.text?.trim()) ||
        (chunk?.type === 'tool-call-delta' && chunk.argumentsDelta?.trim()) ||
        (chunk?.type === 'block-end' && (chunk.block?.text?.trim() || chunk.block?.type === 'tool-call'))) {
        firstOutputAt ??= now(); lastProgressAt = now(); arm()
      }
    },
    snapshot: () => ({phase, startedAt, firstOutputAt, lastProgressAt, idleTimeoutMs:idleMs, interruption:failure?.code || null}),
    dispose() {clearTimeout(timer); signal?.removeEventListener('abort', abort)}
  }
}
