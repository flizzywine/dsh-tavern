import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/foreground.js', import.meta.url), 'utf8')
const start = source.indexOf('function lazyForeground(')
const lazyForeground = vm.runInNewContext(`(${source.slice(start, source.indexOf('\nconst forkForeground', start))})`)

test('lazy foreground tracker keeps an assigned member for every later caller, as the plain object did', () => {
  let created = 0
  const tracker = lazyForeground(() => { created++; return { now: () => 1, other: () => 'real' } })
  tracker.now = () => 42
  assert.equal(tracker.now(), 42)
  assert.equal(created, 0)
  assert.equal(tracker.other(), 'real')
  assert.equal(created, 1)
})