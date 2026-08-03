import type {
  ILabelMutationPlan,
  ILabelMutationReport,
} from './entities/label-mutation.js'

export interface ILabelMutationReportInput {
  confirmed: boolean
  dryRun: boolean
  plan: ILabelMutationPlan
  writeRequested: boolean
  written?: readonly string[]
}

export const buildLabelMutationReport = (
  input: ILabelMutationReportInput,
): ILabelMutationReport => ({
  ...input.plan,
  confirmed: input.confirmed,
  dryRun: input.dryRun,
  exitCode: input.plan.conflicts.length > 0 ? 1 : 0,
  matchedKeys: [...new Set(input.plan.changes.map(change => change.from))].sort(),
  writeRequested: input.writeRequested,
  written: [...(input.written ?? [])],
})

export const formatLabelMutationReport = (report: ILabelMutationReport): string[] => {
  const lines: string[] = []
  for (const change of report.changes) {
    const destination = change.to ? ` -> ${change.to}` : ''
    const overwritten = change.overwritten.length > 0
      ? ` (overwrite: ${change.overwritten.join(', ')})`
      : ''
    lines.push(`CHANGE    ${change.language.padEnd(9)} ${change.from}${destination}${overwritten}`)
  }

  for (const conflict of report.conflicts) {
    const language = conflict.language ?? 'all'
    const destination = conflict.to ? ` -> ${conflict.to}` : ''
    lines.push(
      `CONFLICT  ${language.padEnd(9)} ${conflict.from}${destination} (${conflict.reason}: ${conflict.targets.join(', ')})`,
    )
  }

  if (lines.length > 0) lines.push('')
  lines.push(
    `Operation: ${report.operation}`,
    `Languages: ${report.languages.join(', ')}`,
    `Matched keys: ${report.matchedKeys.length}`,
    `Changes: ${report.changes.length}`,
    `Conflicts: ${report.conflicts.length}`,
  )
  if (report.written.length > 0) lines.push(`Written: ${report.written.join(', ')}`)
  return lines
}
