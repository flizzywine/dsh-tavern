// 单独一个进程做加载校验：DSH 的 loader 一旦抛错，不能把引擎一起带下去。
// 入参：node preflight-worker.mjs <appRoot> <profileDir>
// 出参：一行 JSON { ok, fatal, ignored } 或 { ok:false, error }
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , appRoot, profileDir] = process.argv

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function bootModule(appRoot) {
  const dir = join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const main = typeof manifest.main === 'string' && manifest.main !== '' ? manifest.main : 'index.js'
  return join(dir, main.replace(/^\.\//, ''))
}

async function main() {
  if (typeof appRoot !== 'string' || typeof profileDir !== 'string') {
    emit({ ok: false, error: '用法：preflight-worker.mjs <appRoot> <profileDir>' })
    return
  }
  const { loadProfileDirectory } = await import(pathToFileURL(bootModule(appRoot)).href)
  if (typeof loadProfileDirectory !== 'function') {
    emit({ ok: false, error: '这个版本的 @deepseek-ai/dsh-app-boot 没有 loadProfileDirectory' })
    return
  }
  const profile = loadProfileDirectory('dsh-tavern-preflight', profileDir, join(appRoot, 'package.json'), { userLayer: false })
  const skipped = Array.isArray(profile?.skippedBundles) ? profile.skippedBundles : []
  emit({
    ok: true,
    skipped: skipped.map(item => ({ packageName: String(item?.packageName ?? ''), reason: String(item?.reason ?? '') })),
  })
}

try {
  await main()
} catch (error) {
  emit({ ok: false, error: String(error?.message ?? error) })
  process.exitCode = 0
}
