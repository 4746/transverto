import fs from 'node:fs'
import path from 'node:path'

import type {IConfig} from './config.js'
import type {
  ILabelMutationProjectSnapshot,
} from './entities/label-mutation.js'
import type {ISyncDictionarySnapshot, ISyncFileSnapshot, TSyncDictionary} from './entities/sync.js'

import {validateConfigInput, validateLanguageCodes} from './config-builder.js'
import {flattenSyncDictionary} from './sync.repository.js'

export interface ILabelMutationLoadOptions {
  cwd?: string
  languages?: string[]
}

const isObject = (value: unknown): value is TSyncDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readFile = async (file: string, description: string): Promise<Buffer> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) throw new Error(`${description} does not exist: ${file}`)
  if (!stat.isFile()) throw new Error(`${description} is not a file: ${file}`)
  return fs.promises.readFile(file)
}

const readDictionary = async (code: string, file: string): Promise<ISyncDictionarySnapshot> => {
  const bytes = await readFile(file, 'Language file')
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isObject(parsed)) throw new TypeError(`Language dictionary root must be an object: ${file}`)
  return {bytes, code, dictionary: parsed, file, flat: flattenSyncDictionary(parsed, file)}
}

const readTypes = async (file: string): Promise<ISyncFileSnapshot> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) return {bytes: null, file}
  if (!stat.isFile()) throw new Error(`Types path is not a file: ${file}`)
  return {bytes: await fs.promises.readFile(file), file}
}

const selectedLanguages = (config: IConfig, requested?: string[]): string[] => {
  if (requested !== undefined) {
    if (requested.length === 0) throw new Error('At least one language is required.')
    validateLanguageCodes(requested)
  }

  const selected = requested === undefined ? new Set(config.languages) : new Set(requested)
  for (const language of selected) {
    if (!config.languages.includes(language)) throw new Error(`Language "${language}" is not configured.`)
  }

  return config.languages.filter(language => selected.has(language))
}

const load = async (
  config: IConfig,
  options: ILabelMutationLoadOptions = {},
): Promise<ILabelMutationProjectSnapshot> => {
  const cwd = options.cwd ?? process.cwd()
  validateConfigInput({
    languages: config.languages,
    source: config.langCodeDefault,
    translationsPath: config.basePath,
    typesPath: config.basePathEnum,
  })

  const languages = selectedLanguages(config, options.languages)
  const required = new Set([config.langCodeDefault, ...languages])
  const snapshots = new Map<string, ISyncDictionarySnapshot>()
  for (const code of config.languages) {
    if (!required.has(code)) continue
    const file = path.resolve(cwd, config.basePath, `${code}.json`)
    snapshots.set(code, await readDictionary(code, file))
  }

  const source = snapshots.get(config.langCodeDefault)
  if (!source) throw new Error(`Source language "${config.langCodeDefault}" could not be loaded.`)

  return {
    config,
    cwd,
    dictionaries: languages.map(language => snapshots.get(language) as ISyncDictionarySnapshot),
    source,
    types: await readTypes(path.resolve(cwd, config.basePathEnum)),
  }
}

export const LabelMutationRepository = {load}
