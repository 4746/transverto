import type {
  IIncompleteTarget,
  IIncompleteTranslationBatch,
  ITranslationBatchSummary,
  ITranslationConflict,
  ITranslationFailed,
  ITranslationRemaining,
  ITranslationSkipped,
} from './translation-batch.js'

/**
 * The types of translation engines available.
 */
export type TEngineProvider =
  | 'google-ai'
  | 'lmstudio'
  | 'openai-compatible'
  | 'openrouter'

export interface IEngineProfile {
  apiKeyEnv?: string
  baseUrl?: string
  labelSuggestionPrompt?: string
  model: string
  provider: TEngineProvider
  reasoning?: boolean
  systemPrompt?: string
  temperature?: number
  timeoutMs?: number
}

export interface IResolvedEngineProfile extends IEngineProfile {
  apiKey?: string
  baseUrl: string
  name: string
  timeoutMs: number
}

export interface ITranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  to: string
}

export interface IMultiLanguageTranslationRequestPlan {
  from: string
  key?: string
  sourceText: string
  targets: string[]
}

export interface IMultiLanguageEngineResponse {
  issues: IIncompleteTarget[]
  translations: Record<string, string>
  unexpectedTargets: string[]
}

export interface IMultiLanguageTranslationAttempt extends IMultiLanguageEngineResponse {
  request: IMultiLanguageTranslationRequestPlan
  results: ITranslationResult[]
}

export interface ITranslationResult extends ITranslationRequestPlan {
  cached: boolean
  engine: string
  fallback?: {from: string}
  model: string
  provider: TEngineProvider
  translatedText: string
}

export interface ITranslateOutput {
  conflicts: ITranslationConflict[]
  dryRun: boolean
  failed: ITranslationFailed[]
  incomplete: IIncompleteTranslationBatch[]
  remaining: ITranslationRemaining[]
  requests: ITranslationRequestPlan[]
  results: ITranslationResult[]
  skipped: ITranslationSkipped[]
  summary: ITranslationBatchSummary
  written: string[]
}

export interface TranslationEngine {
  translate(request: ITranslationRequestPlan): Promise<string>
  translateBatch?(request: IMultiLanguageTranslationRequestPlan): Promise<IMultiLanguageEngineResponse>
}
