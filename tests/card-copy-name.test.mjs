import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { createFileResourceStore, normalizeResourcePath } from '../tavern-plugin/lib/domain/file-resources.js'
import { projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardOrganization } from '../tavern-plugin/lib/domain/card-organization.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

test('duplicateCard numbers library labels without changing prompt names or ordinary cards', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-copy-name-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fileResources = createFileResourceStore({ dataRoot: root })
  const raw = { spec: 'chara_card_v3', data: { name: 'Story Character', description: '{{char}}' } }
  const source = await fileResources.importCard({ name: 'different-file.json', text: JSON.stringify(raw) }, raw)
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const implementation = host.slice(host.indexOf('  async function duplicateCard('), host.indexOf('  async function deleteCard('))
  // the host's own helpers duplicateCard reads (index.js str, the card organization over the profile data store)
  const str = vm.runInNewContext(host.slice(host.indexOf('  function str('), host.indexOf('  function sleep(')) + '\nstr')
  const cardOrganization = createCardOrganization(createProfileDataStore({ dataRoot: root }))
  const duplicateCard = vm.runInNewContext(implementation + '\nduplicateCard', { fileResources, normalizeResourcePath, str, cardOrganization })
  const client = await readFile(new URL('../tavern-plugin/src/client/features/card-library.js', import.meta.url), 'utf8')
  const display = vm.runInNewContext(client.split('function createCardLibraryFeatureModule')[0] + '\ncardLibraryDisplayName')
  const label = async cardPath => display({ ...projectCardSummary(await fileResources.readCard(cardPath)), path: cardPath })
  assert.equal(await label(source), 'Story Character')
  const copies = await Promise.all([duplicateCard(source), duplicateCard(source)])
  for (const [index, copy] of copies.entries()) {
    assert.equal(copy.path, `cards/different-file (${index + 1}).json`)
    assert.equal(await label(copy.path), `Story Character(${index + 1})`)
    assert.deepEqual(await fileResources.readCard(copy.path), raw)
  }
  await fileResources.remove(copies[0].path)
  assert.equal((await duplicateCard(source)).path, copies[0].path)
  await writeFile(path.join(root, 'originals/cards/different-file (3).PNG'), 'occupied')
  assert.equal((await duplicateCard(source)).path, 'cards/different-file (4).json')
  const renamed = await fileResources.rename(copies[1].path, 'renamed')
  assert.equal(await label(renamed.path), 'Story Character')
  assert.equal(await label(source), 'Story Character')
  // The world book binding is keyed by card path: a copy keeps the source's book.
  const book = await fileResources.importWorldBook({ name: 'world.json', originalText: '{"entries":{}}' }, { name: 'world', entries: {} })
  await fileResources.bindWorldBook(source, book)
  const bound = await duplicateCard(source)
  assert.deepEqual(await fileResources.worldBookBindingForCard(bound.path), await fileResources.worldBookBindingForCard(source))
  await fileResources.unbindWorldBook(source)
  assert.equal((await fileResources.worldBookBindingForCard((await duplicateCard(source)).path)).kind, 'none')
})
