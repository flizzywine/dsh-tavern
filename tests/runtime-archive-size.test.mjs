import assert from 'node:assert/strict'
import { mkdtemp, open, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkRuntimeArchive, MAX_RUNTIME_ARCHIVE_BYTES } from '../.github/scripts/check-runtime-archive.mjs'

test('runtime archive gate rejects empty, directory and >=20 MB before publication', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-runtime-size-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'runtime.zip')
  const handle = await open(file, 'w')
  try {
    for (const size of [0, MAX_RUNTIME_ARCHIVE_BYTES, MAX_RUNTIME_ARCHIVE_BYTES + 1]) {
      await handle.truncate(size)
      await assert.rejects(checkRuntimeArchive(file), /Runtime ZIP/)
    }
    await handle.truncate(MAX_RUNTIME_ARCHIVE_BYTES - 1)
    assert.equal(await checkRuntimeArchive(file), MAX_RUNTIME_ARCHIVE_BYTES - 1)
  } finally { await handle.close() }
  await assert.rejects(checkRuntimeArchive(root), /Runtime ZIP/)
  const workflow = await readFile(new URL('../.github/workflows/publish-runtime-manifest.yml', import.meta.url), 'utf8')
  assert.ok(workflow.indexOf('node .github/scripts/check-runtime-archive.mjs "$archive"') < workflow.indexOf('git push -q --force'), 'The size gate must precede publishing the archive')
})

test('every bundled font is below the per-file limit and matches its catalog digest/size', async () => {
  const { readdir } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const root = new URL('../tavern-plugin/packages/dsh-dream-skin/fonts/', import.meta.url)
  let count = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = new URL(entry.name + '/', root)
    const manifest = JSON.parse(await readFile(new URL('index.json', directory), 'utf8'))
    for (const face of manifest.files) {
      const bytes = await readFile(new URL(face.file, directory))
      assert.ok(bytes.length > 0 && bytes.length < MAX_RUNTIME_ARCHIVE_BYTES, `${entry.name}/${face.file} size`)
      assert.equal(bytes.length, face.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), face.sha256)
      count++
    }
  }
  assert.equal(count, 11, 'All current catalog faces must be checked')
})
