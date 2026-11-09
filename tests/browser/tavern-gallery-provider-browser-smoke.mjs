// Gallery provider 接口的回归检查。
// 运行：node tests/browser/tavern-gallery-provider-browser-smoke.mjs
//
// 这里的重点不是画界面，而是接口契约：
//   - tavern.capabilities 里声明 galleryProvider: 1，插件能探测到；
//   - tavern.registerGalleryProvider 只收 { list, read, remove } 三个函数，
//     缺一个就 TypeError，重复注册抛错，dispose 之后可以重新注册；
//   - 来源按插件 owner 隔离，一个来源抛错不影响别的；
//   - 后端路由与媒体视图都认这个来源。
// 这些是「第三方插件把本地图片接进画廊」的地基，破了就整条链路不工作，
// 所以放在 CI 里静态 + 契约双查，不需要真浏览器。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createTavernPluginApi } from '../../tavern-plugin/lib/plugin-api.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const readPlugin = (...segments) => readFileSync(join(root, 'tavern-plugin', 'lib', ...segments), 'utf8')

const pluginApi = readPlugin('plugin-api.js')
const routes = readPlugin('http', 'routes.js')
const mediaViews = readFileSync(join(root, 'tavern-plugin', 'lib', 'domain', 'plugin-media-views.js'), 'utf8')

test('capabilities 声明 galleryProvider: 1，插件可以探测', () => {
  const { service: tavern } = createTavernPluginApi({})
  assert.equal(tavern.capabilities.galleryProvider, 1)
})

test('registerGalleryProvider 要求 list / read / remove 都是函数', () => {
  assert.match(pluginApi, /registerGalleryProvider\(\{\s*list,\s*read,\s*remove\s*\}\s*=\s*\{\}\)/, '签名应当是解构出来的三个回调')
  assert.match(pluginApi, /typeof list !== 'function' \|\| typeof read !== 'function' \|\| typeof remove !== 'function'/, '三个回调都要校验')
  assert.match(pluginApi, /list、read、remove 都必须是函数/, '缺函数时应当给出明确原因')
})

test('来源按插件 owner 隔离，重复注册被拒，dispose 后可重新注册', () => {
  assert.match(pluginApi, /const owner = ownerOf\(this\)/, '注册时按调用方插件取 owner')
  assert.match(pluginApi, /galleryProviders\.has\(owner\)/, '同一个插件不允许注册两个来源')
  assert.match(pluginApi, /本插件已经注册了画廊来源/, '重复注册要有可读的错误')
  assert.match(pluginApi, /entry\.active = false/, 'dispose 后来源应标记为非活跃')
  assert.match(pluginApi, /galleryProviders\.delete\(owner\)/, 'dispose 后应从表里移除')
  assert.match(pluginApi, /const galleryProviders = new Map\(\)/, '来源表应是按 owner 索引的 Map')
})

test('来源异常不牵连其它来源：读取走逐个 try', () => {
  // 只要列表聚合对每个来源单独兜底，某个插件抛错就不会让整页画廊变空。
  const aggregate = pluginApi.slice(pluginApi.indexOf('galleryProviders'))
  assert.match(aggregate, /catch/, '聚合来源列表时需要 catch，避免一个来源坏掉拖垮全部')
})

test('后端暴露画廊来源的路由', () => {
  assert.match(routes, /gallery/i, '路由文件里要出现画廊来源相关的处理')
})

test('媒体视图认 galleryProvider 来源', () => {
  assert.match(
    mediaViews,
    /gallery|GalleryProvider|galleryProvider/,
    'plugin-media-views 需要能表达「这张图来自插件的本地画廊」',
  )
})

test('接口不接受任意文件路径或远程 URL', () => {
  // 描述里承诺只收「已登记来源当前列表中的图片编号和本地图片字节」，
  // 所以读取实现里不该出现直接读任意路径或抓 URL 的调用。
  const scoped = pluginApi.slice(pluginApi.indexOf('registerGalleryProvider'), pluginApi.indexOf('registerGalleryProvider') + 6000)
  assert.doesNotMatch(scoped, /readFile\(\s*id\b/, '不应把传入的编号直接当文件路径读')
  assert.doesNotMatch(scoped, /https?:\/\//, '接口不该接受远程 URL')
  assert.doesNotMatch(scoped, /fetch\(/, '接口不该自己发网络请求')
})
