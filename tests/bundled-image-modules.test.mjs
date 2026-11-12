import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createImageGenerator, stageImageProvider } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import { createImageLibrary } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/library-provider.js'
import { createJsonTransport } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/client/transport.js'
import { assembleImageClient, buildImageClient } from '../tavern-plugin/packages/dsh-tavern-image-bundled/build.mjs'

const packageRoot = new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url)
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('public library, channel, prompt and injected generation imports need neither Node services nor the full plugin', () => {
  const script = `import {registerHooks} from 'node:module';
    registerHooks({resolve(id, context, next) {
      if (id.startsWith('node:') || /(?:image-providers|index)\\.js$/.test(id)) throw Error('unwanted dependency: '+id);
      return next(id, context);
    }});
    const {createImageLibrary}=await import('dsh-tavern-image/library');
    const {createImageGenerator}=await import('dsh-tavern-image/generation');
    const {IMAGE_PROVIDERS}=await import('dsh-tavern-image/channels');
    const {resolvePromptMode}=await import('dsh-tavern-image/prompts');
    const {createJsonTransport}=await import('dsh-tavern-image/client/transport');
    if(typeof createJsonTransport!=='function') throw Error('missing browser transport');
    const library=createImageLibrary(()=>({characters:[{id:'a',name:'A'}]}));
    const generator=createImageGenerator(()=>({imageBackend:'openai',activeImageChannel:'a',imageChannels:[{id:'a',provider:'openai'}]}),async()=>({bytes:new Uint8Array([1]),mediaType:'image/png'}));
    const result=await generator.generate({prompt:'one traveler'});
    console.log(JSON.stringify([library.characters()[0].id,generator.models().length,IMAGE_PROVIDERS.length,resolvePromptMode({},'openai'),result.data[0]]));`
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(packageRoot), env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true, encoding: 'utf8', timeout: 15000,
  })
  assert.deepEqual(JSON.parse(output), ['a', 1, 9, 'natural', 1])
})

test('model discovery uses one snapshot, does not read credentials and isolates channel edits at generation', async () => {
  let reads = 0, seen
  const channel = { id: 'a', provider: 'openai', name: 'A', model: 'my-model', options: {} }
  Object.defineProperty(channel, 'apiKey', { enumerable: true, configurable: true, get() { throw Error('discovery touched a secret') } })
  const config = { imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [channel] }
  const generator = createImageGenerator(() => { reads++; return config }, async value => { seen = value; return { bytes: new Uint8Array([1]), mediaType: 'image/png' } })
  assert.equal(generator.models()[0].model, 'my-model')
  assert.equal(reads, 1)
  assert.equal(generator.status().ready, true)
  Object.defineProperty(channel, 'apiKey', { value: 'secret', enumerable: true })
  const generated = generator.generate({ prompt: 'one traveler' })
  channel.options.changed = true
  await generated
  assert.deepEqual(seen.options, {})
  const controller = new AbortController(); controller.abort(new Error('stop'))
  await assert.rejects(generator.generate({ prompt: 'one traveler', signal: controller.signal }), /stop/)
  await assert.rejects(generator.generate({ prompt: 'one traveler', modelId: 'removed' }), { requestMayHaveSucceeded: false })
})

test('stage generator applies the channel template or saved default without requesting a planner', async () => {
  const requests = []
  const defaultPreset = { name: '默认', structure: { format: 'natural', blocks: [{ kind: 'positive', title: '氛围', text: '明亮的室内光' }] } }
  const config = { imageBackend: 'openai', activeImageChannel: 'a', imageChannels: [{ id: 'a', provider: 'openai' }, { id: 'b', provider: 'openai' }],
    promptDefault: defaultPreset,
    stylePresets: [{ id: 'watercolor', artist: '舞台水彩', negative: '过曝' }],
    promptPresets: [{ id: 'bound', name: '舞台模板', structure: { format: 'structured', generationRules: '这段只给规划器',
      targets: [{ kind: 'channel', id: 'b' }],
      blocks: [
        { kind: 'positive', title: '用光', text: '柔和的侧光' },
        { kind: 'negative', title: '限制', text: '不要水印' },
        { kind: 'style', title: '舞台画风', text: '柔和色彩', usage: 'stage', styleId: 'watercolor' },
        { kind: 'positive', title: '插件自定义', text: '接续原图边缘', usage: 'custom-expand' },
        { kind: 'positive', title: '关闭的模块', text: '禁用词', enabled: false },
      ] } }],
  }
  const adapter = async (channel, request) => {
    requests.push({ channel: channel.id, ...request })
    return { bytes: new Uint8Array([1]), mediaType: 'image/png' }
  }
  const generator = stageImageProvider(() => config, adapter)
  await generator.generate({ prompt: '窗边的桌子', width: 512, height: 512 })
  assert.match(requests[0].positive, /窗边的桌子.*明亮的室内光/)
  await generator.generate({ modelId: 'b', prompt: '窗边的桌子', width: 512, height: 512 })
  assert.deepEqual([requests[1].channel, requests[1].promptMode, requests[1].negative], ['b', 'structured', '不要水印\n\n过曝'])
  assert.match(requests[1].positive, /【用光】\n柔和的侧光/)
  assert.match(requests[1].positive, /舞台水彩\n柔和色彩/)
  assert.doesNotMatch(requests[1].positive, /这段只给规划器|明亮的室内光|接续原图边缘|禁用词/)
  await createImageGenerator(() => config, adapter).generate({ modelId: 'b', prompt: '窗边的桌子', usage: 'custom-expand' })
  assert.match(requests[2].positive, /接续原图边缘/)
  assert.doesNotMatch(requests[2].positive, /舞台水彩|禁用词/)
  assert.equal(requests[2].negative, '不要水印')
  config.promptDefault = null
  await generator.generate({ prompt: '保留调用方的原文', width: 512, height: 512 })
  assert.equal(requests[3].positive, '保留调用方的原文')
})

