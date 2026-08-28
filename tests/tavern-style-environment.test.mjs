import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTavernStyleEnvironment } from '../tavern-plugin/lib/domain/tavern-style-environment.js'

test('ST 样式环境只保留合法主题变量和 HTTPS 扩展样式', () => {
  assert.deepEqual(normalizeTavernStyleEnvironment({
    themeVariables: { '--SmartThemeBodyColor': 'rgb(1, 2, 3)', color: 'red', '--font-scale': 1.2 },
    customCss: '.mes_text { letter-spacing: 1px }',
    extensionStyles: ['https://cdn.example/ui.css', 'http://unsafe.example/ui.css', 'https://cdn.example/ui.css']
  }), {
    themeVariables: { '--SmartThemeBodyColor': 'rgb(1, 2, 3)', '--font-scale': '1.2' },
    customCss: '.mes_text { letter-spacing: 1px }',
    extensionStyles: ['https://cdn.example/ui.css']
  })
})
