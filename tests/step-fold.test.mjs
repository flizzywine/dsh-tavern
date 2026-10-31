import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// The module is an @include fragment in the real bundle; load it on its own so this
// presentation-only rule stays testable without the whole client.
const sandbox = {}
runInNewContext(
  readFileSync(new URL('../tavern-plugin/src/client/step-fold.js', import.meta.url), 'utf8')
    + '\nthis.createStepFoldControls = createStepFoldControls;',
  sandbox
)
const createStepFoldControls = sandbox.createStepFoldControls

// A conversation as the host draws it: every round owns one work-step row, a failed
// round also owns an error row plus the action panel the tavern error controls mount.
function conversation(options = {}) {
  const dom = new JSDOM('<!doctype html><body><section id="root"></section></body>')
  const document = dom.window.document
  const root = document.getElementById('root')
  if (options.running) {
    const frame = document.createElement('div')
    frame.setAttribute('data-chat-following-tail', '')
    root.append(frame)
  }
  const steps = {}
  for (const turn of options.turns || [1]) {
    const step = document.createElement('div')
    step.setAttribute('data-chat-flow-kind', 'turn-process')
    step.setAttribute('data-chat-turn', String(turn))
    step.textContent = '已调用工具'
    root.append(step)
    steps[turn] = step
    if (!(options.failing || []).includes(turn)) continue
    const error = document.createElement('div')
    error.setAttribute('data-chat-flow-kind', 'turn-error')
    error.setAttribute('data-chat-turn', String(turn))
    error.textContent = '模型接口报错'
    root.append(error)
    const panel = document.createElement('div')
    panel.className = 'dsh-tavern-error-controls'
    panel.textContent = '隐藏此错误'
    root.append(panel)
  }
  const controls = createStepFoldControls(root, { running: options.running === true })
  controls.apply()
  const hidden = () => [...root.querySelectorAll('[data-chat-flow-kind="turn-process"]')]
    .filter(step => step.hasAttribute('data-tavern-step-fold'))
  const toggles = () => [...root.querySelectorAll('.dsh-tavern-step-fold-toggle')]
  return { dom, root, document, steps, controls, hidden, toggles }
}

test('错误行那排按钮一次展开全部步骤，再点收起', () => {
  const { steps, toggles } = conversation({ turns: [1, 2], failing: [2] })
  assert.equal(toggles().length, 1, '只挂一个入口')
  assert.equal(toggles()[0].textContent, '查看步骤')
  toggles()[0].click()
  assert.equal(steps[1].style.display, '', '展开后全部回来')
  assert.equal(toggles()[0].textContent, '收起步骤')
  toggles()[0].click()
  assert.equal(steps[1].style.display, 'none')
  assert.equal(toggles()[0].textContent, '查看步骤')
})

test('行被宿主重挂载后重新收起，dispose 全部还原', () => {
  const { root, document, steps, controls, hidden } = conversation({ turns: [1, 2], failing: [2] })
  const rebuilt = document.createElement('div')
  rebuilt.setAttribute('data-chat-flow-kind', 'turn-process')
  rebuilt.setAttribute('data-chat-turn', '2')
  rebuilt.textContent = '已调用工具'
  steps[1].replaceWith(rebuilt)
  steps[2] = rebuilt
  controls.apply()
  assert.equal(hidden().length, 2)
  controls.dispose()
  assert.equal(rebuilt.style.display, '')
  assert.equal(rebuilt.hasAttribute('data-tavern-step-fold'), false)
  assert.equal(root.querySelectorAll('.dsh-tavern-step-fold-toggle').length, 0)
})

 test('停留在最新消息不代表仍在生成；完成后收起，运行时保留最后一轮', () => {
  const { root, document, steps, controls } = conversation({ turns: [1, 2], running: true });
  assert.equal(steps[1].style.display, 'none');
  assert.equal(steps[2].style.display, '');
  controls.dispose();
  assert.ok(root.querySelector('[data-chat-following-tail]'));
  const settled = createStepFoldControls(root, { running: false });
  settled.apply();
  assert.equal(steps[2].style.display, 'none');
  settled.dispose();
 });
