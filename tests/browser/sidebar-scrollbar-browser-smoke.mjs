// Real DOM hit-testing using the installed sidebar's layout and handle rules.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
const base = new URL('../../', import.meta.url)
const sidebar = await readFile(new URL('node_modules/dsh-better-sidebar/src/client/sidebar.module.css', base), 'utf8')
const layout = await readFile(new URL('node_modules/dsh-better-sidebar/src/client/layout.css', base), 'utf8')
const handles = ['panelResize','cornerHandle'].map(name => {
  const rule = sidebar.match(new RegExp('\\.' + name + ' \\{[^}]*\\}'))?.[0]
  if (!rule) throw Error('sidebar handle contract changed: ' + name)
  return rule.replace('.' + name, '.fixture_' + name)
}).join('\n')
const fix = await readFile(new URL('tavern-plugin/lib/client-assets/tavern.css', base), 'utf8')
const html = `<!doctype html><meta charset="utf-8"><title>Sidebar scrollbar boundary</title>
<style>${layout}${handles}
body{margin:0}#root{height:100vh}#conversation{height:100%;overflow-y:scroll}#conversation::-webkit-scrollbar{width:12px}#conversation::-webkit-scrollbar-thumb{background:#888}#long{height:3000px} [data-dsh-panel-host]{position:fixed;inset:0;z-index:25;pointer-events:none} [data-dsh-panel]{position:absolute;right:0;top:0;bottom:0;width:var(--dsh-sidebar-width);background:#ddd;pointer-events:auto}#controls{position:fixed;top:10px;left:10px;z-index:100;background:white} pre{white-space:pre-wrap}</style>
<style id="fix">${fix}</style>
<div id="root"><div id="conversation"><div id="long">长正文</div></div></div>
<div data-dsh-panel-host><div data-dsh-panel><div class="fixture_panelResize"></div><div class="fixture_cornerHandle"></div>剧本库</div></div>
<div id="controls"><button id="run">运行边界检查</button><pre id="result">等待测试</pre></div>
<script>
document.querySelector('#run').onclick=()=>{
 const fix=document.querySelector('#fix'),panel=document.querySelector('[data-dsh-panel]'),scroll=document.querySelector('#conversation');const rows=[];let pass=true;
 for(const width of [280,400,600]){
  document.documentElement.style.setProperty('--dsh-sidebar-width',width+'px');document.body.setAttribute('data-dsh-sidebar-dragging','');
  for(const enabled of [false,true]){
   fix.sheet.disabled=!enabled;
   const edge=panel.getBoundingClientRect().left;
   const target=document.elementFromPoint(edge-2,150);
   const inside=document.elementFromPoint(edge+2,150);
   const corner=document.querySelector('.fixture_cornerHandle').getBoundingClientRect();
   const expected=enabled?target===scroll:target.classList.contains('fixture_panelResize');
   const valid=expected&&inside.classList.contains('fixture_panelResize')&&(!enabled||corner.left>=edge)&&Math.abs(scroll.getBoundingClientRect().right-edge)<1;
   pass=pass&&valid;rows.push((enabled?'修复后':'修复前')+' width='+width+' 正文边缘命中='+target.id+'/'+target.className+' 侧栏内部命中='+inside.className+' '+(valid?'PASS':'FAIL'));
  }
 }
 panel.style.display='none';document.documentElement.style.setProperty('--dsh-sidebar-width','0px');
 const collapsed=Math.abs(scroll.getBoundingClientRect().width-innerWidth)<1;pass=pass&&collapsed;rows.push('收起恢复全宽 '+collapsed);
 panel.style.display='';document.documentElement.style.setProperty('--dsh-sidebar-width','400px');
 document.querySelector('#result').textContent=(pass?'PASS':'FAIL')+'\\n'+rows.join('\\n');
};
</script>`
http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}).listen(8799,'127.0.0.1',()=>console.log('http://127.0.0.1:8799'))
