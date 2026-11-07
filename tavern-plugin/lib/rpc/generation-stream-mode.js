// Native composer model-menu preference; shared by subsequent foreground and background calls.
export function createGenerationStreamModeHandlers({ generationStreamModes }) {
  return {
    async getGenerationStreamMode() {
      return { stream: await generationStreamModes.get() }
    },
    async setGenerationStreamMode(args) {
      return { stream: await generationStreamModes.set(args?.stream) }
    },
  }
}
