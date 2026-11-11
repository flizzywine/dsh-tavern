// 玻璃皮肤（dream skin 的深色皮肤）下宿主设置窗口不透视、原生下拉的选项看得清。
// 皮肤把上浮层 token 做成 rgba(…, .85)、输入框底色做成 rgba(255,255,255,.08)：设置窗口曾透出后面的正文，
// 下拉的弹出列表落回白底而选项继承了浅色字。
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const MIDNIGHT='color-scheme: dark; --dsw-alias-bg-base: rgba(11, 11, 14, 0.45); --dsw-alias-bg-layer-1: #17171f; --dsw-alias-bg-layer-2: rgba(22, 22, 28, 0.85); --dsw-specific-input-major: rgba(255, 255, 255, 0.08); --dsw-alias-label-primary: #f2f2f6;'
const HOST='.wCInkW_overlay{position:fixed;inset:0;display:flex}.wCInkW_panel{background:var(--dsw-alias-bg-layer-2)}.wCInkW_panel select{background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary)}'

function luminance(rgb){
  const [r,g,b]=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4})
  return .2126*r+.7152*g+.0722*b
}
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)}
const opaque=color=>/^rgb\(/.test(color)

test('a glass skin leaves the host settings window opaque and native select options readable',async t=>{
  const css=await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css',import.meta.url),'utf8')+'\n'+await readFile(new URL('../tavern-plugin/lib/client-assets/theme.css',import.meta.url),'utf8')
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const page=await browser.newPage()
  await page.setContent(`<!doctype html><html style="color-scheme: dark"><body class="dsh-tavern-shell-active" data-ds-dark-theme style="${MIDNIGHT}">
    <p>窗口后面的正文</p>
    <div class="wCInkW_overlay"><div class="wCInkW_panel" role="dialog" aria-modal="true" aria-label="设置"><nav class="wCInkW_nav"><button type="button">配图</button></nav>
      <div class="wCInkW_content"><select aria-label="服务商"><option>OpenAI / Images 兼容中转</option><option>NovelAI</option><optgroup label="其他"><option>自定义</option></optgroup></select></div></div></div>
  </body></html>`)
  await page.addStyleTag({content:css+'\n'+HOST})
  const panel=await page.getByRole('dialog',{name:'设置'}).evaluate(node=>{const c=getComputedStyle(node);return {color:c.backgroundColor,image:c.backgroundImage}})
  assert.ok(opaque(panel.color),`设置窗口的底是不透明的系统底色：${panel.color}`)
  assert.match(panel.image,/rgba\(22, 22, 28, 0\.85\)/,'皮肤的上浮层色调叠在不透明底上')
  for(const name of ['NovelAI','自定义']){
    const option=await page.locator('option',{hasText:name}).evaluate(node=>{const c=getComputedStyle(node);return {bg:c.backgroundColor,fg:c.color}})
    assert.ok(opaque(option.bg),`「${name}」的底不透明：${option.bg}`)
    assert.ok(contrast(option.bg,option.fg)>=4.5,`「${name}」的字和底对比度 ≥ 4.5：${option.fg} / ${option.bg}`)
  }
})
