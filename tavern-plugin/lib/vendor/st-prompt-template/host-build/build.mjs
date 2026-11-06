import { createRequire } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditUpstream } from './audit.mjs'
const here = dirname(fileURLToPath(import.meta.url))
export async function buildTemplatePlugin({ dependencyRoot, outputPath }) {
  const upstream = await auditUpstream()
  const lock = await readFile(resolve(here, '../upstream/package-lock.json'))
  const installedLock = await readFile(resolve(dependencyRoot, 'package-lock.json'))
  if (!lock.equals(installedLock)) throw new Error('Build dependencies must use the pinned upstream package-lock.json')
  const require = createRequire(resolve(dependencyRoot, 'package.json'))
  const webpack = require('webpack')
  const MonacoPlugin = require('monaco-editor-webpack-plugin')
  const root = resolve(here, '../upstream')
  const config = {
    mode: 'production', target: 'web', context: root, entry: resolve(here, 'entry.js'),
    output: { path: resolve(outputPath), filename: 'index.js', chunkFilename: '[name].[contenthash].js', library: { type: 'module' }, publicPath: 'auto', clean: true },
    experiments: { outputModule: true },
    resolve: { extensions: ['.ts', '.js'], alias: { marked$: createRequire(import.meta.url).resolve('marked') }, modules: [resolve(dependencyRoot, 'node_modules'), 'node_modules'] },
    module: { rules: [
      { resourceQuery: /language-only/, enforce: 'pre', use: resolve(here, 'editor-language-loader.cjs') },
      { test: /\.ts$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { configFile: false, babelrc: false, presets: [require.resolve('@babel/preset-typescript')] } } },
      { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] }
    ] },
    plugins: [
      new webpack.NormalModuleReplacementPlugin(/^\.\.\//, resource => {
        if (!resource.context.startsWith(root)) return
        const target = resolve(resource.context, resource.request)
        if (relative(root, target).startsWith('../')) resource.request = resolve(here, 'host.js')
      }),
      new MonacoPlugin({ monacoEditorPath: resolve(dependencyRoot, 'node_modules/monaco-editor'), languages: ['javascript'], customLanguages: [], filename: '[name].worker.js' })
    ],
    optimization: { minimize: true }, performance: { hints: false }
  }
  await new Promise((accept, reject) => webpack(config, (error, stats) => {
    if (error) return reject(error)
    if (stats.hasErrors() || stats.hasWarnings()) return reject(new Error(stats.toString({ all: false, errors: true, warnings: true })))
    accept()
  }))
  await new Promise((accept, reject) => webpack({
    mode:'production', target:'webworker', entry:resolve(here,'compiler-worker.js'),
    resolve:{modules:[resolve(dependencyRoot,'node_modules')]},
    output:{path:resolve(outputPath),filename:'ejs.workers.js'}, performance:{hints:false}
  }, (error,stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({all:false,errors:true}))) : accept()))
  await writeFile(resolve(outputPath, 'settings.html'), await readFile(resolve(here, '../upstream/settings.html')))
  const files = {}
  for (const name of (await readdir(outputPath)).sort()) {
    const bytes = await readFile(resolve(outputPath, name))
    files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  await writeFile(resolve(outputPath, 'manifest.json'), JSON.stringify({
    upstreamCommit: upstream.commit, version: upstream.version,
    entry: 'index.js', hostIntegrated: true, files
  }, null, 2) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dependencyRoot, outputPath] = process.argv.slice(2)
  if (!dependencyRoot || !outputPath) throw new Error('Usage: node build.mjs <upstream npm-ci directory> <output directory>')
  await buildTemplatePlugin({ dependencyRoot, outputPath })
  console.log('Built all official template entry modules')
}
