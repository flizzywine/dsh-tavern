import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('native option forms fill the composer without navigating the tail frame', { timeout: 30000 }, () => {
  execFileSync(process.execPath, ['tests/browser/native-option-form-browser-smoke.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    timeout: 25000,
    stdio: 'pipe'
  })
})
