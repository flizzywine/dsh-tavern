import { STORY_SUBMIT_TOOL_NAME } from './story-tool-submission.js'

const STATE_EXPECT_OBJECT = 0
const STATE_EXPECT_KEY_OR_END = 1
const STATE_IN_KEY = 2
const STATE_EXPECT_COLON = 3
const STATE_EXPECT_VALUE = 4
const STATE_IN_STRING_VALUE = 5
const STATE_IN_NESTED = 6
const STATE_IN_PRIMITIVE = 7
const STATE_EXPECT_COMMA_OR_END = 8
const STATE_DONE = 9

function isWhitespace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
}

function isHexDigit(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)
}

/**
 * Incremental O(1)-per-character top-level JSON string field extractor.
 * Properly decodes `\\`, `\"`, `\n`, `\r`, `\t`, `\b`, `\f`, `\/`, and `\uXXXX`
 * (including UTF-16 surrogate pairs split across chunk boundaries) without regex backtracking.
 */
export function createIncrementalJsonStringExtractor() {
  let state = STATE_EXPECT_OBJECT
  let keyBuffer = ''
  let currentKey = ''
  let escapeMode = 0 // 0=none, 1=after '\', 2=in \uXXXX
  let unicodeHex = ''
  let pendingHighSurrogate = null
  let nestedDepth = 0
  let nestedInString = false
  let nestedEscaped = false
  const fields = Object.create(null)

  function emitCharToTarget(ch, isKey) {
    if (isKey) keyBuffer += ch
    else fields[currentKey] = (fields[currentKey] || '') + ch
  }

  function flushPendingSurrogate(isKey) {
    if (pendingHighSurrogate !== null) {
      emitCharToTarget(String.fromCharCode(pendingHighSurrogate), isKey)
      pendingHighSurrogate = null
    }
  }

  function consumeStringChar(ch, isKey) {
    if (escapeMode === 0) {
      if (ch === '\\') {
        escapeMode = 1
        return false
      }
      if (ch === '"') {
        flushPendingSurrogate(isKey)
        return true
      }
      flushPendingSurrogate(isKey)
      emitCharToTarget(ch, isKey)
      return false
    }
    if (escapeMode === 1) {
      if (ch === 'u') {
        escapeMode = 2
        unicodeHex = ''
        return false
      }
      escapeMode = 0
      flushPendingSurrogate(isKey)
      switch (ch) {
        case '"': emitCharToTarget('"', isKey); break
        case '\\': emitCharToTarget('\\', isKey); break
        case '/': emitCharToTarget('/', isKey); break
        case 'b': emitCharToTarget('\b', isKey); break
        case 'f': emitCharToTarget('\f', isKey); break
        case 'n': emitCharToTarget('\n', isKey); break
        case 'r': emitCharToTarget('\r', isKey); break
        case 't': emitCharToTarget('\t', isKey); break
        default: emitCharToTarget(ch, isKey); break
      }
      return false
    }
    // escapeMode === 2 (\uXXXX)
    if (!isHexDigit(ch.charCodeAt(0))) {
      escapeMode = 0
      flushPendingSurrogate(isKey)
      emitCharToTarget('\\u' + unicodeHex + ch, isKey)
      unicodeHex = ''
      return false
    }
    unicodeHex += ch
    if (unicodeHex.length === 4) {
      const codeUnit = Number.parseInt(unicodeHex, 16)
      escapeMode = 0
      unicodeHex = ''
      if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
        flushPendingSurrogate(isKey)
        pendingHighSurrogate = codeUnit
      } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF && pendingHighSurrogate !== null) {
        const combined = ((pendingHighSurrogate - 0xD800) << 10) + (codeUnit - 0xDC00) + 0x10000
        pendingHighSurrogate = null
        emitCharToTarget(String.fromCodePoint(combined), isKey)
      } else {
        flushPendingSurrogate(isKey)
        emitCharToTarget(String.fromCharCode(codeUnit), isKey)
      }
    }
    return false
  }

  function feed(chunk) {
    const text = typeof chunk === 'string' ? chunk : ''
    const prevThink = fields.think || ''
    const prevContent = fields.content || ''

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (state === STATE_DONE) break

      if (state === STATE_EXPECT_OBJECT) {
        if (isWhitespace(ch)) continue
        if (ch === '{') state = STATE_EXPECT_KEY_OR_END
        else state = STATE_DONE
        continue
      }

      if (state === STATE_EXPECT_KEY_OR_END) {
        if (isWhitespace(ch)) continue
        if (ch === '"') {
          keyBuffer = ''
          escapeMode = 0
          pendingHighSurrogate = null
          state = STATE_IN_KEY
        } else if (ch === '}') {
          state = STATE_DONE
        }
        continue
      }

      if (state === STATE_IN_KEY) {
        if (consumeStringChar(ch, true)) {
          currentKey = keyBuffer
          state = STATE_EXPECT_COLON
        }
        continue
      }

      if (state === STATE_EXPECT_COLON) {
        if (isWhitespace(ch)) continue
        if (ch === ':') state = STATE_EXPECT_VALUE
        continue
      }

      if (state === STATE_EXPECT_VALUE) {
        if (isWhitespace(ch)) continue
        if (ch === '"') {
          if (fields[currentKey] === undefined) fields[currentKey] = ''
          escapeMode = 0
          pendingHighSurrogate = null
          state = STATE_IN_STRING_VALUE
        } else if (ch === '{' || ch === '[') {
          nestedDepth = 1
          nestedInString = false
          nestedEscaped = false
          state = STATE_IN_NESTED
        } else {
          state = STATE_IN_PRIMITIVE
        }
        continue
      }

      if (state === STATE_IN_STRING_VALUE) {
        if (consumeStringChar(ch, false)) {
          state = STATE_EXPECT_COMMA_OR_END
        }
        continue
      }

      if (state === STATE_IN_NESTED) {
        if (nestedInString) {
          if (nestedEscaped) nestedEscaped = false
          else if (ch === '\\') nestedEscaped = true
          else if (ch === '"') nestedInString = false
        } else {
          if (ch === '"') nestedInString = true
          else if (ch === '{' || ch === '[') nestedDepth++
          else if (ch === '}' || ch === ']') {
            nestedDepth--
            if (nestedDepth <= 0) state = STATE_EXPECT_COMMA_OR_END
          }
        }
        continue
      }

      if (state === STATE_IN_PRIMITIVE) {
        if (ch === ',') state = STATE_EXPECT_KEY_OR_END
        else if (ch === '}') state = STATE_DONE
        continue
      }

      if (state === STATE_EXPECT_COMMA_OR_END) {
        if (isWhitespace(ch)) continue
        if (ch === ',') state = STATE_EXPECT_KEY_OR_END
        else if (ch === '}') state = STATE_DONE
      }
    }

    const nextThink = fields.think || ''
    const nextContent = fields.content || ''
    return {
      thinkDelta: nextThink.slice(prevThink.length),
      contentDelta: nextContent.slice(prevContent.length),
      think: nextThink,
      content: nextContent,
      fields
    }
  }

  return Object.freeze({
    feed,
    snapshot() {
      return {
        think: fields.think || '',
        content: fields.content || '',
        fields: { ...fields }
      }
    }
  })
}

