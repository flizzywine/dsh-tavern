import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernRemoteAssetPinStore, inspectMutableJsDelivrUrls } from '../tavern-plugin/lib/domain/tavern-remote-assets.js'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

test('识别 jsDelivr 的可漂移 GitHub 引用但忽略固定提交', function () {
  const text = "import 'https://cdn.jsdelivr.net/gh/example/repo@main/a.js'; import 'https://cdn.jsdelivr.net/gh/example/repo@" + COMMIT + "/b.js'"
  assert.deepEqual(inspectMutableJsDelivrUrls(text).map(function (item) { return [item.owner, item.repo, item.ref, item.path] }), [
    ['example', 'repo', 'main', '/a.js']
  ])
})

test('没有显式版本的 GitHub CDN 地址按默认分支 HEAD 锁定', async function () {
  const source = "import 'https://cdn.jsdelivr.net/gh/example/repo/artifact/bundle.js'"
  const store = createTavernRemoteAssetPinStore({
    fetch: async function () { return { ok: false, status: 403 } },
    resolveGitRef: async function (reference) { assert.equal(reference.ref, 'HEAD'); return COMMIT }
  })
  const result = await store.pinText(source)
  assert.match(result.text, new RegExp('repo@' + COMMIT + '/artifact'))
})

test('GitHub API 配额耗尽时使用 Git 只读解析后备', async function () {
  const source = "import 'https://cdn.jsdelivr.net/gh/example/repo@main/index.js'"
  const store = createTavernRemoteAssetPinStore({
    fetch: async function () { return { ok: false, status: 403 } },
    resolveGitRef: async function (reference) { assert.equal(reference.ref, 'main'); return COMMIT }
  })
  const result = await store.pinText(source)
  assert.match(result.text, new RegExp('@' + COMMIT + '/'))
  assert.equal(result.diagnostics.length, 0)
})

test('首次解析远程分支后写入固定提交，后续启动复用持久记录', async function () {
  let saved = null
  let requests = 0
  const store = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function (_path, updater) { saved = updater(saved) },
    fetch: async function () { requests++; return { ok: true, json: async function () { return { sha: COMMIT } } } }
  })
  const source = "import 'https://testingcf.jsdelivr.net/gh/Alice/Apeiria@main/变量守卫/index.js'"
  const first = await store.pinText(source)
  assert.match(first.text, new RegExp('@' + COMMIT + '/'))
  assert.equal(requests, 1)
  assert.equal(saved.pins['Alice/Apeiria@main'].commit, COMMIT)

  const restarted = createTavernRemoteAssetPinStore({
    readJson: async function () { return saved },
    updateJson: async function () { throw new Error('不应重新写入') },
    fetch: async function () { throw new Error('不应重新请求') }
  })
  assert.match((await restarted.pinText(source)).text, new RegExp('@' + COMMIT + '/'))
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
