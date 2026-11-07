// Render every size from the vector source; never upscale or resize another PNG.
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { icoFromPng } from '../tavern-plugin/packages/dsh-tavern/lib/shortcut.mjs'

const brand = new URL('../docs/assets/brand/', import.meta.url)
const assets = new URL('../tavern-plugin/packages/dsh-tavern/assets/', import.meta.url)
const svg = await readFile(new URL('dsh-tavern-app-icon.svg', brand), 'utf8')
// Browser application windows take their taskbar icon from the injected favicon.
await writeFile(new URL('../tavern-plugin/lib/client-assets/logo.svg', import.meta.url), svg)
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
})
try {
  const page = await browser.newPage()
  const frames = []
  for (const size of [16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 512]) {
    const data = await page.evaluate(async ({ svg, size }) => {
      const image = new Image()
      image.src = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`))
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svg, size })
    const png = Buffer.from(data, 'base64')
    if (size <= 256) frames.push(png)
    if (size === 192 || size === 512) {
      const name = `dsh-tavern-app-icon-${size}.png`
      await writeFile(new URL(name, brand), png)
      await writeFile(new URL(name, assets), png)
    }
  }
  await writeFile(new URL('dsh-tavern-app.ico', assets), icoFromPng(frames))
} finally {
  await browser.close()
}
