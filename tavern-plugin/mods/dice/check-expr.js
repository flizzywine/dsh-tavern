// The small formula language a card's check rules are written in (check-engine.js). A formula is data the engine
// reads, never code it runs: numbers, 'text', true/false, names, + - * / %, comparisons, and/or/not, a ? b : c,
// calls of the functions below, list[index] and option.attribute. Parsed once when the rules load.
const FUNCTIONS = Object.freeze({
  // count(list, face) - how many entries equal face; count(list) - how many are truthy
  count: (list, face) => asList(list, 'count').filter(value => face === undefined ? Boolean(value) : value === face).length,
  // sum(list or keyed resource) - the total of its numbers
  sum: value => asList(value, 'sum').reduce((total, item) => total + asNumber(item, 'sum'), 0),
  len: value => asList(value, 'len').length,
  max: (...values) => Math.max(...values.map(value => asNumber(value, 'max'))),
  min: (...values) => Math.min(...values.map(value => asNumber(value, 'min'))),
  abs: value => Math.abs(asNumber(value, 'abs')),
  floor: value => Math.floor(asNumber(value, 'floor')),
  ceil: value => Math.ceil(asNumber(value, 'ceil')),
  clamp: (value, low, high) => Math.min(asNumber(high, 'clamp'), Math.max(asNumber(low, 'clamp'), asNumber(value, 'clamp'))),
  has: (list, value) => asList(list, 'has').includes(value),
  // get(map, key, fallback) - an entry of a map whose entries are not fixed, or fallback when it has none
  get: (map, key, fallback) => map && typeof map === 'object' && !Array.isArray(map) && Object.hasOwn(map, key) ? map[key] : fallback,
  // join(a, b, ...) - the values as one text (an entry name made of parts)
  join: (...values) => values.map(value => String(value)).join(''),
  // keys(map) - the entry names of a map, e.g. for each: over entries that are not fixed
  keys: map => map && typeof map === 'object' && !Array.isArray(map) ? Object.keys(map) : (() => { throw new Error('keys() needs a map') })(),
  // range(n) - 0, 1, ..., n-1: the positions of a list, e.g. each: "range(len(d))" reads d[key] die by die
  range: n => { const count = asNumber(n, 'range'); if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error('range() needs a whole number 0-1000'); return Array.from({ length: count }, (_, index) => index) },
  // slice(list, start, end) - the entries from start up to before end, e.g. count(slice(d, 0, key + 1), d[key]) is the how-manieth time this face came up
  slice: (list, start, end) => asList(list, 'slice').slice(asNumber(start, 'slice'), end === undefined ? undefined : asNumber(end, 'slice')),
})
// A formula is short data: these bound what one card can make the engine parse.
const MAX_FORMULA_LENGTH = 2000, MAX_FORMULA_DEPTH = 40
export const FORMULA_FUNCTIONS = Object.freeze(Object.keys(FUNCTIONS))

function asList(value, name) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  throw new Error(name + '() needs a list')
}
function asNumber(value, name) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(name + ' needs a number, got ' + JSON.stringify(value))
  return value
}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!?:(),[\].]))/y
function tokenize(source) {
  const tokens = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    if (!source.slice(TOKEN.lastIndex).trim()) break
    const at = TOKEN.lastIndex, match = TOKEN.exec(source)
    if (!match) throw new Error('unexpected text at ' + at + ': ' + source.slice(at, at + 12))
    if (match[1] !== undefined) tokens.push({ kind: 'num', value: Number(match[1]) })
    else if (match[2] !== undefined) tokens.push({ kind: 'str', value: match[2] })
    else if (match[3] !== undefined) {
      const word = match[3]
      tokens.push(word === 'and' ? { kind: 'op', value: '&&' } : word === 'or' ? { kind: 'op', value: '||' } : word === 'not' ? { kind: 'op', value: '!' }
        : word === 'true' || word === 'false' ? { kind: 'lit', value: word === 'true' } : word === 'null' ? { kind: 'lit', value: null } : { kind: 'id', value: word })
    } else tokens.push({ kind: 'op', value: match[4] })
  }
  return tokens
}

const BINARY = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]

