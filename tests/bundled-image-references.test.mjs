import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createReferenceImageStore, resolveImageReferences, buildReferenceText, referencePlannerGuidance, referenceScopedDefinitions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/reference-images.js'

// Tiny genuine images encoded by Pillow, not just file signatures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==', 'base64')
const WEBP = Buffer.from('UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=', 'base64')
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z', 'base64')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const image = (bytes = PNG, mediaType = 'image/png', name = '角色.png') => ({ id: digest(bytes), mediaType, name, byteLength: bytes.length })
const upload = (bytes = PNG, mediaType = 'image/png', name = '角色.png') => ({ data: bytes.toString('base64'), mediaType, name })
const macro = body => '${' + JSON.stringify(body).slice(1, -1) + '}$'
const code = expected => error => error.code === expected && error.submissionNotStarted === true
async function tempStore(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-reference-test-'))
  // Only this exact mkdtemp-created directory is removed.
  const target = resolve(root)
  t.after(() => rm(target, { recursive: true, force: true }))
  return { root, store: createReferenceImageStore(root, options) }
}
function definitions() {
  return { characters: [
    { id: 'alice', name: '林月', match: 'Alice, Lin Yue', traits: { feature: 'calm woman', face: 'long red hair, green eyes', bodySFW: 'tall figure', negative: 'short hair' }, referenceImage: image(), consistencyText: '保留左眼下的小痣',
      current: { outfit: 'Blue Coat', previous: 'Old Dress' }, outfits: [
        { id: 'coat', name: 'Blue Coat', upper: 'dark blue wool coat', lower: 'black trousers', shoes: 'black boots', default: true, referenceImage: image(WEBP, 'image/webp', 'coat.webp'), consistencyText: '保留银色扣子', negative: 'red coat' },
        { id: 'dress', name: 'Old Dress', upper: 'white linen dress', lower: 'long hem', referenceImage: image(JPEG, 'image/jpeg', 'dress.jpg') },
        { id: 'text-only', name: 'Training Uniform', upper: 'plain green jacket', lower: 'grey trousers' },
      ] },
    { id: 'bob', name: '陈风', match: 'Bob, Chen Feng', traits: { face: 'short black hair, blue eyes' }, outfits: [
      { id: 'uniform', name: 'Black Uniform', upper: 'black uniform', referenceImage: image(WEBP, 'image/webp') },
      { id: 'plain', name: 'Plain Clothes', upper: 'orange jacket', default: true },
    ] },
    { id: 'unused', name: '无关人物', match: 'Unused', referenceImage: image(), traits: { face: 'UNRELATED APPEARANCE' }, outfits: [] },
    { id: 'disabled', name: '停用角色', enabled: false, referenceImage: image(), outfits: [] },
  ], outfits: [
    { id: 'shared-robe', name: 'Moon Robe', match: '月白长袍', body: 'silver silk robe', full: 'silver robe with embroidery', referenceImage: image(), consistencyText: '月纹刺绣' },
  ], settings: [{ id: 'room', name: '室内', match: 'room', description: 'wooden walls' }], props: [] }
}

test('readById previews drafts using only strict hashes and derives verified media metadata', async t => {
  const { store, root } = await tempStore(t)
  for (const [bytes, mediaType, extension] of [[PNG, 'image/png', '.png'], [JPEG, 'image/jpeg', '.jpg'], [WEBP, 'image/webp', '.webp']]) {
    const saved = await store.put(upload(bytes, mediaType))
    const preview = await store.readById(saved.id)
    assert.deepEqual(preview.data, bytes)
    assert.equal(preview.mediaType, mediaType)
    assert.equal(preview.name, saved.id + extension)
    assert.deepEqual(preview.referenceImage, { ...saved, name: saved.id + extension })
  }
  for (const id of ['../outside', 'https://example.com/x', image().id.toUpperCase(), { id: image().id }, null]) await assert.rejects(store.readById(id), code('REFERENCE_DESCRIPTOR_INVALID'))
  await assert.rejects(store.readById('f'.repeat(64)), code('REFERENCE_IMAGE_MISSING'))
  await assert.rejects(createReferenceImageStore(root, { maxBytes: PNG.length - 1 }).readById(image().id), code('REFERENCE_IMAGE_TOO_LARGE'))
  const fake = Buffer.from('not an image'), fakeId = digest(fake)
  await writeFile(join(root, fakeId), fake)
  await assert.rejects(store.readById(fakeId), code('REFERENCE_IMAGE_INVALID'))
  const corrupt = Buffer.from(PNG); corrupt[40] ^= 1
  await writeFile(join(root, image().id), corrupt)
  await assert.rejects(store.readById(image().id), code('REFERENCE_IMAGE_CORRUPT'))
})

