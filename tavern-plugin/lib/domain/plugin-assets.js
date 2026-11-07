import { createReadStream } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

// Static files a plugin ships in <data>/plugins/<folder>/assets/: images, maps, sounds, fonts.
// The browser half addresses them with tavernUi.assetUrl(); only the assets folder is served,
// so a plugin's code and settings in the same folder stay private.
export const PLUGIN_ASSET_PREFIX = '/api/dsh-tavern/plugin-assets/'

const MEDIA_TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', css: 'text/css; charset=utf-8',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
})

export function pluginAssetMediaType(file) {
  return MEDIA_TYPES[path.extname(String(file)).slice(1).toLowerCase()] || 'application/octet-stream'
}

/** Split '<plugin name>/<path>' (a scoped name takes two segments); null when the path is unsafe. */
export function parsePluginAssetPath(pathname) {
  const value = String(pathname || '')
  if (!value.startsWith(PLUGIN_ASSET_PREFIX)) return null
  const parts = value.slice(PLUGIN_ASSET_PREFIX.length).split('/')
  const nameLength = parts[0]?.startsWith('@') ? 2 : 1
  const name = parts.slice(0, nameLength).join('/'), file = parts.slice(nameLength)
  if (!name || !file.length || file.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[\\\0:]/.test(part))) return null
  return { name, file: file.join('/') }
}

export function createPluginAssets({ pluginsDir, now = Date.now }) {
  let folders = null, scannedAt = 0, scanning = null
  // Package name (and folder name) → folder; rescanned at most once a second as plugins come and go.
  async function folderOf(name) {
    if (!scanning && (!folders || now() - scannedAt > 1000)) {
      scanning = (async () => {
        const next = new Map()
        let entries = []
        try { entries = (await readdir(pluginsDir, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.')) } catch {}
        for (const entry of entries) {
          let packageName = ''
          try { packageName = String(JSON.parse(await readFile(path.join(pluginsDir, entry.name, 'package.json'), 'utf8')).name || '') } catch {}
          if (packageName && !next.has(packageName)) next.set(packageName, entry.name)
          if (!next.has(entry.name)) next.set(entry.name, entry.name)
        }
        folders = next
        scannedAt = now()
      })().finally(() => { scanning = null })
    }
    // Every caller joins the same scan, including refreshes; never expose a partially populated map.
    if (scanning) await scanning
    return folders.get(name)
  }

  /** The file behind an asset URL, or undefined when there is none. */
  async function read(pathname) {
    const parsed = parsePluginAssetPath(pathname)
    if (!parsed) return undefined
    const folder = await folderOf(parsed.name)
    if (!folder) return undefined
    const root = path.join(pluginsDir, folder, 'assets')
    let file, info
    try {
      const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path.join(root, ...parsed.file.split('/')))])
      // A link inside assets/ must not lead out of it.
      if (!realFile.startsWith(realRoot + path.sep)) return undefined
      file = realFile
      info = await stat(file)
    } catch { return undefined }
    if (!info.isFile()) return undefined
    return {
      length: info.size, mediaType: pluginAssetMediaType(file), etag: '"' + info.size.toString(16) + '-' + Math.floor(info.mtimeMs).toString(16) + '"',
      stream: (start, end) => createReadStream(file, { start, end })
    }
  }
  return Object.freeze({ read })
}
