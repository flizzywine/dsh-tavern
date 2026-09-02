import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse } from 'yaml'

/** Read-only migration adapter. Never rewrite DSH's shared settings document. */
export function legacyImageConfigurationReader(settingsPath = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'settings.yaml')) {
  return async () => {
    let content
    try { content = await readFile(settingsPath, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
    try {
      const legacy = parse(content)?.['image-generation']
      if (legacy != null && (typeof legacy !== 'object' || Array.isArray(legacy))) throw new Error('Invalid legacy configuration')
      return legacy == null ? {} : { provider: 'google', ...legacy }
    }
    catch { throw new Error('旧生图设置无法解析，未覆盖原配置') }
  }
}
