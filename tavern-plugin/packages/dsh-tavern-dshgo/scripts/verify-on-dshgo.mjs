#!/usr/bin/env node
// 一条命令的体检：node scripts/verify-on-dshgo.mjs
import { formatChecks, runChecks } from '../lib/verify.js'

const argv = process.argv.slice(2)
function value(flag) {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const home = value('--dsh-home') ?? process.env.DSH_HOME ?? '/root/.dsh'
const appRoot = value('--app-root') ?? process.env.DSH_APP_ROOT ?? '/opt/dsh'
console.log(formatChecks(runChecks({ home, appRoot })))