test('store deduplicates concurrent bytes across store instances without overwriting old snapshots', async t => {
  const { store, root } = await tempStore(t)
  const other = createReferenceImageStore(root)
  const [first, second, third] = await Promise.all([store.put(upload()), store.put(upload()), other.put(upload(PNG, 'image/png', 'second-name.png'))])
  assert.equal(first.id, second.id)
  assert.equal(first.id, third.id)
  assert.notEqual(first.name, third.name)
  const before = await lstat(join(root, first.id))
  const replacement = await store.put(upload(WEBP, 'image/webp', 'replacement.webp'))
  await store.put(upload())
  const after = await lstat(join(root, first.id))
  assert.equal(before.mtimeMs, after.mtimeMs)
  assert.deepEqual((await store.read(first)).data, PNG)
  assert.deepEqual((await store.read(replacement)).data, WEBP)
  assert.equal((await readdir(root)).length, 2)
})

test('store enforces exact byte limit and MIME consistency, not filename extensions', async t => {
  const { root } = await tempStore(t)
  const exact = createReferenceImageStore(root, { maxBytes: PNG.length })
  await exact.put(upload())
  const small = createReferenceImageStore(root, { maxBytes: PNG.length - 1 })
  await assert.rejects(small.put(upload()), code('REFERENCE_IMAGE_TOO_LARGE'))
  await assert.rejects(small.read(image()), code('REFERENCE_IMAGE_TOO_LARGE'))
  await assert.rejects(exact.put(upload(PNG, 'image/jpeg')), code('REFERENCE_MEDIA_TYPE_MISMATCH'))
  await assert.rejects(exact.put({ data: 'data:image/png;base64,' + PNG.toString('base64'), mediaType: 'image/jpeg' }), code('REFERENCE_MEDIA_TYPE_MISMATCH'))
  assert.throws(() => createReferenceImageStore(root, { maxBytes: -1 }), code('REFERENCE_STORE_INVALID'))
  assert.throws(() => createReferenceImageStore('https://example.com/store'), code('REFERENCE_STORE_INVALID'))
})

test('store rejects truncated containers CRC corruption fake signatures and trailing payloads', async t => {
  const { store } = await tempStore(t)
  const crcBroken = Buffer.from(PNG); crcBroken[45] ^= 1
  const invalidWebp = Buffer.from(WEBP); invalidWebp.writeUInt32LE(0xffffffff, 16)
  for (const bytes of [PNG.subarray(0, 8), PNG.subarray(0, -1), crcBroken, JPEG.subarray(0, -2), Buffer.from([255, 216, 255, 217]), WEBP.subarray(0, 12), invalidWebp,
    Buffer.concat([PNG, Buffer.from('<script>evil</script>')]), Buffer.from('<svg>not a raster image</svg>')]) {
    await assert.rejects(store.put({ data: bytes.toString('base64') }), code('REFERENCE_IMAGE_INVALID'))
  }
})

test('read validates snapshot length media type and SHA; put never repairs corrupt hash files in place', async t => {
  const { store, root } = await tempStore(t)
  const descriptor = await store.put(upload())
  await assert.rejects(store.read({ ...descriptor, byteLength: descriptor.byteLength + 1 }), code('REFERENCE_IMAGE_CORRUPT'))
  await assert.rejects(store.read({ ...descriptor, mediaType: 'image/jpeg' }), code('REFERENCE_MEDIA_TYPE_MISMATCH'))
  await assert.rejects(store.read({ ...descriptor, id: 'a'.repeat(64) }), code('REFERENCE_IMAGE_MISSING'))
  await assert.rejects(store.read({ ...descriptor, path: '../image.png' }), code('REFERENCE_DESCRIPTOR_INVALID'))
  const corrupt = Buffer.from(PNG); corrupt[corrupt.length - 1] ^= 1
  await writeFile(join(root, descriptor.id), corrupt)
  await assert.rejects(store.read(descriptor), code('REFERENCE_IMAGE_CORRUPT'))
  await assert.rejects(store.put(upload()), code('REFERENCE_IMAGE_CORRUPT'))
  assert.deepEqual(await readFile(join(root, descriptor.id)), corrupt)
})

