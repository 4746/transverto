import type {TTranslationErrorCategory} from './translation-error.js'
import type {
  ITranslationRequestPlan,
  ITranslationResult,
} from './translation.engine.js'

export interface ITranslationBatchConfig {
  concurrency: number
  delayMs: number
  maxChars: null | number
  maxItems: null | number
  retry: number
}

export type ITranslationBatchOverrides = Partial<ITranslationBatchConfig>

export type TTranslationSkipReason =
  | 'confirmation'
  | 'empty'
  | 'number'
  | 'token_only'
  | 'url'

export type TTranslationRemainingReason = 'dry_run' | 'limit'

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
  remaining: ITranslationRemaining[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
}
