import {confirm, input, select} from '@inquirer/prompts'
import {Flags} from '@oclif/core'
import chalk from 'chalk'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildConfig,
  IConfigBuilderInput,
  parseLanguages,
  validateConfigInput,
  validateLanguageCodes,
  validateProjectPath,
} from '../shared/config-builder.js'
import {CONFIG_DEFAULT, LANG_CODE_DEFAULT} from '../shared/config.js'
import {CTV_CONFIG_FILE_NAME} from '../shared/constants.js'
import {ENGINE_PROVIDER_DEFAULTS, ENGINE_PROVIDERS} from '../shared/engine-profile.js'
import {IEngineProfile, TEngineProvider} from '../shared/entities/translation.engine.js'
import {Helper} from '../shared/helper.js'
import {LabelBaseCommand} from '../shared/label-base.command.js'

interface IInitOptions extends IConfigBuilderInput {
  createFiles: boolean
  force: boolean
}

interface IInitFlags {
  'api-key-env'?: string
  'base-url'?: string
  engine?: string
  force: boolean
  languages?: string
  minimal: boolean
  model?: string
  'no-files': boolean
  provider?: string
  source?: string
  'translations-path'?: string
  'types-path'?: string
}

interface IEngineFlagValues {
  apiKeyEnv?: string
  baseUrl?: string
  engine?: string
  model?: string
  provider?: TEngineProvider
}

const hasEngineFlags = (values: IEngineFlagValues): boolean =>
  Object.values(values).some(value => value !== undefined)

const makeEngineProfile = (values: IEngineFlagValues): IEngineProfile | undefined => {
  if (!hasEngineFlags(values)) return

  if (!values.engine || !values.provider || !values.model) {
    throw new Error('Engine setup requires --engine, --provider, and --model.')
  }

  return {
    ...(values.apiKeyEnv ? {apiKeyEnv: values.apiKeyEnv} : {}),
    ...(values.baseUrl ? {baseUrl: values.baseUrl} : {}),
    model: values.model,
    provider: values.provider,
  }
}

const resolveInteractiveEngine = async (
  values: IEngineFlagValues,
): Promise<IEngineFlagValues> => {
  if (!hasEngineFlags(values) && !await confirm({
    default: false,
    message: 'Configure an AI translation profile?',
  })) return values

  const provider = values.provider ?? await select<TEngineProvider>({
    choices: ENGINE_PROVIDERS.map(value => ({name: value, value})),
    default: 'lmstudio',
    message: 'AI provider:',
  })
  const engine = values.engine ?? await input({
    default: provider,
    message: 'Engine profile name:',
  })
  const model = values.model ?? await input({
    message: 'Model identifier:',
    validate: value => value.trim().length > 0 || 'Model identifier is required.',
  })

  let {apiKeyEnv, baseUrl} = values
  if (!baseUrl) {
    const defaultBaseUrl = ENGINE_PROVIDER_DEFAULTS[provider].baseUrl ?? ''
    const enteredBaseUrl = await input({
      default: defaultBaseUrl,
      message: 'API base URL:',
    })
    baseUrl = enteredBaseUrl || undefined
  }

  if (ENGINE_PROVIDER_DEFAULTS[provider].requiresApiKey && !apiKeyEnv) {
    apiKeyEnv = await input({
      default: provider === 'google-ai' ? 'CTV_GOOGLE_AI_API_KEY' : 'CTV_OPENROUTER_API_KEY',
      message: 'API key environment variable:',
    })
  }

  return {apiKeyEnv, baseUrl, engine, model, provider}
}

