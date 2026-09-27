/* eslint complexity: ["warn", 35] */
import fs from 'node:fs'
import path from 'node:path'

import {validateLanguageCodes, validateProjectPath} from './config-builder.js'
import {CTV_CONFIG_FILE_NAME} from './constants.js'
import {
  resolveEngineProfile,
  validateEngineConfiguration,
  validateFallbackConfiguration,
} from './engine-profile.js'
import {
  IDiagnostic,
  IDiagnosticSummary,
  IDoctorReport,
  TDiagnosticSeverity,
} from './entities/diagnostic.js'
import {IResolvedEngineProfile} from './entities/translation.engine.js'
import {isStringArray} from './string-array.js'
import {validateTranslationCacheConfig} from './translation-cache.service.js'

interface IDoctorOptions {
  checkEngine?: boolean
  cwd?: string
  timeoutMs?: number
}

interface IDictionaryShape {
  file: string
  kind: 'leaf' | 'object'
}

type TJsonObject = Record<string, unknown>

const SEVERITY_ORDER: Record<TDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const isObject = (value: unknown): value is TJsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const valueType = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'

  return typeof value
}

const diagnostic = (
  code: string,
  severity: TDiagnosticSeverity,
  message: string,
  file: null | string = null,
  details: Record<string, unknown> = {},
): IDiagnostic => ({code, details, file, message, severity})

const parseJson = async (
  file: string,
  invalidCode: string,
  diagnostics: IDiagnostic[],
): Promise<unknown | undefined> => {
  let contents: string
  try {
    contents = await fs.promises.readFile(file, 'utf8')
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'FILE_READ_FAILED',
        'error',
        `Could not read ${file}.`,
        file,
        {reason: error instanceof Error ? error.message : String(error)},
      ),
    )
    return undefined
  }

  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    diagnostics.push(
      diagnostic(
        invalidCode,
        'error',
        `Invalid JSON in ${file}.`,
        file,
        {reason: error instanceof Error ? error.message : String(error)},
      ),
    )
    return undefined
  }
}

const validatePathField = (
  config: TJsonObject,
  field: 'basePath' | 'basePathEnum',
  diagnostics: IDiagnostic[],
  configFile: string,
): string | undefined => {
  const value = config[field]
  if (typeof value !== 'string') {
    diagnostics.push(
      diagnostic(
        'CONFIG_FIELD_INVALID',
        'error',
        `Configuration field "${field}" must be a string.`,
        configFile,
        {actualType: valueType(value), field},
      ),
    )
    return undefined
  }

  try {
    const validated = validateProjectPath(value, field)
    if (field === 'basePathEnum' && !validated.toLowerCase().endsWith('.ts')) {
      throw new Error('basePathEnum must point to a .ts file.')
    }

    return validated
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'CONFIG_PATH_INVALID',
        'error',
        `Configuration field "${field}" is invalid.`,
        configFile,
        {
          field,
          reason: error instanceof Error ? error.message : String(error),
        },
      ),
    )
    return undefined
  }
}

const analyzeDictionary = (
  dictionary: TJsonObject,
  file: string,
  diagnostics: IDiagnostic[],
  allShapes: Map<string, IDictionaryShape[]>,
): void => {
  const localShapes = new Map<string, 'leaf' | 'object'>()

  const visit = (object: TJsonObject, prefix = ''): void => {
    for (const [key, value] of Object.entries(object)) {
      const keyPath = prefix ? `${prefix}.${key}` : key
      if (isStringArray(value)) continue
      const kind = isObject(value) ? 'object' : 'leaf'
      const previousKind = localShapes.get(keyPath)

      if (previousKind) {
        diagnostics.push(
          diagnostic(
            'DICTIONARY_DUPLICATE_PATH',
            'error',
            `Dictionary path "${keyPath}" resolves more than once.`,
            file,
            {path: keyPath},
          ),
        )
      } else {
        localShapes.set(keyPath, kind)
      }

      const shapes = allShapes.get(keyPath) ?? []
      shapes.push({file, kind})
      allShapes.set(keyPath, shapes)

      if (kind === 'object') {
        visit(value as TJsonObject, keyPath)
      } else if (typeof value !== 'string') {
        diagnostics.push(
          diagnostic(
            'DICTIONARY_LEAF_TYPE_INVALID',
            'error',
            `Translation leaf "${keyPath}" must be a string.`,
            file,
            {actualType: valueType(value), path: keyPath},
          ),
        )
      }
    }
  }

  visit(dictionary)
}

