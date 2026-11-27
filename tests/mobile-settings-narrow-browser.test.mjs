import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// 手机窄屏的宿主设置：浮层渲染在 body 下（不在 frame 内），188px 导航不能把内容栏挤没（模型页提供商行不显示）。
test('手机窄屏的宿主设置改为顶部导航，内容栏占满宽度', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 60000 }, async t => {
  const { chromium } = await import('playwright')
  const pluginRequire = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
  const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
  const source = await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-ui-settings-general/client'), 'utf8')
  const extractCss = text => {
    const out = []
    for (const m of text.matchAll(/(?:const css(?:\$\d+)?\s*=\s*|style\.textContent\s*=\s*)(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const [, q, body] = m
      if (q === '"') out.push(JSON.parse('"' + body + '"'))
      else if (q === "'") out.push(body.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\'))
      else out.push(body)
    }
    return out
  }
  const settingsCss = extractCss(source).find(css => css.includes('_navList{') && css.includes('_panel{'))
  assert.ok(settingsCss, '宿主设置面板合约已变化')
  const key = settingsCss.match(/\.([\w-]+)_panel\{/)[1]
  const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const layouts = [
    ['0.2.1-flex', `<div class="${key}_overlay" role="presentation"><div class="${key}_panel" role="dialog" aria-modal="true"><nav class="${key}_nav"><div class="${key}_navTitle">设置</div><div class="${key}_navList"><button class="${key}_navCell">通用设置</button><button class="${key}_navCell">模型</button><button class="${key}_navCell">DSH Tavern</button></div></nav><div class="${key}_content"><div class="${key}_header"><div class="${key}_actions"><button>打开配置文件</button></div></div><div class="${key}_options"><h2>模型</h2><p>填入各提供商的 API 密钥即可使用其模型。</p><div id="provider" style="height:80px">DeepSeek</div></div></div></div></div>`],
    ['0.2.2-grid', `<div class="${key}_overlay" role="presentation"><div class="${key}_panel" data-shortcut-modal="settings" role="dialog" aria-modal="true"><div class="${key}_navTitle">设置</div><nav class="${key}_nav"><div class="${key}_navList"><button class="${key}_navCell">通用设置</button><button class="${key}_navCell">模型</button><button class="${key}_navCell">DSH Tavern</button></div></nav><div class="${key}_header"><div class="${key}_actions"><button>打开配置文件</button></div><button class="${key}_close">✕</button></div><div class="${key}_options"><h2>模型</h2><p>填入各提供商的 API 密钥即可使用其模型。</p><div id="provider" style="height:80px">DeepSeek</div></div></div></div>`],
  ]
  for (const [label, dialogHtml] of layouts) {
    for (const size of [{ width: 360, height: 780 }, { width: 412, height: 915 }]) {
      const page = await browser.newPage({ viewport: size, hasTouch: true, isMobile: true })
      await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${settingsCss}</style><style>${tavernCss}</style></head>
<body class="dsh-tavern-shell-active"><div id="root"><div data-slot="root"><div class="shell_frame" data-rightbar-collapsed="true"></div></div></div>
${dialogHtml}</body></html>`)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const provider = await page.locator('#provider').boundingBox()
      assert.ok(provider.width >= size.width - 48, `${label} ${size.width}px 宽下提供商行占满内容栏：${JSON.stringify(provider)}`)
      assert.equal(await page.locator(`nav.${key}_nav`).evaluate(el => getComputedStyle(el).flexDirection), 'row', `${label} ${size.width}px 导航栏横排`)
      await page.close()
    }
  }
})
