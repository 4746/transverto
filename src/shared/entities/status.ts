export const STATUS_PROBLEMS = ['missing', 'extra', 'empty', 'same', 'placeholder'] as const
export const STATUS_SEVERITIES = ['error', 'warning', 'info'] as const
export const STATUS_FAIL_ON = ['error', 'warning', 'never'] as const

export type TStatusProblem = typeof STATUS_PROBLEMS[number]
export type TStatusSeverity = typeof STATUS_SEVERITIES[number]
export type TStatusFailOn = typeof STATUS_FAIL_ON[number]

export interface IStatusFinding {
  key: string
  language: string
  problem: TStatusProblem
  severity: TStatusSeverity
  sourcePlaceholders: null | string[]
  sourceValue: null | string
  value: null | string
  valuePlaceholders: null | string[]
}

export interface IStatusSummary {
  byProblem: Record<TStatusProblem, number>
  bySeverity: Record<TStatusSeverity, number>
  total: number
}

export interface IStatusAnalysisOptions {
  cwd?: string
  exclude?: string[]
  failOn?: TStatusFailOn
  include?: string[]
  languages?: string[]
  problems?: TStatusProblem[]
}

export interface IStatusReport {
  exitCode: 0 | 1
  failOn: TStatusFailOn
  findings: IStatusFinding[]
  languages: string[]
  source: string
  summary: IStatusSummary
}
