import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function backgroundFailureChecks({page,step,savedChat,output,report}) {
  const control = mode => writeFile(join(output,'background-control.json'),JSON.stringify({mode}))
  async function poll(check) {
    let failure
    for(let i=0;i<200;i++) {
      try { return await check() } catch(error) { failure=error }
      await page.waitForTimeout(100)
    }
    throw failure
  }
  async function send(text) {
    const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息|Message/})
    await composer.fill(text); await composer.press('Enter')
  }
  const gold = chat => chat.messages.at(-1).variables[0].stat_data.gold
  let background
  await step('首次后台模型不可用：正文保留，MVU 标记失败',async()=>{
    await control('fail')
    await send('领取任务奖励')
    await page.locator('.dsh-tavern-mvu-receipt[data-status="error"]').filter({visible:true}).last().locator('summary').click()
    await page.getByRole('button',{name:'重试变量结算',exact:true}).waitFor()
    const chat=await poll(async()=>{
      const chat=await savedChat()
      assert.equal(chat.settleStatus,'failed')
      assert.match(chat.settleError,/E2E background model unavailable/)
      assert.match(chat.messages.at(-1).sourceText ?? chat.messages.at(-1).text,/你获得了十枚金币/)
      assert.equal(gold(chat),0)
      return chat
    })
    background=chat.timeline.participants.background.sessionId
    assert.ok(background)
    await page.screenshot({path:join(output,'first-background-failed.png'),fullPage:true})
  })
  await step('编辑失败轮正文，触发首次后台历史回退',async()=>{
    await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
    await page.getByRole('menuitem',{name:'编辑正文',exact:true}).click()
    const editor=page.getByRole('region',{name:'编辑正文'})
    await editor.getByRole('textbox',{name:'正文文本 1'}).fill('编辑后，你获得了十枚金币。')
    await editor.getByRole('button',{name:'保存',exact:true}).click()
    await editor.waitFor({state:'hidden'})
    await poll(async()=>assert.equal((await savedChat()).timeline.participants.background.status,'needs-rewind'))
  })
  await step('模型恢复后重试 MVU，同一后台会话成功落盘',async()=>{
    await control('pass')
    const receipt=page.locator('.dsh-tavern-mvu-receipt[data-status="error"]').filter({visible:true}).last()
    if (!await receipt.evaluate(node=>node.open)) await receipt.locator('summary').click()
    await page.getByRole('button',{name:'重试变量结算',exact:true}).click()
    await page.getByRole('button',{name:'重新结算',exact:true}).click()
    await poll(async()=>{
      const chat=await savedChat()
      assert.equal(chat.settleStatus,'done')
      assert.equal(gold(chat),10)
      assert.equal(chat.messages.at(-1).mvu.receipt.status,'updated')
      assert.equal(chat.timeline.participants.background.sessionId,background)
    })
    await page.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
    await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({hasText:/^金币：10$/}).waitFor()
    await page.screenshot({path:join(output,'first-background-recovered.png'),fullPage:true})
  })
  await step('恢复后继续两轮，MVU 不连续失败',async()=>{
    for(let i=0;i<2;i++) {
      await send(i === 0 ? '再次领取奖励' : 'E2E 预设验收 50')
      await poll(async()=>{
        const chat=await savedChat()
        assert.equal(chat.messages.filter(m=>m.role==='assistant'&&!m.greeting).length,i+2)
        assert.equal(chat.settleStatus,'done')
        assert.equal(gold(chat),i === 0 ? 20 : 50)
        assert.ok(['updated','unchanged'].includes(chat.messages.at(-1).mvu.receipt.status))
      })
      if (i === 0 && !process.argv.includes('--rapid-followup')) {
        await page.reload({waitUntil:'domcontentloaded'})
        await page.getByRole('button',{name:'重新生成正文',exact:true}).waitFor()
      }
    }
    report.backgroundFailure={recovered:true,backgroundSessionId:background,rounds:3,gold:50}
  })
}
