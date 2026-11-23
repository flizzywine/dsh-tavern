import test from 'node:test'
import assert from 'node:assert/strict'
import { composeTavernRegexScripts } from '../tavern-plugin/lib/domain/card-extension-reading.js'

const rule = (name, findRegex, replaceString) => ({ name, findRegex, replaceString, enabled: true, placement: [2], markdownOnly: true })

test('legacy card-only extensions preserve internal order and allow absent groups', () => {
  const a = rule('a', 'a', 'b'), b = rule('b', 'b', 'c'), p = rule('p', 'p', 'a')
  assert.deepEqual(composeTavernRegexScripts({ regexScripts: [a,b] }, [p]), [p,a,b])
  assert.deepEqual(composeTavernRegexScripts(null, [p]), [p])
})
