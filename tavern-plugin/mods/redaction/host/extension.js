// The redaction mod's stage service (stage.js hostExtension; stage-extensions.js): what the player has opened. A mark
// opens after REDACTION_TAPS taps; every tap is kept, so the eraser's marks redraw the same after a reload or on another
// device. One small file per game, redaction/<session id>.json:
//   {version: 1, turns: {<native turn>: {source, marks: {"<para>:<index>": taps}}}}
// source is the round's director source key: a regenerated round has a new one, and its marks are covered again.
export const REDACTION_TAPS = 3
const MAX_MARKS = 1024
const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max
const file = sessionId => 'redaction/' + sessionId + '.json'
// the session id names the file: only an id, never a path
const session = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export function createRedactionExtension({profileData}) {
  async function read({sessionId}) {
    if (!session(sessionId)) return {status:'unavailable'}
    return {status:'ready', turns:(await profileData.readJson(file(sessionId)))?.turns || {}}
  }
  // One tap on one mark; the count stops at REDACTION_TAPS. A tap on a round whose source changed starts it afresh.
  async function tap({sessionId, turn, source, para, index}) {
    if (!session(sessionId) || !whole(turn, 0, 1e6) || typeof source !== 'string' || !source || source.length > 128 || !whole(para, 1, 1e5) || !whole(index, 0, 255)) return {status:'unavailable'}
    const key = para + ':' + index
    let taps = 0
    await profileData.updateJson(file(sessionId), current => {
      const turns = {...current?.turns}, row = turns[turn]?.source === source ? turns[turn] : {source, marks:{}}
      if (!Object.hasOwn(row.marks, key) && Object.keys(row.marks).length >= MAX_MARKS) return undefined
      taps = Math.min(REDACTION_TAPS, (row.marks[key] || 0) + 1)
      turns[turn] = {source, marks:{...row.marks, [key]:taps}}
      return {version:1, turns}
    })
    return {status:'ready', taps}
  }
  const methods = {getStageRedactions:read, tapStageRedaction:tap}
  return {requests:{methods:Object.keys(methods), call:(method, args) => methods[method](args || {})}}
}
