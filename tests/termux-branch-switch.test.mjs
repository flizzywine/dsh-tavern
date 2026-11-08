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
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)

// termux-tavern.sh 把容器内脚本写在 heredoc 里；直接抽出来单独跑，就能在没有
// proot/容器的机器上验证切换与回退逻辑。
const shell = await readFile(path.join(root, 'scripts/termux/termux-tavern.sh'), 'utf8')
const lines = shell.split('\n')
const begin = lines.findIndex(line => line.includes("<<'BRANCH_SCRIPT_EOF'"))
const finish = lines.findIndex((line, index) => index > begin && line.trim() === 'BRANCH_SCRIPT_EOF')
assert.ok(begin > 0 && finish > begin, 'termux-tavern.sh 里找不到分支脚本 heredoc')
const innerScript = lines.slice(begin + 1, finish).join('\n')

const SCRIPT_SOURCE = '// stub dsh-tavern entry\n'

async function createLayout(directory) {
  const home = path.join(directory, 'home')
  const tavernRoot = path.join(home, '.dsh-tavern')
  const app = path.join(tavernRoot, 'apps', 'dsh-tavern')
  const branchSource = path.join(directory, 'branch-source')
  for (const [target, version] of [[app, '3.1.0'], [branchSource, '3.2.0']]) {
    await mkdir(path.join(target, 'bin'), { recursive: true })
    await mkdir(path.join(target, 'patches'), { recursive: true })
    await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version }))
    await writeFile(path.join(target, 'bin/dsh-tavern.mjs'), SCRIPT_SOURCE)
    await writeFile(path.join(target, 'pnpm-lock.yaml'), 'lockfile-identical\n')
    await writeFile(path.join(target, 'pnpm-workspace.yaml'), 'patchedDependencies:\n')
    await writeFile(path.join(target, 'patches/dsh-web-mobile@3.1.0.patch'), '')
  }
  await mkdir(path.join(app, 'data'), { recursive: true })
  await writeFile(path.join(app, 'data/session.json'), '{"keep":true}')
  await mkdir(path.join(app, 'node_modules/.pnpm'), { recursive: true })
  await writeFile(path.join(app, 'node_modules/.pnpm/marker'), 'old-deps')

  const profile = path.join(tavernRoot, 'profiles', 'tavern')
  await mkdir(path.join(profile, 'patches'), { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }))
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'patchedDependencies:\n')

  const mock = path.join(directory, 'mock')
  await mkdir(mock, { recursive: true })
  await writeFile(path.join(mock, 'dsh-tavern'), '#!/usr/bin/env bash\nexit 0\n')
  await writeFile(path.join(mock, 'pnpm'), '#!/usr/bin/env bash\nexit 0\n')
  await writeFile(path.join(mock, 'git'), `#!/usr/bin/env bash
set -eu
case " $* " in
  *" clone "*) destination="\${@: -1}"; mkdir -p "$destination"; cp -R "$TEST_ROOT/branch-source/." "$destination/"; exit 0 ;;
  *) exit 0 ;;
esac
`)
  for (const name of ['dsh-tavern', 'pnpm', 'git']) await chmod(path.join(mock, name), 0o755)
  return { home, tavernRoot, app, profile, mock }
}

function runInner(directory, layout, args) {
  const script = path.join(directory, 'branch-inner.sh')
  return spawnSync(bash, [script, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      HOME: shellPath(layout.home),
      PATH: `${shellPath(layout.mock)}:${process.env.PATH || ''}`,
      TEST_ROOT: shellPath(directory),
      TERMUX_TAVERN_STOP_WAIT: '0',
    },
    input: undefined,
  })
}

async function writeInner(directory) {
  const script = path.join(directory, 'branch-inner.sh')
  await writeFile(script, innerScript)
  return script
}

test('容器内切换：保留 data 与 node_modules、写标记与备份记录', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-termux-branch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const layout = await createLayout(directory)
  await writeInner(directory)

  const result = runInner(directory, layout, ['backup/main-20261106', 'switch'])
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  assert.equal(JSON.parse(await readFile(path.join(layout.app, 'package.json'), 'utf8')).version, '3.2.0')
  assert.equal(await readFile(path.join(layout.app, 'data/session.json'), 'utf8'), '{"keep":true}')
  assert.equal(await readFile(path.join(layout.app, 'node_modules/.pnpm/marker'), 'utf8'), 'old-deps')
  assert.equal((await readFile(path.join(layout.app, '.termux-tavern-branch'), 'utf8')).trim(), 'backup/main-20261106')
  assert.ok(existsSync(path.join(layout.tavernRoot, 'backups/branch-latest')))

  const latest = (await readFile(path.join(layout.tavernRoot, 'backups/branch-latest'), 'utf8')).trim()
  assert.match(latest, /backups\/branch-\d{8}-\d{6}$/)
  assert.ok(existsSync(path.join(latest, 'previous-source/package.json')))

  // 移动版布局补丁要补回来
  const profileManifest = await readFile(path.join(layout.profile, 'package.json'), 'utf8')
  assert.match(profileManifest, /dsh-web-mobile/)
})