const checkShapeConflicts = (
  allShapes: Map<string, IDictionaryShape[]>,
  diagnostics: IDiagnostic[],
): void => {
  for (const [keyPath, shapes] of allShapes) {
    const leafFiles = [...new Set(shapes.filter(({kind}) => kind === 'leaf').map(({file}) => file))].sort()
    const objectFiles = [...new Set(shapes.filter(({kind}) => kind === 'object').map(({file}) => file))].sort()

    if (leafFiles.length > 0 && objectFiles.length > 0) {
      diagnostics.push(
        diagnostic(
          'DICTIONARY_LEAF_OBJECT_CONFLICT',
          'error',
          `Dictionary path "${keyPath}" is both a leaf and an object.`,
          null,
          {leafFiles, objectFiles, path: keyPath},
        ),
      )
    }
  }
}

const diagnoseCache = (
  config: TJsonObject,
  configFile: string,
  diagnostics: IDiagnostic[],
): void => {
  if (config.cache === undefined) return

  try {
    validateTranslationCacheConfig(config.cache)
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'CONFIG_CACHE_INVALID',
        'error',
        'Configuration field "cache" is invalid.',
        configFile,
        {reason: error instanceof Error ? error.message : String(error)},
      ),
    )
  }
}

const checkEngineAvailability = async (
  profile: IResolvedEngineProfile,
  timeoutMs: number,
  diagnostics: IDiagnostic[],
): Promise<void> => {
  try {
    const headers: Record<string, string> = {}
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`

    const response = await fetch(`${profile.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      diagnostics.push(
        diagnostic(
          'ENGINE_UNAVAILABLE',
          'error',
          `Translation engine profile "${profile.name}" returned HTTP ${response.status}.`,
          null,
          {
            engine: profile.name,
            model: profile.model,
            provider: profile.provider,
            status: response.status,
          },
        ),
      )
      return
    }

    diagnostics.push(
      diagnostic(
        'ENGINE_AVAILABLE',
        'info',
        `Translation engine profile "${profile.name}" is reachable.`,
        null,
        {
          engine: profile.name,
          model: profile.model,
          provider: profile.provider,
          status: response.status,
        },
      ),
    )
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'ENGINE_UNAVAILABLE',
        'error',
        `Translation engine profile "${profile.name}" could not be reached.`,
        null,
        {
          engine: profile.name,
          model: profile.model,
          provider: profile.provider,
          reason: error instanceof Error ? error.name : 'UnknownError',
          timeoutMs,
        },
      ),
    )
  }
}

interface IEngineDiagnosticOptions {
  checkEngine?: boolean
  config: TJsonObject
  configFile: string
  diagnostics: IDiagnostic[]
  timeoutMs: number
}

const diagnoseEngine = async ({
  checkEngine,
  config,
  configFile,
  diagnostics,
  timeoutMs,
}: IEngineDiagnosticOptions): Promise<void> => {
  let engines
  try {
    engines = validateEngineConfiguration(null, config.engines)
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'CONFIG_ENGINE_PROFILE_INVALID',
        'error',
        'Configuration field "engines" contains an invalid profile.',
        configFile,
        {reason: error instanceof Error ? error.message : String(error)},
      ),
    )
    return
  }

  if (config.engine === null) {
    diagnostics.push(
      diagnostic(
        'ENGINE_NOT_CONFIGURED',
        'warning',
        'No active translation engine profile is configured.',
        configFile,
      ),
    )
    return
  }

  if (typeof config.engine !== 'string' || !(config.engine in engines)) {
    diagnostics.push(
      diagnostic(
        'CONFIG_ENGINE_INVALID',
        'error',
        'Configuration field "engine" must reference a configured profile.',
        configFile,
        {engine: config.engine},
      ),
    )
    return
  }

  try {
    validateFallbackConfiguration(config.fallback, engines, config.engine)
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'CONFIG_FALLBACK_INVALID',
        'error',
        'Configuration field "fallback" is invalid.',
        configFile,
        {reason: error instanceof Error ? error.message : String(error)},
      ),
    )
  }

  let profile: IResolvedEngineProfile
  try {
    profile = resolveEngineProfile({engine: config.engine, engines})
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'ENGINE_API_KEY_MISSING',
        'error',
        `Translation engine profile "${config.engine}" is missing its API key environment variable.`,
        configFile,
        {
          engine: config.engine,
          reason: error instanceof Error ? error.message : String(error),
        },
      ),
    )
    return
  }

  if (checkEngine) await checkEngineAvailability(profile, timeoutMs, diagnostics)
}

