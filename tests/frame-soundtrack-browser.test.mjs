import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import vm from './fixtures/client-vm.mjs'
import { micWav } from './helpers/phone-call-harness.mjs'

test('card trailers start muted alongside a looping soundtrack and either control can switch the sound', async t => {
  let descriptor
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
  })
  const client = descriptor.factory(() => ({}))
  const mediaUrl = 'data:audio/wav;base64,' + micWav([[0.25, 0]]).toString('base64')
  const trailer = '<video controls autoplay loop src="' + mediaUrl + '"></video>'
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const documents = [
    trailer + '<audio autoplay loop src="' + mediaUrl + '"></audio>',
    trailer,
    trailer + '<audio src="' + mediaUrl + '"></audio>'
  ].map(content => client.buildTavernFrameDocument({ content, leanRuntime: true, runtimeReporting: false }))
  await page.setContent('<iframe sandbox="allow-scripts"></iframe><iframe></iframe><iframe></iframe>')
  await page.locator('iframe').evaluateAll((frames, html) => frames.forEach((frame, i) => { frame.srcdoc = html[i] }), documents)
  const [paired, solo, effects] = await Promise.all([0, 1, 2].map(async index =>
    (await page.locator('iframe').nth(index).elementHandle()).contentFrame()))
  await Promise.all([paired, solo, effects].map(frame => frame.waitForFunction(() => document.querySelector('video')?.currentTime > 0)))
  const state = () => paired.evaluate(() => {
    const video = document.querySelector('video'), audio = document.querySelector('audio')
    return { videoMuted: video.muted, videoPaused: video.paused, musicPaused: audio.paused }
  })
  await paired.waitForFunction(() => !document.querySelector('audio').paused)
  assert.deepEqual(await state(), { videoMuted: true, videoPaused: false, musicPaused: false })
  for (const frame of [solo, effects]) assert.equal(await frame.locator('video').evaluate(node => node.muted), false)

  await paired.locator('video').evaluate(node => { node.muted = false })
  await paired.waitForFunction(() => document.querySelector('audio').paused)
  assert.deepEqual(await state(), { videoMuted: false, videoPaused: false, musicPaused: true })

  await paired.locator('audio').evaluate(node => node.play())
  await paired.waitForFunction(() => document.querySelector('video').muted)
  assert.deepEqual(await state(), { videoMuted: true, videoPaused: false, musicPaused: false })
})
