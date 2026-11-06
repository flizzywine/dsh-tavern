// 批量导入聊天记录：每份记录各自建一个会话，按选择顺序逐份执行。单份失败只记录，不中断其余。
// Shared with the browser bundle (@include-domain): keep top-level names specific.

/** Import each entry in order; a failure is recorded against its file and the batch continues. */
async function chatImportBatchRun(entries, run, onProgress) {
  const succeeded = []
  const failed = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (onProgress) onProgress({ index, total: entries.length, entry })
    try {
      succeeded.push({ entry, result: await run(entry, index) })
    } catch (error) {
      failed.push({ entry, message: String((error && error.message) || error) })
    }
  }
  return { succeeded, failed }
}

/** Sidebar notice after a batch: silent on full success, otherwise names every failed file. */
function chatImportBatchSummary({ succeeded, failed }) {
  if (!failed.length) return ''
  const detail = failed.map(item => (item.entry && item.entry.fileName ? item.entry.fileName + '：' : '') + item.message).join('；')
  return (succeeded.length ? '已导入 ' + succeeded.length + ' 份，其余 ' + failed.length + ' 份失败——' : '导入失败——') + detail
}

/** The same warning from several files is listed once, with the files that raised it. */
function chatImportMergedWarnings(entries) {
  const grouped = new Map()
  for (const entry of entries) {
    for (const warning of entry.preview.warnings || []) {
      if (!grouped.has(warning)) grouped.set(warning, [])
      const files = grouped.get(warning)
      if (!files.includes(entry.fileName)) files.push(entry.fileName)
    }
  }
  return [...grouped].map(([warning, files]) => entries.length > 1 ? files.join('、') + '：' + warning : warning)
}

/** Aggregate per-file previews into the single confirmation the picker shows. */
function chatImportMergedPreview(entries) {
  return {
    count: entries.reduce((total, entry) => total + (entry.preview.count || 0), 0),
    hasMvu: entries.some(entry => entry.preview.hasMvu),
    incompatible: entries.some(entry => entry.preview.incompatible),
    // 各份称呼不同时留空：导入时每份沿用自己记录里的称呼，不被第一份覆盖。
    userName: entries.every(entry => entry.preview.userName === entries[0].preview.userName) ? entries[0].preview.userName : '',
    // 多份记录没有共同的“最后一条消息”，预览改为只报每份的条数。
    lastMessage: entries.length === 1 ? entries[0].preview.lastMessage : '',
    warnings: chatImportMergedWarnings(entries)
  }
}

export { chatImportBatchRun, chatImportBatchSummary, chatImportMergedWarnings, chatImportMergedPreview }
