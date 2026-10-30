// the llm hook and offline story transport share this narrow observer.
// Director errors never escape into the foreground stream.
export function createForegroundStageStream({begin, signal, warn = () => {}}) {
  let stream, text = '', cancelled = false, discarded = false
  const cancel = () => {cancelled = true; try {stream?.cancel()} catch (error) {warn(error)}}
  const discard = () => {discarded = true; try {stream?.discard()} catch (error) {cancel();warn(error)}}
  signal?.addEventListener('abort',cancel,{once:true})
  const ready = Promise.resolve().then(begin).then(value => {
    stream = value
    if (cancelled || signal?.aborted) cancel()
    else if (discarded) discard()
    else if (text) stream?.update(text)
  }).catch(error => warn(error))
  return {ready,
    append(delta) {
      text += delta
      if (!cancelled && !discarded) try {stream?.update(text)} catch (error) {cancel();warn(error)}
    },
    discard,
    finish(completed) {if (!completed) cancel();signal?.removeEventListener('abort',cancel)},
    cancel}
}
