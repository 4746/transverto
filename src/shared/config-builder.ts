import path from 'node:path'

import {
  CONFIG_DEFAULT,
  IConfig,
  LANG_CODE_DEFAULT,
} from './config.js'
import {validateEngineConfiguration} from './engine-profile.js'
import {IEngineProfile, TEngineTranslation} from './entities/translation.engine.js'

export const TRANSLATION_ENGINES: TEngineTranslation[] = [
  'bing',
  'google',
  'terra',
]

export interface IConfigBuilderInput {
  engine?: null | string
  engineProfile?: IEngineProfile
  languages?: string[]
  source?: string
  translationsPath?: string
  typesPath?: string
}

export interface IValidatedConfigInput {
  engine: null | string
  engines: Record<string, IEngineProfile>
  languages: string[]
  source: string
  translationsPath: string
  typesPath: string
}

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export function parseLanguages(value: string): string[] {
  const languages = value
    .split(',')
    .map(language => language.trim())
    .filter(Boolean)

  if (languages.length === 0) {
    throw new Error('At least one language code is required.')
  }

  return languages
}

export function validateLanguageCodes(languages: string[]): void {
  const invalid = languages.find(language => !LANGUAGE_CODE_PATTERN.test(language))

  if (invalid) {
    throw new Error(
      `Invalid language code "${invalid}". Use codes such as en, uk, en-US, or zh-Hans.`,
    )
  }

  if (new Set(languages).size !== languages.length) {
    throw new Error('Language codes must not contain duplicates.')
  }
}

export function validateProjectPath(value: string, label: string): string {
  const projectPath = value.trim().replaceAll('\\', '/')

  if (!projectPath) {
    throw new Error(`${label} is required.`)
  }

  if (
    path.isAbsolute(projectPath) ||
    path.posix.isAbsolute(projectPath) ||
    path.win32.isAbsolute(projectPath)
  ) {
    throw new Error(`${label} must be relative to the project directory.`)
  }

  const segments = projectPath.split('/')
  if (segments.includes('..')) {
    throw new Error(`${label} must not point outside the project directory.`)
  }

  return segments.filter(segment => segment !== '.').join('/')
}

export function validateConfigInput(
  input: IConfigBuilderInput,
): IValidatedConfigInput {
  const languages = input.languages ?? [LANG_CODE_DEFAULT]
  const source = input.source ?? languages[0]
  const engine = input.engine ?? CONFIG_DEFAULT.engine
  const translationsPath = validateProjectPath(
    input.translationsPath ?? CONFIG_DEFAULT.basePath,
    'Translations path',
  )
  const typesPath = validateProjectPath(
    input.typesPath ?? CONFIG_DEFAULT.basePathEnum,
    'Types path',
  )

  validateLanguageCodes(languages)

  if (!languages.includes(source)) {
    throw new Error(`Source language "${source}" must be included in --languages.`)
  }

  const engines = engine === null
    ? validateEngineConfiguration(null, {})
    : validateEngineConfiguration(engine, input.engineProfile ? {[engine]: input.engineProfile} : {})

  if (!typesPath.toLowerCase().endsWith('.ts')) {
    throw new Error('Types path must point to a .ts file.')
  }

  return {
    engine,
    engines,
    languages,
    source,
    translationsPath,
    typesPath,
  }
}

export function buildConfig(input: IConfigBuilderInput): IConfig {
  const validated = validateConfigInput(input)

  return {
    basePath: validated.translationsPath,
    basePathEnum: validated.typesPath,
    engine: validated.engine,
    engines: validated.engines,
    labelValidation: CONFIG_DEFAULT.labelValidation,
    langCodeDefault: validated.source,
    languages: [...validated.languages],
    nameEnum: CONFIG_DEFAULT.nameEnum,
    userAgent: CONFIG_DEFAULT.userAgent,
  }
}
