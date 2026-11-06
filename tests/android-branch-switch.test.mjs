import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const bash = process.env.TEST_BASH || 'bash'
const script = path.join(root, 'android/switch-branch.sh')
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)

const SCRIPT_SOURCE = `#!/usr/bin/env bash
set -eu
touch "\${DSH_HOME}/installer-ran"
printf 'fake installer %s\\n' "$(basename "$(dirname "$(dirname "$0")")")"
`

// 旧的已安装版本（main）与目标分支源码：lockfile/patches 完全一致，node_modules 应被复用。
async function createInstall(directory) {
  const home = path.join(directory, 'home')
  const app = path.join(home, 'apps', 'dsh-tavern')
  const branchSource = path.join(directory, 'branch-source')
  for (const [target, version] of [[app, '3.1.0'], [branchSource, '3.2.0']]) {
    await mkdir(path.join(target, 'android'), { recursive: true })
    await mkdir(path.join(target, 'bin'), { recursive: true })
    await mkdir(path.join(target, 'patches'), { recursive: true })
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version }))
    await writeFile(path.join(target, 'bin/dsh-tavern.mjs'), '')
    await writeFile(path.join(target, 'android/install.sh'), SCRIPT_SOURCE)
    await writeFile(path.join(target, 'pnpm-lock.yaml'), 'lockfile-identical\n')
    await writeFile(path.join(target, 'pnpm-workspace.yaml'), 'packages: []\n')
    await writeFile(path.join(target, 'patches/keep.patch'), '')
  }
  await mkdir(path.join(app, 'data'), { recursive: true })
  await writeFile(path.join(app, 'data/session.json'), '{"keep":true}')
  await mkdir(path.join(app, 'node_modules/.pnpm'), { recursive: true })
  await writeFile(path.join(app, 'node_modules/.pnpm/marker'), 'old-deps')

  const mock = path.join(directory, 'mock')
  await mkdir(mock, { recursive: true })
  // Git 传输用桩：clone 直接把分支源码拷到目标目录，其余子命令空操作。
  await writeFile(path.join(mock, 'git'), `#!/usr/bin/env bash
set -eu
args="$*"
case " $args " in
  *" clone "*) destination="\${@: -1}"; mkdir -p "$destination"; cp -R "$TEST_ROOT/branch-source/." "$destination/"; exit 0 ;;
  *" rev-parse "*) cat "$TEST_ROOT/sha"; exit 0 ;;
  *" ls-remote "*) printf '%s\\trefs/heads/%s\\n' "$(cat "$TEST_ROOT/sha")" "$DSH_TAVERN_TARGET_BRANCH"; exit 0 ;;
  *) exit 0 ;;
esac
`)
  await writeFile(path.join(mock, 'dsh'), '#!/usr/bin/env bash\nexit 0\n')
  await chmod(path.join(mock, 'git'), 0o755)
  await chmod(path.join(mock, 'dsh'), 0o755)

  const sha = 'f'.repeat(40)
  await writeFile(path.join(directory, 'sha'), `${sha}\n`)
  return { home, app, branchSource, mock, sha, state: path.join(directory, 'state') }
}

function runSwitch(directory, install, args = [], extra = {}) {
  return spawnSync(bash, [script, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      PATH: `${install.mock}:${process.env.PATH || ''}`,
      HOME: shellPath(directory),
      DSH_HOME: shellPath(install.home),
      DSH_TAVERN_SOURCE_ROOT: shellPath(install.app),
      DSH_TAVERN_TARGET_BRANCH: 'backup/main-20261106',
      DSH_TAVERN_REPOSITORY: 'test-repository',
      DSH_TAVERN_SWITCH_STATE_DIR: shellPath(install.state),
      DSH_TAVERN_TARIFF: '',
      TEST_ROOT: shellPath(directory),
      ...extra,
    },
  })
}

test('dry-run 只打印计划，不创建记录、不改动源码', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-switch-dry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const install = await createInstall(directory)

  const result = runSwitch(directory, install, ['--dry-run'])
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /切换计划/)
  assert.match(result.stdout, /3\.1\.0/)
  assert.match(result.stdout, /backup\/main-20261106/)
  assert.equal(JSON.parse(await readFile(path.join(install.app, 'package.json'), 'utf8')).version, '3.1.0')
  assert.deepEqual(await readdir(install.state).catch(() => []), [])
})

