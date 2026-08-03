export type TAutomaticSkipReason = 'empty' | 'number' | 'token_only' | 'url'

export interface IPlaceholderComparison {
  matches: boolean
  source: string[]
  translated: string[]
}

const PLACEHOLDER_PATTERN = /\{\{[^{}\r\n]+\}\}|\{[^{}\r\n]+\}|%(?:\d+\$)?s/gu
const STANDALONE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d+)?)$/u
const TOKEN_ONLY_REMAINDER_PATTERN = /^[\p{P}\p{S}\s]*$/u

const isAbsoluteHttpUrl = (value: string): boolean => {
  if (/\s/u.test(value)) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const extractPlaceholders = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER_PATTERN)].map(match => match[0]).sort()

export const comparePlaceholders = (
  sourceText: string,
  translatedText: string,
): IPlaceholderComparison => {
  const source = extractPlaceholders(sourceText)
  const translated = extractPlaceholders(translatedText)

  return {
    matches: source.length === translated.length && source.every(
      (value, index) => value === translated[index],
    ),
    source,
    translated,
  }
}

export function classifySkippedSource(text: string): TAutomaticSkipReason | undefined {
  const trimmed = text.trim()

  if (!trimmed) return 'empty'
  if (STANDALONE_NUMBER_PATTERN.test(trimmed)) return 'number'
  if (isAbsoluteHttpUrl(trimmed)) return 'url'

  const remainder = trimmed.replaceAll(PLACEHOLDER_PATTERN, '')
  if (TOKEN_ONLY_REMAINDER_PATTERN.test(remainder)) return 'token_only'
}
