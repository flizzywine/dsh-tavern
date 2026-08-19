// Vercel 的 Express 预设以显式导入识别 Node 服务；请求仍由 DSH 原生服务器处理。
import 'express'
import http from 'node:http'

const publicPort = Number(process.env.PORT || 3082)
process.env.DSH_TAVERN_INTERNAL_PORT = String(publicPort)
process.env.DSH_PREVIEW_HOST ||= `127.0.0.1:${publicPort}`

let previewServer
const platformListen = http.Server.prototype.listen

if (process.env.VERCEL) {
  // Vercel 会截获 listen，但不会执行 DSH 等待的回调。这里保留真实 Server，
  // 让 DSH 完成路由注册，再由下面导出的函数直接分发 HTTP 请求。
  http.Server.prototype.listen = function (...args) {
    previewServer = this
    const callback = args.findLast((value) => typeof value === 'function')
    this.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: publicPort })
    queueMicrotask(() => callback?.call(this))
    return this
  }
}

console.info('[preview] starting DSH on the public port')
try {
  await import('./preview/server.mjs')
} finally {
  http.Server.prototype.listen = platformListen
}
console.info('[preview] DSH preview ready')

export default function handlePreviewRequest(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://preview.local')
  if (requestUrl.pathname === '/' && !requestUrl.searchParams.has('fixture')) {
    res.writeHead(302, { Location: '/?fixture=empty' })
    res.end()
    return
  }
  if (previewServer === undefined) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('DSH Tavern preview is starting')
    return
  }
  previewServer.emit('request', req, res)
}
