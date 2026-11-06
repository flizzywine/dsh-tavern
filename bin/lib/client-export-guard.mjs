import {parse} from 'acorn'

// Included CJS runs inside the host factory's module scope, not its own module.
export function checkIncludedExports(source, filename) {
  const tree = parse(source, {ecmaVersion:'latest', sourceType:'script', locations:true})
  const windowAbsent = node => node?.type === 'BinaryExpression' && node.operator === '===' &&
    node.left.type === 'UnaryExpression' && node.left.operator === 'typeof' && node.left.argument.name === 'window' &&
    node.right.type === 'Literal' && node.right.value === 'undefined'
  const guard = node => windowAbsent(node) || (node?.type === 'LogicalExpression' && node.operator === '&&' && (guard(node.left) || guard(node.right)))
  const isExport = node => node?.type === 'MemberExpression' && ((node.object.name === 'module' &&
    (node.computed ? node.property.value : node.property.name) === 'exports') || node.object.name === 'exports' || isExport(node.object))
  function visit(node, guarded = false) {
    if (!node || typeof node !== 'object') return
    if ((node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') && isExport(node.left || node.argument) && !guarded)
      throw new Error(`${filename}:${node.loc.start.line}: included CJS export requires typeof window === 'undefined' guard`)
    if (node.type === 'IfStatement') {
      visit(node.test, guarded); visit(node.consequent, guarded || guard(node.test)); visit(node.alternate, guarded); return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue
      if (Array.isArray(value)) value.forEach(child => visit(child, guarded))
      else if (value && typeof value === 'object') visit(value, guarded)
    }
  }
  visit(tree)
}
