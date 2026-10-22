import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Hoisted dependencies can live above jsdom's own node_modules directory.
// Grant only dependency directories, never their containing app/profile roots.
export function workerModuleReadFlags(packageFile) {
  const directories = new Set()
  for (let directory = dirname(packageFile); ; directory = dirname(directory)) {
    const modules = join(directory, 'node_modules')
    if (existsSync(modules)) directories.add(modules)
    if (dirname(directory) === directory) break
  }
  return [...directories].map(directory => '--allow-fs-read=' + directory)
}
