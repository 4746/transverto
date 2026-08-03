import type {IFileMutation, IFilePrecondition} from './atomic-file.js'
import type {ISyncPlan, ISyncProjectSnapshot, TSyncDictionary} from './entities/sync.js'
import type {ITranslationBatchOutput} from './entities/translation-batch.js'

import {applyFileTransaction} from './atomic-file.js'
import {
  cloneSyncDictionary,
  deleteSyncPath,
  serializeSyncDictionary,
  setSyncPath,
} from './sync.repository.js'
import {generateTypesContent} from './types-generator.js'

export interface ISyncExecutionInput {
  batch?: ITranslationBatchOutput | null
  plan: ISyncPlan
  snapshot: ISyncProjectSnapshot
}

const translationId = (language: string, key: string): string => `${language}\u0000${key}`

const validateInput = (input: ISyncExecutionInput): void => {
  if (input.plan.actions.some(action => action.type === 'conflict')) {
    throw new Error('Sync plan contains structural conflicts and cannot be written.')
  }

  if (
    input.plan.source !== input.snapshot.source.code ||
    input.plan.targets.length !== input.snapshot.targets.length ||
    input.plan.targets.some((target, index) => target !== input.snapshot.targets[index].code)
  ) {
    throw new Error('Sync plan does not match the loaded project snapshot.')
  }

  if (input.plan.actions.some(action => action.type === 'translate') && !input.batch) {
    throw new Error('Sync translation actions require batch outcomes before writing.')
  }
}

const translationResults = (
  batch: ITranslationBatchOutput | null | undefined,
): Map<string, string> => {
  const results = new Map<string, string>()
  for (const result of batch?.results ?? []) {
    if (!result.key) throw new Error('Sync translation result is missing a key.')
    const identity = translationId(result.to, result.key)
    if (results.has(identity)) throw new Error(`Duplicate sync translation result for "${result.to}:${result.key}".`)
    results.set(identity, result.translatedText)
  }

  return results
}

const buildTargetMutations = (
  input: ISyncExecutionInput,
  results: Map<string, string>,
): IFileMutation[] => {
  const mutations: IFileMutation[] = []

  for (const target of input.snapshot.targets) {
    const dictionary: TSyncDictionary = cloneSyncDictionary(target.dictionary)
    const actions = input.plan.actions.filter(action => action.language === target.code)

    for (const action of actions) {
      switch (action.type) {
        case 'add': {
          setSyncPath(dictionary, action.key, '')
          break
        }

        case 'remove': {
          if (!deleteSyncPath(dictionary, action.key)) {
            throw new Error(`Could not remove planned sync key "${target.code}:${action.key}".`)
          }

          break
        }

        case 'translate': {
          const translated = results.get(translationId(action.language, action.key))
          if (translated !== undefined) setSyncPath(dictionary, action.key, translated)
          break
        }

        default: {
          break
        }
      }
    }

    const content = serializeSyncDictionary(dictionary)
    if (!Buffer.from(content).equals(target.bytes)) mutations.push({content, file: target.file})
  }

  return mutations
}

const buildPreconditions = (snapshot: ISyncProjectSnapshot): IFilePrecondition[] => [
  {expected: snapshot.source.bytes, file: snapshot.source.file},
  ...snapshot.targets.map(target => ({expected: target.bytes, file: target.file})),
  {expected: snapshot.types.bytes, file: snapshot.types.file},
]

const apply = async (input: ISyncExecutionInput): Promise<string[]> => {
  validateInput(input)
  const mutations = buildTargetMutations(input, translationResults(input.batch))
  const typesContent = generateTypesContent(input.snapshot.config, input.snapshot.source.dictionary)
  const typesBytes = Buffer.from(typesContent)
  if (input.snapshot.types.bytes === null || !typesBytes.equals(input.snapshot.types.bytes)) {
    mutations.push({content: typesContent, file: input.snapshot.types.file})
  }

  if (mutations.length === 0) return []
  await applyFileTransaction(mutations, {preconditions: buildPreconditions(input.snapshot)})
  return mutations.map(mutation => mutation.file)
}

export const SyncExecutor = {apply}
