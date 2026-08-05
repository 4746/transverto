import {TranslationError} from './entities/translation-error.js'

const invalidCompletion = (cause?: unknown): TranslationError => new TranslationError(
  'provider_response',
  'Engine returned an invalid label suggestion completion; expected a non-empty JSON array of strings.',
  cause === undefined ? {} : {cause},
)

export const parseLabelSuggestionCompletion = (content: string): string[] => {
  let parsed: unknown

  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    throw invalidCompletion(error)
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(value => typeof value !== 'string')
  ) {
    throw invalidCompletion()
  }

  return parsed
}
