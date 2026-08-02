import {IResolvedEngineProfile} from './translation.engine.js'

export type TTranslationErrorCategory =
  | 'authentication'
  | 'configuration'
  | 'network'
  | 'provider_response'
  | 'provider_unavailable'
  | 'rate_limit'
  | 'timeout'
  | 'validation'

export const RECOVERABLE_TRANSLATION_ERROR_CATEGORIES: TTranslationErrorCategory[] = [
  'rate_limit',
  'timeout',
  'network',
  'provider_unavailable',
]

export interface ITranslationErrorOptions {
  cause?: unknown
  profile?: Pick<IResolvedEngineProfile, 'model' | 'name' | 'provider'>
  status?: number
}

export class TranslationError extends Error {
  readonly category: TTranslationErrorCategory
  readonly engine?: string
  readonly model?: string
  readonly provider?: string
  readonly status?: number

  constructor(
    category: TTranslationErrorCategory,
    message: string,
    options: ITranslationErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : {cause: options.cause})
    this.name = 'TranslationError'
    this.category = category
    this.engine = options.profile?.name
    this.model = options.profile?.model
    this.provider = options.profile?.provider
    this.status = options.status
  }
}

export const isRecoverableTranslationError = (error: TranslationError): boolean =>
  RECOVERABLE_TRANSLATION_ERROR_CATEGORIES.includes(error.category)

export const toTranslationError = (
  error: unknown,
  category: TTranslationErrorCategory,
  message?: string,
  options: ITranslationErrorOptions = {},
): TranslationError => {
  if (error instanceof TranslationError) return error

  return new TranslationError(
    category,
    message ?? (error instanceof Error ? error.message : String(error)),
    {...options, cause: error},
  )
}
