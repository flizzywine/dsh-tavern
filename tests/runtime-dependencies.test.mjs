import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { missingRuntimeDependencies, assertRuntimeDependencies } from '../bin/runtime-dependencies.mjs'

function fakeSource(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-deps-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { present: '1.0.0', 'esm-only': '1.0.0', jsdom: '26.1.0' } }))
  mkdirSync(path.join(root, 'tavern-plugin'))
  writeFileSync(path.join(root, 'tavern-plugin', 'package.json'), '{}')
  const pkg = (name, manifest, file) => {
    mkdirSync(path.join(root, 'node_modules', name), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, ...manifest }))
    if (file) writeFileSync(path.join(root, 'node_modules', name, file), '')
  }
  pkg('present', { main: 'index.js' }, 'index.js')
  // An import-only package is installed even though require.resolve refuses it.
  pkg('esm-only', { type: 'module', exports: { import: './index.js' } }, 'index.js')
  return root
}

test('a package missing from the hoisted node_modules fails the install (Android "Cannot find package jsdom")', t => {
  const root = fakeSource(t)
  assert.deepEqual(missingRuntimeDependencies(root), ['jsdom'])
  assert.throws(() => assertRuntimeDependencies(root), /缺少：jsdom/)
})

test('the repository itself resolves every runtime dependency', () => {
  assert.deepEqual(missingRuntimeDependencies(new URL('..', import.meta.url).pathname), [])
})
