export function dshParameterFields(schema) {
  if (schema === null || typeof schema !== 'object' || schema.type !== 'object') {
    throw new TypeError('DSH tool parameters require an object JSON Schema')
  }
  if (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new TypeError('DSH tool parameters require schema.properties')
  }
  return Object.fromEntries(Object.entries(schema.properties).map(function ([name, property]) {
    const field = { ...property }
    delete field.minLength
    delete field.maxLength
    delete field.minimum
    delete field.maximum
    delete field.pattern
    return [name, field]
  }))
}
