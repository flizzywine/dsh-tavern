import { spawn } from 'node:child_process'

// No shell interpolation; cancellation and the deadline cover every owned child.
export function clipProcess(command, args, {signal, input = false, timeoutMs = 120000, idleTimeoutMs = 30000, onProgress, onTime} = {}) {
  signal?.throwIfAborted()
  const child = spawn(command, args, {windowsHide:true,stdio:[input ? 'pipe' : 'ignore','pipe','pipe']})
  let stdout = '', stderr = '', failure, progressText = '', lastFrame = -1, lastTime = -1, idleTimer, endedAt
  const started=performance.now()
  const diagnostics=()=>({command,pid:child.pid,elapsedMs:(endedAt ?? performance.now())-started,lastFrame,lastTime,exitCode:child.exitCode,signalCode:child.signalCode,
    stdin:child.stdin&&{writableLength:child.stdin.writableLength,writableEnded:child.stdin.writableEnded,writableFinished:child.stdin.writableFinished,destroyed:child.stdin.destroyed},
    stdout:{bytes:child.stdout.bytesRead,readableLength:child.stdout.readableLength,paused:child.stdout.isPaused()},stderr:{bytes:child.stderr.bytesRead,readableLength:child.stderr.readableLength,paused:child.stderr.isPaused()}})
  const cap = (text, chunk) => (text + chunk.toString()).slice(-128 * 1024)
  const stop = error => {
    failure ||= error
    try { failure.processDiagnostics ||= {...diagnostics(),stdout:stdout.slice(-4000),stderr:stderr.slice(-8000)} }
    catch { /* Cancellation reasons can be immutable. */ }
    child.kill()
  }
  const touch = () => {
    clearTimeout(idleTimer)
    idleTimer=setTimeout(()=>stop(Object.assign(new Error(`编码器连续 ${Math.round(idleTimeoutMs/1000)} 秒没有进展，已终止并清理；请重试导出`),{code:'CLIP_PROGRESS_TIMEOUT'})),idleTimeoutMs)
  }
  child.stdout.on('data', chunk => {
    stdout = cap(stdout, chunk)
    if(!onProgress&&!onTime)return
    progressText += chunk.toString()
    let end
    while((end=progressText.indexOf('\n'))>=0){
      const line=progressText.slice(0,end).trim();progressText=progressText.slice(end+1)
      const [key,value]=line.split('='),number=Number(value)
      if(key==='frame' && number>lastFrame){lastFrame=number;touch();onProgress?.(number)}
      if(key==='out_time_us' && number>lastTime){lastTime=number;touch();onTime?.(number/1000000)}
    }
  })
  child.stderr.on('data', chunk => { stderr = cap(stderr, chunk) })
  const abort = () => stop(signal.reason || new DOMException('Cancelled', 'AbortError'))
  const timer = timeoutMs ? setTimeout(() => stop(new Error('导出子进程超过执行时限')), timeoutMs) : null
  if(input || onProgress || onTime)touch()
  signal?.addEventListener('abort', abort, {once:true})
  const done = new Promise((resolve, reject) => {
    child.once('error', error => {
      if (error.code === 'ENOENT') error.clipUserMessage = '片段导出需要 ffmpeg 和 ffprobe，请安装后重新导出'
      failure ||= error
    })
    child.once('close', code => {
      endedAt=performance.now()
      clearTimeout(timer);clearTimeout(idleTimer); signal?.removeEventListener('abort', abort)
      if (failure || code !== 0) reject(failure || new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`))
      else resolve({stdout,stderr})
    })
  })
  // A renderer can fail before awaiting the encoder; keep that failure handled until cleanup.
  done.catch(() => {})
  child.stdin?.on('error', error => { failure ||= error })
  return {child,done,stop,touch,diagnostics}
}

// Do not race every drain against the process-lifetime promise: the losing
// reactions retain async frame contexts (and their image buffers) until exit.
export function clipWrite(process, bytes) {
  const input=process.child.stdin
  if(input.destroyed)return Promise.reject(new Error('Video encoder input closed before its last frame'))
  if(input.write(bytes))return
  return new Promise((resolve,reject)=>{
    const clean=()=>{input.off('drain',drain);input.off('error',error);input.off('close',close)}
    const drain=()=>{clean();resolve()}
    const error=reason=>{clean();reject(reason)}
    const close=()=>error(new Error('Video encoder input closed before draining'))
    input.once('drain',drain);input.once('error',error);input.once('close',close)
  })
}

export async function clipRun(command, args, options) {
  return clipProcess(command, args, options).done
}
