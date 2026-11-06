import { randomUUID } from 'node:crypto'

const PROFILE_PATH = 'user-preference-profile.json'
const SPEC = 'dsh-tavern.user-preference-profile'
const VERSION = 2

function str(value, max = 8000) {
  return (value === undefined || value === null ? '' : String(value)).trim().slice(0, max)
}

function multiline(value, max) {
  return str(value, max).replace(/\\r\\n|\\n|\\r/g, '\n')
}

function integer(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function answers(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).map(function (item) {
    return { question: str(item && item.question, 2000), answer: str(item && item.answer, 6000) }
  }).filter(function (item) { return item.question !== '' || item.answer !== '' })
}

function dimensions(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 40).map(function (item) {
    const confidence = str(item && item.confidence, 20)
    return {
      id: str(item && item.id, 80),
      label: str(item && item.label, 120),
      conclusion: str(item && item.conclusion, 4000),
      confidence: ['confirmed', 'likely', 'uncertain'].includes(confidence) ? confidence : 'uncertain',
      evidence: str(item && item.evidence, 4000)
    }
  }).filter(function (item) { return item.id !== '' && item.conclusion !== '' })
}

function normalizeDraft(value, revision, now) {
  return {
    revision,
    rawAnswers: answers(value && value.rawAnswers),
    dimensions: dimensions(value && value.dimensions),
    summary: multiline(value && value.summary, 12000),
    injectionText: multiline(value && value.injectionText, 3000),
    uncertainties: Array.isArray(value && value.uncertainties)
      ? value.uncertainties.slice(0, 40).map(function (item) { return str(item, 1000) }).filter(Boolean)
      : [],
    updatedAt: now
  }
}

function document(value) {
  const current = value && typeof value === 'object' ? value : {}
  return {
    spec: SPEC,
    version: VERSION,
    revision: integer(current.revision),
    defaultEnabled: current.defaultEnabled === true,
    draft: current.draft && typeof current.draft === 'object' ? current.draft : null,
    confirmed: current.confirmed && typeof current.confirmed === 'object' ? current.confirmed : null,
    updatedAt: integer(current.updatedAt)
  }
}

function present(value) {
  const current = document(value)
  const draft = current.draft === null ? null : Object.assign({}, current.draft, {
    summary: multiline(current.draft.summary, 12000),
    injectionText: multiline(current.draft.injectionText, 3000)
  })
  const confirmed = current.confirmed === null ? null : Object.assign({}, current.confirmed, {
    summary: multiline(current.confirmed.summary, 12000),
    injectionText: multiline(current.confirmed.injectionText, 3000)
  })
  return {
    spec: current.spec,
    version: current.version,
    revision: current.revision,
    defaultEnabled: current.defaultEnabled,
    hasDraft: draft !== null,
    hasConfirmed: confirmed !== null,
    draft,
    confirmed,
    updatedAt: current.updatedAt
  }
}

