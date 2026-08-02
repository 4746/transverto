import type {IConfig} from '../config.js'
import type {IKeyFilters} from '../key-pattern.js'
import type {ISyncDictionarySnapshot, ISyncFileSnapshot} from './sync.js'

export type TLabelMutationOperation = 'delete' | 'move' | 'rename'

export type TLabelMutationConflictReason =
  | 'overlapping_prefixes'
  | 'path_conflict'
  | 'target_exists'

export interface ILabelMutationChange {
  readonly from: string
  readonly language: string
  readonly overwritten: readonly string[]
  readonly to: null | string
  readonly value: string
}

export interface ILabelMutationConflict {
  readonly from: string
  readonly language: null | string
  readonly reason: TLabelMutationConflictReason
  readonly targets: readonly string[]
  readonly to: null | string
}

export interface ILabelMutationProjectSnapshot {
  readonly config: IConfig
  readonly cwd: string
  readonly dictionaries: readonly ISyncDictionarySnapshot[]
  readonly source: ISyncDictionarySnapshot
  readonly types: ISyncFileSnapshot
}

export interface ILabelMutationPlan {
  readonly changes: readonly ILabelMutationChange[]
  readonly conflicts: readonly ILabelMutationConflict[]
  readonly filters: Readonly<IKeyFilters>
  readonly languages: readonly string[]
  readonly newPath: null | string
  readonly oldPath: string
  readonly operation: TLabelMutationOperation
  readonly overwrite: boolean
}

export interface ILabelMutationReport extends ILabelMutationPlan {
  confirmed: boolean
  dryRun: boolean
  exitCode: 0 | 1
  matchedKeys: readonly string[]
  writeRequested: boolean
  written: readonly string[]
}
