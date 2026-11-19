import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const moduleSource = await readFile(new URL('../tavern-plugin/src/client/hidden-confirms.js', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../tavern-plugin/src/client/modules/confirm-dialog.js', import.meta.url), 'utf8')
function harness(storage) {
  const doc = { activeElement: null }, nodes = []
  class Node extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.children = []; this.style = {}; this.isConnected = false; nodes.push(this) }
    setAttribute(name, value) { (this.attrs ||= {})[name] = String(value) }
    getAttribute(name) { return this.attrs?.[name] ?? null }
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
  const api = vm.runInNewContext(moduleSource + ';({askTavernConfirm,useTavernConfirm})', {document:doc,window:win,AbortController,React,...(storage?{localStorage:storage}:{})})
  return { ...api, doc, win, opener,
    dialog:()=>nodes.findLast(n=>n.tagName==='dialog'&&n.isConnected),
    button:text=>nodes.findLast(n=>n.tagName==='button'&&n.textContent===text),
    hideBox(){const walk=n=>n?[n,...(n.children||[]).flatMap(walk)]:[];return walk(this.dialog()).find(n=>n.className==='dsh-tavern-prompt-hide')},
    render(scope) { const ask=api.useTavernConfirm(scope); pendingEffect?.(); pendingEffect=null; return ask },
    unmount() { cleanup?.() }
  }
}

test('component unmount and session change cancel pending work; old handlers stay invalid',async()=>{
 for(const kind of ['unmount','session']){
  const h=harness(),ask=h.render('A'),pending=ask('delete A?');
  if(kind==='unmount')h.unmount();else h.render('B');
  assert.equal(await pending,false);assert.equal(h.dialog(),undefined);assert.equal(await ask('stale'),false);
 }
})

// 「以后不再显示」 is kept per kind: ticking it on 删除对话 skips only 删除对话 from then on, never another kind.
test('a ticked 以后不再显示 hides only that kind of confirmation',async()=>{
  const store=new Map(),storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}
  const h=harness(storage)
  const first=h.askTavernConfirm('此操作不可撤销。',{title:'彻底删除对话？',confirmText:'彻底删除',danger:true,hide:'chat'})
  assert.equal(h.dialog().children[0].children[0].textContent,'彻底删除对话？')
  h.hideBox().click();assert.equal(h.hideBox().getAttribute('aria-checked'),'true')
  h.button('彻底删除').click();assert.equal(await first,true);assert.deepEqual(JSON.parse(store.get('dsh-tavern:hidden-confirms')),['chat'])
  assert.equal(await h.askTavernConfirm('此操作不可撤销。',{hide:'chat'}),true);assert.equal(h.dialog(),undefined)
  const other=h.askTavernConfirm('卡会被删除。',{hide:'card'});assert.ok(h.dialog());h.button('取消').click();assert.equal(await other,false)
  assert.deepEqual(JSON.parse(store.get('dsh-tavern:hidden-confirms')),['chat'])
  // a confirmation without a kind never offers the box
  const plain=h.askTavernConfirm('替换？');assert.equal(h.hideBox(),undefined);h.button('取消').click();assert.equal(await plain,false)
})