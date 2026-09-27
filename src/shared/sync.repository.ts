import fs from 'node:fs'
import path from 'node:path'

import type {IConfig} from './config.js'
import type {
  ISyncDictionarySnapshot,
  ISyncFileSnapshot,
  ISyncProjectSnapshot,
  TSyncDictionary,
} from './entities/sync.js'

import {validateConfigInput, validateLanguageCodes} from './config-builder.js'
import {isStringArray} from './string-array.js'

export interface ISyncLoadOptions {
  cwd?: string
  source?: string
  targets?: string[]
}

export type TSyncPathState =
  | {kind: 'conflict' | 'missing' | 'object'}
  | {kind: 'leaf'; value: string}

const isObject = (value: unknown): value is TSyncDictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const readRequiredFile = async (file: string): Promise<Buffer> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) throw new Error(`Language file does not exist: ${file}`)
  if (!stat.isFile()) throw new Error(`Language path is not a file: ${file}`)

  try {
    return await fs.promises.readFile(file)
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const readOptionalFile = async (file: string): Promise<ISyncFileSnapshot> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) return {bytes: null, file}
  if (!stat.isFile()) throw new Error(`Types path is not a file: ${file}`)

  try {
    return {bytes: await fs.promises.readFile(file), file}
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function flattenSyncDictionary(
  dictionary: TSyncDictionary,
  file = 'translation dictionary',
): Map<string, string> {
  const leaves = new Map<string, string>()

  const visit = (object: TSyncDictionary, prefix = ''): void => {
    for (const [key, value] of Object.entries(object)) {
      const keyPath = prefix ? `${prefix}.${key}` : key
      if (isObject(value)) {
        visit(value, keyPath)
      } else if (typeof value === 'string') {
        if (leaves.has(keyPath)) throw new Error(`Duplicate translation key path "${keyPath}" in ${file}.`)
        leaves.set(keyPath, value)
      } else if (isStringArray(value)) {
        continue
      } else {
        throw new TypeError(`Translation leaf "${keyPath}" must be a string in ${file}.`)
      }
    }
  }

  visit(dictionary)
  return new Map([...leaves].sort(([left], [right]) => compareText(left, right)))
}

export function inspectSyncPath(dictionary: TSyncDictionary, keyPath: string): TSyncPathState {
  const keys = keyPath.split('.')
  let current: unknown = dictionary

  for (const [index, key] of keys.entries()) {
    if (!isObject(current)) return {kind: 'conflict'}
    if (!(key in current)) return {kind: 'missing'}
    current = current[key]

    if (index < keys.length - 1 && !isObject(current)) return {kind: 'conflict'}
  }

  if (typeof current === 'string') return {kind: 'leaf', value: current}
  return isObject(current) ? {kind: 'object'} : {kind: 'conflict'}
}

export function setSyncPath(dictionary: TSyncDictionary, keyPath: string, value: string): void {
  const keys = keyPath.split('.')
  let current = dictionary

  for (const key of keys.slice(0, -1)) {
    if (!(key in current)) current[key] = {}
    if (!isObject(current[key])) throw new Error(`Translation key "${keyPath}" has a path conflict.`)
    current = current[key] as TSyncDictionary
  }

  const leaf = keys.at(-1)
  if (!leaf) throw new Error('Translation key path must not be empty.')
  if (isObject(current[leaf])) throw new Error(`Translation key "${keyPath}" has a path conflict.`)
  current[leaf] = value
}

export function deleteSyncPath(dictionary: TSyncDictionary, keyPath: string): boolean {
  const keys = keyPath.split('.')
  const parents: Array<{key: string; object: TSyncDictionary}> = []
  let current = dictionary

  for (const key of keys.slice(0, -1)) {
    const next = current[key]
    if (!isObject(next)) return false
    parents.push({key, object: current})
    current = next
  }

  const leaf = keys.at(-1)
  if (!leaf || !(leaf in current) || isObject(current[leaf])) return false
  delete current[leaf]

  for (const parent of parents.reverse()) {
    const child = parent.object[parent.key]
    if (isObject(child) && Object.keys(child).length === 0) delete parent.object[parent.key]
    else break
  }

  return true
}

export const cloneSyncDictionary = (dictionary: TSyncDictionary): TSyncDictionary =>
  structuredClone(dictionary)

export const serializeSyncDictionary = (dictionary: TSyncDictionary): string =>
  `${JSON.stringify(dictionary, null, 2)}\n`

const readDictionary = async (code: string, file: string): Promise<ISyncDictionarySnapshot> => {
  const bytes = await readRequiredFile(file)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isObject(parsed)) throw new TypeError(`Language dictionary root must be an object: ${file}`)
  return {bytes, code, dictionary: parsed, file, flat: flattenSyncDictionary(parsed, file)}
}

export const SyncRepository = {
  async load(config: IConfig, options: ISyncLoadOptions = {}): Promise<ISyncProjectSnapshot> {
    const cwd = options.cwd ?? process.cwd()
    validateConfigInput({
      languages: config.languages,
      source: config.langCodeDefault,
      translationsPath: config.basePath,
      typesPath: config.basePathEnum,
    })

    const source = options.source ?? config.langCodeDefault
    validateLanguageCodes([source])
    if (!config.languages.includes(source)) throw new Error(`Source language "${source}" is not configured.`)

    const requestedTargets = options.targets
    if (requestedTargets !== undefined) {
      if (requestedTargets.length === 0) throw new Error('At least one target language is required.')
      validateLanguageCodes(requestedTargets)
    }

    const selected = requestedTargets === undefined
      ? new Set(config.languages.filter(language => language !== source))
      : new Set(requestedTargets)
    for (const target of selected) {
      if (!config.languages.includes(target)) throw new Error(`Target language "${target}" is not configured.`)
      if (target === source) throw new Error(`Target language "${target}" must differ from source.`)
    }

    const targetCodes = config.languages.filter(language => selected.has(language))
    const languageFile = (code: string): string => path.resolve(cwd, config.basePath, `${code}.json`)
    const sourceSnapshot = await readDictionary(source, languageFile(source))
    const targets: ISyncDictionarySnapshot[] = []
    for (const target of targetCodes) targets.push(await readDictionary(target, languageFile(target)))

    return {
      config,
      cwd,
      source: sourceSnapshot,
      targets,
      types: await readOptionalFile(path.resolve(cwd, config.basePathEnum)),
    }
  },
}
