// Export has no navigation after mounting. Unlike a browser test clock, it needs
// neither an ever-growing init-script log nor a clamped native timeout per callback.
export function installClipTime({epoch,fps=60}) {
  const frameMs=1000/fps
  let now = 1000, sequence = 0, ticking = false
  const timers = new Map(), NativeDate = Date
  const channel = new MessageChannel(), tasks = []
  channel.port1.onmessage = () => tasks.shift()?.()
  const yieldTask = () => new Promise(resolve => {tasks.push(resolve);channel.port2.postMessage(0)})
  function ClockDate(...args) {
    if (!new.target) return new NativeDate(epoch + now).toString()
    return new NativeDate(...(args.length ? args : [epoch + now]))
  }
  Object.setPrototypeOf(ClockDate, NativeDate)
  ClockDate.prototype = NativeDate.prototype
  ClockDate.now = () => epoch + now
  window.Date = ClockDate
  Object.defineProperty(performance, 'now', {configurable:true,value:() => now})
  Object.defineProperty(performance, 'timeOrigin', {configurable:true,value:epoch})
  function schedule(fn, delay, args, interval = false, raf = false) {
    const id = ++sequence
    delay = Math.max(interval || ticking ? 1 : 0, Number(delay) || 0)
    timers.set(id, {id,fn,args,at:now + delay,interval:interval ? delay : 0,raf})
    return id
  }
  window.setTimeout = (fn, delay, ...args) => schedule(fn, delay, args)
  window.setInterval = (fn, delay, ...args) => schedule(fn, delay, args, true)
  window.clearTimeout = window.clearInterval = id => timers.delete(id)
  // An offline 30fps target needs one animation render per output frame, not
  // two invisible 60fps GPU draws. Timers still dispatch at every due timestamp.
  window.requestAnimationFrame = fn => {
    let tick=Math.floor(now/frameMs)+1
    if(Math.round(tick*frameMs)<=now)tick++
    return schedule(fn,Math.round(tick*frameMs)-now,[],false,true)
  }
  window.cancelAnimationFrame = id => timers.delete(id)
  window.requestIdleCallback = (fn, options) => schedule(fn, Math.min(options?.timeout ?? 50, 50), [{didTimeout:false,timeRemaining:() => 0}])
  window.cancelIdleCallback = id => timers.delete(id)
  window.clipAdvance = async delta => {
    const end = now + delta
    if (delta < 0) throw new Error('Export clock cannot move backwards')
    let count = 0
    while (true) {
      let next
      for (const timer of timers.values()) if (timer.at <= end && (!next || timer.at < next.at || timer.at === next.at && timer.id < next.id)) next = timer
      if (!next) break
      if (++count > 100000) throw new Error('舞台定时器无法推进，请重试导出')
      now = next.at
      if (next.interval) next.at += next.interval
      else timers.delete(next.id)
      ticking = true
      try {
        if (typeof next.fn === 'function') next.fn(...(next.raf ? [now] : next.args))
        else (0,eval)(String(next.fn))
        // Let React's MessageChannel commits and promise continuations run at
        // this timestamp, without the browser's nested setTimeout 4ms clamp.
        await yieldTask()
      } finally {ticking = false}
    }
    now = end
    await yieldTask()
  }
}