export default class Init extends LabelBaseCommand<typeof Init> {
  static description = 'Create a Transverto project configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --minimal',
    '<%= config.bin %> <%= command.id %> --languages en,uk,de --source en',
    '<%= config.bin %> <%= command.id %> --minimal --engine lmstudio --provider lmstudio --model local-model',
    '<%= config.bin %> <%= command.id %> --minimal --no-files',
    '<%= config.bin %> <%= command.id %> --force',
  ]

  static flags = {
    'api-key-env': Flags.string({
      description: 'environment variable containing the API key',
      helpValue: 'NAME',
    }),
    'base-url': Flags.string({description: 'OpenAI-compatible API base URL', helpValue: 'url'}),
    engine: Flags.string({
      description: 'named engine profile',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'overwrite existing configuration and language files',
    }),
    languages: Flags.string({
      description: 'comma-separated language codes',
      helpValue: 'en,uk,de',
    }),
    minimal: Flags.boolean({
      description: 'create a minimal project without interactive questions',
    }),
    model: Flags.string({description: 'model identifier'}),
    'no-files': Flags.boolean({
      description: 'do not create language files or project directories',
    }),
    provider: Flags.string({
      description: 'AI model provider',
      options: ENGINE_PROVIDERS,
    }),
    source: Flags.string({
      description: 'source language code',
      helpValue: 'lang',
    }),
    'translations-path': Flags.string({
      description: 'directory for language JSON files',
      helpValue: 'path',
    }),
    'types-path': Flags.string({
      description: 'path for generated TypeScript types',
      helpValue: 'path',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Init)

    let options: IInitOptions
    try {
      options = await this.resolveOptions(flags)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }

    const validated = validateConfigInput(options)
    const config = buildConfig(options)
    const configPath = path.join(process.cwd(), CTV_CONFIG_FILE_NAME)

    this.preflight(configPath, validated, options)

    const writtenLanguages: string[] = []
    if (options.createFiles) {
      await fs.promises.mkdir(path.resolve(validated.translationsPath), {recursive: true})
      await fs.promises.mkdir(path.dirname(path.resolve(validated.typesPath)), {recursive: true})

      for (const language of validated.languages) {
        const languagePath = Helper.getPathLanguageFile(language, validated.translationsPath)
        const exists = fs.statSync(languagePath, {throwIfNoEntry: false})

        if (!exists || options.force) {
          await Helper.writeJsonFile({}, languagePath)
          writtenLanguages.push(language)
        }
      }
    }

    await Helper.writeJsonFile(config, configPath)

    this.log(chalk.green(`Created ${CTV_CONFIG_FILE_NAME}.`))
    if (options.createFiles) {
      const preserved = validated.languages.length - writtenLanguages.length
      this.log(chalk.green(`Language files ready: ${validated.languages.length} (${writtenLanguages.length} written, ${preserved} preserved).`))
      this.log(chalk.green(`Types directory ready for ${validated.typesPath}.`))
    }
  }

  private preflight(
    configPath: string,
    input: ReturnType<typeof validateConfigInput>,
    options: IInitOptions,
  ): void {
    const configStat = fs.statSync(configPath, {throwIfNoEntry: false})

    if (configStat && !configStat.isFile()) {
      this.error(`Configuration path is not a file: ${configPath}`, {exit: 2})
    }

    if (configStat && !options.force) {
      this.error(`Configuration already exists: ${configPath}. Use --force to overwrite it.`, {exit: 2})
    }

    if (!options.createFiles) return

    const translationsPath = path.resolve(input.translationsPath)
    const translationsStat = fs.statSync(translationsPath, {throwIfNoEntry: false})
    if (translationsStat && !translationsStat.isDirectory()) {
      this.error(`Translations path is not a directory: ${translationsPath}`, {exit: 2})
    }

    const typesPath = path.resolve(input.typesPath)
    const typesStat = fs.statSync(typesPath, {throwIfNoEntry: false})
    if (typesStat?.isDirectory()) {
      this.error(`Types path is a directory: ${typesPath}`, {exit: 2})
    }

    const typesDirectory = path.dirname(typesPath)
    const typesDirectoryStat = fs.statSync(typesDirectory, {throwIfNoEntry: false})
    if (typesDirectoryStat && !typesDirectoryStat.isDirectory()) {
      this.error(`Types parent path is not a directory: ${typesDirectory}`, {exit: 2})
    }

    for (const language of input.languages) {
      const languagePath = Helper.getPathLanguageFile(language, input.translationsPath)
      const languageStat = fs.statSync(languagePath, {throwIfNoEntry: false})
      if (languageStat && !languageStat.isFile()) {
        this.error(`Language path is not a file: ${languagePath}`, {exit: 2})
      }
    }
  }

  private async resolveOptions(flags: IInitFlags): Promise<IInitOptions> {
    let languages = flags.languages ? parseLanguages(flags.languages) : [LANG_CODE_DEFAULT]
    let {source} = flags
    let {engine} = flags
    let {
      'api-key-env': apiKeyEnv,
      'base-url': baseUrl,
      model,
      provider: rawProvider,
    } = flags
    let provider = rawProvider as TEngineProvider | undefined
    let translationsPath = flags['translations-path']
    let typesPath = flags['types-path']
    let createFiles = !flags['no-files']

    const interactive = !flags.minimal && process.stdin.isTTY && process.stdout.isTTY

    if (interactive) {
      if (!flags.languages) {
        const languagesValue = await input({
          default: languages.join(','),
          message: 'Language codes (comma-separated):',
          validate(value) {
            try {
              validateLanguageCodes(parseLanguages(value))
              return true
            } catch (error) {
              return error instanceof Error ? error.message : String(error)
            }
          },
        })
        languages = parseLanguages(languagesValue)
      }

      source ??= await select({
        choices: languages.map(language => ({name: language, value: language})),
        default: languages[0],
        message: 'Source language:',
      })

      const interactiveEngine = await resolveInteractiveEngine({
        apiKeyEnv,
        baseUrl,
        engine,
        model,
        provider,
      })
      apiKeyEnv = interactiveEngine.apiKeyEnv
      baseUrl = interactiveEngine.baseUrl
      engine = interactiveEngine.engine
      model = interactiveEngine.model
      provider = interactiveEngine.provider

      translationsPath ??= await input({
        default: CONFIG_DEFAULT.basePath,
        message: 'Translations directory:',
        validate(value) {
          try {
            validateProjectPath(value, 'Translations path')
            return true
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        },
      })

      typesPath ??= await input({
        default: CONFIG_DEFAULT.basePathEnum,
        message: 'Generated types file:',
        validate(value) {
          try {
            const valuePath = validateProjectPath(value, 'Types path')
            return valuePath.toLowerCase().endsWith('.ts') ? true : 'Types path must point to a .ts file.'
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        },
      })

      if (!flags['no-files']) {
        createFiles = await confirm({
          default: true,
          message: 'Create language files and project directories?',
        })
      }
    }

    const engineProfile = makeEngineProfile({apiKeyEnv, baseUrl, engine, model, provider})

    return {
      createFiles,
      engine: engine ?? null,
      ...(engineProfile ? {engineProfile} : {}),
      force: flags.force,
      languages,
      source,
      translationsPath,
      typesPath,
    }
  }

}
