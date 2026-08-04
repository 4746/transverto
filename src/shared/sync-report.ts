import type {
  ISyncAction,
  ISyncLanguageSummary,
  ISyncPlan,
  ISyncReport,
  ISyncSummary,
} from './entities/sync.js'
import type {ITranslationBatchOutput} from './entities/translation-batch.js'

export interface ISyncReportInput {
  batch?: ITranslationBatchOutput | null
  confirmed: boolean
  dryRun: boolean
  plan: ISyncPlan
  writeRequested: boolean
  written?: readonly string[]
}

type TSummaryCounter = Exclude<keyof ISyncLanguageSummary, 'total'>

interface ITranslationOutcomeIndex {
  conflicts: Set<string>
  failed: Set<string>
  remaining: Set<string>
  results: Set<string>
  skipped: Set<string>
}

const outcomeId = (language: string, key: string): string => `${language}\u0000${key}`

const requestId = (request: {key?: string; to: string}): string => {
  if (!request.key) throw new Error('Sync batch outcome is missing a key.')
  return outcomeId(request.to, request.key)
}

const emptyLanguageSummary = (): ISyncLanguageSummary => ({
  added: 0,
  conflicts: 0,
  failed: 0,
  kept: 0,
  remaining: 0,
  removed: 0,
  skipped: 0,
  total: 0,
  translated: 0,
})

const buildOutcomeIndex = (
  batch: ITranslationBatchOutput | null,
): ITranslationOutcomeIndex | null => {
  if (!batch) return null

  const index: ITranslationOutcomeIndex = {
    conflicts: new Set(batch.conflicts.map(item => requestId(item.request))),
    failed: new Set(batch.failed.map(item => requestId(item.request))),
    remaining: new Set(batch.remaining.map(item => requestId(item.request))),
    results: new Set(batch.results.map(result => requestId(result))),
    skipped: new Set(batch.skipped.map(item => requestId(item.request))),
  }
  const all = [
    ...index.conflicts,
    ...index.failed,
    ...index.remaining,
    ...index.results,
    ...index.skipped,
  ]
  if (new Set(all).size !== all.length) {
    throw new Error('A sync translation request has more than one batch outcome.')
  }

  return index
}

const translationCounter = (
  action: ISyncAction,
  index: ITranslationOutcomeIndex | null,
): TSummaryCounter => {
  if (!index) throw new Error('Sync translation action is missing its batch outcome.')
  const identity = outcomeId(action.language, action.key)
  if (index.results.has(identity)) return 'translated'
  if (index.conflicts.has(identity)) return 'conflicts'
  if (index.failed.has(identity)) return 'failed'
  if (index.remaining.has(identity)) return 'remaining'
  if (index.skipped.has(identity)) return 'skipped'
  throw new Error(`Sync translation action "${action.language}:${action.key}" has no batch outcome.`)
}

const actionCounter = (
  action: ISyncAction,
  index: ITranslationOutcomeIndex | null,
): TSummaryCounter => {
  switch (action.type) {
    case 'add': {
      return 'added'
    }

    case 'conflict': {
      return 'conflicts'
    }

    case 'keep': {
      return 'kept'
    }

    case 'remove': {
      return 'removed'
    }

    case 'skip': {
      return 'skipped'
    }

    case 'translate': {
      return translationCounter(action, index)
    }
  }
}

const increment = (summary: ISyncLanguageSummary, counter: TSummaryCounter): void => {
  summary[counter] += 1
  summary.total += 1
}

const summarize = (
  plan: ISyncPlan,
  batch: ITranslationBatchOutput | null,
): ISyncSummary => {
  const byLanguage = Object.fromEntries(
    plan.targets.map(language => [language, emptyLanguageSummary()]),
  )
  const total = emptyLanguageSummary()
  const outcomeIndex = buildOutcomeIndex(batch)

  for (const action of plan.actions) {
    const language = byLanguage[action.language]
    if (!language) throw new Error(`Sync action uses unselected language "${action.language}".`)
    const counter = actionCounter(action, outcomeIndex)
    increment(language, counter)
    increment(total, counter)
  }

  if (total.total !== plan.actions.length) {
    throw new Error(`Sync summary invariant failed: expected ${plan.actions.length}, received ${total.total}.`)
  }

  return {byLanguage, total}
}

export function buildSyncReport(input: ISyncReportInput): ISyncReport {
  const batch = input.batch ?? null
  const summary = summarize(input.plan, batch)
  const exitCode = summary.total.conflicts + summary.total.failed + summary.total.remaining > 0 ? 1 : 0

  return {
    actions: input.plan.actions,
    autoTranslate: input.plan.autoTranslate,
    batch,
    confirmed: input.confirmed,
    dryRun: input.dryRun,
    exitCode,
    extra: input.plan.extra,
    filters: input.plan.filters,
    source: input.plan.source,
    summary,
    targets: input.plan.targets,
    writeRequested: input.writeRequested,
    written: [...(input.written ?? [])],
  }
}

const shouldShowAction = (
  action: ISyncAction,
  counter: TSummaryCounter,
): boolean => (
  counter !== 'kept' ||
  action.reason === 'extra_reported'
)

export function formatSyncReport(report: ISyncReport): string[] {
  const lines: string[] = []
  const outcomeIndex = buildOutcomeIndex(report.batch)

  for (const item of report.batch?.incomplete ?? []) {
    lines.push(`INCOMPLETE ${item.from}${item.key ? ` ${item.key}` : ''} (${item.decision}; valid=${item.validTargets.join(', ') || 'none'}; invalid=${item.invalid.map(issue => `${issue.target}:${issue.reason}`).join(', ') || 'none'})`)
  }

  for (const action of report.actions) {
    const counter = actionCounter(action, outcomeIndex)
    if (!shouldShowAction(action, counter)) continue
    lines.push(`${counter.toUpperCase().padEnd(10)} ${action.language.padEnd(9)} ${action.key} (${action.reason})`)
  }

  if (lines.length > 0) lines.push('')
  lines.push(
    `Source: ${report.source}`,
    `Targets: ${report.targets.join(', ')}`,
  )
  for (const language of report.targets) {
    const summary = report.summary.byLanguage[language]
    lines.push(
      `${language}: added=${summary.added}, removed=${summary.removed}, kept=${summary.kept}, translated=${summary.translated}, skipped=${summary.skipped}, conflicts=${summary.conflicts}, failed=${summary.failed}, remaining=${summary.remaining}`,
    )
  }

  const {total} = report.summary
  lines.push(
    `Total: added=${total.added}, removed=${total.removed}, kept=${total.kept}, translated=${total.translated}, skipped=${total.skipped}, conflicts=${total.conflicts}, failed=${total.failed}, remaining=${total.remaining}`,
  )
  if (report.written.length > 0) lines.push(`Written: ${report.written.join(', ')}`)
  return lines
}
