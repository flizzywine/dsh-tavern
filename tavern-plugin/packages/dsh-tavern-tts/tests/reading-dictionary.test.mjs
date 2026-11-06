// 发音字典 entries with several 写法 for one 读音, and 合并同读音 on the preset store.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReadingForms, normalizeReadingEntries, compileReadingDictionary } from '../src/reading-dictionary.js'
import { createReadingPresetStore } from '../src/reading-presets.js'

test('写法 splits on ASCII and full-width commas and 、, trimming and dropping empty parts', () => {
  assert.deepEqual(parseReadingForms('Alice, アリス，爱丽丝、 艾莉丝 ,,'), ['Alice', 'アリス', '爱丽丝', '艾莉丝'])
  assert.deepEqual(parseReadingForms(['Alice，アリス', 'Alice']), ['Alice', 'アリス'])
  // a single 写法 stays as it was.
  assert.deepEqual(parseReadingForms('星空'), ['星空'])
  assert.throws(() => parseReadingForms(' ，、 '), {code:'INVALID_READINGS'})
})

test('every 写法 of an entry reads the same; the dictionary compiles once and matches in one pass', () => {
  const entries = normalizeReadingEntries([{forms:'Alice，アリス, 爱丽丝、艾莉丝', reading:'ありす'}, {forms:'星空', reading:'ほしぞら', languageOverride:'ja'}])
  assert.deepEqual(entries[0].forms, ['Alice', 'アリス', '爱丽丝', '艾莉丝'])
  const dictionary = compileReadingDictionary(entries)
  assert.equal(dictionary.apply('Alice说：爱丽丝和艾莉丝都是アリス，星空也在。', 'ja'), 'ありす说：ありす和ありす都是ありす，ほしぞら也在。')
  assert.equal(dictionary.apply('爱丽丝', 'zh'), '爱丽丝')
  assert.equal(dictionary.entries.filter(e => e.reading === 'ありす').length, 4)
  // a 写法 already in another entry of the same language is refused, whichever comma joined it.
  assert.throws(() => normalizeReadingEntries([{forms:'A，B', reading:'あ'}, {forms:'C、B', reading:'い'}]), {code:'DUPLICATE_READING_FORM'})
})

test('合并同读音 counts first, then folds same reading and language into one entry under the revision', async () => {
  const store = createReadingPresetStore()
  const {id} = await store.importPreset({document:{version:1, kind:'dsh-tts-readings', name:'大', entries:[
    {forms:'Alice', reading:'ありす'}, {forms:'星空', reading:'ほしぞら'}, {forms:'アリス，爱丽丝', reading:'ありす'},
    {forms:'艾莉丝', reading:'ありす'}, {forms:'Hoshi', reading:'ほしぞら', languageOverride:'en'}]}})
  const count = await store.merge({id, expectedRevision:0, dryRun:true})
  assert.deepEqual(count, {id, revision:0, groups:1, removed:2, count:3})
  assert.equal((await store.get({id})).revision, 0)
  await assert.rejects(store.merge({id, expectedRevision:1}), {code:'REVISION_CONFLICT'})
  const done = await store.merge({id, expectedRevision:0})
  assert.equal(done.revision, 1)
  const after = await store.get({id})
  assert.deepEqual(after.entries.map(e => e.forms), [['Alice', 'アリス', '爱丽丝', '艾莉丝'], ['星空'], ['Hoshi']])
  assert.equal(after.entries[0].reading, 'ありす')
  // nothing left to merge: no write.
  assert.deepEqual(await store.merge({id, expectedRevision:1}), {id, revision:1, groups:0, removed:0, count:3})
  assert.equal((await store.get({id})).revision, 1)
})
