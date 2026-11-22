import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

// React-DOM detects input event support on module load, so JSDOM globals must exist before importing react-dom.
const sharedDom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
globalThis.window = sharedDom.window
globalThis.document = sharedDom.window.document
globalThis.HTMLElement = sharedDom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')

const FEATURE_SOURCE = readFileSync(
  path.resolve('tavern-plugin/src/client/features/vertex-region.js'),
  'utf8',
)

function loadFeature({ rpc = async () => ({ project: null, location: null }) } = {}) {
  const factory = vm.runInNewContext(`${FEATURE_SOURCE}\n; createVertexRegionFeature`, {
    globalThis: {},
  })
  return factory({ React, rpc })
}

function withDom(run) {
  const container = sharedDom.window.document.createElement('div')
  sharedDom.window.document.body.appendChild(container)
  const root = createRoot(container)
  return Promise.resolve()
    .then(() => run({ dom: sharedDom, container, root }))
    .finally(() => {
      act(() => { root.unmount() })
      container.remove()
    })
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }))
}

test('服务端 RPC resolveVertexConfig：按 baseUrl → 环境变量 → API key 探测 project，不泄漏密钥', async () => {
  const calls = []
  const handlers = createSettingsHandlers({
    vertexEnv: {},
    resolveCredentialValue: async ref => (ref === 'GOOGLE_VERTEX_API_KEY' ? 'AQ.secret-key' : ''),
    discoverVertexProject: async ({ apiKey }) => {
      calls.push(apiKey)
      return apiKey === 'AQ.secret-key' ? '379270002840' : '999888777'
    },
  })

  // 1. baseUrl 已含 project 时直接解析，不发探测请求
  const fromUrl = await handlers.resolveVertexConfig({
    baseUrl: 'https://asia-southeast1-aiplatform.googleapis.com/v1/projects/my-proj/locations/asia-southeast1',
  })
  assert.deepEqual(fromUrl, { project: 'my-proj', location: 'asia-southeast1' })
  assert.equal(calls.length, 0)

  // 2. 无 baseUrl 时从已保存凭据探测 project
  const fromStoredKey = await handlers.resolveVertexConfig({})
  assert.deepEqual(fromStoredKey, { project: '379270002840', location: null })
  assert.deepEqual(calls, ['AQ.secret-key'])
  assert.equal(JSON.stringify(fromStoredKey).includes('AQ.'), false)

  // 3. 显式传入的 apiKey 优先于已保存凭据
  const fromDraftKey = await handlers.resolveVertexConfig({ apiKey: 'AQ.draft-key' })
  assert.deepEqual(fromDraftKey, { project: '999888777', location: null })

  // 4. 环境变量优先于探测
  const envHandlers = createSettingsHandlers({
    vertexEnv: { GOOGLE_CLOUD_PROJECT: 'env-project' },
    discoverVertexProject: async () => { throw new Error('should not probe when env has project') },
  })
  assert.deepEqual(await envHandlers.resolveVertexConfig({}), { project: 'env-project', location: null })
})

test('VertexRegionField：打开下拉过滤地区、选择新加坡并确定后更新 baseURL，支持自定义地区', async () => {
  const { VertexRegionField } = loadFeature()
  const updates = []

  await withDom(async ({ container, root }) => {
    function Harness({ initialUrl }) {
      const [url, setUrl] = React.useState(initialUrl)
      return React.createElement(VertexRegionField, {
        provider: 'google-vertex',
        baseURL: url,
        fallbackBaseURL: '',
        onChangeBaseURL: next => {
          updates.push(next)
          setUrl(next)
        },
      })
    }

    act(() => {
      root.render(React.createElement(Harness, {
        initialUrl: 'https://aiplatform.googleapis.com/v1/projects/379270002840/locations/global',
      }))
    })

    const trigger = container.querySelector('.dsh-vertex-region-trigger')
    assert.ok(trigger)
    assert.equal(trigger.textContent.includes('global (全球)'), true)
    assert.equal(container.querySelector('.dsh-vertex-region-hint'), null)

    // 打开下拉框并按中文过滤「新加坡」
    act(() => { trigger.click() })
    const filterInput = container.querySelector('.dsh-vertex-region-filter-input')
    assert.ok(filterInput)
    act(() => { setInputValue(filterInput, '新加坡') })

    const options = [...container.querySelectorAll('.dsh-vertex-region-option')]
    assert.equal(options.length, 1)
    assert.equal(options[0].textContent, 'asia-southeast1 (新加坡)')

    // 选中并点击确定
    act(() => { options[0].click() })
    const confirmBtn = container.querySelector('.dsh-vertex-region-btn.is-primary')
    act(() => { confirmBtn.click() })

    assert.equal(
      updates.at(-1),
      'https://asia-southeast1-aiplatform.googleapis.com/v1/projects/379270002840/locations/asia-southeast1',
    )
    assert.equal(trigger.textContent.includes('asia-southeast1 (新加坡)'), true)
    assert.ok(container.querySelector('.dsh-vertex-region-hint'))

    // 支持自定义地区输入
    act(() => { trigger.click() })
    const filter2 = container.querySelector('.dsh-vertex-region-filter-input')
    act(() => { setInputValue(filter2, 'europe-west12') })
    const customOption = container.querySelector('.dsh-vertex-region-option.is-custom')
    assert.ok(customOption)
    act(() => { customOption.click() })
    act(() => { container.querySelector('.dsh-vertex-region-btn.is-primary').click() })
    assert.equal(
      updates.at(-1),
      'https://europe-west12-aiplatform.googleapis.com/v1/projects/379270002840/locations/europe-west12',
    )
  })
})

test('VertexRegionField：baseURL 缺少 project 时先自动探测，探测不到时可通过 Project ID 输入框生成端点', async () => {
  const updates = []
  let probeResolve
  const rpcCalls = []
  const { VertexRegionField } = loadFeature({
    rpc: (method, args) => {
      rpcCalls.push([method, args])
      return new Promise(resolve => { probeResolve = resolve })
    },
  })

  await withDom(async ({ container, root }) => {
    act(() => {
      root.render(React.createElement(VertexRegionField, {
        provider: 'google-vertex',
        baseURL: '',
        fallbackBaseURL: '',
        keyRef: 'GOOGLE_VERTEX_API_KEY',
        onChangeBaseURL: next => updates.push(next),
      }))
    })
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0][0], 'resolveVertexConfig')

    // 探测无结果 → 展示手动 Project ID 输入框
    await act(async () => { probeResolve({ project: null, location: null }) })
    const projectInput = container.querySelector('input[aria-label="GCP Project ID"]')
    assert.ok(projectInput)

    // 先选东京
    act(() => { container.querySelector('.dsh-vertex-region-trigger').click() })
    const tokyo = [...container.querySelectorAll('.dsh-vertex-region-option')]
      .find(el => el.textContent.includes('asia-northeast1'))
    act(() => { tokyo.click() })
    act(() => { container.querySelector('.dsh-vertex-region-btn.is-primary').click() })
    assert.equal(updates.length, 0)

    // 再填 Project ID → 立刻拼出东京端点
    act(() => { setInputValue(projectInput, 'my-gcp-project') })
    assert.deepEqual(updates, [
      'https://asia-northeast1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/asia-northeast1',
    ])
  })
})
