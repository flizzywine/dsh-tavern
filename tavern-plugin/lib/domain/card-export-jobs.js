// The running card exports the 导出人物卡 sheet watches: the one place their progress and outcome are produced. The
// browser names an export (progressId) when it asks for it; the export then runs on its own (run), because packing and
// encrypting a card with large packs takes longer than one request may wait for its answer (the Desktop ends a request
// whose answer has not begun after five minutes). The browser polls `view(id)` and `cancel(id)` stops it: the next
// progress report throws, the export's own cleanup removes the half-written files.
// A view is {stage: 'pack' | 'encrypt', done, total, pack, startedAt} while it runs: bytes read into the archive (and
// through the encryption) out of `total`, the title of the pack being written ('' outside a pack) and when the export
// began; then {stage: 'done', result} (the file to download), or {stage: 'failed', error: {step, code, message}} with the
// sentence the player reads (cardExportFailureText). A finished job is read once; one nobody reads is dropped after ttlMs.
const PROGRESS_ID = /^[\w-]{8,64}$/
const STEP_NAMES = { pack: '打包', encrypt: '加密' }

/** The player's sentence for a failed step: what went wrong, the file, the system's reason and what to do next. */
export function cardExportFailureText(step, error) {
  const file = error?.path ? '：' + error.path : ''
  const reason = error?.code === 'ENOSPC' ? '磁盘空间不够' + file + '。清出空间后再导出一次。'
    : error?.code === 'ENOENT' ? '找不到文件' + file + '。这个素材包缺了这个文件，在素材库里修复或重新安装这个包后再导出。'
    : ['EACCES', 'EPERM', 'EBUSY'].includes(error?.code) ? '文件读写被系统拒绝（' + error.code + '）' + file + '。关掉占用它的程序后再导出一次。'
    : String(error?.message || error).replace(/[。.]?$/, '。')
  return STEP_NAMES[step] + '时出错：' + reason
}

export function createCardExportJobs({ now = Date.now, ttlMs = 60 * 60 * 1000, warn = () => {} } = {}) {
  const jobs = new Map()
  const sweep = () => { for (const [id, job] of jobs) if (job.endedAt && now() - job.endedAt > ttlMs) jobs.delete(id) }
  return {
    // Runs `work(report)` as the export named progressId and answers at once. report(patch) updates the progress and
    // throws once the export is cancelled; work resolves the file to download. A name in use or of the wrong shape is refused.
    run(progressId, work) {
      sweep()
      if (typeof progressId !== 'string' || !PROGRESS_ID.test(progressId) || jobs.has(progressId)) throw Object.assign(new Error('导出编号无效'), { code: 'TAVERN_EXPORT_INVALID' })
      const job = { stage: 'pack', done: 0, total: 0, pack: '', startedAt: now(), cancelled: false, endedAt: 0 }
      jobs.set(progressId, job)
      const report = patch => {
        if (job.cancelled) throw Object.assign(new Error('导出已取消'), { name: 'AbortError', code: 'TAVERN_EXPORT_CANCELLED' })
        Object.assign(job, patch)
      }
      void (async () => {
        try { job.result = await work(report) }
        catch (error) {
          if (job.cancelled) { jobs.delete(progressId); return }
          job.error = { step: job.stage, ...(typeof error?.code === 'string' && /^[A-Z][A-Z_]+$/.test(error.code) ? { code: error.code } : {}), message: cardExportFailureText(job.stage, error) }
          warn('dsh-tavern: 人物卡导出失败（%s）%s', job.stage, error?.stack || error)
        }
        job.endedAt = now()
        if (job.cancelled) jobs.delete(progressId)
      })()
      return { progressId }
    },
    view(progressId) {
      const job = jobs.get(progressId)
      if (!job) return null
      if (job.error) { jobs.delete(progressId); return { stage: 'failed', error: job.error } }
      if (job.result) { jobs.delete(progressId); return { stage: 'done', result: job.result } }
      return { stage: job.stage, done: job.done, total: job.total, pack: job.pack, startedAt: job.startedAt }
    },
    cancel(progressId) {
      const job = jobs.get(progressId)
      if (job) job.cancelled = true
      if (job?.endedAt) jobs.delete(progressId)
      return { cancelled: !!job }
    }
  }
}
