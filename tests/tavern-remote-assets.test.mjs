import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernRemoteAssetPinStore, inspectMutableJsDelivrUrls } from '../tavern-plugin/lib/domain/tavern-remote-assets.js'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

function textResponse(content = 'globalThis.entryLoaded = true', mediaType = 'text/javascript') {
  return { ok: true, headers: { get: function () { return mediaType } }, text: async function () { return content } }
}

test('识别 jsDelivr 的可漂移 GitHub 引用但忽略固定提交', function () {
  const text = "import 'https://cdn.jsdelivr.net/gh/example/repo@main/a.js'; import 'https://cdn.jsdelivr.net/gh/example/repo@" + COMMIT + "/b.js'"
  assert.deepEqual(inspectMutableJsDelivrUrls(text).map(function (item) { return [item.owner, item.repo, item.ref, item.path] }), [
    ['example', 'repo', 'main', '/a.js']
  ])
})

test('没有显式版本的 GitHub CDN 地址按默认分支 HEAD 锁定', async function () {
  const source = "import 'https://cdn.jsdelivr.net/gh/example/repo/artifact/bundle.js'"
  const store = createTavernRemoteAssetPinStore({
    fetch: async function (url) { return String(url).includes('api.github.com') ? { ok: false, status: 403 } : textResponse() },
    resolveGitRef: async function (reference) { assert.equal(reference.ref, 'HEAD'); return COMMIT }
  })
  const result = await store.pinText(source)
  assert.match(result.text, /\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}/)
})

test('GitHub API 配额耗尽时使用 Git 只读解析后备', async function () {
  const source = "import 'https://cdn.jsdelivr.net/gh/example/repo@main/index.js'"
  const store = createTavernRemoteAssetPinStore({
    fetch: async function (url) { return String(url).includes('api.github.com') ? { ok: false, status: 403 } : textResponse() },
    resolveGitRef: async function (reference) { assert.equal(reference.ref, 'main'); return COMMIT }
  })
  const result = await store.pinText(source)
  assert.match(result.text, /\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}/)
  assert.equal(result.diagnostics.length, 0)
})

test('首次解析远程分支后写入固定提交，后续启动复用持久记录', async function () {
  let saved = null
  let requests = 0
  const store = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function (_path, updater) { saved = updater(saved) },
    fetch: async function (url) {
      requests++
      return String(url).includes('api.github.com') ? { ok: true, json: async function () { return { sha: COMMIT } } } : textResponse()
    }
  })
  const source = "import 'https://testingcf.jsdelivr.net/gh/Alice/Apeiria@main/变量守卫/index.js'"
  const first = await store.pinText(source)
  assert.match(first.text, /\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}/)
  assert.equal(requests, 2)
  assert.equal(saved.pins['Alice/Apeiria@main'].commit, COMMIT)

  const restarted = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function () { throw new Error('不应重新写入') },
    fetch: async function () { throw new Error('不应重新请求') }
  })
  assert.equal((await restarted.pinText(source)).text, first.text)
})

test('两种解析都失败时保留人物卡原文并返回诊断', async function () {
  const source = "$('body').load('https://cdn.jsdelivr.net/gh/example/repo@main/status.html')"
  const store = createTavernRemoteAssetPinStore({
    fetch: async function () { return { ok: false, status: 403 } },
    resolveGitRef: async function () { throw new Error('offline') }
  })
  const result = await store.pinText(source)
  assert.equal(result.text, source)
  assert.equal(result.diagnostics.length, 1)
  assert.match(result.diagnostics[0].message, /HTTP 403.*offline/)
})

test('无法锁定远程版本时只禁用运行时投影，不修改人物卡原文', async function () {
  const helper = { name: '动态世界书', enabled: true, content: "import 'https://cdn.jsdelivr.net/gh/example/repo@main/index.js'" }
  const regex = { name: '状态栏', enabled: true, replaceString: "$('body').load('https://cdn.jsdelivr.net/gh/example/ui@main/status.html')" }
  const store = createTavernRemoteAssetPinStore({
    fetch: async function () { return { ok: false, status: 403 } },
    resolveGitRef: async function () { throw new Error('offline') }
  })
  const result = await store.pinExtensions({ helperScripts: [helper], regexScripts: [regex] })

  assert.equal(result.helperScripts[0].enabled, false)
  assert.equal(result.regexScripts[0].enabled, false)
  assert.equal(result.helperScripts[0].content, helper.content)
  assert.equal(result.regexScripts[0].replaceString, regex.replaceString)
  assert.equal(helper.enabled, true)
  assert.equal(regex.enabled, true)
  assert.equal(result.diagnostics.length, 2)
})

