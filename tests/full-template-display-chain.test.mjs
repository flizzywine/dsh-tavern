import assert from 'node:assert/strict'
import test from 'node:test'
import {UpstreamTemplateRuntime} from './fixtures/upstream-template-runtime.mjs'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const runtime=await UpstreamTemplateRuntime.create()
const settings={preload_worldinfo_enabled:false,raw_message_evaluation_enabled:true}
const transcript=state=>state.chat.map(m=>({...m,content:m.mes}))
const display=(state,regexScripts)=>{
 const messages=state.chat.map(m=>({role:m.is_user?'user':'assistant',turn:1,text:m.mes,sourceText:m.mes,swipeId:m.swipe_id,tavernPluginData:m}))
 return projectPersistentStatusView(messages,projectReplyHistory(messages,{regexScripts}).projections,{regexScripts})
}
test('显示正则先于 EJS，独立侧栏保留模板结果且正文不重复面板',async()=>{
 const source='正文\n<StatusPlaceHolderImpl/>'
 const regexScripts=[{enabled:true,placement:[2],markdownOnly:true,findRegex:'/<StatusPlaceHolderImpl\\s*\\/>/g',replaceString:'```html\n<html><body><p>数值=<%= 1+2 %></p><script>const value=<%- 1+2 %>;function loadStatus(){window.mounts=(window.mounts||0)+1;window.value=value}loadStatus()</script></body></html>\n```'}]
 const result=await runtime.lifecycle({settings,charName:'状态组合',regexScripts,transcript:[{role:'assistant',content:source}],worldBookEntries:[{uid:1,enabled:false,constant:true,content:'@@render_before\n显示前缀'}]})
 assert.equal(result.first.chat[0].mes,source)
 const view=display(result.first,regexScripts)
 assert.equal(view.statusViews.length,1)
 assert.match(view.statusView.content,/>3</)
 assert.match(view.statusView.content,/const value=3;/)
 assert.doesNotMatch(view.statusView.content,/<%|&lt;%/)
 assert.match(JSON.stringify(view.projections),/显示前缀/)
 assert.doesNotMatch(JSON.stringify(view.projections),/loadStatus/)
 assert.deepEqual(result.second.chat,result.first.chat)
 assert.equal(await runtime.page.evaluate(()=>window.mounts),undefined)
 await runtime.page.evaluate(content=>{const frame=document.createElement('iframe');frame.id='chain-status';frame.srcdoc=content;document.body.append(frame)},view.statusView.content)
 await runtime.page.waitForFunction(()=>document.querySelector('#chain-status')?.contentWindow.mounts===1)
 assert.equal(await runtime.page.evaluate(()=>document.querySelector('#chain-status').contentWindow.value),3)
 await runtime.page.locator('#chain-status').evaluate(frame=>frame.remove())
})
test('聊天和全局变量变化保留历史展示，不重复永久模板副作用',async()=>{
 const context={settings,charName:'变量刷新',worldBookEntries:[{uid:2,enabled:false,constant:true,content:'@@render_before\n地点=<%= getvar("place") %>，全局=<%= getGlobalVar("weather") %>'}]}
 const a=await runtime.lifecycle({...context,chatVariables:{place:'甲'},globalVariables:{weather:'晴'},transcript:[{role:'assistant',content:'<% setMessageVar("count", (getMessageVar("count") || 0)+1) %>正文'}]})
 const b=await runtime.lifecycle({...context,chatVariables:{place:'乙'},globalVariables:{weather:'雨'},transcript:transcript(a.first)})
 assert.match(b.first.chat[0].template_display.html,/甲/)
 assert.match(b.first.chat[0].template_display.html,/晴/)
 assert.equal(b.first.chat[0].variables[0].count,1)
 assert.deepEqual(b.second.chat,b.first.chat)
})

test('实际 MVU 配方在恢复与修改模板后仍只保留一个状态面板', async () => {
 const statusHtml='<!doctype html><html><head><style>main{padding:8px}</style></head><body><main id="v"></main><script>document.getElementById("v").textContent=Mvu.getMvuData({type:"message",message_id:"latest"}).stat_data.玩家.位置</script></body></html>'
 const regexScripts=[
  {id:'dsh-mvu-status-view',scriptName:'MVU 状态视图',findRegex:'/<mvu-status\\s*\\/>/g',replaceString:'```html\n'+statusHtml+'\n```',placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true},
  {id:'dsh-mvu-hide-marker',scriptName:'隐藏模型历史中的状态入口',findRegex:'/\\n*<mvu-status\\s*\\/>/g',replaceString:'',placement:[2],disabled:false,markdownOnly:false,promptOnly:true,runOnEdit:true}
 ]
 const context={settings,charName:'配方验证',regexScripts}
 const initial=await runtime.lifecycle({...context,transcript:[{role:'assistant',content:'门口。\n<mvu-status/>'}]})
 const a=display(initial.first,regexScripts)
 assert.equal(a.statusViews.length,1)
 assert.doesNotMatch(JSON.stringify(a.projections), /Mvu.getMvuData|mvu-status|<script|<style/)
 const rules=[regexScripts[1],{...regexScripts[0],replaceString:regexScripts[0].replaceString.replace('</body>','<div>新版模板</div></body>')}]
 const restored=await runtime.lifecycle({...context,regexScripts:rules,transcript:[...transcript(initial.first),{role:'user',content:'继续'},{role:'assistant',content:'抵达庭院。'}]})
 const b=display(restored.first,rules)
 assert.equal(b.statusViews.length,1)
 assert.equal(b.statusView.viewId,a.statusView.viewId)
 assert.match(b.statusView.content,/新版模板/)
 assert.doesNotMatch(JSON.stringify(b.projections), /Mvu.getMvuData|mvu-status|新版模板|<script|<style/)
 assert.deepEqual(restored.first.chat[0].template_display,initial.first.chat[0].template_display)
})
