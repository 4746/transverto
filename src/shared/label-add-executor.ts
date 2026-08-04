import type {IFileMutation, IFilePrecondition} from './atomic-file.js'
import type {ILabelAddPlan, ILabelAddProjectSnapshot} from './entities/label-add.js'
import type {ITranslationBatchOutput} from './entities/translation-batch.js'
import type {ITranslationRequestPlan, ITranslationResult} from './entities/translation.engine.js'

import {applyFileTransaction} from './atomic-file.js'
import {cloneSyncDictionary, serializeSyncDictionary, setSyncPath} from './sync.repository.js'
import {generateTypesContent} from './types-generator.js'

export interface ILabelAddExecutionInput {
  batch: ITranslationBatchOutput | null
  plan: ILabelAddPlan
  snapshot: ILabelAddProjectSnapshot
}

const translationId = (translation: ITranslationRequestPlan): string => JSON.stringify([
  translation.from,
  translation.to,
  translation.key ?? null,
  translation.sourceText,
])

const validatePlanMatchesSnapshot = (input: ILabelAddExecutionInput): void => {
  if (input.plan.conflicts.length > 0) {
    throw new Error('Label add plan contains structural conflicts and cannot be written.')
  }

  const languages = input.snapshot.dictionaries.map(dictionary => dictionary.code)
  if (
    input.plan.languages.length !== languages.length ||
    input.plan.languages.some((language, index) => language !== languages[index])
  ) {
    throw new Error('Label add plan does not match the loaded project snapshot.')
  }

  if (!languages.includes(input.plan.source)) {
    throw new Error(`Source language "${input.plan.source}" is not in the loaded project snapshot.`)
  }

  const covered = [
    ...input.plan.requests.map(request => request.to),
    ...input.plan.emptyTargets,
    ...input.plan.preserved,
  ]
  const targets = languages.filter(language => language !== input.plan.source)
  if (
    new Set(covered).size !== covered.length ||
    covered.length !== targets.length ||
    targets.some(language => !covered.includes(language))
  ) {
    throw new Error('Label add plan does not cover every target language exactly once.')
  }
}

const validateCompleteTranslations = (
  plan: ILabelAddPlan,
  batch: ITranslationBatchOutput | null,
): Map<string, ITranslationResult> => {
  if (!plan.autoTranslate) {
    if (plan.requests.length > 0 || batch !== null) {
      throw new Error('A no-auto-translate label add cannot contain translation work.')
    }

    return new Map()
  }

  if (plan.requests.length === 0) {
    if (batch !== null && batch.results.length > 0) {
      throw new Error('Label add received unexpected translation results.')
    }

    return new Map()
  }

  if (!batch) throw new Error('A complete translation batch is required for label add.')
  const problems: Array<[string, number]> = [
    ['conflict', batch.conflicts.length],
    ['failed', batch.failed.length],
    ['remaining', batch.remaining.length],
    ['skipped', batch.skipped.length],
  ]
  const problem = problems.find(([, count]) => count > 0)
  if (problem) throw new Error(`Translation batch contains ${problem[0]} items and is not complete.`)

  const planned = new Map(plan.requests.map(request => [translationId(request), request]))
  const results = new Map<string, ITranslationResult>()
  for (const result of batch.results) {
    const identity = translationId(result)
    if (!planned.has(identity)) throw new Error(`Unexpected translation result for "${result.to}:${result.key ?? ''}".`)
    if (results.has(identity)) throw new Error(`Duplicate translation result for "${result.to}:${result.key ?? ''}".`)
    results.set(identity, result)
  }

  if (results.size !== planned.size) {
    throw new Error(`Translation batch is incomplete: expected ${planned.size} results, received ${results.size}.`)
  }

  return results
}

const buildPreconditions = (snapshot: ILabelAddProjectSnapshot): IFilePrecondition[] => [
  ...snapshot.dictionaries.map(dictionary => ({expected: dictionary.bytes, file: dictionary.file})),
  {expected: snapshot.types.bytes, file: snapshot.types.file},
]

const apply = async (input: ILabelAddExecutionInput): Promise<string[]> => {
  validatePlanMatchesSnapshot(input)
  const translations = validateCompleteTranslations(input.plan, input.batch)
  const emptyTargets = new Set(input.plan.emptyTargets)
  const mutations: IFileMutation[] = []
  let finalDefaultDictionary

  for (const snapshot of input.snapshot.dictionaries) {
    const dictionary = cloneSyncDictionary(snapshot.dictionary)
    if (snapshot.code === input.plan.source) {
      setSyncPath(dictionary, input.plan.key, input.plan.sourceText)
    } else {
      const request = input.plan.requests.find(candidate => candidate.to === snapshot.code)
      if (request) {
        const result = translations.get(translationId(request))
        if (!result) throw new Error(`Missing validated translation for "${snapshot.code}:${input.plan.key}".`)
        setSyncPath(dictionary, input.plan.key, result.translatedText)
      } else if (emptyTargets.has(snapshot.code)) {
        setSyncPath(dictionary, input.plan.key, '')
      }
    }

    if (snapshot.code === input.snapshot.config.langCodeDefault) finalDefaultDictionary = dictionary
    const content = serializeSyncDictionary(dictionary)
    if (!Buffer.from(content).equals(snapshot.bytes)) mutations.push({content, file: snapshot.file})
  }

  if (!finalDefaultDictionary) throw new Error('Final default-language dictionary could not be built.')
  const typesContent = generateTypesContent(input.snapshot.config, finalDefaultDictionary)
  if (input.snapshot.types.bytes === null || !Buffer.from(typesContent).equals(input.snapshot.types.bytes)) {
    mutations.push({content: typesContent, file: input.snapshot.types.file})
  }

  if (mutations.length === 0) return []
  await applyFileTransaction(mutations, {preconditions: buildPreconditions(input.snapshot)})
  return mutations.map(mutation => mutation.file)
}

export const LabelAddExecutor = {apply}
