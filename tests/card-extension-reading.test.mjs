import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'

test('读取人物卡正则和 Tavern Helper 脚本，但不执行脚本', () => {
  const card = {
    spec: 'chara_card_v3',
    data: {
      name: '灯火阑珊',
      extensions: {
        regex_scripts: [{
          id: 'regex-1', scriptName: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>',
          placement: [2], disabled: false, markdownOnly: true, minDepth: 1, maxDepth: 8
        }],
        tavern_helper: {
          scripts: [{ id: 'script-1', name: '开场白索引', type: 'script', enabled: true, content: "import 'https://example.test/opening.js'", data: { auto_apply: true }, button: [{ name: '刷新' }] }]
        }
      }
    }
  }

  const result = inspectCardExtensions(card)
  assert.equal(result.extensionCount, 2)
  assert.deepEqual(result.regexScripts[0], {
    ref: 'regex:0', id: 'regex-1', name: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>', trimStrings: [],
    placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false, substituteRegex: null, minDepth: 1, maxDepth: 8
  })
  assert.equal(result.helperScripts[0].name, '开场白索引')
  assert.equal(result.helperScripts[0].content, "import 'https://example.test/opening.js'")
  assert.deepEqual(result.helperScripts[0].data, { auto_apply: true })
  assert.equal(result.helperScripts[0].dataText, '{\n  "auto_apply": true\n}')
  assert.deepEqual(result.helperScripts[0].buttons, [])
  assert.equal(result.helperScripts[0].buttonCount, 1)
})

test('将 MVU 的脚本、正则、世界书和独立配置汇总为相关资源', () => {
  const workspace = {
    kind: 'dsh-tavern-character-workspace', version: 1,
    raw: {
      spec: 'chara_card_v3',
      data: {
        name: '测试卡',
        extensions: {
          mvu: { version: 1 },
          regex_scripts: [{ scriptName: '变量更新美化', findRegex: '/<UpdateVariable>/', disabled: true }],
          tavern_helper: { scripts: [{ name: 'MVU', content: "import 'MagVarUpdate'", enabled: true }] }
        },
        character_book: {
          entries: [
            { comment: '[mvu_update]变量更新规则', content: '规则正文', enabled: true },
            { comment: '普通设定', content: '城镇资料', enabled: true }
          ]
        }
      }
    }
  }

  const result = inspectCardExtensions(workspace)
  assert.deepEqual(result.mvuResources.map(function (item) { return [item.kind, item.name, item.enabled] }), [
    ['extension', 'mvu', true],
    ['helper', 'MVU', true],
    ['regex', '变量更新美化', false],
    ['world-book', '[mvu_update]变量更新规则', true]
  ])
  assert.equal(result.otherExtensions.length, 0)
})

test('未知扩展保持可见，并兼容没有 extensions 的纯文本卡', () => {
  const result = inspectCardExtensions({
    name: '旧卡',
    extensions: {
      depth_prompt: { depth: 4, prompt: '保持角色一致' },
      fav: true
    }
  })

  assert.equal(result.extensionCount, 2)
  assert.deepEqual(result.otherExtensions.map(function (item) { return [item.name, item.type] }), [['depth_prompt', '对象'], ['fav', '布尔值']])
  assert.match(result.otherExtensions[0].text, /保持角色一致/)
  assert.deepEqual(inspectCardExtensions({ name: '纯文本卡' }), {
    extensionCount: 0,
    regexScripts: [],
    helperScripts: [],
    mvuResources: [],
    otherExtensions: []
  })
})
