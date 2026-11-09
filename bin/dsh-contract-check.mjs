import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

export const root = path.resolve(import.meta.dirname, '..')
export function readContracts() {
  const value = JSON.parse(readFileSync(path.join(root, 'config/dsh-contracts.json'), 'utf8'))
  const ids = new Set()
  if (value.schemaVersion !== 1 || !value.contracts?.length) throw new Error('Invalid DSH contract manifest')
  for (const item of value.contracts) {
    if (!item.id || ids.has(item.id) || !item.behavior || !item.packages?.length || !item.tests?.length) throw new Error('Invalid contract: ' + item.id)
    ids.add(item.id)
    for (const file of [item.adapter, ...item.tests]) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !existsSync(path.join(root, file))) throw new Error('Invalid contract path: ' + file)
    }
  }
  return value
}

// Track literal host references in maintained JS/TS sources. This intentionally
// includes resolution strings as well as imports; generated/vendor code is excluded.
export function hostReferences(base = root) {
  const result = {}
  function walk(relative) {
    if (!existsSync(path.join(base, relative))) return
    for (const entry of readdirSync(path.join(base, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.legacy-node_modules-')) continue
      if (['node_modules', 'vendor', 'host-build', 'client-assets', 'artifact', '.git'].includes(entry.name)) continue
      const file = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name) && file !== 'tavern-plugin/lib/client.js') {
        const names = [...new Set([...readFileSync(path.join(base, file), 'utf8').matchAll(/['"`](@deepseek-ai\/[\w./-]+)['"`]/g)].map(match => match[1]))].sort()
        if (names.length) result[file] = names
      }
    }
  }
  for (const directory of ['bin', 'tavern-plugin', 'android']) walk(directory)
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}
export function addedReferences(current, baseline) {
  return Object.entries(current).flatMap(([file, names]) => names.filter(name => !baseline[file]?.includes(name)).map(name => ({ file, name })))
}
export function summarizeTap(output, status, optionalTests = {}) {
  const count = name => Number([...output.matchAll(new RegExp('^# ' + name + ' (\\d+)\\r?$', 'gm'))].at(-1)?.[1] ?? NaN)
  const tests = count('tests'), passed = count('pass'), failed = count('fail'), skipped = count('skipped')
  const optionalSkipped = [...output.matchAll(/^ok \d+ - (.*?) # SKIP.*$/gm)].map(match => match[1]).filter(name => Object.hasOwn(optionalTests, name))
  const requiredSkipped = skipped - optionalSkipped.length
  return { status: status === 0 && tests > 0 && passed > 0 && failed === 0 && requiredSkipped === 0 ? 'passed' : 'failed', tests, passed, failed, skipped, requiredSkipped, optionalSkipped }
}
export function compareReports(baseline, candidate) {
  return candidate.contracts.map(item => {
    const before = baseline.contracts.find(other => other.id === item.id)
    return { id: item.id, baseline: before?.status || 'missing', candidate: item.status,
      changedPackages: Object.keys(candidate.packages).filter(name => JSON.stringify(candidate.packages[name]) !== JSON.stringify(baseline.packages[name]))
        .filter(name => item.packages.includes(name)) }
  })
}
