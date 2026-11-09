import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('宿主 MVU 不提示或执行旧变量清理，即使旧设置已开启；保留变量恢复', async () => {
  const root = new URL('../tavern-plugin/lib/vendor/magvarupdate/', import.meta.url)
  const dir = await mkdtemp(join(tmpdir(), 'mvu-cleanup-test-'))
  try {
    await cp(new URL('upstream/', root), dir, { recursive: true })
    execFileSync(process.execPath, [fileURLToPath(new URL('host-build/prepare-host-build.mjs', root)), join(dir, 'webpack.config.ts')])
    const chat = Array.from({ length: 40 }, () => ({ swipes: ['正文'], variables: [{ stat_data: { hp: 10 }, schema: {}, initialized_lorebooks: [] }] }))
    const before = JSON.stringify(chat)
    const unexpected = () => assert.fail('清理不应弹窗、写入或提示成功')
    const context = vm.createContext({
      SillyTavern: { chat, callGenericPopup: unexpected, POPUP_TYPE: { CONFIRM: 'confirm' } }, saveChatDebounced: unexpected,
      useDataStore: () => ({ settings: { 自动清理变量: { 启用: true, 要保留变量的最近楼层数: 10, 快照保留间隔: 50 } } }),
      tr: value => value, toastr: { info: unexpected },
    })
    vm.runInContext(await readFile(new URL('../runtime-assets/lodash/lodash.min.js', root), 'utf8'), context)
    for (const file of ['cleanup_variables.ts', 'legacy_chat.ts']) {
      const source = await readFile(join(dir, 'src/function/cleanup', file), 'utf8')
      vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replaceAll('export ', '')), context)
    }
    await vm.runInContext('checkAndCleanupLegacyChat()', context)
    vm.runInContext('cleanupMessageVariables(1, 29, 50)', context)
    assert.equal(JSON.stringify(chat), before)
    const init = await readFile(join(dir, 'src/function/initvar/variable_init.ts'), 'utf8')
    assert.match(init, /if \(is_initvar_applied \|\| authored\) \{\s+const opening_schema[\s\S]*?cleanUpMetadata\(current_data\.stat_data\);/, '开场 <initvar> 要生成变量结构并清理元信息')
    const util = await readFile(join(dir, 'src/util.ts'), 'utf8')
    const lookup = util.slice(util.indexOf('export function getLastValidMessageId'),util.indexOf('export function getLastValidVariable'))
    context.isMvuData = value => Boolean(value?.stat_data && value?.schema)
    vm.runInContext(stripTypeScriptTypes(lookup.replace('export ', '')),context)
    for(const end of [0,1,39,40,41,-1,-100,NaN,3.8]) {
      context.end=end
      assert.equal(vm.runInContext('getLastValidMessageId(end)',context),vm.runInContext('_(SillyTavern.chat).slice(0,end).findLastIndex(row=>isMvuData(row.variables[0]))',context))
    }
    let reads=0
    context.SillyTavern.chat=new Proxy(Array.from({length:20000},()=>chat[0]),{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
    assert.equal(vm.runInContext('getLastValidMessageId(19999)',context),19998)
    assert.equal(reads,1,'prior snapshot lookup must not copy the complete prefix')
    const restore=await readFile(join(dir,'src/function/cleanup/restore_variables.ts'),'utf8')
    const eligibility=restore.slice(restore.indexOf('    const last_message_id'),restore.indexOf('    if (last_10th_message_id >'))
    context.useDataStore=()=>({settings:{自动清理变量:{触发恢复变量的最近楼层数:10}}})
    const probe=stripTypeScriptTypes('(function(){'+eligibility+';return last_not_has_variable_message_id;})()')
    reads=0
    assert.equal(vm.runInContext(probe,context),-1)
    assert.equal(reads,11,'restoration eligibility must stop at the recent threshold')
    context.SillyTavern.chat[19997]={variables:[{}]}
    reads=0
    assert.equal(vm.runInContext(probe,context),19997)
    assert.equal(reads,3,'recent missing snapshots still trigger restoration')
    const cleanup = await readFile(join(dir, 'src/function/cleanup/index.ts'), 'utf8')
    assert.match(cleanup, /debounce\(restoreVariables, 2000\)/)
    const panel = await readFile(join(dir, 'src/panel/Cleanup.vue'), 'utf8')
    assert.match(panel, /暂不支持旧变量清理/)
    assert.doesNotMatch(panel, /v-model/)
    const buttons = await readFile(join(dir, 'src/button.ts'), 'utf8')
    assert.doesNotMatch(buttons, /name: '清除旧楼层变量'/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
