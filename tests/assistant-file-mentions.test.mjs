import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { assistantRendererHostScript } from './fixtures/assistant-renderer-host.mjs'

const script = await assistantRendererHostScript()
for (const [mode, expected] of [['fallback', 'fallback mentions'], ['legacy', 'legacy mentions'], ['missing', undefined], ['unrouted', undefined]]) {
  test(`闭合回合保留 Tavern 回复渲染及文件提及：${mode}`, () => {
    const context = vm.createContext({ React, window: {} })
    vm.runInContext(script, context)
    const html = renderToStaticMarkup(context.assistantHost.element(mode))
    assert.match(html, /class="dsh-tavern-assistant"/)
    assert.match(html, /Tavern reply/)
    assert.equal(context.assistantHost.mentions(), expected)
  })
}
