import assert from 'node:assert/strict'
import test from 'node:test'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'

async function connect(host) {
  const initial = await host.adapter.getWorldbook('audit', 'current')
  let run
  run = helperHostHarness(initial, { onCall(message) {
    if (message.type !== 'dsh-tavern-helper-call') return
    Promise.resolve().then(() => host.invoke(message.method, message.args)).then(result => run.reply(message, result), error => run.reply(message, error.message, false))
  } })
  return run.window.TavernHelper
}

for (const embedded of [false, true]) {
  test(`新旧脚本 API → 实际世界书库 → 文件保存 → 刷新回读 (${embedded ? '内嵌' : '独立'})`, async t => {
    const host = await createHelperWorldbookHost(embedded)
    t.after(host.cleanup)
    const api = await connect(host)
    const added = await api.createLorebookEntries('审计书', [{ comment: '新增', content: '新设定', type: 'selective', keys: ['钟楼'], position: 'at_depth_as_user', depth: 0, order: 123, sticky: 2 }])
    assert.equal(added.new_uids.length, 1)
    const uid = added.new_uids[0]
    assert(uid > 7)
    const changed = await api.setLorebookEntries('审计书', [{ uid, comment: '改名', filters: ['午夜'], logic: 'and_all', scan_depth: 3, probability: 75, exclude_recursion: true, prevent_recursion: true, delay_until_recursion: 2, cooldown: 4, delay: 5, case_sensitive: true, match_whole_words: false, group: 'scene' }])
    const row = changed.find(entry => entry.uid === uid)
    assert.equal(row.position, 'at_depth_as_user')
    assert.equal(row.depth, 0)
    assert.equal(row.order, 123)
    assert.equal(row.type, 'selective')
    assert.equal(row.case_sensitive, true)
    assert.equal(row.group, 'scene')
    const reloaded = await connect(host)
    const persisted = (await reloaded.getWorldbook('审计书')).find(entry => entry.uid === uid)
    assert.deepEqual(Array.from(persisted.strategy.keys_secondary.keys), ['午夜'])
    assert.equal(persisted.strategy.keys_secondary.logic, 'and_all')
    assert.equal(persisted.strategy.scan_depth, 3)
    assert.equal(persisted.probability, 75)
    assert.equal(persisted.recursion.delay_until, 2)
    assert.equal(persisted.recursion.prevent_outgoing, true)
    assert.equal(persisted.effect.sticky, 2)
    assert.equal(persisted.effect.cooldown, 4)
    assert.equal(persisted.effect.delay, 5)
    const raw = await host.read(), original = embedded ? raw.entries[0] : raw.entries[7]
    assert.equal(raw.unknownBook, 'keep')
    assert.equal(original.unknownEntry, 'keep')
    assert.equal(original.extensions.vendor, 'keep')
    const deleted = await reloaded.deleteLorebookEntries('审计书', [7])
    assert.equal(deleted.delete_occurred, true)
    assert.equal(deleted.entries.length, 1)
    assert.equal(deleted.entries[0].uid, uid)
    await reloaded.updateWorldbookWith('审计书', entries => { entries[0].extra.pluginState = { table: 'x' }; entries[0].name = ''; return entries })
    const fresh = (await (await connect(host)).getWorldbook('审计书'))[0]
    assert.equal(fresh.name, '')
    assert.equal(fresh.extra.pluginState.table, 'x')
    await reloaded.updateWorldbookWith('审计书', entries => { delete entries[0].extra.pluginState; return entries })
    assert.equal((await (await connect(host)).getWorldbook('审计书'))[0].extra.pluginState, undefined)
    await reloaded.replaceWorldbook('审计书', [])
    assert.equal((await host.adapter.getWorldbook('audit', 'current')).worldbook.entries.length, 0)
  })
}