test('整目录替换：保留 data、复用 node_modules、写分支标记与切换记录', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-switch-swap-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const install = await createInstall(directory)

  const result = runSwitch(directory, install)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /切换完成/)

  assert.equal(JSON.parse(await readFile(path.join(install.app, 'package.json'), 'utf8')).version, '3.2.0')
  assert.equal(await readFile(path.join(install.app, 'data/session.json'), 'utf8'), '{"keep":true}')
  assert.equal(await readFile(path.join(install.app, 'node_modules/.pnpm/marker'), 'utf8'), 'old-deps')
  const marker = (await readFile(path.join(install.app, '.dsh-tavern-branch'), 'utf8')).split('\n')
  assert.equal(marker[0], 'backup/main-20261106')
  assert.equal(marker[1], install.sha)

  assert.match(
    await readFile(path.join(install.app, '.dsh-tavern-tarball-source'), 'utf8'),
    /refs\/heads\/backup\/main-20261106/,
  )

  const states = (await readdir(install.state)).filter(name => /^\d/.test(name))
  assert.equal(states.length, 1)
  const stateEnv = await readFile(path.join(install.state, states[0], 'state.env'), 'utf8')
  assert.match(stateEnv, /KIND=swap/)
  assert.match(stateEnv, /PREVIOUS_VERSION=3\.1\.0/)
  assert.match(stateEnv, /TARGET_VERSION=3\.2\.0/)
  assert.ok(await readFile(path.join(install.state, states[0], 'previous-source/package.json'), 'utf8'))
  assert.ok(existsSync(path.join(install.home, 'installer-ran')))
})

test('未给源码目录时按 tavern Profile 记录自动发现安装位置', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-switch-discover-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const home = path.join(directory, 'home')
  // 安装目录故意放在 home/apps 之外，只能靠 profile 里的 dshTavern.source 找到。
  const app = path.join(directory, 'custom', 'dsh-tavern')
  for (const target of [app, path.join(directory, 'branch-source')]) {
    await mkdir(path.join(target, 'android'), { recursive: true })
    await mkdir(path.join(target, 'bin'), { recursive: true })
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version: '3.1.0' }))
    await writeFile(path.join(target, 'bin/dsh-tavern.mjs'), '')
    await writeFile(path.join(target, 'android/install.sh'), SCRIPT_SOURCE)
    await writeFile(path.join(target, 'pnpm-lock.yaml'), 'lockfile-identical\n')
    await writeFile(path.join(target, 'pnpm-workspace.yaml'), 'packages: []\n')
  }
  const profile = path.join(home, 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dshTavern: { source: app } }))
  const mock = path.join(directory, 'mock')
  await mkdir(mock, { recursive: true })
  await writeFile(path.join(mock, 'git'), '#!/usr/bin/env bash\nexit 1\n')
  await chmod(path.join(mock, 'git'), 0o755)

  const result = spawnSync(bash, [script, '--dry-run'], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      HOME: shellPath(home),
      PATH: `${mock}:${process.env.PATH || ''}`,
      DSH_HOME: shellPath(home),
      DSH_TAVERN_TARGET_BRANCH: 'backup/main-20261106',
      TEST_ROOT: shellPath(directory),
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Profile 记录找到安装目录/)
  assert.match(result.stdout, /3\.1\.0/)
})

test('安装器失败时自动回滚到旧版本', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-switch-rollback-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const install = await createInstall(directory)
  await writeFile(path.join(install.branchSource, 'android/install.sh'), '#!/usr/bin/env bash\nexit 1\n')

  const result = runSwitch(directory, install)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /回滚|恢复/)
  assert.equal(JSON.parse(await readFile(path.join(install.app, 'package.json'), 'utf8')).version, '3.1.0')
  assert.equal(await readFile(path.join(install.app, 'data/session.json'), 'utf8'), '{"keep":true}')
})

test('--revert 用最近一次记录回到切换前版本', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-switch-revert-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const install = await createInstall(directory)

  assert.equal(runSwitch(directory, install).status, 0)
  assert.equal(JSON.parse(await readFile(path.join(install.app, 'package.json'), 'utf8')).version, '3.2.0')

  const revert = runSwitch(directory, install, ['--revert'])
  assert.equal(revert.status, 0, `${revert.stdout}\n${resultText(revert)}`)
  assert.equal(JSON.parse(await readFile(path.join(install.app, 'package.json'), 'utf8')).version, '3.1.0')
  assert.equal(await readFile(path.join(install.app, 'data/session.json'), 'utf8'), '{"keep":true}')
})

function resultText(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}
