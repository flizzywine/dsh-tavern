// the phone page's call screen draws the player's words while they
// are still being recognized as one live last line - only the latest words, kept out of screen-reader announcements -
// and drops it once the words become the player's line. Real phone view in a frame, at the PC and 375 px phone sizes.
// PHONE_CALL_SHOTS=<dir> also saves a picture of each size with a long live line.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'

const view = new URL('../tavern-plugin/mods/phone/view/', import.meta.url)
const SIZES = [{name:'pc', viewport:{width:1920, height:1080}, frame:{width:310, height:672}}, {name:'phone', viewport:{width:375, height:812}, frame:{width:375, height:812}}]

test('the call screen shows the live words as the last line and drops them when they become the player\'s line', {timeout:60000}, async t => {
  const browser = await chromium.launch({headless:true, args:['--mute-audio']}); t.after(() => browser.close())
  for (const size of SIZES) {
    const page = await browser.newPage({viewport:size.viewport}), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://phone.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1)
      if (name.startsWith('phone/')) return route.fulfill({contentType:name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body:await readFile(new URL(name.slice(6), view))})
      return route.fulfill({contentType:'text/html', body:`<style>html,body{margin:0;background:#000}</style><iframe id="phone" src="/phone/index.html" style="border:0;width:${size.frame.width}px;height:${size.frame.height}px"></iframe>`})
    })
    await page.goto('http://phone.test/')
    const frame = await (await page.$('#phone')).contentFrame()
    await frame.waitForSelector('#call-lines', {state:'attached'})
    await page.evaluate(() => {
      window.send = (type, data = {}) => document.getElementById('phone').contentWindow.postMessage({channel:'dsh-widget', version:2, token:'call', type, ...data}, '*')
      send('init', {presentation:{state:'open', suspended:false, attention:{}, reducedMotion:false}, playback:{mode:'live'}, settings:{}, theme:{surface:'#1f1d1b', surfaceText:'#f4efe8', muted:'#b9b1a6', accent:'#d39a6a', accentText:'#1a1410', border:'#3b3a38'}})
      const rows = [{id:'m0', turn:1, para:1, side:'in', sender:'f_anon', contact:'f_anon', name:'千早爱音', text:'在吗？', revealed:true, threadId:'anon'}]
      send('source', {source:{threadKey:'anon', messages:rows, current:{id:'m0', revealed:true}, historyStatus:'ready', threadId:'anon', liveThreadId:'anon', phoneId:'$player', playerName:'高坂月',
        threads:[{id:'anon', kind:'direct', name:'千早爱音', participants:[{id:'$player', name:'你'}, {id:'f_anon', name:'千早爱音'}], messages:rows, unread:0}],
        phones:[{id:'$player', name:'你', unread:0, threads:[]}]}})
      window.callState = patch => send('phone.call.state', {call:{status:'hearing', contactId:'f_anon', name:'千早爱音', connected:true, elapsed:12, muted:false, lines:[{role:'contact', turn:'t1', text:'喂', started:true}], ...patch}})
    })
    const read = () => frame.evaluate(() => {
      const holder = document.getElementById('call-lines'), rows = [...holder.children]
      return {rows:rows.map(row => ({role:row.dataset.role, partial:row.dataset.partial || null, hidden:row.getAttribute('aria-hidden'), text:row.textContent})), overflowX:holder.scrollWidth > holder.clientWidth}
    })
    await page.evaluate(() => callState({partial:'今天天气'}))
    await frame.waitForFunction(() => document.querySelector('#call-lines [data-partial]'))
    let shown = await read()
    assert.deepEqual(shown.rows.map(row => [row.role, row.partial, row.hidden, row.text]), [['contact', null, null, '喂'], ['player', 'true', 'true', '今天天气']], size.name)
    // A long utterance keeps only its latest words on screen.
    const long = '今天天气真好我们出去走走吧'.repeat(5)
    await page.evaluate(text => callState({partial:text}), long)
    await frame.waitForFunction(text => document.querySelector('#call-lines [data-partial]')?.textContent.endsWith(text.slice(-10)), long)
    shown = await read()
    assert.equal(shown.rows.at(-1).text, '…' + Array.from(long).slice(-48).join(''))
    assert.equal(shown.overflowX, false, size.name + ': no sideways overflow')
    if (process.env.PHONE_CALL_SHOTS) await page.screenshot({path:join(process.env.PHONE_CALL_SHOTS, `call-partial-${size.name}.png`)})
    // The words become the player's line: the live line goes with the same update.
    await page.evaluate(() => callState({status:'thinking', partial:'', lines:[{role:'contact', turn:'t1', text:'喂', started:true}, {role:'player', text:'今天天气真好，我们出去走走吧。'}]}))
    await frame.waitForFunction(() => !document.querySelector('#call-lines [data-partial]'))
    shown = await read()
    assert.deepEqual(shown.rows.map(row => [row.role, row.partial, row.text]), [['contact', null, '喂'], ['player', null, '今天天气真好，我们出去走走吧。']])
    assert.deepEqual(errors, [])
    await page.close()
  }
})

