import { after } from 'node:test'
import { mkdtemp as createDirectory, rm } from 'node:fs/promises'

const directories = []

// File-level teardown runs after test-owned services and child processes stop.
after(async () => {
  for (const directory of directories.reverse()) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

export async function mkdtemp(prefix, options) {
  const directory = await createDirectory(prefix, options)
  directories.push(directory)
  return directory
}
