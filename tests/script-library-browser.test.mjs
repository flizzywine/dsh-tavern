import assert from 'node:assert/strict'
import test from 'node:test'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

test('游玩对话的剧本库可以直接导入和预览小说', async t => {
  const sessionId = 'novel-import-game'
  const name = '夜雨.txt'
  const text = '雨点从屋檐落下。\n她关上了窗。'
  const novel = { path: 'materials/' + name, title: name, chunkCount: 1, boundCards: [] }
  const resources = []
  const { page, calls } = await openTavernSettings(t, {
    section: 'dsh-tavern: Better Sidebar resources tab', sessionId,
    respond(method, args) {
      if (method === 'getSession') return { view: { sessionId, mode: 'story' } }
      if (method === 'listResources') return { resources, cards: [] }
      if (method === 'importSource') {
        assert.equal(args.payload.name, name)
        assert.equal(args.payload.text, text)
        resources.push(novel)
        return { source: novel }
      }
      if (method === 'getResource') {
        assert.equal(args.path, novel.path)
        return { path: novel.path, text }
      }
    }
  })
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '导入小说或剧本' }).click(),
  ])
  await chooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByText('她关上了窗。', { exact: false }).waitFor()
  assert.equal(calls.find(({ method }) => method === 'importSource').args.sessionId, sessionId)
})
