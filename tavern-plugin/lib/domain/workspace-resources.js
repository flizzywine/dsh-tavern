import { prompt } from '../prompt-catalog.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function resourceWorkspaceContext(value, projection, template = prompt('card-workspace')) {
  const root = str(value).trim()
  if (root === '') return ''
  const paths = projection && typeof projection === 'object' ? [
    '- Resource formats and operations: `' + str(projection.specPath) + '`.',
    '- Current binding snapshot: `' + str(projection.bindingsPath) + '`.',
    '- Current session context: `' + str(projection.contextPath) + '`.',
    '- Current session diagnostics: `' + str(projection.diagnosticsPath) + '`.'
  ].join('\n') : ''
  const variables = { resourceRoot: JSON.stringify(root), projectionPaths: paths }
  return str(template).replace(/\{\{(resourceRoot|projectionPaths)\}\}/g, (_, key) => variables[key]).trim()
}
