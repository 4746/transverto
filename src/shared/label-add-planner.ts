import type {
  ILabelAddConflict,
  ILabelAddPlan,
  ILabelAddProjectSnapshot,
} from './entities/label-add.js'

import {inspectSyncPath} from './sync.repository.js'

export interface ILabelAddPlanInput {
  autoTranslate: boolean
  key: string
  source: string
  sourceText: string
}

export interface ILabelAddKeyInspection {
  readonly conflicts: readonly ILabelAddConflict[]
  readonly existing: readonly string[]
}

export const inspectLabelAddKey = (
  snapshot: ILabelAddProjectSnapshot,
  key: string,
): ILabelAddKeyInspection => {
  const conflicts: ILabelAddConflict[] = []
  const existing: string[] = []

  for (const dictionary of snapshot.dictionaries) {
    const state = inspectSyncPath(dictionary.dictionary, key)
    if (state.kind === 'leaf') existing.push(dictionary.code)
    else if (state.kind !== 'missing') {
      conflicts.push({key, language: dictionary.code, reason: 'path_conflict'})
    }
  }

  return Object.freeze({
    conflicts: Object.freeze(conflicts),
    existing: Object.freeze(existing),
  })
}

const create = (
  snapshot: ILabelAddProjectSnapshot,
  input: ILabelAddPlanInput,
): ILabelAddPlan => {
  if (!snapshot.config.languages.includes(input.source)) {
    throw new Error(`Source language "${input.source}" is not configured.`)
  }

  const conflicts: ILabelAddPlan['conflicts'][number][] = []
  const emptyTargets: string[] = []
  const preserved: string[] = []
  const requests: ILabelAddPlan['requests'][number][] = []

  for (const dictionary of snapshot.dictionaries) {
    const state = inspectSyncPath(dictionary.dictionary, input.key)
    if (dictionary.code === input.source) {
      if (state.kind !== 'leaf' && state.kind !== 'missing') {
        conflicts.push({key: input.key, language: dictionary.code, reason: 'path_conflict'})
      }

      continue
    }

    if (state.kind === 'leaf') {
      preserved.push(dictionary.code)
    } else if (state.kind === 'missing') {
      if (input.autoTranslate) {
        requests.push({
          from: input.source,
          key: input.key,
          sourceText: input.sourceText,
          to: dictionary.code,
        })
      } else {
        emptyTargets.push(dictionary.code)
      }
    } else {
      conflicts.push({key: input.key, language: dictionary.code, reason: 'path_conflict'})
    }
  }

  return Object.freeze({
    autoTranslate: input.autoTranslate,
    conflicts: Object.freeze(conflicts),
    emptyTargets: Object.freeze(emptyTargets),
    key: input.key,
    languages: Object.freeze(snapshot.dictionaries.map(dictionary => dictionary.code)),
    preserved: Object.freeze(preserved),
    requests: Object.freeze(requests.map(request => Object.freeze(request))),
    source: input.source,
    sourceText: input.sourceText,
  })
}

export const LabelAddPlanner = {create}
