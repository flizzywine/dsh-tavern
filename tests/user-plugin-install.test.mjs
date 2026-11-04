// 应用内安装插件：GitHub 地址 / ZIP → plugins/<文件夹>，列出加载情况，更新与删除都留备份。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { comparePluginVersions, createUserPluginInstaller, parseGithubSource, readPluginArchive } from '../tavern-plugin/lib/domain/user-plugin-install.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const pluginZip = (files, root = 'author-dsh-tavern-hello-abc123/') => writeZipEntries(Object.entries(files).map(([name, content]) => ({ path: root + name, content: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) })))
const hello = (version = '1.0.0', extra = {}) => pluginZip({
  'package.json': { name: 'dsh-tavern-hello', version, description: '打招呼', type: 'module', exports: { '.': './index.mjs' }, ...extra },
  'index.mjs': 'export function apply() {}',
  'README.md': '# hello',
  '.github/workflows/ci.yml': 'x',
})

async function setup(t, fetchImpl, installerOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'profile-data', 'tavern', 'data')
  await mkdir(dataRoot, { recursive: true })
  let syncs = 0
  const installer = createUserPluginInstaller({ dataRoot, fetchImpl, sync: async () => { syncs++ }, ...installerOptions })
  return { root, dataRoot, installer, plugins: path.join(dataRoot, 'plugins'), syncs: () => syncs }
}

