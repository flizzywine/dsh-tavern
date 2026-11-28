import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const themes = JSON.parse(await readFile(new URL('../../tavern-plugin/packages/dsh-dream-skin/tavern-themes.json', import.meta.url), 'utf8'))
const browser = await chromium.launch()
try {
 const page = await browser.newPage({ reducedMotion: 'reduce' })
 await page.setContent('<style id="theme"></style><style>'+css+'</style><main class="dsh-tavern-status"><button class="dsh-card-primary">添加 Guide</button><button class="dsh-tavern-btn">重新加载</button></main>')
 for (const theme of [...themes, { tokens: { '--dsw-alias-brand-primary': '#2196f3', '--dsw-alias-label-primary': '#102030', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#eee', '--dsw-alias-border-l2': '#ddd' }}]) {
  const result = await page.evaluate(({ tokens, colorScheme, wallpaperGradient, bloomBackdrop }) => {
   document.body.toggleAttribute('data-ds-dark-theme', colorScheme === 'dark')
   document.querySelector('#theme').textContent = `body { ${Object.entries(tokens).map(([key, value]) => `${key}: ${value}`).join('; ')} }`
   const primary = getComputedStyle(document.querySelector('.dsh-card-primary'))
   const secondary = getComputedStyle(document.querySelector('.dsh-tavern-btn'))
   const probe = document.body.appendChild(document.createElement('span'))
   probe.style.color = tokens['--dsw-alias-brand-primary']
   const accent = getComputedStyle(probe).color
   probe.style.color = tokens['--dsw-alias-label-primary']
   const ink = getComputedStyle(probe).color
   probe.remove()

   const canvas = document.createElement('canvas').getContext('2d')
   function luminance(color) {
    canvas.fillStyle = color
    canvas.fillRect(0, 0, 1, 1)
    const [r, g, b] = Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3), channel => {
     const unit = channel / 255
     return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
   }
   const foreground = luminance(primary.color)
   const background = luminance(primary.backgroundColor)
   return {
    accent, ink, primary: primary.backgroundColor, secondary: secondary.color,
    buttonContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    validGradient: CSS.supports('background-image', wallpaperGradient),
    validBloomBackdrop: CSS.supports('background-image', bloomBackdrop)
   }
  }, theme)
  assert.equal(result.primary, result.accent, theme.id)
  assert.equal(result.secondary, result.ink, theme.id)
  if (theme.wallpaperGradient) assert.equal(result.validGradient, true, theme.id)
  if (theme.id?.startsWith('tavern-bloom-')) {
   assert.equal(result.validBloomBackdrop, true, theme.id)
   assert.ok(result.buttonContrast >= 4.5, `${theme.id}: ${result.buttonContrast}`)
  }
 }
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 console.log(`PASS: ${themes.length} bundled skin variants, custom skin, button colors, Bloom button contrast, wallpaper gradients and narrow viewport`)
} finally { await browser.close() }
