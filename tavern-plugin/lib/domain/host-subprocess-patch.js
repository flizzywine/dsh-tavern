import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { defaultHostRequire } from './host-session-patch.js'

const PACKAGE = '@deepseek-ai/dsh-subprocess-local'
// Version-independent: gated only on the launcher anchor matching exactly once,
// never on a DSH version or file hash. A drifted anchor throws and the caller
// keeps DSH's native (visible-console) behaviour.
const installed = new WeakMap()

// DSH's Windows Job launcher starts a Node runner with an IPC channel. From a
// detached web host it allocates a visible console unless windowsHide is set.
// Replace only ordinary spawn in memory; keep the native runner, Job ownership,
// disposal and interactive ConPTY paths. Official dependency files stay intact.
export async function installHostSubprocessPatch({ hostRequire, persistence, platform = process.platform } = {}) {
  if (platform !== 'win32') return () => {}
  const require = hostRequire || await defaultHostRequire(persistence)
  const entry = require.resolve(PACKAGE)
  const { default: Local } = await import(pathToFileURL(entry).href)
  const prototype = Local.prototype
  let record = installed.get(prototype)
  if (!record) {
    const source = await readFile(entry, 'utf8')
    const target = 'env: runnerEnvironment(WINDOWS_RUNNER_SELECTION, invocation),'
    assert.equal(source.split(target).length, 2, 'Windows subprocess patch: launcher target differs')
    const localRequire = createRequire(entry)
    const modified = source.replace(target, target + '\n\t\t\twindowsHide: true,')
      .replace(/\bfrom "([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(
        specifier.startsWith('node:') ? specifier : pathToFileURL(localRequire.resolve(specifier)).href))
      // 0.2.1-rc.2 适配：宿主入口在模块顶层就 `createLazyRequire("node-pty", import.meta.url)`。
      // data: 模块里的 import.meta.url 是 data URL，createRequire 直接抛 ERR_INVALID_ARG_VALUE
      // （真机取证：ERR_INVALID_ARG_VALUE @ data:…:1262:24）。改写成真实入口文件 URL 后 node-pty
      // 仍按宿主同一份解析（asar 旁解包的 app.asar.unpacked），与 host-session-patch.js 同一手法。
      .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(entry).href))
    assert.doesNotMatch(modified, /import\.meta\.url/, 'Windows subprocess patch: import.meta.url 未被改写')
    // The source has static imports plus that one lazy require. Relative helper
    // imports must retain their original identities, including runner path resolution.
    const { default: Patched } = await import('data:text/javascript;base64,' + Buffer.from(modified).toString('base64'))
    // Another profile may have completed the same asynchronous preparation.
    record = installed.get(prototype)
    if (!record) {
      record = { original: Object.getOwnPropertyDescriptor(prototype, 'spawn'), patched: Patched.prototype.spawn, users: 0 }
      Object.defineProperty(prototype, 'spawn', { ...record.original, value: record.patched })
      installed.set(prototype, record)
    }
  }
  record.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--record.users) return
    if (prototype.spawn === record.patched) Object.defineProperty(prototype, 'spawn', record.original)
    installed.delete(prototype)
  }
}
