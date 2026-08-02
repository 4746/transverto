export interface IKeyFilters {
  exclude: string[]
  include: string[]
}

const unique = <T>(values: T[]): T[] => [...new Set(values)]

const validatePattern = (pattern: string): void => {
  if (!pattern) throw new Error('Key patterns must not be empty.')

  const firstStar = pattern.indexOf('*')
  if (firstStar === -1) return
  if (firstStar !== pattern.lastIndexOf('*') || (firstStar !== 0 && firstStar !== pattern.length - 1)) {
    throw new Error(
      `Invalid key pattern "${pattern}". Use an exact key or one wildcard at the beginning or end.`,
    )
  }
}

export const matchesKeyPattern = (key: string, pattern: string, ignoreCase = false): boolean => {
  const candidate = ignoreCase ? key.toLowerCase() : key
  const expected = ignoreCase ? pattern.toLowerCase() : pattern
  if (expected === '*') return true
  if (expected.startsWith('*')) return candidate.endsWith(expected.slice(1))
  if (expected.endsWith('*')) return candidate.startsWith(expected.slice(0, -1))
  return candidate === expected
}

export function normalizeKeyPatterns(
  include: string[] = [],
  exclude: string[] = [],
): IKeyFilters {
  const normalized = {exclude: unique(exclude), include: unique(include)}
  for (const pattern of [...normalized.include, ...normalized.exclude]) validatePattern(pattern)
  return normalized
}

export function matchesKeyFilters(key: string, filters: IKeyFilters): boolean {
  const included = filters.include.length === 0 || filters.include.some(pattern => matchesKeyPattern(key, pattern))
  return included && !filters.exclude.some(pattern => matchesKeyPattern(key, pattern))
}
