import type {IFileMutation, IFilePrecondition} from './atomic-file.js'
import type {ICsvImportPlan, ICsvImportProjectSnapshot} from './entities/csv-import.js'
import type {TSyncDictionary} from './entities/sync.js'

import {applyFileTransaction} from './atomic-file.js'
import {cloneSyncDictionary, serializeSyncDictionary, setSyncPath} from './sync.repository.js'
import {generateTypesContent} from './types-generator.js'

const apply = async (
  plan: ICsvImportPlan,
  snapshot: ICsvImportProjectSnapshot,
): Promise<string[]> => {
  if (plan.actions.some(item => item.type === 'conflict')) {
    throw new Error('CSV import plan contains conflicts and cannot be written.')
  }

  const dictionaries = new Map<string, TSyncDictionary>()
  const mutations: IFileMutation[] = []
  for (const dictionary of snapshot.dictionaries) {
    const next = cloneSyncDictionary(dictionary.dictionary)
    dictionaries.set(dictionary.code, next)
    for (const item of plan.actions) {
      if (item.language === dictionary.code && (item.type === 'add' || item.type === 'update')) {
        setSyncPath(next, item.key, item.value)
      }
    }

    const content = serializeSyncDictionary(next)
    if (!Buffer.from(content).equals(dictionary.bytes)) mutations.push({content, file: dictionary.file})
  }

  const source = dictionaries.get(snapshot.config.langCodeDefault) ?? snapshot.source.dictionary
  const typesContent = generateTypesContent(snapshot.config, source)
  if (snapshot.types.bytes === null || !Buffer.from(typesContent).equals(snapshot.types.bytes)) {
    mutations.push({content: typesContent, file: snapshot.types.file})
  }

  if (mutations.length === 0) return []
  const preconditions: IFilePrecondition[] = [
    ...snapshot.dictionaries.map(dictionary => ({expected: dictionary.bytes, file: dictionary.file})),
    {expected: snapshot.types.bytes, file: snapshot.types.file},
  ]
  await applyFileTransaction(mutations, {preconditions})
  return mutations.map(mutation => mutation.file)
}

export const CsvImportExecutor = {apply}
