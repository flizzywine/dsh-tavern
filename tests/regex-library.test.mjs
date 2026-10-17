import assert from 'node:assert/strict'
import test from 'node:test'
import { createRegexLibrary, regexScriptsFromImport } from '../tavern-plugin/lib/domain/regex-library.js'

test('imports SillyTavern regex exports as inert library items, keeping raw fields', async () => {
  let value
  const store = { readJson: async () => structuredClone(value), updateJson: async (_, fn) => { value = await fn(structuredClone(value)); return structuredClone(value) } }
  const library = createRegexLibrary({ store })
  const single = { id: 'a', scriptName: '折叠思考', findRegex: '/<think>[\\s\\S]*?<\\/think>/g', replaceString: '', placement: [2], markdownOnly: true, extra: 1 }
  const [item] = await library.importFile(JSON.stringify(single), '文件名')
  assert.equal(item.name, '折叠思考')
  assert.deepEqual(item.script, single)
  const many = await library.importFile(JSON.stringify({ regex_scripts: [{ findRegex: 'x' }, { findRegex: 'y', scriptName: 'Y' }] }), '一组')
  assert.deepEqual(many.map(item => item.name), ['一组', 'Y'])
  assert.equal((await library.list()).length, 3)
  await assert.rejects(library.remove({ id: item.id, expected: { ...item, name: '旧' } }), /已被修改/)
  await library.remove({ id: item.id, expected: item })
  assert.deepEqual((await library.list()).map(entry => entry.name), ['一组', 'Y'])
})

test('rejects files that are not regex exports', () => {
  assert.throws(() => regexScriptsFromImport('{', 'a'), /不是有效的 JSON/)
  assert.throws(() => regexScriptsFromImport('{"name":"卡"}', 'b'), /缺少 findRegex/)
  assert.throws(() => regexScriptsFromImport('[]', 'c'), /没有正则/)
})
