import { parentPort, workerData } from 'node:worker_threads'
import { createChatJournalStore } from './chat-journal-store.js'
try {
  const store = createChatJournalStore({dataRoot:workerData.dataRoot,maxSnapshotBytes:workerData.maxSnapshotBytes,maxCachedChats:0})
  parentPort.postMessage(await store.prepareSnapshot(workerData.chatId,workerData.revision))
} catch (error) {
  parentPort.postMessage({error:error.message})
  process.exitCode = 1
}
