import { eventSource } from './host.js'

/** Expose the upstream settings and editor inside their existing runtime. */
export function createTemplatePanel({ rpc, plugin, close }) {
  const style = document.createElement('style')
  style.textContent = `:root{color-scheme:dark;--SmartThemeQuoteColor:#ce935e}body{margin:0;padding:20px;background:#202020;color:#eee;font:15px system-ui}button,select,input,textarea{font:inherit;color:inherit;background:#303030;border:1px solid #666;border-radius:5px;padding:6px}button{cursor:pointer}label{display:block;margin:9px 0}.flex-container{display:flex;gap:8px;flex-wrap:wrap}.flex1{flex:1}.inline-drawer-content{display:block!important}.inline-drawer-toggle{cursor:pointer}textarea{width:100%;box-sizing:border-box;min-height:160px}header{display:flex;justify-content:space-between;position:sticky;top:0;background:#202020;z-index:1}section{margin-top:24px}#world_popup_entries_list{margin-top:12px}.template-popup{width:94vw;height:90vh;box-sizing:border-box;background:#202020;color:#eee;border:1px solid #777}.template-popup>div{height:calc(100% - 45px)!important}.template-popup footer{display:flex;gap:12px;margin-top:8px}.template-popup::backdrop{background:#0009}#template-feedback{white-space:pre-wrap}a{color:#dca56b}`
  document.head.append(style)
  const header = document.createElement('header'), title = document.createElement('h2'), exit = document.createElement('button')
  title.textContent = '提示词模板'; exit.textContent = '关闭'; exit.onclick = close
  header.append(title, exit); document.body.prepend(header)
  const section = document.createElement('section')
  section.innerHTML = '<h3>世界书模板编辑</h3><p>启用上方代码编辑器后，可使用 Monaco 编辑。保存会修改当前世界书。</p><select aria-label="世界书条目"></select><div id="world_popup_entries_list"></div><button id="save-template-entry">保存条目</button><h3>模板命令</h3><textarea id="template-command" aria-label="模板命令" placeholder="/ejs &lt;%= 1 + 1 %&gt;"></textarea><button id="run-template-command">执行</button><pre id="template-feedback" role="status"></pre>'
  document.body.append(section)
  const feedback = section.querySelector('#template-feedback'), select = section.querySelector('select'), list = section.querySelector('#world_popup_entries_list')
  let worldbook
  const show = async action => { try { await action() } catch (error) { feedback.textContent = String(error.message || error) } }
  async function renderEntry() {
    const entry = worldbook?.entries[Number(select.value)]
    list.replaceChildren(); if (!entry) return
    const row = document.createElement('div')
    row.innerHTML = '<div><span><button class="fa-circle-chevron-down">展开编辑</button></span></div><textarea id="world_entry_content_template" aria-label="条目正文"></textarea><button class="editor_maximize" data-for="world_entry_content_template" hidden>Monaco 编辑</button>'
    row.querySelector('textarea').value = entry.content
    list.append(row)
    // Upstream installs this listener after its lazy Monaco import; notify on actual interaction.
    row.querySelector('.fa-circle-chevron-down').onclick = async event => {
      event.stopPropagation()
      for (const button of row.querySelectorAll('[data-for]:not(.editor_maximize)')) button.remove()
      window.$(list).off('click', '.fa-circle-chevron-down')
      await eventSource.emit('APP_READY')
      // Trigger the upstream delegated handler without invoking this DOM listener recursively.
      const click = window.$.Event('click'); click.target = row.querySelector('.fa-circle-chevron-down')
      window.$(list).triggerHandler(click)
      setTimeout(() => { for (const button of row.querySelectorAll('[data-for]:not(.editor_maximize)')) button.hidden = false }, 1100)
    }
  }
  select.onchange = () => void renderEntry()
  section.querySelector('#save-template-entry').onclick = () => show(async () => {
    if (!worldbook) return
    const entries = structuredClone(worldbook.entries)
    entries[Number(select.value)].content = list.querySelector('textarea').value
    const result = await rpc('replaceFullTemplateWorldbook', { name: worldbook.name, entries, expectedEntries: worldbook.entries })
    worldbook = result.worldbook; feedback.textContent = '已保存'; await plugin.synchronize()
  })
  section.querySelector('#run-template-command').onclick = () => show(async () => {
    await plugin.refresh()
    const result = await plugin.project('command', { text: section.querySelector('#template-command').value })
    await plugin.flush(); feedback.textContent = String(result.pipe ?? '')
  })
  return { async open() { await show(async () => {
    await plugin.refresh()
    const result = await rpc('getFullTemplateWorldbook', { name: 'current' }); worldbook = result.worldbook
    select.replaceChildren(...worldbook.entries.map((entry, index) => { const option = document.createElement('option'); option.value = index; option.textContent = entry.name || entry.comment || String(entry.uid); return option }))
    await renderEntry(); await eventSource.emit('APP_READY')
  }) } }
}
