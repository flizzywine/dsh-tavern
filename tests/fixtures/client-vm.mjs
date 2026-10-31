// non-rendering client VM tests still initialize the foreground owner.
import vm from 'node:vm'

export function runInNewContext(source, sandbox = {}, options) {
  if (sandbox.window?.__ModuleLoader__) {
    sandbox.document ??= {
      visibilityState: 'visible', hasFocus: () => true,
      addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ dataset: {}, style: {}, remove() {} }),
      head: { appendChild() {} }
    }
    sandbox.fetch ??= fetch
    sandbox.Blob ??= Blob
    sandbox.location ??= {origin:"http://tavern.test",href:"http://tavern.test/"}
    sandbox.URL ??= URL
    const host = sandbox.window
    host.performance ??= performance
    sandbox.performance ??= host.performance
    host.addEventListener ??= () => {}
    host.removeEventListener ??= () => {}
    host.setTimeout ??= setTimeout
    host.clearTimeout ??= clearTimeout
  }
  return vm.runInNewContext(source, sandbox, options)
}
export default { ...vm, runInNewContext }
