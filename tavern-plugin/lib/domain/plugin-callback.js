/** A plugin callback, bounded in time: a hung plugin must never hold up a turn. */
export function bounded(promise, label, ms = 30000) {
  let timer
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' 超过 ' + ms / 1000 + ' 秒未返回')), ms)
  })]).finally(() => clearTimeout(timer))
}

export function untilAborted(promise, signal) {
  let abort
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })]).finally(() => signal.removeEventListener('abort', abort))
}

