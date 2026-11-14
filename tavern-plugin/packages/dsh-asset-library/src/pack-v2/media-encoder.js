import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// The one way to use sharp from this package. The host already loads its own, differently versioned sharp/libvips
// (both are named libvips-42.dll), and two versions in one process break the host's image saving. A worker thread
// would still share the DLLs, so every native image operation runs in its own process; never import sharp here.
export function runMediaEncoder(args, bytes, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./thumbnail-encoder.js', import.meta.url)), ...args.map(String)], {
      windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}, timeout
    })
    const output = [], errors = []
    child.stdout.on('data', chunk => output.push(chunk))
    child.stderr.on('data', chunk => errors.push(chunk))
    child.on('error', reject)
    child.stdin.on('error', reject)
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString() || 'Media encoder exited: ' + code)))
    child.stdin.end(bytes)
  })
}