/** Owns durable draft/confirmation boundaries for one Profile-wide preference model. */
function createSingleProfile({ store, now = Date.now }) {
  async function read() {
    return present(await store.readJson(PROFILE_PATH))
  }

  async function save(input) {
    if (Object.hasOwn(input, 'content')) {
      if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 3000) throw new Error('画像正文须为 1 至 3000 字')
      input = { ...input, summary: input.content, injectionText: input.content, rawAnswers: [], dimensions: [], uncertainties: [] }
    }
    const saved = await store.updateJson(PROFILE_PATH, value => {
      const current = document(value)
      const timestamp = now()
      const revision = current.revision + 1
      return { spec: SPEC, version: VERSION, revision,
        defaultEnabled: current.defaultEnabled, draft: null,
        confirmed: { ...normalizeDraft(input, revision, timestamp), profileRevision: revision, confirmedAt: timestamp },
        updatedAt: timestamp }
    })
    return present(saved)
  }

  async function saveDraft(input) {
    const saved = await store.updateJson(PROFILE_PATH, function (value) {
      const current = document(value)
      const timestamp = now()
      const revision = current.revision + 1
      return {
        spec: SPEC,
        version: VERSION,
        revision,
        defaultEnabled: current.defaultEnabled,
        draft: normalizeDraft(input, revision, timestamp),
        confirmed: current.confirmed,
        updatedAt: timestamp
      }
    })
    return present(saved)
  }

  async function confirm(input) {
    if (str(input && input.confirmation, 40) !== '确认保存用户画像') throw new Error('只有用户明确确认后才能保存用户画像')
    const expected = integer(input && input.draftRevision)
    const saved = await store.updateJson(PROFILE_PATH, function (value) {
      const current = document(value)
      if (current.draft === null) throw new Error('尚无可确认的用户画像草案')
      if (expected === 0 || integer(current.draft.revision) !== expected) throw new Error('用户画像草案已变化，请重新展示最新草案并确认')
      const timestamp = now()
      const revision = current.revision + 1
      return {
        spec: SPEC,
        version: VERSION,
        revision,
        defaultEnabled: current.defaultEnabled,
        draft: null,
        confirmed: Object.assign({}, current.draft, { profileRevision: revision, confirmedAt: timestamp }),
        updatedAt: timestamp
      }
    })
    return present(saved)
  }

  async function updateConfirmed(input) {
    const saved = await store.updateJson(PROFILE_PATH, function (value) {
      const current = document(value)
      if (current.confirmed === null) throw new Error('尚无可修改的已确认用户画像')
      const expected = integer(input && input.expectedRevision)
      if (expected === 0 || integer(current.confirmed.profileRevision) !== expected) throw new Error('用户画像已被其他操作修改，请刷新后重试')
      const timestamp = now()
      const revision = current.revision + 1
      const summary = multiline(input && input.summary, 12000)
      const injectionText = multiline(input && input.injectionText, 3000)
      if (summary === '' || injectionText === '') throw new Error('完整画像和实际注入摘要不能为空')
      return {
        spec: SPEC,
        version: VERSION,
        revision,
        defaultEnabled: current.defaultEnabled,
        draft: null,
        confirmed: Object.assign({}, current.confirmed, {
          revision,
          profileRevision: revision,
          summary,
          injectionText,
          confirmedAt: timestamp,
          updatedAt: timestamp
        }),
        updatedAt: timestamp
      }
    })
    return present(saved)
  }

  async function setDefaultEnabled(enabled) {
    const saved = await store.updateJson(PROFILE_PATH, function (value) {
      const current = document(value)
      if (enabled === true && current.confirmed === null) throw new Error('尚无已确认用户画像，无法默认启用')
      const timestamp = now()
      return {
        spec: SPEC,
        version: VERSION,
        revision: current.revision + 1,
        defaultEnabled: enabled === true,
        draft: current.draft,
        confirmed: current.confirmed,
        updatedAt: timestamp
      }
    })
    return present(saved)
  }

  async function stableContext() {
    const current = document(await store.readJson(PROFILE_PATH))
    if (current.confirmed === null) return null
    const text = multiline(current.confirmed.injectionText || current.confirmed.summary, 3000)
    if (text === '') return null
    return {
      revision: integer(current.confirmed.profileRevision || current.confirmed.revision),
      text: '【用户已确认的长期偏好】\n以下偏好只影响表现方式；人物卡设定和用户本轮明确要求优先。不要复述本段。\n\n' + text
    }
  }

  return Object.freeze({ read, save, saveDraft, confirm, updateConfirmed, setDefaultEnabled, stableContext })
}

/** Resolve the configured default, independently of the profile being edited. */
export async function defaultUserPreferenceProfile(profiles, selected) {
  if (!profiles) return null
  selected ??= await profiles.read()
  if (!selected || !Object.hasOwn(selected, 'defaultProfileId')) return selected
  return selected.defaultProfileId ? { ...await profiles.read(selected.defaultProfileId), defaultEnabled: true } : null
}


