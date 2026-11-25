import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'

const sidebar = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// 选卡到开局准备页之间没有按钮可点、界面只剩卡片列表，必须一路挂着「正在打开…」的转轮，
// 失败时也要撤下来，否则玩家既看不到进度也看不到错误页。
function fixture(overrides = {}) {
    const names = []
    const errors = []
    const busy = []
    const context = vm.createContext({
        busy: false,
        pendingChatImport: null,
        setOpeningCardName: value => names.push(value),
        setBusy: value => busy.push(value),
        setError: value => errors.push(value),
        stageOpens: async () => false,
        preparePlayConversation: async () => 'prepared',
        newConversation: async () => 'created',
        galStageHold: () => () => {},
        whenStageAvailable: run => run(),
        galEnter() {},
        ...overrides
    })
    vm.runInContext(sourceFunction(sidebar, 'openPlayCard'), context)
    return { open: card => context.openPlayCard(card, false), names, errors, busy }
}

test('点开带开局表单的人物卡：立刻显示「正在打开」并在进入准备页后撤下', async () => {
    const h = fixture()
    assert.equal(await h.open({ name: '爱丽丝', hasOpeningForm: true }), 'prepared')
    assert.deepEqual(h.names, ['爱丽丝', ''])
    assert.deepEqual(h.busy, [true, false], '读卡期间锁住面板，结束后放开')
})

test('普通人物卡也进入游戏准备，玩家可在创建对话前选择开场和称呼', async () => {
    const h = fixture()
    assert.equal(await h.open({ name: '鲍勃', hasOpeningForm: false }), 'prepared')
    assert.deepEqual(h.names, ['鲍勃', ''])
})

test('卡自带舞台开局页时也保留加载提示', async () => {
    const h = fixture({ stageOpens: async () => true })
    assert.equal(await h.open({ name: '卡拉', hasOpeningForm: true, openingPage: {} }), 'created')
    assert.deepEqual(h.names, ['卡拉', ''])
})

test('读卡失败时撤下加载提示，错误交给面板显示', async () => {
    const h = fixture({ preparePlayConversation: async () => { throw new Error('读取人物卡失败') } })
    await assert.rejects(h.open({ name: '黛拉', hasOpeningForm: true }), /读取人物卡失败/)
    assert.deepEqual(h.names, ['黛拉', ''])
    assert.deepEqual(h.errors, [''], '开工前清掉上一条错误，失败由调用者的 catch 显示')
})
