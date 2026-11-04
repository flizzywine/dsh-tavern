import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const source = await readFile(new URL('../tavern-plugin/src/client/features/message-deletion.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

test('Chromium：/delete 进入选择模式，用户与 AI 跨轮多选后批量删除', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(5000)
  await page.setContent('<main id="root"></main>')
  await page.addStyleTag({ content: styles + '\n:root { --dsw-alias-brand-primary: #6b5ce7; }' })
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    const React=modules.react;
    const calls=[],views=[],notifications=[],invalidated=[];
    async function rpc(method,args,sessionId){calls.push({method,args,sessionId});return {view:{chatId:'chat',deleted:args.items.length},deletedCount:args.items.length};}
    const liveTavernView={setView:(sessionId,view)=>views.push({sessionId,view})};
    const notifyTavernDataChanged=(...args)=>notifications.push(args);
    const tavernCoordination={invalidate:id=>invalidated.push(id)};
    const askTavernConfirm=async()=>true;
    ${source}
    const feature=createTavernMessageDeletionFeatureModule();
    const ctx={commandUi:{register(value){window.deleteCommand=value;return()=>{};}},effect(fn){return fn();}};
    const slots={inject(_name,fn){return fn();},register(){return()=>{};}};
    feature.register({ctx,slots});
    const user=feature.userSelector(2,{seq:4});
    const assistant=feature.assistantSelector(7,3,{finalNode:{seq:9,messageId:'reply-3'}});
    function View(){return React.createElement(React.Fragment,null,
      React.createElement('div',{className:'dsh-tavern-user-row'},React.createElement(feature.Checkbox,{sessionId:'game',selector:user})),
      React.createElement('div',{className:'dsh-tavern-assistant'},React.createElement(feature.Checkbox,{sessionId:'game',selector:assistant})),
      React.createElement(feature.Dock,{sessionId:'game'}));}
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(View));
    window.fixture={calls,views,notifications,invalidated};
  ` })
  await page.evaluate(() => deleteCommand.ui.run({ sessionId: 'game' }))
  await page.getByLabel('选择这条用户输入').check()
  await page.getByLabel('选择这条 AI 输出').check()
  await page.waitForTimeout(100)
  const highlighted = await page.evaluate(() => [...document.querySelectorAll('.dsh-tavern-user-row,.dsh-tavern-assistant')].map(node => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, shadow: style.boxShadow }
  }))
  assert.equal(highlighted.length, 2)
  for (const style of highlighted) {
    assert.notEqual(style.shadow, 'none', '选中楼层必须有明显描边')
    assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(style.background), '选中楼层必须有明显底色')
  }
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForFunction(() => fixture.calls.length === 1)
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-message-deletion-dock'))
  const result = await page.evaluate(() => ({ calls: fixture.calls, views: fixture.views, notifications: fixture.notifications, invalidated: fixture.invalidated }))
  assert.equal(result.calls[0].method, 'deleteMessages')
  assert.equal(result.calls[0].sessionId, 'game')
  assert.deepEqual(result.calls[0].args.items, [
    { role: 'user', turn: 2, seq: 4 },
    { role: 'assistant', turn: 7, storyTurn: 3, seq: 9, messageId: 'reply-3' }
  ])
  assert.equal(result.views.length, 1)
  assert.equal(result.notifications.length, 1)
  assert.deepEqual(result.invalidated, ['game'])
  await page.evaluate(() => deleteCommand.ui.run({ sessionId: 'game' }))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-message-deletion-dock'))
  assert.deepEqual(errors, [])
})
