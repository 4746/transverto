import type {
  ICsvImportPlan,
  ICsvImportReport,
  ICsvImportSummary,
} from './entities/csv-import.js'
import type {IStatusReport} from './entities/status.js'

export interface ICsvImportReportInput {
  confirmed: boolean
  dryRun: boolean
  plan: ICsvImportPlan
  status?: IStatusReport | null
  writeRequested: boolean
  written?: readonly string[]
}

const summarize = (plan: ICsvImportPlan): ICsvImportSummary => {
  const summary: ICsvImportSummary = {add: 0, conflict: 0, skip: 0, total: plan.actions.length, update: 0}
  for (const item of plan.actions) summary[item.type] += 1
  return summary
}

export function buildCsvImportReport(input: ICsvImportReportInput): ICsvImportReport {
  const summary = summarize(input.plan)
  return {
    ...input.plan,
    confirmed: input.confirmed,
    dryRun: input.dryRun,
    exitCode: summary.conflict > 0 ? 1 : 0,
    status: input.status ?? null,
    summary,
    writeRequested: input.writeRequested,
    written: [...(input.written ?? [])],
  }
}

export function formatCsvImportReport(report: ICsvImportReport): string[] {
  const lines = report.actions.map(item => (
    `${item.type.toUpperCase().padEnd(9)} row=${String(item.row).padEnd(5)} ${item.language.padEnd(9)} ${item.key} (${item.reason})`
  ))
  if (lines.length > 0) lines.push('')
  lines.push(
    `File: ${report.file}`,
    `Mappings: ${report.mappings.map(item => `${item.column}=${item.language}`).join(', ')}`,
    `Rows: ${report.rows}`,
    `Total: add=${report.summary.add}, update=${report.summary.update}, skip=${report.summary.skip}, conflict=${report.summary.conflict}`,
  )
  if (report.written.length > 0) lines.push(`Written: ${report.written.join(', ')}`)
  if (report.status) {
    lines.push(
      `Status: errors=${report.status.summary.bySeverity.error}, warnings=${report.status.summary.bySeverity.warning}, info=${report.status.summary.bySeverity.info}`,
    )
  }

  return lines
}
