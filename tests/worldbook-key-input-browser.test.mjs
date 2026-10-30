import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
import {chromium} from 'playwright'
import { sourceFunction } from './fixtures/source-function.mjs'
const require=createRequire(import.meta.url)
test('世界书触发词输入框能在末尾输入中英文逗号并继续添加下一个词（#425）',async()=>{
 let script='const modules={};\n'
 for(const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
  script+=`modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')}\nreturn module.exports;})();\n`
 }
 const source=await readFile(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8')
 script+=`const React=modules.react;const h=React.createElement;window.keys=['港口'];
 ${sourceFunction(source,'WorldBookKeyInput')}
 function Host(){const [keys,setKeys]=React.useState(window.keys);return h(WorldBookKeyInput,{value:keys,placeholder:'逗号分隔',onChange:next=>{window.keys=next;setKeys(next)}})}
 modules['react-dom/client'].createRoot(document.querySelector('main')).render(h(Host));`
 const browser=await chromium.launch({headless:true})
 try {
  const page=await browser.newPage();page.on('pageerror', error => { throw error });await page.setContent('<main></main>');await page.addScriptTag({content:script})
  const input=page.getByPlaceholder('逗号分隔')
  await input.waitFor()
  assert.equal(await input.inputValue(),'港口')
  await input.press('End');await input.pressSequentially(', 码头，')
  assert.equal(await input.inputValue(),'港口, 码头，')
  await input.pressSequentially('灯塔')
  assert.deepEqual(await page.evaluate(()=>window.keys),['港口','码头','灯塔'])
  await input.fill('');await input.evaluate(el=>el.focus());await page.keyboard.insertText('甲,乙,')
  assert.equal(await input.inputValue(),'甲,乙,')
  assert.deepEqual(await page.evaluate(()=>window.keys),['甲','乙'])
 } finally {await browser.close()}
})
