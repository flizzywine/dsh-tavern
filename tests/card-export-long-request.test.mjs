import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCardHandlers } from '../tavern-plugin/lib/rpc/cards.js'
import { createUploads } from '../tavern-plugin/lib/domain/uploads.js'
import { createTransferExportStore } from '../tavern-plugin/lib/domain/transfer-store.js'

// The Desktop ends a request whose answer has not begun after five minutes, and a large card packs and encrypts for
// longer. So exportLibraryCard must answer with its progressId while the export still runs, and the result is read
// from cardExportProgress. Kept in its own file so that a change undoing the job cannot take this guard with it.
test('exportLibraryCard answers at once while the export still runs; the result comes through cardExportProgress', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'card-export-long-'))
  const exports = createTransferExportStore({ root: path.join(dir, 'exports') })
  t.after(async () => { exports.close(); await rm(dir, { recursive: true, force: true }) })
  let finish
  const running = new Promise(resolve => { finish = resolve })
  const handlers = createCardHandlers({ uploads: createUploads({ root: dir }), transferExports: exports, str: String,
    async exportCardFile(cardPath, { onProgress }) { onProgress({ done: 1, total: 10, pack: '' }); await running; throw new Error('stopped by the test') } })
  const answered = await Promise.race([
    handlers.exportLibraryCard({ path: 'cards/large.json', progressId: 'long-export-1' }),
    new Promise(resolve => setTimeout(() => resolve('still waiting'), 2000))
  ])
  assert.deepEqual(answered, { progressId: 'long-export-1' }, 'the request must not wait for the export to finish')
  const { progress } = await handlers.cardExportProgress({ progressId: 'long-export-1' })
  assert.equal(progress.stage, 'pack', 'the running export is read by its progressId')
  finish()
  let settled
  while (!settled) { const read = (await handlers.cardExportProgress({ progressId: 'long-export-1' })).progress; if (read.stage !== 'pack') settled = read; else await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.equal(settled.stage, 'failed', 'its end is read through the same progressId')
})
