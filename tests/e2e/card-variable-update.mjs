import assert from 'node:assert/strict'
import {isDeepStrictEqual} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// Deliberately independent of EJS and explicit stateMigrations.
export async function cardVariableUpdateChecks({page,step,savedChat,data,output,report}) {
  const path=join(data,'resources/cards/e2e.json')
  const document=JSON.parse(await readFile(path,'utf8')), card=document.raw?.data || document.data || document.raw
  const initial=await savedChat()
  const current=chat=>chat.messages.at(-1).variables[chat.messages.at(-1).swipeId || 0].stat_data
  const status=()=>page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])')
  const prose=chat=>chat.messages.map(m=>[m.role,m.sourceText ?? m.text])
  async function waitState(expected) {
    const deadline=Date.now()+30000
    while(Date.now()<deadline) {
      if(isDeepStrictEqual(current(await savedChat()),expected)) return
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    assert.deepEqual(current(await savedChat()),expected)
  }
  async function apply(defaults) {
    card.character_book.entries[0].content=JSON.stringify(defaults)
    await writeFile(path,JSON.stringify(document))
    await page.reload({waitUntil:'domcontentloaded'})
    await page.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
    await page.getByRole('button',{name:'重新加载人物卡和世界书',exact:true}).click()
    await page.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click()
  }
  async function panel(value) {await status().locator('#variable-state').filter({hasText:new RegExp('^'+value+'$')}).waitFor()}
  await step('变量专项：新增字段补初值，已有金币不重置',async()=>{
    assert.deepEqual(current(initial),{gold:10})
    await apply({gold:999,stamina:7,rank:3})
    await waitState({gold:10,stamina:7,rank:3})
    assert.deepEqual(prose(await savedChat()),prose(initial))
  })
  await step('变量专项：删除字段自动同步历史，新增与保留字段同时对齐',async()=>{
    card.extensions.regex_scripts[0].replaceString='```html\n<div id="variable-state"></div><script>function refresh(){const s=getAllVariables().stat_data;document.getElementById("variable-state").textContent=[s.gold,s.rank,s.coins,String(s.stamina)].join("|")}refresh();setInterval(refresh,200)</script>\n```'
    card.character_book.entries.push({id:2,keys:[],comment:'新世界规则',content:'E2E_LIVE_WORLDBOOK_V2',enabled:true,constant:true,insertion_order:2})
    card.character_book.entries.push({id:3,keys:[],comment:'[mvu_update]新变量规则',content:'E2E_LIVE_MVU_RULES_V2',enabled:true,constant:true,insertion_order:3})
    await apply({gold:999,rank:999,coins:5})
    await waitState({gold:10,rank:3,coins:5})
    await panel('10\\|3\\|5\\|undefined')
    const chat=await savedChat()
    assert.deepEqual(chat.messages[0].variables[0].stat_data,{gold:0,rank:3,coins:5})
    function check(value) {
      if(!value || typeof value!=='object')return
      if(value.stat_data && value.schema) {
        assert.equal(Object.hasOwn(value.stat_data,'stamina'),false)
        assert.equal(value.schema.properties.stamina,undefined)
        assert.equal(value.schema.properties.coins.type,'number')
      } else Object.values(value).forEach(check)
    }
    check(chat)
    assert.deepEqual(prose(chat),prose(initial))
    await page.reload(); await panel('10\\|3\\|5\\|undefined')
  })
  await step('变量专项：更新后真实后台结算写入新字段',async()=>{
    const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息|Message/})
    await composer.fill('E2E 更新后继续');await composer.press('Enter')
    await waitState({gold:10,rank:3,coins:20});await panel('10\\|3\\|20\\|undefined')
    const requests=(await readFile(join(output,'preset-requests.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(row=>row.cardUpdate)
    assert.ok(requests.some(row=>row.newWorldbook && !row.settlement))
    assert.ok(requests.some(row=>row.newWorldbook && row.settlement))
  })
  await step('变量专项：回退、刷新、撤销回退、再次游玩均保持新结构',async()=>{
    async function action(name) {
      await page.getByRole('button',{name:'更多 ▾',exact:true}).click()
      await page.getByRole('menuitem',{name}).click()
    }
    await action(/回退第.*轮|回退本轮/)
    await waitState({gold:10,rank:3,coins:5})
    await page.reload();await panel('10\\|3\\|5\\|undefined')
    await action(/撤销回退（恢复第/)
    await waitState({gold:10,rank:3,coins:20})
    await action(/回退第.*轮|回退本轮/)
    await waitState({gold:10,rank:3,coins:5})
    const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息|Message/})
    await composer.fill('E2E 更新后继续');await composer.press('Enter')
    await waitState({gold:10,rank:3,coins:20});await panel('10\\|3\\|20\\|undefined')
    assert.equal((await savedChat()).sessionId,initial.sessionId)
    await page.reload();await panel('10\\|3\\|20\\|undefined')
    await page.screenshot({path:join(output,'card-variable-update.png')})
  })
  report.cardVariableUpdate={add:true,remove:true,preserveValues:true,history:true,settlement:true,rollback:true,undo:true,reload:true,continue:true}
}