test('all public store operations redact native filesystem errors while preserving domain failures', async t => {
  const { root } = await tempStore(t)
  const blocked = join(root, 'private-reference-root-is-a-file')
  await writeFile(blocked, 'not a directory')
  const store = createReferenceImageStore(blocked)
  for (const operation of [() => store.put(upload()), () => store.read(image()), () => store.readById(image().id)]) {
    await assert.rejects(operation, error => {
      assert.equal(error.code, 'REFERENCE_STORAGE_UNAVAILABLE')
      assert.equal(error.submissionNotStarted, true)
      assert.match(error.message, /^本地参考图存储不可用（E[A-Z0-9_]+）$/)
      assert.ok(!error.message.includes(root))
      assert.ok(!error.message.includes('private-reference-root-is-a-file'))
      assert.equal(error.path, undefined)
      assert.equal(error.cause, undefined)
      return true
    })
  }
  await assert.rejects(() => store.put({ data: 'invalid' }), code('REFERENCE_UPLOAD_INVALID'))
  await assert.rejects(() => store.read({ path: blocked }), code('REFERENCE_DESCRIPTOR_INVALID'))
  await assert.rejects(() => store.readById(blocked), code('REFERENCE_DESCRIPTOR_INVALID'))
})

test('explicit name-only subjects stay textual alongside pictured people and survive snapshot scoping', async () => {
  const { parseImagePlan } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js')
  const { compileChannelJob } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const defs = definitions()
  const raw = '【人物】\nAlice 与陌生旅人。旅人戴着紫色帽子。\n\n【动作】\n在窗边交谈。'
  const parsed = parseImagePlan('<image><prompts>' + raw + '</prompts><subjects>[{"characterId":"alice"},{"name":"陌生旅人"}]</subjects></image>')[0]
  assert.equal(parsed.subjectsError, undefined)
  const result = resolveImageReferences({ definitions: defs, subjects: parsed.subjects, text: parsed.prompts })
  assert.deepEqual(result.subjects, [{ characterId: 'alice', outfitId: '' }, { name: '陌生旅人' }])
  assert.deepEqual(result.references.map(ref => ref.characterId), ['alice'])
  const scoped = referenceScopedDefinitions(defs, result.references, { subjects: result.subjects })
  assert.deepEqual(scoped.characters.map(person => person.id), ['alice'], 'never invent a library entry or default outfit for an unknown person')
  const compiled = compileChannelJob({ params: { tag: raw, rawTag: raw }, config: { imageBackend: 'atlascloud', promptMode: 'structured' }, definitions: scoped, channel: { provider: 'atlascloud' } })
  assert.match(compiled.positive, /陌生旅人。旅人戴着紫色帽子/)
  assert.equal(resolveImageReferences({ definitions: defs, subjects: [{ name: 'Alice' }] }).references.length, 0, 'name-only does not implicitly bind a similarly named library person')
  assert.throws(() => resolveImageReferences({ definitions: defs, subjects: [{ characterId: 'missing', name: '陌生旅人' }] }), code('REFERENCE_ID_UNKNOWN'))
  for (const subject of [{ name: '' }, { name: 42 }, { characterId: null, name: '旅人' }]) {
    assert.throws(() => resolveImageReferences({ definitions: defs, subjects: [subject] }), code('REFERENCE_SUBJECT_INVALID'))
  }
})

test('legacy complete aliases avoid Li/Lina and prefer full Chinese form names', () => {
  const defs = { characters: [
    { id: 'li', name: '林', match: 'Li', referenceImage: image() },
    { id: 'lina', name: '林月', match: 'Lina', referenceImage: image() },
    { id: 'fox', name: '林月（狐形）', match: 'Lina Fox', referenceImage: image() },
  ] }
  assert.deepEqual(resolveImageReferences({ definitions: defs, text: 'Lina smiles' }).subjects, [{ characterId: 'lina', outfitId: '' }])
  assert.deepEqual(resolveImageReferences({ definitions: defs, text: '林月（狐形）走向窗边。' }).subjects, [{ characterId: 'fox', outfitId: '' }])
  defs.characters.push({ id: 'other', name: '另一个', match: 'Lina', referenceImage: image() })
  assert.throws(() => resolveImageReferences({ definitions: defs, text: 'Lina smiles' }), code('REFERENCE_ID_AMBIGUOUS'))
})

