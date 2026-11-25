import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')

test('PNG 人物卡的保存位置拒绝写入时，浏览器下载完整文件', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  let requests = 0
  await page.route('https://tavern.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.route('https://tavern.test/api/dsh-tavern/card-export?format=png', route => {
    requests++
    return route.fulfill({ contentType: 'image/png', body: png })
  })
  await page.goto('https://tavern.test/')
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/src/client/pack-transport.js', import.meta.url), 'utf8') })

  for (const errorName of ['NotAllowedError', 'SecurityError']) {
    await t.test(errorName, async () => {
      const [download, saved] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        page.evaluate(async name => {
          const target = { file: {
            async createWritable() {
              throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', name)
            },
            async remove() { window.removedPickedFile = true },
          } }
          const result = await saveExportFile({ url: '/api/dsh-tavern/card-export?format=png', filename: '人物卡.png' }, { target, name: '示例角色' })
          return { ...result, removed: Boolean(window.removedPickedFile) }
        }, errorName),
      ])
      assert.equal(download.suggestedFilename(), '示例角色.png')
      assert.deepEqual(await readFile(await download.path()), png)
      assert.deepEqual(saved.names, ['示例角色.png'])
      assert.equal(saved.picked, false)
      assert.equal(saved.removed, false)
      assert.match(saved.said, /已开始下载.*浏览器的下载列表/)
    })
  }

  await t.test('保存位置可写时，文件仍保存到选定位置', async () => {
    const { saved, bytes } = await page.evaluate(async () => {
      const chunks = []
      const target = { file: {
        name: '另存为.png',
        async createWritable() { return new WritableStream({ write(chunk) { chunks.push(chunk) } }) },
        async getFile() { return new Blob(chunks) },
      } }
      const saved = await saveExportFile({ url: '/api/dsh-tavern/card-export?format=png', filename: '人物卡.png' }, { target, name: '示例角色' })
      return { saved, bytes: Array.from(new Uint8Array(await (await target.file.getFile()).arrayBuffer())) }
    })
    assert.deepEqual(Buffer.from(bytes), png)
    assert.deepEqual(saved.names, ['另存为.png'])
    assert.equal(saved.picked, true)
  })

  assert.equal(requests, 3)
})
