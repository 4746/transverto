import fs from 'node:fs'
import path from 'node:path'

import type {
  IPresetInspection,
  IPresetInspectionTarget,
  IPresetInstallReport,
  TPresetCommandId,
  TPresetProviderId,
} from './entities/preset.js'

import {applyFileTransaction, IFileMutation, IFilePrecondition} from './atomic-file.js'
import {getPresetCommands, getPresetProvider, resolvePresetAssetPath} from './preset-catalog.js'

export interface IInspectPresetProjectInput {
  commands: TPresetCommandId[]
  projectRoot: string
  provider: TPresetProviderId
}

export interface IInspectPresetProjectDependencies {
  readFile?: (file: string) => Promise<Buffer>
}

export interface IInstallPresetOptions {
  overwrite: boolean
}

type TJsonObject = Record<string, unknown>

const isObject = (value: unknown): value is TJsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const detectIndent = (text: string): number | string | undefined => {
  const match = text.match(/\r?\n([\t ]+)"/)
  return match?.[1] || undefined
}

const serializeLike = (value: unknown, original: string): string => {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const finalEol = original.endsWith('\n') ? eol : ''
  return JSON.stringify(value, null, detectIndent(original)).replaceAll('\n', eol) + finalEol
}

const readExistingFile = async (file: string, label: string): Promise<Buffer | null> => {
  const stat = fs.statSync(file, {throwIfNoEntry: false})
  if (!stat) return null
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${file}`)
  return fs.promises.readFile(file)
}

const resolvePackageUpdate = (
  original: Buffer,
): {script: 'added' | 'preserved'; updated: Buffer | null} => {
  const text = original.toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`package.json is not valid JSON: ${message}`)
  }

  if (!isObject(parsed)) throw new Error('package.json root must be an object.')
  const rawScripts = parsed.scripts
  if (rawScripts !== undefined && !isObject(rawScripts)) {
    throw new Error('package.json scripts must be an object.')
  }

  const scripts = rawScripts as TJsonObject | undefined
  if (scripts && Object.hasOwn(scripts, 'ctv')) {
    if (scripts.ctv !== 'ctv') {
      throw new Error('package.json script "ctv" already has a different value.')
    }

    return {script: 'preserved', updated: null}
  }

  const updated = {...parsed, scripts: {...scripts, ctv: 'ctv'}}
  return {script: 'added', updated: Buffer.from(serializeLike(updated, text))}
}

export async function inspectPresetProject(
  input: IInspectPresetProjectInput,
  dependencies: IInspectPresetProjectDependencies = {},
): Promise<IPresetInspection> {
  const provider = getPresetProvider(input.provider)
  if (input.commands.length === 0) throw new Error('Select at least one command.')
  if (new Set(input.commands).size !== input.commands.length) {
    throw new Error('Selection contains duplicate preset commands.')
  }

  const definitions = input.commands.map(command => {
    const definition = getPresetCommands(provider.id).find(item => item.id === command)
    if (!definition) throw new Error(`Unknown preset command: ${command}.`)
    return definition
  })
  const projectRoot = path.resolve(input.projectRoot)
  const packageFile = path.join(projectRoot, 'package.json')
  const packageStat = fs.statSync(packageFile, {throwIfNoEntry: false})
  if (!packageStat) throw new Error(`package.json does not exist: ${packageFile}`)
  if (!packageStat.isFile()) throw new Error(`package.json is not a file: ${packageFile}`)

  const readFile = dependencies.readFile ?? fs.promises.readFile
  const packageOriginal = await readFile(packageFile)
  const packageUpdate = resolvePackageUpdate(packageOriginal)
  const runDirectory = path.join(projectRoot, '.run')
  const runStat = fs.statSync(runDirectory, {throwIfNoEntry: false})
  if (runStat && !runStat.isDirectory()) {
    throw new Error(`.run path is not a directory: ${runDirectory}`)
  }

  const targets: IPresetInspectionTarget[] = []
  for (const definition of definitions) {
    const assetFile = resolvePresetAssetPath(provider.id, definition.id)
    let asset: Buffer
    try {
      asset = await readFile(assetFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Preset asset is missing: ${assetFile}.`)
      }

      throw error
    }

    const relativeTarget = path.posix.join('.run', definition.targetFile)
    const target = path.join(projectRoot, '.run', definition.targetFile)
    const original = await readExistingFile(target, 'Preset target')
    targets.push({asset, command: definition.id, original, relativeTarget, target})
  }

  return {
    conflicts: targets.filter(target => target.original !== null).map(target => target.relativeTarget),
    packageFile,
    packageOriginal,
    packageUpdated: packageUpdate.updated,
    projectRoot,
    provider: provider.id,
    script: packageUpdate.script,
    targets,
  }
}

export async function installPreset(
  inspection: IPresetInspection,
  options: IInstallPresetOptions,
): Promise<IPresetInstallReport> {
  const mutations: IFileMutation[] = []
  const preconditions: IFilePrecondition[] = []

  if (inspection.packageUpdated) {
    mutations.push({content: inspection.packageUpdated, file: inspection.packageFile})
    preconditions.push({expected: inspection.packageOriginal, file: inspection.packageFile})
  }

  const created: string[] = []
  const overwritten: string[] = []
  const preserved: string[] = []
  for (const target of inspection.targets) {
    if (target.original !== null && !options.overwrite) {
      preserved.push(target.relativeTarget)
      continue
    }

    mutations.push({content: target.asset, file: target.target})
    preconditions.push({expected: target.original, file: target.target})
    ;(target.original === null ? created : overwritten).push(target.relativeTarget)
  }

  await applyFileTransaction(mutations, {preconditions})
  return {created, overwritten, preserved, script: inspection.script}
}
