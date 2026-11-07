import { MAX_PLUGIN_DATA } from '../domain/plugin-data-store.js'
import { listLegacyPlugins } from '../domain/legacy-plugins.js'
import { userPluginPaths } from '../domain/user-plugins.js'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'

// User plugin management and plugin runtime requests.
// `deps` carries the services ../index.js builds; dispatchMethod routes by method name.
export function createPluginHandlers(deps) {
  const { dataRoot, pluginApi, pluginDataStore, startPluginTask, str, uploads, userPluginInstaller } = deps
  return {
    async gameMode(args) {
      const id = str(args?.sessionId)
      if (args?.op === 'list') return { modes: await pluginApi.gameModes.list(id) }
      if (args?.op === 'stop') { pluginApi.gameModes.stop(id); return { stopped: true } }
      if (!args?.op || args.op === 'view') return { mode: await pluginApi.gameModes.view(id) }
      if ((await pluginApi.turnState(id)).busy) throw new Error('请先停止或等待正文与后台任务结束')
      return { mode: await pluginApi.gameModes.execute(id, args) }
    },
    // The page side of a plugin reads and writes the same data as its host side (tavernUi.savePluginData).
    async pluginData(args) {
      if (args?.op === 'limits') return { maxBytes: MAX_PLUGIN_DATA }
      const plugin = str(args && args.plugin)
      if (args && args.op === 'save') { await pluginDataStore.save(plugin, args.data); return { ok: true } }
      return { data: await pluginDataStore.read(plugin) }
    },
    async listUserPlugins(args) {
      return { plugins: await userPluginInstaller.list(), dir: userPluginInstaller.pluginsDir }
    },
    async listLegacyPlugins(args) {
      return listLegacyPlugins(userPluginPaths(dataRoot).profile)
    },
    async checkUserPluginUpdates(args) {
      return { plugins: await userPluginInstaller.checkUpdates({ fresh: args && args.fresh === true }) }
    },
    async enableUserPlugin(args) {
      return { plugin: await userPluginInstaller.enable(args && args.folder) }
    },
    async disableUserPlugin(args) {
      return { plugin: await userPluginInstaller.disable(args && args.folder) }
    },
    async installUserPlugin(args) {
      return { plugin: await userPluginInstaller.installFromGithub(args && args.url) }
    },
    async installUserPluginUpload(args) {
      const upload = await uploads.take(args && args.uploadId)
      try { return { plugin: await userPluginInstaller.installFromZip(await readFile(upload.file), args && args.name) } }
      finally { await upload.remove() }
    },
    async updateUserPlugin(args) {
      return { plugin: await userPluginInstaller.update(args && args.folder) }
    },
    async removeUserPlugin(args) {
      return await userPluginInstaller.remove(args && args.folder)
    },
    async openUserPluginsFolder(args) {
      await mkdir(userPluginInstaller.pluginsDir, { recursive: true })
      const opener = process.platform === 'darwin' ? ['open', [userPluginInstaller.pluginsDir]] : process.platform === 'win32' ? ['explorer.exe', [userPluginInstaller.pluginsDir]] : ['xdg-open', [userPluginInstaller.pluginsDir]]
      spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
      return { dir: userPluginInstaller.pluginsDir }
    },
    async bodyGenerationProviders(args) {
      return { providers: await pluginApi.bodyGenerators.list(args?.sessionId) }
    },
    async listGamePlugins(args) {
      return { plugins: await pluginApi.gamePlugins(str(args && args.sessionId)) }
    },
    async setGamePlugin(args) {
      return { plugins: await pluginApi.setGamePlugin(str(args && args.sessionId), { setting: args && args.setting }) }
    },
    async pluginState(args) {
      return { data: await pluginApi.pluginState(str(args && args.sessionId), str(args && args.plugin), str(args && args.name)) }
    },
    async pluginGameSettings(args) {
      return { values: await pluginApi.pluginGameSettings(str(args && args.sessionId), str(args && args.plugin)) }
    },
    async startPluginTask(args) {
      return await startPluginTask(args && args.sessionId, args && args.key, args && args.input)
    },
    async callPluginHandler(args) {
      return { result: await pluginApi.callHandler(args && args.name, args && args.args) }
    },
    async pluginTurnState(args) {
      return { state: await pluginApi.turnState(args && args.sessionId) }
    },
  }
}