// Keep the existing draft/confirmation rules inside each independently named profile.
export function createUserPreferenceProfile({ store, now = Date.now }) {
  function collection(value) {
    if (value?.version === 3 && Array.isArray(value.profiles) && value.profiles.length) {
      const next = structuredClone(value)
      if (!Object.hasOwn(next, 'defaultProfileId')) next.defaultProfileId = next.profiles.find(item => item.id === next.selectedId)?.data.defaultEnabled ? next.selectedId : ''
      return next
    }
    return { spec: SPEC, version: 3, selectedId: 'default', defaultProfileId: value?.defaultEnabled === true ? 'default' : '', profiles: [{ id: 'default', name: '默认长期偏好', data: document(value) }] }
  }
  function entry(value, id) {
    const item = value.profiles.find(item => item.id === (id || value.selectedId))
    if (!item) throw new Error('用户画像不存在，请刷新后重试')
    return item
  }
  function model(id) {
    return createSingleProfile({ now, store: {
      readJson: async () => entry(collection(await store.readJson(PROFILE_PATH)), id).data,
      updateJson: async (_path, updater) => {
        let result
        await store.updateJson(PROFILE_PATH, async raw => {
          const value = collection(raw)
          const item = entry(value, id)
          // Globally increasing revisions prevent a stale confirmation targeting another profile.
          const revision = Math.max(...value.profiles.map(item => integer(item.data.revision)))
          result = await updater({ ...item.data, revision })
          item.data = result
          return value
        })
        return result
      }
    } })
  }
  async function read(id) {
    const value = collection(await store.readJson(PROFILE_PATH))
    const item = entry(value, id)
    return { ...present(item.data), defaultEnabled: value.defaultProfileId === item.id, profileId: item.id, name: item.name, selectedId: value.selectedId, defaultProfileId: value.defaultProfileId,
      profiles: value.profiles.map(item => ({ id: item.id, name: item.name, hasConfirmed: !!item.data.confirmed, confirmedRevision: integer(item.data.confirmed?.profileRevision) })) }
  }
  async function mutateProfile(action, input = {}) {
    const id = input.profileId || (await read()).profileId
    await model(id)[action](input)
    return await read(id)
  }
  async function manage(input) {
    await store.updateJson(PROFILE_PATH, raw => {
      const value = collection(raw)
      if (input.action === 'create') {
        const name = str(input.name, 100)
        if (!name) throw new Error('请输入画像名称')
        const id = randomUUID()
        let data = document(null)
        if (Object.hasOwn(input, 'content')) {
          if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 3000) throw new Error('长期偏好正文须为 1 至 3000 字')
          const revision = Math.max(...value.profiles.map(item => integer(item.data.revision))) + 1
          const timestamp = now()
          const content = input.content.trim()
          const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : content
          data = { ...data, revision, confirmed: { ...normalizeDraft({ summary, injectionText: content }, revision, timestamp), profileRevision: revision, confirmedAt: timestamp }, updatedAt: timestamp }
        }
        value.profiles.push({ id, name, data })
        value.selectedId = id
      } else if (input.action === 'select') {
        value.selectedId = entry(value, input.profileId).id
      } else if (input.action === 'default') {
        if (typeof input.profileId !== 'string') throw new Error('请选择默认画像')
        if (input.profileId && !entry(value, input.profileId).data.confirmed) throw new Error('请先确认画像')
        value.defaultProfileId = input.profileId
      } else if (input.action === 'rename') {
        const name = str(input.name, 100)
        if (!name) throw new Error('请输入画像名称')
        entry(value, input.profileId).name = name
      } else throw new Error('未知画像操作')
      return value
    })
    return await read()
  }
  async function stableContext(id) {
    const selected = await read(id)
    const context = await model(selected.profileId).stableContext()
    return context ? { ...context, profileId: selected.profileId } : null
  }
  return Object.freeze({ read, manage, stableContext,
    save: input => mutateProfile('save', input),
    saveDraft: input => mutateProfile('saveDraft', input),
    confirm: input => mutateProfile('confirm', input),
    updateConfirmed: input => mutateProfile('updateConfirmed', input),
    setDefaultEnabled: async (enabled, id) => {
      const selected = id || (await read()).profileId
      await model(selected).setDefaultEnabled(enabled)
      await manage({ action: 'default', profileId: enabled ? selected : '' })
      return await read(selected)
    }
  })
}
