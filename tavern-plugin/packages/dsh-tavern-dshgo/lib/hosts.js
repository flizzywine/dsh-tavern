import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 必须指向宿主那一份的包；插件 import 它们，另装一份会拿到不同的服务实例，
 * 版本对不上还会被 dsh 判定 incompatible 后整行禁用。
 *
 * 按目录扫，不写清单：漏一个（比如 better-sidebar 要的 dsh-settings 不在酒馆自己的
 * dependencies 里）就会「failed to import: Cannot find package」。
 */
export function hostPackages(appRoot = '/opt/dsh', read = readdirSync) {
  try {
    return read(join(appRoot, 'node_modules', '@deepseek-ai'), { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
      .map(entry => `@deepseek-ai/${entry.name}`)
      .sort()
  } catch {
    return [
      '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol',
    ]
  }
}
