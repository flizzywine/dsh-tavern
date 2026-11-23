import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export async function cardUpdateChecks({page,step,savedChat,data,output,report}) {
  const path = join(data,'resources/cards/e2e.json')
  const document = JSON.parse(await readFile(path,'utf8')), card = document.raw?.data || document.data || document.raw
  const initial = await savedChat()
  const prose = chat => chat.messages.map(message => [message.role,message.sourceText ?? message.text])
  const current = chat => chat.messages.at(-1).variables[chat.messages.at(-1).swipeId || 0].stat_data
  const status = () => page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])')
  async function noRawTemplate() {
    for (const frame of page.frames()) {
      const text = await frame.locator('body').innerText().catch(() => '')
      assert.ok(!text.includes('<%'), '正文和状态栏均不能露出原始 EJS 模板')
    }
  }
  async function save() {
    await writeFile(path,JSON.stringify(document)); await page.reload({waitUntil:'domcontentloaded'})
    await page.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
    await page.getByRole('button',{name:'重新加载人物卡和世界书',exact:true}).waitFor()
  }
  async function apply() {
    await page.getByRole('button',{name:'重新加载人物卡和世界书',exact:true}).click()
    await page.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click()
  }
  async function applied() {
    await page.getByRole('button',{name:'正在重新加载人物卡和世界书…',exact:true}).waitFor({state:'hidden'})
    await page.getByRole('button',{name:'重新加载人物卡和世界书',exact:true}).waitFor({state:'visible'})
    assert.equal((await savedChat()).sessionId,initial.sessionId)
    assert.deepEqual((await savedChat()).cardDefinitionSnapshot.extensions,card.extensions,'应用回执必须对应本次卡片版本')
  }
  await step('修改状态栏和世界书、增加变量：应用后保留原进度',async()=>{
    card.extensions.regex_scripts[0].replaceString = '```html\n<div id="update-title">新版状态栏</div><div id="e2e-gold"></div><script>function refresh(){document.getElementById("e2e-gold").textContent="金币："+getAllVariables().stat_data.gold}refresh();setInterval(refresh,200)</script>\n```'
    card.character_book.entries[0].content='gold: 999\nstamina: 7\nrank: "3"'
    card.character_book.entries.push({id:2,keys:[],comment:'新世界规则',content:'E2E_LIVE_WORLDBOOK_V2',enabled:true,constant:true,insertion_order:2})
    card.character_book.entries.push({id:3,keys:[],comment:'[mvu_update]新变量规则',content:'E2E_LIVE_MVU_RULES_V2',enabled:true,constant:true,insertion_order:3})
    await save()
    await status().locator('#e2e-gold').filter({hasText:/^金币：10$/}).waitFor()
    assert.equal(await status().locator('#update-title').count(),0,'应用前必须仍使用本局已应用的状态栏')
    await apply(); await applied()
    await status().locator('#update-title').filter({hasText:'新版状态栏'}).waitFor()
    const changed=await savedChat()
    assert.deepEqual(prose(changed),prose(initial)); assert.deepEqual(current(changed),{gold:10,stamina:7,rank:'3'})
    assert.ok(changed.cardContextSnapshot.includes('E2E_LIVE_WORLDBOOK_V2'))
    await page.reload(); await status().locator('#update-title').waitFor()
    await page.screenshot({path:join(output,'card-update-static.png')})
  })
  await step('EJS 状态栏原地更新：预览、刷新不写入模板副作用',async()=>{
    const beforeVariables=(await savedChat()).messages.map(message=>message.variables)
    card.extensions.regex_scripts[0].replaceString='```html\n<% setLocalVar("updateSideEffect",(getLocalVar("updateSideEffect") || 0)+1) %><div id="ejs-current">EJS 金币：<%= getMessageVar("stat_data.gold") %></div>\n```'
    await save(); await apply(); await applied()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    assert.equal((await savedChat()).variables?.updateSideEffect,undefined)
    assert.deepEqual((await savedChat()).messages.map(message=>message.variables),beforeVariables,'只改展示不能重写历史变量快照')
    await page.reload(); await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    assert.equal((await savedChat()).variables?.updateSideEffect,undefined)
    await noRawTemplate()
    await page.screenshot({path:join(output,'card-update-ejs.png')})
  })
  await step('无效 EJS 更新失败：旧模板和存档仍可使用',async()=>{
    const before=await savedChat(), good=card.extensions.regex_scripts[0].replaceString
    card.extensions.regex_scripts[0].replaceString='```html\n<% throw Error("E2E_UPDATE_REJECTED") %>\n```'
    await save(); await apply()
    await page.getByRole('alert').filter({hasText:'E2E_UPDATE_REJECTED'}).first().waitFor()
    const after=await savedChat()
    assert.equal(after.cardContextRevision,before.cardContextRevision)
    assert.deepEqual(current(after),current(before)); assert.deepEqual(prose(after),prose(before))
    await page.reload(); await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    card.extensions.regex_scripts[0].replaceString='```html\n<% await fetch("https://example.invalid/card-update-test",{method:"POST"}) %>\n```'
    await save(); await apply()
    await page.getByRole('alert').filter({hasText:'预览不允许网络请求'}).first().waitFor()
    assert.equal((await savedChat()).cardContextRevision,before.cardContextRevision)
    card.extensions.regex_scripts[0].replaceString=good
  })
  await step('变量类型变化未声明迁移时拒绝，保留原值',async()=>{
    card.character_book.entries[0].content='gold: 999\nstamina: 7\nrank: 0'
    await save(); await apply()
    await page.getByRole('alert').filter({hasText:'变量类型已变化'}).first().waitFor()
    assert.equal(current(await savedChat()).rank,'3')
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
  })
  await step('变量改名与类型转换按声明迁移，删除字段自动同步存档',async()=>{
    card.character_book.entries[0].content='coins: 999\nstamina: 7\nrank: 0'
    await save(); await apply()
    await page.getByRole('alert').filter({hasText:'变量类型已变化'}).first().waitFor()
    assert.equal(current(await savedChat()).gold,10,'类型校验失败时整次更新不落盘')
    card.extensions.dsh_tavern={stateMigrations:[{id:'e2e-wallet-v2',operations:[{op:'move',from:'/gold',path:'/coins'},{op:'convert',path:'/rank',type:'number'}]}]}
    // Deleting an authored field automatically removes it from current and historical saves.
    card.character_book.entries[0].content='coins: 999\nrank: 0'
    card.extensions.regex_scripts[0].replaceString='```html\n<div id="ejs-current">EJS 金币：<%= getMessageVar("stat_data.coins") %></div>\n```'
    await save(); await apply(); await applied()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    const changed=await savedChat()
    assert.deepEqual(current(changed),{coins:10,rank:3})
    assert.equal(changed.messages[0].variables[0].stat_data.coins,0,'历史开场保留当时的数值')
    assert.deepEqual(prose(changed),prose(initial))
    await page.reload(); await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
  })
  await step('同一迁移再次应用不重复执行，旧数值不重置',async()=>{
    const before=(await savedChat()).messages.map(message=>message.variables)
    card.extensions.regex_scripts[0].replaceString += '\n<!-- style revision -->'
    await save(); await apply(); await applied()
    assert.deepEqual((await savedChat()).messages.map(message=>message.variables),before)
  })
  await step('更新后继续下一轮，模型读取新版世界书和变量，回退后仍能显示',async()=>{
    const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息|Message/})
    await composer.fill('E2E 更新后继续'); await composer.press('Enter')
    await page.getByText('更新后的世界中，你又获得十枚金币。',{exact:true}).filter({visible:true}).first().waitFor()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：20$/}).waitFor()
    assert.equal(current(await savedChat()).coins,20)
    const requests=(await readFile(join(output,'preset-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.cardUpdate)
    assert.ok(requests.some(row=>row.newWorldbook && !row.settlement),'正文必须实际收到新世界书')
    assert.ok(requests.some(row=>row.newWorldbook && row.settlement),'后台必须实际收到新世界书')
    await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
    await page.getByRole('menuitem',{name:/回退第.*轮|回退本轮/}).click()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    await page.reload(); await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    assert.deepEqual(current(await savedChat()),{coins:10,rank:3})
    await page.screenshot({path:join(output,'card-update-rollback.png')})
    await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
    await page.getByRole('menuitem',{name:/撤销回退（恢复第/}).click()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：20$/}).waitFor()
    assert.equal(current(await savedChat()).coins,20)
    await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
    await page.getByRole('menuitem',{name:/回退第.*轮|回退本轮/}).click()
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：10$/}).waitFor()
    await composer.fill('E2E 更新后继续'); await composer.press('Enter')
    await status().locator('#ejs-current').filter({hasText:/^EJS 金币：20$/}).waitFor()
    assert.equal(current(await savedChat()).coins,20)
    assert.equal((await savedChat()).sessionId,initial.sessionId)
    await noRawTemplate()
    await page.screenshot({path:join(output,'card-update-continued.png')})
  })
  report.cardUpdate={static:true,ejs:true,isolatedSideEffects:true,failedUpdatePreserved:true,structureMigration:true,worldbookRequest:true,continue:true,rollback:true}
}
