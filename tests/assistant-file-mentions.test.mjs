import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// DSH 0.2.2 stopped routing fileMentions to every conversation.chat.node entry. Calling it
// unguarded threw on every closed turn, the slot abdicated, and the native renderer showed
// the card's raw <character_menu>/<SceneInfo> tags instead of Tavern's rendering.
test('酒馆回复渲染不依赖宿主路由的 fileMentions，自己注入并防御缺失', () => {
  for (const code of [source, client]) {
    assert.doesNotMatch(code, /:\s*props\.fileMentions\(owner\)/, '不能无条件调用宿主的 fileMentions')
    assert.match(code, /typeof props\.fileMentions === "function" \? props\.fileMentions : props\.tavernFileMentions/)
    assert.match(code, /typeof fileMentions !== "function" \? undefined : fileMentions\(owner\)/)
    const registration = code.slice(code.indexOf('key: "assistant-step"'), code.indexOf('}, function (props) {', code.indexOf('key: "assistant-step"')))
    assert.match(registration, /inject: function \(sessionId\)/)
    assert.match(registration, /tavernFileMentions/)
    assert.match(registration, /input\.ctx\.get\("chatFileMentions"\)/)
    assert.match(registration, /typeof service\.forClosing === "function" \? service\.forClosing\(owner, sessionId\) : undefined/)
  }
})

test('DSH 0.2.2 的「更多会话视图」按钮与视图标签垂直居中', async () => {
  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  assert.match(css, /\[class\*="_tabs"\] \[class\*="_viewsMoreAnchor"\] \{ align-self: center; \}/)
})
