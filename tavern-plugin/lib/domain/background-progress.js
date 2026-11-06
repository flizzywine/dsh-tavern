/** Model liveness is measured from actual output, never UI heartbeats. */
export function createBackgroundProgress({idleMs=300000, now=Date.now, onCancel=()=>{}}={}) {
  const controller=new AbortController(), startedAt=now()
  let phase='preparing', lastProgressAt=startedAt, timer, attempt, closed=false, failure
  let reject
  const interrupted=new Promise((_,no)=>{reject=no}); interrupted.catch(()=>{})
  function stop(error) {
    if(closed || failure) return
    failure=error; clearTimeout(timer); controller.abort(error)
    reject(error)
    try { onCancel() } catch { /* The caller still receives the interruption. */ }
  }
  function arm() {
    clearTimeout(timer)
    if(closed || failure || phase!=='model') return
    timer=setTimeout(()=>stop(Object.assign(new Error('后台模型连续 '+Math.round(idleMs/60000)+' 分钟没有有效输出，已停止等待。已生成的正文保留，请检查 API 或切换模型后重试。'),{code:'BACKGROUND_MODEL_IDLE_TIMEOUT'})),Math.max(0,lastProgressAt+idleMs-now()))
    timer.unref?.()
  }
  return {
    signal:controller.signal,
    frame(frame) {
      if(closed || failure) return
      if(frame.type==='start') {attempt=frame.attemptId;if(phase!=='model') lastProgressAt=now();phase='model';arm();return}
      if(frame.attemptId!==attempt) return
      if(frame.type==='end') {phase='tool';clearTimeout(timer);return}
      const c=frame.chunk
      if(frame.type==='chunk' && c && (
        (['text-delta','reasoning-delta'].includes(c.type) && typeof c.text==='string' && c.text.trim()) ||
        (c.type==='tool-call-delta' && typeof c.argumentsDelta==='string' && c.argumentsDelta.trim()) ||
        (c.type==='block-end' && (c.block?.text?.trim() || c.block?.type==='tool-call')))) {lastProgressAt=now();arm()}
    },
    snapshot:()=>({phase,startedAt,lastProgressAt,idleTimeoutMs:idleMs}),
    wait:promise=>Promise.race([promise,interrupted]),
    cancel:()=>stop(Object.assign(new Error('后台任务已停止；已生成的正文保留，可重新结算。'),{code:'BACKGROUND_CANCELLED'})),
    dispose(){closed=true;clearTimeout(timer)}
  }
}
