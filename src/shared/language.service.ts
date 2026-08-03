import fs from 'node:fs'
import path from 'node:path'

import {applyFileTransaction, IFileMutation} from './atomic-file.js'
import {validateConfigInput, validateLanguageCodes} from './config-builder.js'
import {IConfig} from './config.js'
import {CTV_CONFIG_FILE_NAME} from './constants.js'
import {validateEngineConfiguration} from './engine-profile.js'
import {collectTranslationKeys, generateTypesContent} from './types-generator.js'

type TDictionary = Record<string, unknown>

export interface ILanguageListItem {
  code: string
  exists: boolean
  file: string
  leafCount: null | number
  role: 'source' | 'target'
  status: 'invalid' | 'missing' | 'ready'
}

export interface ILanguageMutationResult {
  code: string
  configFile: string
  file: string
  typesFile: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const serializeJson = (value: object): string => `${JSON.stringify(value, null, 2)}\n`

const parseJson = async (file: string): Promise<unknown> => {
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

const readDictionary = async (file: string): Promise<TDictionary> => {
  const parsed = await parseJson(file)
  if (!isObject(parsed)) throw new Error(`Language dictionary root must be an object: ${file}`)
  collectTranslationKeys(parsed)
  return parsed
}

const validateCode = (code: string): void => validateLanguageCodes([code])

export class LanguageProjectService {
  private constructor(
    private readonly cwd: string,
    private readonly configFile: string,
    private readonly config: IConfig,
  ) {}

  static async load(cwd = process.cwd()): Promise<LanguageProjectService> {
    const configFile = path.join(cwd, CTV_CONFIG_FILE_NAME)
    const parsed = await parseJson(configFile)
    if (!isObject(parsed)) throw new Error(`Configuration root must be an object: ${configFile}`)

    if (!Array.isArray(parsed.languages) || parsed.languages.some(code => typeof code !== 'string')) {
      throw new Error('Configuration field "languages" must be an array of language codes.')
    }

    if (
      typeof parsed.langCodeDefault !== 'string' ||
      typeof parsed.basePath !== 'string' ||
      typeof parsed.basePathEnum !== 'string'
    ) {
      throw new TypeError('Configuration source, engine and paths must be strings.')
    }

    validateConfigInput({
      languages: parsed.languages as string[],
      source: parsed.langCodeDefault,
      translationsPath: parsed.basePath,
      typesPath: parsed.basePathEnum,
    })
    validateEngineConfiguration(parsed.engine, parsed.engines)

    return new LanguageProjectService(cwd, configFile, parsed as unknown as IConfig)
  }

  async add(code: string, copyFrom?: string): Promise<ILanguageMutationResult> {
    validateCode(code)
    if (this.config.languages.includes(code)) throw new Error(`Language "${code}" is already configured.`)
    if (copyFrom && !this.config.languages.includes(copyFrom)) {
      throw new Error(`Copy source language "${copyFrom}" is not configured.`)
    }

    const file = this.languageFile(code)
    if (fs.statSync(file, {throwIfNoEntry: false})) throw new Error(`Language file already exists: ${file}`)

    const dictionary = copyFrom ? await readDictionary(this.languageFile(copyFrom)) : {}
    const nextConfig = this.withConfig({languages: [...this.config.languages, code]})
    const sourceDictionary = await this.sourceDictionary(nextConfig, code, dictionary)

    await this.commit(nextConfig, sourceDictionary, [
      {content: serializeJson(dictionary), file},
    ])

    return this.result(code, file)
  }

  async list(): Promise<ILanguageListItem[]> {
    const items: ILanguageListItem[] = []

    for (const code of this.config.languages) {
      const file = this.languageFile(code)
      const stat = fs.statSync(file, {throwIfNoEntry: false})
      let leafCount: null | number = null
      let status: ILanguageListItem['status'] = 'missing'

      if (stat?.isFile()) {
        try {
          leafCount = collectTranslationKeys(await readDictionary(file)).length
          status = 'ready'
        } catch {
          status = 'invalid'
        }
      } else if (stat) {
        status = 'invalid'
      }

      items.push({
        code,
        exists: Boolean(stat?.isFile()),
        file,
        leafCount,
        role: code === this.config.langCodeDefault ? 'source' : 'target',
        status,
      })
    }

    return items
  }

  async remove(code: string, options: {deleteFile?: boolean; source?: string} = {}): Promise<ILanguageMutationResult> {
    validateCode(code)
    if (!this.config.languages.includes(code)) throw new Error(`Language "${code}" is not configured.`)
    if (this.config.languages.length === 1) throw new Error('The last configured language cannot be removed.')

    const remaining = this.config.languages.filter(language => language !== code)
    let source = this.config.langCodeDefault
    if (code === source) {
      if (!options.source) throw new Error('Removing the source language requires --source <lang>.')
      source = options.source
    } else if (options.source) {
      source = options.source
    }

    if (!remaining.includes(source)) throw new Error(`Replacement source language "${source}" must remain configured.`)

    const nextConfig = this.withConfig({langCodeDefault: source, languages: remaining})
    const sourceDictionary = await readDictionary(this.languageFile(source))
    const file = this.languageFile(code)
    const extraMutations: IFileMutation[] = []

    if (options.deleteFile) {
      const stat = fs.statSync(file, {throwIfNoEntry: false})
      if (!stat?.isFile()) throw new Error(`Language file does not exist: ${file}`)
      extraMutations.push({delete: true, file})
    }

    await this.commit(nextConfig, sourceDictionary, extraMutations)
    return this.result(code, file)
  }

  async rename(oldCode: string, newCode: string): Promise<ILanguageMutationResult> {
    validateCode(oldCode)
    validateCode(newCode)
    if (!this.config.languages.includes(oldCode)) throw new Error(`Language "${oldCode}" is not configured.`)
    if (this.config.languages.includes(newCode)) throw new Error(`Language "${newCode}" is already configured.`)

    const oldFile = this.languageFile(oldCode)
    const newFile = this.languageFile(newCode)
    const oldDictionary = await readDictionary(oldFile)
    if (fs.statSync(newFile, {throwIfNoEntry: false})) throw new Error(`Target language file already exists: ${newFile}`)

    const languages = this.config.languages.map(code => code === oldCode ? newCode : code)
    const langCodeDefault = this.config.langCodeDefault === oldCode ? newCode : this.config.langCodeDefault
    const nextConfig = this.withConfig({langCodeDefault, languages})
    const sourceDictionary = oldCode === this.config.langCodeDefault
      ? oldDictionary
      : await readDictionary(this.languageFile(this.config.langCodeDefault))

    await this.commit(nextConfig, sourceDictionary, [
      {content: serializeJson(oldDictionary), file: newFile},
      {delete: true, file: oldFile},
    ])

    return this.result(newCode, newFile)
  }

  private async commit(
    config: IConfig,
    sourceDictionary: TDictionary,
    extraMutations: IFileMutation[],
  ): Promise<void> {
    await applyFileTransaction([
      ...extraMutations,
      {content: serializeJson(config), file: this.configFile},
      {content: generateTypesContent(config, sourceDictionary), file: this.typesFile()},
    ])
    Object.assign(this.config, config)
  }

  private languageFile(code: string): string {
    return path.resolve(this.cwd, this.config.basePath, `${code}.json`)
  }

  private result(code: string, file: string): ILanguageMutationResult {
    return {code, configFile: this.configFile, file, typesFile: this.typesFile()}
  }

  private async sourceDictionary(config: IConfig, addedCode: string, addedDictionary: TDictionary): Promise<TDictionary> {
    return config.langCodeDefault === addedCode
      ? addedDictionary
      : readDictionary(this.languageFile(config.langCodeDefault))
  }

  private typesFile(): string {
    return path.resolve(this.cwd, this.config.basePathEnum)
  }

  private withConfig(changes: Partial<IConfig>): IConfig {
    return {...this.config, ...changes}
  }
}