test('GitHub 地址：仓库、.git、tree/分支 都认；其他网站拒绝', () => {
  assert.deepEqual(parseGithubSource('https://github.com/a/b'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('https://github.com/a/b.git/'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('a/b'), { owner: 'a', repo: 'b', ref: null })
  assert.deepEqual(parseGithubSource('https://github.com/a/b/tree/dev/x'), { owner: 'a', repo: 'b', ref: 'dev/x' })
  assert.throws(() => parseGithubSource('https://gitee.com/a/b'), /github\.com/)
  assert.throws(() => parseGithubSource('http://github.com/a/b'), /github\.com/)
  assert.throws(() => parseGithubSource('随便写'), /GitHub 仓库地址/)
})

test('版本比较：认 v 前缀、预发布和不同段数，认不出的返回 null', () => {
  assert.equal(comparePluginVersions('v0.2.2', '0.2.2'), 0)
  assert.equal(comparePluginVersions('0.10.0', '0.9.9'), 1)
  assert.equal(comparePluginVersions('1.0', '1.0.0'), 0)
  assert.equal(comparePluginVersions('0.2.2+build.7', '0.2.2'), 0)
  assert.equal(comparePluginVersions('1.0.0', '1.0.0-beta.2'), 1)
  assert.equal(comparePluginVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(comparePluginVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(comparePluginVersions('nightly', '1.0.0'), null)
  assert.equal(comparePluginVersions('v1.0.0', ''), null)
})

test('压缩包检查：找插件根，去掉 .github；缺入口、依赖 npm 包都说清楚', () => {
  const { pkg, files } = readPluginArchive(hello())
  assert.equal(pkg.name, 'dsh-tavern-hello')
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'index.mjs', 'package.json'])
  assert.throws(() => readPluginArchive(pluginZip({ 'README.md': 'x' })), /没有 package\.json/)
  assert.throws(() => readPluginArchive(pluginZip({ 'package.json': { name: 'x', version: '1.0.0' } })), /宿主入口/)
  assert.throws(() => readPluginArchive(pluginZip({ 'package.json': { name: 'x', version: '1.0.0', main: 'index.mjs' } })), /找不到宿主入口/)
  assert.throws(() => readPluginArchive(hello('1.0.0', { dependencies: { sharp: '1' } })), /依赖 npm 包（sharp）/)
  // 自带 node_modules 的插件可以装。
  const bundled = pluginZip({ 'package.json': { name: 'x', version: '1.0.0', main: 'index.mjs', dependencies: { y: '1' } }, 'index.mjs': '', 'node_modules/y/index.js': '' })
  assert.ok(readPluginArchive(bundled).files.has('node_modules/y/index.js'))
  // Tavern 自己的标记文件不能由压缩包带进来（否则作者能伪造加载记录或停用状态）。
  const markers = pluginZip({ 'package.json': { name: 'x', version: '1.0.0', main: 'index.mjs' }, 'index.mjs': '', '.tavern-disabled': '{}', '.tavern-status.json': '{}' })
  assert.deepEqual([...readPluginArchive(markers).files.keys()].sort(), ['index.mjs', 'package.json'])
})

test('上传 ZIP 安装、列表、删除进备份', async t => {
  const { installer, plugins, dataRoot, syncs } = await setup(t)
  const installed = await installer.installFromZip(hello(), 'dsh-tavern-hello.zip')
  assert.deepEqual(installed, { folder: 'dsh-tavern-hello', name: 'dsh-tavern-hello', version: '1.0.0', replaced: false })
  assert.equal(syncs(), 1)
  assert.equal(await readFile(path.join(plugins, 'dsh-tavern-hello', 'index.mjs'), 'utf8'), 'export function apply() {}')
  assert.deepEqual((await readdir(plugins)).filter(name => name.startsWith('.')), [], '不留临时目录')

  let [listed] = await installer.list()
  assert.equal(listed.state, 'pending')
  assert.equal(listed.source.kind, 'zip')
  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-status.json'), JSON.stringify({ ok: false, stage: '启动', message: 'boom' }))
  ;[listed] = await installer.list()
  assert.equal(listed.state, 'failed')
  assert.match(listed.reason, /启动失败：boom/)

  await mkdir(path.join(plugins, 'broken'))
  const broken = (await installer.list()).find(item => item.folder === 'broken')
  assert.equal(broken.state, 'skipped')
  assert.match(broken.reason, /package\.json/)

  const removed = await installer.remove('dsh-tavern-hello')
  assert.ok(removed.backup.startsWith(path.join(dataRoot, 'plugin-backups')))
  assert.ok((await readdir(removed.backup)).includes('index.mjs'))
  await assert.rejects(installer.remove('../x'), /不存在/)
})

test('旧版本留下的更新状态：备份里有过加载记录就提示重启；删除后重装不误判', async t => {
  const { installer, plugins } = await setup(t)
  await installer.installFromZip(hello('1.0.0'), 'hello.zip')
  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-status.json'), JSON.stringify({ ok: true }))
  await installer.installFromZip(hello('1.1.0'), 'hello.zip')
  // 模拟旧版 Tavern 写的来源文件：没有 replaced 字段，也没有新的重启标记。
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  delete source.replaced
  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), JSON.stringify(source))
  await rm(path.join(plugins, 'dsh-tavern-hello', '.tavern-restart.json'))

  let listed = (await installer.list()).find(item => item.folder === 'dsh-tavern-hello')
  assert.equal(listed.state, 'restart', '备份里有加载记录，说明是更新过的旧文件')

  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-status.json'), JSON.stringify({ ok: true }))
  listed = (await installer.list()).find(item => item.folder === 'dsh-tavern-hello')
  assert.equal(listed.state, 'loaded')

  await installer.remove('dsh-tavern-hello')
  await installer.installFromZip(hello('2.0.0'), 'hello.zip')
  listed = (await installer.list()).find(item => item.folder === 'dsh-tavern-hello')
  assert.equal(listed.source.replaced, false)
  assert.equal(listed.state, 'pending', '删除后重新安装是全新安装，不该提示重启')
})

