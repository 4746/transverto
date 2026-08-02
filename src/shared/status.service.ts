import fs from 'node:fs'
import path from 'node:path'

import {validateConfigInput} from './config-builder.js'
import {CTV_CONFIG_FILE_NAME} from './constants.js'
import {
  IStatusAnalysisOptions,
  IStatusFinding,
  IStatusReport,
  IStatusSummary,
  STATUS_FAIL_ON,
  STATUS_PROBLEMS,
  TStatusFailOn,
  TStatusProblem,
  TStatusSeverity,
} from './entities/status.js'
import {comparePlaceholders} from './placeholder.js'

type TDictionary = Record<string, unknown>

interface IStatusProjectConfig {
  basePath: string
  langCodeDefault: string
  languages: string[]
}

interface INormalizedStatusOptions {
  exclude: string[]
  failOn: TStatusFailOn
  include: string[]
  languages: string[]
  problems?: TStatusProblem[]
}

const SEVERITY_BY_PROBLEM: Record<TStatusProblem, TStatusSeverity> = {
  missing: 'error',
  extra: 'info',
  empty: 'warning',
  same: 'info',
  placeholder: 'error',
}

const isObject = (value: unknown): value is TDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const unique = <T>(values: T[]): T[] => [...new Set(values)]

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const readJson = async (file: string): Promise<unknown> => {
  let contents: string
  try {
    contents = await fs.promises.readFile(file, 'utf8')
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const flattenDictionary = (dictionary: TDictionary): Map<string, string> => {
  const leaves = new Map<string, string>()

  const visit = (object: TDictionary, prefix = ''): void => {
    for (const [key, value] of Object.entries(object)) {
      const keyPath = prefix ? `${prefix}.${key}` : key
      if (isObject(value)) visit(value, keyPath)
      else if (typeof value === 'string') leaves.set(keyPath, value)
      else throw new TypeError(`Translation leaf "${keyPath}" must be a string.`)
    }
  }

  visit(dictionary)
  return leaves
}

const readDictionary = async (file: string): Promise<Map<string, string>> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) throw new Error(`Language file does not exist: ${file}`)
  if (!stat.isFile()) throw new Error(`Language path is not a file: ${file}`)

  const parsed = await readJson(file)
  if (!isObject(parsed)) throw new TypeError(`Language dictionary root must be an object: ${file}`)
  return flattenDictionary(parsed)
}

const loadConfig = async (cwd: string): Promise<IStatusProjectConfig> => {
  const configFile = path.join(cwd, CTV_CONFIG_FILE_NAME)
  const parsed = await readJson(configFile)
  if (!isObject(parsed)) throw new TypeError(`Configuration root must be an object: ${configFile}`)

  if (!Array.isArray(parsed.languages) || parsed.languages.some(code => typeof code !== 'string')) {
    throw new TypeError('Configuration field "languages" must be an array of language codes.')
  }

  if (
    typeof parsed.langCodeDefault !== 'string' ||
    typeof parsed.basePath !== 'string' ||
    typeof parsed.basePathEnum !== 'string'
  ) {
    throw new TypeError('Configuration source and paths must be strings.')
  }

  validateConfigInput({
    languages: parsed.languages as string[],
    source: parsed.langCodeDefault,
    translationsPath: parsed.basePath,
    typesPath: parsed.basePathEnum,
  })

  return {
    basePath: parsed.basePath,
    langCodeDefault: parsed.langCodeDefault,
    languages: parsed.languages as string[],
  }
}

const validatePattern = (pattern: string): void => {
  if (!pattern) throw new Error('Status key patterns must not be empty.')

  const firstStar = pattern.indexOf('*')
  if (firstStar === -1) return
  if (firstStar !== pattern.lastIndexOf('*') || (firstStar !== 0 && firstStar !== pattern.length - 1)) {
    throw new Error(
      `Invalid status key pattern "${pattern}". Use an exact key or one wildcard at the beginning or end.`,
    )
  }
}

const matchesPattern = (key: string, pattern: string): boolean => {
  if (pattern === '*') return true
  if (pattern.startsWith('*')) return key.endsWith(pattern.slice(1))
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1))
  return key === pattern
}

type TFindingInput = Omit<IStatusFinding, 'severity'>

const finding = (input: TFindingInput): IStatusFinding => ({
  key: input.key,
  language: input.language,
  problem: input.problem,
  severity: SEVERITY_BY_PROBLEM[input.problem],
  sourcePlaceholders: input.sourcePlaceholders,
  sourceValue: input.sourceValue,
  value: input.value,
  valuePlaceholders: input.valuePlaceholders,
})

