import { prompt } from '../prompt-catalog.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function resourceWorkspaceContext(value, projection, template = prompt('card-workspace')) {
  const root = str(value).trim()
  if (root === '') return ''
  const paths = projection && typeof projection === 'object' ? [
    '- 资源格式与操作说明：`' + str(projection.specPath) + '`。',
    '- 当前绑定快照：`' + str(projection.bindingsPath) + '`。',
    '- 当前 Session 上下文：`' + str(projection.contextPath) + '`。',
    '- 当前 Session 诊断摘要：`' + str(projection.diagnosticsPath) + '`。'
  ].join('\n') : ''
  const variables = { resourceRoot: JSON.stringify(root), projectionPaths: paths }
  return str(template).replace(/\{\{(resourceRoot|projectionPaths)\}\}/g, (_, key) => variables[key]).trim()
}
