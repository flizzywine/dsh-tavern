import { beginOrQueue } from '../domain/background-task-coordinator.js'
import { promptSection } from '../domain/prompt-section.js'
import { CHARACTER_DESIGN_SAVE_TOOL_NAME, createCharacterDesignDocumentSession, projectCharacterDesignDocument } from '../domain/character-design-document.js'
import { applyCharacterDesignWorldbook, characterDesignWorldbookSnapshot, characterWorldbookEntries, removeCharacterDesignWorldbook } from '../domain/character-design-worldbook.js'

export const CHARACTER_DESIGN_PLUGIN = 'dsh-tavern-character-design'

// The bundled plugin runs the job. Archive mutations still use the host's save and worldbook transactions.
export const characterDesignArchive = Object.freeze({
  beginOrQueue, promptSection, saveToolName: CHARACTER_DESIGN_SAVE_TOOL_NAME,
  createDraft: createCharacterDesignDocumentSession, project: projectCharacterDesignDocument,
  snapshotWorldbook: characterDesignWorldbookSnapshot, findWorldbookEntries: characterWorldbookEntries,
  applyWorldbook: applyCharacterDesignWorldbook, removeFromWorldbook: removeCharacterDesignWorldbook,
})
