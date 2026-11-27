import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../bin/validate-desktop-profile.mjs', import.meta.url))
const startup = fileURLToPath(new URL('../bin/validate-desktop-startup.mjs', import.meta.url))
const bridge = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern', import.meta.url))
// The host's own profile loader validates the profile: a real DSH install provides it.
const hostRoot = process.env.DSH_BOOT_MODULE ? process.env.DSH_BOOT_MODULE.split(path.sep + 'node_modules' + path.sep)[0] : ''

// ~/.dsh is shared by the official DeepSeek Harness and the community DSH NEXT. A desktop profile
// made by one lists bundles only that app ships; the other cannot resolve them.
async function profileWith(t, bundles, name = 'desktop') {
  const home = await mkdtemp(path.join(tmpdir(), 'tavern-validate-profile-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = path.join(home, 'profiles', name)
  await mkdir(path.join(dir, 'node_modules'), { recursive: true })
  await cp(bridge, path.join(dir, 'node_modules', 'dsh-tavern'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'desktop', private: true, dsh: { profile: { bundles } } }))
  await writeFile(path.join(dir, 'cordis.patch.yml'), '[]\n')
  return { home, dir }
}
const env = home => ({ ...process.env, DSH_HOME: home, DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(hostRoot, 'package.json') })

test('原版 Desktop 切换入口：另一个桌面应用自带的插件包只提示', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const { home, dir } = await profileWith(t, ['dsh-tavern', '@agents-anywhere/dsh-bridge-next'])
  const { stdout } = await run(process.execPath, [script, dir], { env: env(home) })
  assert.match(stdout, /@agents-anywhere\/dsh-bridge-next 由另一个桌面应用提供/)
  assert.match(stdout, /桌面版配置验证通过/)
})

// A user plugin left in the tavern profile can point into an app since uninstalled (dshmarket from
// the old DSH Desktop). DSH skips it at runtime, so it must not block installing or updating Tavern.
test('酒馆配置里装不上的用户插件只提示，酒馆自己的包加载不了仍是失败', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const own = await profileWith(t, ['dsh-tavern', 'dshmarket'], 'tavern')
  await assert.rejects(run(process.execPath, [script], { env: env(own.home) }), error => {
    assert.doesNotMatch(error.message, /dshmarket: /)
    assert.match(error.stdout, /dshmarket 找不到安装文件，启动时会跳过/)
    return /没有加载酒馆插件/.test(error.message)
  })

  const missing = await profileWith(t, ['dsh-tavern', 'dsh-tavern-plugin'], 'tavern')
  await assert.rejects(run(process.execPath, [script], { env: env(missing.home) }), /dsh-tavern-plugin: /)
})

test('原版 Desktop 切换入口：酒馆加进去的 dsh-tavern 加载不了仍是失败', { skip: !hostRoot && '需要 DSH_BOOT_MODULE 指向一套 DSH' }, async t => {
  const { home, dir } = await profileWith(t, ['dsh-tavern'])
  await rm(path.join(dir, 'node_modules', 'dsh-tavern'), { recursive: true })
  await assert.rejects(run(process.execPath, [script, dir], { env: env(home) }), /dsh-tavern/)
})

test('桌面宿主能启动时仍拒绝重复导入的酒馆入口，并接受可响应的候选版本', { skip: !hostRoot || !process.versions.electron, timeout: 90000 }, async t => {
  const { home, dir } = await profileWith(t, [], 'tavern')
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-tavern-plugin']
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-tavern', dsh: { profile: { bundles } }, dshTavern: { managedBundles: bundles },
  }))
  const modules = path.join(dir, 'node_modules')
  const bad = path.join(modules, 'dsh-tavern-plugin')
  await mkdir(bad)
  await writeFile(path.join(bad, 'package.json'), JSON.stringify({ name: 'dsh-tavern-plugin', version: '3.4.0', type: 'module', exports: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(path.join(bad, 'cordis.patch.yml'), '- insert:\n    - id: dsh-tavern\n      name: dsh-tavern-plugin\n')
  await writeFile(path.join(bad, 'index.js'), "import { readFile } from 'node:fs'\nimport { readFile } from 'node:fs'\n")
  const options = { env: env(home), timeout: 40000 }
  await assert.rejects(run(process.execPath, [startup, dir, 'desktop'], options), error => {
    assert.match(error.stderr, /Identifier 'readFile' has already been declared/)
    assert.match(error.stderr, /酒馆插件未激活/)
    return true
  })
  await rm(bad, { recursive: true })
  await symlink(fileURLToPath(new URL('../tavern-plugin', import.meta.url)), bad, process.platform === 'win32' ? 'junction' : 'dir')
  const { stdout } = await run(process.execPath, [startup, dir, 'desktop'], options)
  assert.match(stdout, /桌面酒馆启动验证通过/)
  assert.deepEqual(await readdir(path.dirname(dir)), ['tavern'])
})
