import { readFileSync } from 'node:fs'
import path from 'node:path'

// Browser fixtures must use the same export condition as the host client loader.
export function hostBrowserEntry(require, name) {
  const manifestPath = require.resolve(name + '/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.exports['./client']
  return path.resolve(path.dirname(manifestPath), typeof entry === 'string' ? entry : entry.browser ?? entry.default)
}
