import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const preload = fileURLToPath(new URL('../android/native/shims/android-preload.cjs', import.meta.url))

// APK 里没有 bash：DSH 的 bash 工具执行 `bash -c` 时应落到系统 sh，卡片 Agent 仍能删文件。
test('android preload runs bash tool commands with the system shell when bash is absent', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'preload-shell-'))
  try {
    const bin = path.join(dir, 'bin')
    mkdirSync(bin)
    symlinkSync(spawnSync('sh', ['-c', 'command -v rm'], { encoding: 'utf8' }).stdout.trim(), path.join(bin, 'rm'))
    const target = path.join(dir, 'card.json')
    writeFileSync(target, '{}')
    const probe = `const r=require('node:child_process').spawnSync('bash',['--noprofile','--norc','-c',process.argv[1]],{env:{PATH:${JSON.stringify(bin)}},encoding:'utf8'});process.stdout.write(JSON.stringify({status:r.status,out:r.stdout}))`
    const out = spawnSync(process.execPath, ['--require', preload, '-e', probe, `rm ${JSON.stringify(target)} && echo ok`], {
      env: { ...process.env, DSH_ANDROID_SHELL: '/bin/sh' }, encoding: 'utf8'
    })
    assert.deepEqual(JSON.parse(out.stdout), { status: 0, out: 'ok\n' })
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
