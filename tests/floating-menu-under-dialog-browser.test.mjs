// A floating menu (z-index 10010) left open when a confirmation opens from it (a paid ▶ in a voice pick) must not cover the
// confirmation: its buttons stay the top element at their centre. Layers are separate `.ap-layer` portals in <body>.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

test('a menu left open under a confirmation does not cover its buttons',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.setContent('<!doctype html><body style="margin:0"></body>')
  await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/theme.css',import.meta.url),'utf8')})
  await page.evaluate(()=>{
    document.body.insertAdjacentHTML('beforeend','<div class="ap-ui ap-layer"><div class="ap-popover-anchor is-floating"><div class="ap-popover is-floating" style="left:400px;top:300px;width:340px;height:320px">menu</div></div></div>'
      +'<div class="ap-ui ap-layer"><div class="ap-modal-scrim"><div class="ap-modal ap-confirm" role="dialog" aria-label="确认"><button id="ok">确认</button><button id="no">取消</button></div></div></div>')
  })
  const covered=await page.evaluate(()=>['ok','no'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return !b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}))
  assert.deepEqual(covered,[false,false])
})