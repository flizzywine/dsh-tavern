import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createResourceMutationJournal } from '../tavern-plugin/lib/domain/resource-mutation-journal.js'

async function exists(target) {
  try { await readFile(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

for (const failAt of [1, 2, 3]) {
  test('崩溃发生在资源图第 ' + failAt + ' 次落盘后，重启完成整个新图', async function (t) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-resource-journal-'))
    t.after(async function () { await rm(root, { recursive: true, force: true }) })
    const oldPath = path.join(root, 'resources', 'cards', 'old.json')
    const newPath = path.join(root, 'resources', 'cards', 'new.json')
    const bindings = path.join(root, '.material-bindings.json')
    await mkdir(path.dirname(oldPath), { recursive: true })
    await writeFile(oldPath, '{"name":"old"}')
    await writeFile(bindings, '{"cards/old.json":"materials/story.txt"}')
    const crashing = createResourceMutationJournal({
      dataRoot: root,
      fault: async function ({ side, index }) {
        if (side === 'after' && index === failAt) {
          const error = new Error('simulated process death')
          error.code = 'DSH_TAVERN_SIMULATED_CRASH'
          throw error
        }
      }
    })

    await assert.rejects(crashing.run('rename-card', async function (plan) {
      await plan.move(oldPath, newPath)
      await plan.write(bindings, '{"cards/new.json":"materials/story.txt"}')
    }), /simulated process death/)

    await createResourceMutationJournal({ dataRoot: root }).recover()
    assert.equal(await exists(oldPath), false)
    assert.equal(await readFile(newPath, 'utf8'), '{"name":"old"}')
    assert.equal(await readFile(bindings, 'utf8'), '{"cards/new.json":"materials/story.txt"}')
  })
}

test('普通写入异常回滚整个旧资源图', async function (t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-resource-journal-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const first = path.join(root, 'first.txt')
  const second = path.join(root, 'second.txt')
  await writeFile(first, 'before-a')
  await writeFile(second, 'before-b')
  let failed = false
  const journal = createResourceMutationJournal({
    dataRoot: root,
    fault: async function ({ side, index }) {
      if (!failed && side === 'after' && index === 2) { failed = true; throw new Error('ordinary failure') }
    }
  })

  await assert.rejects(journal.run('rewrite', async function (plan) {
    await plan.write(first, 'after-a')
    await plan.write(second, 'after-b')
  }), /ordinary failure/)

  assert.equal(await readFile(first, 'utf8'), 'before-a')
  assert.equal(await readFile(second, 'utf8'), 'before-b')
})
