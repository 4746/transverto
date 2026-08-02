import type {
  ISyncAction,
  ISyncPlan,
  ISyncProjectSnapshot,
  TSyncActionReason,
  TSyncActionType,
  TSyncExtraPolicy,
} from './entities/sync.js'
import type {ITranslationRequestPlan} from './entities/translation.engine.js'
import type {IKeyFilters} from './key-pattern.js'

import {SYNC_EXTRA_POLICIES} from './entities/sync.js'
import {matchesKeyFilters, normalizeKeyPatterns} from './key-pattern.js'
import {inspectSyncPath} from './sync.repository.js'

export interface ISyncPlanOptions {
  autoTranslate: boolean
  exclude?: string[]
  extra?: TSyncExtraPolicy
  include?: string[]
}

interface IActionInput {
  key: string
  language: string
  reason: TSyncActionReason
  sourceValue: null | string
  targetValue: null | string
  type: TSyncActionType
}

interface IPlanningContext {
  actions: ISyncAction[]
  filters: IKeyFilters
  identities: Set<string>
  snapshot: ISyncProjectSnapshot
}

const freezeAction = (input: IActionInput): ISyncAction => Object.freeze({...input})

const actionId = (action: Pick<ISyncAction, 'key' | 'language'>): string =>
  `${action.language}\u0000${action.key}`

const appendAction = (
  actions: ISyncAction[],
  identities: Set<string>,
  input: IActionInput,
): void => {
  const action = freezeAction(input)
  const identity = actionId(action)
  if (identities.has(identity)) {
    throw new Error(`Duplicate sync action for "${action.language}:${action.key}".`)
  }

  identities.add(identity)
  actions.push(action)
}

const planSourceKeys = (
  context: IPlanningContext,
  targetIndex: number,
  autoTranslate: boolean,
): void => {
  const target = context.snapshot.targets[targetIndex]

  for (const [key, sourceValue] of context.snapshot.source.flat) {
    if (!matchesKeyFilters(key, context.filters)) continue
    const state = inspectSyncPath(target.dictionary, key)

    if (state.kind === 'leaf') {
      appendAction(context.actions, context.identities, {
        key,
        language: target.code,
        reason: 'existing',
        sourceValue,
        targetValue: state.value,
        type: 'keep',
      })
    } else if (state.kind === 'missing') {
      appendAction(context.actions, context.identities, {
        key,
        language: target.code,
        reason: 'missing',
        sourceValue,
        targetValue: null,
        type: autoTranslate ? 'translate' : 'add',
      })
    } else {
      appendAction(context.actions, context.identities, {
        key,
        language: target.code,
        reason: 'path_conflict',
        sourceValue,
        targetValue: null,
        type: 'conflict',
      })
    }
  }
}

const planExtraKeys = (
  context: IPlanningContext,
  targetIndex: number,
  extra: TSyncExtraPolicy,
): void => {
  const target = context.snapshot.targets[targetIndex]

  for (const [key, targetValue] of target.flat) {
    if (context.snapshot.source.flat.has(key) || !matchesKeyFilters(key, context.filters)) continue
    const type = extra === 'remove' ? 'remove' : 'keep'
    const reason = extra === 'remove'
      ? 'extra_removed'
      : extra === 'report' ? 'extra_reported' : 'extra_kept'

    appendAction(context.actions, context.identities, {
      key,
      language: target.code,
      reason,
      sourceValue: null,
      targetValue,
      type,
    })
  }
}

const createPlan = (
  snapshot: ISyncProjectSnapshot,
  options: ISyncPlanOptions,
): ISyncPlan => {
  if (snapshot.targets.length === 0) throw new Error('At least one target language is required.')

  const extra = options.extra ?? 'report'
  if (!(SYNC_EXTRA_POLICIES as readonly string[]).includes(extra)) {
    throw new Error(`Invalid extra-key policy "${extra}".`)
  }

  const normalizedFilters = normalizeKeyPatterns(options.include, options.exclude)
  const filters = Object.freeze({
    exclude: Object.freeze([...normalizedFilters.exclude]) as unknown as string[],
    include: Object.freeze([...normalizedFilters.include]) as unknown as string[],
  })
  const actions: ISyncAction[] = []
  const identities = new Set<string>()
  const context = {actions, filters, identities, snapshot}

  for (const [targetIndex] of snapshot.targets.entries()) {
    planSourceKeys(context, targetIndex, options.autoTranslate)
    planExtraKeys(context, targetIndex, extra)
  }

  return Object.freeze({
    actions: Object.freeze(actions),
    autoTranslate: options.autoTranslate,
    extra,
    filters,
    source: snapshot.source.code,
    targets: Object.freeze(snapshot.targets.map(target => target.code)),
  })
}

export const syncTranslationRequests = (plan: ISyncPlan): ITranslationRequestPlan[] =>
  plan.actions
    .filter(action => action.type === 'translate')
    .map(action => ({
      from: plan.source,
      key: action.key,
      sourceText: action.sourceValue as string,
      to: action.language,
    }))

export const SyncPlanner = {create: createPlan}