test('library projections read one live snapshot, preserve shared outfit text and do not mutate records', () => {
  let reads = 0, definitions = { characters: [{ id: 'a', name: 'A', traits: { face: 'original' }, outfitRefs: ['coat'] }], outfits: [{ id: 'coat', name: 'Coat', body: 'front', full: 'full outfit', bodyBack: 'back' }] }
  const library = createImageLibrary(() => { reads++; return definitions })
  const first = library.characters()
  assert.equal(reads, 1)
  first[0].traits.face = 'edited outside'
  assert.equal(definitions.characters[0].traits.face, 'original')
  const outfit = library.outfits({ characterId: 'a' })[0]
  assert.equal(reads, 2)
  assert.deepEqual([outfit.parts.upper, outfit.parts.full, outfit.parts.back], ['front', 'full outfit', 'back'])
  definitions = { characters: [{ id: 'b', name: 'B' }], outfits: [] }
  assert.equal(library.characters()[0].id, 'b')
})

test('browser transport retries reads, keeps conflict details and never retries writes', async () => {
  const calls = []
  const request = createJsonTransport({ fetchImpl: async (_url, init) => { calls.push(init); if (calls.length === 1) throw new TypeError('network'); return json({ ok: true }) } })
  assert.equal((await request('/state')).ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].cache, 'no-store')
  let writes = 0
  const write = createJsonTransport({ fetchImpl: async () => { writes++; throw new TypeError('lost response') } })
  await assert.rejects(write('/jobs', { method: 'POST', body: '{}' }), /lost response/)
  assert.equal(writes, 1)
  const conflict = createJsonTransport({ fetchImpl: async () => json({ ok: false, error: 'changed', code: 'REVISION_CONFLICT', submissionNotStarted: true }, 409) })
  await assert.rejects(conflict('/definitions', { method: 'POST' }), { code: 'REVISION_CONFLICT', submissionNotStarted: true })
})

test('cancelled browser reads stop before retrying and preserve the abort reason', async () => {
  const controller = new AbortController(), reason = new Error('user cancelled')
  let calls = 0
  const request = createJsonTransport({ fetchImpl: async () => { calls++; throw new TypeError('network') }, onRetry: () => controller.abort(reason) })
  await assert.rejects(request('/state', { signal: controller.signal }), error => error === reason)
  assert.equal(calls, 1)
})

test('frontend build is reproducible and rejects stale or invalid sources before replacing the runtime artifact', async t => {
  assert.equal(await assembleImageClient(), (await readFile(new URL('client.js', packageRoot), 'utf8')).replace(/\r\n/g, '\n'))
  const directory = await mkdtemp(join(tmpdir(), 'image-client-build-')), fixture = pathToFileURL(directory + sep)
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'lib/client'), { recursive: true })
  await cp(new URL('src', packageRoot), join(directory, 'src'), { recursive: true })
  for (const file of ['lib/client/transport.js', 'lib/image-provider-capabilities.js', 'lib/library-prompts.js', 'client.js']) await cp(new URL(file, packageRoot), join(directory, file))
  const target = join(directory, 'client.js'), original = await readFile(target, 'utf8')
  await writeFile(join(directory, 'src/client/settings.js'), '\nfunction broken( {')
  await assert.rejects(buildImageClient({ packageRoot: fixture }), SyntaxError)
  assert.equal(await readFile(target, 'utf8'), original)
  await cp(new URL('src/client/settings.js', packageRoot), join(directory, 'src/client/settings.js'))
  await writeFile(target, 'old artifact')
  await assert.rejects(buildImageClient({ check: true, packageRoot: fixture }), /已过期/)
  assert.equal(await readFile(target, 'utf8'), 'old artifact')
  const main = await readFile(join(directory, 'src/client/main.js'), 'utf8')
  await writeFile(join(directory, 'src/client/main.js'), main.replace('@include media.js', '@include ../../outside.js'))
  await assert.rejects(assembleImageClient(fixture), /Incomplete/)
})

test('runtime manifests retain independent SDK entries and the browser artifact, excluding frontend source fragments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'image-modular-manifest-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const name of ['android', 'bin', 'config', 'presets', 'patches', 'tavern-plugin']) await mkdir(join(directory, name))
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh']) await writeFile(join(directory, name), '')
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '3.10.0' }))
  const base = 'tavern-plugin/packages/dsh-tavern-image-bundled/'
  const included = ['client.js', 'lib/model-provider.js', 'lib/library-provider.js', 'lib/library-prompts.js', 'lib/api/generation.d.ts', 'lib/client/transport.js']
  for (const name of [...included, 'src/client/main.js', 'src/client/settings.js']) {
    const target = join(directory, base + name)
    await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, 'fixture')
  }
  execFileSync(process.execPath, [fileURLToPath(new URL('../.github/scripts/write-runtime-manifest.mjs', import.meta.url)), 'a'.repeat(40), '1'], {
    cwd: directory, env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true, timeout: 10000,
  })
  const manifest = JSON.parse(await readFile(join(directory, 'dsh-tavern-runtime.json'), 'utf8'))
  const paths = new Set(manifest.files.map(file => file.path))
  for (const name of included) assert.ok(paths.has(base + name))
  assert.equal([...paths].some(name => name.startsWith(base + 'src/')), false)
})
