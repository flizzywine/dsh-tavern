import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Android hands `<input type=file>` to the host app, which turns `accept` into the
// picker's MIME filter. An extension list becomes a filter no activity matches, so
// 保存/聊天记录 imports could not open the picker at all. File inputs therefore keep
// `accept` empty and the import validates the extension itself.

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

/** Every `type: "file"` element in the bundle, as its options object source. */
function fileInputs(source) {
  const found = []
  const marker = 'type: "file"'
  for (let at = source.indexOf(marker); at >= 0; at = source.indexOf(marker, at + marker.length)) {
    const open = source.lastIndexOf('{', at)
    let depth = 0
    let end = open
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') { depth -= 1; if (depth === 0) { end += 1; break } }
    }
    found.push(source.slice(open, end))
  }
  return found
}

test('存档与聊天记录的导入不按扩展名过滤，交给导入环节校验', async () => {
  const inputs = fileInputs(client)
  // 人物卡导入早已因为同一原因不设 accept；存档与聊天记录跟随它。
  const scoped = inputs.filter(options => /ref:\s*(?:chatImportFile|saveImportFile|sillyTavernChatFile)\b/.test(options))
  assert.equal(scoped.length, 3, '应找到人物卡准备页的三处导入输入')
  const restricted = scoped.filter(options => {
    // The value is either a quoted list (which may itself contain commas) or an identifier.
    const accept = /\baccept:\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))/.exec(options)
    if (!accept) return false
    const value = (accept[1] ?? accept[2] ?? accept[3]).trim()
    // `TAVERN_CARD_FILE_ACCEPT` is undefined upstream: the documented "no filter" route.
    if (value === 'TAVERN_CARD_FILE_ACCEPT' || value === 'undefined') return false
    // A MIME wildcard or type is still a valid filter; an extension list is not.
    return !/^\*/.test(value) && !/^(?:image|audio|video|text|application)\//.test(value)
  })
  assert.deepEqual(restricted, [], '以下文件输入仍按扩展名过滤：\n' + restricted.join('\n\n'))
})

test('剧本入口允许选择没有注册 MIME 类型的 SillyTavern JSONL', () => {
  const inputs = fileInputs(client).filter(options => /ref:\s*(?:sourceInput|scriptFileRef|initialImportRef)\b/.test(options))
  assert.equal(inputs.length, 3)
  for (const input of inputs) assert.doesNotMatch(input, /\baccept:/)
  assert.match(client, /input\.accept = kind === "worldbook" \|\| kind === "preset" \? "\.json,application\/json" : ""/)
})
