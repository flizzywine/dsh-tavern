import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import test, { beforeEach, afterEach, mock } from 'node:test'

import { createApplicationUpdater as createUpdater, sanitizeUpdateError } from '../tavern-plugin/lib/application-updater.js'

// Never let fixtures accidentally consume a real release. Local HTTP fixtures
// still exercise the production fetch path; every other request fails the test,
// even if the updater catches the error and falls back to another source.
const nativeFetch = globalThis.fetch
let unexpectedRequests = []
beforeEach(() => {
  unexpectedRequests = []
  mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init)
    unexpectedRequests.push(url.origin + url.pathname)
    throw new Error('External network is disabled in updater tests')
  })
})
afterEach(() => {
  mock.restoreAll()
  assert.deepEqual(unexpectedRequests, [], '更新器测试必须显式模拟远端请求')
})

function createApplicationUpdater(options) {
  return createUpdater({
    // GitHub-specific tests opt out of the CDN-first route. CDN tests below
    // override this with their own metadata rather than fetching live data.
    fetchCdnMetadata: async () => { throw new Error('CDN unavailable in GitHub fixture') },
    ...options,
  })
}

const knownIdentity = { currentVersion: '1.1.0', currentCommit: 'a'.repeat(40) }
const verifiedUpdate = {
  readLocalIdentity: async () => knownIdentity,
  fetchManifest: async () => ({ version: '1.1.0' }),
  fetchLatestCommit: async () => 'b'.repeat(40),
  compareCommits: async () => 'ahead',
}
const runningVersion = { ...knownIdentity, latestVersion: '1.1.0', latestCommit: 'b'.repeat(40), checkSource: 'github', checkWarning: undefined }

