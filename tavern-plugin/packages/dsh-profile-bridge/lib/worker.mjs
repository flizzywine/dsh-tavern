import { readFileSync, appendFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { waitForExit, switchProfile } from './helper.mjs'
const job = process.argv[2]
const request = JSON.parse(readFileSync(job, 'utf8'))
const log = message => appendFileSync(join(request.stateDir, 'last-run.log'), new Date().toISOString() + ' ' + message + '\n')
try {
  log('已排队，请正常退出官方桌面；不会强制结束进程。')
  await waitForExit(request.pids)
  log(JSON.stringify(switchProfile(request)))
  log('切换完成，请重新打开官方桌面。')
} catch (error) {
  log('ERROR: ' + error.message)
  process.exitCode = 1
} finally {
  unlinkSync(job)
  rmdirSync(dirname(job))
}
