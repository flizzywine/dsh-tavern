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
