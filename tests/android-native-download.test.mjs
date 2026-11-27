import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const DOWNLOAD_SRC = readFileSync(new URL('../tavern-plugin/src/client/download.js', import.meta.url), 'utf8')
const MAIN_ACTIVITY_SRC = readFileSync(new URL('../android/native/app/src/io/github/flizzywine/dshtavern/bionic/MainActivity.java', import.meta.url), 'utf8')
const WEB_DOWNLOADS_SRC = readFileSync(new URL('../android/native/app/src/io/github/flizzywine/dshtavern/bionic/WebDownloads.java', import.meta.url), 'utf8')

function loadDownloadFn(globals) {
  const ctx = vm.createContext({
    Uint8Array,
    Blob,
    Promise,
    Error,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    ...globals
  })
  vm.runInContext(DOWNLOAD_SRC, ctx)
  return ctx.downloadTavernBlob
}

test('原生 APK 桥接存在时，downloadTavernBlob 分块写入完整二进制且不走 blob URL', async () => {
  const payload = Buffer.alloc(450000)
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251

  const calls = { begin: null, chunks: [], finished: null, aborted: null }
  let finishedResolve
  const finishedPromise = new Promise((resolve) => { finishedResolve = resolve })
  const bridge = {
    begin(name, mime) {
      calls.begin = { name, mime }
      return 'dl-1'
    },
    chunk(id, b64) {
      assert.equal(id, 'dl-1')
      calls.chunks.push(Buffer.from(b64, 'base64'))
      return true
    },
    finish(id) {
      calls.finished = id
      finishedResolve()
      return true
    },
    abort(id, reason) {
      calls.aborted = { id, reason }
      finishedResolve()
    }
  }

  let objectUrlCalled = false
  const downloadTavernBlob = loadDownloadFn({
    window: { DshNativeDownload: bridge, setTimeout },
    URL: { createObjectURL() { objectUrlCalled = true; return 'blob:never' }, revokeObjectURL() {} }
  })

  downloadTavernBlob(new Blob([payload], { type: 'application/zip' }), 'DSH酒馆备份-测试.dshtransfer')
  await finishedPromise

  assert.equal(objectUrlCalled, false)
  assert.deepEqual(calls.begin, { name: 'DSH酒馆备份-测试.dshtransfer', mime: 'application/zip' })
  assert.equal(calls.chunks.length, 2)
  assert.equal(calls.finished, 'dl-1')
  assert.equal(calls.aborted, null)
  assert.deepEqual(Buffer.concat(calls.chunks), payload)
})

test('原生 APK 桥接写入分块失败时调用 abort 清理未完成文件', async () => {
  let aborted = null
  let finished = false
  let doneResolve
  const donePromise = new Promise((resolve) => { doneResolve = resolve })
  const bridge = {
    begin() { return 'dl-fail' },
    chunk() { return false },
    finish() { finished = true; doneResolve(); return true },
    abort(id, reason) { aborted = { id, reason }; doneResolve() }
  }

  const downloadTavernBlob = loadDownloadFn({
    window: { DshNativeDownload: bridge, setTimeout },
    URL: { createObjectURL() { return 'blob:unused' }, revokeObjectURL() {} }
  })

  downloadTavernBlob(new Blob(['abc'], { type: 'application/json' }), 'test.json')
  await donePromise

  assert.equal(finished, false)
  assert.equal(aborted?.id, 'dl-fail')
  assert.match(aborted?.reason || '', /写入下载文件失败/)
})

test('原生 APK MainActivity 正确挂载 WebDownloads 监听与 JS 桥接', () => {
  assert.match(MAIN_ACTIVITY_SRC, /downloads\s*=\s*new\s+WebDownloads\(this,\s*web\);/)
  assert.match(MAIN_ACTIVITY_SRC, /downloads\.attach\(\);/)
  assert.match(MAIN_ACTIVITY_SRC, /downloads\.destroy\(\);/)
  assert.match(WEB_DOWNLOADS_SRC, /web\.setDownloadListener\(this::onDownloadStart\);/)
  assert.match(WEB_DOWNLOADS_SRC, /web\.addJavascriptInterface\(new\s+Bridge\(\),\s*JS_BRIDGE_NAME\);/)
  assert.match(WEB_DOWNLOADS_SRC, /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/)
})
