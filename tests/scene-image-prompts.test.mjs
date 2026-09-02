import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as prompts from '../tavern-plugin/lib/scene-image-prompts.js'

const files = {
  readSceneImageSystemInstruction: 'scene-image-system',
  readScenePlanInstruction: 'scene-plan',
  readSceneAdjustmentInstruction: 'scene-image-adjustment'
}

test('image persona and task instructions load separate complete files', async () => {
  for (const [reader, name] of Object.entries(files)) {
    const content = await readFile(new URL('../tavern-plugin/prompts/' + name + '.md', import.meta.url), 'utf8')
    assert.ok(content.trim())
    assert.equal(prompts[reader](), content.trim())
  }
})

test('image prompt readers reload edits and reject missing or empty files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scene-image-prompts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'lib'))
  await mkdir(join(root, 'prompts'))
  const modulePath = join(root, 'lib', 'scene-image-prompts.mjs')
  await copyFile(new URL('../tavern-plugin/lib/scene-image-prompts.js', import.meta.url), modulePath)
  const readers = await import(pathToFileURL(modulePath).href)
  for (const [reader, name] of Object.entries(files)) {
    const file = join(root, 'prompts', name + '.md')
    assert.throws(() => readers[reader](), /ENOENT/)
    await writeFile(file, '第一版')
    assert.equal(readers[reader](), '第一版')
    await writeFile(file, '第二版')
    assert.equal(readers[reader](), '第二版')
    await writeFile(file, '  \n')
    assert.throws(() => readers[reader](), /提示词文件不能为空/)
  }
})
