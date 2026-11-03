// Native Session tests need the same host surface relaxation Tavern installs
// at runtime: assistant/message replacements may cite shadowed nodes. Without it,
// real Session.append rejects Tavern rollback/edit tombstones.
// The dedicated installer test verifies unpatched rejection itself, so skip there.
// 补丁不分 DSH 版本，这里也不按版本跳过：锚点漂移时直接抛错，而不是让
// 用真实 Session 的用例以难以定位的方式失败。
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareExpandedPatch } from '../../tavern-plugin/lib/domain/host-session-patch.js'

const APPLIED = Symbol.for('dsh-tavern.host-session-patch-preload.v1')

if (!globalThis[APPLIED] && !process.argv.some(arg => arg.endsWith('/host-session-patch.test.mjs'))) {
  let runtimeRoot
  if (process.env.DSH_BOOT_MODULE) {
    const anchor = new URL('../../dsh-session/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE))
    runtimeRoot = fileURLToPath(new URL('../../../', anchor))
  } else {
    const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
    const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
    const sessionPath = hostRequire.resolve('@deepseek-ai/dsh-session')
    runtimeRoot = sessionPath.split(/[/\\]node_modules[/\\]/)[0]
  }
  const patch = await prepareExpandedPatch(runtimeRoot)
  patch.selfTest()
  globalThis[APPLIED] = true
}
