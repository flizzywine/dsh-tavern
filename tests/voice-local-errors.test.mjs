import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
test('missing local voice files and programs have actionable Chinese messages', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js',import.meta.url),'utf8')
  const context = {playerErrorText:({code},{codes})=>codes[code]}
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('const voiceFailure='),source.indexOf('// What the')),context)
  for (const code of ['ENOENT','ENOTDIR']) {
    const text = context.voiceErrorText({code})
    assert.match(text,/本地.*请检查/)
    assert.doesNotMatch(text,/ENOENT|ENOTDIR/)
  }
})