test('已锁定入口内容按哈希缓存并改写为本机只读地址', async function () {
  let saved = null
  const fixedUrl = 'https://cdn.jsdelivr.net/gh/example/repo@' + COMMIT + '/bundle.js'
  const store = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function (_path, updater) { saved = updater(saved) },
    fetch: async function (url) {
      if (String(url).startsWith('https://api.github.com/')) return { ok: true, json: async function () { return { sha: COMMIT } } }
      assert.equal(url, fixedUrl)
      return { ok: true, headers: { get: function () { return 'text/javascript; charset=utf-8' } }, text: async function () { return 'globalThis.cachedEntry = true' } }
    }
  })

  const result = await store.pinText("import 'https://cdn.jsdelivr.net/gh/example/repo@main/bundle.js'")
  assert.match(result.text, /\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}\/bundle\.js/)
  const hash = result.text.match(/remote-assets\/([0-9a-f]{64})/)[1]
  assert.equal((await store.readCached(hash)).content, 'globalThis.cachedEntry = true')
  assert.equal(saved.assets[fixedUrl].hash, hash)
})

test('重启且断网时复用已验证内容，缓存缺失则明确诊断', async function () {
  let saved = null
  const online = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function (_path, updater) { saved = updater(saved) },
    fetch: async function (url) {
      if (String(url).startsWith('https://api.github.com/')) return { ok: true, json: async function () { return { sha: COMMIT } } }
      return { ok: true, headers: { get: function () { return 'text/html' } }, text: async function () { return '<main>状态栏</main>' } }
    }
  })
  const source = "$('body').load('https://cdn.jsdelivr.net/gh/example/ui@main/status.html')"
  const first = await online.pinText(source)

  const offline = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function () { throw new Error('不应重新写入') },
    fetch: async function () { throw new Error('offline') }
  })
  assert.equal((await offline.pinText(source)).text, first.text)

  const missing = createTavernRemoteAssetPinStore({
    readJson: async function () { return { version: 2, pins: saved.pins, assets: {} } },
    fetch: async function () { throw new Error('offline') }
  })
  const failed = await missing.pinExtensions({ helperScripts: [], regexScripts: [{ name: '状态栏', enabled: true, replaceString: source }] })
  assert.equal(failed.regexScripts[0].enabled, false)
  assert.match(failed.diagnostics[0].message, /缓存.*offline/)
})

test('missing Git tag still renders a homepage from a durable content snapshot', async () => {
  const { projectRuntimeReplyHistory } = await import('../tavern-plugin/lib/domain/runtime-content-projection.js')
  let saved
  const url = 'https://testingcf.jsdelivr.net/gh/example/home@1.9.16/dist/home/index.html'
  const regex = { name: '首页', enabled: true, findRegex: '【首页】', placement: [2], markdownOnly: true,
    replaceString: "```\n<body><script>$('body').load('" + url + "')</script></body>\n```" }
  const store = createTavernRemoteAssetPinStore({
    readJson: async () => saved,
    updateJson: async (_path, update) => { saved = update(saved) },
    fetch: async requested => String(requested).startsWith('https://api.github.com/')
      ? {ok:false,status:422} : textResponse('<h1>Homepage</h1>', 'text/html'),
    resolveGitRef: async () => { throw Error('tag missing') }
  })
  const pinned = await store.pinExtensions({regexScripts:[regex]})
  assert.equal(pinned.regexScripts[0].enabled, true)
  assert.equal(pinned.diagnostics.length, 0)
  assert.match(pinned.regexScripts[0].replaceString, /\/api\/dsh-tavern\/remote-assets\/[a-f0-9]{64}\/index.html/)
  const result = projectRuntimeReplyHistory([{role:'assistant',text:'【首页】',sourceText:'【首页】',turn:1}],
    {regexScripts:pinned.regexScripts,placement:2,isMarkdown:true,depth:0})
  assert.equal(result.projections[0].parts[0].kind, 'html')
  const offline = createTavernRemoteAssetPinStore({readJson:async()=>saved,fetch:async()=>{throw Error('must use saved bytes')},resolveGitRef:async()=>{throw Error('must not resolve again')}})
  assert.deepEqual(await offline.pinExtensions({regexScripts:[regex]}), pinned)
  assert.equal((await offline.readCached(Object.values(saved.assets)[0].hash)).content, '<h1>Homepage</h1>')
})

