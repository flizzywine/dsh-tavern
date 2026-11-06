import {backgroundTimeVariant} from './asset-variants.js'
import {oneOf} from './asset-pack-json.js'

import timeParams from './stage-time-params.cjs'
export const {CORE_TIME_PARAMS}=timeParams

export function stageTimeLook(timeOfDay) {
  oneOf(timeOfDay, ['day','dusk','night',null], '$.timeOfDay')
  return {layer:'time',timeOfDay,params:CORE_TIME_PARAMS[timeOfDay] ?? CORE_TIME_PARAMS.day}
}
export function projectBackgroundTime(entry, timeOfDay) {
  const row = backgroundTimeVariant(entry, timeOfDay)
  const timeMatched = timeOfDay !== null && row?.id === timeOfDay
  return {media:(row?.content ?? entry).media,variant:row?.id ?? null,timeMatched,compensateBackground:!timeMatched,diagnostics:[]}
}
