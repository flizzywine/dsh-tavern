// The `subagent/descriptor` every Tavern background child publishes. The host reads it
// back with its own parser whenever a page opens the child: a payload it rejects (for
// example a field its mode does not allow) folds to "no identity", and the child's
// whole history then fails with "subagent descriptor is corrupt". So each descriptor
// is parsed by the host's parser once, where it is made, and a bad one never reaches a log.
import { foldSubagentDescriptor, snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

/**
 * Build one descriptor the host will read back.
 * @param input - mode, provider, label and (continuable only) composition fields.
 * @throws the host's own reason when the payload does not match its schema.
 */
export function subagentDescriptor(input) {
  const descriptor = snapshotSubagentDescriptor(input)
  foldSubagentDescriptor([{ type: 'subagent/descriptor', data: descriptor }])
  return descriptor
}

export const STAGE_DIRECTOR_PROVIDER = 'dsh-tavern-stage-director'
export const LEGACY_BACKGROUND_PROVIDER = 'dsh-tavern-background'

// One-shot children carry only version, mode, provider and label.
export const STAGE_DIRECTOR_DESCRIPTOR = subagentDescriptor({ mode: 'one-shot', provider: STAGE_DIRECTOR_PROVIDER, label: '舞台导演' })
export const WRITING_PREPARATION_PROVIDER = 'dsh-tavern-writing-preparation'
export const WRITING_PREPARATION_DESCRIPTOR = subagentDescriptor({ mode: 'continuable', provider: WRITING_PREPARATION_PROVIDER, label: '白手套 Agent' })
