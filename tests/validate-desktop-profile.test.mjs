import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../bin/validate-desktop-profile.mjs', import.meta.url))
const bridge = fileURLToPath(new URL('../tavern-plugin/packages/dsh-profile-bridge', import.meta.url))
// The host's own profile loader validates the profile: a real DSH install provides it.
const hostRoot = process.env.DSH_BOOT_MODULE ? process.env.DSH_BOOT_MODULE.split(path.sep + 'node_modules' + path.sep)[0] : ''

// ~/.dsh is shared by the official DeepSeek Harness and the community DSH NEXT. A desktop profile
// made by one lists bundles only that app ships; the other cannot resolve them.
async function profileWith(t, bundles, name = 'desktop') {
  const home = await mkdtemp(path.join(tmpdir(), 'tavern-validate-profile-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = path.join(home, 'profiles', name)
  await mkdir(path.join(dir, 'node_modules'), { recursive: true })
  await cp(bridge, path.join(dir, 'node_modules', 'dsh-profile-bridge'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dsh: { profile: { bundles } } }))
  await writeFile(path.join(dir, 'cordis.patch.yml'), '[]\n')
  return { home, dir }
}
const env = home => ({ ...process.env, DSH_HOME: home, DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(hostRoot, 'package.json') })

test('原版 Desktop 切换入口：另一个桌面应用自带的插件包只提示', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const { home, dir } = await profileWith(t, ['dsh-profile-bridge', '@agents-anywhere/dsh-bridge-next'])
  const { stdout } = await run(process.execPath, [script, dir], { env: env(home) })
  assert.match(stdout, /@agents-anywhere\/dsh-bridge-next 由另一个桌面应用提供/)
  assert.match(stdout, /桌面版配置验证通过/)
})

// A user plugin left in the tavern profile can point into an app since uninstalled (dshmarket from
// the old DSH Desktop). DSH skips it at runtime, so it must not block installing or updating Tavern.
test('酒馆配置里装不上的用户插件只提示，酒馆自己的包加载不了仍是失败', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const own = await profileWith(t, ['dsh-profile-bridge', 'dshmarket'], 'tavern')
  await assert.rejects(run(process.execPath, [script], { env: env(own.home) }), error => {
    assert.doesNotMatch(error.message, /dshmarket: /)
    assert.match(error.stdout, /dshmarket 找不到安装文件，启动时会跳过/)
    return /没有加载酒馆插件/.test(error.message)
  })

  const missing = await profileWith(t, ['dsh-profile-bridge', 'dsh-tavern-plugin'], 'tavern')
  await assert.rejects(run(process.execPath, [script], { env: env(missing.home) }), /dsh-tavern-plugin: /)
})

test('原版 Desktop 切换入口：酒馆加进去的 dsh-profile-bridge 加载不了仍是失败', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const { home, dir } = await profileWith(t, ['dsh-profile-bridge'])
  await rm(path.join(dir, 'node_modules', 'dsh-profile-bridge'), { recursive: true })
  await assert.rejects(run(process.execPath, [script, dir], { env: env(home) }), /dsh-profile-bridge/)
})
