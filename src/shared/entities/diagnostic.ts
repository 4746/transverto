export type TDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface IDiagnostic {
  code: string
  details: Record<string, unknown>
  file: null | string
  message: string
  severity: TDiagnosticSeverity
}

export interface IDiagnosticSummary {
  error: number
  info: number
  warning: number
}

export interface IDoctorReport {
  diagnostics: IDiagnostic[]
  exitCode: 0 | 1 | 2
  summary: IDiagnosticSummary
}
