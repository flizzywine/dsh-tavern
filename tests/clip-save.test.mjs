// Saving clip exports: the host lists finished exports with suggested names and
// serves their files only to the session owning the chat; the job folder records what it holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { clipSaveName, planClipExport } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/clip-export.js'
import { createClipExport } from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export.js'

test('save names: title, round range and preset; legacy exports use their date', () => {
  assert.equal(clipSaveName({ title: '魔法纪录', from: { turn: 5, para: 1 }, to: { turn: 5, para: 16 }, preset: '1080p', ext: 'mp4' }), '魔法纪录 第5轮1-16段 1080p.mp4')
  assert.equal(clipSaveName({ title: '魔法纪录', from: { turn: 5, para: 3 }, to: { turn: 7, para: 2 }, preset: 'discord', ext: 'mp4' }), '魔法纪录 第5轮3段-第7轮2段 Discord.mp4')
  assert.equal(clipSaveName({ title: 'A/B: "x"?', from: { turn: 2, para: 4 }, to: { turn: 2, para: 4 }, preset: 'gif', ext: 'gif' }), 'A_B_ _x_ 第2轮4段 GIF.gif')
  const date = new Date(2026, 9, 20, 5, 7)
  assert.equal(clipSaveName({ title: '魔法纪录', ext: 'mp4', index: 1, count: 4, date }), '魔法纪录 10月20日0507 (2).mp4')
  assert.equal(clipSaveName({ title: '', ext: 'mp4', date }), '片段 10月20日0507.mp4')
})

test('finished exports: listed newest first with names and URLs, served only to the owning session', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clip-save-')); t.after(() => rm(root, { recursive: true, force: true }))
  const exportsRoot = join(root, 'exports'), tempRoot = join(root, 'temp'), chatId = 'chat-a1'
  const rows = [{ turn: 5, para: 1, durationMs: 1000 }, { turn: 5, para: 2, durationMs: 1000 }]
  const range = { chatId, from: { turn: 5, para: 1 }, to: { turn: 5, para: 2 } }
  const service = createClipExport({ exportsRoot, tempRoot, checkDisk: async () => {}, openFolder: async () => {},
    readSnapshot: async () => ({ chatId, paragraphs: rows }),
    readChatTitle: async sessionId => sessionId === 'session' ? { chatId, title: '魔法纪录' } : sessionId === 'other' ? { chatId: 'chat-b2', title: '别的' } : null,
    createRenderer: async () => ({ renderer: {}, audio: [] }), render: async () => ({ close: async () => {} }),
    encode: async ({ outputPath }) => { await writeFile(outputPath, 'video-bytes'); return { file: { path: outputPath, bytes: 11 }, verification: {}, warnings: [] } } })
  t.after(() => service.dispose())
  // An export from before the folder record (receipt still in the temp root), one still marked running, one with nothing.
  const folder = join(exportsRoot, 'chat-' + encodeURIComponent(chatId))
  const legacy = '64f4f541-2b40-4cd5-980d-d25aadd94019', stalled = '4ecfbb20-b249-43b3-8f1a-112932c3a70e', bare = '878fc21b-8f41-4709-aa63-a5b1b5176eeb'
  for (const id of [legacy, stalled, bare]) { await mkdir(join(folder, id), { recursive: true }); await writeFile(join(folder, id, 'clip-01.mp4'), 'old') }
  await mkdir(tempRoot, { recursive: true })
  await writeFile(join(tempRoot, `clip-${legacy}.json`), JSON.stringify({ state: 'completed', request: { chatId, from: { turn: 4, para: 1 }, to: { turn: 4, para: 9 }, preset: 'quality' },
    result: { files: [{ path: join(folder, legacy, 'clip-01.mp4'), preset: 'quality', from: { turn: 4, para: 1 }, to: { turn: 4, para: 9 } }] } }))
  await writeFile(join(tempRoot, `clip-${stalled}.json`), JSON.stringify({ state: 'running' }))

  const { jobId } = await service.call('startClipExport', { sessionId: 'session', range, preset: 'discord' })
  for (let i = 0; i < 100 && (await service.call('getClipExportJob', { sessionId: 'session', jobId })).state !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 10))
  const record = JSON.parse(await readFile(join(folder, jobId, '.clip.json'), 'utf8'))
  assert.deepEqual(record.files.map(file => file.file), planClipExport(rows, range, 'discord').plannedFiles.map((_, i) => `clip-0${i + 1}.mp4`))

  const { exports } = await service.call('listClipExports', { sessionId: 'session' })
  assert.equal(exports[0].jobId, jobId, 'newest first')
  assert.deepEqual(exports.map(row => row.jobId).sort(), [jobId, legacy, bare].sort(), 'a running receipt is not offered')
  assert.equal(exports[0].files[0].name, '魔法纪录 第5轮1-2段 Discord.mp4')
  assert.equal(exports.find(row => row.jobId === legacy).files[0].name, '魔法纪录 第4轮1-9段 最高画质.mp4')
  assert.match(exports.find(row => row.jobId === bare).files[0].name, /^魔法纪录 \d+月\d+日\d{4}\.mp4$/)
  const file = exports[0].files[0]
  assert.equal(file.bytes, 11); assert.equal(file.type, 'video/mp4')
  assert.equal(file.url, '/dsh-tavern-stage/clip-file?' + new URLSearchParams({ sessionId: 'session', jobId, file: 'clip-01.mp4' }))
  assert.equal(JSON.stringify(exports).includes(root), false, 'no local paths reach the player')

  const served = await service.file({ sessionId: 'session', jobId, file: 'clip-01.mp4' })
  assert.equal(served.path, join(folder, jobId, 'clip-01.mp4')); assert.equal(served.name, file.name); assert.equal(served.size, 11)
  assert.equal(await service.file({ sessionId: 'other', jobId, file: 'clip-01.mp4' }), null, 'another chat')
  await assert.rejects(() => service.file({ sessionId: 'nobody', jobId, file: 'clip-01.mp4' }))
  assert.equal(await service.file({ sessionId: 'session', jobId, file: '../.clip.json' }), null)
  assert.equal(await service.file({ sessionId: 'session', jobId: '..', file: 'clip-01.mp4' }), null)
  assert.equal(await service.file({ sessionId: 'session', jobId: stalled, file: 'clip-01.mp4' }), null)
  assert.deepEqual((await service.call('listClipExports', { sessionId: 'other' })).exports, [])
})