const finishReport = (diagnostics: IDiagnostic[]): IDoctorReport => {
  if (!diagnostics.some(({severity}) => severity === 'error' || severity === 'warning')) {
    diagnostics.push(
      diagnostic('PROJECT_OK', 'info', 'No configuration or dictionary problems found.'),
    )
  }

  diagnostics.sort((left, right) => {
    const severityDifference = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    if (severityDifference !== 0) return severityDifference

    return left.code.localeCompare(right.code) || (left.file ?? '').localeCompare(right.file ?? '')
  })

  const summary: IDiagnosticSummary = {error: 0, info: 0, warning: 0}
  for (const item of diagnostics) summary[item.severity] += 1

  const exitCode: 0 | 1 | 2 = summary.error > 0 ? 2 : summary.warning > 0 ? 1 : 0

  return {diagnostics, exitCode, summary}
}

export async function runDoctor(options: IDoctorOptions = {}): Promise<IDoctorReport> {
  const cwd = options.cwd ?? process.cwd()
  const timeoutMs = options.timeoutMs ?? 3000
  const diagnostics: IDiagnostic[] = []
  const configFile = path.join(cwd, CTV_CONFIG_FILE_NAME)
  const configStat = fs.statSync(configFile, {throwIfNoEntry: false})

  if (!configStat) {
    diagnostics.push(
      diagnostic(
        'CONFIG_MISSING',
        'error',
        `Configuration file ${CTV_CONFIG_FILE_NAME} does not exist.`,
        configFile,
      ),
    )
    return finishReport(diagnostics)
  }

  if (!configStat.isFile()) {
    diagnostics.push(
      diagnostic('CONFIG_NOT_FILE', 'error', 'Configuration path is not a file.', configFile),
    )
    return finishReport(diagnostics)
  }

  const parsedConfig = await parseJson(configFile, 'CONFIG_JSON_INVALID', diagnostics)
  if (parsedConfig === undefined) return finishReport(diagnostics)

  if (!isObject(parsedConfig)) {
    diagnostics.push(
      diagnostic(
        'CONFIG_ROOT_INVALID',
        'error',
        'Configuration root must be a JSON object.',
        configFile,
        {actualType: valueType(parsedConfig)},
      ),
    )
    return finishReport(diagnostics)
  }

  const basePath = validatePathField(parsedConfig, 'basePath', diagnostics, configFile)
  const basePathEnum = validatePathField(parsedConfig, 'basePathEnum', diagnostics, configFile)
  diagnoseCache(parsedConfig, configFile, diagnostics)

  let languages: string[] | undefined
  if (!Array.isArray(parsedConfig.languages) || parsedConfig.languages.length === 0) {
    diagnostics.push(
      diagnostic(
        'CONFIG_LANGUAGES_INVALID',
        'error',
        'Configuration field "languages" must be a non-empty array.',
        configFile,
        {actualType: valueType(parsedConfig.languages)},
      ),
    )
  } else if (parsedConfig.languages.some(language => typeof language !== 'string')) {
    diagnostics.push(
      diagnostic(
        'CONFIG_LANGUAGES_INVALID',
        'error',
        'Every configured language code must be a string.',
        configFile,
      ),
    )
  } else {
    languages = parsedConfig.languages as string[]
    try {
      validateLanguageCodes(languages)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'CONFIG_LANGUAGES_INVALID',
          'error',
          'Configuration field "languages" is invalid.',
          configFile,
          {reason: error instanceof Error ? error.message : String(error)},
        ),
      )
      languages = undefined
    }
  }

  if (typeof parsedConfig.langCodeDefault !== 'string') {
    diagnostics.push(
      diagnostic(
        'CONFIG_SOURCE_INVALID',
        'error',
        'Configuration field "langCodeDefault" must be a string.',
        configFile,
        {actualType: valueType(parsedConfig.langCodeDefault)},
      ),
    )
  } else if (languages && !languages.includes(parsedConfig.langCodeDefault)) {
    diagnostics.push(
      diagnostic(
        'CONFIG_SOURCE_NOT_CONFIGURED',
        'error',
        `Source language "${parsedConfig.langCodeDefault}" is not in languages.`,
        configFile,
        {source: parsedConfig.langCodeDefault},
      ),
    )
  }

  await diagnoseEngine({
    checkEngine: options.checkEngine,
    config: parsedConfig,
    configFile,
    diagnostics,
    timeoutMs,
  })

  const allShapes = new Map<string, IDictionaryShape[]>()
  if (basePath && languages) {
    const translationsDirectory = path.resolve(cwd, basePath)
    const translationsStat = fs.statSync(translationsDirectory, {throwIfNoEntry: false})

    if (!translationsStat) {
      diagnostics.push(
        diagnostic(
          'TRANSLATIONS_PATH_MISSING',
          'error',
          'Translations directory does not exist.',
          translationsDirectory,
        ),
      )
    } else if (translationsStat.isDirectory()) {
      for (const language of languages) {
        const languageFile = path.join(translationsDirectory, `${language}.json`)
        const languageStat = fs.statSync(languageFile, {throwIfNoEntry: false})

        if (!languageStat) {
          diagnostics.push(
            diagnostic(
              'LANGUAGE_FILE_MISSING',
              'error',
              `Language file for "${language}" does not exist.`,
              languageFile,
              {language},
            ),
          )
          continue
        }

        if (!languageStat.isFile()) {
          diagnostics.push(
            diagnostic(
              'LANGUAGE_PATH_NOT_FILE',
              'error',
              `Language path for "${language}" is not a file.`,
              languageFile,
              {language},
            ),
          )
          continue
        }

        const dictionary = await parseJson(languageFile, 'LANGUAGE_JSON_INVALID', diagnostics)
        if (dictionary === undefined) continue

        if (!isObject(dictionary)) {
          diagnostics.push(
            diagnostic(
              'LANGUAGE_ROOT_INVALID',
              'error',
              'Language dictionary root must be a JSON object.',
              languageFile,
              {actualType: valueType(dictionary), language},
            ),
          )
          continue
        }

        analyzeDictionary(dictionary, languageFile, diagnostics, allShapes)
      }
    } else {
      diagnostics.push(
        diagnostic(
          'TRANSLATIONS_PATH_NOT_DIRECTORY',
          'error',
          'Translations path is not a directory.',
          translationsDirectory,
        ),
      )
    }
  }

  checkShapeConflicts(allShapes, diagnostics)

  if (basePathEnum) {
    const typesFile = path.resolve(cwd, basePathEnum)
    const typesStat = fs.statSync(typesFile, {throwIfNoEntry: false})
    const typesDirectory = path.dirname(typesFile)
    const typesDirectoryStat = fs.statSync(typesDirectory, {throwIfNoEntry: false})

    if (typesStat?.isDirectory()) {
      diagnostics.push(
        diagnostic('TYPES_PATH_IS_DIRECTORY', 'error', 'Types path is a directory.', typesFile),
      )
    } else if (!typesDirectoryStat) {
      diagnostics.push(
        diagnostic(
          'TYPES_DIRECTORY_MISSING',
          'warning',
          'Directory for generated types does not exist.',
          typesDirectory,
        ),
      )
    } else if (!typesDirectoryStat.isDirectory()) {
      diagnostics.push(
        diagnostic(
          'TYPES_PARENT_NOT_DIRECTORY',
          'error',
          'Parent path for generated types is not a directory.',
          typesDirectory,
        ),
      )
    } else if (!typesStat) {
      diagnostics.push(
        diagnostic(
          'TYPES_FILE_MISSING',
          'info',
          'Generated types file does not exist yet.',
          typesFile,
        ),
      )
    }
  }

  return finishReport(diagnostics)
}