/** Parse a formula into a tree; throws a readable error for the card author. */
export function parseFormula(source) {
  if (typeof source === 'number' || typeof source === 'boolean') return { n: 'lit', v: source }
  if (typeof source !== 'string' || !source.trim()) throw new Error('a formula must be non-empty text or a number')
  if (source.length > MAX_FORMULA_LENGTH) throw new Error('a formula is at most ' + MAX_FORMULA_LENGTH + ' characters')
  const tokens = tokenize(source)
  let at = 0, depth = 0
  const peek = () => tokens[at], next = () => tokens[at++]
  const isOp = value => peek()?.kind === 'op' && peek().value === value
  const expect = value => { if (!isOp(value)) throw new Error('expected ' + value + ' in ' + source); at++ }
  function conditional() {
    if (++depth > MAX_FORMULA_DEPTH) throw new Error('a formula nests at most ' + MAX_FORMULA_DEPTH + ' levels: ' + source)
    const test = binary(0)
    if (!isOp('?')) { depth--; return test }
    at++
    const yes = conditional()
    expect(':')
    const node = { n: 'if', c: test, a: yes, b: conditional() }
    depth--
    return node
  }
  function binary(level) {
    if (level === BINARY.length) return unary()
    let left = binary(level + 1)
    while (peek()?.kind === 'op' && BINARY[level].includes(peek().value)) left = { n: 'bin', op: next().value, a: left, b: binary(level + 1) }
    return left
  }
  function unary() {
    if (isOp('!') || isOp('-')) return { n: 'un', op: next().value, a: unary() }
    return postfix(primary())
  }
  function postfix(node) {
    for (;;) {
      if (isOp('[')) { at++; const key = conditional(); expect(']'); node = { n: 'idx', o: node, k: key } }
      else if (isOp('.')) { at++; const name = next(); if (name?.kind !== 'id') throw new Error('expected a name after . in ' + source); node = { n: 'attr', o: node, k: name.value } }
      else return node
    }
  }
  function primary() {
    const token = next()
    if (!token) throw new Error('formula ends early: ' + source)
    if (token.kind === 'num' || token.kind === 'str' || token.kind === 'lit') return { n: 'lit', v: token.value }
    if (token.kind === 'id') {
      if (!isOp('(')) return { n: 'id', v: token.value }
      at++
      if (!Object.hasOwn(FUNCTIONS, token.value)) throw new Error('unknown function ' + token.value + '(); known: ' + FORMULA_FUNCTIONS.join(', '))
      const args = []
      if (!isOp(')')) { args.push(conditional()); while (isOp(',')) { at++; args.push(conditional()) } }
      expect(')')
      return { n: 'call', f: token.value, args }
    }
    if (token.value === '(') { const inner = conditional(); expect(')'); return inner }
    throw new Error('unexpected ' + token.value + ' in ' + source)
  }
  const tree = conditional()
  if (at < tokens.length) throw new Error('unexpected ' + tokens[at].value + ' in ' + source)
  return tree
}

/** The names a formula reads, so the rules can be checked once at load. */
export function formulaNames(tree, names = new Set()) {
  if (tree.n === 'id') names.add(tree.v)
  for (const child of [tree.a, tree.b, tree.c, tree.o, tree.k, ...(tree.args || [])]) if (child && typeof child === 'object') formulaNames(child, names)
  return names
}

/** Evaluate a parsed formula. scope.get(name) returns a value or throws; scope.attr(name, key) reads option.attribute. */
export function evaluate(tree, scope) {
  switch (tree.n) {
    case 'lit': return tree.v
    case 'id': return scope.get(tree.v)
    case 'un': { const value = evaluate(tree.a, scope); return tree.op === '!' ? !value : -asNumber(value, '-') }
    case 'if': return evaluate(tree.c, scope) ? evaluate(tree.a, scope) : evaluate(tree.b, scope)
    case 'call': return FUNCTIONS[tree.f](...tree.args.map(arg => evaluate(arg, scope)))
    case 'idx': {
      const object = evaluate(tree.o, scope), key = evaluate(tree.k, scope)
      if (Array.isArray(object)) return object[asNumber(key, '[]')]
      if (object && typeof object === 'object' && Object.hasOwn(object, key)) return object[key]
      throw new Error('no entry ' + JSON.stringify(key))
    }
    case 'attr': {
      if (tree.o.n !== 'id') throw new Error('.' + tree.k + ' reads an option of a named choice or parameter')
      return scope.attr(tree.o.v, tree.k)
    }
    case 'bin': {
      if (tree.op === '&&') return evaluate(tree.a, scope) ? evaluate(tree.b, scope) : false
      if (tree.op === '||') { const left = evaluate(tree.a, scope); return left ? left : evaluate(tree.b, scope) }
      const a = evaluate(tree.a, scope), b = evaluate(tree.b, scope)
      if (tree.op === '==') return a === b
      if (tree.op === '!=') return a !== b
      const x = asNumber(a, tree.op), y = asNumber(b, tree.op)
      switch (tree.op) {
        case '<': return x < y
        case '<=': return x <= y
        case '>': return x > y
        case '>=': return x >= y
        case '+': return x + y
        case '-': return x - y
        case '*': return x * y
        case '/': if (y === 0) throw new Error('division by zero'); return x / y
        case '%': if (y === 0) throw new Error('division by zero'); return x % y
      }
    }
  }
  throw new Error('bad formula node')
}
