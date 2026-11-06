import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

// Seconds at the environment boundary; use a monotonic deadline internally.
// A cold first start (fresh install or update) can take well over 30 seconds on
// Windows. The deadline only catches a hung service; an exited one fails at once.
export function startupTimeoutMs(host, value = process.env.DSH_TAVERN_START_TIMEOUT) {
  if (value === undefined || value === '') return 120000
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new Error('DSH_TAVERN_START_TIMEOUT 必须为 0 到 86400 之间的正数（秒）')
  return seconds * 1000
}

export async function waitForServiceStartup(options) {
  const now = options.now || (() => performance.now())
  const pause = options.sleep || sleep
  const started = now()
  const deadline = started + options.timeoutMs
  let slow = false
  try {
    while (now() < deadline) {
      if (!options.alive()) throw new Error('DSH Tavern 启动进程已退出')
      if (await options.ready()) return
      if (!slow && now() - started >= 15000) { slow = true; options.onSlow?.() }
      await pause(Math.min(200, Math.max(0, deadline - now())))
    }
    throw new Error(`DSH Tavern 启动超时（${options.timeoutMs / 1000} 秒）`)
  } catch (error) {
    try { await options.stop() }
    catch (cleanupError) { throw new Error(`${error.message}；启动进程清理失败：${cleanupError.message}。必须保留源码，不能回滚。`, { cause: error }) }
    throw error
  }
}

// Only the ChildProcess created by this start attempt is eligible for cleanup.
export async function stopStartupChild(child) {
  const exited = () => child.exitCode !== null || child.signalCode !== null
  if (exited()) return
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    child.kill(signal)
    const deadline = performance.now() + 5000
    while (!exited() && performance.now() < deadline) await sleep(50)
    if (exited()) return
  }
  throw new Error(`PID ${child.pid} 尚未退出`)
}
