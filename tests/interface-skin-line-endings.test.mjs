import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

test('interface skin bundle is identical for LF and CRLF client, source, and CSS inputs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'interface-skin-line-endings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin')
  const packageRoot = path.join(root, 'tavern-plugin/packages/dsh-dream-skin')
  await mkdir(path.join(bin, 'lib'), { recursive: true })
  await mkdir(path.join(packageRoot, 'src'), { recursive: true })
  await copyFile(new URL('../bin/build-interface-skin-client.mjs', import.meta.url), path.join(bin, 'build-interface-skin-client.mjs'))
  await copyFile(new URL('../bin/lib/css-syntax-guard.mjs', import.meta.url), path.join(bin, 'lib/css-syntax-guard.mjs'))
  const sourceFiles = {
    'interface-skin.js': 'const interfaceSkinFixture = 1;\n',
    'font-library.js': 'const fontLibraryFixture = 2;\n',
    'font-picker.js': 'const fontPickerFixture = 3;\n',
    'font-picker.css': '.font-picker {\n  color: black;\n}\n',
  }
  const entries = Object.entries(sourceFiles)
  for (const [name, content] of entries) await writeFile(path.join(packageRoot, 'src', name), content)
  const { integrateInterfaceSkin } = await import(pathToFileURL(path.join(bin, 'build-interface-skin-client.mjs')).href)
  const client = '// BEGIN TAVERN INTERFACE SKIN\nold bundle\n// END TAVERN INTERFACE SKIN\n'
  const lfBundle = await integrateInterfaceSkin(client)

  for (const [name, content] of entries) await writeFile(path.join(packageRoot, 'src', name), content.replace(/\n/g, '\r\n'))
  const crlfBundle = await integrateInterfaceSkin(client.replace(/\n/g, '\r\n'))
  assert.equal(crlfBundle, lfBundle)
  assert.ok(lfBundle.includes(JSON.stringify(sourceFiles['font-picker.css'])))
})