test('检查更新：比已装版本新才算有更新；无 Release、固定分支、检查失败各有状态', async t => {
  const releases = { 'author/newer': 'v1.1.0', 'author/same': 'v2.0.0', 'author/odd': 'nightly-build' }
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    const repo = /\/repos\/([^/]+\/[^/]+)\/releases\/latest$/.exec(url)?.[1]
    if (url.endsWith('/releases/latest')) {
      if (repo === 'author/boom') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
      if (!releases[repo]) return { ok: false, status: 404 }
      return { ok: true, status: 200, json: async () => ({ tag_name: releases[repo] }) }
    }
    return { ok: false, status: 404 }
  }
  const { installer, plugins } = await setup(t, fetchImpl)
  const fake = async (folder, pkg, source) => {
    await mkdir(path.join(plugins, folder), { recursive: true })
    await writeFile(path.join(plugins, folder, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'index.mjs' }))
    await writeFile(path.join(plugins, folder, 'index.mjs'), 'export function apply() {}')
    await writeFile(path.join(plugins, folder, '.tavern-source.json'), JSON.stringify(source))
  }
  await fake('newer', { name: 'a-newer', version: '1.0.0' }, { kind: 'github', repo: 'author/newer' })
  await fake('same', { name: 'a-same', version: '2.0.0' }, { kind: 'github', repo: 'author/same' })
  await fake('odd', { name: 'a-odd', version: '3.0.0' }, { kind: 'github', repo: 'author/odd' })
  await fake('none', { name: 'a-none', version: '1.0.0' }, { kind: 'github', repo: 'author/none' })
  await fake('pinned', { name: 'a-pinned', version: '1.0.0' }, { kind: 'github', repo: 'author/pinned', ref: 'dev' })
  await fake('boom', { name: 'a-boom', version: '1.0.0' }, { kind: 'github', repo: 'author/boom' })
  await fake('manual', { name: 'a-manual', version: '1.0.0' }, { kind: 'folder' })

  const byFolder = async () => Object.fromEntries((await installer.checkUpdates()).map(item => [item.folder, item]))
  const first = await byFolder()
  assert.equal(first.newer.status, 'available')
  assert.equal(first.newer.latest, 'v1.1.0')
  assert.equal(first.same.status, 'latest')
  assert.equal(first.odd.status, 'unknown')
  assert.equal(first.none.status, 'branch')
  assert.equal(first.pinned.status, 'ref')
  assert.equal(first.boom.status, 'error')
  assert.match(first.boom.reason, /连不上 GitHub（ECONNRESET）/)
  assert.equal(first.manual, undefined)
  assert.ok(!calls.some(url => url.includes('/repos/author/pinned/')), '固定分支不查 Release')

  // 5 分钟内重复打开设置不重复请求；网络错误不缓存。
  await byFolder()
  assert.equal(calls.filter(url => url.includes('/repos/author/newer/')).length, 1)
  assert.equal(calls.filter(url => url.includes('/repos/author/same/')).length, 1)
  assert.equal(calls.filter(url => url.includes('/repos/author/boom/')).length, 2)

  // 手动点「检查更新」（fresh）要绕过缓存。
  await installer.checkUpdates({ fresh: true })
  assert.equal(calls.filter(url => url.includes('/repos/author/newer/')).length, 2)
  assert.equal(calls.filter(url => url.includes('/repos/author/same/')).length, 2)
  assert.equal(calls.filter(url => url.includes('/repos/author/boom/')).length, 3)
})

