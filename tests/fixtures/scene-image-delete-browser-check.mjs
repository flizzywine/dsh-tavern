import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Run against a fresh scene-image-browser-smoke.mjs fixture server.
if (!process.argv[2]) throw new Error('Expected the local fixture URL');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]);
 await page.waitForFunction(()=>!document.querySelector('[aria-label="开启场景生图"]')?.disabled);
 if(!await page.getByRole('switch',{name:'开启场景生图'}).isChecked()) await page.getByText('开启场景生图',{exact:true}).click();
 await page.getByRole('button',{name:'为这一轮生成插图',exact:true}).click();
 await page.getByRole('button',{name:'删除图片',exact:true}).waitFor({timeout:60000});
 await page.locator('.dsh-tavern-illustration img').evaluate(img=>img.decode());
 const original=await page.locator('.dsh-tavern-illustration img').getAttribute('src');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'删除图片',exact:true}).click();
 assert.equal(await page.locator('.dsh-tavern-illustration img').getAttribute('src'),original);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除图片',exact:true}).click();
 await page.getByRole('button',{name:'重新生图',exact:true}).waitFor();
 assert.equal(await page.locator('.dsh-tavern-illustration img').count(),0);
 await page.reload();await page.getByRole('button',{name:'重新生图',exact:true}).click();
 await page.getByRole('button',{name:'删除图片',exact:true}).waitFor({timeout:60000});
 await page.locator('.dsh-tavern-illustration img').evaluate(img=>img.decode());
 assert.notEqual(await page.locator('.dsh-tavern-illustration img').getAttribute('src'),original);
 const evidence=await page.evaluate(async()=>await (await fetch('/api/dsh-tavern/fixtureEvidence',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json());
 assert.equal(evidence.imageRequests,2);assert.equal(evidence.status.versions.length,1);assert.deepEqual(errors,[]);
 if (process.env.SCENE_DELETE_SCREENSHOT) await page.screenshot({path:process.env.SCENE_DELETE_SCREENSHOT});
 console.log(JSON.stringify({result:'PASS',imageRequests:evidence.imageRequests,versions:evidence.status.versions.length,errors}));
}finally{await browser.close()}
