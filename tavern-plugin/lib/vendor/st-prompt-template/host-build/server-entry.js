import * as handler from '../upstream/src/modules/handler.ts'
import * as command from '../upstream/src/modules/command.ts'
import * as ui from '../upstream/src/modules/ui.ts'
import * as exportsModule from '../upstream/src/modules/exports.ts'
import ejs from '../upstream/src/3rdparty/ejs.js'
import * as YAML from 'yaml'
import { createNativeTemplateConnection } from './native-connection.js'
import { createTemplateSessionTasks } from './session-tasks.js'
import { createTemplateServices } from './services.js'
import { createTemplateLifecycle } from './lifecycle.js'
import { projectTemplate } from './projection.js'
import * as host from './host.js'

// Same upstream engine and lifecycle as the web adapter. Only the interactive
// editor is omitted: server execution has no Monaco editor to mount.
export async function createServerTemplateSession({ sessionId, rpc, settingsHtml }) {
  let connection
  window.SillyTavern = { getContext: () => Object.assign({}, connection?.snapshot, host) }
  window.YAML = YAML
  window.Worker = class {
    postMessage({ id, template, options }) {
      queueMicrotask(() => {
        try { this.onmessage?.({ data: { id, code: ejs.compile(template, options).toString() } }) }
        catch (error) { this.onmessage?.({ data: { id, error: String(error.message || error) } }) }
      })
    }
    terminate() {}
  }
  connection = await createNativeTemplateConnection({ sessionId, rpc, settingsHtml,
    services: createTemplateServices(() => connection?.snapshot, rpc) })
  host.configureTemplateHost(connection.snapshot, connection.callbacks, { yaml: YAML })
  const initialized = []
  try {
    for (const module of [handler, command, ui, exportsModule]) {
      initialized.push(module)
      await module.init()
    }
    const lifecycle = createTemplateLifecycle()
    const plugin = {
      refresh: async snapshot => { host.refreshTemplateSnapshot(snapshot); await host.eventSource.emit('SETTINGS_LOADED') },
      project: projectTemplate,
      synchronize: lifecycle,
      async dispose() {
        for (const module of initialized.reverse()) await module.exit()
        host.disposeTemplateHost()
      }
    }
    await connection.flush()
    return createTemplateSessionTasks({ connection, plugin, dispatch: {} })
  } catch (error) {
    for (const module of initialized.reverse()) { try { await module.exit() } catch {} }
    host.disposeTemplateHost()
    throw error
  }
}
