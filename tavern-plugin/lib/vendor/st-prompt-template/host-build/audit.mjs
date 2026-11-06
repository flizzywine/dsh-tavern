import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'

const root = fileURLToPath(new URL('../upstream/', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function auditUpstream({ directory = root, lockFile = new URL('../upstream-lock.json', import.meta.url) } = {}) {
  const lock = JSON.parse(await readFile(lockFile, 'utf8'))
  const files = Object.keys(lock.files).sort()
  const actual = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => relative(directory, resolve(entry.parentPath, entry.name)).split('\\').join('/')).sort()
  if (JSON.stringify(actual) !== JSON.stringify(files)) throw new Error('Upstream file inventory differs from lock')
  const imports = []
  for (const file of files) {
    const bytes = await readFile(resolve(directory, file))
    if (sha256(bytes) !== lock.files[file]) throw new Error('Upstream integrity mismatch: ' + file)
    if (!file.startsWith('src/') || !file.endsWith('.ts') || file.endsWith('.d.ts')) continue
    // Parse syntax only: never execute upstream code while auditing its host dependencies.
    const js = stripTypeScriptTypes(bytes.toString('utf8'), { mode: 'transform', sourceMap: false })
    const ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') continue
      const specifier = node.source.value
      const target = relative(directory, resolve(dirname(resolve(directory, file)), specifier))
      const kind = !specifier.startsWith('.') ? 'package' : target.startsWith('../') ? 'host' : 'upstream'
      imports.push({ file, specifier, kind, symbols: node.specifiers.map(s => s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported.name).sort() })
    }
  }
  const hosts = new Map()
  for (const item of imports.filter(item => item.kind === 'host')) {
    const name = item.specifier.replace(/^(\.\.\/)+/, '')
    const record = hosts.get(name) || { module: name, symbols: new Set(), consumers: new Set() }
    item.symbols.forEach(s => record.symbols.add(s))
    record.consumers.add(item.file)
    hosts.set(name, record)
  }
  return {
    repository: lock.repository, commit: lock.commit, version: lock.version,
    verifiedFiles: files.length,
    // An import inventory is not evidence of runtime compatibility.
    runtimeReady: false,
    hostModules: [...hosts.values()].sort((a,b) => a.module.localeCompare(b.module)).map(h => ({ module: h.module, symbols: [...h.symbols].sort(), consumers: [...h.consumers].sort() })),
    packageImports: [...new Set(imports.filter(item => item.kind === 'package').map(item => item.specifier))].sort(),
    imports
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await auditUpstream(), null, 2))
}
