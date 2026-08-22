import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const pluginSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const backgroundSource = await readFile(new URL('../tavern-plugin/lib/background-agent-runner.js', import.meta.url), 'utf8')

test('Tavern directly tracks and imports the current DSH ecosystem packages', () => {
  assert.equal(pluginManifest.dependencies['@deepseek-ai/dsh-tools'], '>=0.1.1-rc.2')
  assert.equal(pluginManifest.dependencies['@deepseek-ai/dsh-subagent'], '>=0.1.1-rc.2')
  assert.match(pluginSource, /from '@deepseek-ai\/dsh-tools'/)
  assert.match(backgroundSource, /from '@deepseek-ai\/dsh-subagent'/)
  assert.match(launcherSource, /SOURCE_ROOT, 'tavern-plugin'[\s\S]{0,120}'install'/)
})
