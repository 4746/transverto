import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import {
  IStatusFinding,
  IStatusReport,
  STATUS_FAIL_ON,
  STATUS_PROBLEMS,
  TStatusFailOn,
  TStatusProblem,
  TStatusSeverity,
} from '../shared/entities/status.js'
import {StatusService} from '../shared/status.service.js'

const severityColor: Record<TStatusSeverity, (value: string) => string> = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
}

const detail = (finding: IStatusFinding): string => {
  switch (finding.problem) {
    case 'empty': {
      return 'empty or whitespace-only value'
    }

    case 'extra': {
      return 'extra target value'
    }

    case 'missing': {
      return 'missing target value'
    }

    case 'placeholder': {
      return `source=${JSON.stringify(finding.sourcePlaceholders)} target=${JSON.stringify(finding.valuePlaceholders)}`
    }

    case 'same': {
      return 'same as source'
    }
  }
}

export default class Status extends Command {
  static description = 'Check target dictionaries for translation problems'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --language uk --problem missing --problem placeholder',
    '<%= config.bin %> <%= command.id %> --include "home.*" --exclude "*.title"',
    '<%= config.bin %> <%= command.id %> --fail-on warning',
  ]

  static flags = {
    exclude: Flags.string({
      description: 'exclude exact or edge-wildcard key pattern',
      multiple: true,
    }),
    'fail-on': Flags.string({
      default: 'error',
      description: 'exit 1 when filtered findings reach this severity',
      options: [...STATUS_FAIL_ON],
    }),
    include: Flags.string({
      description: 'include exact or edge-wildcard key pattern',
      multiple: true,
    }),
    json: Flags.boolean({description: 'output a stable JSON status report'}),
    language: Flags.string({description: 'target language code', multiple: true}),
    problem: Flags.string({
      description: 'problem type',
      multiple: true,
      options: [...STATUS_PROBLEMS],
    }),
  }

  public async run(): Promise<void> {
    let report: IStatusReport

    try {
      const {flags} = await this.parse(Status)
      report = await StatusService.analyze({
        exclude: flags.exclude,
        failOn: flags['fail-on'] as TStatusFailOn,
        include: flags.include,
        languages: flags.language,
        problems: flags.problem as TStatusProblem[] | undefined,
      })

      if (flags.json) this.log(JSON.stringify(report, null, 2))
      else this.printHumanReport(report)
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), {exit: 2})
    }

    if (report.exitCode === 1) this.exit(1)
  }

  private printHumanReport(report: IStatusReport): void {
    if (report.findings.length === 0) {
      this.log('No translation problems found.')
    } else {
      this.log('SEVERITY  PROBLEM      LANGUAGE  KEY  DETAIL')
      for (const finding of report.findings) {
        const severity = severityColor[finding.severity](finding.severity.toUpperCase().padEnd(9))
        this.log(
          `${severity} ${finding.problem.padEnd(12)} ${finding.language.padEnd(9)} ${finding.key}  ${detail(finding)}`,
        )
      }
    }

    this.log('')
    this.log(`Source: ${report.source}`)
    this.log(`Languages: ${report.languages.join(', ') || '-'}`)
    this.log(
      `Severity: ${report.summary.bySeverity.error} error, ${report.summary.bySeverity.warning} warning, ${report.summary.bySeverity.info} info`,
    )
    this.log(
      `Problems: ${STATUS_PROBLEMS.map(problem => `${problem}=${report.summary.byProblem[problem]}`).join(', ')}`,
    )
    this.log(`Total: ${report.summary.total}`)
  }
}
