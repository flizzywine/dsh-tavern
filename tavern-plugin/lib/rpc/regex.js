// Regex manager: global rules, the conversation's preset/card rules and their
// session overrides. Parsing, ordering and replacement stay in the domain layer.
export function createRegexHandlers({ regexManager, str }) {
  return {
    async getRegexManager(args) {
      return await regexManager.read(str(args && args.sessionId))
    },
    async writeGlobalRegexes(args) {
      return await regexManager.writeGlobal({
        revision: str(args && args.revision),
        scripts: args && args.scripts
      })
    },
    async importRegexes(args) {
      return await regexManager.importGlobal({
        text: str(args && args.text),
        fileName: str(args && args.fileName),
        revision: str(args && args.revision)
      })
    },
    async setRegexOverride(args) {
      return await regexManager.setOverride({
        sessionId: str(args && args.sessionId),
        source: str(args && args.source),
        key: str(args && args.key),
        enabled: args && Object.prototype.hasOwnProperty.call(args, 'enabled') ? args.enabled : undefined
      })
    },
    async setRegexOverrides(args) {
      return await regexManager.setOverrides({
        sessionId: str(args && args.sessionId),
        changes: args && args.changes
      })
    },
    async previewRegexScripts(args) {
      return await regexManager.preview({
        text: args && args.text,
        scripts: args && args.scripts,
        placement: args && args.placement,
        depth: args && args.depth,
        isMarkdown: args && args.isMarkdown,
        isEdit: args && args.isEdit
      })
    }
  }
}