export function parsePartialToolReplyJson(raw) {
  const parser = createIncrementalJsonStringExtractor()
  return parser.feed(raw)
}

/**
 * Tracks `tool-call-delta` stream chunks in `model-stream.js` and extracts incremental
 * `think` / `content` deltas exclusively for `submit_story` calls.
 */
export function createToolReplyStreamTracker(targetToolName = STORY_SUBMIT_TOOL_NAME) {
  const namesByIndex = new Map()
  const parsersByIndex = new Map()
  const bufferedDeltasByIndex = new Map()

  function pushToolDelta(chunk) {
    if (!chunk || chunk.type !== 'tool-call-delta') {
      return { matched: false, thinkDelta: '', contentDelta: '' }
    }
    const index = Number.isInteger(chunk.index) ? chunk.index : 0
    if (typeof chunk.name === 'string' && chunk.name !== '') {
      namesByIndex.set(index, chunk.name)
    }
    const knownName = namesByIndex.get(index)
    const delta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
    if (!knownName) {
      if (delta !== '') {
        bufferedDeltasByIndex.set(index, (bufferedDeltasByIndex.get(index) || '') + delta)
      }
      return { matched: false, thinkDelta: '', contentDelta: '' }
    }
    if (knownName !== targetToolName) {
      bufferedDeltasByIndex.delete(index)
      return { matched: false, thinkDelta: '', contentDelta: '' }
    }
    let parser = parsersByIndex.get(index)
    let toFeed = delta
    if (!parser) {
      parser = createIncrementalJsonStringExtractor()
      parsersByIndex.set(index, parser)
      const buffered = bufferedDeltasByIndex.get(index) || ''
      bufferedDeltasByIndex.delete(index)
      if (buffered !== '') toFeed = buffered + delta
    }
    if (toFeed === '') {
      const snap = parser.snapshot()
      return { matched: true, thinkDelta: '', contentDelta: '', think: snap.think, content: snap.content }
    }
    const res = parser.feed(toFeed)
    return {
      matched: true,
      thinkDelta: res.thinkDelta,
      contentDelta: res.contentDelta,
      think: res.think,
      content: res.content
    }
  }

  return Object.freeze({ pushToolDelta })
}
