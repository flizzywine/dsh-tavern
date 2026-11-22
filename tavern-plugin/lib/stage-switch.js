// Installing the stage plugin supplies its loader and starts the runtime when configured.
export function createStageSwitch(runtime, {startOnInstall = false} = {}) {
  let loader, suspended = false, waitingForInstall = false
  const read = () => ({status:runtime.status(), installed:!!loader})
  async function ensure() {
    if (!suspended && runtime.status() !== 'failed') {
      if (loader) await runtime.enable(loader)
      else waitingForInstall = true
    }
    return read()
  }
  return Object.freeze({
    read,
    ensure,
    async install(load) {
      loader = load
      suspended = false
      if (startOnInstall || waitingForInstall) {
        waitingForInstall = false
        await ensure()
      }
    },
    uninstall() { loader = undefined; return runtime.disable() },
    enable(load = loader) { suspended = false; return runtime.enable(load) },
    disable() { suspended = true; return runtime.disable() }
  })
}