test('容器内回退：恢复旧版本并清掉记录', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-termux-revert-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const layout = await createLayout(directory)
  await writeInner(directory)

  assert.equal(runInner(directory, layout, ['backup/main-20261106', 'switch']).status, 0)
  const revert = runInner(directory, layout, ['backup/main-20261106', 'revert'])
  assert.equal(revert.status, 0, `${revert.stdout}\n${revert.stderr}`)

  assert.equal(JSON.parse(await readFile(path.join(layout.app, 'package.json'), 'utf8')).version, '3.1.0')
  assert.equal(await readFile(path.join(layout.app, 'data/session.json'), 'utf8'), '{"keep":true}')
  assert.equal(existsSync(path.join(layout.tavernRoot, 'backups/branch-latest')), false)
})

test('已在目标分支时增量更新：不新建备份，只快进到分支最新', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-termux-update-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const layout = await createLayout(directory)
  await rm(path.join(layout.mock, 'git'), { force: true })   // 这一条用真实 git
  await writeInner(directory)

  // 真实的本地「远端」仓库：只有 backup/main-20261106 一个分支
  const bare = path.join(directory, 'origin.git')
  const work = path.join(directory, 'origin-work')
  const git = args => spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
  assert.equal(git(['init', '-q', '--bare', bare]).status, 0)
  assert.equal(git(['-C', bare, 'config', 'uploadpack.allowFilter', 'true']).status, 0)
  assert.equal(git(['init', '-q', '-b', 'backup/main-20261106', work]).status, 0)
  for (const name of ['bin', 'patches']) await mkdir(path.join(work, name), { recursive: true })
  await writeFile(path.join(work, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version: '3.2.0' }))
  await writeFile(path.join(work, 'bin/dsh-tavern.mjs'), SCRIPT_SOURCE)
  await writeFile(path.join(work, 'pnpm-lock.yaml'), 'lockfile-identical\n')
  await writeFile(path.join(work, 'patches/dsh-web-mobile@3.1.0.patch'), '')
  const commit = message => {
    assert.equal(git(['-C', work, 'add', '-A']).status, 0)
    const result = spawnSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', message], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  commit('fixture')
  assert.equal(git(['-C', work, 'remote', 'add', 'origin', bare]).status, 0)
  assert.equal(git(['-C', work, 'push', '-q', 'origin', 'backup/main-20261106']).status, 0)
  // 让「依赖未变」成立：node_modules 里的 lock 摘要与源码 lockfile 一致
  await writeFile(path.join(layout.app, 'node_modules/.pnpm/lock.yaml'), 'lockfile-identical\n')

  const env = { DSH_TAVERN_REPOSITORY: shellPath(bare), DSH_TAVERN_TARBALL_BASE: 'file:///nonexistent' }
  const first = spawnSync(bash, [path.join(directory, 'branch-inner.sh'), 'backup/main-20261106', 'switch'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: shellPath(layout.home), PATH: `${shellPath(layout.mock)}:${process.env.PATH || ''}`, TEST_ROOT: shellPath(directory), TERMUX_TAVERN_STOP_WAIT: '0', ...env },
  })
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
  assert.ok(existsSync(path.join(layout.app, '.git')))
  const backupDirs = async () => (await readdir(path.join(layout.tavernRoot, 'backups'))).filter(name => name.startsWith('branch-2'))
  assert.equal((await backupDirs()).length, 1)

  // 分支上再推一个提交，第二次运行应该只快进，不产生新备份
  await writeFile(path.join(work, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version: '3.2.1' }))
  commit('bump')
  assert.equal(git(['-C', work, 'push', '-q', 'origin', 'backup/main-20261106']).status, 0)

  const second = spawnSync(bash, [path.join(directory, 'branch-inner.sh'), 'backup/main-20261106', 'switch'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: shellPath(layout.home), PATH: `${shellPath(layout.mock)}:${process.env.PATH || ''}`, TEST_ROOT: shellPath(directory), TERMUX_TAVERN_STOP_WAIT: '0', ...env },
  })
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
  assert.match(second.stdout, /增量更新/)
  assert.equal(JSON.parse(await readFile(path.join(layout.app, 'package.json'), 'utf8')).version, '3.2.1')
  assert.equal((await backupDirs()).length, 1, '增量更新不应新建备份')

  // 第三次：已经最新，跳过重装
  const third = spawnSync(bash, [path.join(directory, 'branch-inner.sh'), 'backup/main-20261106', 'switch'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: shellPath(layout.home), PATH: `${shellPath(layout.mock)}:${process.env.PATH || ''}`, TEST_ROOT: shellPath(directory), TERMUX_TAVERN_STOP_WAIT: '0', ...env },
  })
  assert.equal(third.status, 0, `${third.stdout}\n${third.stderr}`)
  assert.match(third.stdout, /已是最新/)
  assert.equal((await backupDirs()).length, 1)

  // 回滚到切换前（本来不是 git 检出）：必须清掉 .git，否则应用内更新会拒绝更新
  const revert = spawnSync(bash, [path.join(directory, 'branch-inner.sh'), 'backup/main-20261106', 'revert'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: shellPath(layout.home), PATH: `${shellPath(layout.mock)}:${process.env.PATH || ''}`, TEST_ROOT: shellPath(directory), TERMUX_TAVERN_STOP_WAIT: '0', ...env },
  })
  assert.equal(revert.status, 0, `${revert.stdout}\n${revert.stderr}`)
  assert.equal(JSON.parse(await readFile(path.join(layout.app, 'package.json'), 'utf8')).version, '3.1.0')
  assert.equal(existsSync(path.join(layout.app, '.git')), false, '回滚后不应残留 .git')
  assert.equal(existsSync(path.join(layout.app, '.termux-tavern-branch')), false)
})
