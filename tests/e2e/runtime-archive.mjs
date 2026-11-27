import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

const source = fileURLToPath(new URL('../../', import.meta.url))
const [, , archivePath, manifestPath] = process.argv
assert.ok(archivePath && manifestPath && process.env.TAVERN_E2E_RUNTIME,
  '用法：TAVERN_E2E_RUNTIME=<独立 DSH> node tests/e2e/runtime-archive.mjs <runtime.zip> <清单.json>')
const runtimeModules = resolve(process.env.TAVERN_E2E_RUNTIME, 'lib/node_modules')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const files = readZipEntries(await readFile(archivePath), { label: 'Tavern runtime' })
assert.equal(files.size, manifest.files.length, 'ZIP 与清单的文件数不一致')

const scratch = await mkdtemp(join(tmpdir(), 'tavern-publish-smoke-'))
try {
  const app = join(scratch, 'app')
  for (const file of manifest.files) {
    const target = resolve(app, file.path)
    assert.ok(target.startsWith(app + sep), `ZIP 路径无效：${file.path}`)
    const bytes = files.get(file.path)
    assert.ok(bytes, `ZIP 缺少 ${file.path}`)
    assert.equal(bytes.length, file.size, `${file.path} 大小错误`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path} 校验失败`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  const modules = join(app, 'node_modules')
  const checkoutModules = join(source, 'node_modules')
  const { devDependencies } = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  await mkdir(modules)
  await symlink(join(runtimeModules, '@deepseek-ai'), join(modules, '@deepseek-ai'), 'junction')
  for (const entry of await readdir(checkoutModules)) {
    if (entry.startsWith('.') || entry === '@deepseek-ai') continue
    const dependency = devDependencies[entry]
    const target = dependency?.startsWith('link:') ? resolve(app, dependency.slice(5)) : join(checkoutModules, entry)
    await symlink(target, join(modules, entry), 'junction')
  }

  const child = spawn(process.execPath, [fileURLToPath(new URL('gameplay.mjs', import.meta.url)), '--startup-smoke'], {
    cwd: source,
    env: { ...process.env, TAVERN_E2E_APPLICATION_SOURCE: app, TAVERN_E2E_PLUGIN_SOURCE: '',
      TAVERN_E2E_HOME: '', TAVERN_E2E_RESTORE_DATA: '', TAVERN_E2E_KEEP: '',
      TAVERN_E2E_OUTPUT: process.env.TAVERN_E2E_OUTPUT || join(scratch, 'artifacts') },
    stdio: 'inherit'
  })
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  assert.equal(status, 0, '发布包启动验收失败')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
