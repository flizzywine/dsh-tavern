import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { auditUpstream } from './audit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export async function buildServerTemplate({ dependencyRoot, outputPath }) {
  const upstream = await auditUpstream()
  const lock = await readFile(resolve(here, '../upstream/package-lock.json'))
  if (!lock.equals(await readFile(resolve(dependencyRoot, 'package-lock.json')))) throw Error('Pinned upstream dependencies required')
  const require = createRequire(resolve(dependencyRoot, 'package.json'))
  const webpack = require('webpack'), root = resolve(here, '../upstream')
  await new Promise((accept, reject) => webpack({
    mode: 'production', target: 'web', context: root, entry: resolve(here, 'server-entry.js'),
    output: { path: resolve(outputPath), filename: 'engine.js', library: { name: 'DSHTemplate', type: 'var' }, publicPath: '', clean: true },
    resolve: { extensions: ['.ts', '.js'], alias: { marked$: createRequire(import.meta.url).resolve('marked') }, modules: [resolve(dependencyRoot, 'node_modules'), resolve(here, '../../../../../node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { configFile: false, babelrc: false, presets: [require.resolve('@babel/preset-typescript')] } } }] },
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      new webpack.NormalModuleReplacementPlugin(/^\.\.\//, resource => {
        if (resource.context.startsWith(root) && relative(root, resolve(resource.context, resource.request)).startsWith('../')) resource.request = resolve(here, 'host.js')
      })],
    performance: { hints: false }
  }, (error, stats) => error || stats.hasErrors() || stats.hasWarnings()
    ? reject(error || Error(stats.toString({ all: false, errors: true, warnings: true }))) : accept()))
  const files = {}
  for (const file of ['engine.js', 'engine.js.LICENSE.txt']) {
    const bytes = await readFile(resolve(outputPath, file))
    files[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  await writeFile(resolve(outputPath, 'manifest.json'), JSON.stringify({ upstreamCommit: upstream.commit, version: upstream.version, files }, null, 2) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildServerTemplate({ dependencyRoot: process.argv[2], outputPath: process.argv[3] })
}
