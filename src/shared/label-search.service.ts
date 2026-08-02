import fs from 'node:fs'
import path from 'node:path'

import type {IConfig} from './config.js'
import type {
  ILabelSearchOptions,
  ILabelSearchReport,
  TLabelSearchMode,
} from './entities/label-search.js'
import type {TSyncDictionary} from './entities/sync.js'

import {validateConfigInput, validateLanguageCodes} from './config-builder.js'
import {LABEL_SEARCH_MODES} from './entities/label-search.js'
import {matchesKeyPattern, normalizeKeyPatterns} from './key-pattern.js'
import {flattenSyncDictionary} from './sync.repository.js'

interface ISearchDictionary {
  code: string
  flat: ReadonlyMap<string, string>
}

interface INormalizedSearchOptions {
  cwd: string
  ignoreCase: boolean
  languages: string[]
  limit: null | number
  mode: TLabelSearchMode
  query: string
}

const isObject = (value: unknown): value is TSyncDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const unique = <T>(values: T[]): T[] => [...new Set(values)]

const readDictionary = async (code: string, file: string): Promise<ISearchDictionary> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) throw new Error(`Language file does not exist: ${file}`)
  if (!stat.isFile()) throw new Error(`Language path is not a file: ${file}`)

  let bytes: Buffer
  try {
    bytes = await fs.promises.readFile(file)
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isObject(parsed)) throw new TypeError(`Language dictionary root must be an object: ${file}`)
  return {code, flat: flattenSyncDictionary(parsed, file)}
}

const selectLanguages = (config: IConfig, requested?: string[]): string[] => {
  const uniqueRequested = requested === undefined ? undefined : unique(requested)
  if (uniqueRequested?.length === 0) throw new Error('At least one language is required when --language is supplied.')
  if (uniqueRequested) validateLanguageCodes(uniqueRequested)

  const selected = uniqueRequested === undefined ? new Set(config.languages) : new Set(uniqueRequested)
  for (const language of selected) {
    if (!config.languages.includes(language)) throw new Error(`Language "${language}" is not configured.`)
  }

  return config.languages.filter(language => selected.has(language))
}

const normalizeOptions = (config: IConfig, options: ILabelSearchOptions): INormalizedSearchOptions => {
  if (!options.query) throw new Error('Search query must not be empty.')
  const mode = options.mode ?? 'prefix'
  if (!(LABEL_SEARCH_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Invalid label search mode "${mode}".`)
  }

  const limit = options.limit ?? null
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer.')
  }

  if (mode === 'glob') normalizeKeyPatterns([options.query], [])
  validateConfigInput({
    languages: config.languages,
    source: config.langCodeDefault,
    translationsPath: config.basePath,
    typesPath: config.basePathEnum,
  })

  return {
    cwd: options.cwd ?? process.cwd(),
    ignoreCase: options.ignoreCase ?? false,
    languages: selectLanguages(config, options.languages),
    limit,
    mode,
    query: options.query,
  }
}

const normalizeCase = (value: string, ignoreCase: boolean): string =>
  ignoreCase ? value.toLowerCase() : value

const matchesKey = (key: string, options: INormalizedSearchOptions): boolean => {
  if (options.mode === 'glob') return matchesKeyPattern(key, options.query, options.ignoreCase)
  const keyValue = normalizeCase(key, options.ignoreCase)
  const query = normalizeCase(options.query, options.ignoreCase)
  if (options.mode === 'exact') return keyValue === query
  return keyValue === query || keyValue.startsWith(`${query}.`)
}

const matchingKeys = (
  dictionaries: readonly ISearchDictionary[],
  options: INormalizedSearchOptions,
): string[] => {
  const matches = new Set<string>()
  const query = normalizeCase(options.query, options.ignoreCase)

  for (const dictionary of dictionaries) {
    for (const [key, value] of dictionary.flat) {
      const matched = options.mode === 'text'
        ? normalizeCase(value, options.ignoreCase).includes(query)
        : matchesKey(key, options)
      if (matched) matches.add(key)
    }
  }

  return [...matches].sort(compareText)
}

const search = async (config: IConfig, input: ILabelSearchOptions): Promise<ILabelSearchReport> => {
  const options = normalizeOptions(config, input)
  const dictionaries: ISearchDictionary[] = []
  for (const code of options.languages) {
    dictionaries.push(await readDictionary(code, path.resolve(options.cwd, config.basePath, `${code}.json`)))
  }

  const allKeys = matchingKeys(dictionaries, options)
  const selectedKeys = options.limit === null ? allKeys : allKeys.slice(0, options.limit)
  const byLanguage = new Map(dictionaries.map(dictionary => [dictionary.code, dictionary.flat]))
  const results = selectedKeys.map(key => Object.freeze({
    key,
    translations: Object.freeze(options.languages.map(language => Object.freeze({
      language,
      value: byLanguage.get(language)?.get(key) ?? null,
    }))),
  }))

  return Object.freeze({
    ignoreCase: options.ignoreCase,
    languages: Object.freeze([...options.languages]),
    limit: options.limit,
    mode: options.mode,
    query: options.query,
    results: Object.freeze(results),
    total: allKeys.length,
    truncated: selectedKeys.length < allKeys.length,
  })
}

export const LabelSearchService = {search}
