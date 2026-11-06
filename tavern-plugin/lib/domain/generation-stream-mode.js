// User-facing generation delivery mode for every provider and model in the profile.
// Streaming stays the default; a non-streaming request is dispatched with `stream:
// false` for adapters that support it and is buffered at the common chunk boundary,
// so adapters that only stream still present one settled reply.
export const GENERATION_STREAM_MODE_FILE = 'generation-stream-mode.json'

export function createGenerationStreamModeStore(profileData, file = GENERATION_STREAM_MODE_FILE) {
  let current
  let loading
  let writes = Promise.resolve()
  async function read() {
    if (current !== undefined) return current
    loading ??= profileData.readJson(file).then(value => {
      current = { stream: value?.stream !== false }
      return current
    }).catch(error => { loading = undefined; throw error })
    return loading
  }
  return Object.freeze({
    async get() { return (await read()).stream },
    async set(stream) {
      if (typeof stream !== 'boolean') throw new TypeError('流式设置必须为布尔值')
      const operation = writes.then(async () => {
        const previous = await read()
        current = { stream }
        try { await profileData.writeJson(file, current) }
        catch (error) { current = previous; throw error }
        return stream
      })
      writes = operation.catch(() => {})
      return operation
    },
  })
}

/** Buffer only the selected requests; the normal path retains token-by-token delivery. */
export async function* bufferNonStreaming(events) {
  const chunks = []
  for await (const chunk of events) chunks.push(chunk)
  for (const chunk of chunks) yield chunk
}

export function installGenerationStreamModeHook(ctx, readMode) {
  return ctx.on('llm/stream', (request, next) => {
    // The re-dispatched request already carries the adapter-facing flag. Do not
    // redispatch it a second time; buffer the downstream chunks at this boundary.
    if (request?.stream === false) return bufferNonStreaming(next())
    if (request?.purpose !== undefined) return next()
    return (async function * () {
      if (await readMode(request) !== false) { yield * next(); return }
      yield * ctx.llm.stream({ ...request, stream: false })
    })()
  }, { global: true, prepend: true })
}
