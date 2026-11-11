import { symlinkSync } from 'node:fs'

export function createFileSymlink(t, target, link) {
  try {
    symlinkSync(target, link, 'file')
    return true
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error
    t.skip('Creating file symbolic links on Windows requires Developer Mode or symlink privilege')
    return false
  }
}
