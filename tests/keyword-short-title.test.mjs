import test from 'node:test'
import assert from 'node:assert/strict'
import {keywordHygieneIssue, validatePackKeywords} from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/keyword-hygiene.js'

test('matching the name does not exempt slugs, hashes, file tokens or description-like prose', () => {
  for (const word of ['a/b', 'a-b', '0123456789abcdef', 'portrait.png', 'a,b', 'This is a description', '\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d']) {
    assert.ok(keywordHygieneIssue(word, {name:word}))
    assert.throws(() => validatePackKeywords({manifest:{assets:[{name:word,recall:{mode:'keyword',keywords:[word]}}]}}), /Keyword hygiene/)
  }
  assert.throws(() => validatePackKeywords({manifest:{assets:[{name:'Night sky',recall:{mode:'keyword',keywords:['sky','sky']}}]}}), /duplicate keyword/)
})
