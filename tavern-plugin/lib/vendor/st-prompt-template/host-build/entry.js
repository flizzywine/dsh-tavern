// Dedicated frames do not inherit the Android host's JavaScript polyfills.
import 'core-js/actual/index.js'
import { createNativeTemplateConnection } from './native-connection.js'
import { createTemplateSessionTasks } from './session-tasks.js'
import { configureTemplateHost, refreshTemplateSnapshot, disposeTemplateHost, eventSource, runTemplateCommand, templateCommandNames } from './host.js'

/** This must be loaded in a dedicated disposable frame, once per session. */
export async function initializeTemplatePlugin({ snapshot, callbacks, libraries }) {
  // The upstream worker URL is fixed to ST's extension directory.
  const NativeWorker = globalThis.Worker
  if (!NativeWorker.templateHost) {
    class TemplateWorker extends NativeWorker {
      static templateHost = true
      constructor(url, options) {
        super(String(url) === '/scripts/extensions/third-party/ST-Prompt-Template/dist/ejs.workers.js'
          ? new URL('ejs.workers.js', __webpack_public_path__) : url, options)
      }
    }
    globalThis.Worker = TemplateWorker
  }
  configureTemplateHost(snapshot, callbacks, libraries)
  const initialized = []
  try {
    const { modules } = await import('./upstream-entry.js')
    for (const module of modules) { initialized.push(module); await module.init() }
    if (!globalThis.EjsTemplate?.evalTemplate) throw new Error('Official template exports did not initialize')
    const { createTemplateLifecycle } = await import('./lifecycle.js')
    const synchronize = createTemplateLifecycle()
    let disposed = false
    let tail = Promise.resolve()
    const run = action => {
      const pending = tail.then(() => {
        if (disposed) throw new Error('Template instance disposed')
        return action()
      })
      tail = pending.catch(() => {})
      return pending
    }
    return {
      version: '1.17.9',
      synchronize: (snapshot, changes) => run(() => synchronize(snapshot, changes)),
      project: (operation, input) => run(async () => (await import('./projection.js')).projectTemplate(operation, input)),
      refresh: snapshot => run(() => refreshTemplateSnapshot(snapshot)),
      api: globalThis.EjsTemplate,
      commands: templateCommandNames(),
      emit: (...args) => run(() => eventSource.emit(...args)),
      command: (...args) => run(() => runTemplateCommand(...args)),
      processChatCompletion: ({ messages, type = 'normal' }) => run(async () => {
        if (!Array.isArray(messages) || !messages.length) throw new TypeError('Template request requires messages')
        const request = { messages: structuredClone(messages), type }
        await eventSource.emit('GENERATION_AFTER_COMMANDS', type, {}, false)
        await eventSource.emit('CHAT_COMPLETION_SETTINGS_READY', request)
        return request
      }),
      async dispose() {
        if (disposed) return
        disposed = true
        await tail
        try { for (const module of initialized.reverse()) await module.exit() } finally { disposeTemplateHost() }
      }
    }
  } catch (error) {
    for (const module of initialized.reverse()) { try { await module.exit() } catch {} }
    disposeTemplateHost()
    throw error
  }
}

/** Connect the official plugin to DSH's versioned native state APIs. */
export async function connectTemplateSession({ sessionId, rpc, services, settingsHtml, libraries, runtimeId }) {
  const connection = await createNativeTemplateConnection({ sessionId, rpc, services, settingsHtml })
  const plugin = await initializeTemplatePlugin({ ...connection, libraries })
  const dispatch = {
    claim: () => rpc('claimFullTemplateWork', { runtimeId, ready: true }),
    start: work => rpc('startFullTemplateWork', { runtimeId, eventId: work.event.id, leaseToken: work.leaseToken }),
    complete: (work, receipt) => rpc('completeFullTemplateWork', { runtimeId, eventId: work.event.id, leaseToken: work.leaseToken, ...receipt })
  }
  try {
    await connection.flush()
    return { ...plugin, ...createTemplateSessionTasks({ connection, plugin, dispatch }) }
  } catch(error) { await plugin.dispose(); throw error }
}

export { createTemplateServices } from './services.js'

export { createTemplatePanel } from './panel.js'

export * as templateHost from './host.js'

export { createEjsCodeEditor } from './code-editor.js'
