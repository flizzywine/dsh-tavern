import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { selectTestRuntime, probeTestRuntime } from './test-runtime.mjs'
import { root, readContracts, hostReferences, addedReferences, summarizeTap, compareReports } from './dsh-contract-check.mjs'

// Runs inside the selected Node/Electron, so ASAR reads and resolution use that host.
function inspectPackages(boot, names) {
  const { createRequire } = require('node:module')
  const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
  const r = createRequire(boot), result = {}
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  for (const name of names) {
    try {
      const entry = r.resolve(name)
      let directory = path.dirname(entry), pkg
      for (;;) {
        try { const value = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')); if (value.name === name) { pkg = value; break } } catch {}
        const parent = path.dirname(directory)
        if (parent === directory) throw new Error('package metadata not found')
        directory = parent
      }
      const declarations = {}
      function scan(dir) {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          if (item.name === 'node_modules') continue
          const file = path.join(dir, item.name)
          if (item.isDirectory()) scan(file)
          else if (/\.d\.[cm]?ts$/.test(item.name)) declarations[path.relative(directory, file).replaceAll('\\', '/')] = hash(file)
        }
      }
      scan(directory)
      result[name] = { version: pkg.version, exports: pkg.exports || null, entryHash: hash(entry), declarations }
    } catch (error) { result[name] = { error: error.message } }
  }
  console.log(JSON.stringify(result))
}

async function runRuntime(selector, manifest, temporary) {
  const { findDshCommand, readInstallationFile } = await import('./launcher-environment.mjs')
  const { resolveDshBootModule } = await import('./plugin-dependencies.mjs')
  const env = { ...process.env, TMP: temporary, TEMP: temporary, TMPDIR: temporary }
  // A selector is either an official desktop executable or a standalone boot module.
  // Explicit selection must not inherit another host's preload or boot override.
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  if (selector) {
    delete env.DSH_BOOT_MODULE
    delete env.DSH_DESKTOP_APP_EXECUTABLE
    delete env.DSH_DESKTOP_NODE_EXECUTABLE
    if (/\.(?:[cm]?js)$/i.test(selector)) env.DSH_BOOT_MODULE = path.resolve(selector)
    else env.DSH_DESKTOP_APP_EXECUTABLE = path.resolve(selector)
  }
  const runtime = probeTestRuntime(selectTestRuntime({ env, installation: selector ? {} : readInstallationFile(),
    cliBoot: () => resolveDshBootModule({ dsh: findDshCommand() }) }), spawnSync, { checkCompatibility: false })
  const names = [...new Set(manifest.contracts.flatMap(item => item.packages))].sort()
  const probe = spawnSync(runtime.command, [...runtime.args, '-e', `(${inspectPackages.toString()})(${JSON.stringify(runtime.boot)},${JSON.stringify(names)})`],
    { env: runtime.env, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  if (probe.error || probe.status !== 0) throw new Error('Package inspection failed: ' + (probe.error?.message || probe.stderr))
  const packages = JSON.parse(probe.stdout.trim())
  const preload = pathToFileURL(path.join(root, 'tests/fixtures/host-runtime-preload.mjs')).href
  runtime.env.NODE_OPTIONS = '--import=' + preload
  runtime.env.DSH_TEST_NODE_EXECUTABLE = runtime.command
  const contracts = []
  for (const contract of manifest.contracts) {
    console.log(`Checking ${runtime.version}: ${contract.id} → ${contract.adapter}`)
    const run = spawnSync(runtime.command, [...runtime.args, '--import', pathToFileURL(path.join(root, 'tests/fixtures/host-session-patch-preload.mjs')).href,
      '--test', '--test-reporter=tap', ...contract.tests],
    { cwd: root, env: runtime.env, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const output = (run.stdout || '') + (run.stderr || '')
    const summary = summarizeTap(output, run.status, contract.optionalTests)
    if (contract.packages.some(name => packages[name]?.error && !contract.optionalPackages?.includes(name))) summary.status = 'failed'
    summary.unavailablePackages = contract.packages.filter(name => packages[name]?.error)
    contracts.push({ ...contract, ...summary, ...(summary.status === 'failed' ? { output, error: run.error?.message } : {}) })
    console.log(`  ${summary.status}: ${summary.passed}/${summary.tests}, required skipped=${summary.requiredSkipped}; optional skipped=${summary.optionalSkipped.join(', ') || 'none'}; unavailable=${summary.unavailablePackages.join(', ') || 'none'}`)
  }
  return { selector: selector || 'auto', version: runtime.version, nodeVersion: runtime.nodeVersion, boot: runtime.boot, packages, contracts }
}

try {
  const { values } = parseArgs({ options: { baseline: { type: 'string' }, candidate: { type: 'string' }, output: { type: 'string' },
    'check-dependencies': { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) {
    console.log('node bin/check-dsh-upgrade.mjs [--candidate <desktop-executable|boot.js>] [--baseline <desktop-executable|boot.js>] [--output report.json]\nnode bin/check-dsh-upgrade.mjs --check-dependencies\nRequired failures/skips and missing TAP summaries fail the check. Named optional capabilities are reported separately. No install or support policy changes.')
  } else {
    const manifest = readContracts()
    const inventory = JSON.parse(readFileSync(path.join(root, 'config/dsh-dependency-baseline.json'), 'utf8'))
    const additions = addedReferences(hostReferences(), inventory)
    if (additions.length) throw new Error('New host references need review in config/dsh-dependency-baseline.json:\n' + additions.map(item => `${item.file}: ${item.name}`).join('\n'))
    if (values['check-dependencies']) console.log('DSH dependency locations match the reviewed baseline.')
    else {
      const scratch = path.join(root, '.cache/dsh-contracts')
      mkdirSync(scratch, { recursive: true })
      const temporary = mkdtempSync(path.join(scratch, 'run-'))
      try {
        const baseline = values.baseline ? await runRuntime(values.baseline, manifest, temporary) : undefined
        const candidate = await runRuntime(values.candidate, manifest, temporary)
        const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim()
        const sourceFiles = [...new Set(['config/dsh-contracts.json', ...manifest.contracts.flatMap(item => [item.adapter, ...item.tests])])].sort()
        const source = { commit: git('rev-parse', 'HEAD'), workingTree: git('status', '--porcelain'),
          hashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')])) }
        const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), source, contractManifest: manifest,
          baseline, candidate, comparison: baseline ? compareReports(baseline, candidate) : undefined }
        if (values.output) writeFileSync(path.resolve(values.output), JSON.stringify(report, null, 2) + '\n')
        for (const item of report.comparison || []) console.log(`${item.id}: ${item.baseline} → ${item.candidate}; changed packages: ${item.changedPackages.join(', ') || 'none'}`)
        for (const runtime of [baseline, candidate].filter(Boolean)) for (const item of runtime.contracts) {
          if (item.status === 'failed') console.error(`${runtime.version}/${item.id}: ${item.output}\n${item.error || ''}`)
        }
        process.exitCode = [baseline, candidate].filter(Boolean).some(runtime => runtime.contracts.some(item => item.status !== 'passed')) ? 1 : 0
      } finally { rmSync(temporary, { recursive: true, force: true }) }
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
