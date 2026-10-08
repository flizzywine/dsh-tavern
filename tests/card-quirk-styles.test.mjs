import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

let descriptor
vm.runInNewContext(await assembleTavernClient(), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))

const daoyuanGreeting = `<div class="info-card" id="info-card"><span class="journey-link" onclick="switchToSecondGreeting()">点击这里</span></div>
<script>const card = document.getElementById('info-card');
card.addEventListener('mousemove', () => { card.style.transform = \`perspective(1000px) rotateX(\${rotateX}deg) rotateY(\${rotateY}deg)\`; });</script>`

test('《道渊》开场白的鼠标倾斜被压掉', () => {
  const html = client.buildTavernFrameDocument({ token: 't', content: daoyuanGreeting, runtimeReporting: false })
  assert.match(html, /<style data-dsh-tavern-card-quirk>#info-card\{transform:none!important\}<\/style><\/head>/)
})

test('其他卡不受影响', () => {
  const html = client.buildTavernFrameDocument({ token: 't', content: '<div id="info-card">hi</div>', runtimeReporting: false })
  assert.doesNotMatch(html, /data-dsh-tavern-card-quirk/)
})
