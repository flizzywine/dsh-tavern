import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernRemoteAssetPinStore } from '../tavern-plugin/lib/domain/tavern-remote-assets.js'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

function textResponse(content = 'globalThis.entryLoaded = true', mediaType = 'text/javascript') {
  return { ok: true, headers: { get: function () { return mediaType } }, text: async function () { return content } }
}

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
  const { projectReplyHistory } = await import('../tavern-plugin/lib/domain/reply-presentation.js')
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
  const result = projectReplyHistory([{role:'assistant',text:'【首页】',sourceText:'【首页】',turn:1}],
    {regexScripts:pinned.regexScripts,placement:2,isMarkdown:true,depth:0})
  assert.equal(result.projections[0].parts[0].kind, 'html')
  const offline = createTavernRemoteAssetPinStore({readJson:async()=>saved,fetch:async()=>{throw Error('must use saved bytes')},resolveGitRef:async()=>{throw Error('must not resolve again')}})
  assert.deepEqual(await offline.pinExtensions({regexScripts:[regex]}), pinned)
  assert.equal((await offline.readCached(Object.values(saved.assets)[0].hash)).content, '<h1>Homepage</h1>')
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

test('模板字符串里的 jsDelivr 地址止于插值和反引号，替换后脚本语法完整', async () => {
  let saved = null
  const store = createTavernRemoteAssetPinStore({
    readJson: async () => saved,
    updateJson: async (_path, updater) => { saved = updater(saved) },
    fetch: async url => String(url).startsWith('https://api.github.com/') ? { ok: true, json: async () => ({ sha: COMMIT }) } : textResponse()
  })
  const source = 'loadScript([`https://cdn.jsdelivr.net/gh/baibai-git/baibai_phone/index.js?day=${day}&hour=${hour}`]);'
  const result = await store.pinText(source)
  assert.match(result.text, /\/api\/dsh-tavern\/remote-assets\//)
  assert.match(result.text, /\$\{day\}&hour=\$\{hour\}`\]\);$/)
  assert.doesNotThrow(() => new Function('loadScript', 'day', 'hour', result.text))
})
