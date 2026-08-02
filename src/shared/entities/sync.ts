import type {IConfig} from '../config.js'
import type {IKeyFilters} from '../key-pattern.js'
import type {ITranslationBatchOutput} from './translation-batch.js'

export type TSyncDictionary = Record<string, unknown>

export type TSyncActionType =
  | 'add'
  | 'conflict'
  | 'keep'
  | 'remove'
  | 'skip'
  | 'translate'

export type TSyncActionReason =
  | 'existing'
  | 'extra_kept'
  | 'extra_removed'
  | 'extra_reported'
  | 'missing'
  | 'path_conflict'

export type TSyncExtraPolicy = 'keep' | 'remove' | 'report'

export const SYNC_EXTRA_POLICIES = ['keep', 'report', 'remove'] as const

export interface ISyncAction {
  readonly key: string
  readonly language: string
  readonly reason: TSyncActionReason
  readonly sourceValue: null | string
  readonly targetValue: null | string
  readonly type: TSyncActionType
}

export interface ISyncDictionarySnapshot {
  readonly bytes: Buffer
  readonly code: string
  readonly dictionary: TSyncDictionary
  readonly file: string
  readonly flat: ReadonlyMap<string, string>
}

export interface ISyncFileSnapshot {
  readonly bytes: Buffer | null
  readonly file: string
}

export interface ISyncProjectSnapshot {
  readonly config: IConfig
  readonly cwd: string
  readonly source: ISyncDictionarySnapshot
  readonly targets: readonly ISyncDictionarySnapshot[]
  readonly types: ISyncFileSnapshot
}

export interface ISyncPlan {
  readonly actions: readonly ISyncAction[]
  readonly autoTranslate: boolean
  readonly extra: TSyncExtraPolicy
  readonly filters: Readonly<IKeyFilters>
  readonly source: string
  readonly targets: readonly string[]
}

export interface ISyncExecutionOutcome {
  readonly batch: ITranslationBatchOutput | null
  readonly confirmed: boolean
  readonly written: readonly string[]
}

export interface ISyncLanguageSummary {
  added: number
  conflicts: number
  failed: number
  kept: number
  remaining: number
  removed: number
  skipped: number
  total: number
  translated: number
}

export interface ISyncSummary {
  byLanguage: Record<string, ISyncLanguageSummary>
  total: ISyncLanguageSummary
}

export interface ISyncReport {
  actions: readonly ISyncAction[]
  autoTranslate: boolean
  batch: ITranslationBatchOutput | null
  confirmed: boolean
  dryRun: boolean
  exitCode: 0 | 1
  extra: TSyncExtraPolicy
  filters: Readonly<IKeyFilters>
  source: string
  summary: ISyncSummary
  targets: readonly string[]
  writeRequested: boolean
  written: readonly string[]
}