test('脚本写世界书只传改动条目，版本没变不重传整本，别处改过则拒绝', async t => {
  const host = await createHelperWorldbookHost(false)
  t.after(host.cleanup)
  const initial = await host.adapter.getWorldbook('audit', 'current')
  const calls = []
  const run = helperHostHarness(initial, { onCall(message) {
    if (message.type !== 'dsh-tavern-helper-call') return
    calls.push({ method: message.method, args: structuredClone(message.args) })
    Promise.resolve().then(() => host.invoke(message.method, message.args)).then(result => run.reply(message, result), error => run.reply(message, error.message, false))
  } })
  const api = run.window.TavernHelper
  const before = await api.getWorldbook('审计书')
  const written = await api.updateWorldbookWith('审计书', entries => entries.concat([{ name: '工坊', content: '新条目' }]))
  const patch = calls.find(call => call.method === 'patchTavernHelperWorldbook').args.patch
  assert.equal(patch.upserts.length, 1)
  assert.deepEqual(patch.deletes, [])
  assert.equal(calls.some(call => call.method === 'replaceTavernHelperWorldbook'), false)
  assert.equal(written.length, before.length + 1)
  assert.equal(written.at(-1).name, '工坊')
  assert.deepEqual(written.slice(0, -1), before)

  calls.length = 0
  const deleted = await api.deleteWorldbookEntries('审计书', entry => entry.name === '工坊')
  assert.equal(deleted.deleted_entries.length, 1)
  const read = calls.find(call => call.method === 'getTavernHelperWorldbook')
  assert.equal(typeof read.args.knownVersion, 'string')
  assert.deepEqual(calls.find(call => call.method === 'patchTavernHelperWorldbook').args.patch.upserts, [])
  assert.deepEqual(deleted.worldbook, before)

  const stale = (await host.adapter.getWorldbook('audit', 'current')).worldbook
  await host.adapter.replaceWorldbook('audit', 'current', stale.entries.concat([{ name: '别处' }]), stale.entries)
  await assert.rejects(host.adapter.patchWorldbook('audit', 'current', { version: stale.version, upserts: [{ name: '迟到' }], deletes: [] }), /已被其他操作修改/)
  assert.equal((await api.getWorldbook('审计书')).at(-1).name, '别处')
})