// iOS's call screen (owner 2026-10-26 「首先没正确显示头像」「静音按钮点了以后反而 mic 高亮」「挂断也不够还原 ios」「按钮好像还差很多吧」):
// her face (the initial only stands in for a missing photo), 呼叫中… while it rings and the clock after, iOS 26's six keys in
// a 3 x 2 grid of equal circles evenly spaced (only 静音 and 结束 answer; the other four are aria-disabled and send nothing),
// 静音 the struck-through microphone on glass that turns white; connected, her photo and the clock move to the top-left corner,
// and 结束 dims only what the call said at the press (the owner's 挂断瞬间), shows 通话结束 and slides away to where the call was
// made - here her card in the 电话 app, with the new call on it.
const FACE = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d88"/></svg>').toString('base64')
test('the call screen shows her face, rings, mutes as iOS does and hangs up back into the 电话 app', {timeout:90000}, async t => {
  const browser = await chromium.launch({headless:true, args:['--mute-audio']}); t.after(() => browser.close())
  for (const size of SIZES) {
    const page = await browser.newPage({viewport:size.viewport}), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://phone.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1)
      if (name.startsWith('phone/')) return route.fulfill({contentType:name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body:await readFile(new URL(name.slice(6), view))})
      return route.fulfill({contentType:'text/html', body:`<style>html,body{margin:0;background:#000}</style><iframe id="phone" src="/phone/index.html" style="border:0;width:${size.frame.width}px;height:${size.frame.height}px"></iframe>`})
    })
    await page.goto('http://phone.test/')
    const frame = await (await page.$('#phone')).contentFrame()
    await frame.waitForSelector('#dialer', {state:'attached'})
    const settled = () => frame.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity))
    const shot = name => process.env.PHONE_CALL_SHOTS ? page.screenshot({path:join(process.env.PHONE_CALL_SHOTS, `call-${name}-${size.name}.png`)}) : null
    await page.evaluate(face => {
      window.sent = []
      addEventListener('message', event => { if (event.data?.channel === 'dsh-widget' && event.data.type === 'phone.call') sent.push({action:event.data.action, muted:event.data.muted, at:performance.now()}) })
      window.send = (type, data = {}) => document.getElementById('phone').contentWindow.postMessage({channel:'dsh-widget', version:2, token:'call', type, ...data}, '*')
      send('init', {presentation:{state:'open', suspended:false, attention:{}, reducedMotion:false}, playback:{mode:'live'}, settings:{}, theme:{surface:'#f4f2ec', surfaceText:'#23262b', muted:'#6b6f76', accent:'#6f8fd8', accentText:'#ffffff', border:'#3b3a38'}})
      // 辉夜 has no conversation on this phone: her face comes from the 电话 app's contact row.
      send('source', {source:{threadKey:'none', messages:[], historyStatus:'ready', phoneId:'$player', playerName:'彩叶', threads:[], phones:[{id:'$player', name:'你', unread:0, threads:[]}], avatars:{a0:face},
        contacts:[{id:'f_kaguya', name:'辉夜', avatar:'a0'}, {id:'f_yachiyo', name:'月见八千代'}]}})
      window.base = {threads:{}, available:true, voices:{f_kaguya:true, f_yachiyo:true}}
      window.callState = patch => send('phone.call.state', {call:{...base, ...patch}})
      callState({status:'idle'})
    }, FACE)
    await frame.click('#home'); await frame.waitForSelector('#home-screen:not([hidden])'); await settled()
    await frame.click('[data-app="phone"]'); await frame.waitForSelector('.dial-row'); await settled()
    // 通讯录 → her card → its handset (iOS 26: a contact row opens the card; phone-ios-r4).
    await frame.click('.dial-row[data-contact-id="f_kaguya"]')
    await frame.waitForSelector('#phone-app[data-page="detail"] [data-key="call"]:not([disabled])'); await settled()
    await frame.click('#call-detail [data-key="call"]')
    await page.waitForFunction(() => sent.some(row => row.action === 'start'))
    const read = () => frame.evaluate(() => {
      const box = document.getElementById('call'), face = box.querySelector('.call-face').getBoundingClientRect(), top = document.elementFromPoint(face.left + face.width / 2, face.top + face.height / 2)
      const mute = document.getElementById('call-mute'), key = mute.querySelector('.call-key')
      return {hidden:box.hidden, look:box.dataset.look, status:document.getElementById('call-status').textContent, name:document.getElementById('call-name').textContent,
        face:top?.id || top?.className || null, src:document.getElementById('call-avatar').getAttribute('src'), wall:getComputedStyle(document.querySelector('.call-wall')).backgroundImage, home:getComputedStyle(document.getElementById('home-screen')).backgroundImage,
        mute:{pressed:mute.getAttribute('aria-pressed'), background:getComputedStyle(key).backgroundColor, color:getComputedStyle(key).color, disabled:mute.disabled},
        end:document.getElementById('call-end').disabled, app:document.body.dataset.app, overflowX:box.scrollWidth > box.clientWidth}
    })
    // Ringing: 呼叫中… under her face; no clock yet.
    await page.evaluate(() => callState({status:'connecting', contactId:'f_kaguya', name:'', connected:false, elapsed:0, muted:false, lines:[], partial:''}))
    await frame.waitForSelector('#call:not([hidden])'); await settled()
    let shown = await read()
    assert.equal(shown.look, 'ringing'); assert.equal(shown.status, '呼叫中…'); assert.equal(shown.name, '辉夜', size.name + ': her name from the contact row while it rings')
    assert.equal(shown.face, 'call-avatar', size.name + ': her photo is what shows in the circle'); assert.equal(shown.src, FACE)
    // owner 2026-10-26 「背景颜色的那个图不要hardcoding。应该是通过壁纸来处理的吧」: the screen stands on the phone's wallpaper - here the built-in one,
    // the very background of the home screen
    assert.match(shown.wall, /linear-gradient/); assert.equal(shown.wall, shown.home, size.name + ': the phone\'s wallpaper is the poster behind the screen')
    assert.equal(shown.overflowX, false)
    // The keys: iOS's six in its order, equal circles in two even rows of three, the unusable four aria-disabled.
    const keys = await frame.evaluate(() => {
      const box = document.getElementById('call'), screen = box.getBoundingClientRect(), probe = document.createElement('i')
      probe.style.cssText = 'position:absolute;width:calc(78 * var(--pt))';box.append(probe);const pt78 = probe.getBoundingClientRect().width;probe.remove()
      return [...document.querySelectorAll('.call-buttons button')].map(button => {
        const circle = button.querySelector('.call-key').getBoundingClientRect()
        return {id:button.id, label:button.textContent, off:button.getAttribute('aria-disabled'), x:circle.left + circle.width / 2 - screen.left, y:circle.top - screen.top, w:circle.width, h:circle.height, screen:screen.width, pt78, inside:circle.bottom < screen.bottom}
      })
    })
    assert.deepEqual(keys.map(key => [key.label, key.off]), [['扬声器', 'true'], ['FaceTime', 'true'], ['静音', null], ['更多', 'true'], ['结束', null], ['键盘', 'true']])
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, size.name + ': ' + what + ' ' + a + ' vs ' + b)
    for (const key of keys) { near(key.w, keys[0].w, 'circle width'); near(key.h, key.w, 'round'); assert.ok(key.inside, key.label + ' on screen') }
    near(keys[0].w, keys[0].pt78, '78 pt')
    for (const [a, b] of [[0, 3], [1, 4], [2, 5]]) near(keys[a].x, keys[b].x, 'column')
    for (const row of [keys.slice(0, 3), keys.slice(3)]) { near(row[1].y, row[0].y, 'row'); near(row[2].y, row[0].y, 'row') }
    const gap = (keys[0].screen - 3 * keys[0].w) / 4
    near(keys[0].x - keys[0].w / 2, gap, 'margin'); near(keys[1].x - keys[0].x, keys[0].w + gap, 'even spacing'); near(keys[2].x - keys[1].x, keys[0].w + gap, 'even spacing')
    await shot('ringing')
    // Picked up: the clock; 静音 off is the glass circle with the white struck-through microphone.
    await page.evaluate(() => callState({status:'listening', contactId:'f_kaguya', name:'辉夜', connected:true, elapsed:38, muted:false, lines:[{role:'contact', turn:'t1', text:'喂', started:true}]}))
    await frame.waitForFunction(() => document.getElementById('call-status').textContent === '0:38')
    shown = await read()
    assert.equal(shown.look, 'connected')
    // Connected (the owner's 通话中): her 55 pt photo in the top-left corner beside the clock and the name, which start 102 pt in.
    const corner = await frame.evaluate(() => {
      const box = document.getElementById('call'), screen = box.getBoundingClientRect(), probe = document.createElement('i')
      probe.style.cssText = 'position:absolute;width:calc(100 * var(--pt))'; box.append(probe); const pt = probe.getBoundingClientRect().width / 100; probe.remove()
      const face = box.querySelector('.call-face').getBoundingClientRect(), status = document.getElementById('call-status').getBoundingClientRect(), name = document.getElementById('call-name').getBoundingClientRect()
      return {size:face.width / pt, left:(face.left - screen.left) / pt, middle:(face.top + face.height / 2 - screen.top) / pt, status:(status.left - screen.left) / pt, name:(name.left - screen.left) / pt, statusMiddle:(status.top + status.height / 2 - screen.top) / pt}
    })
    near(corner.size, 55, 'face 55 pt'); near(corner.left, 37, 'face 37 pt in'); near(corner.middle, 141, 'face centre 141 pt down')
    near(corner.status, 102, 'clock 102 pt in'); near(corner.name, 102, 'name 102 pt in'); near(corner.statusMiddle, 119, 'clock centre 119 pt down')
    assert.deepEqual([shown.mute.pressed, shown.mute.color], ['false', 'rgb(255, 255, 255)'])
    assert.match(shown.mute.background, /rgba\(255, 255, 255, 0\.13\)/)
    // A key the call cannot use does nothing at all.
    const before = await page.evaluate(() => sent.length)
    for (const id of ['call-speaker', 'call-video', 'call-more', 'call-keypad']) await frame.click('#' + id, {force:true})
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => sent.length), before, size.name + ': the unusable keys send nothing')
    assert.equal((await read()).look, 'connected')
    await shot('connected')
    // 静音 asks the stage; muted is the white circle with the microphone struck through in dark ink.
    await frame.click('#call-mute')
    await page.waitForFunction(() => sent.some(row => row.action === 'mute' && row.muted === true))
    await page.evaluate(() => callState({status:'listening', contactId:'f_kaguya', name:'辉夜', connected:true, elapsed:41, muted:true, lines:[]}))
    await frame.waitForFunction(() => document.getElementById('call-mute').getAttribute('aria-pressed') === 'true')
    await settled()
    shown = await read()
    assert.deepEqual([shown.mute.background, shown.mute.color], ['rgb(255, 255, 255)', 'rgb(21, 23, 28)'])
    await shot('muted')
    await page.evaluate(() => callState({status:'listening', contactId:'f_kaguya', name:'辉夜', connected:true, elapsed:44, muted:false, lines:[]}))
    await frame.waitForFunction(() => document.getElementById('call-mute').getAttribute('aria-pressed') === 'false')
    // 结束: at the press (before the stage answers) 通话结束, the screen greys and no button answers any more.
    await frame.click('#call-end')
    shown = await read()
    assert.deepEqual([shown.look, shown.status, shown.mute.disabled, shown.end, shown.hidden], ['ended', '通话结束', true, true, false])
    // Only what the call said dims, as the owner's 挂断瞬间: the status to 40 %, name 65 %, photo 55 %, the key glyphs 62 %, 结束
    // a duller red; nothing is greyscaled, the key labels stay white and the photo stays in its corner.
    await page.waitForTimeout(250)
    const dim = await frame.evaluate(() => {
      const css = node => getComputedStyle(node)
      return {status:css(document.getElementById('call-status')).color, name:css(document.getElementById('call-name')).opacity, face:css(document.querySelector('.call-face')).opacity,
        glyph:css(document.querySelector('#call-mute svg')).opacity, off:css(document.querySelector('#call-video svg')).opacity, end:css(document.querySelector('#call-end .call-key')).backgroundColor,
        labels:[...document.querySelectorAll('.call-buttons button > span:last-child')].map(node => css(node).color + '/' + css(node.parentNode).opacity),
        filters:[...document.querySelectorAll('#call *')].map(node => css(node).filter).filter(value => value !== 'none' && !value.includes('blur')), corner:document.getElementById('call').dataset.connected}
    })
    assert.deepEqual(dim, {status:'rgba(255, 255, 255, 0.4)', name:'0.65', face:'0.55', glyph:'0.62', off:'0.42', end:'rgb(182, 43, 46)', labels:Array(6).fill('rgb(255, 255, 255)/1'), filters:[], corner:'true'}, size.name)
    await page.waitForFunction(() => sent.some(row => row.action === 'end'))
    await page.evaluate(() => callState({status:'ended', contactId:'f_kaguya', name:'辉夜', connected:true, elapsed:44, muted:false, lines:[], threads:{f_kaguya:[{id:'c9', startedAt:Date.now() - 44000, endedAt:Date.now(), turn:1, lines:[]}]}}))
    await page.waitForTimeout(250)
    await shot('ended')
    // The stage lets the call go: the screen slides away and the 电话 app is there, the new call at the top.
    await page.evaluate(() => { base.threads = {f_kaguya:[{id:'c9', startedAt:Date.now() - 44000, endedAt:Date.now(), turn:1, lines:[]}]}; callState({status:'idle'}) })
    await frame.waitForSelector('#call[hidden]', {state:'attached', timeout:3000})
    shown = await read()
    assert.equal(shown.app, 'phone', size.name + ': back in the 电话 app')
    // With no call yet 电话 opened on 通讯录; now that there is one (and no tab was picked) it shows 通话, the new call on top.
    // The call was made from her card: it slides back there, the new call on its 通话记录 card; under it the list is on 通话.
    const recents = await frame.evaluate(() => ({page:document.getElementById('phone-app').dataset.page, card:document.querySelector('#call-detail .call-line-row')?.dataset.callId,
      title:document.getElementById('dial-title').textContent, first:document.querySelector('.dial-row')?.dataset.key}))
    assert.deepEqual(recents, {page:'detail', card:'c9', title:'通话', first:'call:c9'})
    await settled(); await shot('after')
    assert.deepEqual(errors, [])
    await page.close()
  }
})

