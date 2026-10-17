import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installCliRuntime, migrateCliHome, cliRuntimeCommand } from '../bin/cli-runtime.mjs'
import { adaptedDshVersion, dshCompatibilityNotice, desktopReleasesUrl, dshaReleasesUrl } from '../bin/dsh-compatibility.mjs'

function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tavern-runtime-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function put(file, text = '') { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text) }
function fakeDownload(platform, calls) {
  return (command, args) => {
    calls.push([command, args])
    assert.equal(command, 'npm')
    assert.equal(args[0], 'ci')
    assert.ok(!args.includes('--global'))
    const prefix = args[args.indexOf('--prefix') + 1]
    const manifest = JSON.parse(readFileSync(path.join(prefix, 'package.json')))
    const lock = JSON.parse(readFileSync(path.join(prefix, 'package-lock.json')))
    assert.equal(manifest.dependencies['@deepseek-ai/dsh'], adaptedDshVersion)
    assert.equal(lock.packages['node_modules/@deepseek-ai/dsh'].version, adaptedDshVersion)
    put(path.join(prefix, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: adaptedDshVersion, bin: { dsh: "bin.cjs" } }))
    put(path.join(prefix, 'node_modules/@deepseek-ai/dsh/bin.cjs'), `console.log(${JSON.stringify(adaptedDshVersion)})`)
  }
}

for (const platform of ['linux', 'win32']) {
  test(`${platform}: reinstall reuses healthy runtime; replacement rollback restores old runtime`, async t => {
    const root = path.join(temporary(t), 'runtime'), calls = []
    put(path.join(root, 'old-only.txt'), 'old')
    let tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls) })
    assert.ok(existsSync(tx.command))
    assert.equal(existsSync(path.join(root, 'old-only.txt')), false)
    tx.rollback()
    assert.equal(readFileSync(path.join(root, 'old-only.txt'), 'utf8'), 'old')
    tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls) })
    tx.commit()
    tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls) })
    tx.commit()
    assert.equal(calls.length, 2)
    assert.equal(tx.reused, true)
    tx.rollback()
    assert.ok(existsSync(tx.command))
    tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls), force: true })
    tx.commit()
    assert.equal(calls.length, 3)
    put(cliRuntimeCommand(root, platform) + ".marker", "keep")
    const packageRoot = path.join(root, platform === "win32" ? "node_modules/@deepseek-ai/dsh" : "lib/node_modules/@deepseek-ai/dsh")
    put(path.join(packageRoot, "bin.cjs"), "process.exit(1)")
    tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls) })
    tx.commit()
    assert.equal(calls.length, 4)
    put(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '0.0.0', bin: { dsh: 'bin.cjs' } }))
    tx = await installCliRuntime({ root, platform, run: fakeDownload(platform, calls) })
    tx.commit()
    assert.equal(calls.length, 5)
    assert.equal(existsSync(path.join(root, 'old-only.txt')), false)
  })
}

test('failed download leaves installed runtime untouched', async t => {
  const root = path.join(temporary(t), 'runtime')
  put(path.join(root, 'original'), 'working')
  await assert.rejects(() => installCliRuntime({ root, run() { throw new Error('offline') } }), /offline/)
  assert.equal(readFileSync(path.join(root, 'original'), 'utf8'), 'working')
})

test('CLI migration copies native history once, leaves originals and host dependencies alone', t => {
  const root = temporary(t), source = path.join(root, 'host'), target = path.join(root, 'private')
  put(path.join(source, 'profiles/tavern/package.json'), JSON.stringify({ dshTavern: { host: 'cli' } }))
  put(path.join(source, 'profile-data/tavern/sessions/example/events.jsonl'), 'native history')
  put(path.join(source, 'profiles/node_modules/host-only'), 'host dependency')
  put(path.join(source, 'settings.yaml'), 'model: fixture')
  assert.equal(migrateCliHome({ source, target }), true)
  const migrated = path.join(target, 'profile-data/tavern/sessions/example/events.jsonl')
  assert.equal(readFileSync(migrated, 'utf8'), 'native history')
  assert.equal(existsSync(path.join(target, 'profiles/node_modules')), false)
  put(migrated, 'new private history')
  assert.equal(migrateCliHome({ source, target }), false)
  assert.equal(readFileSync(migrated, 'utf8'), 'new private history')
  assert.equal(readFileSync(path.join(source, 'profile-data/tavern/sessions/example/events.jsonl'), 'utf8'), 'native history')
})

for (const host of ['desktop', 'android']) {
  test(`${host}: migration never adopts external host data and mismatched versions report installation stopped`, t => {
    const source = temporary(t), target = path.join(source, 'private')
    put(path.join(source, 'profiles/tavern/package.json'), JSON.stringify({ dshTavern: { host } }))
    assert.equal(migrateCliHome({ source, target }), false)
    const notice = dshCompatibilityNotice('99.0.0', host)
    assert.match(notice, /已停止安装/)
    // 0.2.0-rc.2 适配：Desktop 的下载地址换成官方 https://www.deepseek.com/harness/，
    // 断言改为跟随 config/dsh-compatibility.json 的字段，不再假设发布页在 GitHub。
    assert.ok(notice.includes(host === 'desktop' ? desktopReleasesUrl : dshaReleasesUrl), notice)
  })
}

test('CLI ignores global PATH, rejects missing private runtime, and retains explicit private home', t => {
  const root = temporary(t), globalBin = path.join(root, 'global'), privateHome = path.join(root, 'private')
  put(path.join(globalBin, 'dsh'), 'global')
  const module = new URL('../bin/launcher-environment.mjs', import.meta.url).href
  const probe = () => spawnSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(module)});console.log(JSON.stringify({command:m.findDshCommand(),home:m.runtimeEnvironment().DSH_HOME}))`], {
    encoding: 'utf8', env: { ...process.env, PATH: globalBin, DSH_HOME: root, DSH_TAVERN_CLI_HOME: privateHome, DSH_TAVERN_RUNTIME_HOST: 'cli' },
  })
  assert.match(probe().stderr, /不会回退到全局 DSH/)
  const command = cliRuntimeCommand(path.join(privateHome, 'runtime'))
  put(command)
  assert.deepEqual(JSON.parse(probe().stdout), { command, home: privateHome })
})

test('runtime lock pins the complete DSH release with portable integrity-checked downloads', () => {
  const lock = JSON.parse(readFileSync(new URL('../config/cli-runtime/package-lock.json', import.meta.url)))
  const manifest = JSON.parse(readFileSync(new URL('../config/cli-runtime/package.json', import.meta.url)))
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies)
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (!location) continue
    assert.match(location, /^node_modules\//)
    assert.equal(pkg.link, undefined)
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//)
    assert.match(pkg.integrity, /^sha512-/)
    if (/node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(location)) assert.equal(pkg.version, adaptedDshVersion, location)
  }
})
