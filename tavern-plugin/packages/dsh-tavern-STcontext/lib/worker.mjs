import { parentPort } from 'node:worker_threads';
import { compilePreset, processOutput } from './preset.mjs';
parentPort.once('message', ({ action, payload }) => {
  try {
    const result = action === 'compile' ? compilePreset(payload.document, payload.materials, payload.settings)
      : action === 'output' ? processOutput(payload) : (() => { throw new Error('未知编译任务'); })();
    parentPort.postMessage({ ok: true, result });
  } catch (error) { parentPort.postMessage({ ok: false, error: String(error?.message || error),
    ...(error?.code?.startsWith('STCONTEXT_') ? { failure: { code: error.code, stage: error.stage, details: error.details } } : {}) }); }
});
