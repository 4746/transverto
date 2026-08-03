import type {ICsvTable} from './csv-parser.js'
import type {
  ICsvColumnMapping,
  ICsvImportAction,
  ICsvImportPlan,
  ICsvImportProjectSnapshot,
  TCsvEmptyPolicy,
  TCsvExistingPolicy,
  TCsvUnknownKeyPolicy,
} from './entities/csv-import.js'

import {inspectSyncPath} from './sync.repository.js'

export interface ICsvImportPlanOptions {
  empty: TCsvEmptyPolicy
  existing: TCsvExistingPolicy
  file: string
  mappings?: string[]
  unknownKey: TCsvUnknownKeyPolicy
  useNewColumns: boolean
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const parseMappings = (
  table: ICsvTable,
  snapshot: ICsvImportProjectSnapshot,
  values: string[] | undefined,
  useNewColumns: boolean,
): ICsvColumnMapping[] => {
  const mappings = values === undefined
    ? snapshot.config.languages
      .map(language => ({column: useNewColumns ? `${language}_new` : language, language}))
      .filter(mapping => table.headers.includes(mapping.column))
    : values.map(value => {
      const separator = value.lastIndexOf('=')
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error(`Invalid --map "${value}"; expected column=language.`)
      }

      return {column: value.slice(0, separator), language: value.slice(separator + 1)}
    })

  if (mappings.length === 0) throw new Error('CSV has no mapped language columns.')
  const duplicateColumns = mappings.filter((item, index) => mappings.findIndex(other => other.column === item.column) !== index)
  const duplicateLanguages = mappings.filter((item, index) => mappings.findIndex(other => other.language === item.language) !== index)
  if (duplicateColumns.length > 0 || duplicateLanguages.length > 0) {
    throw new Error('CSV mappings must use each column and language at most once.')
  }

  for (const mapping of mappings) {
    if (!table.headers.includes(mapping.column)) throw new Error(`Mapped CSV column "${mapping.column}" does not exist.`)
    if (!snapshot.config.languages.includes(mapping.language)) {
      throw new Error(`Mapped language "${mapping.language}" is not configured.`)
    }
  }

  return mappings
}

const action = (
  input: Omit<ICsvImportAction, 'previous'> & {previous?: null | string},
): ICsvImportAction => Object.freeze({previous: null, ...input})

interface IPlanCellInput {
  key: string
  mapping: ICsvColumnMapping
  options: ICsvImportPlanOptions
  row: number
  snapshot: ICsvImportProjectSnapshot
  value: string
}

const planExisting = (input: IPlanCellInput, previous: string): ICsvImportAction => {
  const {key, mapping, options, row, value} = input
  if (previous === value) {
    return action({column: mapping.column, key, language: mapping.language, previous, reason: 'unchanged', row, type: 'skip', value})
  }

  if (value === '' && options.empty === 'clear') {
    return action({column: mapping.column, key, language: mapping.language, previous, reason: 'existing_cleared', row, type: 'update', value})
  }

  if (options.existing === 'overwrite') {
    return action({column: mapping.column, key, language: mapping.language, previous, reason: 'existing_overwritten', row, type: 'update', value})
  }

  return action({
    column: mapping.column,
    key,
    language: mapping.language,
    previous,
    reason: options.existing === 'skip' ? 'existing_skipped' : 'existing_conflict',
    row,
    type: options.existing === 'skip' ? 'skip' : 'conflict',
    value,
  })
}

const planCell = (input: IPlanCellInput): ICsvImportAction => {
  const {key, mapping, options, row, snapshot, value} = input
  const dictionary = snapshot.dictionaries.find(item => item.code === mapping.language)
  if (!dictionary) throw new Error(`Language "${mapping.language}" was not loaded.`)

  if (options.useNewColumns && value === '') {
    return action({column: mapping.column, key, language: mapping.language, reason: 'empty_new_column', row, type: 'skip', value})
  }

  if (value === '') {
    if (options.empty === 'skip') {
      return action({column: mapping.column, key, language: mapping.language, reason: 'empty_skipped', row, type: 'skip', value})
    }

    if (options.empty === 'conflict') {
      return action({column: mapping.column, key, language: mapping.language, reason: 'empty_conflict', row, type: 'conflict', value})
    }
  }

  const knownToSource = snapshot.source.flat.has(key)
  if (!knownToSource && options.unknownKey !== 'add') {
    return action({
      column: mapping.column,
      key,
      language: mapping.language,
      reason: options.unknownKey === 'skip' ? 'unknown_key_skipped' : 'unknown_key_conflict',
      row,
      type: options.unknownKey === 'skip' ? 'skip' : 'conflict',
      value,
    })
  }

  const state = inspectSyncPath(dictionary.dictionary, key)
  if (state.kind === 'object' || state.kind === 'conflict') {
    return action({column: mapping.column, key, language: mapping.language, reason: 'path_conflict', row, type: 'conflict', value})
  }

  if (state.kind === 'missing') {
    return action({column: mapping.column, key, language: mapping.language, reason: knownToSource ? 'missing_translation' : 'unknown_key_added', row, type: 'add', value})
  }

  if (state.kind !== 'leaf') throw new Error('Unexpected CSV import path state.')
  return planExisting(input, state.value)
}

const create = (
  table: ICsvTable,
  snapshot: ICsvImportProjectSnapshot,
  options: ICsvImportPlanOptions,
): ICsvImportPlan => {
  if (!table.headers.includes('label')) throw new Error('CSV must contain a "label" column.')
  const labels = table.rows.map((row, index) => {
    const {label} = row
    if (!label) throw new Error(`CSV row ${index + 2} has an empty label.`)
    if (label.startsWith('.') || label.endsWith('.') || label.includes('..')) {
      throw new Error(`CSV row ${index + 2} has an invalid label "${label}".`)
    }

    return label
  })
  const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index)
  if (duplicates.length > 0) {
    throw new Error(`CSV contains duplicate labels: ${[...new Set(duplicates)].sort(compareText).join(', ')}.`)
  }

  const mappings = parseMappings(table, snapshot, options.mappings, options.useNewColumns)
  const actions = table.rows.flatMap((row, index) => mappings.map(mapping => (
    planCell({
      key: row.label,
      mapping,
      options,
      row: index + 2,
      snapshot,
      value: row[mapping.column],
    })
  )))

  return Object.freeze({
    actions: Object.freeze(actions),
    empty: options.empty,
    existing: options.existing,
    file: options.file,
    mappings: Object.freeze(mappings),
    rows: table.rows.length,
    unknownKey: options.unknownKey,
    useNewColumns: options.useNewColumns,
  })
}

export const CsvImportPlanner = {create}
