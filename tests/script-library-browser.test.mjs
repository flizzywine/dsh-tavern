import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createScriptLibrary } from '../tavern-plugin/lib/domain/script-library.js'
import { createScriptReader } from '../tavern-plugin/lib/domain/script-reader.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('游玩对话的剧本库可导入、预览和检索 TXT、Markdown 与 EPUB 小说', async t => {
  const sessionId = 'novel-import-game'
  const dataRoot = await mkdtemp(join(tmpdir(), 'tavern-script-library-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const fileResources = createFileResourceStore({ dataRoot })
  const readScript = createScriptReader({ resources: fileResources, version: async path => (await fileResources.metadata(path)).updatedAt })
  const library = createScriptLibrary({ fileResources, readScript })
  const { page, calls } = await openTavernSettings(t, {
    section: 'dsh-tavern: Better Sidebar resources tab', sessionId,
    async respond(method, args) {
      if (method === 'getSession') return { view: { sessionId, mode: 'story' } }
      if (method === 'listResources') return { resources: await library.listSources(), cards: [] }
      if (method === 'importSource') return { source: await library.importSource(args.payload) }
      if (method === 'getResource') return { path: args.path, text: await fileResources.readText(args.path) }
    }
  })
  const epubText = '夜雨落在屋檐。\n\n她关上了窗。'
  const epub = writeZipEntries([
    { path: 'mimetype', content: 'application/epub+zip' },
    { path: 'META-INF/container.xml', content: '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>' },
    { path: 'book.opf', content: '<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>' },
    { path: 'chapter.xhtml', content: '<html><head><title>章节标题</title></head><body><p>夜雨落在屋檐。</p><p>她关上了窗。</p></body></html>' },
  ])
  const novels = [
    { name: '夜雨.txt', mimeType: 'text/plain', text: '雨点从屋檐落下。\n她关上了窗。' },
    { name: '远山.md', mimeType: 'text/markdown', text: '# 第一章\n\n远山隐在雾里。' },
    { name: '屋檐.epub', mimeType: 'application/epub+zip', text: epubText, buffer: epub },
  ]
  for (const { name, mimeType, text, buffer = Buffer.from(text) } of novels) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '导入小说或剧本' }).click(),
    ])
    await chooser.setFiles({ name, mimeType, buffer })
    await page.getByRole('button', { name, exact: true }).click()
    const preview = page.locator('.dsh-tavern-script-preview')
    await preview.waitFor()
    assert.equal(await preview.textContent(), text)
    await page.getByRole('button', { name: '返回剧本库', exact: false }).click()
    const result = await library.searchSource({ path: 'materials/' + name, query: text, limit: 1, selection: 'best-match' })
    assert.deepEqual(result.chunks.map(chunk => chunk.text), [text])
  }
  assert.deepEqual(calls.filter(({ method }) => method === 'importSource').map(({ args }) => args.sessionId),
    [sessionId, sessionId, sessionId])
  assert.deepEqual((await library.listSourceTitles()).map(({ title }) => title).sort(), novels.map(({ name }) => name).sort())
})
