import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { patchViewportMetaSource } from '../tavern-plugin/lib/domain/web-viewport-meta.js'
import { findHostViewportPage, installHostViewportPatch, patchHostViewportFile } from '../tavern-plugin/lib/domain/host-viewport-patch.js'

const host = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DeepSeek Harness</title>
  </head>
  <body><div id="root"></div></body>
</html>
`

test('宿主网页外壳换成 resizes-content：键盘动画期间布局视口跟着缩', () => {
  const result = patchViewportMetaSource(host)
  assert.equal(result.status, 'patched')
  assert.match(result.text, /<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" \/>/)
  // 其余部分逐字保留。
  assert.equal(result.text, host.replace('initial-scale=1"', 'initial-scale=1, interactive-widget=resizes-content"'))
})

test('已经声明 resizes-content 时不动它', () => {
  const source = '<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">'
  assert.deepEqual(patchViewportMetaSource(source), { status: 'already' })
})

test('上游写的是 resizes-visual 时改掉取值，不追加第二个属性', () => {
  const result = patchViewportMetaSource('<meta name="viewport" content="width=device-width, interactive-widget=resizes-visual">')
  assert.equal(result.status, 'patched')
  assert.equal(result.text.match(/interactive-widget=/g).length, 1)
  assert.match(result.text, /interactive-widget=resizes-content/)
})

test('单引号与多余空格都保留原始写法', () => {
  const result = patchViewportMetaSource("<meta name='viewport' content='width=device-width, initial-scale=1, '>")
  assert.equal(result.status, 'patched')
  assert.match(result.text, /content='width=device-width, initial-scale=1, interactive-widget=resizes-content'/)
})

test('不是网页外壳（没有 viewport）就保持原样', () => {
  assert.deepEqual(patchViewportMetaSource('<!doctype html><p>酒馆正在启动</p>'), { status: 'unmatched' })
  assert.deepEqual(patchViewportMetaSource('<meta name="viewport">'), { status: 'unmatched' })
  assert.deepEqual(patchViewportMetaSource(null), { status: 'unmatched' })
})

test('就地改写宿主页面文件，重复执行不会二次追加', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-viewport-'))
  try {
    const file = path.join(dir, 'index.html')
    await writeFile(file, host)
    assert.equal(patchHostViewportFile(file), true)
    const patched = await readFile(file, 'utf8')
    assert.match(patched, /interactive-widget=resizes-content/)
    assert.equal(patchHostViewportFile(file), false)
    assert.equal(await readFile(file, 'utf8'), patched)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('认不出宿主页面时返回 null，宿主没装这个包也不会抛错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-viewport-'))
  try {
    const file = path.join(dir, 'index.html')
    await writeFile(file, '<!doctype html><p>不是外壳</p>')
    assert.equal(patchHostViewportFile(file), null)
    assert.equal(patchHostViewportFile(path.join(dir, 'missing.html')), null)
    assert.equal(patchHostViewportFile(null), null)
    assert.equal(findHostViewportPage(path.join(dir, 'nope.js')), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('按宿主安装根找到真正下发的那个 index.html', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-host-'))
  try {
    const tools = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
    const page = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
    await mkdir(path.dirname(tools), { recursive: true })
    await mkdir(path.dirname(page), { recursive: true })
    await writeFile(tools, 'export default {}')
    await writeFile(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-web-frontend', exports: { './dist/*': './dist/*', './package.json': './package.json' },
    }))
    await writeFile(page, host)
    assert.equal(findHostViewportPage(tools), page)
    assert.equal(patchHostViewportFile(page), true)
    assert.match(await readFile(page, 'utf8'), /interactive-widget=resizes-content/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('改写不碰 pnpm store：硬链接的原文件保持原样', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-store-'))
  try {
    const store = path.join(dir, 'store-index.html')
    await writeFile(store, host)
    const file = path.join(dir, 'index.html')
    await link(store, file)
    assert.equal(patchHostViewportFile(file), true)
    assert.match(await readFile(file, 'utf8'), /interactive-widget=resizes-content/)
    assert.equal(await readFile(store, 'utf8'), host, 'store 里的共享 inode 不能被就地改掉')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('发布版运行时的 bin/dsh 是符号链接，也能顺着找到网页外壳', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-runtime-'))
  try {
    // 复刻 runtime/bin/dsh -> ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js 的布局：
    // lib/node_modules 不在 node 的逐级查找路径上，必须靠符号链接的真实位置去拼。
    const bin = path.join(dir, 'bin')
    const libDsh = path.join(dir, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
    const page = path.join(dir, 'lib', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
    await mkdir(bin, { recursive: true })
    await mkdir(libDsh, { recursive: true })
    await mkdir(path.dirname(page), { recursive: true })
    await writeFile(path.join(libDsh, 'bin.js'), 'export default {}')
    await writeFile(path.join(dir, 'lib', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-web-frontend', exports: { './dist/*': './dist/*', './package.json': './package.json' },
    }))
    await writeFile(page, host)
    try {
      await symlink(path.join('..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), path.join(bin, 'dsh'))
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows file symlinks require permission')
      throw error
    }
    assert.equal(findHostViewportPage(path.join(bin, 'dsh')), page)
    assert.equal(patchHostViewportFile(page), true)
    assert.match(await readFile(page, 'utf8'), /interactive-widget=resizes-content/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('第一个宿主邻居缺网页时继续查找其他宿主邻居', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-viewport-neighbors-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pluginAnchor = path.join(dir, 'plugin', 'package.json')
  const scope = path.join(path.dirname(pluginAnchor), 'node_modules', '@deepseek-ai')
  await mkdir(scope, { recursive: true })
  await writeFile(pluginAnchor, '{}')
  for (const [tree, name] of [['unrelated', 'dsh-tools'], ['host', 'dsh-agent']]) {
    const dependency = path.join(dir, tree, 'node_modules', '@deepseek-ai', name)
    await mkdir(dependency, { recursive: true })
    await writeFile(path.join(dependency, 'index.js'), '')
    await symlink(dependency, path.join(scope, name), 'junction')
  }
  const frontend = path.join(dir, 'host', 'node_modules', '@deepseek-ai', 'dsh-web-frontend')
  const page = path.join(frontend, 'dist', 'index.html')
  await mkdir(path.dirname(page), { recursive: true })
  await writeFile(path.join(frontend, 'package.json'), '{}')
  await writeFile(page, host)
  assert.equal(installHostViewportPatch(null, { pluginAnchor, env: {}, argv: [] }), true)
  assert.match(await readFile(page, 'utf8'), /interactive-widget=resizes-content/)
})