test('legacy missing names stay textual, but explicit invalid IDs and malformed macros fail', () => {
  const defs = definitions()
  assert.deepEqual(resolveImageReferences({ definitions: defs, text: macro({ name: '陌生人', outfit: 'blue shirt' }) }), { references: [], subjects: [] })
  assert.throws(() => resolveImageReferences({ definitions: defs, text: macro({ characterId: 'unknown', name: 'Alice' }) }), code('REFERENCE_ID_UNKNOWN'))
  assert.throws(() => resolveImageReferences({ definitions: defs, text: macro({ name: 'Alice', outfitId: 'unknown' }) }), code('REFERENCE_ID_UNKNOWN'))
  assert.throws(() => resolveImageReferences({ definitions: defs, text: '${"name":}$' }), code('REFERENCE_MACRO_INVALID'))
})

test('legacy outfits follow exact named costume, then current/default only without contrary clothing facts', () => {
  const defs = definitions()
  const resolveOutfit = text => resolveImageReferences({ definitions: defs, text }).subjects[0]?.outfitId
  assert.equal(resolveOutfit('Alice wears Old Dress'), 'dress')
  assert.equal(resolveOutfit('Alice smiles beside a window'), 'coat')
  delete defs.characters[0].current
  assert.equal(resolveOutfit('Alice smiles beside a window'), 'coat')
  assert.equal(resolveOutfit(macro({ name: 'Alice', outfit: 'unknown red shirt' })), '')
  assert.equal(resolveOutfit(macro({ name: 'Alice', outfit: '' })), '')
  assert.equal(resolveOutfit('Alice wears a bright red shirt'), '')
  assert.equal(resolveOutfit('林月换了衣服，站在窗边。'), '')
  assert.equal(resolveOutfit('Alice holds Old Dress in her hands'), '')
  assert.equal(resolveOutfit('Alice took off Blue Coat'), '')
  assert.equal(resolveOutfit(macro({ name: 'Alice' }) + ' ' + macro({ name: 'Old Dress', upperBody: 'visible' })), 'dress')
})

test('legacy shared costume macro works with and without a known character', () => {
  const defs = definitions()
  const withPerson = resolveImageReferences({ definitions: defs, text: macro({ name: 'Alice' }) + ' ' + macro({ name: 'Moon Robe', upperBody: 'visible' }) })
  assert.equal(withPerson.subjects[0].outfitId, 'shared-robe')
  assert.equal(withPerson.references[1].kind, 'outfit')
  const onlyClothes = resolveImageReferences({ definitions: defs, text: macro({ name: 'Moon Robe', upperBody: 'visible' }) })
  assert.deepEqual(onlyClothes.subjects, [])
  assert.equal(onlyClothes.references.length, 1)
  const namedClothes = resolveImageReferences({ definitions: defs, text: 'Moon Robe, studio lighting, costume detail' })
  assert.deepEqual(namedClothes.subjects, [])
  assert.equal(namedClothes.references[0].outfitId, 'shared-robe')
  const scopedClothes = referenceScopedDefinitions(defs, namedClothes.references, { subjects: namedClothes.subjects })
  assert.deepEqual(scopedClothes.characters, [])
  assert.equal(scopedClothes.outfits.length, 1)
  defs.outfits.push({ id: 'shared-robe', name: 'Other Robe', referenceImage: image() })
  assert.throws(() => resolveImageReferences({ definitions: defs, text: macro({ name: 'Moon Robe' }) }), code('REFERENCE_ID_AMBIGUOUS'))
})

test('text-only shared costumes expose descriptions to planning and map body/back fields into actual compilation', async () => {
  const { compileChannelJob, expandRosterCalls } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const defs = definitions()
  defs.outfits[0].referenceImage = null
  defs.outfits[0].full = ''
  defs.outfits[0].bodyBack = 'silver back clasp'
  defs.outfits[0].fullBack = 'embroidered back hem'
  const original = structuredClone(defs)
  const guidance = referencePlannerGuidance(defs)
  assert.match(guidance, /"shared":true.*"description":.*silver silk robe/)
  assert.match(guidance, /silver back clasp/)
  const result = resolveImageReferences({ definitions: defs, subjects: [{ characterId: 'alice', outfitId: 'shared-robe' }] })
  assert.equal(result.references.length, 1, 'the missing costume image does not prevent use of the person image')
  const scoped = referenceScopedDefinitions(defs, result.references, { subjects: result.subjects })
  assert.equal(scoped.characters[0].outfits[0].upper, 'silver silk robe')
  assert.equal(scoped.characters[0].outfits[0].back, 'silver back clasp\nembroidered back hem')
  assert.equal(scoped.outfits[0].upper, 'silver silk robe', 'standalone shared macros need the same schema bridge')
  const raw = '【人物】\nAlice。\n\n【动作】\n站在窗前。'
  const compiled = compileChannelJob({ params: { tag: raw, rawTag: raw }, config: { imageBackend: 'atlascloud', promptMode: 'structured' }, definitions: scoped, channel: { provider: 'atlascloud' } })
  assert.match(compiled.positive, /silver silk robe/)
  assert.doesNotMatch(compiled.positive, /dark blue wool coat|Old Dress/)
  assert.match(expandRosterCalls(macro({ name: 'Moon Robe' }), scoped, 'default', { style: 'structured' }), /silver silk robe/)
  assert.deepEqual(defs, original)
  defs.outfits[0].referenceImage = image()
  assert.doesNotMatch(referencePlannerGuidance(defs), /silver silk robe|silver back clasp|embroidered back hem/, 'pictured shared clothes use the image and consistency text, not a duplicate fixed-description dump')
})