for (const embedded of [false, true]) test(`脚本增删改 → 静态文件 → 失效通知，保留其他快照 (${embedded})`, async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, basename, dirname } = await import('node:path')
  const { createWorldbookFiles } = await import('../tavern-plugin/lib/domain/worldbook-files.js')
  const { appendWorldbookSkillChanges } = await import('../tavern-plugin/lib/domain/worldbook-skill-changes.js')
  const host = await createHelperWorldbookHost(embedded)
  t.after(host.cleanup)
  const directory = await mkdtemp(join(tmpdir(), 'script-skill-sync-')); t.after(()=>rm(directory,{recursive:true,force:true}))
  const api = await connect(host)
  await api.updateWorldbookWith('审计书', rows => {
    rows[0].name='城市·旧城'; rows[0].content='旧城旧正文'
    return rows.concat([{name:'城市·旧港',content:'旧港正文'}, {name:'医术·规则',content:'医术正文'}, {name:'银行·存款',content:'银行正文'}])
  })
  const chat={sessionId:'audit',cardPath:'card.json',worldbookStrategy:'native-skills'}
  const session={id:'audit',events:[],append(type,data){const event={seq:this.events.length,type,data};this.events.push(event);return event}}
  const scope={session}, lookup={scope}, payload={agent:scope}
  const oldBook=structuredClone(await host.record())
  const oldScope={session:{id:'old'}}
  const create=()=>createWorldbookFiles({directory,load:async agent=>({chat:{...chat,sessionId:agent.session.id},worldBook:agent===oldScope?oldBook:await host.record()})})
  let provider=create();t.after(()=>provider.dispose())
  await provider.refresh(scope)
  appendWorldbookSkillChanges(payload,provider.changeSnapshot(scope))
  const first=await provider.inspect(lookup)
  const bank=first.files.find(e=>e.title==='银行·存款')
  const oldEntry=first.files.find(e=>e.title==='城市·旧城')
  assert.match(await provider.readResource(oldEntry.path,{scope:oldScope}),/旧城旧正文/)
  // Multiple script writes are observed as one effective batch before a model step.
  await api.updateWorldbookWith('审计书', rows=>rows.filter(e=>e.name!=='城市·旧港').map(e=>({...e,content:e.name==='城市·旧城'?'旧城改写后的正文':e.name==='医术·规则'?'<%= getvar("hp") %>':e.content})))
  await api.createWorldbookEntries('审计书',[{name:'城市·新港',content:'新港正文'}])
  await provider.refresh(scope)
  const notice=appendWorldbookSkillChanges(payload,provider.changeSnapshot(scope))
  assert.match(notice.content[0].text,/新增（1 条）/)
  assert.match(notice.content[0].text,/改写（1 条）/)
  assert.match(notice.content[0].text,/撤回资料（2 条）/)
  const second=await provider.inspect(lookup)
  assert.deepEqual(second.files.map(e=>e.title).sort(),['城市·旧城','城市·新港','银行·存款'].sort())
  const newBank=second.files.find(e=>e.title==='银行·存款')
  assert.equal(basename(newBank.path),basename(bank.path))
  assert.equal(await provider.readResource(oldEntry.path,lookup),undefined)
  assert.match(await provider.readResource(oldEntry.path,{scope:oldScope}),/旧城旧正文/)
  await provider.refresh(scope)
  assert.equal(appendWorldbookSkillChanges(payload,provider.changeSnapshot(scope)),null)
  // Cold provider recovers the last published layout from persisted native history.
  provider.dispose(); provider=create()
  await api.updateWorldbookWith('审计书',rows=>rows.map(e=>e.name==='城市·旧城'?{...e,content:'再次修改正文'}:e))
  await provider.refresh(scope)
  const cold=await provider.inspect(lookup)
  assert.equal(basename(cold.files.find(e=>e.title==='银行·存款').path),basename(bank.path))
  assert.match(appendWorldbookSkillChanges(payload,provider.changeSnapshot(scope)).content[0].text,/改写（1 条）/)
})

test('游玩中的局用自己那份人物卡：脚本连续写内嵌世界书，读写同一本，本局随即用上自己的改动', async t => {
  const { cardContentDigest } = await import('../tavern-plugin/lib/domain/play-card-snapshots.js')
  const host = await createHelperWorldbookHost(true)
  t.after(host.cleanup)
  host.chat.cardDefinitionSnapshot = await host.readCard()
  host.chat.cardContentDigest = cardContentDigest(host.chat.cardDefinitionSnapshot)
  const api = await connect(host)
  await api.createWorldbookEntries('审计书', [{ name: '工坊一', content: '甲' }])
  await api.createWorldbookEntries('审计书', [{ name: '工坊二', content: '乙' }])
  assert.deepEqual((await api.getWorldbook('审计书')).map(entry => entry.name), ['原条目', '工坊一', '工坊二'])
  assert.deepEqual((await host.read()).entries.map(entry => entry.comment), ['原条目', '工坊一', '工坊二'])
  assert.deepEqual(host.chat.cardDefinitionSnapshot.character_book, (await host.readCard()).character_book)
  assert.equal(host.chat.cardContentDigest, cardContentDigest(host.chat.cardDefinitionSnapshot))
  // The library card changed elsewhere while this game still plays its older copy.
  const card = await host.readCard()
  card.character_book.entries.push({ id: 99, comment: '别处', content: '', keys: [], enabled: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(host.cardFile, JSON.stringify(card))
  const stale = (await host.adapter.getWorldbook('audit', 'current')).worldbook
  await assert.rejects(host.adapter.patchWorldbook('audit', 'current', { version: stale.version, upserts: [{ name: '迟到' }], deletes: [] }), /本局还在用旧版/)
})
