// Observe transport timing and honor explicit cancellation. Provider silence has
// no Tavern deadline: queued requests and hidden reasoning can exceed 90 seconds.
// Background tasks keep their own independent liveness policy.
export function createModelStreamProgress({signal, now = Date.now} = {}) {
  const startedAt = now()
  let lastProgressAt = startedAt, firstOutputAt = null, phase = 'admission', failure
  let reject
  const stopped = new Promise((_, no) => { reject = no }); stopped.catch(() => {})
  function interrupt(error) {
    if (failure) return
    failure = error
    reject(error)
  }
  const abort = () => interrupt(Object.assign(new Error('模型请求已停止，未完成内容保留。'), {code:'MODEL_STREAM_ABORTED', phase}))
  signal?.addEventListener('abort', abort, {once:true})
  if (signal?.aborted) abort()
  return {
    wait: promise => Promise.race([promise, stopped]),
    provider() {phase = 'provider'; lastProgressAt = now()},
    chunk(chunk) {
      if ((['text-delta', 'reasoning-delta'].includes(chunk?.type) && chunk.text?.trim()) ||
        (chunk?.type === 'tool-call-delta' && chunk.argumentsDelta?.trim()) ||
        (chunk?.type === 'block-end' && (chunk.block?.text?.trim() || chunk.block?.type === 'tool-call'))) {
        firstOutputAt ??= now(); lastProgressAt = now()
      }
    },
    snapshot: () => ({phase, startedAt, firstOutputAt, lastProgressAt, idleTimeoutMs:null, interruption:failure?.code || null}),
    dispose() {signal?.removeEventListener('abort', abort)}
  }
}
