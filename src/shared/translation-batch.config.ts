import type {
  ITranslationBatchConfig,
  ITranslationBatchOverrides,
} from './entities/translation-batch.js'

export const TRANSLATION_BATCH_DEFAULTS: ITranslationBatchConfig = {
  concurrency: 1,
  delayMs: 0,
  maxChars: null,
  maxItems: null,
  retry: 2,
}

const BATCH_CONFIG_KEYS = new Set<keyof ITranslationBatchConfig>([
  'concurrency',
  'delayMs',
  'maxChars',
  'maxItems',
  'retry',
])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validateInteger = (
  field: keyof ITranslationBatchConfig,
  value: unknown,
  minimum: number,
): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    const expectation = minimum === 0 ? 'a non-negative integer' : 'a positive integer'
    throw new Error(`batch.${field} must be ${expectation}.`)
  }

  return value as number
}

const validateLimit = (
  field: 'maxChars' | 'maxItems',
  value: unknown,
): null | number => {
  if (value === null) return null
  return validateInteger(field, value, 1)
}

export function resolveTranslationBatchConfig(
  value: unknown,
  overrides: ITranslationBatchOverrides = {},
): ITranslationBatchConfig {
  let configured: Record<string, unknown> = {}
  if (value !== undefined) {
    if (!isPlainObject(value)) throw new Error('batch must be an object.')
    configured = value
  }

  for (const key of Object.keys(configured)) {
    if (!BATCH_CONFIG_KEYS.has(key as keyof ITranslationBatchConfig)) {
      throw new Error(`Unknown batch configuration field "${key}".`)
    }
  }

  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, entry]) => entry !== undefined),
  )
  const merged = {...TRANSLATION_BATCH_DEFAULTS, ...configured, ...definedOverrides}

  return {
    concurrency: validateInteger('concurrency', merged.concurrency, 1),
    delayMs: validateInteger('delayMs', merged.delayMs, 0),
    maxChars: validateLimit('maxChars', merged.maxChars),
    maxItems: validateLimit('maxItems', merged.maxItems),
    retry: validateInteger('retry', merged.retry, 0),
  }
}
