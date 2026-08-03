import type {
  ILabelMutationChange,
  ILabelMutationConflict,
  ILabelMutationPlan,
  ILabelMutationProjectSnapshot,
  TLabelMutationOperation,
} from './entities/label-mutation.js'
import type {ISyncDictionarySnapshot} from './entities/sync.js'
import type {IKeyFilters} from './key-pattern.js'

import {matchesKeyFilters, normalizeKeyPatterns} from './key-pattern.js'

export interface ILabelMutationPlanOptions {
  exclude?: string[]
  include?: string[]
  newPath?: string
  oldPath: string
  operation: TLabelMutationOperation
  overwrite?: boolean
}

interface IPlanningContext {
  changes: ILabelMutationChange[]
  conflicts: ILabelMutationConflict[]
  filters: Readonly<IKeyFilters>
  newPath: null | string
  oldPath: string
  overwrite: boolean
}

interface IAppendChangeInput {
  from: string
  overwritten?: readonly string[]
  to: null | string
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const isBranchKey = (key: string, prefix: string): boolean =>
  key === prefix || key.startsWith(`${prefix}.`)

const pathsOverlap = (left: string, right: string): boolean =>
  isBranchKey(left, right) || isBranchKey(right, left)

const matchesPattern = (key: string, pattern: string): boolean => {
  if (pattern === '*') return true
  if (pattern.startsWith('*')) return key.endsWith(pattern.slice(1))
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1))
  return key === pattern
}

const validatePath = (value: string, name: string, allowPattern = false): void => {
  if (!value) throw new Error(`${name} must not be empty.`)
  if (!allowPattern && value.includes('*')) throw new Error(`${name} must not contain a wildcard.`)
  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    throw new Error(`${name} must be a dot-separated key path.`)
  }

  if (allowPattern) normalizeKeyPatterns([value], [])
}

const validateOptions = (options: ILabelMutationPlanOptions): null | string => {
  validatePath(options.oldPath, 'Source key', options.operation === 'delete')
  if (options.operation === 'delete') {
    if (options.newPath !== undefined) throw new Error('Delete operations do not accept a target key.')
    return null
  }

  if (!options.newPath) throw new Error('Target key must not be empty.')
  validatePath(options.newPath, 'Target key')
  return options.newPath
}

const freezeFilters = (include: string[] = [], exclude: string[] = []): Readonly<IKeyFilters> => {
  const filters = normalizeKeyPatterns(include, exclude)
  return Object.freeze({
    exclude: Object.freeze([...filters.exclude]) as unknown as string[],
    include: Object.freeze([...filters.include]) as unknown as string[],
  })
}

const collisionKeys = (target: string, existingKeys: readonly string[]): string[] =>
  existingKeys.filter(key => pathsOverlap(key, target)).sort(compareText)

const conflictReason = (target: string, occupied: readonly string[]): 'path_conflict' | 'target_exists' =>
  occupied.some(key => key === target || key.startsWith(`${target}.`)) ? 'target_exists' : 'path_conflict'

const appendConflict = (
  context: IPlanningContext,
  input: Omit<ILabelMutationConflict, 'reason'> & {reason?: ILabelMutationConflict['reason']},
): void => {
  context.conflicts.push(Object.freeze({
    ...input,
    reason: input.reason ?? conflictReason(input.to as string, input.targets),
    targets: Object.freeze([...input.targets]),
  }))
}

const appendChange = (
  context: IPlanningContext,
  dictionary: ISyncDictionarySnapshot,
  input: IAppendChangeInput,
): void => {
  context.changes.push(Object.freeze({
    from: input.from,
    language: dictionary.code,
    overwritten: Object.freeze([...(input.overwritten ?? [])]),
    to: input.to,
    value: dictionary.flat.get(input.from) as string,
  }))
}

const filteredKeys = (
  dictionary: ISyncDictionarySnapshot,
  filters: Readonly<IKeyFilters>,
  predicate: (key: string) => boolean,
): string[] => [...dictionary.flat.keys()].filter(key => predicate(key) && matchesKeyFilters(key, filters))

