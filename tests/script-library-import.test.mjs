import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('SillyTavern JSONL 导入剧本库后可预览、绑定，原始 JSONL 保留', async t => {
  const home = await mkdtemp(join(tmpdir(), 'tavern-script-jsonl-'))
  const previousHome = process.env.DSH_HOME, previousFetch = globalThis.fetch
  let host
  t.after(async () => {
    await host?.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    globalThis.fetch = previousFetch
    await rm(home, { recursive: true, force: true })
  })
  process.env.DSH_HOME = home
  const { createPluginHost } = await import('./fixtures/plugin-host.mjs')
  host = await createPluginHost({ config: { stage: false } })
  const jsonl = [
    { chat_metadata: { scenario: '元数据' }, user_name: 'unused', character_name: 'unused' },
    { name: '守门人', is_user: false, mes: '站住。\n出示通行证。', swipes: ['未选候选', '站住。\n出示通行证。'], swipe_id: 1 },
    { name: '玩家', is_user: true, mes: '我拿出通行证。' },
    { is_system: true, mes: '隐藏系统消息' },
    { name: '守门人', is_user: false, mes: '', extra: { image: 'image.png' } },
    { is_user: false, mes: '城门缓缓打开。', extra: { type: 'narrator', reasoning: '隐藏思考' } },
    { name: '城主', is_user: false, mes: '欢迎入城。' },
  ].map(row => JSON.stringify(row)).join('\r\n') + '\r\n'
  const name = '城门.JSONL'
  const { source } = await host.rpc('importSource', { payload: { name, text: jsonl } })
  assert.equal(source.path, 'materials/' + name)
  assert.ok(source.chunkCount > 0)
  assert.equal((await host.rpc('getResource', { path: source.path })).text,
    '守门人：站住。\n出示通行证。\n\n玩家：我拿出通行证。\n\n旁白：城门缓缓打开。\n\n城主：欢迎入城。')
  assert.equal(await readFile(join(home, 'profile-data/tavern/data/originals', source.path), 'utf8'), jsonl)

  const { card } = await host.rpc('importCard', { payload: { name: 'guard.json', text: '{"name":"守门人"}' } })
  assert.equal((await host.rpc('bindScript', { cardPath: card.path, path: source.path })).script.path, source.path)
  const { resources } = await host.rpc('listResources')
  assert.deepEqual(resources[0].boundCards, [{ path: card.path, name: '守门人' }])

  const { card: otherCard } = await host.rpc('importCard', { payload: { name: 'lord.json', text: '{"name":"城主"}' } })
  const { script } = await host.rpc('importScript', { cardPath: otherCard.path, payload: {
    name: '早期群聊.jsonl', text: '{"name":"城主","is_user":false,"mes":"门开了。"}\n',
  } })
  assert.equal((await host.rpc('getResource', { path: script.path })).text, '城主：门开了。')

  await assert.rejects(host.rpc('importSource', { payload: { name: '损坏.jsonl', text: jsonl + '{' } }), /第 8 行不是有效 JSON/)
  assert.deepEqual((await host.rpc('listResources')).resources.map(resource => resource.path).sort(),
    [source.path, script.path].sort())

  const competingSources = ['城门打开了。', '城门关上了。'].map(mes => JSON.stringify({ name: '守门人', mes }))
  const results = await Promise.allSettled(competingSources.map(text =>
    host.rpc('importSource', { payload: { name: '同名剧本.jsonl', text } })))
  const winner = results.findIndex(result => result.status === 'fulfilled')
  assert.ok(winner >= 0)
  assert.equal(results[1 - winner].status, 'rejected')
  assert.match(results[1 - winner].reason.message, /文件已存在/)
  const { path } = results[winner].value.source
  assert.equal((await host.rpc('getResource', { path })).text, '守门人：' + JSON.parse(competingSources[winner]).mes)
  assert.equal(await readFile(join(home, 'profile-data/tavern/data/originals', path), 'utf8'), competingSources[winner])
})
