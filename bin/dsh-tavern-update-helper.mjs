#!/usr/bin/env node

import { spawn } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  process.stderr.write('missing updater command\n')
  process.exit(2)
}

const child = spawn(command, args, {
  detached: true,
  windowsHide: true,
  stdio: 'ignore',
  env: process.env,
})
child.unref()