test('opening media and dynamic directory bases are not fetched as executable entries', async () => {
  const media = [
    'https://testingcf.jsdelivr.net/gh/example/repo@main/avatar.webp',
    'https://cdn.jsdelivr.net/gh/example/repo@main/logo.png?size=2',
    'https://cdn.jsdelivr.net/gh/example/repo@main/music/theme.mp3',
    'https://cdn.jsdelivr.net/gh/example/repo@main/music/',
    `https://cdn.jsdelivr.net/gh/example/repo@${COMMIT}/avatar.webp`
  ]
  const entry = 'https://cdn.jsdelivr.net/gh/example/repo@main/status.html'
  const requests = []
  const store = createTavernRemoteAssetPinStore({ fetch: async url => {
    requests.push(url)
    if (url.includes('api.github.com')) return { ok: true, json: async () => ({ sha: COMMIT }) }
    if (url.endsWith('/status.html')) return textResponse('<div>status</div>', 'text/html')
    throw new Error('media must remain browser resources')
  } })
  const result = await store.pinExtensions({ regexScripts: [{ enabled: true, replaceString: media.concat(entry).map(url => JSON.stringify(url)).join('\n') }] })
  assert.equal(result.regexScripts[0].enabled, true)
  assert.deepEqual(result.diagnostics, [])
  for (const url of media) assert.ok(result.regexScripts[0].replaceString.includes(url), url)
  assert.equal(requests.length, 2)
  assert.match(result.regexScripts[0].replaceString, /\/api\/dsh-tavern\/remote-assets\//)
})

test('禁用资源不请求；并发准备共享请求且网络并发不超过三', async () => {
  let active = 0, maximum = 0, calls = 0
  const store = createTavernRemoteAssetPinStore({ fetch: async () => {
    calls++; active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 10)); active--
    return { ok: true, json: async () => ({ sha: 'a'.repeat(40) }), text: async () => 'export const ready=true' }
  } })
  const helperScripts = Array.from({ length: 6 }, (_, i) => ({ name: String(i), enabled: true, content: `import 'https://cdn.jsdelivr.net/gh/example/repo@main/${i}.js'` }))
  await store.pinExtensions({ helperScripts: helperScripts.map(s => ({ ...s, enabled: false })) })
  assert.equal(calls, 0)
  const [one, two] = await Promise.all([store.pinExtensions({ helperScripts }), store.pinExtensions({ helperScripts })])
  assert.deepEqual(one, two)
  assert.equal(calls, 7)
  assert.equal(maximum, 3)
  const warm = await store.pinExtensions({ helperScripts })
  assert.deepEqual(warm, one)
  assert.equal(calls, 7)
})

test('响应正文超时也中止，失败冷却后可重试', async () => {
  let calls = 0, now = 0, aborted = 0
  const store = createTavernRemoteAssetPinStore({ timeoutMs: 15, retryDelayMs: 100, now: () => now,
    fetch: async (_url, { signal }) => {
      calls++; signal.addEventListener('abort', () => aborted++)
      return { ok: true, json: () => new Promise(() => {}), text: () => new Promise(() => {}) }
    }, resolveGitRef: async () => { throw new Error('offline') }
  })
  const input = { helperScripts: [{ enabled: true, content: "import 'https://cdn.jsdelivr.net/gh/example/slow@main/a.js'" }] }
  const result = await store.pinExtensions(input)
  assert.equal(result.helperScripts[0].enabled, false)
  assert.equal(aborted, 2)
  const previous = calls
  await store.pinExtensions(input)
  assert.equal(calls, previous)
  now = 101
  await store.pinExtensions(input)
  assert.ok(calls > previous)
})
