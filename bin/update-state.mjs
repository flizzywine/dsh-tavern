import path from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import installationState from './installation-state.cjs'
import { recordUpdateDiagnostic } from './update-diagnostics.mjs'

// Every participant uses the same pending-snapshot protocol. In particular, a
// Windows deferred UI write must never shadow a raw installer terminal rename.
export function createUpdateState(statusFile, dshHome) {
  if (!statusFile) return { read: async () => undefined, write: async value => value }
  const store = createProfileDataStore({ dataRoot: path.dirname(statusFile) })
  const filename = path.basename(statusFile)
  return {
    read: () => store.readJson(filename),
    async write(value, guard = {}) {
      const { attemptId, expectedAttemptId, onlyIf } = guard
      let written = false
      let result
      for (let retry = 0; ; retry++) {
        try {
          result = await store.updateJson(filename, current => {
            const owner = installationState.readInstallation(dshHome)
            if (attemptId && owner?.attemptId !== attemptId) return undefined
            if (Object.hasOwn(guard, 'expectedAttemptId') && current?.attemptId !== expectedAttemptId) return undefined
            if (!attemptId && owner) return undefined
            if (onlyIf && !onlyIf(current)) return undefined
            written = true
            return typeof value === 'function' ? value(current) : value
          })
          break
        } catch (error) {
          if (error.code !== 'DSH_TAVERN_WRITE_CONFLICT' || retry >= 400) throw error
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      if (written) recordUpdateDiagnostic(path.dirname(statusFile), { event: 'status', ...result })
      return result
    },
  }
}
