import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const name = 'dsh-tavern-bundle'
const dshRange = '>=0.2.2-rc.1 <0.3.0'
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n')
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z.-]+)?$/i
const [mode, target, arg, commit] = process.argv.slice(2)
const project = await readJson(path.join(root, 'package.json'))
const repository = project.repository.url
const components = [
  ['dsh-pocket'],
  ['dsh-better-sidebar'],
  ['dsh-dream-skin', 'tavern-plugin/packages/dsh-dream-skin'],
  ['dsh-tavern-plugin', 'tavern-plugin'],
  ['dsh-tavern-remote', 'tavern-plugin/packages/dsh-tavern-remote'],
  ['dsh-asset-library', 'tavern-plugin/packages/dsh-asset-library'],
  ['dsh-tavern-stage', 'tavern-plugin/packages/dsh-tavern-stage'],
  ['dsh-tavern-tts', 'tavern-plugin/packages/dsh-tavern-tts'],
  ['dsh-tavern', 'tavern-plugin/packages/dsh-tavern/next'],
]

async function build(destination, version) {
  if (!versionPattern.test(version)) throw new Error('Expected a SemVer version')
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  // A new directory prevents stale files or local data from entering a release.
  await mkdir(destination)
  const copy = async (from, to) => {
    await mkdir(path.dirname(to), { recursive: true })
    await copyFile(from, to)
  }
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'tavern-plugin', 'presets', 'bin', 'config', 'LICENSE'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const file of tracked) {
    const officialLauncher = file.startsWith('tavern-plugin/packages/dsh-tavern/') && !file.startsWith('tavern-plugin/packages/dsh-tavern/next/')
    if (officialLauncher || /(^|\/)(tests|__tests__|docs)(\/|$)/.test(file)) continue
    // Ship the built clients. Keep the CommonJS contracts the Tavern and stage hosts still read.
    if (file.startsWith('tavern-plugin/src/') && !file.endsWith('.cjs')) continue
    if (/^tavern-plugin\/packages\/dsh-(?:asset-library|tavern-stage|tavern-tts|tavern-image-bundled)\/src\//.test(file)) continue
    // The plugin manager already serves these client files from node_modules below.
    if (file === 'tavern-plugin/lib/client.js' || file === 'tavern-plugin/packages/dsh-tavern-stage/lib/client.js') continue
    // Dream Skin retrieves these verified font binaries on demand.
    if (/^tavern-plugin\/packages\/dsh-dream-skin\/fonts\/.*\.(?:woff2?|ttf|otf)$/i.test(file)) continue
    if (/\/lib\/vendor\/st-prompt-template\/upstream\/(?!LICENSE$|settings\.html$)/.test(file)) continue
    if (/\/lib\/vendor\/magvarupdate\/upstream\/(?!LICENSE$)/.test(file)) continue
    await copy(path.join(root, file), path.join(destination, file))
  }
  const dependencies = { ...project.dependencies }
  const patches = []
  for (const [component, canonical] of components) {
    const installed = 'node_modules/' + component
    const input = path.join(root, canonical || installed)
    const output = path.join(destination, installed)
    const manifest = await readJson(path.join(input, 'package.json'))
    const patch = manifest.dsh.bundle.patch
    patches.push(...[patch].flat().map(file => path.posix.join(canonical || installed, file)))
    for (const [dependency, range] of Object.entries(manifest.dependencies || {})) {
      // The Next runtime supplies the host packages and their shared classes.
      if (!dependency.startsWith('@deepseek-ai/')) dependencies[dependency] ??= range
    }
    dependencies[component] = manifest.version
    if (canonical) {
      await mkdir(output, { recursive: true })
      for (const [key, conditions] of Object.entries(manifest.exports)) {
        const file = typeof conditions === 'string' ? conditions : conditions.default
        if (!file || key === './package.json' || key === './build') continue
        const entry = path.join(output, file)
        if (key === './client' || file.endsWith('.json')) {
          await copy(path.join(input, file), entry)
        } else {
          // Host modules share state with the rest of Tavern and need its
          // original relative imports. Browser entries are served as files.
          await mkdir(path.dirname(entry), { recursive: true })
          const relative = path.relative(path.dirname(entry), path.join(destination, canonical, file)).split(path.sep).join('/')
          const specifier = JSON.stringify(relative)
          const hasDefault = component === 'dsh-tavern-remote' && ['.', './remote'].includes(key)
          await writeFile(entry, 'export * from ' + specifier + '\n' + (hasDefault ? 'export { default } from ' + specifier + '\n' : ''))
        }
      }
    } else {
      await cp(input, output, { recursive: true, filter: file => !path.relative(input, file).split(path.sep).includes('node_modules') })
    }
    await writeJson(path.join(output, 'package.json'), {
      ...(!canonical ? manifest : {}),
      name: component, version: manifest.version, type: manifest.type,
      exports: manifest.exports, dsh: manifest.dsh,
      dependencies: Object.fromEntries(Object.entries(manifest.dependencies || {}).filter(([dependency]) => !dependency.startsWith('@deepseek-ai/'))),
    })
  }
  await writeJson(path.join(destination, 'package.json'), {
    name, version, description: project.description, repository: project.repository,
    license: 'AGPL-3.0-only',
    engines: { ...project.engines, dsh: dshRange },
    dependencies, bundledDependencies: components.map(([component]) => component),
    dsh: { bundle: { patch: patches } },
    dshTavern: { distribution: 'plugin', sourceCommit },
  })
}

async function catalog(file, manifestFile, revision) {
  if (!/^[a-f\d]{40}$/i.test(revision)) throw new Error('Expected the full Git SHA of the distribution commit')
  const manifest = await readJson(manifestFile)
  if (manifest.name !== name || !versionPattern.test(manifest.version)) throw new Error('Expected the built Tavern bundle manifest')
  const previous = await readJson(file).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return { format: 1, title: 'DSH Tavern', plugins: [] }
  })
  const existing = previous.plugins.find(plugin => plugin.name === name)
  const versions = existing?.versions || []
  const same = versions.find(version => version.version === manifest.version)
  if (same && same.source.commit !== revision) throw new Error('This version already points to a different commit')
  if (!same) versions.unshift({
    version: manifest.version,
    publishTimestamp: Math.floor(Date.now() / 1000),
    source: { type: 'git', url: repository, commit: revision },
    engines: { dsh: dshRange },
  })
  const plugin = {
    name, title: 'DSH Tavern', description: '在独立的 tavern Profile 中使用酒馆。',
    author: 'flizzywine', homepage: repository.replace(/\.git$/, ''), versions,
  }
  previous.plugins = previous.plugins.filter(entry => entry.name !== name).concat(plugin)
  await writeJson(file, previous)
}

if (mode === 'build' && target) await build(path.resolve(target), arg || project.version)
else if (mode === 'catalog' && target && arg && commit) await catalog(path.resolve(target), path.resolve(arg), commit)
else throw new Error('Usage: build-next-plugin.mjs build <new-output-dir> [version] | catalog <index.json> <bundle-package.json> <commit>')
