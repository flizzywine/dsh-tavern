// 选卡/开局准备页展开时，卡片自带的悬浮应用（外置小手机）先收起，
// 避免盖住开场白预览和 letter 列表；关闭准备页后恢复，进对局由「人物卡应用」停靠。
// node tests/browser/opening-picker-phone-suspend-browser-smoke.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
const page = await browser.newPage()
await page.setContent('<!doctype html><meta charset="utf-8"><style>' + css + '</style>'
  + '<div id="improved-phone-shadow-host-card"></div>'
  + '<button id="improved-phone-floating-button-card">手机</button>'
  + '<div id="auto-message-notification-container">通知</div>')
// 手机宿主是带 shadow root 的固定层，可见性要能继承进影子树。
await page.evaluate(() => {
  const root = document.getElementById('improved-phone-shadow-host-card').attachShadow({ mode: 'open' })
  root.innerHTML = '<div class="phone-wrapper"><div class="phone-container">手机</div></div>'
})

const probe = () => page.evaluate(() => {
  const host = document.getElementById('improved-phone-shadow-host-card')
  return {
    host: getComputedStyle(host).visibility,
    shadow: getComputedStyle(host.shadowRoot.querySelector('.phone-container')).visibility,
    button: getComputedStyle(document.getElementById('improved-phone-floating-button-card')).visibility,
    notification: getComputedStyle(document.getElementById('auto-message-notification-container')).visibility
  }
})

const shown = { host: 'visible', shadow: 'visible', button: 'visible', notification: 'visible' }
const hidden = { host: 'hidden', shadow: 'hidden', button: 'hidden', notification: 'hidden' }
assert.deepEqual(await probe(), shown, '准备页之外的手机正常显示')
await page.evaluate(() => document.body.classList.add('dsh-tavern-picker-open'))
assert.deepEqual(await probe(), hidden, '准备页打开时手机宿主、影子树内容、悬浮按钮与消息横幅一起收起')
await page.evaluate(() => document.body.classList.remove('dsh-tavern-picker-open'))
assert.deepEqual(await probe(), shown, '准备页关闭后手机恢复')
await browser.close()
console.log('PASS 开局准备页收起外置小手机')
