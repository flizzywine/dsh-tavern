import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function userExtensionPaths(dataRoot) {
  const root = path.resolve(dataRoot)
  return {
    tools: path.join(root, 'tools'),
    skills: path.join(root, 'skills'),
    config: path.join(root, 'tools.cordis.yml'),
  }
}

// Both installation and runtime startup may call this. Existing user files,
// including malformed manifests, belong to the user and are never rewritten.
export async function ensureUserExtensions(dataRoot) {
  const paths = userExtensionPaths(dataRoot)
  await Promise.all([mkdir(paths.tools, { recursive: true }), mkdir(paths.skills, { recursive: true })])
  try {
    await writeFile(paths.config, '[]\n', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return paths
}