test('GitHub 安装用最新 Release；更新重新下载，旧版进备份；人物卡自带的插件不能覆盖', async t => {
  const calls = []
  let version = '1.0.0'
  const fetchImpl = async url => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: true, status: 200, json: async () => ({ tag_name: 'v' + version }) }
    if (url.includes('/zip/') && !url.endsWith('/zip/HEAD')) { const zip = hello(version); return { ok: true, status: 200, arrayBuffer: async () => zip } }
    return { ok: false, status: 404 }
  }
  const { installer, plugins, dataRoot } = await setup(t, fetchImpl)
  const first = await installer.installFromGithub('https://github.com/author/dsh-tavern-hello')
  assert.equal(first.version, '1.0.0')
  assert.equal(calls.at(-1), 'https://codeload.github.com/author/dsh-tavern-hello/zip/v1.0.0')
  // 下载不走 api.github.com，它只用来问最新 Release 是哪个。
  assert.equal(calls.filter(url => url.includes('/zipball')).length, 0)
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  assert.equal(source.repo, 'author/dsh-tavern-hello')
  assert.equal(source.resolved, 'Release v1.0.0')
  // 一切正常时不留 warning 键，别让空字符串进配置文件。
  assert.equal('warning' in source, false)

  version = '1.1.0'
  const updated = await installer.update('dsh-tavern-hello')
  assert.equal(updated.replaced, true)
  assert.equal(JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', 'package.json'), 'utf8')).version, '1.1.0')
  assert.equal((await readdir(path.join(dataRoot, 'plugin-backups'))).length, 1)
  // 文件换了，但 DSH 还跑着旧模块：刷新页面前必须重启 DSH。
  const replaced = (await installer.list()).find(item => item.folder === 'dsh-tavern-hello')
  assert.equal(replaced.state, 'restart')

  // 重启后保护入口写入加载记录并清掉重启标记，列表变回已加载。
  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-status.json'), JSON.stringify({ ok: true }))
  await rm(path.join(plugins, 'dsh-tavern-hello', '.tavern-restart.json'))
  assert.equal((await installer.list()).find(item => item.folder === 'dsh-tavern-hello').state, 'loaded')

  // 停用状态要跟着插件走，更新不能偷偷把它重新启用。
  await installer.disable('dsh-tavern-hello')
  version = '1.2.0'
  assert.equal((await installer.update('dsh-tavern-hello')).version, '1.2.0')
  const disabledAfterUpdate = (await installer.list()).find(item => item.folder === 'dsh-tavern-hello')
  assert.equal(disabledAfterUpdate.enabled, false)
  assert.equal(disabledAfterUpdate.state, 'disabled')
  // 停用期间更新的文件同样要等重启；启用后先显示重启提示，而不是假装已加载。
  await installer.enable('dsh-tavern-hello')
  assert.equal((await installer.list()).find(item => item.folder === 'dsh-tavern-hello').state, 'restart')

  await writeFile(path.join(plugins, 'dsh-tavern-hello', '.dsh-card.json'), '{}')
  await assert.rejects(installer.installFromZip(hello(), 'x.zip'), /人物卡自带的插件/)
  await assert.rejects(installer.remove('dsh-tavern-hello'), /人物卡库/)
})

test('没有 Release 用默认分支；仓库不存在、连不上都给出办法', async t => {
  const calls = []
  const { installer } = await setup(t, async url => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    if (url.endsWith('/zip/HEAD')) { const zip = hello(); return { ok: true, status: 200, arrayBuffer: async () => zip } }
    return { ok: false, status: 404 }
  })
  await installer.installFromGithub('author/dsh-tavern-hello')
  assert.equal(calls.at(-1), 'https://codeload.github.com/author/dsh-tavern-hello/zip/HEAD')
  await assert.rejects(installer.installFromGithub('https://github.com/author/missing/tree/dev'), /找不到仓库/)

  const offline = await setup(t, async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) })
  await assert.rejects(offline.installer.installFromGithub('a/b'), /连不上 GitHub（ECONNRESET）.*下载 ZIP 后上传/)
})

test('GitHub API 限流（403）不中断安装：退回默认分支并带上说明', async t => {
  const calls = []
  const { installer, plugins } = await setup(t, async url => {
    calls.push(url)
    // 共享出口 IP 把匿名配额用完了：releases/latest 返回 403，但下载通道不受影响。
    if (url.endsWith('/releases/latest')) return { ok: false, status: 403 }
    if (url.endsWith('/zip/HEAD')) { const zip = hello(); return { ok: true, status: 200, arrayBuffer: async () => zip } }
    return { ok: false, status: 404 }
  })
  const installed = await installer.installFromGithub('author/dsh-tavern-hello')
  assert.equal(installed.version, '1.0.0')
  assert.match(installed.warning, /访问次数受限.*默认分支/)
  // 下载仍然走 codeload，不碰被限流的 api.github.com。
  assert.equal(calls.at(-1), 'https://codeload.github.com/author/dsh-tavern-hello/zip/HEAD')
  // 这次确实降级了，附注要留在来源记录里，事后能查到当初为什么没装成 Release。
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  assert.equal(source.resolved, '默认分支')
  assert.match(source.warning, /访问次数受限/)
})

