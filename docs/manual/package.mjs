import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshots, pageScreenshots } from './screenshots.mjs'
import { demoDownloads } from '../../examples/manual-demo/downloads.mjs'

const docsRoot = fileURLToPath(new URL('../', import.meta.url))

// Publish the reader, not the entire docs tree (which also contains research).
export const publicFiles = [...new Set([
  'index.html', 'product.html',
  'assets/manual.css', 'assets/manual.js', 'assets/manual-state.js',
  'assets/product.css', 'assets/product.js', 'assets/social.png',
  ...Object.values(pageScreenshots).flat().map(key => `images/manual/${screenshots[key].file}`),
  ...['overview', 'card-editor', 'free-play-candidates', 'script-mode'].map(name => `images/readme/${name}.png`),
  ...Object.keys(demoDownloads).map(name => `examples/manual-demo/${name}`),
])]

export async function packagePages(destination) {
  // Require a new output directory so packaging can never overwrite existing data.
  await mkdir(destination)
  for (const file of publicFiles) {
    const source = path.join(docsRoot, file)
    if (!(await lstat(source)).isFile()) throw new Error(`Not a regular public file: ${file}`)
    const target = path.join(destination, file)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
  }
  await writeFile(path.join(destination, '.nojekyll'), '')
  return publicFiles.length
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node docs/manual/package.mjs <new-output-directory>')
  console.log(`Packaged ${await packagePages(path.resolve(process.argv[2]))} public documentation files`)
}
