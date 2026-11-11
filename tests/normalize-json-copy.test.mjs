import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeJsonCopy } from '../tavern-plugin/lib/domain/copy-json-tree.js'

const native = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
function outcome(fn, value) {
  try { return { value: fn(value) } }
  catch (error) { return { error: { name: error.constructor.name, message: error.message.split('\n')[0] } } }
}

const cases = [
  ['undefined, functions, symbols and non-finite numbers', () => ({ missing: undefined, nan: NaN, inf: Infinity, negzero: -0,
    rows: [undefined, NaN, -0, Symbol('x'), () => {}], fn() {}, symbol: Symbol('x') })],
  ['Date and custom toJSON holder semantics', () => {
    const inner = { tag: 'inner', toJSON(key) { return { key, sameThis: this === inner, nested: { toJSON() { return 7 } } } } }
    return { date: new Date('2020-01-01T00:00:00Z'), invalid: new Date('nope'), inner, list: [inner] }
  }],
  ['toJSON result is not invoked twice at the same key', () => ({ value: { toJSON() { return { toJSON() { return 'wrong' }, text: 'right' } } } })],
  ['array and function toJSON', () => {
    const fn = () => {}; fn.toJSON = () => ({ from: 'function' })
    const array = Object.assign([1, 2], {
      toJSON() { return { from: 'array' } }
    })
    return { fn, array }
  }],
  ['sparse arrays and unsupported root values', () => ({ sparse: [1, , 3], root: undefined })],
  ['boxed primitives', () => ({ number: new Number(5), string: new String('str'), boolean: new Boolean(false), nan: new Number(NaN) })],
  ['BigInt primitive and wrapper', () => ({ value: 1n })],
  ['BigInt wrapper', () => ({ value: Object(1n) })],
  ['non-plain objects and null prototype', () => {
    class Record { constructor() { this.own = 1 } get inherited() { return 2 } }
    return { record: new Record(), map: new Map([['key', 1]]), set: new Set([1]), regexp: /x/g, nullProto: Object.create(null) }
  }],
  ['own __proto__ keys and integer ordering', () => JSON.parse('{"__proto__":{"safe":true},"constructor":{"label":"own"},"2":2,"1":1}')],
  ['getter failures', () => ({ ok: 1, get bad() { throw new Error('getter-boom') } })],
  ['toJSON getter failures', () => ({ get toJSON() { throw new RangeError('toJSON-boom') } })],
  ['self cycle', () => { const value = { name: 'root' }; value.self = value; return value }],
  ['mutual cycle', () => { const a = {}, b = { a }; a.b = b; return a }],
  ['top-level function', () => () => {}],
  ['top-level symbol', () => Symbol('root')],
  ['top-level undefined', () => undefined],
  ['unicode and lone surrogates', () => ({ lone: 'a\ud800b', emoji: '😀', tab: 'a\tb' })]
]

for (const [name, make] of cases) test('normalizeJsonCopy matches JSON round-trip: ' + name, () => {
  const value = make()
  assert.deepEqual(outcome(normalizeJsonCopy, value), outcome(native, value))
})

test('normalizeJsonCopy duplicates DAG branches and detaches every result', () => {
  const shared = { value: 1 }
  const source = { left: shared, right: shared }
  const result = normalizeJsonCopy(source)
  assert.deepEqual(result, native(source))
  assert.notEqual(result.left, result.right)
  result.left.value = 99
  assert.equal(source.left.value, 1)
  assert.equal(result.right.value, 1)
})

test('normalizeJsonCopy preserves serialized bytes and safe own __proto__ data', () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"values":[null,-0]}')
  const result = normalizeJsonCopy(source)
  assert.equal(JSON.stringify(result), JSON.stringify(native(source)))
  assert.equal(Object.hasOwn(result, '__proto__'), true)
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
})