test('reference text binds each numbered object, explains role boundaries and preserves user supplements', () => {
  const { references } = resolveImageReferences({ definitions: definitions(), subjects: [{ characterId: 'alice', outfitId: 'coat' }] })
  const text = buildReferenceText(references)
  assert.match(text, /参考图1 → 林月.*characterId=alice/)
  assert.match(text, /参考图2 → 林月／Blue Coat.*outfitId=coat/)
  assert.match(text, /不继承其中的衣服、姿势、表情或背景/)
  assert.match(text, /不继承模特身份/)
  assert.match(text, /剧情明确.*优先/)
  assert.match(text, /禁止照搬任何参考场景/)
  assert.match(text, /保留左眼下的小痣/)
  assert.match(text, /保留银色扣子/)
  assert.doesNotMatch(text, /data:image|base64/)
  assert.equal(buildReferenceText([]), '')
  assert.throws(() => buildReferenceText([{ ...references[0], index: 9 }]), code('REFERENCE_LIST_INVALID'))
})

test('integration: scoped identities survive actual macro expansion and name injection in tags/natural modes', async () => {
  const { expandRosterCalls, injectDefinitions } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const defs = definitions()
  const result = resolveImageReferences({ definitions: defs, subjects: [{ characterId: 'alice', outfitId: 'text-only' }, { characterId: 'bob', outfitId: 'uniform' }] })
  const scoped = referenceScopedDefinitions(defs, result.references, { subjects: result.subjects })
  const raw = macro({ name: 'Alice', outfit: 'Training Uniform', angle: 'from front', upperBody: 'sfw' }) + ', ' + macro({ name: 'Bob', outfit: 'Black Uniform', angle: 'from front', upperBody: 'sfw' }) + ', unfamiliar passerby with a purple hat'
  for (const style of ['tags', 'natural']) {
    const expanded = expandRosterCalls(raw, scoped, 'default', { style })
    const final = injectDefinitions(expanded, scoped, {}, { style, raw }).text
    assert.match(final, /characterId=alice/)
    assert.match(final, /plain green jacket/)
    assert.match(final, /short black hair, blue eyes/)
    assert.match(final, /outfitId=uniform/)
    assert.match(final, /unfamiliar passerby with a purple hat/)
    assert.doesNotMatch(final, /long red hair|dark blue wool coat|black boots|UNRELATED APPEARANCE/)
    assert.equal(final.match(/characterId=alice/g)?.length, 1)
  }
})

test('integration: explicit no outfit prevents old current/default injection while free-text unknown person remains intact', async () => {
  const { expandRosterCalls, injectDefinitions } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js')
  const defs = definitions()
  const result = resolveImageReferences({ definitions: defs, subjects: [{ characterId: 'alice', outfitId: '' }] })
  const scoped = referenceScopedDefinitions(defs, result.references, { subjects: result.subjects })
  for (const style of ['tags', 'natural']) {
    const raw = macro({ name: 'Alice', angle: 'from front' }) + ', ' + macro({ name: 'Unknown visitor', outfit: 'purple shirt', angle: 'from side' })
    const expanded = expandRosterCalls(raw, scoped, 'default', { style })
    const final = injectDefinitions(expanded, scoped, {}, { style, raw }).text
    assert.match(final, /characterId=alice/)
    assert.match(final, /Unknown visitor/)
    assert.match(final, /purple shirt/)
    assert.doesNotMatch(final, /Blue Coat|dark blue wool coat|black trousers|Old Dress/)
    const nameOnly = injectDefinitions('Alice looks at the doorway', scoped, {}, { style, raw: 'Alice looks at the doorway' }).text
    assert.match(nameOnly, /characterId=alice/)
    assert.doesNotMatch(nameOnly, /Blue Coat|dark blue wool coat|black trousers|Old Dress/)
  }
})
