import type {ILabelMutationProjectSnapshot} from './label-mutation.js'
import type {IStatusReport} from './status.js'

export const CSV_UNKNOWN_KEY_POLICIES = ['conflict', 'skip', 'add'] as const
export const CSV_EMPTY_POLICIES = ['skip', 'clear', 'conflict'] as const
export const CSV_EXISTING_POLICIES = ['conflict', 'skip', 'overwrite'] as const

export type TCsvUnknownKeyPolicy = typeof CSV_UNKNOWN_KEY_POLICIES[number]
export type TCsvEmptyPolicy = typeof CSV_EMPTY_POLICIES[number]
export type TCsvExistingPolicy = typeof CSV_EXISTING_POLICIES[number]
export type TCsvImportActionType = 'add' | 'update' | 'skip' | 'conflict'

export interface ICsvColumnMapping {
  readonly column: string
  readonly language: string
}

export interface ICsvImportAction {
  readonly column: string
  readonly key: string
  readonly language: string
  readonly previous: null | string
  readonly reason: string
  readonly row: number
  readonly type: TCsvImportActionType
  readonly value: string
}

export interface ICsvImportPlan {
  readonly actions: readonly ICsvImportAction[]
  readonly empty: TCsvEmptyPolicy
  readonly existing: TCsvExistingPolicy
  readonly file: string
  readonly mappings: readonly ICsvColumnMapping[]
  readonly rows: number
  readonly unknownKey: TCsvUnknownKeyPolicy
  readonly useNewColumns: boolean
}

export type ICsvImportProjectSnapshot = ILabelMutationProjectSnapshot

export interface ICsvImportSummary {
  add: number
  conflict: number
  skip: number
  total: number
  update: number
}

export interface ICsvImportReport extends ICsvImportPlan {
  confirmed: boolean
  dryRun: boolean
  exitCode: 0 | 1
  status: IStatusReport | null
  summary: ICsvImportSummary
  writeRequested: boolean
  written: readonly string[]
}
