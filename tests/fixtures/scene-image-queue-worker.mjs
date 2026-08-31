import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageQueue } from '../../tavern-plugin/lib/domain/scene-image-queue.js'

const queue = createSceneImageQueue({ store: createProfileDataStore({ dataRoot: process.argv[2] }) })
const controller = new AbortController()
let release
const held = new Promise(resolve => { release = resolve })
process.on('message', message => {
  if (message === 'release') release()
  if (message === 'cancel') controller.abort()
})
try {
  await queue.run({ requestId: process.argv[3], signal: controller.signal }, async () => {
    process.send({ event: 'entered' })
    await held
  })
  process.send({ event: 'done' })
} catch (error) { process.send({ event: 'failed', error: error.message }) }
finally { process.disconnect() }
