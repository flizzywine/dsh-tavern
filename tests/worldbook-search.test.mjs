import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldbookSearch } from '../tavern-plugin/lib/domain/worldbook-search.js'
import { projectWorldBookTemplates } from '../tavern-plugin/lib/domain/worldbook-recall.js'

function fixture() {
  const context = { chat: { variables: { rank: '外门' }, worldBookReads: { 'entry:1': { turn: 9 } } }, card: { name: '测试' }, worldBook: { view: { entries: [
    { ref: 'entry:1', title: '门派·少林', primaryKeys: ['少林'], content: '少林入门须遵守门规。<%= rank %>' },
    { ref: 'entry:2', title: '过客经历', content: '过客曾经路过少林。' },
    { ref: 'entry:3', title: '门派·武当', content: '武当入门规矩' },
    { ref: 'entry:4', title: '少林秘密', content: '不应展示', enabled: false },
    { ref: 'entry:5', title: '[mvu_update]少林', content: '不应展示' },
    { ref: 'entry:6', title: '模板', content: '<% secretQuery() %>静态线索' }
  ] } } }
  let renders = 0
  const search = createWorldbookSearch({ load: async () => context, render: async (ctx, selectedEntries) => {
    renders++
    return projectWorldBookTemplates({ ...ctx, selectedEntries, includeConstants: true,
      runtime: { render: async (_body, { scopes }) => ({ ok: true, text: '少林入门：' + scopes.local.rank, scopes: { ...scopes, local: { rank: '已变更' } } }) } })
  } })
  return { context, search, renders: () => renders }
}

test('invalid, disabled, out-of-book refs and oversized/ambiguous requests are rejected', async () => {
  const { search } = fixture()
  for (const args of [{}, { query: '少林', refs: ['entry:1'] }, { refs: [] }, { refs: ['entry:4'] }, { refs: ['entry:5'] }, { refs: ['other:1'] }, { refs: Array(6).fill('entry:1') }, { query: '少林', limit: 100 }, { query: '少林', offset: -1 }]) await assert.rejects(search('s', args))
})

test('explicit search-and-read returns bounded current full text in one call', async () => {
  const f=fixture(), before=structuredClone(f.context)
  const result=await f.search('s',{query:'少林',read:true,limit:1})
  assert.equal(result.mode,'read')
  assert.equal(result.total,2)
  assert.equal(result.hasMore,true)
  assert.equal(result.entries[0].text,'少林入门：外门')
  assert.equal(f.renders(),1)
  const twoStep=fixture()
  const hits=await twoStep.search('s',{query:'少林',limit:1})
  const full=await twoStep.search('s',{refs:hits.entries.map(entry=>entry.ref)})
  assert.deepEqual(result.entries,full.entries,'one tool call must return the same full content as search then read')
  assert.deepEqual(f.context,before)
  f.context.chat.variables.rank='内门'
  assert.equal((await f.search('s',{query:'少林',read:true,limit:1})).entries[0].text,'少林入门：内门')
  assert.equal((await f.search('s',{query:'不存在',read:true})).entries.length,0)
  assert.equal(f.renders(),2,'zero matches must not invoke template rendering')
  await assert.rejects(f.search('s',{query:'少林',read:true,limit:6}))
  await assert.rejects(f.search('s',{query:'少林',read:'true'}))
})
