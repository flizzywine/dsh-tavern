import { Worker } from 'node:worker_threads';
export function runCompiler(action, payload, { signal, timeout = action === 'compile' ? 20000 : 5000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192 } });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(signal.reason instanceof Error ? signal.reason : new Error('已取消'));
    const timer = setTimeout(() => finish(new Error('预设处理超时，已停止；请检查宏和正则')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.ok ? null : Object.assign(new Error(message.error), message.failure), message.result));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!done) finish(new Error('预设处理进程意外结束：' + code)); });
    worker.postMessage({ action, payload });
  });
}
