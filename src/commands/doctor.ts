import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {runDoctor} from '../shared/doctor.service.js'
import {IDiagnostic, TDiagnosticSeverity} from '../shared/entities/diagnostic.js'
import {LabelBaseCommand} from '../shared/label-base.command.js'

const severityColor: Record<TDiagnosticSeverity, (value: string) => string> = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
}

export default class Doctor extends LabelBaseCommand<typeof Doctor> {
  static description = 'Diagnose Transverto configuration and language files'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --check-engine --timeout 5000',
  ]

  static flags = {
    'check-engine': Flags.boolean({
      description: 'perform an opt-in network availability check for the configured engine',
    }),
    json: Flags.boolean({description: 'output a stable JSON diagnostic report'}),
    timeout: Flags.integer({
      default: 3000,
      description: 'engine check timeout in milliseconds',
      max: 30_000,
      min: 250,
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const report = await runDoctor({
      checkEngine: flags['check-engine'],
      timeoutMs: flags.timeout,
    })

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
    } else {
      for (const item of report.diagnostics) this.printDiagnostic(item)
      this.log('')
      this.log(
        `Summary: ${report.summary.error} error, ${report.summary.warning} warning, ${report.summary.info} info`,
      )
    }

    if (report.exitCode > 0) this.exit(report.exitCode)
  }

  private printDiagnostic(item: IDiagnostic): void {
    const severity = severityColor[item.severity](item.severity.toUpperCase().padEnd(7))
    const location = item.file ? ` ${item.file}` : ''
    this.log(`${severity} ${item.code}${location}`)
    this.log(`        ${item.message}`)
  }
}
