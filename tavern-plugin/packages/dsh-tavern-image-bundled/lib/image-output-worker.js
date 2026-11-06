import { parentPort, workerData } from 'node:worker_threads'
import { transcodeImageOutput } from './image-output.js'

const result = transcodeImageOutput(Buffer.from(workerData.bytes), workerData.mediaType, workerData.config, { maxOutputBytes: workerData.maxOutputBytes })
const bytes = Uint8Array.from(result.bytes)
parentPort.postMessage({ ...result, bytes }, [bytes.buffer])
