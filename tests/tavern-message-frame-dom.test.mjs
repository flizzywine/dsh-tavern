import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// SillyTavern cards locate their own panel with a fixed ID inside the message
// HTML. Tavern renders messages in same-origin frames, so the compatibility
// window has to look there as well or the panel code silently never runs.
const composerSource = readFileSync(new URL('../tavern-plugin/src/client/legacy-composer.js', import.meta.url), 'utf8')

async function sandbox() {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body><main><p id="host-only">host</p></main></body>', { runScripts: 'outside-only' })
  dom.window.eval(composerSource + ';window.makeWindow=createTavernComposerWindow')
  function messageFrame(sessionId, markup) {
    const frame = dom.window.document.createElement('iframe')
    frame.className = 'dsh-tavern-message-frame'
    frame.__dshTavernSessionId = sessionId
    dom.window.document.body.append(frame)
    frame.contentDocument.body.innerHTML = markup
    return frame
  }
  const helper = dom.window.document.createElement('iframe')
  dom.window.document.body.append(helper)
  helper.__dshTavernSessionId = 'session-a'
  const view = dom.window.makeWindow(helper.contentWindow, dom.window)
  return { dom, helper, view, messageFrame }
}

test('固定 ID 在本会话的消息框架里也能找到，隐藏与其它会话不可见', async () => {
  const { dom, view, messageFrame } = await sandbox()
  try {
    const panel = messageFrame('session-a', '<div id="pBody"><i id="jtUp"></i><i id="jtPerfectList"></i></div>')
    const foreign = messageFrame('session-b', '<div id="pBody"><i id="jtUp"></i></div>')
    assert.equal(view.parent.document.getElementById('pBody'), panel.contentDocument.getElementById('pBody'))
    assert.equal(view.parent.document.querySelector('#jtUp'), panel.contentDocument.getElementById('jtUp'))
    const lists = Array.from(view.parent.document.querySelectorAll('#jtPerfectList'))
    assert.equal(lists.length, 1)
    assert.equal(lists[0], panel.contentDocument.getElementById('jtPerfectList'))
    // Nothing new renders here: the host document still owns its own nodes.
    assert.equal(view.parent.document.getElementById('host-only'), dom.window.document.getElementById('host-only'))
    assert.equal(view.parent.document.querySelector('#nothing-here'), null)

    panel.setAttribute('aria-hidden', 'true')
    assert.equal(view.parent.document.getElementById('pBody'), null)
    panel.removeAttribute('aria-hidden')
    assert.ok(view.parent.document.getElementById('pBody'))

    foreign.setAttribute('aria-hidden', 'false')
    assert.equal(view.parent.document.querySelectorAll('#jtUp').length, 1)
  } finally {
    dom.window.close()
  }
})

test('宿主 document 仍然优先，消息框架只是兜底', async () => {
  const { dom, view, messageFrame } = await sandbox()
  try {
    messageFrame('session-a', '<p id="shared">frame</p>')
    const host = dom.window.document.createElement('p')
    host.id = 'shared'
    host.textContent = 'host'
    dom.window.document.body.append(host)
    assert.equal(view.parent.document.getElementById('shared'), host)
    assert.equal(view.parent.document.querySelector('#shared'), host)
    const shared = Array.from(view.parent.document.querySelectorAll('#shared'))
    assert.equal(shared.length, 1)
    assert.equal(shared[0], host)
  } finally {
    dom.window.close()
  }
})
