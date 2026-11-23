#!/usr/bin/env node
// 打包时预置卡片 iframe 每次都会加载的 CDN 资源，首次打开卡片不必联网。
//   node android/native/seed-static-cache.mjs <src> <cache-dir> [额外 URL...]
// 用酒馆自己的静态资源缓存（tavern-static-resource-cache.js）下载并写入，格式与设备上运行时缓存的完全相同；
// URL 列表从当前源码里读（SillyTavern 兼容样式表固定到某个提交），随源码更新自动跟上。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [src, cacheDir, ...extra] = process.argv.slice(2)
if (!src || !cacheDir) throw new Error('用法：seed-static-cache.mjs <src> <cache-dir> [URL...]')
const client = await readFile(path.join(src, 'tavern-plugin/lib/client.js'), 'utf8')

const urls = []
// 1) SillyTavern 兼容样式：每个卡片 iframe 都加载（client.js 里的 SILLYTAVERN_CSS_COMPAT）。
const compat = client.match(/SILLYTAVERN_CSS_COMPAT = Object\.freeze\(\{([\s\S]*?)\]\)\s*\}\)/)
if (!compat) throw new Error('client.js 里找不到 SILLYTAVERN_CSS_COMPAT，样式表列表格式变了')
const revision = compat[1].match(/revision:\s*"([0-9a-f]{40})"/)?.[1]
const styles = [...compat[1].matchAll(/"([^"]+\.css)"/g)].map(m => m[1])
const base = client.match(/"(https:\/\/cdn\.jsdelivr\.net\/gh\/SillyTavern\/SillyTavern@)"\s*\+\s*SILLYTAVERN_CSS_COMPAT\.revision/)?.[1]
if (!revision || !styles.length || !base) throw new Error('解析 SillyTavern 兼容样式表失败')
for (const style of styles) urls.push(`${base}${revision}/public/${style}`)
urls.push(...extra)

const { createTavernStaticResourceCache } = await import(pathToFileURL(path.join(src, 'tavern-plugin/lib/domain/tavern-static-resource-cache.js')).href)
const cache = createTavernStaticResourceCache({ rootDir: cacheDir })
let bytes = 0, failed = 0
for (const url of urls) {
  try {
    const asset = await cache.get(url)
    bytes += asset.bytes
  } catch (error) {
    failed++
    console.error(`预置失败：${url}：${error.message}`)
  }
}
console.log(`预置静态资源 ${urls.length - failed}/${urls.length} 个，${(bytes / 1024).toFixed(0)} KB`)
if (failed) process.exitCode = 1
