import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
const moduleSource = await readFile(new URL('../tavern-plugin/src/client/modules/confirm-dialog.js', import.meta.url), 'utf8')
function harness() {
  const doc = { activeElement: null }, nodes = []
  class Node extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.children = []; this.style = {}; this.isConnected = false; nodes.push(this) }
    setAttribute() {}
    append(...children) { this.children.push(...children); children.forEach(node => { node.isConnected = true }) }
    focus() { doc.activeElement = this }
    showModal() { this.open = true }
    close() { this.open = false; this.dispatchEvent(new Event('close')) }
    remove() { this.isConnected = false }
    click() { this.dispatchEvent(new Event('click')) }
  }
  doc.createElement = tag => new Node(tag); doc.body = new Node('body')
  const opener = new Node('button'); opener.isConnected = true; opener.focus()
  let ref, cleanup, effectScope, pendingEffect
  const React = {
    useRef(initial) { return ref ||= { current: initial } },
    useLayoutEffect(effect, [scope]) {
      if (!cleanup || effectScope !== scope) pendingEffect = () => { cleanup?.(); cleanup = effect(); effectScope = scope }
    }
  }
  const win = new EventTarget()
  const api = vm.runInNewContext(moduleSource + ';({askTavernConfirm,useTavernConfirm})', {document:doc,window:win,AbortController,React})
  return { ...api, doc, win, opener,
    dialog:()=>nodes.findLast(n=>n.tagName==='dialog'&&n.isConnected),
    button:text=>nodes.findLast(n=>n.tagName==='button'&&n.textContent===text),
    render(scope) { const ask=api.useTavernConfirm(scope); pendingEffect?.(); pendingEffect=null; return ask },
    unmount() { cleanup?.() }
  }
}
test('confirmation is explicit; default focus is cancel; cleanup restores opener',async()=>{
 const h=harness(), pending=h.askTavernConfirm('<img>\n保留换行');
 assert.equal(h.doc.activeElement,h.button('取消'));
 assert.equal(h.dialog().children[0].children[1].textContent,'<img>\n保留换行');
 h.button('确认').click();assert.equal(await pending,true);assert.equal(h.dialog(),undefined);assert.equal(h.doc.activeElement,h.opener);
})
test('cancel, Escape, backdrop, external close and navigation all resolve false',async()=>{
 for(const reason of ['cancel','escape','backdrop','close','navigation']){
  const h=harness(), pending=h.askTavernConfirm('删除？');
  if(reason==='cancel')h.button('取消').click();
  if(reason==='escape')h.dialog().dispatchEvent(new Event('cancel',{cancelable:true}));
  if(reason==='backdrop')h.dialog().click();
  if(reason==='close')h.dialog().close();
  if(reason==='navigation')h.win.dispatchEvent(new Event('popstate'));
  assert.equal(await pending,false,reason);assert.equal(h.dialog(),undefined);
 }
})
test('concurrent or already aborted requests never approve or stack dialogs',async()=>{
 const h=harness(),first=h.askTavernConfirm('first');assert.equal(await h.askTavernConfirm('second'),false);
 h.button('取消').click();await first;
 const controller=new AbortController();controller.abort();assert.equal(await h.askTavernConfirm('third',{signal:controller.signal}),false);assert.equal(h.dialog(),undefined);
})
test('component unmount and session change cancel pending work; old handlers stay invalid',async()=>{
 for(const kind of ['unmount','session']){
  const h=harness(),ask=h.render('A'),pending=ask('delete A?');
  if(kind==='unmount')h.unmount();else h.render('B');
  assert.equal(await pending,false);assert.equal(h.dialog(),undefined);assert.equal(await ask('stale'),false);
 }
})

test('product client forbids native dialogs and awaits every confirmation result',async()=>{
 const source=await readFile(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8');
 const ast=parse(source,{ecmaVersion:'latest'});let confirmations=0;
 function walk(node,parent){
  if(!node?.type)return;
  if(node.type==='CallExpression'){
   const callee=node.callee;
   const name=callee.type==='Identifier'?callee.name:callee.type==='MemberExpression'?(callee.computed?callee.property.value:callee.property.name):'';
   if(['alert','confirm','prompt'].includes(name) && (callee.type==='Identifier' || ['window','globalThis','self'].includes(callee.object?.name))){
    assert.fail('native dialog: '+source.slice(node.start,node.end).slice(0,90));
   }
   if(['askConfirm','sceneImagePurchaseConfirmation'].includes(name)){
    assert.equal(parent?.type,'AwaitExpression','missing await: '+name);confirmations++;
   }
  }
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(child=>walk(child,node));else if(value?.type)walk(value,node)}
 }
 walk(ast);assert.ok(confirmations > 0, 'must inspect product confirmation calls');
})
