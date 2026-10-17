import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const moduleUrl = new URL('../bin/launcher-environment.mjs', import.meta.url).href
function probe(override) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (['dsh_tavern_npm_registry', 'npm_config_registry', 'pnpm_config_registry'].includes(key.toLowerCase())) delete env[key]
  }
  env.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org'
  env.PNPM_CONFIG_REGISTRY = 'https://registry.npmjs.org'
  if (override) env.DSH_TAVERN_NPM_REGISTRY = override
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { runtimeEnvironment } = await import(${JSON.stringify(moduleUrl)});
    const before = JSON.stringify(process.env);
    const env = runtimeEnvironment();
    console.log(JSON.stringify({
      entries: Object.entries(env).filter(([key]) => ['npm_config_registry','pnpm_config_registry'].includes(key.toLowerCase())),
      unchanged: before === JSON.stringify(process.env)
    }));
  `], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('direct install subprocesses default to the domestic registry without conflicting Windows keys or global changes', () => {
  const result = probe()
  assert.deepEqual(result.entries, [['npm_config_registry', 'https://registry.npmmirror.com'], ['pnpm_config_registry', 'https://registry.npmmirror.com']])
  assert.equal(result.unchanged, true)
})

test('an explicit Tavern registry overrides the default for npm and pnpm together', () => {
  const registry = 'https://packages.example.test/npm/'
  const result = probe(registry)
  assert.deepEqual(result.entries, [['npm_config_registry', registry], ['pnpm_config_registry', registry]])
  assert.equal(result.unchanged, true)
})