for (const failure of ['network', 'timeout', 'invalid-json', 429, 500, 503]) {
  test(`Release 查询失败（${failure}）仍能安装和更新，并记录降级原因`, async t => {
    const calls = []
    let version = '1.0.0'
    if (failure === 'timeout') {
      t.mock.method(AbortSignal, 'timeout', milliseconds => {
        assert.equal(milliseconds, 5000)
        return AbortSignal.abort(new DOMException('Release query timed out', 'TimeoutError'))
      })
    }
    const { installer, plugins } = await setup(t, async (url, options) => {
      calls.push(url)
      if (url.endsWith('/releases/latest')) {
        if (failure === 'network') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
        if (failure === 'timeout') {
          assert.ok(options.signal, 'Release 查询必须有超时信号')
          options.signal.throwIfAborted()
        }
        if (failure === 'invalid-json') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON') } }
        return { ok: false, status: failure }
      }
      assert.equal(url, 'https://codeload.github.com/author/dsh-tavern-hello/zip/HEAD')
      assert.ok(options.signal, '下载也要有自己的超时信号')
      assert.equal(options.signal.aborted, false, 'Release 查询超时不应取消后续下载')
      return { ok: true, status: 200, arrayBuffer: async () => hello(version) }
    })
    for (const update of [false, true]) {
      if (update) version = '1.1.0'
      const installed = update ? await installer.update('dsh-tavern-hello') : await installer.installFromGithub('author/dsh-tavern-hello')
      assert.equal(installed.version, version)
      assert.match(installed.warning, /Release 信息暂不可用.*已改用默认分支/)
      const reason = failure === 'network' ? /ECONNRESET/ : failure === 'timeout' ? /timed out/ : failure === 'invalid-json' ? /Invalid JSON/ : new RegExp('HTTP ' + failure)
      assert.match(installed.warning, reason)
      const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
      assert.equal(source.resolved, '默认分支')
      assert.equal(source.warning, installed.warning)
    }
    assert.equal(calls.length, 4)
  })
}

test('下载仓库压缩包挂起会超时失败，不会让安装请求永远不返回', async t => {
  const { installer } = await setup(t, async (url, options) => {
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    assert.ok(options.signal, '下载请求必须带超时信号')
    return new Promise(() => {}) // codeload 连上了但永远不发数据
  }, { archiveTimeoutMs: 20 })
  await assert.rejects(
    installer.installFromGithub('https://github.com/author/dsh-tavern-hello'),
    /下载插件超时.*下载 ZIP 后上传/
  )
})

test('body 一直不发数据时也会超时，并取消底层请求', async t => {
  let aborted = false
  const { installer } = await setup(t, async (url, options) => {
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    options.signal.addEventListener('abort', () => { aborted = true })
    return { ok: true, status: 200, arrayBuffer: () => new Promise(() => {}) }
  }, { archiveTimeoutMs: 20 })
  await assert.rejects(installer.installFromGithub('author/dsh-tavern-hello'), /下载插件超时/)
  assert.equal(aborted, true)
})

test('指定分支时跳过 Release 查询；没有 Release 时正常安装不产生 warning', async t => {
  const calls = []
  const { installer, plugins } = await setup(t, async url => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    return { ok: true, status: 200, arrayBuffer: async () => hello() }
  })
  const explicit = await installer.installFromGithub('https://github.com/author/dsh-tavern-hello/tree/dev/x')
  assert.deepEqual(calls, ['https://codeload.github.com/author/dsh-tavern-hello/zip/dev%2Fx'])
  assert.equal('warning' in explicit, false)
  const installed = await installer.installFromGithub('author/dsh-tavern-hello')
  assert.equal('warning' in installed, false)
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  assert.equal('warning' in source, false)
})

