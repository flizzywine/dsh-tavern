import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 1500
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export const PLUGIN_DOWNLOADS = Object.freeze({
  source: 'https://github.com/weixinlll/dsh-tavern-image/archive/refs/heads/master.zip',
  alternate: 'https://codeload.github.com/weixinlll/dsh-tavern-image/zip/refs/heads/master',
  releases: 'https://github.com/weixinlll/dsh-tavern-image/releases',
  repository: 'https://github.com/weixinlll/dsh-tavern-image.git',
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Store-only ZIP needs no shell, downloaded tools or extra dependencies.
function zip(entries) {
  const files = [], directory = []
  let offset = 0
  for (const { name, bytes } of entries) {
    const encoded = Buffer.from('dsh-tavern-image/' + name, 'utf8')
    const checksum = crc32(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 filenames
    local.writeUInt16LE(33, 12) // 1980-01-01; deterministic package contents
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(encoded.length, 26)
    files.push(local, encoded, bytes)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(bytes.length, 20)
    central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(encoded.length, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, encoded)
    offset += local.length + encoded.length + bytes.length
  }
  const centralBytes = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, centralBytes, end])
}

/** Export static plugin code only; never traverse user data, Git data or installed dependencies. */
export async function createDownloadPackage(root) {
  const entries = []
  let size = 0
  async function collect(relative, required = false) {
    const path = join(root, relative)
    let info
    try { info = await lstat(path) }
    catch (error) { if (error.code === 'ENOENT' && !required) return; throw error }
    if (info.isSymbolicLink()) throw new Error('安装包代码目录含链接，已停止导出：' + relative)
    if (info.isDirectory()) {
      const children = (await readdir(path)).sort()
      for (const child of children) await collect(relative + '/' + child, true)
      return
    }
    if (!info.isFile() || size + info.size > MAX_BYTES || entries.length >= MAX_FILES) throw new Error('安装包超过大小或文件数量限制')
    const bytes = await readFile(path)
    size += bytes.length
    if (size > MAX_BYTES) throw new Error('安装包超过大小限制')
    entries.push({ name: relative, bytes })
  }
  for (const file of ['package.json', 'client.js', 'cordis.patch.yml', 'lib']) await collect(file, true)
  for (const file of ['card-worldbook.default.json', 'skills/image-prompt/SKILL.md', 'skills/character-authoring/SKILL.md', 'skills/character-authoring/references/design-rules.md', 'README.md', 'LICENSE', 'console.html', 'design-rules.md', '世界书-通用生图规则.json', 'workflows/.gitkeep', 'scripts/install-plugin.ps1', 'scripts/Install-DshTavernImage.cmd', 'scripts/Package-DshTavernImage.ps1']) await collect(file)
  if (!entries.some(entry => entry.name === 'lib/index.js')) throw new Error('安装包缺少插件入口')
  return zip(entries)
}
