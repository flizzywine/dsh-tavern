import assert from 'node:assert/strict'
import test from 'node:test'

import { resourceWorkspaceContext } from '../tavern-plugin/lib/domain/workspace-resources.js'

test('前台保存的工作区模板替换真实路径，不递归解释路径或其他模板变量', () => {
  const projection = { specPath: '.tavern/README.md', bindingsPath: 'bindings.json', contextPath: 'session-a/context.json', diagnosticsPath: 'diag.json' }
  const custom = '我的说明：{{resourceRoot}}\n{{projectionPaths}}\n保留 {{user}}'
  const text = resourceWorkspaceContext('/workspace/{{projectionPaths}}', projection, custom)
  assert.ok(text.startsWith('我的说明："/workspace/{{projectionPaths}}"'))
  assert.match(text, /session-a\/context.json/)
  assert.ok(text.endsWith('保留 {{user}}'))
  assert.equal(resourceWorkspaceContext('/root', null, '只保留我的说明'), '只保留我的说明')
  assert.equal(resourceWorkspaceContext('', projection, custom), '')
})