test('删除插件时，插件数据随文件夹一起进备份；更新不动插件数据', async t => {
  const { createPluginDataStore } = await import('../tavern-plugin/lib/domain/plugin-data-store.js')
  const { installer, dataRoot } = await setup(t)
  const store = createPluginDataStore({ dataRoot })
  await installer.installFromZip(hello(), 'hello.zip')
  await store.save('dsh-tavern-hello', { style: 'anime' })
  await installer.installFromZip(hello('1.1.0'), 'hello.zip')
  assert.deepEqual(await store.read('dsh-tavern-hello'), { style: 'anime' }, '更新后设置还在')
  const removed = await installer.remove('dsh-tavern-hello')
  assert.equal(await store.read('dsh-tavern-hello'), null)
  assert.deepEqual(JSON.parse(await readFile(path.join(removed.backup, '.plugin-data.json'), 'utf8')), { style: 'anime' })
})

test('舞台管理标记与普通人物卡插件分开识别', async t => {
  const {installer,plugins}=await setup(t)
  for (const [folder,marker] of [['stage',{managed:true,modId:'dsh.dice'}],['card',{cards:['a']}],['custom',{managed:true,modId:'custom.mod'}]]) {
    await mkdir(path.join(plugins,folder),{recursive:true})
    await writeFile(path.join(plugins,folder,'package.json'),JSON.stringify({name:folder,version:'1.0.0'}))
    await writeFile(path.join(plugins,folder,'.dsh-card.json'),JSON.stringify(marker))
  }
  const rows=await installer.list()
  assert.deepEqual(rows.find(x=>x.folder==='stage').source,{kind:'managed',modId:'dsh.dice',builtin:true})
  assert.deepEqual(rows.find(x=>x.folder==='card').source,{kind:'card'})
  assert.equal(rows.find(x=>x.folder==='custom').source.builtin,false)
})

test('内置配图默认启用，标注内置来源且拒绝删除', async t => {
  const {installer,plugins}=await setup(t)
  const dir=path.join(plugins,'dsh-tavern-image')
  await mkdir(dir,{recursive:true})
  await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'dsh-tavern-image',version:'3.4.0'}))
  const [row]=await installer.list()
  assert.equal(row.enabled,true)
  assert.equal(row.source.kind,'builtin')
  await assert.rejects(installer.remove('dsh-tavern-image'),/内置配图插件/)
  assert.equal(JSON.parse(await readFile(path.join(dir,'package.json'),'utf8')).name,'dsh-tavern-image')
})

// 国内网络经常只封 github.com：连不上时换 jsDelivr（它按「文件列表 + 单文件」取代码）。
const jsdelivrTree = files => ({ files: Object.entries(files).map(([name, content]) => ({ name, size: Buffer.byteLength(content) })) })
const jsdelivrPlugin = version => ({
  '/package.json': JSON.stringify({ name: 'dsh-tavern-hello', version, type: 'module', exports: { '.': './index.mjs' } }),
  '/index.mjs': 'export function apply() {}',
  '/README.md': '# hello',
  '/.github/workflows/ci.yml': 'x',
  '/node_modules/.cache/blob.js': 'cache',
})
const offline = () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) }

