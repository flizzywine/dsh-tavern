import assert from 'node:assert/strict'
import { join } from 'node:path'

// Real iframe Helper API -> Remote -> adapter -> journal -> live view. Only the
// model is fixed by gameplay.mjs; no variable RPC or receipt is mocked here.
export async function incrementalMvuChecks({page,step,savedChat,output,report,restartServer}) {
  const initial = await savedChat()
  const prose = chat => chat.messages.map(m => [m.role, m.sourceText ?? m.text])
  const status = target => target.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame').locator('#e2e-gold')
  const gold = (target, value) => status(target).filter({hasText:new RegExp(`^金币：${value}$`)}).waitFor()
  const helper = async (target, action, arg) => {
    const handle = await target.locator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame').elementHandle()
    const frame = await handle.contentFrame()
    return frame.evaluate(action, arg)
  }
  const writeGold = (target, messageId, value) => helper(target, async ({messageId,value}) => {
    await updateVariablesWith(v => { v.stat_data.gold = value; return v }, {type:'message',message_id:messageId})
    return getVariables({type:'message',message_id:messageId}).stat_data.gold
  }, {messageId,value})
  let viewer
  const stale = []
  const variableIssues = []
  async function checkScopes(name) {
    const saved = await savedChat()
    const actual = await helper(page, () => [getVariables({type:'chat'}).e2eCompactChat,getVariables({type:'script',script_id:'e2e-compact'}).e2eCompactScript])
    const evidence = {name,helper:actual,diskChat:saved.variables?.e2eCompactChat,diskScript:saved.tavernHelperScriptVariables?.['e2e-compact']?.e2eCompactScript}
    ;(report.variableScopes ||= []).push(evidence)
    if(actual[0]!==17 || actual[1]!==23 || evidence.diskChat!==17 || evidence.diskScript!==23) variableIssues.push(evidence)
  }
  async function checkViewer(value, name) {
    try { await status(viewer).filter({hasText:new RegExp(`^金币：${value}$`)}).waitFor({timeout:10000}) }
    catch {
      const saved = await savedChat()
      const evidence = {name,expected:value,disk:saved.messages.at(-1).variables[0].stat_data.gold,
        primary:await status(page).innerText(),secondary:await status(viewer).innerText(),
        helper:await helper(viewer,()=>getVariables({type:'message',message_id:-1}).stat_data.gold)}
      await viewer.screenshot({path:join(output,`${name}-stale.png`),fullPage:true})
      await viewer.reload({waitUntil:'domcontentloaded'})
      await gold(viewer,value)
      evidence.afterReload = await status(viewer).innerText()
      stale.push(evidence)
      report.staleViewers = stale
    }
  }
  try {
    await step('增量写入：历史楼与末楼分别修改，chat/script 变量独立落盘', async () => {
      assert.equal(await writeGold(page, 0, 3), 3)
      assert.equal(await writeGold(page, -1, 11), 11)
      await helper(page, async () => {
        await insertOrAssignVariables({e2eCompactChat:17},{type:'chat'})
        await insertOrAssignVariables({e2eCompactScript:23},{type:'script',script_id:'e2e-compact'})
      })
      await gold(page,11)
      const saved = await savedChat()
      assert.equal(saved.messages[0].variables[0].stat_data.gold,3)
      assert.equal(saved.messages.at(-1).variables[0].stat_data.gold,11)
      assert.equal(saved.variables.e2eCompactChat,17)
      assert.equal(saved.tavernHelperScriptVariables['e2e-compact'].e2eCompactScript,23)
      assert.deepEqual(prose(saved),prose(initial))
      assert.deepEqual(saved.messages.at(-1).mvu,initial.messages.at(-1).mvu)
      await checkScopes('after-write')
    })
    await step('增量同步：第二页面冷加载，再接收未刷新变量更新', async () => {
      viewer = await page.context().newPage()
      await viewer.goto(page.url(),{waitUntil:'domcontentloaded'})
      await viewer.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
      await gold(viewer,11)
      assert.equal(await writeGold(page,-1,12),12)
      await gold(page,12)
      await checkViewer(12,'helper-write')
      assert.equal(await helper(viewer, () => getVariables({type:'message',message_id:0}).stat_data.gold),3)
      await viewer.screenshot({path:join(output,'incremental-secondary-viewer.png'),fullPage:true})
      await checkScopes('before-resettlement')
      const receipt=page.locator('.dsh-tavern-mvu-receipt[data-status="updated"]').filter({visible:true}).last()
      await receipt.locator('summary').click()
      await receipt.getByRole('button',{name:'重新结算变量',exact:true}).click()
      await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('E2E 修正金币为四十')
      await page.getByRole('button',{name:'重新结算',exact:true}).click()
      await gold(page,40)
      await checkViewer(40,'mvu-settlement')
      report.secondarySettlement = {gold:40,live:!stale.some(item=>item.name==='mvu-settlement')}
      await checkScopes('after-resettlement')
      await viewer.close(); viewer = null
    })
    await step('增量恢复：服务重启后保留局部写入，并可继续写入', async () => {
      await restartServer()
      await gold(page,40)
      await checkScopes('after-restart')
      assert.equal(await writeGold(page,-1,13),13)
      await gold(page,13)
      await page.reload({waitUntil:'domcontentloaded'})
      await gold(page,13)
      const saved = await savedChat()
      assert.equal(saved.messages[0].variables[0].stat_data.gold,3)
      assert.equal(saved.messages.at(-1).variables[0].stat_data.gold,13)
      assert.deepEqual(prose(saved),prose(initial))
      assert.equal(saved.messages.at(-1).mvu.receipt.status,'updated')
      await page.screenshot({path:join(output,'incremental-restarted.png'),fullPage:true})
    })
    report.incrementalMvu = {historyGold:3,currentGold:13,secondaryViewer:stale.length===0,restart:true,prosePreserved:true}
    report.variableIssues = variableIssues
    assert.deepEqual({variableIssues,stale},{variableIssues:[],stale:[]},'变量作用域读取与第二页面实时同步必须一致')
  } finally { await viewer?.close() }
}
