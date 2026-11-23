import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { bundledPluginRelease } from '../tavern-plugin/lib/domain/bundled-plugin-release.js'

test('the bundled STcontext files match the pinned release, including its redistribution notice', async () => {
  const pin = JSON.parse(await readFile(new URL('../config/bundled-stcontext-release.json', import.meta.url), 'utf8'))
  const directory = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-STcontext/', import.meta.url))
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const source = bundledPluginRelease(pkg.name, pkg.name)
  assert.equal(pin.repository, source.owner + '/' + source.repo)
  assert.equal(pin.tag, 'v' + pkg.version)
  assert.equal(pin.asset, source.assetName(pkg.version))
  const items = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = items.filter(item => item.isFile()).map(item =>
    path.relative(directory, path.join(item.parentPath, item.name)).split(path.sep).join('/')).sort()
  assert.ok(files.includes('NOTICE') && files.includes('lib/vendor/LICENSES.txt'))
  const digest = createHash('sha256')
  for (const file of files) {
    const bytes = await readFile(path.join(directory, file))
    digest.update(file + '\0' + createHash('sha256').update(bytes).digest('hex') + '\n')
  }
  assert.equal(digest.digest('hex'), pin.filesSha256)
})
