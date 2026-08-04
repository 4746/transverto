import type {TTranslationErrorCategory} from './translation-error.js'
import type {
  ITranslationRequestPlan,
  ITranslationResult,
} from './translation.engine.js'

export type TTranslationBatchMode = 'multi-language' | 'per-language'
export type TIncompleteBatchDecision = 'cancel' | 'per-language'
export type TIncompleteTargetReason =
  | 'empty'
  | 'malformed_json'
  | 'missing'
  | 'non_string'
  | 'not_object'
  | 'placeholder'

export interface IIncompleteTarget {
  reason: TIncompleteTargetReason
  target: string
}

export interface IIncompleteTranslationBatch {
  decision: TIncompleteBatchDecision
  from: string
  invalid: IIncompleteTarget[]
  key?: string
  requestedTargets: string[]
  sourceText: string
  unexpectedTargets: string[]
  validTargets: string[]
}

export interface ITranslationBatchConfig {
  concurrency: number
  delayMs: number
  maxChars: null | number
  maxItems: null | number
  mode: TTranslationBatchMode
  retry: number
}

export type ITranslationBatchOverrides = Partial<ITranslationBatchConfig>

export type TTranslationSkipReason =
  | 'confirmation'
  | 'empty'
  | 'number'
  | 'token_only'
  | 'url'

export type TTranslationRemainingReason = 'dry_run' | 'incomplete_batch' | 'limit'

export interface ITranslationSkipped {
  reason: TTranslationSkipReason
  request: ITranslationRequestPlan
  result?: ITranslationResult
}

export interface ITranslationConflict {
  request: ITranslationRequestPlan
  result: ITranslationResult
  sourcePlaceholders: string[]
  translatedPlaceholders: string[]
}

export interface ITranslationFailed {
  attempts: number
  category: TTranslationErrorCategory
  message: string
  request: ITranslationRequestPlan
}

export interface ITranslationRemaining {
  reason: TTranslationRemainingReason
  request: ITranslationRequestPlan
}

export interface ITranslationBatchSummary {
  cached: number
  conflict: number
  failed: number
  remaining: number
  skipped: number
  translated: number
}

export interface ITranslationBatchOutput {
  conflicts: ITranslationConflict[]
  failed: ITranslationFailed[]
  incomplete: IIncompleteTranslationBatch[]
  remaining: ITranslationRemaining[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
}
