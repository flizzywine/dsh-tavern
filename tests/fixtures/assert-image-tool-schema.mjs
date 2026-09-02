import assert from 'node:assert/strict'

// Run at the model boundary, not just against the tool's source declaration.
export function assertImageToolSchema(tool) {
  const schema = tool.parameters
  assert.equal(schema?.type, 'object', `Invalid schema for function '${tool.name}': schema must be a JSON Schema of type object`)
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object') assert.ok(node.properties && typeof node.properties === 'object', `${tool.name}: object schema needs properties`)
    if (node.required !== undefined) assert.ok(Array.isArray(node.required), `${tool.name}: required must be a property-name array`)
    for (const child of Object.values(node.properties || {})) visit(child)
    if (node.items) visit(node.items)
  }
  visit(schema)
}
