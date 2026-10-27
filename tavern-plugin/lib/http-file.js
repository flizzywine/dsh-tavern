import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

export function assetEtag(info) {
  return '"' + info.size.toString(16) + '-' + info.mtimeMs.toString(16) + '-' + info.ctimeMs.toString(16) + '"'
}
export function assetRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header))
  if (!match || !(match[1] || match[2])) return null
  const first = Number(match[1]), last = Number(match[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null
  const start = match[1] ? first : Math.max(0, size - last)
  const end = match[1] && match[2] ? Math.min(size - 1, last) : size - 1
  return start <= end && start < size ? { start, end } : null
}
export function assetNotModified(header, etag) {
  return String(header || '').split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)
}
// The caller must validate scope and path containment first. Opening once keeps the
// metadata and streamed range on the same file even if an import replaces its path.
export async function serveAssetFile(req, res, file, type, cacheControl = 'private, no-cache', extraHeaders = {}) {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Not a file')
    const etag = assetEtag(info), total = info.size, request = req.headers || {}
    const headers = { ...extraHeaders, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl, ETag: etag, 'X-Content-Type-Options': 'nosniff' }
    if (assetNotModified(request['if-none-match'], etag)) { res.writeHead(304, headers); res.end(); return }
    let range
    if (request.range && (!request['if-range'] || request['if-range'] === etag)) {
      range = assetRange(request.range, total)
      if (!range) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + total }); res.end(); return }
    }
    res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': range ? range.end - range.start + 1 : total, ...(range ? { 'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + total } : {}) })
    if (req.method === 'HEAD' || !total) { res.end(); return }
    await pipeline(handle.createReadStream({ autoClose: false, ...(range || {}) }), res)
  } finally { await handle.close() }
}
