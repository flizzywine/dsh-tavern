import { realpath } from 'node:fs/promises'

async function sameSkillFile(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (left === right) return true
  try {
    // The host canonicalizes paths; the library may retain a junction/root alias.
    const [a, b] = await Promise.all([realpath(left), realpath(right)])
    return a === b
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

// The native registry retains its catalog, scope cache, watchers and skill loader.
// This provider narrows filesystem candidates to the calling Tavern Agent's role.
export function createTavernSkillProvider({ providers, library, roleFor, enabledFor = async () => true }) {
  const name = 'tavern'
  async function allowed(candidate, lookup) {
    const role = await roleFor(lookup.scope)
    if (!role) return false
    const skill = await library.read(candidate.name)
    return Boolean(skill) && skill.agents.includes(role) && await sameSkillFile(skill.path, candidate.path) && await enabledFor(skill, lookup.scope)
  }
  async function effective(skill) {
    const current = await library.read(skill.name)
    return { ...skill, description: current.description, invocation: { ...skill.invocation, modelInvocable: current.modelInvocable, userInvocable: current.userInvocable }, ...(skill.content === undefined ? {} : { content: current.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim() }) }
  }
  return {
    name,
    async list(lookup) {
      const candidates = []
      let complete = true
      for (let index = 0; index < providers.length; index++) {
        const result = await providers[index].list(lookup)
        complete = complete && (Array.isArray(result) || result.complete)
        for (const candidate of Array.isArray(result) ? result : result.candidates) {
          if (await allowed(candidate, lookup)) candidates.push({ ...await effective(candidate), provider: name, locator: { index, candidate } })
        }
      }
      return { candidates, complete }
    },
    async get(candidate, lookup) {
      const original = candidate.locator.candidate
      if (!await allowed(original, lookup)) return undefined
      const skill = await providers[candidate.locator.index].get(original, lookup)
      return skill ? { ...await effective(skill), provider: name } : undefined
    }
  }
}
