import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { plannerTemperatureOf } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

test('planner temperature 0 stays 0', () => {
  assert.equal(plannerTemperatureOf(0), 0)
  assert.equal(plannerTemperatureOf('0'), 0)
  assert.equal(plannerTemperatureOf('0.4'), 0.4)
})

test('blank, non-numeric or out-of-range temperature falls back to 1', () => {
  for (const value of ['', null, undefined, true, 'abc', -1, 2.5]) assert.equal(plannerTemperatureOf(value), 1)
})

test('the console sends the typed temperature and lets the server validate it', async () => {
  const html = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/console.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /plannerTemperature:\s*Number\(\$\('#cfgPlannerTemp'\)\.value\)\s*\|\|\s*1/)
})
