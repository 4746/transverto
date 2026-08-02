import type {IFileMutation, IFilePrecondition} from './atomic-file.js'
import type {
  ILabelMutationPlan,
  ILabelMutationProjectSnapshot,
} from './entities/label-mutation.js'
import type {TSyncDictionary} from './entities/sync.js'

import {applyFileTransaction} from './atomic-file.js'
import {
  cloneSyncDictionary,
  deleteSyncPath,
  serializeSyncDictionary,
  setSyncPath,
} from './sync.repository.js'
import {generateTypesContent} from './types-generator.js'

const mutateDictionary = (
  dictionary: TSyncDictionary,
  plan: ILabelMutationPlan,
  language: string,
): TSyncDictionary => {
  const next = cloneSyncDictionary(dictionary)
  const changes = plan.changes.filter(change => change.language === language)

  for (const change of changes) deleteSyncPath(next, change.from)
  for (const key of new Set(changes.flatMap(change => change.overwritten))) deleteSyncPath(next, key)
  for (const change of changes) {
    if (change.to) setSyncPath(next, change.to, change.value)
  }

  return next
}

const buildPreconditions = (snapshot: ILabelMutationProjectSnapshot): IFilePrecondition[] => {
  const files = new Map<string, Buffer | null>()
  for (const dictionary of [...snapshot.dictionaries, snapshot.source]) {
    files.set(dictionary.file, dictionary.bytes)
  }

  files.set(snapshot.types.file, snapshot.types.bytes)
  return [...files].map(([file, expected]) => ({expected, file}))
}

const apply = async (
  plan: ILabelMutationPlan,
  snapshot: ILabelMutationProjectSnapshot,
): Promise<string[]> => {
  if (plan.conflicts.length > 0) throw new Error('Mutation plan contains conflicts and cannot be written.')
  if (
    plan.languages.length !== snapshot.dictionaries.length ||
    plan.languages.some((language, index) => language !== snapshot.dictionaries[index].code)
  ) {
    throw new Error('Mutation plan does not match the loaded project snapshot.')
  }

  const mutations: IFileMutation[] = []
  let sourceDictionary = snapshot.source.dictionary
  for (const dictionary of snapshot.dictionaries) {
    const next = mutateDictionary(dictionary.dictionary, plan, dictionary.code)
    const content = serializeSyncDictionary(next)
    if (!Buffer.from(content).equals(dictionary.bytes)) mutations.push({content, file: dictionary.file})
    if (dictionary.code === snapshot.config.langCodeDefault) sourceDictionary = next
  }

  const typesContent = generateTypesContent(snapshot.config, sourceDictionary)
  if (snapshot.types.bytes === null || !Buffer.from(typesContent).equals(snapshot.types.bytes)) {
    mutations.push({content: typesContent, file: snapshot.types.file})
  }

  if (mutations.length === 0) return []
  await applyFileTransaction(mutations, {preconditions: buildPreconditions(snapshot)})
  return mutations.map(mutation => mutation.file)
}

export const LabelMutationExecutor = {apply}
