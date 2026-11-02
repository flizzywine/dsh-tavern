// The built stage client (an ES module imported on demand by the core) evaluated in a vm context.
import {readFile} from 'node:fs/promises'
import vm from './client-vm.mjs'
import {stageClientModuleAsScript} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/client-assets.js'

const bundle = new URL('../../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url)

// Returns the plugin object (`export default`) with the client VM defaults; the stage must not register
// through the module loader any more, so a call to it fails loudly.
export async function loadStageClientPlugin(sandbox = {}, options) {
  sandbox.window ??= {}
  sandbox.window.__ModuleLoader__ ??= {load() { throw new Error('stage client must not register through window.__ModuleLoader__') }}
  return vm.runInNewContext(stageClientModuleAsScript(await readFile(bundle, 'utf8')), sandbox, options)
}