// FaceTime (§5): the same call on video. The page keeps the screen clear for the stage's
// picture and tells it where (phone.video, fractions of the page, with the framing the phone declares); iOS 26's furniture in
// measured points - the name pill top left, the white shutter top right, four round keys bottom right (camera, microphone, …,
// end), the self view bottom left only while the camera is on - our chat bubbles (hers left, the player's right, the pill's
// glass) and 「无法打开摄像头」 only when the player has no figure. No status words, the hang-up included.
const CALL_VIDEO = {backdrop:'stage', remote:{head:[0.5, 0.17, 0.32]}, self:{head:[0.5, 0.2, 0.34]}}
test('FaceTime keeps the screen clear for her video, with iOS 26 furniture, bubbles and the camera\'s three states', {timeout:90000}, async t => {
  const browser = await chromium.launch({headless:true, args:['--mute-audio']}); t.after(() => browser.close())
  for (const size of SIZES) {
    const page = await browser.newPage({viewport:size.viewport}), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://phone.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1)
      if (name.startsWith('phone/')) return route.fulfill({contentType:name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body:await readFile(new URL(name.slice(6), view))})
      return route.fulfill({contentType:'text/html', body:`<style>html,body{margin:0;background:#000}</style><iframe id="phone" src="/phone/index.html" style="border:0;width:${size.frame.width}px;height:${size.frame.height}px"></iframe>`})
    })
    await page.goto('http://phone.test/')
    const frame = await (await page.$('#phone')).contentFrame()
    await frame.waitForSelector('#ft', {state:'attached'})
    await page.evaluate(({face, callVideo, sheet}) => {
      window.sent = []; window.videos = []
      addEventListener('message', event => {
        if (event.data?.channel !== 'dsh-widget') return
        if (event.data.type === 'phone.call') sent.push({action:event.data.action, on:event.data.on, muted:event.data.muted})
        if (event.data.type === 'phone.video') videos.push(event.data.video)
      })
      window.send = (type, data = {}) => document.getElementById('phone').contentWindow.postMessage({channel:'dsh-widget', version:2, token:'call', type, ...data}, '*')
      send('init', {presentation:{state:'open', surface:sheet ? 'sheet' : 'stage', suspended:false, attention:{}, reducedMotion:false}, playback:{mode:'live'}, settings:{callVideo}, theme:{surface:'#f4f2ec', surfaceText:'#23262b', muted:'#6b6f76', accent:'#6f8fd8', accentText:'#ffffff', border:'#3b3a38'}})
      send('source', {source:{threadKey:'none', messages:[], historyStatus:'ready', phoneId:'$player', playerName:'彩叶', threads:[], phones:[{id:'$player', name:'你', unread:0, threads:[]}], avatars:{a0:face},
        contacts:[{id:'f_kaguya', name:'辉夜', avatar:'a0'}]}})
      window.callState = patch => send('phone.call.state', {call:{threads:{}, available:true, voices:{f_kaguya:true}, videos:{f_kaguya:true}, selfFigure:true, status:'listening', contactId:'f_kaguya', name:'辉夜', connected:true, elapsed:20, muted:false, lines:[], ...patch}})
    }, {face:FACE, callVideo:CALL_VIDEO, sheet:size.name === 'phone'})
    const shot = name => process.env.PHONE_CALL_SHOTS ? page.screenshot({path:join(process.env.PHONE_CALL_SHOTS, `facetime-${name}-${size.name}.png`)}) : null
    // On a voice call the FaceTime key now answers, and asks the stage to go on video.
    await page.evaluate(() => callState({}))
    await frame.waitForSelector('#call:not([hidden])')
    await frame.waitForFunction(() => document.getElementById('call-video').getAttribute('aria-disabled') === 'false')
    await frame.click('#call-video')
    await page.waitForFunction(() => sent.some(row => row.action === 'video'))
    const lines = [{role:'contact', turn:'t1', text:'喂，看得到吗？', started:true}, {role:'player', text:'看得到。'}, {role:'contact', turn:'t2', text:'太好了。', started:true}]
    await page.evaluate(lines => callState({video:true, camera:false, lines}), lines)
    await frame.waitForSelector('#ft:not([hidden])')
    await page.waitForFunction(() => videos.at(-1)?.views?.length === 1)
    const read = () => frame.evaluate(() => {
      const box = document.getElementById('call'), screen = box.getBoundingClientRect(), probe = document.createElement('i')
      probe.style.cssText = 'position:absolute;width:calc(100 * var(--pt))'; box.append(probe); const pt = probe.getBoundingClientRect().width / 100; probe.remove()
      const at = id => { const r = (typeof id === 'string' ? document.getElementById(id) : id).getBoundingClientRect(); return {left:(r.left - screen.left) / pt, top:(r.top - screen.top) / pt, right:(screen.right - r.right) / pt, bottom:(screen.bottom - r.bottom) / pt, width:r.width / pt, height:r.height / pt, visible:r.width > 0} }
      const css = id => getComputedStyle(typeof id === 'string' ? document.getElementById(id) : id)
      const page = document.documentElement.getBoundingClientRect()
      return {pill:at('ft-name'), shutter:at('ft-shutter'), self:at('ft-self'), keys:[...document.querySelectorAll('.ft-keys button')].map(button => ({id:button.id, ...at(button), pressed:button.getAttribute('aria-pressed'), off:button.getAttribute('aria-disabled'), bg:css(button).backgroundColor, color:css(button).color})),
        bubbles:[...document.querySelectorAll('.ft-line')].map(row => ({role:row.dataset.role, text:row.textContent, ...at(row), bg:css(row).backgroundColor})), pillBg:css('ft-name').backgroundColor, shutterBg:css('ft-shutter').backgroundColor,
        error:document.getElementById('ft-self-error').hidden ? null : document.getElementById('ft-self-error').textContent, phone:css('phone').backgroundColor, app:css(document.querySelector('.app')).visibility,
        text:document.getElementById('ft').innerText.replace(/\s+/g, ' ').trim(), legacy:['call-status', 'call-name'].map(id => document.getElementById(id).offsetParent !== null),
        call:{x:(screen.left - page.left) / page.width, y:(screen.top - page.top) / page.height, width:screen.width / page.width, height:screen.height / page.height}}
    })
    const near = (a, b, what, tolerance = 1) => assert.ok(Math.abs(a - b) <= tolerance, size.name + ': ' + what + ' ' + a + ' vs ' + b)
    let shown = await read()
    // The screen is clear for her video: no wallpaper, no app behind, no voice-call status or name.
    assert.equal(shown.phone, 'rgba(0, 0, 0, 0)'); assert.equal(shown.app, 'hidden'); assert.deepEqual(shown.legacy, [false, false])
    const layout = await page.evaluate(() => videos.at(-1))
    assert.equal(layout.backdrop, 'stage'); assert.deepEqual(layout.views[0].head, CALL_VIDEO_HEAD)
    for (const key of ['x', 'y', 'width', 'height']) near(layout.views[0].rect[key], shown.call[key], 'video box ' + key, 0.002)
    // iOS 26's furniture, in points.
    near(shown.pill.left, 22, 'pill left'); near(shown.pill.top, 60, 'pill top'); near(shown.pill.height, 41, 'pill height')
    near(shown.shutter.width, 36, 'shutter'); near(shown.shutter.top + 18, shown.pill.top + 20.5, 'shutter level with the pill'); assert.equal(shown.shutterBg, 'rgb(255, 255, 255)')
    assert.deepEqual(shown.keys.map(key => [key.id, key.pressed, key.off]), [['ft-camera', 'false', null], ['ft-mic', 'true', null], ['ft-more', null, 'true'], ['ft-end', null, null]])
    for (const key of shown.keys) { near(key.width, 52, key.id + ' 52 pt'); near(key.right, 30, key.id + ' right') }
    for (let i = 1; i < 4; i++) near(shown.keys[i].top - shown.keys[i - 1].top, 66, 'key spacing')
    near(shown.keys[3].bottom, 27, 'end key level with the self view bottom')
    assert.equal(shown.keys[1].bg, 'rgb(255, 255, 255)'); assert.equal(shown.keys[1].color, 'rgb(240, 138, 18)', 'microphone on: white with an orange glyph')
    assert.equal(shown.self.visible, false, 'camera off: nothing at all where the self view would be')
    // The bubbles: hers left, the player's right, newest at the bottom, the pill's glass; above the keys.
    assert.deepEqual(shown.bubbles.map(row => [row.role, row.text]), lines.map(line => [line.role, line.text]))
    near(shown.bubbles[0].left, 19, 'her bubble left'); near(shown.bubbles[1].right, 19, 'player bubble right')
    assert.ok(shown.bubbles.every(row => row.bg === shown.pillBg)); assert.ok(shown.bubbles.at(-1).bottom >= 293)
    assert.equal(shown.text, '辉夜 ' + lines.map(line => line.text).join(' '), 'no status words: her name and what was said')
    await shot('call')
    // Camera on with a figure: the self view bottom left (120 x 255 pt), and the stage is told where.
    await frame.click('#ft-camera'); await page.waitForFunction(() => sent.some(row => row.action === 'camera' && row.on === true))
    await page.evaluate(lines => callState({video:true, camera:true, lines}), lines)
    await page.waitForFunction(() => videos.at(-1)?.views?.length === 2)
    await page.waitForTimeout(200)
    shown = await read()
    near(shown.self.left, 18, 'self left'); near(shown.self.bottom, 27, 'self bottom'); near(shown.self.width, 120, 'self width'); near(shown.self.height, 255, 'self height')
    assert.equal(shown.error, null); assert.equal(shown.keys[0].pressed, 'true'); assert.equal(shown.keys[0].color, 'rgb(43, 200, 74)', 'camera on: white with a green glyph')
    assert.deepEqual((await page.evaluate(() => videos.at(-1))).views[1].head, CALL_VIDEO_SELF)
    await shot('camera')
    // Camera on without a figure: only 「无法打开摄像头」 in that place, and no self view for the stage.
    await page.evaluate(lines => callState({video:true, camera:true, selfFigure:false, lines}), lines)
    await page.waitForFunction(() => videos.at(-1)?.views?.length === 1)
    shown = await read()
    assert.equal(shown.error, '无法打开摄像头'); near(shown.self.width, 120, 'error box in the self view place')
    await shot('no-figure')
    // The shutter asks the stage for the frame; the pill opens her card over the call.
    await frame.click('#ft-shutter'); await page.waitForFunction(() => sent.some(row => row.action === 'snapshot'))
    await frame.click('#ft-name')
    await frame.waitForFunction(() => document.body.dataset.callSheet === 'contact' && getComputedStyle(document.getElementById('phone-app')).visibility === 'visible')
    assert.equal(await frame.evaluate(() => document.getElementById('phone-app').dataset.page), 'detail')
    await frame.click('#call-detail-back'); await frame.waitForFunction(() => !document.body.dataset.callSheet)
    // Hung up: nothing is written; the screen goes and the stage is told to let the picture go.
    await frame.click('#ft-end'); await page.waitForFunction(() => sent.some(row => row.action === 'end'))
    await page.evaluate(lines => callState({status:'ended', video:true, camera:false, lines}), lines)
    await page.waitForTimeout(300)
    shown = await read()
    assert.equal(shown.text.includes('结束'), false)
    await page.evaluate(() => callState({status:'idle', video:false}))
    await page.waitForFunction(() => videos.at(-1) === null)
    await frame.waitForSelector('#call[hidden]', {state:'attached', timeout:3000})
    assert.equal(await frame.evaluate(() => getComputedStyle(document.getElementById('phone')).backgroundColor !== 'rgba(0, 0, 0, 0)'), true, 'the phone is itself again')
    // A second FaceTime call dialled straight away (her card's 视频 key) covers the app again and the stage is told where to draw her.
    await page.evaluate(() => callState({status:'connecting', connected:false, elapsed:0, video:true, camera:false, lines:[]}))
    await frame.waitForSelector('#call:not([hidden])')
    await page.waitForFunction(() => videos.at(-1)?.views?.length === 1)
    // Nothing of the app it was dialled from (here its 通读录 page, which sets its own visibility) is painted under her video.
    assert.deepEqual(await frame.evaluate(() => {
      const seen = element => { for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) === 0) return false; return getComputedStyle(element).visibility === 'visible' && element.getClientRects().length > 0 }
      return [document.body.dataset.callVideo, getComputedStyle(document.getElementById('phone')).backgroundColor, document.getElementById('ft').hidden,
        [...document.querySelectorAll('#home-screen, .app, .app *')].filter(element => !element.closest('[hidden]') && seen(element)).map(element => element.id || element.className)]
    }), ['true', 'rgba(0, 0, 0, 0)', false, []], size.name + ': the second FaceTime call covers the 电话 app')
    await shot('second-call')
    await page.evaluate(() => callState({status:'idle', video:false}))
    await page.waitForFunction(() => videos.at(-1) === null)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
const CALL_VIDEO_HEAD = CALL_VIDEO.remote.head, CALL_VIDEO_SELF = CALL_VIDEO.self.head