test('真实 Git 历史可离线识别新旧，包括 archive 安装的 bare source-cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-git-'))
  try {
    const repo = path.join(root, 'repo')
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git('init', repo)
    git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'old')
    const old = git('-C', repo, 'rev-parse', 'HEAD')
    git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'new')
    const recent = git('-C', repo, 'rev-parse', 'HEAD')
    const dshHome = path.join(root, 'dsh')
    await mkdir(path.join(dshHome, 'source-cache'), { recursive: true })
    git('clone', '--bare', repo, path.join(dshHome, 'source-cache/dsh-tavern.git'))
    for (const sourceRoot of [repo, root]) {
      for (const [currentCommit, latestCommit, expected] of [[old, recent, 'update-available'], [recent, old, 'up-to-date']]) {
        const updater = createApplicationUpdater({
          dataRoot: path.join(root, 'data'), sourceRoot, dshHome, runtimeHost: 'desktop',
          readLocalIdentity: async () => ({ currentVersion: '1.1.0', currentCommit }),
          fetchManifest: async () => ({ version: '1.1.0' }), fetchLatestCommit: async () => latestCommit,
          compareUrl: 'http://127.0.0.1:1/no-network-expected',
          fetchCdnMetadata: async () => { throw new Error('no fallback expected') },
        })
        assert.equal((await updater.check()).phase, expected)
      }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('无 Git 的安装使用提交比较接口，校验比较方向并处理限流及错误响应', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-api-'))
  const currentCommit = 'a'.repeat(40)
  const latestCommit = 'b'.repeat(40)
  let status = 'ahead'
  let base = currentCommit
  let code = 200
  const urls = []
  const server = createServer((req, res) => {
    urls.push(req.url)
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status, base_commit: { sha: base } }))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, dshHome: root, runtimeHost: 'desktop',
      readLocalIdentity: async () => ({ currentVersion: '1.1.0', currentCommit }),
      fetchManifest: async () => ({ version: '1.1.0' }), fetchLatestCommit: async () => latestCommit,
      compareUrl: `http://127.0.0.1:${server.address().port}/compare`,
      fetchCdnMetadata: async () => { throw new Error('offline') },
      spawnProcess() { assert.fail('不应启动安装') },
    })
    for (const [relation, expected] of [['ahead', 'update-available'], ['behind', 'up-to-date'], ['diverged', 'check-failed'], ['nonsense', 'check-failed']]) {
      status = relation
      assert.equal((await updater.check()).phase, expected)
    }
    status = 'ahead'
    base = latestCommit
    assert.equal((await updater.check()).phase, 'check-failed')
    base = currentCommit
    code = 403
    assert.equal((await updater.check()).phase, 'check-failed')
    await assert.rejects(() => updater.start(), /尚未开始下载/)
    assert.ok(urls.length >= 7)
    assert.ok(urls.every(url => url === `/compare/${currentCommit}...${latestCommit}`))
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub 路径的较高版本号不能绕过提交先后判断，未知本地构建不能盲目安装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-version-'))
  try {
    const common = {
      ...verifiedUpdate, dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
      fetchManifest: async () => ({ version: '99.0.0' }), compareCommits: async () => 'behind',
      spawnProcess() { assert.fail('不能启动安装') },
    }
    assert.equal((await createApplicationUpdater(common).start()).phase, 'up-to-date')
    const unknown = createApplicationUpdater({ ...common, readLocalIdentity: async () => ({ currentVersion: 'unknown', currentCommit: '' }) })
    assert.equal((await unknown.check()).phase, 'check-failed')
    await assert.rejects(() => unknown.start(), /尚未开始下载/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('旧算法的更新提示失效，新算法已核验的提示跨重启保留，本地改变后失效', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-order-cache-'))
  try {
    const dataRoot = path.join(root, 'data')
    await mkdir(dataRoot)
    await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify({ phase: 'update-available', ...knownIdentity, latestCommit: 'b'.repeat(40) }))
    const options = { ...verifiedUpdate, dataRoot, sourceRoot: root, runtimeHost: 'desktop' }
    const updater = createApplicationUpdater(options)
    assert.equal((await updater.status()).phase, 'idle')
    assert.equal((await updater.check()).phase, 'update-available')
    assert.equal((await createApplicationUpdater(options).status()).phase, 'update-available')
    const changed = createApplicationUpdater({ ...options, readLocalIdentity: async () => ({ ...knownIdentity, currentCommit: 'c'.repeat(40) }) })
    assert.equal((await changed.status()).phase, 'idle')
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const source of ['github']) {
  for (const relation of ['behind', 'diverged', 'unavailable', 'ahead']) {
    test(`${source} 根据提交先后判断更新：${relation}，检查和安装使用同一保护`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-update-order-'))
      try {
        const currentCommit = '59aabc3ac90055e017065fceb1d0855fc94ad60e'
        const latestCommit = '5f68b3423908a593239a19e07359cef5d53aaaab'
        await writeFile(path.join(root, 'package.json'), '{"version":"1.1.0"}')
        let spawned = 0
        const updater = createApplicationUpdater({
          dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
          readLocalIdentity: async () => ({ currentVersion: '1.1.0', currentCommit }),
          fetchManifest: async () => {
            if (source === 'jsdelivr') throw new Error('offline')
            return { version: '1.1.0' }
          },
          fetchLatestCommit: async () => latestCommit,
          fetchCdnMetadata: async () => {
            if (source === 'github') throw new Error('offline')
            return { revision: latestCommit, files: [{ path: 'package.json', sha256: 'a'.repeat(64) }] }
          },
          compareCommits: async (current, latest) => {
            assert.equal(current, currentCommit)
            assert.equal(latest, latestCommit)
            if (relation === 'unavailable') throw new Error('无法确认提交先后')
            return relation
          },
          spawnProcess() { spawned += 1; return { unref() {} } },
        })
        const checked = await updater.check()
        assert.equal(checked.phase, relation === 'ahead' ? 'update-available' : relation === 'behind' ? 'up-to-date' : 'check-failed')
        if (relation === 'unavailable' || relation === 'diverged') {
          await assert.rejects(() => updater.start(), /尚未开始下载/)
        } else {
          assert.equal((await updater.start()).phase, relation === 'ahead' ? 'running' : 'up-to-date')
        }
        assert.equal(spawned, relation === 'ahead' ? 1 : 0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}

test('版本相同时不下载、不停止服务', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-version-'))
  try {
    const dataRoot = path.join(root, 'data')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.1' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: root,
      runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.7.1' }),
      fetchLatestCommit: async () => 'a'.repeat(40),
      spawnProcess() { spawned += 1 },
      now: () => 123,
    })

    assert.deepEqual(await updater.start(), {
      phase: 'up-to-date', host: 'cli', checkedAt: 123, currentVersion: '0.7.1', latestVersion: '0.7.1',
      currentCommit: 'a'.repeat(40), latestCommit: 'a'.repeat(40),
      checkSource: 'github', checkWarning: undefined,
    })
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('检查更新只返回最新提交状态，不启动安装进程', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-check-'))
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.9.0' }), fetchLatestCommit: async () => 'b'.repeat(40),
      compareCommits: async () => 'ahead',
      spawnProcess() { spawned += 1 }, now: () => 234,
    })

    assert.deepEqual(await updater.status(), {
      phase: 'idle', host: 'cli', currentVersion: '0.9.0', currentCommit: 'a'.repeat(40),
    })
    assert.deepEqual(await updater.check(), {
      checkPolicy: 3, checkedForCommit: 'a'.repeat(40),
      phase: 'update-available', host: 'cli', checkedAt: 234,
      currentVersion: '0.9.0', latestVersion: '0.9.0',
      currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40),
      checkSource: 'github', checkWarning: undefined,
    })
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('高频状态读取复用本地身份，显式检查只重新验证一次', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-identity-cache-'))
  try {
    let identityReads = 0
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      readLocalIdentity: async () => {
        identityReads += 1
        return { currentVersion: '0.9.2', currentCommit: 'a'.repeat(40) }
      },
      fetchManifest: async () => ({ version: '0.9.2' }),
      fetchLatestCommit: async () => 'a'.repeat(40),
      now: () => 240,
    })

    await updater.status()
    await updater.status()
    await updater.status()
    assert.equal(identityReads, 1)

    await updater.check()
    assert.equal(identityReads, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub 最新提交仅发布运行清单时，以父提交作为最新运行构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-manifest-commit-'))
  try {
    const runtimeCommit = 'a'.repeat(40)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: runtimeCommit }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.9.0' }),
      fetchLatestCommit: async () => ({
        sha: 'b'.repeat(40),
        parents: [{ sha: runtimeCommit }],
        files: [{ filename: 'dsh-tavern-runtime.json' }],
      }),
      fetchCdnMetadata: async () => { throw new Error('备用源不应参与本用例') },
      now: () => 250,
    })

    assert.deepEqual(await updater.check(), {
      checkPolicy: 3, checkedForCommit: runtimeCommit,
      phase: 'up-to-date', host: 'cli', checkedAt: 250,
      currentVersion: '0.9.0', latestVersion: '0.9.0',
      currentCommit: runtimeCommit, latestCommit: runtimeCommit,
      checkSource: 'github', checkWarning: undefined,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('本地 HEAD 仅发布运行清单时，以清单中的运行提交作为当前构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-local-manifest-'))
  try {
    const runtimeCommit = 'a'.repeat(40)
    const manifestCommit = 'b'.repeat(40)
    const packageText = JSON.stringify({ version: '0.9.2' })
    await mkdir(path.join(root, '.git', 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), `${manifestCommit}\n`)
    await writeFile(path.join(root, 'package.json'), packageText)
    await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
      schemaVersion: 1,
      revision: runtimeCommit,
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => ({ version: '0.9.2' }),
      fetchLatestCommit: async () => ({
        sha: manifestCommit,
        parents: [{ sha: runtimeCommit }],
        files: [{ filename: 'dsh-tavern-runtime.json' }],
      }),
      now: () => 260,
    })

    assert.equal((await updater.status()).currentCommit, runtimeCommit)
    assert.equal((await updater.check()).phase, 'up-to-date')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('安装器记录清单发布提交后，重启检查仍识别实际运行构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-installed-manifest-'))
  try {
    const runtimeCommit = 'a'.repeat(40)
    const manifestCommit = 'b'.repeat(40)
    const packageText = JSON.stringify({ version: '0.9.2' })
    await writeFile(path.join(root, 'package.json'), packageText)
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: manifestCommit }))
    await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
      schemaVersion: 1,
      revision: runtimeCommit,
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
      fetchManifest: async () => ({ version: '0.9.2' }),
      fetchLatestCommit: async () => ({
        sha: manifestCommit,
        parents: [{ sha: runtimeCommit }],
        files: [{ filename: 'dsh-tavern-runtime.json' }],
      }),
      now: () => 270,
    })

    const result = await updater.check()
    assert.equal(result.phase, 'up-to-date')
    assert.equal(result.currentCommit, runtimeCommit)
    assert.equal(result.latestCommit, runtimeCommit)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('缺少可校验运行清单时，发布提交也不会造成重复更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-published-commit-'))
  try {
    const runtimeCommit = 'a'.repeat(40)
    const manifestCommit = 'b'.repeat(40)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.2' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: manifestCommit }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
      fetchManifest: async () => ({ version: '0.9.2' }),
      fetchLatestCommit: async () => ({
        sha: manifestCommit,
        parents: [{ sha: runtimeCommit }],
        files: [{ filename: 'dsh-tavern-runtime.json' }],
      }),
      now: () => 280,
    })

    const result = await updater.check()
    assert.equal(result.phase, 'up-to-date')
    assert.equal(result.currentCommit, runtimeCommit)
    assert.equal(result.latestCommit, runtimeCommit)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('检查更新失败时保留当前构建信息且不启动安装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-check-failed-'))
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.0' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'c'.repeat(40) }))
    let spawned = 0
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => { throw new Error('offline') },
      fetchLatestCommit: async () => { throw new Error('offline') },
      fetchCdnMetadata: async () => { throw new Error('offline') },
      spawnProcess() { spawned += 1 }, now: () => 345,
    })

    const result = await updater.check()
    assert.equal(result.phase, 'check-failed')
    assert.equal(result.currentVersion, '0.9.0')
    assert.equal(result.currentCommit, 'c'.repeat(40))
    assert.match(result.error, /无法检查更新/)
    assert.equal(spawned, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('状态缓存中的旧提交号不会覆盖当前本地构建', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-current-identity-'))
  try {
    const dataRoot = path.join(root, 'data')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.1' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'd'.repeat(40) }))
    await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify({
      phase: 'update-available', host: 'cli', checkedAt: 123,
      currentVersion: '0.9.0', currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40),
    }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: root, runtimeHost: 'cli' })

    const result = await updater.status()
    assert.equal(result.currentVersion, '0.9.1')
    assert.equal(result.currentCommit, 'd'.repeat(40))
    assert.equal(result.latestCommit, undefined)
    assert.equal(result.phase, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('jsDelivr 发布序号阻止缓存倒退，并允许无 GitHub 更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-cdn-'))
  try {
    const packageText = JSON.stringify({ version: '0.7.2' })
    await writeFile(path.join(root, 'package.json'), packageText)
    await writeFile(path.join(root, 'dsh-tavern-runtime.json'), JSON.stringify({
      schemaVersion: 2, revision: 'a'.repeat(40), releaseSequence: 42, version: '0.7.2',
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }))
    const metadata = {
      schemaVersion: 2, revision: '9'.repeat(40), releaseSequence: 43, version: '0.7.2',
      files: [{ path: 'package.json', sha256: createHash('sha256').update(packageText).digest('hex') }],
    }
    const common = {
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'cli',
      fetchManifest: async () => { throw new Error('fetch failed') },
      fetchLatestCommit: async () => { throw new Error('fetch failed') },
      fetchCdnMetadata: async () => metadata,
      compareCommits: async () => { throw new Error('GitHub 不应参与 CDN 发布序号判断') },
      now: () => 321,
    }
    const current = await createApplicationUpdater(common).start()
    assert.equal(current.phase, 'up-to-date')
    assert.equal(current.checkSource, 'jsdelivr')

    metadata.files[0].sha256 = createHash('sha256').update('new package').digest('hex')
    metadata.releaseSequence = 41
    assert.equal((await createApplicationUpdater(common).start()).phase, 'up-to-date')

    metadata.releaseSequence = 43
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const changed = await createApplicationUpdater({ ...common, platform: 'linux', spawnProcess() { return child } }).start()
    assert.equal(changed.phase, 'running')
    assert.equal(changed.checkSource, 'jsdelivr')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('国内网络只访问 jsDelivr 也能确认更高版本，无需 GitHub 提交比较', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-cdn-only-'))
  try {
    const packageText = JSON.stringify({ version: '1.1.0' })
    await writeFile(path.join(root, 'package.json'), packageText)
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'desktop',
      fetchManifest: async () => { throw new Error('raw GitHub must not be required') },
      fetchLatestCommit: async () => { throw new Error('GitHub API must not be required') },
      fetchCdnMetadata: async () => ({
        schemaVersion: 2,
        revision: 'b'.repeat(40),
        releaseSequence: 42,
        version: '1.1.1',
        files: [{ path: 'package.json', sha256: createHash('sha256').update('{"version":"1.1.1"}').digest('hex') }],
      }),
      compareCommits: async () => { throw new Error('GitHub commit comparison must not be required') },
      now: () => 400,
    })

    const result = await updater.check()
    assert.equal(result.phase, 'update-available')
    assert.equal(result.checkSource, 'jsdelivr')
    assert.equal(result.latestVersion, '1.1.1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('版本号相同但远端提交更新时仍启动更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-commit-'))
  try {
    const dataRoot = path.join(root, 'data')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.2' }))
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
    const calls = []
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: root,
      runtimeHost: 'cli',
      platform: 'linux',
      fetchManifest: async () => ({ version: '0.7.2' }),
      fetchLatestCommit: async () => 'b'.repeat(40),
      compareCommits: async () => 'ahead',
      spawnProcess(command, args) { calls.push({ command, args }); return child },
      now: () => 456,
    })

    const result = await updater.start()
    assert.equal(result.phase, 'running')
    assert.equal(result.currentCommit, 'a'.repeat(40))
    assert.equal(result.latestCommit, 'b'.repeat(40))
    assert.deepEqual(calls[0].args.slice(-2), ['--target-commit', 'b'.repeat(40)])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('完整 Git 安装可直接从 HEAD 识别当前提交', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-git-head-'))
  try {
    const commit = 'c'.repeat(40)
    await mkdir(path.join(root, '.git', 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), `${commit}\n`)
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.2' }))
    const updater = createApplicationUpdater({
      dataRoot: path.join(root, 'data'), sourceRoot: root, runtimeHost: 'android',
      fetchManifest: async () => ({ version: '0.7.2' }), fetchLatestCommit: async () => commit,
      now: () => 789,
    })

    assert.equal((await updater.start()).phase, 'up-to-date')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('乱码更新错误替换为可执行的重新安装提示', () => {
  assert.equal(sanitizeUpdateError('�������� DSH Tavern����'), '更新失败：安装程序输出编码异常。建议重新安装一次。')
  assert.equal(sanitizeUpdateError('服务启动失败'), '服务启动失败')
})

test('UI 更新沿用 Profile 中记录的 Desktop 宿主并脱离当前服务执行', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'desktop' } }))
    const calls = []
    const child = { pid: 4321, unrefCalled: false, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() { this.unrefCalled = true } }
    const updater = createApplicationUpdater({
      ...verifiedUpdate,
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      execPath: '/runtime/node',
      platform: 'linux',
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
      now: () => 123,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'desktop', ...knownIdentity })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'desktop', startedAt: 123, pid: 4321, ...runningVersion })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].command, '/runtime/node')
    assert.deepEqual(calls[0].args.slice(0, 4), [path.join(path.resolve('/app/dsh-tavern'), 'bin', 'dsh-tavern.mjs'), 'update', '--host', 'desktop'])
    assert.ok(calls[0].args.includes('--status-file'))
    assert.ok(calls[0].args.includes('--delay=800'))
    assert.equal(calls[0].options.detached, true)
    assert.equal(child.unrefCalled, true)
    assert.deepEqual(JSON.parse(await readFile(path.join(dataRoot, 'update-status.json'), 'utf8')), JSON.parse(JSON.stringify({ phase: 'running', host: 'desktop', startedAt: 123, pid: 4321, ...runningVersion })))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新任务正在运行时拒绝重复启动', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'cli' } }))
    let spawned = 0
    const updater = createApplicationUpdater({
      ...verifiedUpdate,
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      spawnProcess() { spawned += 1; return { once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} } },
      now: () => 1000,
    })

    await updater.start()
    await assert.rejects(() => updater.start(), /更新正在进行/)
    assert.equal(spawned, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('超过十五分钟的更新自动标记为中断并持久化', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'running', host: 'desktop', startedAt: 1000 }))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 1000 + (15 * 60 * 1000),
    })

    assert.deepEqual(await updater.status(), {
      phase: 'failed', host: 'desktop', failedAt: 901000, error: '上次更新已中断', currentVersion: 'unknown', currentCommit: '',
    })
    assert.deepEqual(JSON.parse(await readFile(statusFile, 'utf8')), {
      phase: 'failed', host: 'desktop', failedAt: 901000, error: '上次更新已中断',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新进程已经退出时立即恢复按钮', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'running', host: 'desktop', startedAt: 1000, pid: 4321 }))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 2000,
      isProcessAlive: () => false,
    })

    assert.deepEqual(await updater.status(), {
      phase: 'failed', host: 'desktop', failedAt: 2000, error: '上次更新已中断', currentVersion: 'unknown', currentCommit: '',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新进程仍存活时保持运行状态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const running = { phase: 'running', host: 'desktop', startedAt: 1000, pid: 4321 }
    await mkdir(dataRoot, { recursive: true })
    await writeFile(path.join(dataRoot, 'update-status.json'), JSON.stringify(running))
    const updater = createApplicationUpdater({
      dataRoot,
      sourceRoot: '/app/dsh-tavern',
      dshHome: root,
      now: () => 2000,
      isProcessAlive: () => true,
    })

    assert.deepEqual(await updater.status(), { ...running, currentVersion: 'unknown', currentCommit: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('当前 CLI 运行方式优先于共享 Profile 的 Desktop 安装记录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'desktop' } }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: '/app/dsh-tavern', dshHome: root, runtimeHost: 'cli' })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'cli', currentVersion: 'unknown', currentCommit: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Android 安装记录让 UI 更新任务沿用 Android 宿主', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const dataRoot = path.join(root, 'profile-data/tavern/data')
    const profileManifest = path.join(root, 'profiles/tavern/package.json')
    await mkdir(path.dirname(profileManifest), { recursive: true })
    await writeFile(profileManifest, JSON.stringify({ dshTavern: { host: 'android' } }))
    const calls = []
    const child = { once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      ...verifiedUpdate,
      dataRoot,
      sourceRoot: '/storage/emulated/0/dsh-tavern',
      dshHome: root,
      execPath: '/runtime/node',
      platform: 'linux',
      spawnProcess(command, args) { calls.push({ command, args }); return child },
      now: () => 456,
    })

    assert.deepEqual(await updater.status(), { phase: 'idle', host: 'android', ...knownIdentity })
    assert.deepEqual(await updater.start(), { phase: 'running', host: 'android', startedAt: 456, ...runningVersion })
    assert.deepEqual(calls[0].args.slice(0, 4), [
      path.join(path.resolve('/storage/emulated/0/dsh-tavern'), 'bin', 'dsh-tavern.mjs'), 'update', '--host', 'android',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('手动重启后把“文件已更新”状态收敛为更新完成', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-recovered-'))
  try {
    const dataRoot = path.join(root, 'data')
    const statusFile = path.join(dataRoot, 'update-status.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(statusFile, JSON.stringify({ phase: 'installed-restart-required', host: 'cli', targetCommit: 'f'.repeat(40) }))
    const updater = createApplicationUpdater({ dataRoot, sourceRoot: root, runtimeHost: 'cli', now: () => 2345 })
    assert.deepEqual(await updater.status(), {
      phase: 'completed', host: 'cli', completedAt: 2345, targetCommit: 'f'.repeat(40), recoveredByRestart: true,
      currentVersion: 'unknown', currentCommit: '',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows UI 更新通过短生命周期 helper 与服务进程树脱钩', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-updater-'))
  try {
    const calls = []
    const child = { pid: 4321, once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
    const updater = createApplicationUpdater({
      ...verifiedUpdate,
      dataRoot: path.join(root, 'profile-data/tavern/data'),
      sourceRoot: 'C:\\app\\dsh-tavern',
      dshHome: root,
      execPath: 'C:\\runtime\\node.exe',
      platform: 'win32',
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
      now: () => 789,
    })

    assert.deepEqual(await updater.start(), { phase: 'running', host: 'cli', startedAt: 789, ...runningVersion })
    assert.equal(calls[0].command, 'C:\\runtime\\node.exe')
    assert.match(calls[0].args[0], /bin[\\/]dsh-tavern-update-helper\.mjs$/)
    assert.equal(calls[0].args[1], 'C:\\runtime\\node.exe')
    assert.ok(calls[0].args.includes('--status-file'))
    assert.equal(calls[0].options.windowsHide, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
