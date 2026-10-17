import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

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

test('component unmount and session change cancel pending work; old handlers stay invalid',async()=>{
 for(const kind of ['unmount','session']){
  const h=harness(),ask=h.render('A'),pending=ask('delete A?');
  if(kind==='unmount')h.unmount();else h.render('B');
  assert.equal(await pending,false);assert.equal(h.dialog(),undefined);assert.equal(await ask('stale'),false);
 }
})
