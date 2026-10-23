import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sourceFunction } from './fixtures/source-function.mjs'

// Host 0.2.1 exposes message pictures only through the Content Factory; the
// plugin used to call props.renderMessageImages, which no longer exists and
// crashed every user row that carried an attachment.
const messageFrame = readFileSync(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const render = new Function(sourceFunction(messageFrame, 'renderTavernMessageImages') + '\nreturn renderTavernMessageImages')()
const attachment = { attachmentId: 'probe-image' }

test('图片走宿主 Content Factory 座位，带着授权加载器和对齐信息', () => {
  const calls = []
  const loadImage = () => Promise.resolve('data:image/png;base64,')
  const node = render({ renderFactorySlot(name, input) { calls.push({ name, input }); return 'gallery' }, loadImage }, [{ attachment }], 'end')
  assert.equal(node, 'gallery')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'conversation.images.content')
  assert.equal(calls[0].input.align, 'end')
  assert.equal(calls[0].input.loadImage, loadImage)
  assert.deepEqual(calls[0].input.images, [{ attachment }])
})

test('旧宿主的 renderMessageImages 仍然可用，两者都缺失时安静降级', () => {
  assert.deepEqual(render({ renderMessageImages: input => ['legacy', input.align] }, [{ attachment }], 'start'), ['legacy', 'start'])
  assert.equal(render({}, [{ attachment }], 'start'), null)
  assert.equal(render({ renderFactorySlot() { throw new Error('must not run') } }, [], 'start'), null)
})

test('用户与助手消息不再直接调用 renderMessageImages 座位', () => {
  assert.ok(!/props\.renderMessageImages\(/.test(renderer))
  assert.match(renderer, /renderTavernMessageImages\(props, parts\.images, "end"\)/)
  assert.match(messageFrame, /renderFactorySlot\("conversation\.images\.content"/)
})
