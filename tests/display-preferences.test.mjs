import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
test('隐藏注入、执行请求和思考时保留正文、工具、错误，关闭后恢复原有折叠状态', () => {
  const dom = new JSDOM(`<style>${css.slice(css.indexOf('/* Presentation only:'))}</style><body>
    <section data-dsh-fork-session="play"><div id="context" data-chat-flow-kind="context">注入内容</div>
    <div id="folded" data-chat-flow-kind="context" hidden>已折叠注入</div>
    <div id="thinking" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="0" data-turn-process-subagents="0">已思考</button></div>
    <div id="tools" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="1" data-turn-process-subagents="0">工具执行</button></div>
    <div id="answer" data-chat-flow-kind="assistant-step"><details id="reasoning" class="dsh-tavern-assistant-reasoning">思考内容</details><p>正文</p></div>
    <div id="trigger" data-chat-flow-kind="turn-trigger">收到执行请求</div>
    <div id="error" data-chat-flow-kind="turn-error">错误</div></section></body>`)
  const {document} = dom.window, before = document.body.innerHTML
  const display = id => dom.window.getComputedStyle(document.getElementById(id)).display
  document.documentElement.classList.add('dsh-tavern-hide-process')
  for (const id of ['context', 'thinking', 'reasoning', 'trigger']) assert.equal(display(id), 'none')
  for (const id of ['answer', 'tools', 'error']) assert.notEqual(display(id), 'none')
  document.documentElement.classList.remove('dsh-tavern-hide-process')
  for (const id of ['context', 'thinking', 'reasoning', 'trigger']) assert.notEqual(display(id), 'none')
  assert.equal(display('folded'), 'none')
  assert.equal(document.body.innerHTML, before)
  dom.window.close()
})

test('工作台始终保留思考、工具历史和执行记录，游玩仍遵循隐藏设置', () => {
  const rows = `
    <div id="context" data-chat-flow-kind="context">上下文</div>
    <div id="system" data-chat-flow-kind="system-prompt">系统提示</div>
    <div id="thinking" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="0" data-turn-process-subagents="0">思考</button></div>
    <div id="reasoning" class="dsh-tavern-assistant-reasoning">思考内容</div>
    <div id="tools" data-chat-flow-kind="turn-process"><button data-turn-process-tool-calls="1" data-turn-process-subagents="0">调用工具</button><span data-chat-paging-anchor>历史步骤</span></div>
    <div id="trigger" data-chat-flow-kind="turn-trigger">执行请求</div>`.trim().split(/\n\s*/)
  for (const mode of ['card', 'play']) for (const hidden of [true, false]) for (const row of rows) {
    const dom = new JSDOM(`<style>${css.slice(css.indexOf('/* Presentation only:'))}</style><body>
      <section data-dsh-fork-session="${mode}">${row}</section></body>`)
    const { document } = dom.window
    const display = id => dom.window.getComputedStyle(document.getElementById(id)).display
    document.documentElement.classList.toggle('dsh-tavern-hide-process', hidden)
    const kind = document.querySelector('section > div').id
    assert.equal(display(kind) === 'none', mode === 'play' && hidden, `${mode} ${kind} 的显示范围`)
    dom.window.close()
  }
})

test('正文底栏保留宿主复制和酒馆分叉，只藏原生分支与酒馆之外的插件动作', () => {
  const dom = new JSDOM(`<style>${css}</style><body class="dsh-tavern-shell-active">
    <div data-turn-tail="21">
      <div data-slot="conversation.chat.turnTail" style="display:contents"></div>
      <div class="actions">
        <button id="copy" type="button" aria-label="复制">复制</button>
        <div data-slot="conversation.chat.assistant-actions" style="display:contents">
          <button id="fork" type="button" class="dsh-tavern-message-fork" aria-label="从这一轮分叉">分叉</button>
          <button id="feedback" type="button" aria-label="好的回答">反馈</button>
        </div>
        <button id="native-branch" type="button" aria-label="在新对话中分支">在新对话中分支</button>
        <span>19:09</span>
      </div>
    </div></body>`)
  const {document} = dom.window
  const display = id => dom.window.getComputedStyle(document.getElementById(id)).display
  assert.notEqual(display('copy'), 'none', '宿主的复制按钮应该留在正文底栏')
  assert.notEqual(display('fork'), 'none', '酒馆的分叉按钮应该留在正文底栏')
  assert.equal(display('feedback'), 'none', '酒馆之外的插件动作不进入游玩底栏')
  assert.equal(display('native-branch'), 'none', '宿主的原生分支会绕开游戏状态，仍应藏掉')
  dom.window.close()
})
