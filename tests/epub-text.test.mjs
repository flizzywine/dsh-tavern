import assert from 'node:assert/strict'
import test from 'node:test'

import { extractEpubText } from '../tavern-plugin/lib/domain/epub-text.js'

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, source] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const data = Buffer.from(source)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    localParts.push(local, nameBuffer, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  const count = Object.keys(files).length
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function sampleEpub() {
  return storedZip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
    'OPS/package.opf': '<?xml version="1.0"?><package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>',
    'OPS/one.xhtml': '<html><head><style>隐藏样式</style></head><body><h1>第一章</h1><p>甲 &amp; 乙<br/>换行</p><script>隐藏脚本</script></body></html>',
    'OPS/two.xhtml': '<html><body><h1>第二章</h1><p>先读这一章。</p></body></html>',
    'OPS/nav.xhtml': '<html><body>目录不应进入正文</body></html>'
  })
}

test('EPUB 按 spine 顺序抽取正文并清除标签与脚本', () => {
  const text = extractEpubText(sampleEpub())
  assert.ok(text.indexOf('第二章') < text.indexOf('第一章'))
  assert.match(text, /甲 & 乙\n换行/)
  assert.doesNotMatch(text, /隐藏样式|隐藏脚本|目录不应进入正文|<[^>]+>/)
})

test('损坏或缺少正文的 EPUB 给出明确错误', () => {
  assert.throws(() => extractEpubText(Buffer.from('not an epub')), /EPUB 解析失败/)
  const empty = storedZip({ mimetype: 'application/epub+zip' })
  assert.throws(() => extractEpubText(empty), /META-INF\/container\.xml/)
})
