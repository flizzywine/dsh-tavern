import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const pluginSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const backgroundSource = await readFile(new URL('../tavern-plugin/lib/background-agent-runner.js', import.meta.url), 'utf8')

test('Tavern uses open DSH ecosystem package ranges instead of an exact host release', () => {
  assert.equal(pluginManifest.dependencies['@deepseek-ai/dsh-tools'], '>=0.1.0-rc.7')
  assert.equal(pluginManifest.dependencies['@deepseek-ai/dsh-subagent'], '>=0.1.0-rc.7')
  assert.match(pluginSource, /from '@deepseek-ai\/dsh-tools'/)
  assert.match(backgroundSource, /from '@deepseek-ai\/dsh-subagent'/)
  assert.match(launcherSource, /function installPluginDependencies\(dshVersion\)/)
  assert.match(launcherSource, /run\('pnpm', \['--dir', pluginDirectory, 'install', '--lockfile=false'\]\)/)
  assert.doesNotMatch(launcherSource, /'install'[\s\S]{0,40}'--ignore-workspace'/)
})
