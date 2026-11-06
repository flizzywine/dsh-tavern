#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { launchWindowsUpdater } from './windows-update-launch.mjs'
import { redactUpdateDiagnostic } from './update-diagnostics.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  process.stderr.write('missing updater command\n')
  process.exit(2)
}

try {
  if (process.platform === 'win32') {
    // The updater's own PID lets the caller notice it dying before adopting the reservation.
    process.stdout.write(launchWindowsUpdater(command, args) + '\n')
  } else {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', env: process.env })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  }
} catch (error) {
  process.stderr.write(redactUpdateDiagnostic(error.message) + '\n')
  process.exitCode = 1
}
