import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const client = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const host = await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const cssStrings = [...host.matchAll(/const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");/g)].map(m => JSON.parse(m[1]))
const hostCss = cssStrings.find(css => css.includes('_composerSeat{'))
if (!hostCss) throw Error('宿主会话布局已变化，请更新移动端 fixture')
const prefix = hostCss.match(/\.([\w]+)_root\{/)[1]
const cssOf = source => [...source.matchAll(/const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");/g)].map(m => JSON.parse(m[1]))
// DSH 0.2.x 的外壳、右栏和 dockkit 均来自宿主核心包；手机布局不再有 dsh-web-mobile 的 mobile-nav 标记。
const layoutCss = cssOf(await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-ui-layout/client'), 'utf8')).find(css => /_frame\{/.test(css) && css.includes('_rightbarCol'))
if (!layoutCss) throw Error('宿主外壳布局已变化，请更新移动端 fixture')
const layoutPrefix = layoutCss.match(/\.([\w]+)_frame\{/)[1]
const sidebar = await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-ui-sidebar-right/client'), 'utf8')
const sidebarCss = cssOf(sidebar).join('\n')
const panelPrefix = sidebarCss.match(/\.([\w]+)_panel\{/)[1]
// dockkit 打包进了 web 前端的样式表，类名是 CSS Modules 哈希；按真实类名取出它的规则。
const frontendAssets = new URL('./dist/assets/', pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')))
const frontendCss = (await Promise.all((await readdir(frontendAssets)).filter(name => /^index-.*\.css$/.test(name)).map(name => readFile(new URL(name, frontendAssets), 'utf8')))).join('\n')
const dockHash = frontendCss.match(/\._tabHost_(\w+?)_\d+\{/)?.[1]
if (!dockHash) throw Error('宿主 dockkit 样式已变化，请更新移动端 fixture')
const dock = Object.fromEntries([...frontendCss.matchAll(new RegExp('\\._(\\w+?)_' + dockHash + '_(\\d+)', 'g'))].map(m => [m[1], `_${m[1]}_${dockHash}_${m[2]}`]))
const dockCss = frontendCss.match(new RegExp('[^{}]*_' + dockHash + '_[^{}]*\\{[^{}]*\\}', 'g')).join('\n')
const css = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const viewportCode = client.slice(client.indexOf('function composerOffsetPx('), client.indexOf('function nativeFullscreenElement('))
const questionCode = client.slice(client.indexOf('function CandidateQuestion(props)'), client.indexOf('function CandidateGuidePanel(props)'))
const statsCode = client.slice(client.indexOf('function MobileComposerStatsToggle('), client.indexOf('function CandidateDockActions('))
// DSH 0.2.x 把 React 打进前端包，夹具改用仓库自己的同版本 React。
const reactDomFile = createRequire(import.meta.url).resolve('react-dom/client')
const reactRequire = createRequire(reactDomFile)
const reactFile = reactRequire.resolve('react')
const modules = new Map()
async function bundle(file) {
  if (modules.has(file)) return
  modules.set(file, '')
  let source = await readFile(file, 'utf8')
  const local = createRequire(file)
  for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    const target = match[1] === 'react' ? reactFile : local.resolve(match[1])
    await bundle(target)
    source = source.replaceAll(match[0], `require(${JSON.stringify(target)})`)
  }
  modules.set(file, `function(module,exports,require){${source}\n}`)
}
await bundle(reactFile)
await bundle(reactDomFile)
const libraries = `const process={env:{NODE_ENV:'production'}},modules={${[...modules].map(([name, code]) => `${JSON.stringify(name)}:${code}`).join(',')}},cache={};
function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}
const React=require(${JSON.stringify(reactFile)}),ReactDOM=require(${JSON.stringify(reactDomFile)});`
const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'

// 使用已安装宿主（DSH 0.2.x 核心，不含 dsh-pocket 等用户插件）的真实样式与 DOM 合约；数据只在本页内存中。
// 插槽虽为 display:contents，仍保留真实 DOM 包装，防止选择器在夹具中通过、在线上失效。
// 候选挂载点同样不占布局空间；多出一个空块会产生虚假的 gap，掩盖输入卡上描边被裁切的问题。
export const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{--dsw-alias-bg-base:#faf9f7;--dsw-specific-sidebar-fill:#fff;--dsw-specific-input-major:#f5f3ef;--dsw-alias-label-primary:#262421;--dsw-alias-label-secondary:#746e65;--dsw-alias-label-tertiary:#938b80;--dsw-alias-border-l2:#dfd9d0;--dsw-alias-border-l3:#eee7df;--dsw-alias-button-info-fill:#9a622f;--dsw-specific-bubble:#eee7db}html,body{height:100%;margin:0;font:14px/1.5 system-ui}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}#history{padding:16px;min-height:900px}#input{margin:4px 8px 8px;padding:8px;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2)}#input textarea{box-sizing:border-box;width:100%;height:48px;resize:none;background:transparent;border:0}#input footer{display:flex;align-items:center;justify-content:space-between}#input footer button{min-height:36px}#drawer{display:flex;flex-direction:column;align-items:center;padding-top:8px}#drawer button{width:40px;height:40px}#content{overflow:auto;min-height:0;flex:1;padding:12px}.page-sample{padding:12px}.dsh-tavern-export-menu{position:relative}</style>
<style>${layoutCss}\n${hostCss}\n${sidebarCss}\n${dockCss}</style><style>[data-mobile-nav="frame"] [data-phase] header:has([class*="_headerLeading"]) [class*="_headerUtilities"] { display: none !important; } [data-mobile-nav="frame"] [data-phase] header:has([class*="_headerLeading"]) [class*="${prefix}_titleRow"] > [class*="${prefix}_headerCorner"] { display: none !important; }</style><style>${css}</style></head><body class="dsh-tavern-shell-active">
<div data-slot="root" style="display:contents"><div id="frame" class="${layoutPrefix}_frame" data-mobile-nav="frame" data-sidebar-collapsed data-rightbar-collapsed style="grid-template-columns:56px minmax(0px,1fr) minmax(0px,0px)">
<div class="${layoutPrefix}_sidebarCol"><div data-slot="sidebar" style="display:contents"><aside id="drawer"><button class="sidebar_toggle" aria-label="打开侧栏">${icon}</button><div class="dsh-tavern-sidebar collapsed"><button class="dsh-tavern-side-icon" title="新建对话">＋</button></div></aside></div></div>
<div id="center" class="${layoutPrefix}_centerCol" data-dsh-center-col><div data-slot="main" style="display:contents"><div data-slot="main.conversation" style="display:contents">
<div class="${prefix}_root" data-phase="active"><div data-slot="conversation.header" style="display:contents"><header class="${prefix}_header"><div class="${prefix}_headerLeading" data-conversation-header-leading><div data-slot="conversation.header.leading" style="display:contents"></div></div><div data-slot="conversation.session.header" style="display:contents"><div class="${prefix}_titleRow"><div class="${prefix}_titleCluster"><nav class="${prefix}_crumbs"><span class="${prefix}_crumbSeg"><span class="${prefix}_crumb ${prefix}_crumbCurrent">星海旅途 · 很长的会话名称也应该保留省略</span></span></nav><div class="${prefix}_headerActions"><div data-slot="conversation.session.header.actions" style="display:contents"><button data-mobile-nav="toggle" aria-label="打开侧栏" style="width:28px;height:28px">${icon}</button><button data-mobile-nav="files" aria-label="文件" style="width:28px;height:28px">${icon}</button><button class="dsh-tavern-btn dsh-tavern-play-fullscreen" aria-label="全屏">${icon}</button></div></div></div><div class="${prefix}_headerUtilities"><div data-slot="conversation.session.header.utilities" style="display:contents"><div class="dsh-tavern-header-items"><span class="dsh-tavern-header-item" data-header-item="dsh-tavern:status"><button class="dsh-tavern-btn dsh-tavern-header-settings" aria-label="本局设置">${icon}<span class="dsh-tavern-header-action-label">本局设置</span></button></span><span class="dsh-tavern-header-item" data-header-item="header:export"><div class="dsh-tavern-more-actions dsh-tavern-export-menu"><button class="dsh-tavern-export-action" aria-label="导出">${icon}<span class="dsh-tavern-header-action-label">导出</span></button></div></span></div></div></div><div class="${prefix}_headerCorner" data-conversation-header-corner><div data-slot="conversation.session.header.corner" style="display:contents"><button data-sidebar-right-expand aria-label="资源面板">${icon}</button></div></div></div><div class="${prefix}_tabs" role="tablist" data-conversation-tabs><button class="${prefix}_tab ${prefix}_tabActive" role="tab">对话</button><button class="${prefix}_tab" role="tab">完整上下文</button></div></div></header></div>
<div class="${prefix}_body" data-conversation-content data-content-phase="active"><div class="${prefix}_scrollBody" data-conversation-scroll><div data-slot="conversation.session" style="display:contents"><div class="${prefix}_viewArea"><div data-slot="conversation.view" style="display:contents"><div id="history"><div class="dsh-tavern-user-row"><div class="dsh-tavern-user-stack"><div class="dsh-tavern-user-bubble">走向旧城区，寻找故事的下一条线索。</div></div></div><article class="dsh-tavern-assistant"><p>雨停了，街道映着远处的灯火。你在书店门口停下脚步。</p><p>柜台后的人抬起头，将一封信推到你面前。「有人让我把这个交给你。」</p></article></div></div></div></div><div class="${prefix}_composerSeat" data-composer-seat><div data-slot="conversation.composer" style="display:contents"><div class="${prefix}_composerStack"><div data-slot="conversation.input.dock" style="display:contents"><div id="candidate" style="display:contents"></div><div class="dsh-tavern-dock-actions"><button class="dsh-tavern-choice-trigger">生成候选项</button><button class="dsh-tavern-btn">更多操作</button><span id="mobile-stats-toggle" style="display:contents"></span></div></div><div data-slot="conversation.composer.bar" style="display:contents"><div id="input" data-composer-card><textarea aria-label="消息" placeholder="输入你的行动…"></textarea><footer><span>故事模式</span><button aria-label="发送">发送</button></footer></div></div></div></div></div></div></div></div></div></div></div>
<div class="${layoutPrefix}_rightbarCol" data-rightbar-col><div data-slot="rightbar" style="display:contents"><div class="${panelPrefix}_session"><div data-slot="rightbar.session" style="display:contents"><div class="${panelPrefix}_panel" data-sidebar-right-panel="fullscreen" style="width:100vw;--dsh-sidebar-width:100vw"><div class="${panelPrefix}_panelBody"><div class="${dock.surface}" data-dockkit-surface><div class="${dock.tabLayout}" style="grid-template-columns:minmax(0px,1fr)"><div class="${dock.tabCell}" data-dockkit-host="dock" data-dockkit-column="0"><section class="${dock.tabHost} ${dock.pane}" data-dockkit-pane="main" data-dockkit-pane-active="true"><div class="${dock.tabHostHeader}"><div class="${dock.tabStrip}" role="tablist" data-dockkit-strip="main"><div class="${dock.stripTabs}" data-dockkit-strip-tabs="main"><div class="${dock.tab} ${dock.tabActive}" role="tab" aria-selected="true" data-dockkit-tab="settings"><span class="${dock.tabTitle}" data-dockkit-tab-title>本局设置</span><button class="${dock.tabClose}" data-dockkit-tab-close="settings" aria-label="关闭标签">×</button></div></div><button class="${dock.addTab}" data-dockkit-add-tab="main" aria-label="新建标签页">+</button><div class="${dock.stripFill}" data-dockkit-strip-fill></div><div class="${dock.stripChrome}" data-dockkit-strip-chrome><button class="${panelPrefix}_iconButton" data-sidebar-right-mode="push" aria-label="面板显示方式">${icon}</button><button class="${panelPrefix}_iconButton" data-sidebar-right-toggle aria-label="折叠资源面板">${icon}</button></div></div></div><div class="${dock.tabHostBody} ${dock.paneBody}"><div id="content"></div></div></section></div></div></div></div></div></div></div></div></div>
<div class="${layoutPrefix}_bottomRow" data-shell-bottom><div data-slot="shell.bottom" style="display:contents"></div></div><div class="${layoutPrefix}_overlayLayer" data-shell-overlay><div data-slot="shell.overlay" style="display:contents"></div></div>
</div></div>
</body></html>`

export async function install(page) {
  await page.goto('about:blank')
  await page.setContent(html)
  await page.addScriptTag({ content: libraries + `
${viewportCode}
window.releaseViewport=installVisualViewportPin(document);
let panel={sessionId:'fixture',messageId:'m',phase:'ready',expanded:true,choices:Array.from({length:12},(_,i)=>({type:i%2?'scene':'action',text:'候选 '+(i+1)+'：推开书店的门，向柜台后的陌生人询问信封的来历。'}))};
const listeners=new Set(); const useCandidatePanel=()=>React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>panel);
const setCandidatePanel=p=>{panel=p;listeners.forEach(fn=>fn())},useCandidatePreferences=()=> 'after-send',useTavernSessionMode=()=> 'story',isPlayMode=()=>true,latestTavernAssistantMessageId=()=> 'm',usePhonePlay=()=>false;
${questionCode}
${statsCode}
// 草稿既可能在夹具的 textarea，也可能在 nativeComposer 换上的宿主 contenteditable 里。
const draftField=()=>document.querySelector('textarea')||document.querySelector('[contenteditable]');
const readDraft=()=>{const field=draftField();return field?(field.tagName==='TEXTAREA'?field.value:field.innerText):''};
const writeDraft=value=>{const field=draftField();if(field.tagName==='TEXTAREA')field.value=value;else field.innerText=value};
window.mountCandidate=()=>ReactDOM.createRoot(document.getElementById('candidate')).render(React.createElement(CandidateQuestion,{sessionId:'fixture',useInput:fn=>fn({draft:readDraft()}),useSession:fn=>fn({running:false}),useChat:()=> 'm',inputActions:{setDraft:writeDraft}}));
window.mountCandidate();
window.mountStats=()=>ReactDOM.createRoot(document.getElementById('mobile-stats-toggle')).render(React.createElement(MobileComposerStatsToggle));
window.mountStats();
// 与宿主一致：右栏开合同时切换面板和外壳上的标记。
const frame=document.getElementById('frame'),rightPanel=document.querySelector('[data-sidebar-right-panel]');
const setRight=open=>{rightPanel.toggleAttribute('data-sidebar-right-open',open);frame.toggleAttribute('data-rightbar-collapsed',!open);frame.toggleAttribute('data-rightbar-fullscreen',open)};
document.querySelector('[aria-label="打开侧栏"]').onclick=()=>frame.toggleAttribute('data-sidebar-collapsed');
document.querySelector('[aria-label="资源面板"]').onclick=()=>setRight(!rightPanel.hasAttribute('data-sidebar-right-open'));
document.querySelector('[data-sidebar-right-toggle]').onclick=()=>setRight(false);
document.querySelector('[aria-label="本局设置"]').onclick=()=>setRight(true);
` })
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-question-option'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

export async function viewport(page, values) {
  await page.evaluate(values => {
    if (!window.testViewport) {
      window.releaseViewport()
      window.testViewport = new EventTarget()
      Object.assign(window.testViewport, { height: innerHeight, width: innerWidth, offsetTop: 0, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: window.testViewport })
      window.releaseViewport = installVisualViewportPin(document)
    }
    Object.assign(window.testViewport, values)
    window.testViewport.dispatchEvent(new Event('resize'))
  }, values)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

// 补充宿主真实 InputBar 样式和 contenteditable 合约，避免仅测 textarea 漏掉实际输入器。
export async function nativeComposer(page) {
  const inputCss = cssStrings.find(css => css.includes('_primary{') && css.includes('_overlayAnchor{'))
  if (!inputCss) throw Error('宿主 InputBar 合约已变化')
  const key = inputCss.match(/\.([\w]+)_card\{/)[1]
  await page.addStyleTag({ content: inputCss })
  await page.locator('#input').evaluate((element, key) => {
    element.removeAttribute('id'); element.className = key + '_card'
    element.innerHTML = `<div class="${key}_scroll"><div class="${key}_grow"><div class="${key}_input" data-composer-input contenteditable="true" role="textbox" aria-label="消息"><p>未发送的草稿</p></div></div></div><div class="${key}_row"><div class="${key}_tools"><button class="${key}_add" aria-label="指令">+</button><div class="${key}_modes"><button class="permission_trigger" aria-label="权限">◇</button></div></div><div class="${key}_trailing"><div><div class="model_root"><button class="model_trigger" aria-label="选择模型"><span class="model_triggerLabel">一个名称很长很长的模型提供商和模型</span><span class="model_triggerEffort">High</span></button></div></div><span><button class="context_trigger" aria-label="上下文">○</button></span><button class="${key}_primary" aria-label="发送">↑</button></div></div>`
  }, key)
  // 宿主 InputBar 在输入卡之后渲染 dock：先放酒馆插槽，再放原生上下文计量，移动端只折叠前者。
  await page.locator('[data-composer-seat]').evaluate((seat, key) => {
    if (seat.querySelector('[data-slot="conversation.composer.dock"]')) return
    const dock = document.createElement('div')
    dock.className = key + '_dock'
    dock.setAttribute('data-composer-dock', '')
    dock.innerHTML = '<div data-slot="conversation.composer.dock"><span class="fixture-pill">72 轮 · 82 步</span><span class="fixture-pill">843K</span><span class="fixture-pill">缓存 92%</span></div><span class="fixture-pill">上下文 17%</span>'
    seat.append(dock)
  }, key)
  await page.addStyleTag({ content: '.model_trigger{display:flex;align-items:center;height:28px}.permission_trigger,.context_trigger{height:28px;width:28px}.model_triggerLabel{font-size:13px}[data-composer-dock]{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:4px 12px}.fixture-pill{font-size:11.5px;color:#746e65}' })
}

export async function mountClientAudit(page) {
  const organization = await readFile(new URL('../../tavern-plugin/src/client/card-organization.js', import.meta.url), 'utf8')
  await page.addScriptTag({ content: `
    const useTavernConfirm=()=>async()=>false, notifyTavernDataChanged=()=>{};
    const rpc=async method=>method==='getCardOrganization'?{groups:Array.from({length:16},(_,i)=>'测试分组 '+i)}:{};
    ${organization}
    const testCard={name:'测试人物卡',path:'test-card.json',group:''}, testCards=[testCard];
    function OrganizationAudit(){const organization=useCardOrganization(testCards,false,()=>{},()=>{}, {managing:false});return React.createElement('div',{className:'dsh-tavern-library'},organization.toolbar(),organization.rowMenu(testCard));}
    const auditRoot=document.createElement('div');auditRoot.id='audit-root';document.body.append(auditRoot);
    Object.assign(auditRoot.style,{position:'fixed',top:'70px',left:'8px',right:'8px',zIndex:100});
    window.auditReactRoot=ReactDOM.createRoot(auditRoot);
    window.auditReactRoot.render(React.createElement(OrganizationAudit));
  ` })
  await page.locator('.dsh-tavern-group-picker').waitFor()
}

export async function nativeSettings(page) {
  const source = await readFile(hostRequire.resolve('@deepseek-ai/dsh-client-ui-settings-general/client'), 'utf8')
  const styles = [...source.matchAll(/const css(?:\$\d+)? = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1]))
  const settingsCss = styles.find(css => css.includes('_navList{') && css.includes('_panel{'))
  if (!settingsCss) throw Error('宿主设置面板合约已变化')
  const key = settingsCss.match(/\.([\w-]+)_panel\{/)[1]
  await page.addStyleTag({ content: settingsCss })
  await page.evaluate(key => {
    const overlay = document.createElement('div'); overlay.className = key + '_overlay'
    overlay.innerHTML = `<div class="${key}_backdrop"></div><section class="${key}_panel" role="dialog" aria-modal="true"><nav class="${key}_nav"><div>设置</div><div class="${key}_navList"><button>通用设置</button><button>模型</button><button>DSH Tavern</button></div><div class="${key}_header"><button class="${key}_close">关闭</button></div></nav><div class="${key}_content"><div class="${key}_body"><input aria-label="筛选设置"><div style="height:1200px">设置内容</div></div></div></section>`
    document.body.append(overlay)
  }, key)
}