const analyzeTarget = (
  language: string,
  source: Map<string, string>,
  target: Map<string, string>,
): IStatusFinding[] => {
  const findings: IStatusFinding[] = []

  for (const [key, sourceValue] of source) {
    const value = target.get(key)
    if (value === undefined) {
      findings.push(finding({
        key,
        language,
        problem: 'missing',
        sourcePlaceholders: null,
        sourceValue,
        value: null,
        valuePlaceholders: null,
      }))
      continue
    }

    if (value.trim() === '') {
      findings.push(finding({
        key,
        language,
        problem: 'empty',
        sourcePlaceholders: null,
        sourceValue,
        value,
        valuePlaceholders: null,
      }))
    }

    if (value.trim() !== '' && value === sourceValue) {
      findings.push(finding({
        key,
        language,
        problem: 'same',
        sourcePlaceholders: null,
        sourceValue,
        value,
        valuePlaceholders: null,
      }))
    }

    const placeholders = comparePlaceholders(sourceValue, value)
    if (!placeholders.matches) {
      findings.push(
        finding({
          key,
          language,
          problem: 'placeholder',
          sourcePlaceholders: placeholders.source,
          sourceValue,
          value,
          valuePlaceholders: placeholders.translated,
        }),
      )
    }
  }

  for (const [key, value] of target) {
    if (!source.has(key)) {
      findings.push(finding({
        key,
        language,
        problem: 'extra',
        sourcePlaceholders: null,
        sourceValue: null,
        value,
        valuePlaceholders: null,
      }))
    }
  }

  return findings
}

const summarize = (findings: IStatusFinding[]): IStatusSummary => {
  const summary: IStatusSummary = {
    byProblem: {missing: 0, extra: 0, empty: 0, same: 0, placeholder: 0},
    bySeverity: {error: 0, warning: 0, info: 0},
    total: findings.length,
  }

  for (const item of findings) {
    summary.byProblem[item.problem] += 1
    summary.bySeverity[item.severity] += 1
  }

  return summary
}

const normalizeOptions = (
  options: IStatusAnalysisOptions,
  config: IStatusProjectConfig,
): INormalizedStatusOptions => {
  const failOn = options.failOn ?? 'error'
  if (!(STATUS_FAIL_ON as readonly string[]).includes(failOn)) {
    throw new Error(`Invalid fail threshold "${failOn}".`)
  }

  const languages = options.languages === undefined
    ? config.languages.filter(language => language !== config.langCodeDefault)
    : unique(options.languages)
  if (options.languages !== undefined && languages.length === 0) {
    throw new Error('At least one target language is required when --language is supplied.')
  }

  for (const language of languages) {
    if (!config.languages.includes(language)) {
      throw new Error(`Language "${language}" is not configured.`)
    }

    if (language === config.langCodeDefault) {
      throw new Error(`Source language "${language}" cannot be analyzed as a target.`)
    }
  }

  const problems = options.problems === undefined ? undefined : unique(options.problems)
  for (const problem of problems ?? []) {
    if (!(STATUS_PROBLEMS as readonly string[]).includes(problem)) {
      throw new Error(`Invalid status problem "${problem}".`)
    }
  }

  const include = unique(options.include ?? [])
  const exclude = unique(options.exclude ?? [])
  for (const pattern of [...include, ...exclude]) validatePattern(pattern)

  return {exclude, failOn, include, languages, problems}
}

const statusExitCode = (failOn: TStatusFailOn, summary: IStatusSummary): 0 | 1 => {
  if (failOn === 'never') return 0
  if (failOn === 'warning') {
    return summary.bySeverity.error + summary.bySeverity.warning > 0 ? 1 : 0
  }

  return summary.bySeverity.error > 0 ? 1 : 0
}

export const StatusService = {
  async analyze(options: IStatusAnalysisOptions = {}): Promise<IStatusReport> {
    const cwd = options.cwd ?? process.cwd()
    const config = await loadConfig(cwd)
    const {exclude, failOn, include, languages, problems} = normalizeOptions(options, config)

    const sourceFile = path.resolve(cwd, config.basePath, `${config.langCodeDefault}.json`)
    const source = await readDictionary(sourceFile)
    const findings: IStatusFinding[] = []

    for (const language of languages) {
      const targetFile = path.resolve(cwd, config.basePath, `${language}.json`)
      findings.push(...analyzeTarget(language, source, await readDictionary(targetFile)))
    }

    const languageOrder = new Map(languages.map((language, index) => [language, index]))
    const filtered = findings
      .filter(item => problems === undefined || problems.includes(item.problem))
      .filter(item => include.length === 0 || include.some(pattern => matchesPattern(item.key, pattern)))
      .filter(item => !exclude.some(pattern => matchesPattern(item.key, pattern)))
      .sort((left, right) => {
        const languageDifference = (languageOrder.get(left.language) ?? 0) - (languageOrder.get(right.language) ?? 0)
        if (languageDifference !== 0) return languageDifference

        const keyDifference = compareText(left.key, right.key)
        return keyDifference === 0
          ? STATUS_PROBLEMS.indexOf(left.problem) - STATUS_PROBLEMS.indexOf(right.problem)
          : keyDifference
      })

    const summary = summarize(filtered)

    return {
      source: config.langCodeDefault,
      languages,
      findings: filtered,
      summary,
      failOn,
      exitCode: statusExitCode(failOn, summary),
    }
  },
}