test('连不上 GitHub 时改走 jsDelivr：按文件列表逐个下载，装成同一套插件目录', async t => {
  const calls = []
  let version = '1.0.0'
  const files = () => jsdelivrPlugin(version)
  const { installer, plugins } = await setup(t, async (url, options) => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    if (url.startsWith('https://codeload.github.com/')) return offline()
    if (url.startsWith('https://data.jsdelivr.com/v1/packages/gh/author/dsh-tavern-hello@HEAD')) return { ok: true, status: 200, json: async () => jsdelivrTree(files()) }
    const relative = url.replace('https://cdn.jsdelivr.net/gh/author/dsh-tavern-hello@HEAD', '')
    assert.ok(options.signal, 'jsDelivr 的每个文件请求也要有自己的超时信号')
    const content = files()[relative]
    if (content === undefined) return { ok: false, status: 404 }
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(content) }
  })
  const installed = await installer.installFromGithub('https://github.com/author/dsh-tavern-hello')
  assert.equal(installed.version, '1.0.0')
  assert.match(installed.warning, /连不上 GitHub，已改用 jsDelivr（HEAD）/)
  assert.ok(calls.includes('https://data.jsdelivr.com/v1/packages/gh/author/dsh-tavern-hello@HEAD?structure=flat'))
  assert.ok(calls.includes('https://cdn.jsdelivr.net/gh/author/dsh-tavern-hello@HEAD/index.mjs'))
  assert.equal(await readFile(path.join(plugins, 'dsh-tavern-hello', 'index.mjs'), 'utf8'), 'export function apply() {}')
  // 来源记录里要写清楚这次是走备用线路装的。
  const source = JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', '.tavern-source.json'), 'utf8'))
  assert.equal(source.resolved, 'jsDelivr HEAD')
  assert.match(source.warning, /已改用 jsDelivr/)

  // 更新照旧：GitHub 还是不通，就再从 jsDelivr 拉一遍新版。
  version = '1.1.0'
  const updated = await installer.update('dsh-tavern-hello')
  assert.equal(updated.version, '1.1.0')
  assert.match(updated.warning, /已改用 jsDelivr/)
  assert.equal(JSON.parse(await readFile(path.join(plugins, 'dsh-tavern-hello', 'package.json'), 'utf8')).version, '1.1.0')
})

test('jsDelivr 只取插件需要的文件：.github、缓存目录都不落地；地址里写了分支就下同一分支', async t => {
  const calls = []
  const content = jsdelivrPlugin('1.0.0')
  const { installer, plugins } = await setup(t, async url => {
    calls.push(url)
    if (url.startsWith('https://codeload.github.com/')) return offline()
    if (url.includes('data.jsdelivr.com')) return { ok: true, status: 200, json: async () => jsdelivrTree(content) }
    const relative = decodeURIComponent(url.replace('https://cdn.jsdelivr.net/gh/author/dsh-tavern-hello@dev%2Fx', ''))
    const bytes = content[relative]
    return bytes === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, arrayBuffer: async () => Buffer.from(bytes) }
  })
  await installer.installFromGithub('https://github.com/author/dsh-tavern-hello/tree/dev/x')
  const entries = (await readdir(path.join(plugins, 'dsh-tavern-hello'))).sort()
  assert.deepEqual(entries, ['.tavern-source.json', 'README.md', 'index.mjs', 'package.json'])
  assert.ok(calls.includes('https://data.jsdelivr.com/v1/packages/gh/author/dsh-tavern-hello@dev%2Fx?structure=flat'))
  // 指定分支时不问 Release，直接换线路下载。
  assert.ok(!calls.some(url => url.endsWith('/releases/latest')))
})

test('两条线路都不通时说清两边原因，并留 ZIP 上传的办法；仓库 404 不会去试备用线路', async t => {
  const calls = []
  await setup(t, async url => {
    calls.push(url)
    if (url.startsWith('https://codeload.github.com/')) return offline()
    return offline()
  }).then(async ({ installer }) => {
    await assert.rejects(
      installer.installFromGithub('author/dsh-tavern-hello'),
      /连不上 GitHub（ECONNRESET）；备用线路 jsDelivr 也没成功（连不上 jsDelivr（ECONNRESET））。.*下载 ZIP 后上传/
    )
  })
  assert.ok(calls.some(url => url.includes('data.jsdelivr.com')), '备用线路确实被试过')

  const missing = []
  await setup(t, async url => {
    missing.push(url)
    if (url.endsWith('/releases/latest')) return { ok: false, status: 404 }
    return { ok: false, status: 404 }
  }).then(async ({ installer }) => {
    await assert.rejects(installer.installFromGithub('author/missing'), /找不到仓库 author\/missing/)
  })
  assert.ok(!missing.some(url => url.includes('jsdelivr')), '仓库不存在换线路也没用，别多发请求')
})
