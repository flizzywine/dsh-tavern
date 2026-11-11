import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 酒馆自己的六个包；它们 package.json 里声明过的 @deepseek-ai/* 才是 profile 需要的。 */
export const TAVERN_PACKAGE_DIRS = Object.freeze([
  'tavern-plugin',
  'tavern-plugin/packages/dsh-tavern-remote',
  'tavern-plugin/packages/dsh-dream-skin',
  'tavern-plugin/packages/dsh-tavern-tts',
  'tavern-plugin/packages/dsh-asset-library',
  'tavern-plugin/packages/dsh-tavern-stage',
])

/** 宿主 /opt/dsh/node_modules/@deepseek-ai 里实际有哪些包。 */
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

/**
 * profile 里该 link 的宿主包：酒馆的包声明了、宿主里也确实有的那些。
 *
 * 不能把宿主目录里的 331 个全 link 进来。dsh-host-webserver 这类服务必须在 profile 里
 * 只出现一份，link 进去就成了第二个来源，服务注册失败，web-runtime（required）等不到
 * webServer，整站请求挂住不返回——表现就是白屏。
 */
export function declaredHostPackages({
  srcRoot = process.cwd(),
  appRoot = '/opt/dsh',
  read = readFileSync,
  scan = readdirSync,
} = {}) {
  const declared = new Set()
  for (const dir of TAVERN_PACKAGE_DIRS) {
    let manifest
    try {
      manifest = JSON.parse(read(join(srcRoot, dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (name.startsWith('@deepseek-ai/')) declared.add(name)
      }
    }
  }
  const available = new Set(hostPackages(appRoot, scan))
  return [...declared].filter(name => available.has(name)).sort()
}
