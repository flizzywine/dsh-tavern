import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('native direct-send options cannot remove their retained story tail', { timeout: 30000 }, () => {
  execFileSync(process.execPath, ['tests/browser/native-option-retention-browser-smoke.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    timeout: 25000,
    stdio: 'pipe'
  })
})
