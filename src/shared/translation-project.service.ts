import fs from 'node:fs'
import path from 'node:path'

import {applyFileTransaction} from './atomic-file.js'
import {IConfig} from './config.js'
import {
  ITranslationRequestPlan,
  ITranslationResult,
} from './entities/translation.engine.js'

type TDictionary = Record<string, unknown>

const isObject = (value: unknown): value is TDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readDictionary = async (file: string): Promise<TDictionary> => {
  let contents: string
  try {
    contents = await fs.promises.readFile(file, 'utf8')
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isObject(parsed)) throw new Error(`Language dictionary root must be an object: ${file}`)
  return parsed
}

const readPath = (dictionary: TDictionary, keyPath: string): unknown => {
  let current: unknown = dictionary
  for (const key of keyPath.split('.')) {
    if (!isObject(current) || !(key in current)) return undefined
    current = current[key]
  }

  return current
}

const validateWritablePath = (dictionary: TDictionary, keyPath: string, language: string): void => {
  const keys = keyPath.split('.')
  let current: unknown = dictionary
  for (const [index, key] of keys.entries()) {
    if (!isObject(current)) {
      throw new Error(`Translation key "${keyPath}" conflicts with an existing leaf in "${language}".`)
    }

    if (!(key in current)) return
    current = current[key]

    if (index < keys.length - 1 && !isObject(current)) {
      throw new Error(`Translation key "${keyPath}" conflicts with an existing leaf in "${language}".`)
    }
  }

  if (current !== undefined && typeof current !== 'string') {
    throw new Error(`Translation key "${keyPath}" is not a string leaf in "${language}".`)
  }
}

const writePath = (dictionary: TDictionary, keyPath: string, value: string): void => {
  const keys = keyPath.split('.')
  let current = dictionary
  for (const key of keys.slice(0, -1)) {
    if (!(key in current)) current[key] = {}
    if (!isObject(current[key])) throw new Error(`Translation key "${keyPath}" has a path conflict.`)
    current = current[key] as TDictionary
  }

  current[keys.at(-1)] = value
}

export class TranslationProjectService {
  private readonly dictionaries = new Map<string, TDictionary>()

  private constructor(
    private readonly config: IConfig,
    private readonly cwd: string,
  ) {}

  static load(config: IConfig, cwd = process.cwd()): TranslationProjectService {
    return new TranslationProjectService(config, cwd)
  }

  async planKeys(
    keys: string[],
    from: string,
    targets: string[],
  ): Promise<ITranslationRequestPlan[]> {
    if (!this.config.languages.includes(from)) {
      throw new Error(`Source language "${from}" is not configured.`)
    }

    if (new Set(keys).size !== keys.length) throw new Error('Translation keys must not contain duplicates.')
    if (new Set(targets).size !== targets.length) throw new Error('Target languages must not contain duplicates.')

    for (const target of targets) {
      if (!this.config.languages.includes(target)) {
        throw new Error(`Target language "${target}" is not configured.`)
      }

      if (target === from) throw new Error(`Target language "${target}" must differ from source.`)
    }

    await this.loadDictionary(from)
    for (const target of targets) await this.loadDictionary(target)

    const requests: ITranslationRequestPlan[] = []
    for (const key of keys) {
      const sourceText = readPath(this.dictionaries.get(from), key)
      if (typeof sourceText !== 'string') {
        throw new TypeError(`Translation key "${key}" is not a string leaf in "${from}".`)
      }

      for (const target of targets) {
        validateWritablePath(this.dictionaries.get(target), key, target)
        requests.push({from, key, sourceText, to: target})
      }
    }

    return requests
  }

  async write(results: ITranslationResult[]): Promise<string[]> {
    const changed = new Map<string, TDictionary>()
    for (const result of results) {
      if (!result.key) throw new Error('Only key translation results can be written.')
      const source = changed.get(result.to) ?? this.dictionaries.get(result.to)
      if (!source) throw new Error(`Language dictionary "${result.to}" was not loaded.`)

      const dictionary = changed.get(result.to) ?? structuredClone(source)
      writePath(dictionary, result.key, result.translatedText)
      changed.set(result.to, dictionary)
    }

    const written = this.config.languages.filter(language => changed.has(language))
    await applyFileTransaction(written.map(language => ({
      content: `${JSON.stringify(changed.get(language), null, 2)}\n`,
      file: this.languageFile(language),
    })))

    return written
  }

  private languageFile(language: string): string {
    return path.resolve(this.cwd, this.config.basePath, `${language}.json`)
  }

  private async loadDictionary(language: string): Promise<void> {
    if (!this.dictionaries.has(language)) {
      this.dictionaries.set(language, await readDictionary(this.languageFile(language)))
    }
  }
}