const remainingKeys = (dictionary: ISyncDictionarySnapshot, sources: readonly string[]): string[] => {
  const sourceSet = new Set(sources)
  return [...dictionary.flat.keys()].filter(key => !sourceSet.has(key))
}

const planDelete = (context: IPlanningContext, dictionary: ISyncDictionarySnapshot): void => {
  const matches = filteredKeys(dictionary, context.filters, key => (
    context.oldPath.includes('*')
      ? matchesPattern(key, context.oldPath)
      : isBranchKey(key, context.oldPath)
  ))
  for (const from of matches) appendChange(context, dictionary, {from, to: null})
}

const planRename = (context: IPlanningContext, dictionary: ISyncDictionarySnapshot): void => {
  const matches = filteredKeys(dictionary, context.filters, key => key === context.oldPath)
  const occupied = collisionKeys(context.newPath as string, remainingKeys(dictionary, matches))

  for (const from of matches) appendChange(context, dictionary, {from, overwritten: occupied, to: context.newPath})
  if (occupied.length > 0 && !context.overwrite) {
    appendConflict(context, {
      from: context.oldPath,
      language: dictionary.code,
      targets: occupied,
      to: context.newPath,
    })
  }
}

const planMove = (context: IPlanningContext, dictionary: ISyncDictionarySnapshot): void => {
  const matches = filteredKeys(dictionary, context.filters, key => isBranchKey(key, context.oldPath))
  const occupied = collisionKeys(context.newPath as string, remainingKeys(dictionary, matches))

  if (occupied.length > 0 && !context.overwrite) {
    appendConflict(context, {
      from: context.oldPath,
      language: dictionary.code,
      targets: occupied,
      to: context.newPath,
    })
  }

  for (const [index, from] of matches.entries()) {
    const to = `${context.newPath}${from.slice(context.oldPath.length)}`
    appendChange(context, dictionary, {from, overwritten: index === 0 ? occupied : [], to})
  }
}

const planDictionary = (
  context: IPlanningContext,
  dictionary: ISyncDictionarySnapshot,
  operation: TLabelMutationOperation,
): void => {
  if (operation === 'delete') planDelete(context, dictionary)
  else if (operation === 'rename') planRename(context, dictionary)
  else planMove(context, dictionary)
}

const sortPlan = (context: IPlanningContext, snapshot: ILabelMutationProjectSnapshot): void => {
  context.changes.sort((left, right) => (
    snapshot.config.languages.indexOf(left.language) - snapshot.config.languages.indexOf(right.language) ||
    compareText(left.from, right.from)
  ))
  context.conflicts.sort((left, right) => (
    (left.language === null ? -1 : snapshot.config.languages.indexOf(left.language)) -
    (right.language === null ? -1 : snapshot.config.languages.indexOf(right.language)) ||
    compareText(left.from, right.from)
  ))
}

const createPlan = (
  snapshot: ILabelMutationProjectSnapshot,
  options: ILabelMutationPlanOptions,
): ILabelMutationPlan => {
  const newPath = validateOptions(options)
  const context: IPlanningContext = {
    changes: [],
    conflicts: [],
    filters: freezeFilters(options.include, options.exclude),
    newPath,
    oldPath: options.oldPath,
    overwrite: options.overwrite ?? false,
  }

  if (newPath && pathsOverlap(options.oldPath, newPath)) {
    appendConflict(context, {
      from: options.oldPath,
      language: null,
      reason: 'overlapping_prefixes',
      targets: [newPath],
      to: newPath,
    })
  }

  for (const dictionary of snapshot.dictionaries) planDictionary(context, dictionary, options.operation)
  sortPlan(context, snapshot)

  return Object.freeze({
    changes: Object.freeze(context.changes),
    conflicts: Object.freeze(context.conflicts),
    filters: context.filters,
    languages: Object.freeze(snapshot.dictionaries.map(dictionary => dictionary.code)),
    newPath,
    oldPath: options.oldPath,
    operation: options.operation,
    overwrite: context.overwrite,
  })
}

export const LabelMutationPlanner = {create: createPlan}
