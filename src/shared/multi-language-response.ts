import type {IMultiLanguageEngineResponse} from './entities/translation.engine.js'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const allInvalid = (
  targets: string[],
  reason: 'malformed_json' | 'not_object',
): IMultiLanguageEngineResponse => ({
  issues: targets.map(target => ({reason, target})),
  translations: {},
  unexpectedTargets: [],
})

export const parseMultiLanguageCompletion = (
  content: string,
  targets: string[],
): IMultiLanguageEngineResponse => {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return allInvalid(targets, 'malformed_json') }
  if (!isPlainObject(parsed)) return allInvalid(targets, 'not_object')
  const requested = new Set(targets)
  const issues: IMultiLanguageEngineResponse['issues'] = []
  const translations: Record<string, string> = {}
  for (const target of targets) {
    if (!Object.hasOwn(parsed, target)) issues.push({reason: 'missing', target})
    else if (typeof parsed[target] !== 'string') issues.push({reason: 'non_string', target})
    else if (parsed[target].trim().length === 0) issues.push({reason: 'empty', target})
    else translations[target] = parsed[target].trim()
  }

  return {issues, translations, unexpectedTargets: Object.keys(parsed).filter(target => !requested.has(target))}
}
