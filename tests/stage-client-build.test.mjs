import test from 'node:test'
import assert from 'node:assert/strict'
import {cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

test('stage overlay builds and imports with only its own package files, the shared protocol contracts and the mod stage clients it bundles', async t => {
  const plugin = await mkdtemp(path.join(tmpdir(), 'stage-client-build-')), packages = path.join(plugin, 'packages')
  t.after(() => rm(plugin, {recursive:true,force:true}))
  // The mods' stage clients (mods/<folder>/client/stage.cjs and the own-folder files they require).
  await cp(new URL('../tavern-plugin/mods/', import.meta.url), path.join(plugin, 'mods'), {recursive:true})
  const root = path.join(packages, 'dsh-tavern-stage')
  const pkg = new URL('../tavern-plugin/packages/dsh-tavern-stage/', import.meta.url)
  // The sibling protocol package: build.mjs inlines the stage-only contracts (stage-entrance.cjs, and card-stage-mode.cjs for
  // the asset-pack card page) into the stage client.
  await mkdir(path.join(packages, 'dsh-presentation-protocol/src'), {recursive:true})
  for (const name of ['stage-entrance.cjs', 'card-stage-mode.cjs'])
    await copyFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/' + name, import.meta.url), path.join(packages, 'dsh-presentation-protocol/src', name))
  await cp(new URL('src/',pkg), path.join(root,'src'), {recursive:true})
  await copyFile(new URL('build.mjs',pkg),path.join(root,'build.mjs'))
  await mkdir(path.join(root,'lib/client'),{recursive:true})
  await copyFile(new URL('lib/client-assets.js',pkg),path.join(root,'lib/client-assets.js'))
  await copyFile(new URL('lib/client/skin-overlay-timing.cjs',pkg),path.join(root,'lib/client/skin-overlay-timing.cjs'))
  for(const name of ['lifetime.cjs','entry.cjs','resources.cjs','runtime-store.cjs','session.cjs','director-source.cjs','resource-runner.cjs','runtime-kernel.cjs'])await copyFile(new URL('lib/client/'+name,pkg),path.join(root,'lib/client',name))
  const run = args => spawnSync(process.execPath,[path.join(root,'build.mjs'),...args],{encoding:'utf8'})
  const built = run([])
  assert.equal(built.status,0,built.stderr)
  const output = path.join(root,'lib/client/skin-overlay.mjs')
  const module = await import(pathToFileURL(output).href)
  assert.equal(typeof module.createSkinOverlayPlayer,'function')
  assert.equal(typeof module.createDecorativeScript,'function')
  assert.equal(run(['--check']).status,0)
  for (const name of ['entry.js','navigation.cjs','text.cjs','themes.css','source-widgets.css']) {
    const file = path.join(root,'src/client',name)
    await writeFile(file,(await readFile(file,'utf8')).replace(/\r?\n/g,'\r\n'))
  }
  assert.equal(run(['--check']).status,0,'Windows source line endings produce identical client bytes')
  const old = await readFile(output,'utf8')
  await writeFile(path.join(root,'src/client/skin-overlay-motion.cjs'),'const = invalid;')
  assert.notEqual(run([]).status,0)
  assert.equal(await readFile(output,'utf8'),old,'failed build preserves the existing artifact')
})
